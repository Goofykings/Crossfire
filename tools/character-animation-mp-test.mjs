/** Two real browser clients and a local Durable Object: each client renders the other with the
 * shared third-person rig, reconstructed only from synchronized player state and shot events.
 *   node tools/character-animation-mp-test.mjs [vite url]   (needs server/dist: npm.cmd run build --prefix server) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/';
const out = 'test-results/character-animation-mp'; fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const check = (value, message) => { assert.ok(value, message); console.log(`PASS ${message}`); };
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(60); }
  throw new Error(`Timed out: ${label}`);
}
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'character-animation-mp',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/character-animation-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR) }));
let browser;
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000,
    defaultViewport: { width: 960, height: 720 }, protocolTimeout: 240000,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [], pages = [];
  for (const [index, name] of ['Anim Subject', 'Anim Observer'].entries()) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.evaluateOnNewDocument((server, weapon) => {
      localStorage.setItem('crossfire.pending-weapon', weapon);
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', server).href.replace('http:', 'ws:') : url, protocols); }
      };
      const original = window.fetch;
      window.fetch = (input, init) => original(['/presence','/profile'].includes(new URL(String(input), location.href).pathname) ? new URL(new URL(String(input),location.href).pathname, server) : input, init);
    }, backend, index ? 'shotgun' : 'rifle');
    await page.goto(`${base}?multiplayer&autoplay&nohud&quality=low&shadows=off`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
      || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    const error = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : '');
    check(!error, `${name} connects (${error})`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
    page.id = (await page.evaluate(() => window.__crossfire.network())).selfId;
  }
  const [subject, observer] = pages;
  const view = (page, id) => page.evaluate((who) => window.__crossfire.network().rendered.find((p) => p.id === who), id);
  const seen = () => view(observer, subject.id);
  const arena = await room.directionalArenaForTest();
  await room.placeForCombatTest(subject.id, arena.center, 90);
  await room.placeForCombatTest(observer.id, arena.observer, 315);
  // Subject faces east; the observer stands 2.5 m to its front-right and looks at it.
  await subject.evaluate(() => window.__crossfire.look(90, 0));
  await observer.evaluate(() => window.__crossfire.look(315, -14));
  const first = await until(async () => { const p = await seen(); return p?.weapon?.posing && p.weapon.hands.length === 2 && p; }, 'observer renders subject', 60000);
  check(first.weapon.id === 'rifle' && first.weapon.instances === 1, 'observer renders the subject\'s server-approved rifle once');
  const back = await until(async () => { const p = await view(subject, observer.id); return p?.weapon && p; }, 'subject renders observer', 60000);
  check(back.weapon.id === 'shotgun', 'subject renders the observer\'s server-approved shotgun');
  const attached = (p) => p.weapon.hands.every((h) => h.gap < .01 && h.wristBend < 55 * Math.PI / 180);
  const shot = async (name) => { await delay(250); await observer.screenshot({ path: `${out}/${name}.png` }); };

  const ready = await until(async () => { const p = await seen(); return p.weapon.adsBlend < .05 && p.animation.weights.IDLE > .99 && p; }, 'ready');
  check(attached(ready), 'ready: both hands enclose the remote weapon handles');
  await shot('ready');

  await subject.evaluate(() => window.__crossfire.hold('aim', true));
  const aimed = await until(async () => { const p = await seen(); return p.weapon.adsBlend > .95 && p; }, 'remote ADS');
  check(attached(aimed) && aimed.weapon.sight[1] - ready.weapon.sight[1] > .2, 'ADS: remote weapon rises to the eye line with hands attached');
  await shot('ads');

  await subject.evaluate(() => window.__crossfire.hold('crouch', true));
  const crouchAds = await until(async () => { const p = await seen(); return p.animation.weights.CROUCH > .99 && p.weapon.adsBlend > .95 && p; }, 'remote crouch + ADS');
  check(attached(crouchAds) && crouchAds.weapon.sight[1] < aimed.weapon.sight[1] - .4, 'crouch + ADS: lowered body keeps the raised weapon and hands');
  await shot('crouch-ads');

  await subject.evaluate(() => window.__crossfire.hold('aim', false));
  const crouched = await until(async () => { const p = await seen(); return p.animation.weights.CROUCH > .99 && p.weapon.adsBlend < .05 && p; }, 'remote crouch');
  check(attached(crouched), 'crouch: remote character crouches with the weapon supported');
  await shot('crouch');
  await subject.evaluate(() => window.__crossfire.hold('crouch', false));
  await until(async () => (await seen()).animation.weights.IDLE > .99, 'stand up');

  const before = (await seen()).weapon.shots;
  await subject.evaluate(() => window.__crossfire.hold('fire', true));
  let recoilPeak = 0, firing = null;
  const fireEnd = Date.now() + 700;
  while (Date.now() < fireEnd) {
    const p = await seen(); recoilPeak = Math.max(recoilPeak, Math.abs(p.weapon.recoil));
    if (!firing && p.weapon.shots - before >= 2) { firing = p; await observer.screenshot({ path: `${out}/firing.png` }); }
  }
  await subject.evaluate(() => window.__crossfire.hold('fire', false));
  await delay(300);
  const fired = await seen();
  const sent = (await subject.evaluate(() => window.__crossfire.weapon())).ammo;
  console.log('SHOTS', fired.weapon.shots - before, 'recoil peak', recoilPeak.toFixed(3), 'subject ammo', sent);
  check(fired.weapon.shots - before >= 4 && recoilPeak > .2 && attached(fired), 'firing: each server-confirmed automatic shot drives cosmetic recoil');

  await subject.evaluate(() => window.__crossfire.look(90, 25));
  const pitched = await until(async () => { const p = await seen(); return p.weapon.pitch > .3 && p; }, 'remote pitch');
  check(attached(pitched) && pitched.weapon.muzzle[1] > ready.weapon.muzzle[1], 'look pitch: remote weapon and head follow the synchronized look');
  await subject.evaluate(() => window.__crossfire.look(90, 0));
  await subject.evaluate(() => window.__crossfire.hold('forward', true));
  const running = await until(async () => { const p = await seen(); return p?.animation?.clip === 'RUN' && p; }, 'remote run');
  check(!running.weapon.posing || attached(running), 'run: weapon and hands stay attached');
  await subject.evaluate(() => window.__crossfire.hold('slide', true));
  const sliding = await until(async () => { const p = await seen(); return p?.animation?.clip === 'SLIDE' && p; }, 'remote slide');
  check(!sliding.weapon.posing || attached(sliding), 'slide: weapon and hands stay attached');
  await subject.evaluate(() => { window.__crossfire.hold('slide', false); window.__crossfire.hold('forward', false); });
  await until(async () => (await seen())?.animation?.clip !== 'SLIDE', 'end slide');
  await subject.evaluate(() => window.__crossfire.hold('jump', true));
  const jumping = await until(async () => { const p = await seen(); return p?.animation?.clip?.startsWith('JUMP') && p; }, 'remote jump');
  await subject.evaluate(() => window.__crossfire.hold('jump', false));
  check(!jumping.weapon.posing || attached(jumping), 'jump: weapon and hands stay attached');
  assert.deepEqual(errors, []);
  console.log('PASS no browser exceptions');
} finally { await browser?.close(); await fixture.dispose(); }
