/** Real browser clients against an isolated Worker using actual map collision. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4198/crossfire/';
const out = 'test-results/lean-browser';
fs.mkdirSync(out, { recursive: true });
const until = async (fn, name, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await delay(60); }
  throw new Error(`Timed out: ${name}`);
};
const check = (value, name) => { assert.ok(value, name); console.log(`PASS ${name}`); };
const state = (page) => page.evaluate(() => window.__crossfire.network());
const me = (s) => s.snapshot.players.find((p) => p.id === s.selfId);
const view = (page) => page.evaluate(() => window.__crossfire.leanView());
const peer = async (page, id) => (await state(page)).rendered.find((p) => p.id === id);
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'lean-browser-verification',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/lean-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR) }));
let browser;
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest();
  while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000,
    defaultViewport: { width: 800, height: 600 }, protocolTimeout: 240000,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [], errors = [];
  for (const name of ['Lean Alpha', 'Lean Bravo']) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page);
    await page.evaluateOnNewDocument((backend) => {
      const native = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
      const pending = new Map(); let seq = 0;
      window.requestAnimationFrame = (callback) => {
        const id = ++seq, entry = { timer: 0, frame: 0 };
        entry.timer = setTimeout(() => { entry.frame = native((t) => { pending.delete(id); callback(t); }); }, 1000 / 30);
        pending.set(id, entry); return id;
      };
      window.cancelAnimationFrame = (id) => { const p = pending.get(id); if (p) { clearTimeout(p.timer); cancel(p.frame); pending.delete(id); } };
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols); }
      };
      const fetch = window.fetch;
      window.fetch = (input, init) => fetch(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', backend) : input, init);
    }, backend);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=0.5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
      || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    const error = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : '');
    check(!error, `${name} loads without an error (${error})`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 30000 });
    page.id = (await state(page)).selfId;
  }
  const [subject, observer] = pages;
  await until(async () => (await peer(observer, subject.id))?.animation?.joints?.head?.length, 'remote animated character');
  const arena = await room.leanArenaForTest();
  await room.placeForCombatTest(subject.id, arena.victim, 0);
  await room.placeForCombatTest(observer.id, arena.shooter, 0);
  await subject.evaluate(() => window.__crossfire.look(0, 0));
  await observer.evaluate(() => window.__crossfire.look(0, 0));
  await delay(1200);
  const neutral = await view(subject), initialPeer = await peer(observer, subject.id);
  console.log('neutral', JSON.stringify({ neutral, head: initialPeer.animation.joints.head }));
  await subject.keyboard.down('q');
  await until(async () => me(await state(subject)).motion.lean < -.9 && (await peer(observer, subject.id))?.lean < -.8, 'left lean synchronized');
  await delay(400);
  const left = await view(subject), leftPeer = await peer(observer, subject.id);
  console.log('left', JSON.stringify({ left, head: leftPeer.animation.joints.head, lean: leftPeer.lean }));
  check(left.lean < -.9 && left.camera[0] < neutral.camera[0] - .2 && left.weaponParented && !left.cameraBlocked, 'Q shifts camera and weapon left without entering a wall');
  check(leftPeer.animation.joints.head[0] < initialPeer.animation.joints.head[0] - .22, 'remote animated head follows the server hitbox left');
  await observer.screenshot({ path: `${out}/lean-left.png` });
  await subject.keyboard.down('e');
  await until(async () => Math.abs(me(await state(subject)).motion.lean) < .08, 'both keys return neutral');
  check(true, 'holding Q and E returns to neutral');
  await subject.keyboard.up('q');
  await until(async () => me(await state(subject)).motion.lean > .9 && (await peer(observer, subject.id))?.lean > .8, 'right lean synchronized');
  await delay(400);
  const right = await view(subject), rightPeer = await peer(observer, subject.id);
  console.log('right', JSON.stringify({ right, head: rightPeer.animation.joints.head, lean: rightPeer.lean }));
  check(right.camera[0] > neutral.camera[0] + .2 && !right.cameraBlocked, 'E shifts the viewpoint right');
  check(rightPeer.animation.joints.head[0] > initialPeer.animation.joints.head[0] + .22, 'remote animated head follows the server hitbox right');
  await observer.screenshot({ path: `${out}/lean-right.png` });
  await subject.keyboard.up('e');
  await until(async () => Math.abs(me(await state(subject)).motion.lean) < .05, 'release returns neutral');
  check(true, 'releasing the keys returns to neutral');
  await subject.evaluate(() => window.__crossfire.look(90, 0));
  await until(async () => Math.abs((await peer(observer, subject.id))?.yaw + Math.PI / 2) < .05, 'remote rotated orientation');
  await delay(350);
  const rotatedHead = (await peer(observer, subject.id)).animation.joints.head;
  await subject.keyboard.down('e');
  await until(async () => (await peer(observer, subject.id))?.lean > .9, 'right lean at rotated heading');
  await delay(350);
  const rotatedLeanHead = (await peer(observer, subject.id)).animation.joints.head;
  check(rotatedLeanHead[2] > rotatedHead[2] + .22, 'remote head follows the authoritative lean at a rotated heading');
  await subject.keyboard.up('e');
  await subject.evaluate(() => window.__crossfire.look(0, 0));
  await until(async () => Math.abs(me(await state(subject)).motion.lean) < .05, 'rotated lean released');
  await subject.keyboard.down('e');
  await subject.keyboard.down('w');
  const start = me(await state(subject)).motion.position;
  await until(async () => { const p = me(await state(subject)).motion; return p.lean > .8 && Math.hypot(p.position.x - start.x, p.position.z - start.z) > .3; }, 'walking while leaning');
  await subject.keyboard.up('w');
  check(true, 'walking and leaning synchronize together');
  await subject.keyboard.down('w');
  await delay(400);
  await subject.keyboard.down('Shift');
  await until(async () => { const p = me(await state(subject)).motion; return p.slideRemaining > 0 && p.lean < .5; }, 'sliding cancels lean');
  check(true, 'sliding returns lean toward neutral');
  await subject.keyboard.up('Shift');
  await subject.keyboard.up('w');
  await until(async () => me(await state(subject)).motion.slideRemaining === 0, 'slide finishes');
  await subject.keyboard.press('Space');
  await until(async () => { const p = me(await state(subject)).motion; return !p.grounded && p.lean < .4; }, 'jump cancels lean');
  check(true, 'jumping returns lean toward neutral');
  await subject.keyboard.up('e');
  await room.placeForCombatTest(subject.id, arena.shooter, 0);
  await room.placeForCombatTest(observer.id, arena.victim, 0);
  await subject.evaluate(() => { window.__crossfire.look(0, 0); window.__crossfire.hold('aim', true); });
  await subject.keyboard.down('e');
  await until(async () => me(await state(subject)).motion.lean > .9 && (await subject.evaluate(() => window.__crossfire.weapon())).ads > .95, 'aim while leaning');
  for (let i = 0; i < 3; i++) {
    await subject.evaluate((p) => window.__crossfire.aimAt(p[0], p[1] + .9, p[2]), arena.victim);
    await delay(150);
  }
  const ammo = (await subject.evaluate(() => window.__crossfire.weapon())).ammo;
  await subject.evaluate(() => document.querySelector('#game').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })));
  await delay(70);
  await subject.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })));
  await until(async () => me(await state(observer)).health < 100, 'leaned aimed shot damages real opponent');
  check((await subject.evaluate(() => window.__crossfire.weapon())).ammo < ammo, 'aimed shot while leaning hits the opponent and spends ammo');
  await subject.keyboard.down('r');
  await until(async () => (await subject.evaluate(() => window.__crossfire.weapon())).ammo === ammo, 'reload while leaning', 30000);
  await subject.keyboard.up('r');
  check(true, 'reloading works while leaning');
  await subject.evaluate(() => window.__crossfire.hold('aim', false));
  await subject.keyboard.up('e');
  const wall = await room.leanWallForTest();
  await room.placeForCombatTest(subject.id, wall.position, wall.heading);
  await subject.evaluate((h) => window.__crossfire.look(h, 0), wall.heading);
  await delay(800);
  await subject.keyboard.down('e');
  await delay(800);
  const nearWall = await view(subject);
  console.log('wall', JSON.stringify({ wall, nearWall }));
  const wallWeapon = await subject.evaluate(() => window.__crossfire.weapon());
  check(!nearWall.cameraBlocked && (!nearWall.muzzleBlocked || wallWeapon.viewMeshes.length === 0)
    && nearWall.weaponPullback <= 1, 'camera and visible muzzle stay outside actual walls with bounded pullback');
  await subject.screenshot({ path: `${out}/near-wall.png` });
  await subject.keyboard.up('e');
  for (const [key, turn] of [['e', -90], ['q', 90]]) {
    await subject.evaluate((h) => window.__crossfire.look(h, 0), wall.heading + turn);
    await until(async () => Math.abs(me(await state(subject)).motion.lean) < .05, 'neutral beside wall');
    await subject.keyboard.down(key);
    await delay(900);
    const blocked = await view(subject);
    check(Math.abs(blocked.lean) < .5 && !blocked.cameraBlocked, `${key.toUpperCase()} lean is reduced when the real wall blocks that side`);
    await subject.keyboard.up(key);
  }
  await room.placeForCombatTest(subject.id, arena.shooter, 0);
  await subject.evaluate(() => window.__crossfire.look(0, 0));
  await until(async () => {
    const v = await view(subject), w = await subject.evaluate(() => window.__crossfire.weapon());
    return v.weaponPullback < .05 && w.viewMeshes.length > 0;
  }, 'weapon recovers after leaving cover');
  check(true, 'weapon returns and becomes visible after leaving the wall');
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
  check((await state(subject)).state === 'connected' && (await state(observer)).state === 'connected', 'both real multiplayer clients remain connected');
} finally {
  await browser?.close();
  await fixture.dispose();
}
