import { getEditorTools } from '../mcp/tools/editorTools';
import { getRuntimeTools } from '../mcp/tools/runtimeTools';
import { buildToolRegistry } from '../mcp/toolRegistry';
import type { McpRuntimeContext } from '../mcp/context';
import { bridgeErrorPayload } from '../utils/errors';
import { bridgeManifest, toolInputSchema, toolValidator } from '../godot/manifest';
import { verifyBridgeIdentity, waitForRuntime } from '../mcp/tools/bridgeTools';

function fixture() {
  const identity = { protocolVersion: 1, projectPath: '/unused', sessionId: 'session-a', ready: true, currentScene: 'res://main.tscn' };
  const sendRequest = jest.fn().mockResolvedValue({ id: 'test', type: 'response', ok: true, result: identity, error: null });
  let trusted = false;
  const context = {
    projectRoot: '/unused',
    editorClient: { sendRequest, getStatus: () => ({ connected: true }) },
    runtimeClient: { sendRequest, getStatus: () => ({ connected: true }) },
    getConfig: async () => ({ security: { allowWrite: trusted, trustMode: trusted ? 'trusted' : 'read-only' } }),
  } as unknown as McpRuntimeContext;
  return { context, sendRequest, identity, trust: () => { trusted = true; } };
}

describe('Bridge command contract', () => {
  test.each([
    ['godot_editor_status', 'editor.get_status'], ['godot_editor_output', 'editor.get_output'],
    ['godot_editor_save_all', 'editor.save_all'], ['godot_editor_filesystem_scan', 'editor.filesystem_scan'],
    ['godot_runtime_status', 'runtime.get_status'], ['godot_runtime_tree', 'runtime.get_tree'],
    ['godot_runtime_perf', 'runtime.get_perf'], ['godot_runtime_pause', 'runtime.pause'], ['godot_runtime_resume', 'runtime.resume'],
  ])('%s sends %s after checking endpoint identity', async (name, command) => {
    const { context, sendRequest } = fixture();
    const tools = [...getEditorTools(context), ...getRuntimeTools(context)];
    expect((await tools.find((tool) => tool.name === name)!.execute({})).isError).not.toBe(true);
    expect(sendRequest.mock.calls.at(-1)[0]).toBe(command);
  });

  test('write metadata is enforced before any editor or process request', async () => {
    const { context, sendRequest, trust } = fixture();
    const registry = buildToolRegistry(context);
    for (const name of ['godot_editor_save_all', 'godot_editor_filesystem_scan', 'godot_runtime_pause', 'godot_run_project', 'godot_stop_project']) {
      const result = await registry.call(name, {});
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('WRITE_DISABLED');
    }
    expect(sendRequest).not.toHaveBeenCalled();
    trust();
    await registry.call('godot_editor_save_all', {});
    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual(['editor.get_status', 'editor.save_all']);
  });

  test('bridge errors preserve their meaning', async () => {
    const { context, sendRequest } = fixture();
    sendRequest.mockResolvedValue({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not available', details: {} } });
    const tool = getEditorTools(context).find((entry) => entry.name === 'godot_editor_output')!;
    expect(JSON.stringify(await tool.execute({}))).toContain('NOT_IMPLEMENTED');
    expect(bridgeErrorPayload({ code: 'FUTURE_ERROR', message: 'future', details: {} }).details.bridgeCode).toBe('FUTURE_ERROR');
  });

  test('all manifest tools are exposed once with the generated strict schema', () => {
    const registry = buildToolRegistry(fixture().context);
    for (const spec of bridgeManifest.tools) {
      expect(registry.list().filter((tool) => tool.name === spec.name)).toHaveLength(1);
      expect(registry.get(spec.name)?.inputSchema).toEqual(toolInputSchema(spec));
      expect(toolValidator(spec).safeParse({ accidental_argument: true }).success).toBe(false);
      for (const required of spec.required ?? []) {
        const data: Record<string, unknown> = {};
        for (const key of spec.required ?? []) data[key] = key === 'value' ? null : '.';
        delete data[required];
        expect(toolValidator(spec).safeParse(data).success).toBe(false);
      }
    }
  });

  test('invalid bounds and missing property values are rejected before dispatch', async () => {
    const { context, sendRequest } = fixture();
    const registry = buildToolRegistry(context);
    for (const params of [{ max_depth: 13 }, { max_nodes: 0 }, { max_depth: 1.1 }, { node_path: 'x'.repeat(1025) }]) {
      expect((await registry.call('godot_editor_tree', params)).isError).toBe(true);
    }
    expect((await registry.call('godot_editor_set_node_property', { node_path: '.', property: 'position' })).isError).toBe(true);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  test('project identity and protocol are required', () => {
    const { identity } = fixture();
    expect(() => verifyBridgeIdentity('/other', identity)).toThrow('different project');
    expect(() => verifyBridgeIdentity('/unused', { ...identity, sessionId: '' })).toThrow('incompatible');
    expect(() => verifyBridgeIdentity('/unused', { ...identity, protocolVersion: 99 })).toThrow('incompatible');
  });

  test('readiness waits for the actual scene and does not mutate', async () => {
    const { context, sendRequest, identity } = fixture();
    sendRequest.mockResolvedValueOnce({ ok: true, result: { ...identity, ready: false } });
    const status = await waitForRuntime(context, { expected_scene: 'res://main.tscn', timeout_ms: 1000 });
    expect(status.ready).toBe(true);
    expect(sendRequest.mock.calls.every((call) => call[0] === 'runtime.get_status')).toBe(true);
    await expect(waitForRuntime(context, { session_id: 'different', timeout_ms: 100 })).rejects.toThrow('session changed');
  });

  test('unobserved logs are unsupported, not evidence of an error-free game', async () => {
    const tool = getRuntimeTools(fixture().context).find((entry) => entry.name === 'godot_runtime_logs')!;
    const data = JSON.parse((await tool.execute({})).content[0].text);
    expect(data.supported).toBe(false);
    expect(data.logs).toBeNull();
  });
});
