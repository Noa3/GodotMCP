import path from 'node:path';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { bridgeManifest, toolInputSchema, toolValidator, type BridgeToolSpec } from '../../godot/manifest';
import type { GodotResponse } from '../../godot/protocol';
import type { GodotClient } from '../../godot/client';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { errorResult, imageResult, jsonResult, type ToolResult } from '../toolUtils';
import { bridgeErrorPayload, createErrorPayload, ERROR_CODES, type ErrorPayload } from '../../utils/errors';

type Data = Record<string, unknown>;
class BridgeFailure extends Error {
  public constructor(public readonly payload: ErrorPayload) { super(payload.message); }
}
function fail(code: keyof typeof ERROR_CODES, message: string, details: Data = {}): never {
  throw new BridgeFailure(createErrorPayload(ERROR_CODES[code], message, details));
}
function canonicalPath(value: string): string {
  let resolved = path.resolve(value);
  try { resolved = realpathSync(resolved); } catch { /* A diagnostic fixture may have no files. */ }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
export function verifyBridgeIdentity(root: string, value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_RESPONSE', 'Missing bridge identity');
  const data = value as Data;
  if (data.protocolVersion !== 1 || typeof data.projectPath !== 'string' || typeof data.sessionId !== 'string' || !data.sessionId) {
    fail('INVALID_RESPONSE', 'Addon identity/protocol is incompatible. Update the whole addon and server together.');
  }
  if (canonicalPath(data.projectPath) !== canonicalPath(root)) fail('INVALID_PROJECT', 'Bridge belongs to a different project', { expected: root, actual: data.projectPath });
  return data;
}
function unwrap(response: GodotResponse): unknown {
  if (!response.ok) throw new BridgeFailure(bridgeErrorPayload(response.error));
  return response.result;
}
/** A status probe cannot overrun the workflow deadline, even during an in-flight TCP connection attempt. */
async function request(client: GodotClient, command: string, params: Data, deadline: number, probe = false): Promise<GodotResponse> {
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) fail('TIMEOUT', 'Workflow deadline expired; mutations are never replayed');
  const timeout = probe ? Math.min(500, remaining) : remaining;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      client.sendRequest(command, params, timeout),
      new Promise<GodotResponse>((resolve) => {
        timer = setTimeout(() => resolve({ id: 'deadline', type: 'response', ok: false, result: null,
          error: { code: 'TIMEOUT', message: 'Workflow deadline expired; no request was replayed', details: {} } }), timeout);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
function terminal(response: GodotResponse): boolean {
  return !response.ok && !['TIMEOUT', 'GODOT_NOT_CONNECTED', 'GODOT_RUNTIME_NOT_CONNECTED'].includes(response.error?.code ?? '');
}
async function pausePoll(deadline: number): Promise<void> { await sleep(Math.max(0, Math.min(50, deadline - performance.now()))); }

export async function waitForRuntime(context: McpRuntimeContext, params: Data, deadline = performance.now() + Number(params.timeout_ms ?? 15000), excludeSession?: string): Promise<Data> {
  let last: unknown = null;
  while (performance.now() < deadline) {
    const response = await request(context.runtimeClient, 'runtime.get_status', {}, deadline, true);
    if (terminal(response)) unwrap(response);
    if (response.ok) {
      const status = verifyBridgeIdentity(context.projectRoot, response.result);
      last = status;
      if (params.session_id && status.sessionId !== params.session_id) fail('INVALID_PROJECT', 'Runtime session changed', { expectedSession: params.session_id, actualSession: status.sessionId });
      if (status.ready === true && typeof status.currentScene === 'string' && status.currentScene
        && status.sessionId !== excludeSession && (!params.expected_scene || status.currentScene === params.expected_scene)) {
        if (!params.node_path) return status;
        const node = await request(context.runtimeClient, 'runtime.get_node', { node_path: params.node_path }, deadline, true);
        if (node.ok) return status;
        if (node.error?.code !== 'INVALID_PROJECT' && terminal(node)) unwrap(node);
      }
    } else last = response.error;
    await pausePoll(deadline);
  }
  fail('TIMEOUT', 'Runtime readiness conditions were not met', { lastObservation: last, expectedScene: params.expected_scene ?? null, expectedNode: params.node_path ?? null });
}

function screenshotResult(value: unknown, encoding: unknown): ToolResult {
  if (!value || typeof value !== 'object') fail('INVALID_RESPONSE', 'Missing screenshot');
  const { base64, ...metadata } = value as Data;
  if (metadata.format !== 'png' || typeof base64 !== 'string' || base64.length > 8 * 1024 * 1024) fail('INVALID_RESPONSE', 'Invalid PNG response');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(16) !== metadata.width || bytes.readUInt32BE(20) !== metadata.height) fail('INVALID_RESPONSE', 'PNG header does not match screenshot dimensions');
  metadata.sha256 = createHash('sha256').update(bytes).digest('hex');
  if (encoding === 'base64') return jsonResult({ ...metadata, base64 });
  if (encoding === 'data-uri') return jsonResult({ ...metadata, dataUri: `data:image/png;base64,${base64}` });
  return imageResult(base64, metadata);
}

async function capture(context: McpRuntimeContext, params: Data, deadline: number): Promise<ToolResult> {
  const initial = await waitForRuntime(context, params, deadline);
  if (initial.renderingAvailable !== true) fail('TOOL_NOT_AVAILABLE', 'A rendering display is required, not a headless process');
  if (typeof initial.renderedFrames !== 'number') fail('INVALID_RESPONSE', 'Missing rendered frame counter');
  const target = initial.renderedFrames + Number(params.wait_frames ?? 2);
  const expected = { ...params, session_id: initial.sessionId, expected_scene: initial.currentScene };
  while (performance.now() < deadline) {
    const current = await waitForRuntime(context, expected, deadline);
    if (Number(current.renderedFrames) >= target && current.lastRenderedScene === initial.currentScene) {
      const result = unwrap(await request(context.runtimeClient, 'runtime.screenshot', { max_edge: params.max_edge ?? 1024 }, deadline));
      const image = verifyBridgeIdentity(context.projectRoot, result);
      if (image.sessionId !== initial.sessionId || image.currentScene !== initial.currentScene || Number(image.renderedFrames) < target) fail('INVALID_RESPONSE', 'Screenshot is from an unexpected scene/session/frame');
      return screenshotResult(image, params.encoding);
    }
    await pausePoll(deadline);
  }
  fail('TIMEOUT', 'No matching rendered frame became available');
}

async function execute(context: McpRuntimeContext, spec: BridgeToolSpec, params: Data): Promise<ToolResult> {
  const deadline = performance.now() + Number(params.timeout_ms ?? 15000);
  if (spec.operation === 'wait') return jsonResult({ ready: true, ...(await waitForRuntime(context, params, deadline)) });
  if (spec.operation === 'capture') return capture(context, params, deadline);
  const client = spec.target === 'editor' ? context.editorClient : context.runtimeClient;
  if (spec.command === `${spec.target}.get_status`) {
    const response = await request(client, spec.command, {}, deadline);
    return jsonResult(verifyBridgeIdentity(context.projectRoot, unwrap(response)));
  }
  // Verify the endpoint before any mutation; capabilities alone are not project identity.
  const status = verifyBridgeIdentity(context.projectRoot, unwrap(await request(client, `${spec.target}.get_status`, {}, deadline)));
  if (spec.operation === 'run') {
    const wait = params.wait_for_runtime !== false;
    if (wait && status.runtimeEnabled !== true) fail('TOOL_NOT_AVAILABLE', 'Enable the runtime bridge in the Godot dock before waiting for it');
    if (status.scanning === true) fail('BUSY', 'Editor import scan is still running');
    let previousSession: string | undefined;
    if (status.isPlaying !== true) {
      const previous = await request(context.runtimeClient, 'runtime.get_status', {}, deadline, true);
      if (terminal(previous)) unwrap(previous);
      if (previous.ok) previousSession = String(verifyBridgeIdentity(context.projectRoot, previous.result).sessionId);
      unwrap(await request(client, 'editor.run_project', {}, deadline));
    }
    if (!wait) return jsonResult({ requested: true, ready: false, alreadyRunning: status.isPlaying === true });
    const runtime = await waitForRuntime(context, params, deadline, previousSession);
    const editor = verifyBridgeIdentity(context.projectRoot, unwrap(await request(client, 'editor.get_status', {}, deadline)));
    if (editor.sessionId !== status.sessionId || editor.isPlaying !== true) fail('INVALID_PROJECT', 'Editor session/play state changed while starting');
    return jsonResult({ running: true, ready: true, alreadyRunning: status.isPlaying === true, runtime });
  }
  if (spec.operation === 'stop') {
    const before = await request(context.runtimeClient, 'runtime.get_status', {}, deadline, true);
    if (terminal(before)) unwrap(before);
    const previous = before.ok ? verifyBridgeIdentity(context.projectRoot, before.result) : null;
    unwrap(await request(client, 'editor.stop_project', {}, deadline));
    while (performance.now() < deadline) {
      const editor = verifyBridgeIdentity(context.projectRoot, unwrap(await request(client, 'editor.get_status', {}, deadline)));
      if (editor.sessionId !== status.sessionId) fail('INVALID_PROJECT', 'Editor session changed while stopping');
      if (editor.isPlaying === false) {
        if (!previous) return jsonResult({ stopped: true, runtimeObserved: false });
        const runtime = await request(context.runtimeClient, 'runtime.get_status', {}, deadline, true);
        if (terminal(runtime)) unwrap(runtime);
        if (!runtime.ok && runtime.error?.code !== 'TIMEOUT') return jsonResult({ stopped: true, endedSession: previous.sessionId });
        if (runtime.ok && verifyBridgeIdentity(context.projectRoot, runtime.result).sessionId !== previous.sessionId) fail('INVALID_PROJECT', 'Another runtime session appeared while stopping');
      }
      await pausePoll(deadline);
    }
    fail('TIMEOUT', 'Stop was requested but process termination was not confirmed');
  }
  const result = unwrap(await request(client, spec.command!, params, deadline));
  return spec.command === 'runtime.screenshot' ? screenshotResult(result, params.encoding) : jsonResult(result);
}

export function getBridgeTools(context: McpRuntimeContext, target: 'editor' | 'runtime'): ToolDefinition[] {
  return bridgeManifest.tools.filter((spec) => spec.target === target).map((spec) => ({
    name: spec.name, title: spec.name.replace(/_/g, ' '), description: spec.description,
    riskLevel: spec.risk, requiresEditor: target === 'editor', requiresRuntime: target === 'runtime',
    schema: toolValidator(spec), inputSchema: toolInputSchema(spec),
    execute: async (params: Data) => {
      try { return await execute(context, spec, params); }
      catch (error) { if (error instanceof BridgeFailure) return errorResult(error.payload); throw error; }
    },
  }));
}
