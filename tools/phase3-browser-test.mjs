/** Two real local browser sessions and a local Durable Object; no fabricated players. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4198/crossfire/';
const out = 'test-results/phase3-browser'; fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const check = (value, message) => { assert.ok(value, message); console.log(`PASS ${message}`); };
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(80); }
  throw new Error(`Timed out: ${label}`);
}
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'phase3-browser',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/phase3-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR) }));
let browser;
try {
  console.log('Starting local Durable Object');
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  console.log('Local Durable Object ready');
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000,
    defaultViewport: { width: 1100, height: 720 }, protocolTimeout: 240000,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  console.log('Browser ready');
  const errors = [];
  const context = await browser.createBrowserContext(), home = await context.newPage();
  home.on('pageerror', (e) => errors.push(String(e)));
  await home.evaluateOnNewDocument(() => localStorage.setItem('crossfire.pending-weapon', 'shotgun'));
  await home.goto(base, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(home, 'Preview Guest');
  const preview = await until(() => home.evaluate(() => window.__crossfire.homeCharacter()).then((s) => s.weapon && s), 'home weapon', 120000);
  console.log('HOME', JSON.stringify(preview));
  check(preview.weapon.id === 'shotgun' && preview.weapon.grips.length === 2 && preview.weapon.meshes > 0, 'home uses the selected actual weapon and both grip anchors');
  await home.screenshot({ path: `${out}/home.png` });
  await context.close();

  const pages = [];
  for (const [index, name] of ['Phase Three Alpha', 'Phase Three Bravo'].entries()) {
    const clientContext = await browser.createBrowserContext(), page = await clientContext.newPage(); pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.evaluateOnNewDocument((server, weapon) => {
      if (!sessionStorage.getItem('phase3-loadout-set')) {
        localStorage.setItem('crossfire.pending-weapon', weapon);
        sessionStorage.setItem('phase3-loadout-set', 'yes');
      }
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', server).href.replace('http:', 'ws:') : url, protocols); }
      };
      const original = window.fetch;
      window.fetch = (input, init) => original(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', server) : input, init);
    }, backend, index ? 'rifle' : 'shotgun');
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=0.5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
      || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    const error = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : '');
    check(!error, `${name} connects (${error})`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
    page.id = (await page.evaluate(() => window.__crossfire.network())).selfId;
  }
  const [a, b] = pages;
  check(await a.evaluate(() => localStorage.getItem('crossfire.last-used-weapon') === 'shotgun'),
    'server-approved match weapon is saved as the last used weapon');
  const remote = () => b.evaluate((id) => window.__crossfire.network().rendered.find((p) => p.id === id), a.id);
  const avatar = await until(async () => { const p = await remote(); return p?.weapon?.grips?.length === 2 && p; }, 'remote weapon', 120000);
  console.log('REMOTE', JSON.stringify(avatar));
  check(avatar.weapon.id === 'shotgun' && avatar.weapon.meshes > 0, 'remote weapon matches authoritative loadout');
  const arena = await room.directionalArenaForTest();
  await room.placeForCombatTest(a.id, arena.center, 0); await room.placeForCombatTest(b.id, arena.observer, 0);
  await a.evaluate(() => window.__crossfire.look(0, 25));
  await a.evaluate(() => document.querySelector('#game').dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true })));
  const aimed = await until(async () => { const p = await remote(); return p?.weapon?.ads > .7 && Math.abs(p.weapon.pitch) > .1 && p; }, 'remote pitch and aim', 30000);
  console.log('AIMED', JSON.stringify(aimed.weapon));
  check(aimed.weapon.id === 'shotgun', 'remote ADS and pitch use synchronized combat and motion');
  await a.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true })));
  const distance = (x, y) => Math.hypot(...x.map((v, i) => v - y[i]));
  check(distance(aimed.weapon.grips[0], aimed.animation.joints.hand_r) < .1
    && distance(aimed.weapon.grips[1], aimed.animation.joints.hand_l) < .1, 'both hands follow the real weapon grips while aiming');
  await a.evaluate(() => { window.__crossfire.look(0, 0); window.__crossfire.hold('forward', true); });
  const running = await until(async () => { const p = await remote(); return p?.animation?.clip === 'RUN' && p; }, 'remote run');
  check(running.weapon.id === 'shotgun' && distance(running.weapon.grips[0], running.animation.joints.hand_r) < .1,
    'weapon stays attached during a synchronized run');
  await a.evaluate(() => window.__crossfire.hold('slide', true));
  const sliding = await until(async () => { const p = await remote(); return p?.animation?.clip === 'SLIDE' && p; }, 'remote slide');
  check(sliding.weapon.id === 'shotgun', 'weapon remains attached during a synchronized slide');
  await a.evaluate(() => { window.__crossfire.hold('slide', false); window.__crossfire.hold('forward', false); });
  await until(async () => (await remote())?.animation?.clip !== 'SLIDE', 'end slide');
  await a.evaluate(() => window.__crossfire.hold('jump', true));
  const jumping = await until(async () => { const p = await remote(); return p?.animation?.clip?.startsWith('JUMP') && p; }, 'remote jump');
  await a.evaluate(() => window.__crossfire.hold('jump', false));
  check(jumping.weapon.id === 'shotgun', 'weapon remains attached during a synchronized jump');
  await a.keyboard.press('Enter'); await a.waitForSelector('.match-chat:not([hidden]) input');
  await a.type('.chat-form input', 'phase three hello'); await a.keyboard.press('Enter');
  await until(async () => (await b.$eval('.chat-feed', (e) => e.textContent)).includes('Phase Three Alpha: phase three hello'), 'actual chat message');
  check(true, 'Enter opens and sends actual server chat into fading HUD history');
  await a.keyboard.press('Enter'); await a.waitForSelector('.match-chat:not([hidden]) input'); await a.keyboard.press('Escape');
  check(await a.$eval('.match-chat', (e) => e.hidden), 'Escape cancels chat');
  await b.keyboard.down('Tab');
  await until(async () => b.$eval('.scoreboard', (e) => !e.hidden), 'scoreboard');
  const colors = await b.$$eval('.scoreboard tbody tr', (rows) => rows.map((r) => ({ id: r.dataset.playerId, class: r.cells[0].className })));
  check(colors.find((r) => r.id === b.id)?.class === 'score-name-friendly'
    && colors.find((r) => r.id === a.id)?.class === 'score-name-opponent', 'FFA scoreboard colors real participants relative to the viewer');
  await b.keyboard.up('Tab');
  await room.fallForTest(a.id);
  await a.waitForSelector('#spectate.visible', { timeout: 30000 });
  await a.click('.spectate-controls .btn:nth-of-type(1)');
  await a.click('#weapons .weapon-card[data-weapon="rifle"]');
  check(await a.evaluate(() => localStorage.getItem('crossfire.last-used-weapon') === 'shotgun'),
    'selecting a future loadout does not replace the last weapon used');
  await until(async () => !(await a.$eval('.respawn-button', (b) => b.disabled)), 'respawn delay', 12000);
  await a.click('.respawn-button');
  await a.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
  const respawned = await until(async () => { const p = await remote(); return p?.weapon?.id === 'rifle' && p; }, 'new server-approved weapon', 30000);
  check(respawned.weapon.grips.length === 2 && respawned.weapon.instances === 1,
    'valid respawn replaces the remote weapon with exactly one server-approved loadout');
  check(await a.evaluate(() => localStorage.getItem('crossfire.last-used-weapon') === 'rifle'),
    'the last-used weapon changes after the new life is approved');
  await a.evaluate(() => window.__crossfire.networkLeave());
  await a.goto(base, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const newHome = await until(() => a.evaluate(() => window.__crossfire.homeCharacter()).then((s) => s.weapon?.id === 'rifle' && s), 'updated home weapon', 120000);
  check(newHome.weapon.id === 'rifle', 'home preview updates to the newly selected weapon');
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
} finally { await browser?.close(); await fixture.dispose(); }
