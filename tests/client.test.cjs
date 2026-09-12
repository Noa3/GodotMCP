// Exercises the real TCP client with native Node sockets; no Godot or npm runtime dependencies.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/godot/client.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
});
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(compiled.outputText, filename);
const { GodotClient } = loaded.exports;
const logger = { debug() {}, warn() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reply = (id, result = {}) => JSON.stringify({ id, type: 'response', ok: true, result, error: null }) + '\n';

async function fixture(t, handler, overrides = {}) {
  const peers = new Set();
  let connections = 0;
  const server = net.createServer((peer) => {
    peers.add(peer);
    connections++;
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    let input = '';
    peer.setEncoding('utf8');
    peer.on('data', (data) => {
      input += data;
      let index;
      while ((index = input.indexOf('\n')) >= 0) {
        const request = JSON.parse(input.slice(0, index));
        input = input.slice(index + 1);
        handler(request, peer);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new GodotClient({ host: '127.0.0.1', port: server.address().port, timeoutMs: 1000, reconnectIntervalMs: 20, logger, clientName: 'test', ...overrides });
  t.after(async () => {
    await client.disconnect();
    for (const peer of peers) peer.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { client, connections: () => connections };
}

test('first request connects and preserves explicit authentication and Unicode', async (t) => {
  const token = 'a'.repeat(64);
  const { client } = await fixture(t, (request, peer) => {
    assert.equal(request.token, token);
    peer.write(reply(request.id, { name: 'Grüße 🐄' }));
  }, { token });
  const response = await client.sendRequest('editor.get_status', {});
  assert.equal(response.ok, true);
  assert.equal(response.result.name, 'Grüße 🐄');
});

test('parallel requests share one connection and correlate out-of-order responses', async (t) => {
  const requests = [];
  const { client, connections } = await fixture(t, (request, peer) => {
    requests.push(request);
    if (requests.length === 16) for (const item of requests.reverse()) peer.write(reply(item.id, item.params));
  });
  const responses = await Promise.all(Array.from({ length: 16 }, (_, number) => client.sendRequest('test', { number })));
  assert.equal(connections(), 1);
  assert.deepEqual(responses.map((r) => r.result.number), Array.from({ length: 16 }, (_, i) => i));
});

test('fragmented multibyte UTF-8 and batched frames are decoded without corruption', async (t) => {
  const { client } = await fixture(t, (request, peer) => {
    const bytes = Buffer.from(reply(request.id, '🦊 ä'));
    const offset = bytes.indexOf(Buffer.from('🦊')) + 2;
    peer.write(bytes.subarray(0, offset));
    setTimeout(() => peer.write(bytes.subarray(offset)), 5);
  });
  assert.equal((await client.sendRequest('test', {})).result, '🦊 ä');
});

test('timeouts return explicit uncertainty and never replay a mutation', async (t) => {
  let calls = 0;
  const { client } = await fixture(t, () => { calls++; });
  const response = await client.sendRequest('editor.set_node_property', {}, 25);
  assert.equal(response.error.code, 'TIMEOUT');
  assert.match(response.error.message, /not replayed/);
  await sleep(60);
  assert.equal(calls, 1);
});

test('manual disconnect settles in-flight requests and suppresses reconnection', async (t) => {
  let seen;
  const received = new Promise((resolve) => { seen = resolve; });
  const { client, connections } = await fixture(t, () => seen());
  const pending = client.sendRequest('test', {});
  await received;
  await client.disconnect();
  assert.equal((await pending).error.code, 'GODOT_NOT_CONNECTED');
  await sleep(60);
  assert.equal(connections(), 1);
  assert.equal(client.getStatus().state, 'disconnected');
});

test('disconnect during connect cannot leave a zombie connected socket', async (t) => {
  const { client } = await fixture(t, (request, peer) => peer.write(reply(request.id)));
  const connecting = client.connect();
  await client.disconnect();
  await connecting;
  await sleep(30);
  assert.equal(client.getStatus().state, 'disconnected');
  await client.connect();
  assert.equal((await client.sendRequest('test', {})).ok, true);
});

test('malformed or oversized response frames close the stream promptly', async (t) => {
  for (const frame of ['[]\n', '{broken\n', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
    const { client } = await fixture(t, (_request, peer) => peer.write(frame));
    const response = await client.sendRequest('test', {});
    assert.equal(response.error.code, 'INVALID_RESPONSE');
    await client.disconnect();
  }
});

test('oversized requests and cyclic JSON are rejected without network writes', async (t) => {
  let calls = 0;
  const { client } = await fixture(t, () => { calls++; });
  const huge = await client.sendRequest('test', { value: 'x'.repeat(1024 * 1024) });
  assert.equal(huge.error.code, 'VALIDATION_ERROR');
  const cycle = {}; cycle.self = cycle;
  assert.equal((await client.sendRequest('test', cycle)).error.code, 'VALIDATION_ERROR');
  assert.equal(calls, 0);
});

test('project token is reread after rotation and is never exposed in status', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-mcp-token-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tokenPath = path.join(root, '.godot', 'godot_universal_mcp', 'token');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  const { client } = await fixture(t, (request, peer) => peer.write(reply(request.id, { token: request.token })), { projectRoot: root });
  for (const token of ['a'.repeat(64), 'b'.repeat(64)]) {
    fs.writeFileSync(tokenPath, token);
    assert.equal((await client.sendRequest('test', {})).result.token, token);
    assert.equal(JSON.stringify(client.getStatus()).includes(token), false);
  }
});

test('bridge validation and authentication errors keep their original codes', async (t) => {
  const { client } = await fixture(t, (request, peer) => peer.write(JSON.stringify({ id: request.id, type: 'response', ok: false, result: null, error: { code: 'AUTH_REQUIRED', message: 'token missing', details: {} } }) + '\n'));
  assert.equal((await client.sendRequest('test', {})).error.code, 'AUTH_REQUIRED');
});
