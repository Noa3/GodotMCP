import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { GodotResponse } from './protocol';

export type GodotConnectionState = 'disconnected' | 'connecting' | 'connected' | 'degraded';
export interface GodotClientOptions {
  host: string;
  port: number;
  timeoutMs: number;
  reconnectIntervalMs?: number;
  projectRoot?: string;
  token?: string;
  logger: {
    debug: (details: Record<string, unknown>, message: string) => void;
    warn: (details: Record<string, unknown>, message: string) => void;
  };
  clientName: string;
}
interface PendingRequest {
  resolve: (response: GodotResponse) => void;
  timer: NodeJS.Timeout;
}
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PENDING = 128;

/** One bounded connection per bridge. Requests are never replayed after a timeout. */
export class GodotClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connecting: Promise<void> | null = null;
  private finishConnect: (() => void) | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private buffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private state: GodotConnectionState = 'degraded';
  private manualDisconnect = false;
  private readonly options: GodotClientOptions;

  public constructor(options: GodotClientOptions) {
    super();
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535
      || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid bridge port or timeout');
    if (!['127.0.0.1', '::1', 'localhost'].includes(options.host)) throw new Error('Only loopback Godot bridges are supported');
    this.options = options;
  }

  public getStatus(): { state: GodotConnectionState; connected: boolean; port: number; host: string } {
    return { state: this.state, connected: this.state === 'connected', port: this.options.port, host: this.options.host };
  }

  public connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.socket) return Promise.resolve();
    this.manualDisconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setState('connecting');
    const socket = new net.Socket();
    this.socket = socket;
    this.buffer = '';
    this.connecting = new Promise<void>((resolve) => { this.finishConnect = resolve; });
    const attempt = this.connecting;
    const timer = setTimeout(() => socket.destroy(), this.options.timeoutMs);
    const finish = (): void => {
      clearTimeout(timer);
      if (this.socket !== socket) return;
      this.finishConnect?.();
      this.finishConnect = null;
      this.connecting = null;
    };
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      if (this.socket !== socket || this.manualDisconnect) { socket.destroy(); return; }
      socket.setNoDelay(true);
      this.setState('connected');
      finish();
    });
    socket.on('data', (chunk: string) => {
      if (this.socket !== socket) return;
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES || (line.trim() && !this.handleLine(line))) {
          this.failPending('INVALID_RESPONSE', 'Invalid or oversized bridge response');
          socket.destroy();
          return;
        }
      }
      if (Buffer.byteLength(this.buffer) > MAX_RESPONSE_BYTES) {
        this.failPending('INVALID_RESPONSE', 'Bridge response exceeded the frame limit');
        socket.destroy();
      }
    });
    socket.on('error', (error) => {
      this.options.logger.debug({ message: error.message, client: this.options.clientName }, 'Godot TCP error');
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (this.socket !== socket) return;
      finish();
      this.socket = null;
      this.buffer = '';
      this.failPending('GODOT_NOT_CONNECTED', 'Bridge connection closed; requests were not replayed');
      this.setState(this.manualDisconnect ? 'disconnected' : 'degraded');
      if (!this.manualDisconnect) this.scheduleReconnect();
    });
    // Resolve localhost explicitly to loopback; do not trust a hosts/DNS alias for this private transport.
    socket.connect({ host: this.options.host === 'localhost' ? '127.0.0.1' : this.options.host, port: this.options.port });
    return attempt;
  }

  public async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    this.finishConnect?.();
    this.finishConnect = null;
    this.connecting = null;
    this.buffer = '';
    this.failPending('GODOT_NOT_CONNECTED', 'Bridge disconnected');
    this.setState('disconnected');
  }

  public async sendRequest(tool: string, params: Record<string, unknown>, timeoutMs = this.options.timeoutMs): Promise<GodotResponse> {
    const id = randomUUID();
    if (this.manualDisconnect) return this.failure(id, 'GODOT_NOT_CONNECTED', 'Bridge disconnected');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return this.failure(id, 'VALIDATION_ERROR', 'Invalid timeout');
    const deadline = performance.now() + timeoutMs;
    // Connection setup consumes the same deadline. A request must not be sent after its caller timed out.
    if (this.state !== 'connected') {
      let timer: NodeJS.Timeout | undefined;
      try {
        const connectedInTime = await Promise.race([
          this.connect().then(() => true),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
        ]);
        if (!connectedInTime) return this.failure(id, 'TIMEOUT', 'Connection deadline expired; request was not sent');
      } finally { if (timer) clearTimeout(timer); }
    }
    const socket = this.socket;
    if (this.manualDisconnect || !socket || this.state !== 'connected') return this.failure(id, 'GODOT_NOT_CONNECTED', 'Bridge is not connected');
    if (this.pending.size >= MAX_PENDING) return this.failure(id, 'BUSY', 'Too many pending bridge requests');
    let frame: string;
    try {
      frame = `${JSON.stringify({ id, type: 'request', protocolVersion: 1, tool, params, timeoutMs, token: this.readToken() })}\n`;
    } catch { return this.failure(id, 'VALIDATION_ERROR', 'Request must be JSON serializable'); }
    if (Buffer.byteLength(frame) > MAX_REQUEST_BYTES) return this.failure(id, 'VALIDATION_ERROR', 'Request exceeded the frame limit');
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) return this.failure(id, 'TIMEOUT', 'Deadline expired; request was not sent');
    return new Promise<GodotResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(this.failure(id, 'TIMEOUT', `Timed out waiting for ${tool}; outcome may be unknown, request was not replayed`));
      }, remaining);
      this.pending.set(id, { resolve, timer });
      socket.write(frame, (error) => {
        if (error) this.settle(this.failure(id, 'GODOT_NOT_CONNECTED', 'Could not write bridge request'));
      });
    });
  }

  private readToken(): string | undefined {
    const override = this.options.token ?? process.env.GODOT_MCP_TOKEN;
    if (override !== undefined) return override.trim();
    const root = this.options.projectRoot ?? process.env.GODOT_PROJECT_ROOT;
    if (!root) return undefined;
    try { return readFileSync(path.join(root, '.godot', 'godot_universal_mcp', 'token'), 'utf8').trim(); }
    catch { return undefined; }
  }

  private handleLine(line: string): boolean {
    try {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const response = value as GodotResponse;
      if (typeof response.id !== 'string' || !response.id || response.type !== 'response' || typeof response.ok !== 'boolean') return false;
      if (response.error !== null && (!response.error || typeof response.error.code !== 'string'
        || typeof response.error.message !== 'string' || !response.error.details
        || typeof response.error.details !== 'object' || Array.isArray(response.error.details))) return false;
      if (!response.ok && response.error === null) return false;
      this.settle(response);
      return true;
    } catch { return false; }
  }

  private settle(response: GodotResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }
  private failure(id: string, code: string, message: string): GodotResponse {
    return { id, type: 'response', ok: false, result: null, error: { code, message, details: this.getStatus() } };
  }
  private failPending(code: string, message: string): void {
    for (const id of this.pending.keys()) this.settle(this.failure(id, code, message));
  }
  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.connect(); }, this.options.reconnectIntervalMs ?? 3000);
    this.reconnectTimer.unref();
  }
  private setState(state: GodotConnectionState): void { this.state = state; this.emit('status', this.getStatus()); }
}
