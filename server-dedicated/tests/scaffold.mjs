import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createDedicatedServer, settingsFromEnv, parseClientMessage, parseServerMessage, PROTOCOL_VERSION } from '../dist/index.mjs';

test('dedicated transport scaffold uses the shared protocol without creating a match', async (t) => {
  const origin = 'http://127.0.0.1:5173';
  const { server, sockets } = createDedicatedServer({ host: '127.0.0.1', port: 0, allowedOrigins: [origin] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function open() {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin });
    await once(ws, 'open');
    return ws;
  }
  async function exchange(data, opts) {
    const ws = await open(), incoming = once(ws, 'message'), closed = once(ws, 'close');
    ws.send(data, opts);
    const [raw] = await incoming, [code] = await closed;
    const message = parseServerMessage(raw.toString());
    assert.ok(message, 'reply conforms to the same server validator as the browser');
    assert.equal(message.type, 'error');
    assert.equal(message.fatal, true);
    assert.equal(code, 1008);
    return message;
  }
  try {
    await t.test('validates host configuration and exact permitted origins', () => {
      assert.deepEqual(settingsFromEnv({ DEDICATED_HOST: '0.0.0.0', DEDICATED_PORT: '9999', ALLOWED_ORIGINS: origin }),
        { host: '0.0.0.0', port: 9999, allowedOrigins: [origin] });
      for (const env of [{ DEDICATED_PORT: '0' }, { DEDICATED_PORT: '65536' }, { ALLOWED_ORIGINS: '*' },
        { ALLOWED_ORIGINS: 'https://example.com/path' }, { ALLOWED_ORIGINS: '' }]) assert.throws(() => settingsFromEnv(env));
    });
    await t.test('health accurately reports incomplete and presence is unavailable', async () => {
      const response = await fetch(`${base}/health`), health = await response.json();
      assert.equal(response.status, 200); assert.equal(health.ok, true); assert.equal(health.ready, false);
      assert.equal(health.protocol, PROTOCOL_VERSION); assert.equal(health.room, 'public-main');
      assert.equal((await fetch(`${base}/presence`)).status, 503);
      assert.equal((await fetch(`${base}/ws`)).status, 426);
      assert.equal((await fetch(`${base}/unknown`)).status, 404);
    });
    await t.test('denies missing or unapproved browser origins', async () => {
      for (const rejected of [undefined, 'https://other.example']) {
        const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', rejected ? { origin: rejected } : {});
        ws.on('error', () => {});
        const [, response] = await once(ws, 'unexpected-response');
        assert.equal(response.statusCode, 403);
        response.resume(); ws.terminate();
      }
    });
    await t.test('distinguishes version mismatch, malformed input and forbidden extra fields', async () => {
      assert.equal((await exchange(JSON.stringify({ v: PROTOCOL_VERSION + 1, type: 'join', name: 'Test' }))).code, 'protocol_mismatch');
      assert.equal((await exchange('{')).code, 'invalid_message');
      assert.equal((await exchange(JSON.stringify({ v: PROTOCOL_VERSION, type: 'join', name: 'Test', kills: 999 }))).code, 'invalid_message');
      assert.equal((await exchange(Buffer.from(JSON.stringify({ v: PROTOCOL_VERSION, type: 'leave' })), { binary: true })).code, 'invalid_message');
    });
    await t.test('accepts a valid protocol envelope but explicitly refuses gameplay', async () => {
      const join = { v: PROTOCOL_VERSION, type: 'join', name: 'Real local test' };
      assert.deepEqual(parseClientMessage(JSON.stringify(join)), join);
      const response = await exchange(JSON.stringify(join));
      assert.equal(response.code, 'server_incomplete');
      assert.match(response.message, /incomplete/i);
    });
    await t.test('rejects oversized WebSocket messages', async () => {
      const ws = await open(), closed = once(ws, 'close');
      ws.send('x'.repeat(8193));
      const [code] = await closed;
      assert.equal(code, 1009);
    });
  } finally {
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
