/** Phase 1 checks with actual browser input and a local Worker with real sockets. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4198/crossfire/';
const out = 'test-results/phase1-browser'; fs.mkdirSync(out, { recursive: true });
const check = (v, label) => { assert.ok(v, label); console.log(`PASS ${label}`); };
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
const state = (p) => p.evaluate(() => window.__crossfire.network());
const me = (s) => s.snapshot.players.find((p) => p.id === s.selfId);
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'phase1-browser',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/phase1-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR) }));
let browser;
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest();
  while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000,
    defaultViewport: { width: 1100, height: 720 }, protocolTimeout: 240000,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [], errors = [];
  for (const [index, name] of ['Phase Alpha', 'Phase Bravo'].entries()) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page);
    await page.evaluateOnNewDocument((backend) => {
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols); }
      };
      const fetch = window.fetch;
      window.fetch = (input, init) => fetch(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', backend) : input, init);
    }, backend);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}?multiplayer${index ? '&autoplay' : ''}&quality=low&shadows=off&scale=0.5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    if (!index) {
      const settings = async () => { await page.click('.home-nav button:nth-child(2)'); await page.waitForSelector('#settings.visible'); };
      const footer = (text) => page.evaluate((text) => [...document.querySelectorAll('#settings .settings-foot button')].find((b) => b.textContent.trim() === text).click(), text);
      const bind = (label) => page.evaluate((label) => [...document.querySelectorAll('.control-bind')].find((b) => b.getAttribute('aria-label') === `Rebind ${label}`).click(), label);
      await settings();
      await bind('Aim down sights'); await page.keyboard.press('w');
      check((await page.$eval('.settings-status', (e) => e.textContent)).includes('already used'), 'duplicate binding is rejected');
      await page.keyboard.press('Escape');
      check(await page.$('#settings.visible'), 'Escape cancels rebinding without closing settings');
      await bind('Aim down sights'); await page.keyboard.press('f');
      check((await page.evaluate(() => window.__crossfire.settings().keyBindings.aim))[0] === 'Mouse2', 'keybinding stays draft before Apply');
      await footer('Back'); await settings();
      check((await page.$eval('[aria-label="Rebind Aim down sights"]', (e) => e.textContent)).includes('Mouse right'), 'Back discards draft binding');
      await bind('Aim down sights'); await page.keyboard.press('f');
      await bind('Shoot'); await page.mouse.click(10, 10, { button: 'middle' });
      check((await page.$eval('[aria-label="Rebind Shoot"]', (e) => e.textContent)).includes('Mouse middle')
        && !!(await page.$('#settings.visible')), 'mouse binding is captured without activating menu controls');
      await bind('Shoot'); await page.keyboard.press('g');
      check((await page.$eval('[aria-label="Rebind Shoot"]', (e) => e.textContent)) === 'G', 'keyboard binding works immediately after a mouse binding');
      await bind('Leaderboard'); await page.keyboard.press('l');
      await bind('Pause menu'); await page.keyboard.press('p');
      await footer('Apply');
      check((await page.evaluate(() => window.__crossfire.settings().keyBindings.aim))[0] === 'KeyF', 'Apply activates keyboard aim');
      await page.evaluate(() => document.querySelector('[aria-label="Reset Aim down sights"]').click());
      check((await page.$eval('[aria-label="Rebind Aim down sights"]', (e) => e.textContent)).includes('Mouse right'), 'individual reset restores default in draft');
      await page.evaluate(() => document.querySelector('.control-reset-all').click());
      check((await page.$eval('[aria-label="Rebind Shoot"]', (e) => e.textContent)).includes('Mouse left')
        && (await page.$eval('[aria-label="Rebind Pause menu"]', (e) => e.textContent)).includes('Escape'), 'reset all restores default controls in the draft');
      await footer('Back'); await settings();
      check((await page.$eval('[aria-label="Rebind Aim down sights"]', (e) => e.textContent)) === 'F', 'Back discards control reset');
      await page.$eval('.control-settings', (e) => e.scrollIntoView({ block: 'start' }));
      await delay(350);
      await page.screenshot({ path: `${out}/controls.png` });
      await footer('Back');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.waitForFunction(() => window.__crossfire?.settings?.().keyBindings.aim[0] === 'KeyF', { timeout: 120000 });
      check(true, 'applied controls survive a page reload');
      await page.click('#menu .home-actions .primary');
    }
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
      || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    const error = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : '');
    check(!error, `${name} joined without error (${error})`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
    page.id = (await state(page)).selfId;
  }
  const [a, b] = pages;
  await until(async () => (await state(a)).snapshot.players.length === 2, 'both live players');
  const arena = await room.directionalArenaForTest();
  await room.placeForCombatTest(a.id, arena.center, 0); await room.placeForCombatTest(b.id, arena.observer, 0);
  await a.evaluate(() => window.__crossfire.look(0, 0)); await delay(500);
  await a.keyboard.down('f');
  await until(async () => (await a.evaluate(() => window.__crossfire.weapon())).ads > .8, 'keyboard aim');
  await a.keyboard.up('f'); check(true, 'keyboard aim works in the match');
  await a.keyboard.down('l');
  await until(async () => (await a.evaluate(() => window.__crossfire.scoreboard())).visible, 'rebound leaderboard');
  await a.keyboard.up('l');
  await until(async () => !(await a.evaluate(() => window.__crossfire.scoreboard())).visible, 'leaderboard release');
  check(true, 'rebound leaderboard works while held');
  const ammoBefore = (await a.evaluate(() => window.__crossfire.weapon())).ammo;
  await a.keyboard.down('g');
  await until(async () => (await a.evaluate(() => window.__crossfire.weapon())).ammo < ammoBefore, 'keyboard fire');
  await a.keyboard.up('g');
  check(true, 'rebound keyboard fire spends ammunition');
  const mouseAmmo = (await b.evaluate(() => window.__crossfire.weapon())).ammo;
  await b.evaluate(() => document.querySelector('#game').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })));
  await until(async () => (await b.evaluate(() => window.__crossfire.weapon())).ammo < mouseAmmo, 'default mouse fire');
  await b.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })));
  check(true, 'default mouse fire remains functional');
  await a.keyboard.press('Enter'); await a.waitForSelector('.match-chat:not([hidden]) input');
  const before = me(await state(a)).motion.position;
  const chatAmmo = (await a.evaluate(() => window.__crossfire.weapon())).ammo;
  await a.type('.chat-form input', 'wasd qer gpl text'); await delay(350);
  const after = me(await state(a)).motion.position;
  check(Math.hypot(after.x - before.x, after.z - before.z) < .05
    && (await a.evaluate(() => window.__crossfire.weapon())).ammo === chatAmmo && !(await a.$('#pause.visible')),
  'typing in chat does not trigger movement, fire or pause');
  await a.keyboard.press('Enter');
  await until(async () => (await b.$eval('.chat-log', (e) => e.textContent)).includes('Phase Alpha: wasd qer gpl text'), 'real chat delivery');
  check(true, 'room chat reaches the other real client with the server name');
  await a.keyboard.press('p');
  await until(async () => !!(await a.$('#pause.visible')), 'rebound pause');
  await until(async () => a.evaluate(() => !document.pointerLockElement), 'pointer released for pause');
  await delay(100);
  await a.click('#pause .btn.primary');
  await until(async () => !!(await a.$('#hud.visible')) && !(await a.$('#pause.visible')), 'resume after rebound pause');
  check(true, 'rebound pause opens and resumes the match');
  if (!await a.evaluate(() => document.pointerLockElement === document.querySelector('#game'))) {
    await delay(1100);
    await a.click('#game', { offset: { x: 15, y: 15 } });
    await until(async () => a.evaluate(() => document.pointerLockElement === document.querySelector('#game')), 'recapture after resume');
  }
  await a.keyboard.down('w'); await delay(350); await a.keyboard.down('Shift');
  await until(async () => (await a.$eval('.slide-lines', (e) => e.classList.contains('active'))), 'slide effect');
  const effect = await a.$eval('.slide-lines', (e) => ({ opacity: Number(getComputedStyle(e).opacity), mask: getComputedStyle(e).maskImage }));
  check(effect.mask.includes('radial-gradient'), 'slide speed lines leave the screen center clear');
  await a.screenshot({ path: `${out}/slide.png` });
  await a.keyboard.down('Space');
  await until(async () => { const p = me(await state(a)).motion; return !p.grounded && p.slideRemaining === 0 && p.slideCooldown > .5; }, 'server confirms slide jump');
  await a.keyboard.up('Space'); await a.keyboard.up('Shift'); await a.keyboard.up('w');
  check(true, 'slide jump is accepted by the Worker and starts cooldown');
  const health = await a.$eval('.health .bar', (e) => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height,
    line: getComputedStyle(e.closest('.health'), '::before').backgroundImage }));
  check(health.height >= 7 && health.width > 120 && health.line.includes('gradient'), 'larger health bar and faded line render');
  await a.screenshot({ path: `${out}/hud.png` });
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
} finally { await browser?.close(); await fixture.dispose(); }
