import { getEditorTools } from '../mcp/tools/editorTools';
import { getRuntimeTools } from '../mcp/tools/runtimeTools';
import { buildToolRegistry } from '../mcp/toolRegistry';
import type { McpRuntimeContext } from '../mcp/context';
import { bridgeErrorPayload } from '../utils/errors';

function fixture() {
  const sendRequest = jest.fn().mockResolvedValue({ id: 'test', type: 'response', ok: true, result: {}, error: null });
  let trusted = false;
  const context = {
    projectRoot: '/unused',
    editorClient: { sendRequest, getStatus: () => ({ connected: true }) },
    runtimeClient: { sendRequest, getStatus: () => ({ connected: true }) },
    getConfig: async () => ({ security: { allowWrite: trusted, trustMode: trusted ? 'trusted' : 'untrusted' } }),
  } as unknown as McpRuntimeContext;
  return { context, sendRequest, trust: () => { trusted = true; } };
}

describe('Bridge command contract', () => {
  test.each([
    ['godot_editor_status', 'editor.get_status'],
    ['godot_editor_output', 'editor.get_output'],
    ['godot_editor_save_all', 'editor.save_all'],
    ['godot_editor_filesystem_scan', 'editor.filesystem_scan'],
    ['godot_runtime_status', 'runtime.get_status'],
    ['godot_runtime_tree', 'runtime.get_tree'],
    ['godot_runtime_perf', 'runtime.get_perf'],
    ['godot_runtime_pause', 'runtime.pause'],
    ['godot_runtime_resume', 'runtime.resume'],
  ])('%s sends %s', async (name, command) => {
    const { context, sendRequest } = fixture();
    const tools = [...getEditorTools(context), ...getRuntimeTools(context)];
    await tools.find((tool) => tool.name === name)!.execute({});
    expect(sendRequest.mock.calls[0][0]).toBe(command);
  });

  test('write metadata is enforced before executing editor and process tools', async () => {
    const { context, sendRequest, trust } = fixture();
    const registry = buildToolRegistry(context);
    for (const name of ['godot_editor_save_all', 'godot_runtime_pause', 'godot_run_project', 'godot_stop_project']) {
      const result = await registry.call(name, {});
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('WRITE_DISABLED');
    }
    expect(sendRequest).not.toHaveBeenCalled();
    trust();
    await registry.call('godot_editor_save_all', {});
    expect(sendRequest).toHaveBeenCalledWith('editor.save_all', {});
  });

  test('bridge errors are not converted to disconnected errors', async () => {
    const { context, sendRequest } = fixture();
    sendRequest.mockResolvedValue({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not available', details: {} } });
    const tool = getEditorTools(context).find((entry) => entry.name === 'godot_editor_output')!;
    expect(JSON.stringify(await tool.execute({}))).toContain('NOT_IMPLEMENTED');
    expect(bridgeErrorPayload({ code: 'FUTURE_ERROR', message: 'future', details: {} }).details.bridgeCode).toBe('FUTURE_ERROR');
  });
});
