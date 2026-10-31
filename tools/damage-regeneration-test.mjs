/** Real Worker, real shooter socket and production-browser victim/HUD.
 * Fixture RPC only places server-approved players; hits and health are real.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const at = process.argv.indexOf('--url'), base = at < 0 ? 'http://127.0.0.1:4198/crossfire/' : process.argv[at + 1];
const out = 'test-results/health-browser'; fs.mkdirSync(out, { recursive: true });
const results = [], errors = [];
const check = (ok, text) => { assert.ok(ok, text); console.log(`PASS ${text}`); };
async function until(fn, label, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const x = await fn(); if (x) return x; await delay(20); }
  throw new Error(`Timed out: ${label}`);
}
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'damage-regeneration-browser',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/health-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR),
}));
let browser, ws, heartbeat, page;
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest();
  while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, protocolTimeout: 240000,
    defaultViewport: { width: 800, height: 600 },
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.createBrowserContext(); page = await context.newPage();
  await page.evaluateOnNewDocument((backend) => {
    // Bound test rendering cost; production physics and transport use real elapsed time.
    const raf = requestAnimationFrame.bind(window), caf = cancelAnimationFrame.bind(window), pending = new Map(); let frame = 0;
    window.requestAnimationFrame = (cb) => {
      const id = ++frame, p = { timer: 0, frame: 0 };
      p.timer = setTimeout(() => { p.frame = raf((time) => { pending.delete(id); cb(time); }); }, 1000 / 30);
      pending.set(id, p); return id;
    };
    window.cancelAnimationFrame = (id) => { const p = pending.get(id); if (p) { clearTimeout(p.timer); caf(p.frame); pending.delete(id); } };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(url, protocols) {
        super(new URL('/ws', backend).href.replace('http:', 'ws:'), protocols);
        this.addEventListener('message', (e) => {
          const m = JSON.parse(e.data), c = window.__damageCase;
          const hit = m.shot?.hits.find((h) => h.id === window.__crossfire?.network().selfId);
          if (!c || !hit) return;
          c.hitAt = performance.now(); c.shots.push({ hit, at: c.hitAt });
          if (c.name === 'right' && c.shots.length === 1) setTimeout(() => window.__crossfire.look(90, 0), 180);
        });
      }
    };
    const actualFetch = window.fetch;
    window.fetch = (input, init) => actualFetch(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', backend) : input, init);
    setInterval(() => {
      const c = window.__damageCase, e = document.querySelector('.damage-edges');
      if (!c || !e || !c.shots.length || performance.now() - c.hitAt > 900) return;
      c.samples.push({ age: performance.now() - c.hitAt, hit: c.shots.length, opacity: Number(e.style.opacity), css: e.style.cssText,
        weights: Object.fromEntries(['left', 'right', 'top', 'bottom'].map((k) => [k, Number(e.style.getPropertyValue(`--damage-${k}`))])) });
    }, 16);
  }, backend);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=0.5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Health viewer');
  await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#start.visible .btn.primary:not(:disabled)') || document.querySelector('#error.visible'), { timeout: 240000 });
  const loadError = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : ''); check(!loadError, `browser loaded (${loadError})`);
  if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 30000 });
  const victimId = await page.evaluate(() => window.__crossfire.network().selfId);
  ws = new WebSocket(new URL('/ws', backend).href.replace('http:', 'ws:'), { origin: new URL(base).origin });
  const messages = []; let snapshot, id, seq = 0;
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); messages.push(m); if (m.snapshot) snapshot = m.snapshot; }); ws.on('error', () => {});
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = (m) => ws.send(JSON.stringify({ v: 7, ...m }));
  send({ type: 'join', name: 'Actual health shooter' });
  const welcome = await until(() => messages.find((m) => m.type === 'welcome'), 'actual shooter join'); id = welcome.selfId;
  heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) send({ type: 'ping', at: Date.now() }); }, 500);
  send({ type: 'spawn', requestId: crypto.randomUUID(), weapon: 'smg', roundId: snapshot.roundId, mapVersion: snapshot.mapVersion });
  await until(() => messages.find((m) => m.type === 'spawned'), 'actual shooter spawn');
  const arena = await room.directionalArenaForTest();
  await room.placeForCombatTest(victimId, arena.center);
  async function shoot(source, aiming = true) {
    const target = arena.center, yaw = Math.atan2(-(target[0] - source[0]), -(target[2] - source[2]));
    const pitch = Math.atan2(target[1] + .9 - source[1] - 1.64, Math.hypot(target[0] - source[0], target[2] - source[2]));
    const batch = (trigger) => send({ type: 'input', roundId: snapshot.roundId, mapVersion: snapshot.mapVersion,
      frames: Array.from({ length: 6 }, (_, k) => ({ seq: ++seq, yaw, pitch,
        intent: { x: 0, z: 0, slide: false, aim: true, jumpPressed: false }, combat: { trigger: trigger && k === 0, reload: false } })) });
    if (aiming) for (let k = 0; k < 12; k++) { batch(false); await delay(50); }
    await until(() => snapshot.players.find((p) => p.id === id).ack >= seq, 'real shooter controls acknowledged');
    const mark = messages.length; batch(true);
    const shot = await until(() => messages.slice(mark).find((m) => m.type === 'shot' && m.shot.shooterId === id), 'actual shot');
    check(shot.shot.hits.some((h) => h.id === victimId && h.amount === 11), 'server-confirmed SMG hit on browser victim');
  }
  for (const name of ['right', 'left', 'front', 'behind']) {
    await page.evaluate((name) => { window.__crossfire.look(0, 0); window.__damageCase = { name, shots: [], samples: [] }; }, name);
    const source = arena.sources[name]; await room.placeForCombatTest(id, source);
    await shoot(source);
    if (name === 'left') { await delay(200); await shoot(source, false); }
    await delay(720);
    const data = await page.evaluate(() => window.__damageCase); results.push(data);
    const peak = data.samples.filter((s) => s.hit === 1 && s.age < 160).sort((a, b) => b.opacity - a.opacity)[0];
    check(peak?.opacity > .2 && peak.opacity <= .8, `${name}: quick, bounded actual-hit effect`);
    check(data.samples.filter((s) => s.age >= 560).every((s) => s.opacity === 0), `${name}: fades completely in about 0.5s`);
    if (name === 'right') check(data.samples.some((s) => s.age > 200 && s.age < 450 && s.weights.top > s.weights.right), 'turning current camera moves the real-hit haze to the front');
    if (name === 'left') check(data.shots.length === 2 && data.samples.every((s) => s.opacity <= .8), 'consecutive confirmed hits refresh without excess brightness');
    // Freeze only a clone of the real recorded HUD style for deterministic CSS
    // pixel inspection; this never calls hit(), supplies packets or changes health.
    await page.evaluate((css) => {
      const panel = document.createElement('div'); panel.id = 'damage-css-probe'; panel.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000';
      const edge = document.createElement('div'); edge.className = 'damage-edges'; edge.style.cssText = css; panel.append(edge); document.body.append(panel);
    }, peak.css);
    await delay(100);
    const pixels = Buffer.from(await page.screenshot({ path: `${out}/${name}.png` })).toString('base64');
    data.pixels = await page.evaluate(async (png) => {
      const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const sample = (x, y, w = 12, h = 12) => { const p = ctx.getImageData(x, y, w, h).data; let red = 0; for (let k = 0; k < p.length; k += 4) red += Math.max(0, p[k] - p[k + 1]); return red / (p.length / 4); };
      return { left: sample(0, 294), right: sample(788, 294), top: sample(394, 0), bottom: sample(394, 588), center: sample(394, 294) };
    }, pixels);
    const p = data.pixels;
    check(p.center === 0, `${name}: center pixels remain completely clear`);
    check(name === 'right' ? p.right > p.left + 10 : name === 'left' ? p.left > p.right + 10
      : name === 'front' ? p.top > p.bottom + 10 : p.bottom > p.top && p.left > 3 && p.right > 3, `${name}: actual CSS gradient pixels match attack direction`);
    await page.evaluate(() => document.querySelector('#damage-css-probe').remove());
  }
  await page.evaluate(() => { window.__damageCase = null; });
  await shoot(arena.sources.behind, false);
  const damaged = await room.healthForTest(victimId);
  check(damaged.health > 0 && damaged.health < 100 && damaged.regenAt !== null, 'real damaged life has a server regeneration deadline');
  const hp = damaged.health;
  await page.waitForFunction((hp) => Number(document.querySelector('.health .value').textContent) > Math.ceil(hp), { timeout: 10000 }, hp);
  const network = await page.evaluate(() => ({ network: window.__crossfire.network(), hud: Number(document.querySelector('.health .value').textContent) }));
  const self = network.network.snapshot.players.find((p) => p.id === victimId);
  check(network.hud === Math.ceil(self.health) && self.health > hp, 'existing HUD displays authoritative regenerated health');
  const peer = await until(() => messages.findLast((m) => m.type === 'snapshot' && m.snapshot.serverTime === network.network.snapshot.serverTime), 'matching peer health snapshot');
  check(peer.snapshot.players.find((p) => p.id === victimId).health === self.health, 'real peer and browser receive identical regenerated health');
  await page.evaluate(() => window.__crossfire.networkLeave()); send({ type: 'leave' });
  check(errors.length === 0, `no uncaught browser/asset errors: ${errors.join('; ')}`);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
  clearInterval(heartbeat); ws?.terminate(); await browser?.close(); await fixture.dispose();
}
