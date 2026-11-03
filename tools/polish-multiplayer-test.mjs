/** Two real browser sessions against the actual local Worker, with cosmetic motion enabled. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/';
const out = 'test-results/polish-multiplayer'; fs.mkdirSync(out, { recursive: true });
const check = (v, label) => { assert.ok(v, label); console.log(`PASS ${label}`); };
const until = async (fn, label) => {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await delay(50); }
  throw new Error(`Timed out: ${label}`);
};
const state = (p) => p.evaluate(() => window.__crossfire.network());
const me = (s) => s.snapshot.players.find((p) => p.id === s.selfId);
const hold = (p, key, value) => p.evaluate((key, value) => window.__crossfire.hold(key, value), key, value);
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'polish-multiplayer',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/polish-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR) }));
let browser;
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest();
  while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000,
    protocolTimeout: 240000, defaultViewport: { width: 1100, height: 720 },
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [], errors = [];
  for (const name of ['Polish Alpha', 'Polish Bravo']) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page);
    await page.evaluateOnNewDocument((backend) => {
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols); }
      };
      const fetch = window.fetch;
      window.fetch = (input, init) => fetch(['/presence','/profile'].includes(new URL(String(input), location.href).pathname) ? new URL(new URL(String(input),location.href).pathname, backend) : input, init);
    }, backend);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=.6`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
      || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    check(!await page.$('#error.visible'), `${name} connects to the local Worker`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
    page.playerId = (await state(page)).selfId;
  }
  const [a, b] = pages, arena = await room.directionalArenaForTest();
  check(a.playerId !== b.playerId, 'two real independent player sessions');
  await room.placeForCombatTest(a.playerId, arena.center, 0);
  await room.placeForCombatTest(b.playerId, arena.observer, 0);
  await delay(500);
  const target = me(await state(b)).motion.position;
  await a.evaluate((target) => window.__crossfire.aimAt(target.x, target.y + 1, target.z), target);
  await hold(a, 'aim', true); await delay(500);
  const before = await a.evaluate(() => window.__crossfire.weapon());
  await hold(a, 'fire', true); await delay(40); await hold(a, 'fire', false);
  await until(async () => me(await state(b)).health < 100, 'server-confirmed ADS hit');
  const shot = await a.evaluate(() => window.__crossfire.weapon());
  check(shot.view.motion.shots - before.view.motion.shots === before.ammo - shot.ammo,
    'multiplayer firing drives one whole-weapon recoil impulse per shot');
  const victimHealth = me(await state(b)).health;
  check(victimHealth > 0 && victimHealth < 100
    && (await state(a)).snapshot.players.find((p) => p.id === b.playerId).health === victimHealth,
  'both browsers agree on real authoritative damage with cosmetic motion enabled');
  await hold(a, 'aim', false);
  const start = me(await state(a)).motion.position;
  await hold(a, 'forward', true); await delay(400); await hold(a, 'forward', false); await delay(400);
  const moved = (await state(b)).snapshot.players.find((p) => p.id === a.playerId).motion.position;
  check(Math.hypot(moved.x - start.x, moved.z - start.z) > .3, 'movement is synchronized to the other browser');
  await until(async () => (await state(b)).rendered.some((p) => p.id === a.playerId), 'remote body');
  const saved = me(await state(a));
  await a.evaluate(() => window.__crossfire.networkReconnect());
  await until(async () => (await state(a)).state === 'connected'
    && (await state(a)).selfId === a.playerId && me(await state(a)).alive, 'authenticated reconnect');
  await until(async () => (await state(b)).rendered.filter((p) => p.id === a.playerId).length === 1, 'one remote after reconnect');
  const resumed = me(await state(a));
  check(resumed.life === saved.life && resumed.weapon === saved.weapon && resumed.health === saved.health
    && resumed.combat.gun.ammo === saved.combat.gun.ammo, 'reconnect preserves life, equipped weapon, ammunition and health');
  check(errors.length === 0, 'no browser exceptions in either multiplayer session');
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ victimHealth, start, moved, saved, resumed, errors }, null, 2));
} finally { await browser?.close(); await fixture.dispose(); }
