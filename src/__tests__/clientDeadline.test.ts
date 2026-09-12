import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { GodotClient } from '../godot/client';

test('a delayed connection never dispatches a mutation after its request deadline', async () => {
  const received: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('data', (data) => received.push(data.toString()));
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new GodotClient({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port,
    timeoutMs: 500, reconnectIntervalMs: 5000, clientName: 'deadline-fixture',
    logger: { debug: () => undefined, warn: () => undefined } });
  const realConnect = client.connect.bind(client);
  let finishAttempt: Promise<void> | undefined;
  jest.spyOn(client, 'connect').mockImplementation(() => {
    finishAttempt = sleep(100).then(realConnect);
    return finishAttempt;
  });
  try {
    const response = await client.sendRequest('editor.save_all', {}, 20);
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('TIMEOUT');
    await finishAttempt;
    await sleep(30);
    expect(received).toEqual([]);
  } finally {
    await client.disconnect();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
