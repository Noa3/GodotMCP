import { EventEmitter } from 'node:events';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { type GodotRequest, type GodotResponse, GodotResponseSchema } from './protocol';
import { ERROR_CODES } from '../utils/errors';

export type GodotConnectionState = 'disconnected' | 'connecting' | 'connected' | 'degraded';

export interface GodotClientOptions {
  host: string;
  port: number;
  timeoutMs: number;
  reconnectIntervalMs?: number;
  logger: Logger;
  clientName: string;
}

interface PendingRequest {
  resolve: (response: GodotResponse) => void;
  timer: NodeJS.Timeout;
}

export class GodotClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private buffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private state: GodotConnectionState = 'degraded';
  private manualDisconnect = false;

  public constructor(private readonly options: GodotClientOptions) {
    super();
  }

  public getStatus(): { state: GodotConnectionState; connected: boolean; port: number; host: string } {
    return {
      state: this.state,
      connected: this.state === 'connected',
      port: this.options.port,
      host: this.options.host,
    };
  }

  public async connect(): Promise<void> {
    if (this.socket || this.state === 'connecting' || this.state === 'connected') {
      return;
    }

    this.manualDisconnect = false;
    this.setState('connecting');

    await new Promise<void>((resolve) => {
      const socket = net.createConnection({ host: this.options.host, port: this.options.port });
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        this.socket = socket;
        this.buffer = '';
        this.attachSocket(socket);
        this.setState('connected');
        resolve();
      });
      socket.on('error', (error) => {
        this.options.logger.debug({ err: error, client: this.options.clientName }, 'Godot TCP connect failed');
        socket.destroy();
        this.socket = null;
        this.setState('degraded');
        this.scheduleReconnect();
        resolve();
      });
    });
  }

  public async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(this.notConnectedResponse(id));
      this.pending.delete(id);
    }

    this.setState('disconnected');
    await delay(0);
  }

  public async sendRequest(tool: string, params: Record<string, unknown>, timeoutMs = this.options.timeoutMs): Promise<GodotResponse> {
    if (this.state !== 'connected' || !this.socket) {
      void this.connect();
      return this.notConnectedResponse(uuidv4());
    }

    const request: GodotRequest = {
      id: uuidv4(),
      type: 'request',
      tool,
      params,
      timeoutMs,
    };

    return new Promise<GodotResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve({
          id: request.id,
          type: 'response',
          ok: false,
          result: null,
          error: {
            code: ERROR_CODES.TIMEOUT,
            message: `Timed out waiting for ${tool}`,
            details: { timeoutMs },
          },
        });
      }, timeoutMs);

      this.pending.set(request.id, { resolve, timer });
      this.socket?.write(`${JSON.stringify(request)}\n`);
    });
  }

  private attachSocket(socket: net.Socket): void {
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newlineIndex = this.buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          this.handleLine(line);
        }
        newlineIndex = this.buffer.indexOf('\n');
      }
    });

    socket.on('close', () => {
      this.socket = null;
      this.setState(this.manualDisconnect ? 'disconnected' : 'degraded');
      for (const [id, pending] of this.pending.entries()) {
        clearTimeout(pending.timer);
        pending.resolve(this.notConnectedResponse(id));
        this.pending.delete(id);
      }
      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    });

    socket.on('error', (error) => {
      this.options.logger.debug({ err: error, client: this.options.clientName }, 'Godot TCP socket error');
    });
  }

  private handleLine(line: string): void {
    try {
      const payload = GodotResponseSchema.parse(JSON.parse(line)) as GodotResponse;
      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      pending.resolve(payload);
      this.pending.delete(payload.id);
    } catch (error) {
      this.options.logger.warn({ err: error, line, client: this.options.clientName }, 'Invalid Godot response');
    }
  }

  private notConnectedResponse(id: string): GodotResponse {
    return {
      id,
      type: 'response',
      ok: false,
      result: null,
      error: {
        code: ERROR_CODES.GODOT_NOT_CONNECTED,
        message: `${this.options.clientName} bridge is not connected`,
        details: this.getStatus(),
      },
    };
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.options.reconnectIntervalMs ?? 3_000);
  }

  private setState(state: GodotConnectionState): void {
    this.state = state;
    this.emit('status', this.getStatus());
  }
}
