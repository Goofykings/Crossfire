/** Real player-to-player combat through TCP WebSockets and the actual Worker.
 * The test-only RPC positions real spawned sessions; it never applies damage or assigns scores.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import WebSocket from 'ws';

for (const mode of ['ffa', 'teams']) test(`Authoritative player combat: ${mode}`, { timeout: 90000 }, async (t) => {
  const origin = 'http://localhost:5173';
  const mf = new Miniflare(convertV4MiniflareOptions({ name: `combat-${mode}`,
    modules: [{ type: 'ESModule', path: fileURLToPath(new URL('runtime-fixture.mjs', import.meta.url)) },
      { type: 'ESModule', path: fileURLToPath(new URL('../dist/index.js', import.meta.url)) }],
    compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
    resourcePersistencePath: fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/combat-', import.meta.url))),
    durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: origin, MATCH_MODE: mode }, log: new Log(LogLevel.ERROR),
  }));
  const base = (await mf.ready).href;
  const ns = await mf.getDurableObjectNamespace('ROOM');
  const stub = ns.get(ns.idFromName('public-main'));
  const clients = [];
  t.afterEach(async () => {
    for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.send({ type: 'leave' });
    await delay(80);
  });
  const snapshot = await stub.advanceMapForTest();
  for (let i = 0, current = snapshot; current.mapId !== 'european-town' && i < 4; i++) current = await stub.advanceMapForTest();
  async function wait(c, predicate, mark = 0) {
    const until = Date.now() + 6000;
    while (Date.now() < until) {
      const m = c.messages.slice(mark).find(predicate);
      if (m) return m;
      await delay(10);
    }
    throw new Error(`Timed out; ${JSON.stringify(c.messages.slice(-4).map((m) => ({ type: m.type, code: m.code })))}`);
  }
  async function open(weapon = 'rifle', resumeToken) {
    const ws = new WebSocket(new URL('/ws', base).href.replace('http:', 'ws:'), { origin });
    const c = { ws, messages: [], snapshot: null, id: '', token: '', seq: 0 };
    clients.push(c);
    ws.on('message', (raw) => { const m = JSON.parse(String(raw)); c.messages.push(m); if (m.snapshot) c.snapshot = m.snapshot; });
    ws.on('error', () => {});
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    c.send = (m) => ws.send(JSON.stringify({ v: 5, ...m }));
    c.send({ type: 'join', name: `Combat ${clients.length}`, ...(resumeToken ? { resumeToken } : {}) });
    const welcome = await wait(c, (m) => m.type === 'welcome');
    c.id = welcome.selfId; c.token = welcome.resumeToken;
    c.seq = c.snapshot.players.find((p) => p.id === c.id).ack;
    c.heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) c.send({ type: 'ping', at: Date.now() }); }, 500);
    ws.once('close', () => clearInterval(c.heartbeat));
    if (!me(c).alive) await spawn(c, weapon);
    assert.equal(c.snapshot.match.mode, mode);
    return c;
  }
  const me = (c) => c.snapshot.players.find((p) => p.id === c.id);
  async function spawn(c, weapon) {
    const mark = c.messages.length, requestId = crypto.randomUUID();
    c.send({ type: 'spawn', weapon, requestId, roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion });
    await wait(c, (m) => m.type === 'spawned' && m.requestId === requestId, mark);
    assert.equal(me(c).health, 100);
  }
  async function leave(c) { if (c.ws.readyState === WebSocket.OPEN) c.send({ type: 'leave' }); await delay(60); }
  async function place(a, b, pair = [[-3, 0, 2], [-3, 0, -2]]) {
    await stub.placeForCombatTest(a.id, pair[0]);
    await stub.placeForCombatTest(b.id, pair[1]);
    a.position = pair[0]; b.position = pair[1];
  }
  function frame(c, target, y = .9, trigger = false, reload = false) {
    const p = c.position, q = target.position;
    const dx = q[0] - p[0], dz = q[2] - p[2];
    return { seq: ++c.seq, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(q[1] + y - p[1] - 1.64, Math.hypot(dx, dz)),
      intent: { x: 0, z: 0, slide: false, aim: true, jumpPressed: false }, combat: { trigger, reload } };
  }
  function send(c, frames) { c.send({ type: 'input', roundId: c.snapshot.roundId, mapVersion: c.snapshot.mapVersion, frames }); }
  async function aim(c, target, y = .9, ms = 550) {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) { send(c, Array.from({ length: 6 }, () => frame(c, target, y))); await delay(50); }
    await wait(c, (m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === c.id && p.ack >= c.seq));
    assert.ok(me(c).combat.gun.ads > .98);
  }
  async function shot(a, b, y = .9) {
    const mark = a.messages.length, otherMark = b.messages.length;
    send(a, [frame(a, b, y, true), ...Array.from({ length: 5 }, () => frame(a, b, y))]);
    const result = (await wait(a, (m) => m.type === 'shot' && m.shot.shooterId === a.id, mark)).shot;
    assert.deepEqual((await wait(b, (m) => m.type === 'shot' && m.shot.id === result.id, otherMark)).shot, result);
    return result;
  }
  try {
    for (const [weapon, expected] of [['rifle', 25], ['smg', 11], ['sniper', 75], ['shotgun', 100]]) {
      await t.test(`${weapon}: actual opponents lose weapon-specific health on both clients`, async () => {
        const a = await open(weapon), b = await open();
        if (mode === 'teams') assert.notEqual(me(a).team, me(b).team);
        await place(a, b); await aim(a, b);
        const result = await shot(a, b);
        assert.equal(result.hits.length, 1); assert.equal(result.hits[0].id, b.id);
        assert.equal(result.hits[0].amount, expected); assert.equal(result.hits[0].head, false);
        for (const c of [a, b]) await wait(c, (m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === b.id && p.life === 1 && p.health === 100 - expected));
        if (weapon === 'shotgun') { assert.equal(result.hits[0].killed, true); assert.equal(me(a).kills, 1); assert.equal(me(b).deaths, 1); }
        await leave(a); await leave(b);
      });
    }
    await t.test('1.5x headshots, lethal sniper, authoritative scores, respawn and health on resume', async () => {
      const a = await open(), b = await open();
      await place(a, b); await aim(a, b, 1.6);
      const hit = await shot(a, b, 1.6);
      assert.equal(hit.hits[0].amount, 37.5); assert.equal(hit.hits[0].head, true);
      for (const c of [a, b]) await wait(c, (m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === b.id && p.health === 62.5));
      b.ws.close(); await delay(100);
      const resumed = await open('rifle', b.token);
      assert.equal(resumed.id, b.id); assert.equal(me(resumed).health, 62.5);
      await leave(a); await leave(resumed);

      const sniper = await open('sniper'), victim = await open();
      await place(sniper, victim); await aim(sniper, victim, 1.6);
      const mark = victim.messages.length;
      const teamBefore = mode === 'teams' ? sniper.snapshot.match.teamScores[me(sniper).team] : null;
      const killed = await shot(sniper, victim, 1.6);
      assert.equal(killed.hits[0].health, 0); assert.equal(killed.hits[0].killed, true); assert.equal(killed.hits[0].head, true);
      const elimination = await wait(victim, (m) => m.type === 'elimination', mark);
      assert.equal(elimination.elimination.killerId, sniper.id);
      await wait(victim, (m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === victim.id && p.deaths === 1));
      assert.equal(me(sniper).kills, 1); assert.equal(me(victim).deaths, 1); assert.equal(me(victim).alive, false);
      if (mode === 'teams') assert.equal(sniper.snapshot.match.teamScores[me(sniper).team], teamBefore + 1);
      const invalid = victim.messages.length;
      send(victim, [frame(victim, sniper, 1.6, true)]);
      assert.equal((await wait(victim, (m) => m.type === 'error', invalid)).code, 'not_spawned');
      const life = me(victim).life;
      await spawn(victim, 'smg'); assert.equal(me(victim).life, life + 1); assert.equal(me(victim).deaths, 1);
      assert.equal(me(victim).combat.gun.ammo, 32);
      await leave(sniper); await leave(victim);
    });
    await t.test('actual map walls block player damage', async () => {
      const a = await open('sniper'), b = await open();
      const arena = await stub.wallArenaForTest();
      assert.ok(arena.wall.startsWith('wall:'));
      await place(a, b, arena.pair); await aim(a, b);
      assert.deepEqual((await shot(a, b)).hits, []);
      assert.equal(me(b).health, 100);
      await leave(a); await leave(b);
    });
    await t.test('fire rate, ammunition, replay rejection and reload timing remain server-controlled', async () => {
      const a = await open(), b = await open();
      await place(a, b, (await stub.wallArenaForTest()).pair); await aim(a, b);
      const mark = a.messages.length, firingStarted = Date.now();
      for (let i = 0; i < 20; i++) {
        send(a, Array.from({ length: 6 }, () => frame(a, b, .9, true)));
        await delay(50);
      }
      send(a, Array.from({ length: 6 }, () => frame(a, b)));
      await wait(a, (m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === a.id && p.ack === a.seq), mark);
      const shots = a.messages.slice(mark).filter((m) => m.type === 'shot' && m.shot.shooterId === a.id);
      const elapsed = (Date.now() - firingStarted) / 1000;
      assert.ok(shots.length >= 9 && shots.length <= Math.ceil(elapsed * 700 / 60) + 1,
        `700 RPM: ${shots.length} shots over ${elapsed.toFixed(3)} real seconds (scheduler delays included)`);
      assert.ok(shots.every((m) => !m.shot.hits.length));
      assert.equal(me(a).combat.gun.ammo, 30 - shots.length); assert.equal(me(b).health, 100);
      const replayMark = a.messages.length;
      const replay = frame(a, b, .9, true); replay.seq = 1;
      send(a, [replay]);
      assert.equal((await wait(a, (m) => m.type === 'error', replayMark)).code, 'stale_input');
      await delay(150);
      assert.equal(a.messages.slice(replayMark).filter((m) => m.type === 'shot').length, 0);
      const reloadMark = a.messages.length, started = Date.now();
      send(a, [frame(a, b, .9, false, true)]);
      await wait(a, (m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === a.id && p.combat.gun.action === 'reload'), reloadMark);
      send(a, [frame(a, b)]);
      await wait(a, (m) => m.type === 'snapshot' && m.snapshot.players.some((p) => p.id === a.id && p.combat.gun.ammo === 30 && p.combat.gun.action === 'idle'), reloadMark);
      assert.ok(Date.now() - started >= 1950, 'tactical reload cannot be accelerated by client input');
      await leave(a); await leave(b);
    });
    if (mode === 'teams') await t.test('same-team hits are rejected; opponents and totals use authoritative relationships', async () => {
      const a = await open('sniper'), opponent = await open(), friend = await open();
      assert.equal(me(a).team, me(friend).team); assert.notEqual(me(a).team, me(opponent).team);
      await place(a, friend); await aim(a, friend, 1.6);
      assert.deepEqual((await shot(a, friend, 1.6)).hits, []);
      assert.equal(me(friend).health, 100); assert.equal(me(a).kills, 0);
      await leave(a); await leave(opponent); await leave(friend);
    });
    await t.test('forged shots, targets, damage, origins, cooldowns and impossible input are rejected', async () => {
      const target = await open();
      for (const extra of [{ damage: 999 }, { targetId: target.id }, { origin: { x: 0, y: 0, z: 0 } }, { cooldown: 0 }, { trigger: 'yes' }]) {
        const bad = await open('sniper'); await place(bad, target);
        const f = frame(bad, target, 1.6, true); f.combat = { ...f.combat, ...extra };
        const mark = bad.messages.length; send(bad, [f]);
        assert.equal((await wait(bad, (m) => m.type === 'error', mark)).code, 'invalid_message');
        assert.equal(me(target).health, 100);
      }
      await leave(target);
    });
  } finally {
    for (const c of clients) { clearInterval(c.heartbeat); c.ws.terminate(); }
    stub[Symbol.dispose]?.(); await mf.dispose();
  }
});
