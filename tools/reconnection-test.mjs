/** Two real browsers, production frontend and isolated Worker/SQLite/TCP sockets.
 * Delays actual incoming packets; never supplies fabricated protocol/player data.
 * Run after both builds, with tools/serve-dist.mjs serving --url below.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const arg = process.argv.indexOf('--url');
const base = arg < 0 ? 'http://127.0.0.1:4198/crossfire/' : process.argv[arg + 1];
const durationAt = process.argv.indexOf('--seconds');
const soakMs = durationAt < 0 ? 61000 : Number(process.argv[durationAt + 1]) * 1000;
const outAt = process.argv.indexOf('--out');
const out = outAt < 0 ? 'test-results/reconnection' : process.argv[outAt + 1];
fs.mkdirSync(out, { recursive: true });
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS ${message}`); };
async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
const state = (page) => page.evaluate(() => window.__crossfire.network());
const me = (s) => s.snapshot.players.find((p) => p.id === s.selfId);
const persistent = (s) => {
  const p = me(s);
  return { id: p.id, life: p.life, health: p.health, alive: p.alive, team: p.team, weapon: p.weapon,
    ammo: p.combat.gun.ammo, kills: p.kills, deaths: p.deaths, round: s.snapshot.roundId,
    map: s.snapshot.mapId, mode: s.snapshot.match.mode, endsAt: s.snapshot.match.endsAt, scores: s.snapshot.match.teamScores };
};
const errors = [], debugLogs = [], pages = [], samples = [];
let stableDurationMs = 0;
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'reconnection-verification',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/reconnection-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'teams' }, log: new Log(LogLevel.ERROR),
}));
let browser;
try {
  const backend = (await fixture.ready).href;
  const ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest();
  while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
    defaultViewport: { width: 800, height: 600 }, protocolTimeout: 240000,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  for (const name of ['Reconnect Alpha', 'Reconnect Bravo']) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page);
    await page.evaluateOnNewDocument((backend) => {
      // Bound rendering cost in this networking test. Actual elapsed-time physics,
      // transport timers, WebSockets and protocol validation are unchanged.
      const nativeFrame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
      const pendingFrames = new Map(); let frameId = 0;
      window.requestAnimationFrame = (callback) => {
        const id = ++frameId, pending = { timer: 0, frame: 0 };
        pending.timer = setTimeout(() => { pending.frame = nativeFrame((time) => { pendingFrames.delete(id); callback(time); }); }, 1000 / 30);
        pendingFrames.set(id, pending); return id;
      };
      window.cancelAnimationFrame = (id) => {
        const pending = pendingFrames.get(id); if (!pending) return;
        clearTimeout(pending.timer); cancelFrame(pending.frame); pendingFrames.delete(id);
      };
      localStorage.setItem('crossfire.pending-weapon', 'sniper');
      const Socket = window.WebSocket;
      window.__wireDelay = 0; window.__wire = []; window.__sockets = [];
      window.WebSocket = class extends Socket {
        constructor(url, protocols) {
          super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols);
          window.__sockets.push(this);
          this.addEventListener('open', () => window.__wire.push({ at: Date.now(), event: 'open' }));
          this.addEventListener('close', (e) => window.__wire.push({ at: Date.now(), event: 'close', code: e.code, reason: e.reason }));
          this.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'error') window.__wire.push({ at: Date.now(), event: 'server_error', code: message.code });
            if (!window.__wireDelay) return;
            event.stopImmediatePropagation();
            setTimeout(() => { if (this.readyState === Socket.OPEN) this.onmessage?.(event); }, window.__wireDelay);
          });
        }
      };
      const actualFetch = window.fetch;
      window.fetch = (input, init) => actualFetch(new URL(String(input), location.href).pathname === '/presence'
        ? new URL('/presence', backend) : input, init);
    }, backend);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(`${r.status()} ${r.url()}`); });
    page.on('console', (m) => { if (m.text().includes('[crossfire network]')) debugLogs.push(m.text()); });
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=0.5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    console.log(`${name}: guest profile ready`);
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
      || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    const loadingError = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : '');
    check(!loadingError, `${name}: no loading error (${loadingError})`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 30000 });
    page.id = (await state(page)).selfId;
    console.log(`${name}: real server-approved life ready`);
  }
  const [a, b] = pages;
  await until(async () => (await state(a)).snapshot.players.length === 2 && (await state(b)).rendered.length === 1, 'two clients and remote actor');
  const arena = await room.directionalArenaForTest();
  const place = async (p, pos, heading = 0, pitch = 0) => {
    await room.placeForCombatTest(p.id, pos, heading);
    await p.evaluate((h, pitch) => window.__crossfire.look(h, pitch), heading, pitch);
    await delay(400);
  };
  await place(a, arena.center, 0, -15);
  await place(b, arena.sources.front, 180);
  await a.evaluate(() => window.__crossfire.hold('aim', true));
  await b.evaluate(() => window.__crossfire.hold('aim', true));
  await delay(800);
  // Earn real non-default health and ammunition before testing session continuity.
  const beforeAmmo = me(await state(a)).combat.gun.ammo;
  await a.evaluate(() => {
    document.querySelector('#game').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  });
  await delay(120);
  await a.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })));
  await until(async () => me(await state(b)).health === 25, 'actual server-authoritative sniper body hit');
  check(me(await state(a)).combat.gun.ammo === beforeAmmo - 1, 'actual shot spent ammunition');

  const stableStart = await Promise.all(pages.map(state));
  for (const p of pages) await p.evaluate(() => { window.__wireDelay = 250; });
  const started = Date.now();
  for (let i = 0; Date.now() - started < soakMs; i++) {
    await delay(1000);
    const pair = await Promise.all(pages.map(state));
    samples.push({ at: Date.now(), clients: pair.map((s) => ({ id: s.selfId, ...s.diagnostics })) });
    for (let j = 0; j < 2; j++) {
      check(pair[j].state === 'connected' && pair[j].diagnostics.opens === stableStart[j].diagnostics.opens
        && pair[j].diagnostics.closes === stableStart[j].diagnostics.closes, `stable ${j + 1}: second ${i + 1}`);
      assert.equal(pair[j].selfId, pages[j].id);
      assert.equal(pair[j].snapshot.players.length, 2);
      assert.equal(await pages[j].evaluate(() => /reconnect/i.test(document.querySelector('.toast.visible')?.textContent ?? '')), false,
        'no false reconnect warning in stable UI');
    }
  }
  check(Date.now() - started >= soakMs, `two actual browser clients stayed connected over ${soakMs / 1000} seconds with 250ms ACK delay`);
  stableDurationMs = Date.now() - started;
  const stableEnd = await Promise.all(pages.map(state));
  for (let j = 0; j < 2; j++) {
    // Verify ongoing real input processing at the transport cadence rather than
    // imposing an unrelated rendering/FPS benchmark on this cohosted test.
    check(me(stableEnd[j]).ack - me(stableStart[j]).ack > (soakMs >= 60000 ? soakMs / 1000 * 20 : 12)
      && samples.every((s) => s.at - s.clients[j].lastAckAt < 3000), `client ${j + 1}: continuous authoritative input processing`);
  }
  check(debugLogs.length === 0, 'network console logging disabled by default');

  const startPos = me(await state(a)).motion.position;
  await a.keyboard.down('w');
  try {
    await until(async () => {
      const pos = me(await state(a)).motion.position;
      return Math.hypot(pos.x - startPos.x, pos.z - startPos.z) > .65;
    }, 'actual movement reaches server under latency');
  } finally { await a.keyboard.up('w'); }
  await until(async () => Math.hypot(...Object.values(me(await state(a)).motion.velocity)) < .01, 'released movement settles');
  const moved = me(await state(a)).motion.position;
  check(Math.hypot(moved.x - startPos.x, moved.z - startPos.z) > .5, 'real keyboard movement synchronized');
  await until(async () => {
    const peer = (await state(b)).rendered.find((p) => p.id === a.id);
    return peer && Math.hypot(peer.x - moved.x, peer.z - moved.z) < .2;
  }, 'remote rendered position agrees with settled authoritative movement');
  check(true, 'remote actor follows actual synchronized movement');
  await a.evaluate(() => window.__crossfire.look(35, 10));
  const peer = await until(async () => {
    const p = (await state(b)).snapshot.players.find((p) => p.id === a.id);
    return p && Math.abs(p.motion.yaw + 35 * Math.PI / 180) < .02 && Math.abs(p.motion.pitch - 10 * Math.PI / 180) < .02 && p;
  }, 'delayed authoritative orientation');
  check(Math.abs(peer.motion.yaw + 35 * Math.PI / 180) < .02 && Math.abs(peer.motion.pitch - 10 * Math.PI / 180) < .02,
    'peer receives authoritative orientation');
  check((await state(b)).rendered.filter((p) => p.id === a.id).length === 1, 'peer has exactly one moving actor');

  for (const p of pages) {
    const before = await state(p), saved = persistent(before);
    await room.dropSocketForTest(p.id);
    await until(async () => (await state(p)).diagnostics.closes > before.diagnostics.closes, 'actual server close');
    await until(async () => { const s = await state(p); return s.state === 'connected' && s.diagnostics.opens > before.diagnostics.opens; }, 'authenticated reconnect');
    const after = await state(p);
    assert.deepEqual(persistent(after), saved);
    check(after.diagnostics.events.some((e) => e.event === 'close' && e.detail.code === 1012)
      && after.diagnostics.events.some((e) => e.event === 'state' && e.detail.to === 'reconnecting'), 'genuine server close is reported and reconnects');
    const counts = await p.evaluate(() => ({ active: window.__sockets.filter((s) => s.readyState === WebSocket.OPEN).length,
      connecting: window.__sockets.filter((s) => s.readyState === WebSocket.CONNECTING).length }));
    check(counts.active === 1 && counts.connecting === 0, 'exactly one active connection after resume');
    check(after.snapshot.players.length === 2 && new Set(after.snapshot.players.map((p) => p.id)).size === 2,
      'no duplicate players; health/ammo/life/team/scores/round deadline preserved');
  }
  await until(async () => pages.every((p) => p.id) && (await state(a)).rendered.length === 1 && (await state(b)).rendered.length === 1, 'remote actors restored');
  for (const p of pages) await p.evaluate(() => window.__crossfire.networkLeave());
  const left = await Promise.all(pages.map((p) => p.evaluate(() => window.__wire.filter((e) => e.event === 'open').length)));
  await delay(5000);
  for (let j = 0; j < pages.length; j++) check(await pages[j].evaluate((opens) =>
    window.__wire.filter((e) => e.event === 'open').length === opens && window.__sockets.every((s) => s.readyState === WebSocket.CLOSED), left[j]), 'Leave closes socket and cancels reconnect');
  check((await (await fetch(new URL('/presence', backend), { headers: { Origin: new URL(base).origin } })).json()).online === 0, 'Worker removed both intentional leavers');
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ stableDurationMs, samples, errors, debugLogs,
    final: await Promise.all(pages.map(async (p) => { try { return { network: await state(p), wire: await p.evaluate(() => window.__wire) }; } catch { return null; } })) }, null, 2));
  await browser?.close(); await fixture.dispose();
}
