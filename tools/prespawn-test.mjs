/** Real Stage 1 UI against local Worker. No synthetic multiplayer roster or scores.
 * node tools/prespawn-test.mjs [--url http://127.0.0.1:5180/]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const i = process.argv.indexOf('--url');
const base = i < 0 ? 'http://127.0.0.1:5180/' : process.argv[i + 1];
// Optional isolated real Worker with one test-only RPC to seed a fall. Redirect
// requests to its real TCP endpoint; never synthesize connections or snapshots.
let fixture = null;
let fixtureUrl = '';
if (process.argv.includes('--lifecycle-fixture')) {
  const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import('../server/node_modules/miniflare/dist/src/index.js');
  const root = new URL('../server/', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  fixture = new Miniflare(convertV4MiniflareOptions({ name: 'crossfire-browser-life',
    modules: [{ type: 'ESModule', path: fileURLToPath(new URL('tests/runtime-fixture.mjs', root)) },
      { type: 'ESModule', path: fileURLToPath(new URL('dist/index.js', root)) }],
    compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
    resourcePersistencePath: fs.mkdtempSync(fileURLToPath(new URL('.wrangler/browser-life-', root))),
    durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: new URL(base).origin, SESSION_GRACE_MS: '15000', HEARTBEAT_TIMEOUT_MS: '10000' },
    log: new Log(LogLevel.ERROR),
  }));
  fixtureUrl = (await fixture.ready).href;
}
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, defaultViewport: { width: 1280, height: 720 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const errors = [];
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS  ${message}`); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (page) => page.evaluate(() => window.__crossfire.network());
const self = async (page) => { const s = await state(page); return s.snapshot.players.find((p) => p.id === s.selfId); };
fs.mkdirSync('test-results/prespawn', { recursive: true });
async function home() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (fixtureUrl) await page.evaluateOnNewDocument((backend) => {
    const RealWebSocket = window.WebSocket;
    window.WebSocket = class extends RealWebSocket {
      constructor(url, protocols) {
        const target = new URL(String(url));
        super(target.pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols);
      }
    };
    const realFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(String(input), location.href);
      return realFetch(url.pathname === '/presence' ? new URL('/presence', backend) : input, init);
    };
  }, fixtureUrl);
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?quality=low&shadows=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__crossfire?.stats().mapId && document.querySelector('#menu.visible'), { timeout: 240000 });
  return page;
}
async function count(page, expected) {
  await page.bringToFront();
  await page.waitForFunction((n) => document.querySelector('.online-count')?.textContent === `${n} ${n === 1 ? 'Player' : 'Players'} Online`, { timeout: 10000 }, expected);
}
async function join(page) {
  await page.bringToFront();
  await page.click('#menu .primary');
  await page.waitForSelector('#start.visible', { timeout: 60000 });
}
try {
  const observer = await home();
  await count(observer, 0);
  check((await state(observer)).state === 'idle', 'home presence opens no player WebSocket');
  const a = await home();
  await join(a);
  check(!(await self(a)).alive && (await self(a)).life === 0, 'normal Play connects without spawning');
  await count(observer, 1);
  const b = await home();
  await join(b);
  await count(observer, 2);
  check((await state(b)).rendered.length === 0, 'connected menu clients create no live remote body');
  check((await state(observer)).state === 'idle', 'repeated count polling never creates a third session');
  await a.bringToFront();
  await a.click('#start .btn:first-child');
  await a.waitForFunction(() => document.querySelectorAll('#weapons .weapon-card img').length === 3, { timeout: 60000 });
  check(await a.$$eval('#weapons .weapon-card img', (images) => images.every((img) => img.complete && img.naturalWidth === 960)), 'three previews are rendered from the actual weapon assets');
  check(await a.$eval('#weapons .unavailable', (b) => b.disabled && b.textContent.includes('SMG')), 'SMG is honestly unavailable until its authorized model/gameplay stage');
  await a.screenshot({ path: 'test-results/prespawn/weapons.png' });
  await a.click('[data-weapon="shotgun"]');
  check(await a.$eval('#start.visible .selected-name', (e) => e.textContent === 'Shotgun'), 'selection returns immediately and saves pending loadout');
  check(await a.evaluate(() => localStorage.getItem('crossfire.pending-weapon') === 'shotgun'), 'pending loadout preference persists');
  await a.click('#start .btn:nth-of-type(2)');
  await a.waitForSelector('#settings.visible');
  const fov = await a.evaluate(() => window.__crossfire.settings().fov);
  await a.focus('#set-fov');
  await a.keyboard.press('End');
  await a.evaluate(() => [...document.querySelectorAll('#settings .settings-foot button')].find((b) => b.textContent.trim() === 'Back').click());
  check(await a.$('#start.visible') && await a.evaluate((v) => window.__crossfire.settings().fov === v, fov), 'pre-spawn Settings/Back retains the loadout and discards edits');
  await a.click('#start .btn:nth-of-type(2)');
  await a.keyboard.press('Escape');
  check(await a.$('#start.visible') && !(await a.$('#pause.visible')), 'Escape from pre-spawn Settings returns directly to pre-spawn');
  await a.screenshot({ path: 'test-results/prespawn/menu.png' });
  const focus = await a.evaluate(() => document.activeElement?.tagName);
  await a.keyboard.down('Tab');
  await a.waitForFunction(() => window.__crossfire.scoreboard().visible);
  check(await a.$$eval('.scoreboard tbody tr', (rows) => rows.length === 2), 'leaderboard contains exactly two real connected players, including pre-spawn');
  check(await a.$$eval('.scoreboard tr.local', (rows) => rows.length === 1), 'leaderboard highlights the actual local session');
  check(await a.evaluate((f) => document.activeElement?.tagName === f, focus), 'held Tab preserves browser focus');
  check(await a.$eval('.scoreboard-header', (e) => e.textContent.includes('--:--') && e.textContent.includes('unavailable')), 'missing match clock/mode is never fabricated');
  await a.screenshot({ path: 'test-results/prespawn/leaderboard.png' });
  await a.keyboard.up('Tab');
  check(await a.evaluate(() => !window.__crossfire.scoreboard().visible), 'Tab release hides leaderboard immediately');
  await a.keyboard.down('Tab');
  await a.waitForFunction(() => window.__crossfire.scoreboard().visible);
  await a.evaluate(() => window.dispatchEvent(new Event('blur')));
  check(await a.evaluate(() => !window.__crossfire.scoreboard().visible), 'losing focus clears held leaderboard');
  await a.keyboard.up('Tab');
  await a.click('#start .primary');
  await a.waitForFunction(() => window.__crossfire.ready(), { timeout: 10000 });
  check((await self(a)).alive && (await self(a)).weapon === 'shotgun' && (await self(a)).life === 1, 'Spawn enters only after server approval with the selected weapon');
  await b.waitForFunction(() => window.__crossfire.network().rendered.length === 1);
  check(!(await self(b)).alive, 'other menu session stays unspawned while seeing the real spawned avatar');
  for (const key of ['Digit1', 'Digit3', 'KeyQ']) await a.keyboard.press(key);
  await a.mouse.wheel({ deltaY: 120 });
  await a.evaluate(() => window.__crossfire.selectWeapon(0));
  await delay(250);
  check(await a.evaluate(() => window.__crossfire.weapon().id === 'shotgun') && (await self(a)).weapon === 'shotgun', 'number keys, Q, wheel and direct selection cannot change the life loadout');
  if (fixture) {
    const ns = await fixture.getDurableObjectNamespace('ROOM');
    const stub = ns.get(ns.idFromName('public-main'));
    try { await stub.fallForTest((await state(a)).selfId); }
    finally { stub[Symbol.dispose]?.(); }
    await a.waitForSelector('#start.visible');
    check(!(await self(a)).alive && (await self(a)).deaths === 1, 'real Worker fall elimination returns the client to pre-spawn');
    check(await a.$eval('#start .primary', (b) => b.textContent.trim() === 'Respawn'), 'eliminated player sees RESPAWN');
    await a.keyboard.down('Tab');
    await a.waitForFunction(() => document.querySelector('.scoreboard tr.local td:last-child')?.textContent === '1');
    check(await a.$eval('.scoreboard tr.local td:last-child', (e) => e.textContent === '1'), 'leaderboard updates from the server-owned death count');
    await a.keyboard.up('Tab');
    await b.waitForFunction(() => window.__crossfire.network().rendered.length === 0);
    await a.screenshot({ path: 'test-results/prespawn/respawn.png' });
    await a.click('#start .btn:first-child');
    await a.click('[data-weapon="sniper"]');
    await a.click('#start .primary');
    await a.waitForFunction(() => window.__crossfire.ready());
    check((await self(a)).life === 2 && (await self(a)).weapon === 'sniper' && (await self(a)).deaths === 1,
      'RESPAWN receives server approval for a different loadout and preserves the real death');
    await a.waitForFunction(() => /sniper/i.test(document.querySelector('.weapon-slots')?.textContent ?? ''));
    check(await a.$$eval('.weapon-slots > span', (slots) => slots.length === 1 && /sniper/i.test(slots[0].textContent)),
      'respawn HUD shows only the newly approved weapon');
    await b.waitForFunction(() => window.__crossfire.network().rendered.length === 1);
  }
  // A real transport reconnect preserves a connected spectator, its identity and count.
  const bId = (await state(b)).selfId;
  await b.evaluate(() => window.__crossfire.networkReconnect());
  await b.waitForFunction(() => window.__crossfire.network().state === 'connected', { timeout: 15000 });
  check((await state(b)).selfId === bId && !(await self(b)).alive, 'menu-session reconnect preserves identity without spawning');
  await count(observer, 2);
  await a.bringToFront();
  await a.evaluate(() => window.__crossfire.pause());
  await a.waitForFunction(() => document.pointerLockElement === null);
  check(await a.$eval('#pause .btn:last-child', (e) => e.textContent.trim() === 'Leave Match'), 'pause action is named Leave Match');
  await a.click('#pause .btn:last-child');
  await a.waitForSelector('#menu.visible');
  await b.waitForFunction(() => window.__crossfire.network().snapshot.players.length === 1 && window.__crossfire.network().rendered.length === 0);
  await count(observer, 1);
  check((await state(a)).state === 'closed', 'Leave Match closes the session and removes its remote avatar');
  await b.bringToFront();
  await b.keyboard.press('Escape');
  await b.waitForSelector('#pause.visible');
  await delay(2500); // A menu-client heartbeat must not close the pause/settings flow.
  check(await b.$('#pause.visible'), 'pre-spawn pause stays open across server snapshots');
  await b.click('#pause .btn:first-child');
  check(await b.$('#start.visible') && !(await self(b)).alive, 'Escape/Resume from pre-spawn never grants a spawn');
  await b.keyboard.press('Escape');
  await b.click('#pause .btn:last-child');
  await count(observer, 0);
  check(await b.$('#menu.visible'), 'a pre-spawn client can leave cleanly through Escape/Leave Match');
  await observer.setOfflineMode(true);
  await observer.waitForFunction(() => document.querySelector('.online-count')?.textContent === 'Offline', { timeout: 10000 });
  check((await state(observer)).state === 'idle', 'unreachable presence shows Offline without opening a player session');
  await observer.setOfflineMode(false);
  await count(observer, 0);
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); await fixture?.dispose(); }
