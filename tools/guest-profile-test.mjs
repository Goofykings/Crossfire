/** Production UI + isolated real Worker. No synthetic roster, connections or guest authentication.
 * Build frontend/server, serve dist, then node tools/guest-profile-test.mjs --url http://127.0.0.1:4176/crossfire/
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';

const i = process.argv.indexOf('--url');
const base = i < 0 ? 'http://127.0.0.1:4176/crossfire/' : process.argv[i + 1];
const key = 'crossfire.guest.v1';
const root = new URL('../server/', import.meta.url);
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'crossfire-guest-browser',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('dist/index.js', root)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  resourcePersistencePath: fs.mkdtempSync(fileURLToPath(new URL('.wrangler/guest-browser-', root))),
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, SESSION_GRACE_MS: '15000', HEARTBEAT_TIMEOUT_MS: '10000' },
  log: new Log(LogLevel.ERROR),
}));
const backend = (await fixture.ready).href;
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const errors = [];
const joins = new WeakMap();
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS  ${message}`); };
fs.mkdirSync('test-results/guest', { recursive: true });
const profile = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const settings = (page) => page.evaluate(() => window.__crossfire.settings());
const net = (page) => page.evaluate(() => window.__crossfire.network());
async function setText(page, selector, value) {
  await page.$eval(selector, (e, text) => { e.value = text; e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function foot(page, label) {
  await page.evaluate((text) => [...document.querySelectorAll('#settings .settings-foot button')].find((b) => b.textContent.trim() === text).click(), label);
}
async function open(blocked = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.evaluateOnNewDocument((endpoint, block) => {
    if (block) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
    const RealWebSocket = window.WebSocket;
    window.WebSocket = class extends RealWebSocket {
      constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', endpoint).href.replace('http:', 'ws:') : url, protocols); }
    };
    const fetchReal = window.fetch;
    window.fetch = (input, init) => fetchReal(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', endpoint) : input, init);
  }, backend, blocked);
  const wire = [];
  joins.set(page, wire);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    const m = JSON.parse(response.payloadData);
    // Keep only display-name/key evidence, never resume credentials.
    if (m.type === 'join') wire.push({ name: m.name, keys: Object.keys(m) });
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?quality=low&shadows=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#guest-profile[open]', { timeout: 240000 });
  return page;
}
async function join(page) {
  await page.bringToFront();
  await page.click('#menu .primary');
  await page.waitForSelector('#start.visible', { timeout: 240000 });
}
async function waitName(page, name) {
  await page.waitForFunction((text) => {
    const n = window.__crossfire.network(); return n.state === 'connected' && n.snapshot?.players.find((p) => p.id === n.selfId)?.name === text;
  }, { timeout: 30000 }, name);
}
try {
  const a = await open();
  check(await a.evaluate(() => window.__crossfire.stats().mapId === null && window.__crossfire.network().state === 'idle'), 'first-visit setup opens without loading a map or connecting a player');
  await a.screenshot({ path: 'test-results/guest/first-visit.png' });
  await a.click('#guest-profile button');
  check(await a.$eval('#guest-profile', (e) => e.open && e.querySelector('.guest-error').textContent.length > 0), 'blank first-visit username is rejected accessibly');
  await completeGuestProfile(a, 'Alice');
  const initial = await profile(a);
  check(initial.username === 'Alice' && /^[a-f0-9-]{36}$/.test(initial.guestId), 'chosen username and random guest ID are saved locally');
  await a.reload({ waitUntil: 'domcontentloaded' });
  await completeGuestProfile(a);
  check(JSON.stringify(await profile(a)) === JSON.stringify(initial), 'return visit loads the same name and guest ID without prompting');
  const before = await settings(a);
  await a.click('.home-nav button:last-of-type');
  await setText(a, '#set-username', 'Discarded');
  await a.focus('#set-fov'); await a.keyboard.press('End');
  await foot(a, 'Back');
  check((await profile(a)).username === 'Alice' && JSON.stringify(await settings(a)) === JSON.stringify(before), 'Back discards username and gameplay edits together');
  await a.click('.home-nav button:last-of-type');
  await setText(a, '#set-username', ' <> ');
  await a.focus('#set-fov'); await a.keyboard.press('End');
  await foot(a, 'Apply');
  check((await profile(a)).username === 'Alice' && (await settings(a)).fov === before.fov, 'invalid rename cannot partially apply other settings');
  await setText(a, '#set-username', 'Alice Next');
  await a.click('#tab-sound');
  await a.$eval('#set-masterVolume', (e) => { e.value = '0.3'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await foot(a, 'Apply');
  const applied = await settings(a);
  check((await profile(a)).guestId === initial.guestId && (await profile(a)).username === 'Alice Next'
    && applied.fov === 110 && applied.masterVolume === 0.3 && applied.graphicsQuality === before.graphicsQuality, 'Apply saves the name plus gameplay/sound edits while preserving graphics and guest ID');
  await a.click('#tab-gameplay');
  await a.screenshot({ path: 'test-results/guest/settings.png' });
  await foot(a, 'Back');
  await a.reload({ waitUntil: 'domcontentloaded' }); await completeGuestProfile(a);
  check((await profile(a)).username === 'Alice Next' && (await settings(a)).masterVolume === 0.3, 'renamed guest and existing settings survive a reload');
  await join(a); await waitName(a, 'Alice Next');
  const aId = (await net(a)).selfId;
  check(aId !== initial.guestId && joins.get(a).at(-1).name === 'Alice Next'
    && joins.get(a).every((m) => !m.keys.includes('guestId') && !m.keys.includes('sessionId')), 'real join sends only the chosen name and receives an independent server session ID');
  const b = await open(); await completeGuestProfile(b, 'Bob'); await join(b); await waitName(b, 'Bob');
  await b.waitForFunction(() => window.__crossfire.network().snapshot.players.length === 2);
  check((await net(b)).selfId !== aId && (await profile(b)).guestId !== initial.guestId, 'independent real clients have distinct local guests and authoritative server sessions');
  await b.keyboard.down('Tab');
  await b.waitForFunction(() => document.querySelector('.scoreboard')?.innerText.includes('Alice Next') && document.querySelector('.scoreboard')?.innerText.includes('Bob'));
  await b.screenshot({ path: 'test-results/guest/real-names.png' }); await b.keyboard.up('Tab');
  await a.bringToFront(); await a.click('#start .btn:nth-of-type(2)');
  await setText(a, '#set-username', 'Alice Updated'); await foot(a, 'Apply'); await foot(a, 'Back');
  check((await net(a)).snapshot.players.find((p) => p.id === aId).name === 'Alice Next', 'connected rename is saved without silently replacing the current session');
  await a.evaluate(() => window.__crossfire.networkReconnect()); await waitName(a, 'Alice Updated');
  check((await net(a)).selfId === aId, 'authenticated reconnect validates the changed name and preserves the server session');
  await a.evaluate(() => window.__crossfire.networkLeave()); await join(a); await waitName(a, 'Alice Updated');
  check((await net(a)).selfId !== aId && (await profile(a)).guestId === initial.guestId, 'leaving and joining creates a fresh server session despite keeping the same local guest ID');
  for (const page of [a, b]) await page.evaluate(() => window.__crossfire.networkLeave());
  const temporary = await open(true); await completeGuestProfile(temporary, 'Temporary');
  await join(temporary); await waitName(temporary, 'Temporary');
  check((await net(temporary)).state === 'connected', 'blocked localStorage still permits actual temporary multiplayer play');
  await temporary.evaluate(() => window.__crossfire.networkLeave());
  await temporary.reload({ waitUntil: 'domcontentloaded' });
  await temporary.waitForSelector('#guest-profile[open]');
  check(true, 'temporary guest is asked for a name on a later visit when storage remains blocked');
  await temporary.close();
  const fresh = await open(); await completeGuestProfile(fresh, 'Original'); const oldId = (await profile(fresh)).guestId;
  await fresh.evaluate(() => localStorage.clear()); await fresh.reload({ waitUntil: 'domcontentloaded' });
  await fresh.waitForSelector('#guest-profile[open]');
  check((await profile(fresh)).guestId !== oldId && (await profile(fresh)).username === '', 'clearing browser data creates a new unnamed guest');
  await completeGuestProfile(fresh, 'Restored');
  await fresh.evaluate((k) => localStorage.setItem(k, '{broken'), key); await fresh.reload({ waitUntil: 'domcontentloaded' });
  await fresh.waitForSelector('#guest-profile[open]'); await completeGuestProfile(fresh, 'Recovered');
  check((await profile(fresh)).username === 'Recovered', 'corrupt profile data safely recovers through first-visit setup');
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); await fixture.dispose(); }
