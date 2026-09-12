const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {
  const root = process.argv[2];
  assert(root, 'A temporary fixture project is required');
  const client = new Client({ name: 'godot-mcp-fixture', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.resolve(__dirname, '../dist/cli/index.js')],
    env: { ...process.env, GODOT_PROJECT_ROOT: root }, stderr: 'pipe' });
  transport.stderr?.on('data', data => process.stderr.write(data));
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result));
    assert.equal(result.content[0].type, 'text');
    return { result, data: JSON.parse(result.content[0].text) };
  }
  try {
    await client.connect(transport);
    const manifest = require('../addons/godot_universal_mcp/tool_manifest.json');
    const { tools } = await client.listTools();
    for (const spec of manifest.tools) assert(tools.some(tool => tool.name === spec.name), spec.name);
    const start = await call('godot_editor_run_project', { wait_for_runtime: true, expected_scene: 'res://main.tscn', node_path: 'Fixture/Observer', timeout_ms: 30000 });
    assert.equal(start.data.ready, true);
    const session = start.data.runtime.sessionId;
    const snapshot = await call('godot_runtime_snapshot');
    assert.equal(snapshot.data.semanticSupported, true);
    await call('godot_runtime_send_action', { action: 'fixture_interact', phase: 'pressed', hold_ms: 100 });
    const capture = await call('godot_runtime_capture_frame', { wait_frames: 8, session_id: session, expected_scene: 'res://main.tscn', timeout_ms: 15000 });
    assert.equal(capture.data.sessionId, session);
    const image = capture.result.content.find(block => block.type === 'image');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex'), capture.data.sha256);
    const denied = await client.callTool({ name: 'godot_runtime_wait_ready', arguments: { session_id: 'wrong-session', timeout_ms: 100 } });
    assert.equal(denied.isError, true);
    await call('godot_runtime_pause');
    await call('godot_runtime_resume');
    const stop = await call('godot_editor_stop_project', { timeout_ms: 15000 });
    assert.equal(stop.data.stopped, true);
    console.log('PASS: real MCP stdio client -> Node -> Godot editor/runtime, verified start/stop, snapshots, InputMap and native PNG content');
  } finally {
    await client.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
