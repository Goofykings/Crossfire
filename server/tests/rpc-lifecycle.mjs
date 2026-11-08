import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { testRoom } from './test-rpc.mjs';

test('test RPC: awaited data, native result disposal, real errors and restart lifetime', { timeout: 30000 }, async () => {
  const messages = [];
  class DiagnosticLog extends Log {
    logWithLevel(level, message) { messages.push(String(message)); super.logWithLevel(level, message); }
  }
  const persistence = fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/rpc-lifecycle-', import.meta.url)));
  const options = convertV4MiniflareOptions({ name: 'rpc-lifecycle',
    modules: [{ type: 'ESModule', path: fileURLToPath(new URL('runtime-fixture.mjs', import.meta.url)) },
      { type: 'ESModule', path: fileURLToPath(new URL('../dist/index.js', import.meta.url)) }],
    compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0, resourcePersistencePath: persistence,
    durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: 'http://localhost:5173', MATCH_MODE: 'ffa' }, log: new DiagnosticLog(LogLevel.WARN),
  });
  let mf = new Miniflare(options), room = testRoom(mf);
  try {
    await mf.ready;
    const response = await mf.dispatchFetch('http://test.invalid/__crossfire_test_rpc', {
      method: 'POST', body: JSON.stringify({ room: 'public-main', method: 'snapshotForTest', args: [] }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Test-Rpc-Disposable'), 'true', 'actual workerd object result has a native disposer');
    const snapshot = (await response.json()).value;
    assert.equal(snapshot.room, 'public-main'); assert.deepEqual(snapshot.players, []);
    for (let i = 0; i < 100; i++) {
      const state = await room.snapshotForTest();
      assert.equal(state.roundId, snapshot.roundId); assert.deepEqual(state.players, []);
    }
    await assert.rejects(room.placeForCombatTest('missing-real-session', [0, 0, 0]), {
      name: 'Error', message: 'Test RPC public-main.placeForCombatTest: Requires a real, server-spawned WebSocket session',
    });
    await assert.rejects(room.persist(), /Invalid test RPC command/);
    const next = await room.advanceMapForTest();
    room[Symbol.dispose](); room[Symbol.dispose]();
    await assert.rejects(room.snapshotForTest(), /handle disposed/);
    await mf.dispose(); mf = new Miniflare(options); room = testRoom(mf);
    await mf.ready;
    assert.equal((await room.snapshotForTest()).roundId, next.roundId, 'fresh handle reads the persisted real round after restart');
  } finally {
    room[Symbol.dispose](); await mf.dispose();
    assert.ok(persistence.startsWith(fileURLToPath(new URL('../.wrangler/rpc-lifecycle-', import.meta.url))), 'cleanup stays inside the test persistence directory');
    fs.rmSync(persistence, { recursive: true, force: true });
  }
  assert.deepEqual(messages.filter(m => /RPC.*(?:not disposed|not.*disposed properly)/i.test(m)), [], 'RPC disposal warnings must remain absent, not suppressed');
});
