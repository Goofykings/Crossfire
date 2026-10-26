import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(root, '.wrangler'), { recursive: true });
const persistence = fs.mkdtempSync(path.join(root, '.wrangler', 'test-'));
const origin = 'http://localhost:5173';
const options = convertV4MiniflareOptions({
  name: 'crossfire-test',
  modules: [{ type: 'ESModule', path: path.join(root, 'tests/runtime-fixture.mjs') },
    { type: 'ESModule', path: path.join(root, 'dist/index.js') }], compatibilityDate: '2026-10-25',
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  resourcePersistencePath: persistence, host: '127.0.0.1', port: 0,
  bindings: { ALLOWED_ORIGINS: origin, SESSION_GRACE_MS: '3000', HEARTBEAT_TIMEOUT_MS: '3000' },
  log: new Log(LogLevel.ERROR),
});

test('Public room: real Workers runtime and real WebSocket clients', { timeout: 60000 }, async (t) => {
  let mf = new Miniflare(options);
  let base = (await mf.ready).href;
  const clients = [];
  async function open({ resumeToken, name = 'Real test client', heartbeat = true, join = true, spawn = true } = {}) {
    const ws = new WebSocket(new URL('/ws', base).href.replace('http:', 'ws:'), { origin });
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('error', () => {});
    const client = {
      ws, messages, welcome: null,
      send: (m) => ws.send(JSON.stringify({ v: 2, ...m })),
      async wait(predicate, from = 0) {
        const until = Date.now() + 5000;
        while (Date.now() < until) {
          const found = messages.slice(from).find(predicate);
          if (found) return found;
          await delay(10);
        }
        throw new Error(`Timed out waiting for server message; socket=${ws.readyState}; recent=${JSON.stringify(messages.slice(-3).map((m) => ({ type: m.type, code: m.code, ids: m.snapshot?.players.map((p) => p.id) })))}`);
      },
    };
    clients.push(client);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const timer = heartbeat ? setInterval(() => { if (ws.readyState === WebSocket.OPEN) client.send({ type: 'ping', at: Date.now() }); }, 200) : null;
    ws.once('close', () => { if (timer) clearInterval(timer); });
    if (join) {
      client.send({ type: 'join', name, ...(resumeToken ? { resumeToken } : {}) });
      client.welcome = await client.wait((m) => m.type === 'welcome' || m.type === 'error');
      if (spawn && client.welcome.type === 'welcome' && !client.welcome.snapshot.players.find((p) => p.id === client.welcome.selfId).alive) {
        client.send({ type: 'spawn', mapVersion: client.welcome.snapshot.mapVersion, weapon: 'rifle', requestId: crypto.randomUUID() });
        const approved = await client.wait((m) => m.type === 'spawned' || m.type === 'error');
        assert.equal(approved.type, 'spawned', approved.message);
        client.welcome = { ...client.welcome, snapshot: approved.snapshot };
      }
    }
    return client;
  }
  const frame = (seq, yaw = 0) => ({ seq, yaw, pitch: 0.25,
    intent: { x: 0, z: 1, sprint: false, crouch: false, aim: false, jumpPressed: false } });
  let a, b, resumable;
  try {
    await t.test('health, route and origin validation', async () => {
      const health = await (await fetch(new URL('/health', base))).json();
      assert.equal(health.room, 'public-main');
      assert.equal(health.ok, true);
      assert.equal((await fetch(new URL('/ws', base), { headers: { Origin: origin } })).status, 426);
      assert.equal((await fetch(new URL('/unknown', base))).status, 404);
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(new URL('/ws', base).href.replace('http:', 'ws:'), { origin: 'https://untrusted.example' });
        ws.once('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 403); res.resume(); ws.terminate(); resolve(); });
        ws.once('open', () => reject(new Error('Unauthorized origin was accepted')));
        ws.on('error', () => {});
      });
    });
    await t.test('two clients join the same room with unique real identities', async () => {
      a = await open({ name: '<Alice>' }); b = await open({ name: 'Bob' });
      assert.equal(a.welcome.snapshot.room, b.welcome.snapshot.room);
      assert.notEqual(a.welcome.selfId, b.welcome.selfId);
      const shared = await a.wait((m) => m.type === 'snapshot' && m.snapshot.players.length === 2);
      assert.deepEqual(new Set(shared.snapshot.players.map((p) => p.id)), new Set([a.welcome.selfId, b.welcome.selfId]));
      assert.equal(shared.snapshot.players.find((p) => p.id === a.welcome.selfId).name, 'Alice');
      assert.equal('resumeToken' in shared.snapshot.players[0], false);
      const [pa, pb] = shared.snapshot.players.map((p) => p.motion.position);
      assert.ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) > 0.8);
    });
    await t.test('HTTP presence counts menu sessions without creating players or leaking credentials', async () => {
      const c = await open({ spawn: false });
      const me = c.welcome.snapshot.players.find((p) => p.id === c.welcome.selfId);
      assert.equal(me.alive, false); assert.equal(me.weapon, null); assert.equal(me.life, 0);
      assert.equal(me.kills, 0); assert.equal(me.deaths, 0);
      for (let i = 0; i < 3; i++) {
        const res = await fetch(new URL('/presence', base), { headers: { Origin: origin } });
        assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
        assert.equal(res.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await res.json(), { room: 'public-main', online: 3 });
      }
      assert.equal((await fetch(new URL('/presence', base), { headers: { Origin: 'https://untrusted.example' } })).status, 403);
      const mark = c.messages.length;
      c.send({ type: 'input', mapVersion: c.welcome.snapshot.mapVersion, frames: [frame(1)] });
      assert.equal((await c.wait((m) => m.type === 'error', mark)).code, 'not_spawned');
      c.send({ type: 'leave' }); await delay(100);
      assert.equal((await (await fetch(new URL('/presence', base))).json()).online, 2);
    });
    await t.test('spawn waits for approval and locks the server-owned weapon for this life', async () => {
      const c = await open({ spawn: false });
      const mark = c.messages.length;
      c.send({ type: 'spawn', mapVersion: c.welcome.snapshot.mapVersion, weapon: 'sniper', requestId: 'first-life' });
      const approved = await c.wait((m) => m.type === 'spawned', mark);
      const self = approved.snapshot.players.find((p) => p.id === c.welcome.selfId);
      assert.equal(approved.requestId, 'first-life'); assert.equal(self.alive, true);
      assert.equal(self.weapon, 'sniper'); assert.equal(self.life, 1);
      const m2 = c.messages.length;
      c.send({ type: 'spawn', mapVersion: c.welcome.snapshot.mapVersion, weapon: 'shotgun', requestId: 'cheat' });
      assert.equal((await c.wait((m) => m.type === 'error', m2)).code, 'already_spawned');
      c.ws.close(); await delay(100);
      const resumed = await open({ resumeToken: c.welcome.resumeToken, spawn: false });
      const same = resumed.welcome.snapshot.players.find((p) => p.id === c.welcome.selfId);
      assert.equal(same.weapon, 'sniper'); assert.equal(same.life, 1); assert.equal(same.alive, true);
      assert.equal((await (await fetch(new URL('/presence', base))).json()).online, 3);
      resumed.send({ type: 'leave' }); await delay(100);
    });
    await t.test('invalid loadouts, score injection and wrong map revisions cannot spawn', async () => {
      for (const payload of [{ weapon: 'smg' }, { weapon: 'rifle', kills: 99 }, { weapon: 'rifle', mapVersion: 'wrong' }]) {
        const c = await open({ spawn: false });
        c.send({ type: 'spawn', mapVersion: c.welcome.snapshot.mapVersion, requestId: 'bad', ...payload });
        const error = await c.wait((m) => m.type === 'error');
        assert.equal(error.code, payload.mapVersion ? 'map_mismatch' : 'invalid_message');
      }
    });
    await t.test('server simulates bounded movement and synchronizes orientation', async () => {
      const start = a.welcome.snapshot.players.find((p) => p.id === a.welcome.selfId).motion;
      a.send({ type: 'input', mapVersion: a.welcome.snapshot.mapVersion, frames: Array.from({ length: 12 }, (_, i) => frame(i + 1, start.yaw)) });
      const result = await b.wait((m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === a.welcome.selfId && p.ack === 12));
      const p = result.snapshot.players.find((p) => p.id === a.welcome.selfId);
      const d = Math.hypot(p.motion.position.x - start.position.x, p.motion.position.z - start.position.z);
      assert.ok(d > 0.1 && d < 0.6, `real movement ${d}m in 12 physics steps`);
      assert.equal(p.motion.yaw, start.yaw);
      assert.equal(p.motion.pitch, 0.25);
    });
    await t.test('replayed input is rejected without granting extra simulation', async () => {
      const mark = a.messages.length;
      a.send({ type: 'input', mapVersion: a.welcome.snapshot.mapVersion, frames: [frame(1)] });
      assert.equal((await a.wait((m) => m.type === 'error', mark)).code, 'stale_input');
      const snapshot = await a.wait((m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === a.welcome.selfId && p.ack === 12), mark);
      assert.equal(snapshot.snapshot.players.find((p) => p.id === a.welcome.selfId).ack, 12);
    });
    await t.test('disconnect removes the player; authenticated reconnect preserves identity/state', async () => {
      const mark = b.messages.length;
      a.ws.close();
      await b.wait((m) => m.type === 'left' && m.id === a.welcome.selfId, mark);
      const resumed = await open({ resumeToken: a.welcome.resumeToken });
      assert.equal(resumed.welcome.resumed, true);
      assert.equal(resumed.welcome.selfId, a.welcome.selfId);
      assert.equal(resumed.welcome.snapshot.players.find((p) => p.id === resumed.welcome.selfId).ack, 12);
      // Replacing a live socket must not let its late close remove the replacement.
      const replacement = await open({ resumeToken: resumed.welcome.resumeToken });
      assert.equal(replacement.welcome.selfId, a.welcome.selfId);
      const after = await replacement.wait((m) => m.type === 'snapshot' && m.snapshot.players.length === 2);
      assert.equal(after.snapshot.players.filter((p) => p.id === replacement.welcome.selfId).length, 1);
      a = replacement;
    });
    await t.test('forged coordinates and out-of-range input are rejected', async () => {
      for (const bad of [{ ...frame(1), position: { x: 9999, y: 0, z: 0 } }, { ...frame(1), intent: { ...frame(1).intent, x: 999 } }]) {
        const c = await open();
        c.send({ type: 'input', mapVersion: c.welcome.snapshot.mapVersion, frames: [bad] });
        assert.equal((await c.wait((m) => m.type === 'error')).code, 'invalid_message');
      }
    });
    await t.test('object eviction reconstructs active sockets and authoritative state', async () => {
      const id = a.welcome.selfId;
      await delay(300); // Let movement settle so no active physics timer prevents hibernation.
      await mf.unsafeEvictDurableObject('crossfire-test', 'PublicRoom', { name: 'public-main', webSockets: 'hibernate' });
      const mark = a.messages.length;
      a.send({ type: 'ping', at: Date.now() });
      const snapshot = await a.wait((m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === id), mark);
      assert.equal(snapshot.snapshot.players.find((p) => p.id === id).ack, 12);
      assert.ok(snapshot.snapshot.players.some((p) => p.id === b.welcome.selfId), 'both active clients survive eviction');
    });
    await t.test('burst input cannot create extra time; the bounded queue rejects flooding', async () => {
      const c = await open();
      for (let j = 0; j < 5; j++) if (c.ws.readyState === WebSocket.OPEN) c.send({ type: 'input', mapVersion: c.welcome.snapshot.mapVersion,
        frames: Array.from({ length: 12 }, (_, i) => frame(j * 12 + i + 1)) });
      assert.equal((await c.wait((m) => m.type === 'error')).code, 'input_overflow');
    });
    await t.test('missing heartbeats close stale sockets and broadcast removal', async () => {
      const c = await open({ heartbeat: false });
      const mark = b.messages.length;
      await b.wait((m) => m.type === 'left' && m.id === c.welcome.selfId, mark);
      await delay(50);
      assert.equal(c.ws.readyState, WebSocket.CLOSED);
    });
    await t.test('explicit leave invalidates the resume credential', async () => {
      const saved = a.welcome.resumeToken;
      a.send({ type: 'leave' });
      await delay(100);
      const badResume = await open({ resumeToken: saved });
      assert.equal(badResume.welcome.type, 'error');
      assert.equal(badResume.welcome.code, 'resume_expired');
    });
    await t.test('durable session survives a complete local runtime reconstruction', async () => {
      resumable = b.welcome;
      b.ws.close();
      await delay(150);
      await mf.dispose();
      mf = new Miniflare(options);
      base = (await mf.ready).href;
      b = await open({ resumeToken: resumable.resumeToken });
      assert.equal(b.welcome.type, 'welcome');
      assert.equal(b.welcome.resumed, true);
      assert.equal(b.welcome.selfId, resumable.selfId);
      assert.equal(b.welcome.snapshot.players.length, 1);
    });
    await t.test('reconnect grace expires; expired players cannot be impersonated', async () => {
      const expired = b.welcome.resumeToken;
      b.ws.close();
      await delay(3300);
      const c = await open({ resumeToken: expired });
      assert.equal(c.welcome.code, 'resume_expired');
      const fresh = await open();
      assert.notEqual(fresh.welcome.selfId, resumable.selfId);
      assert.equal(fresh.welcome.snapshot.players.length, 1);
    });
    await t.test('server fall elimination removes the live body, preserves the session and permits a new loadout', async () => {
      const before = (await (await fetch(new URL('/presence', base))).json()).online;
      const c = await open();
      const id = c.welcome.selfId;
      const ns = await mf.getDurableObjectNamespace('ROOM');
      const mark = c.messages.length;
      const stub = ns.get(ns.idFromName('public-main'));
      try { await stub.fallForTest(id); }
      finally { stub[Symbol.dispose]?.(); }
      const dead = await c.wait((m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === id && !p.alive), mark);
      const state = dead.snapshot.players.find((p) => p.id === id);
      assert.equal(state.deaths, 1); assert.equal(state.kills, 0); assert.equal(state.life, 1);
      assert.equal((await (await fetch(new URL('/presence', base))).json()).online, before + 1);
      c.send({ type: 'spawn', weapon: 'shotgun', mapVersion: c.welcome.snapshot.mapVersion, requestId: 'second-life' });
      const second = await c.wait((m) => m.type === 'spawned' && m.requestId === 'second-life');
      const alive = second.snapshot.players.find((p) => p.id === id);
      assert.equal(alive.alive, true); assert.equal(alive.life, 2); assert.equal(alive.weapon, 'shotgun');
      assert.equal(alive.deaths, 1); assert.equal(alive.kills, 0);
      c.send({ type: 'leave' }); await delay(100);
    });
  } finally {
    for (const c of clients) c.ws.terminate();
    await mf.dispose();
  }
});
