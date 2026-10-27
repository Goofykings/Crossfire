/** Cancel actual joins and delayed asset transfers against an isolated real Worker.
 * Build frontend/server and serve dist, then node tools/loading-cancel-test.mjs --url http://127.0.0.1:4176/crossfire/
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
const index = process.argv.indexOf('--url');
const base = index < 0 ? 'http://127.0.0.1:4176/crossfire/' : process.argv[index + 1];
const root = new URL('../server/', import.meta.url);
const worker = new Miniflare(convertV4MiniflareOptions({ name: 'crossfire-cancel-test',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('tests/runtime-fixture.mjs', root)) },
    { type: 'ESModule', path: fileURLToPath(new URL('dist/index.js', root)) }],
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync(fileURLToPath(new URL('.wrangler/cancel-test-', root))),
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, SESSION_GRACE_MS: '15000', HEARTBEAT_TIMEOUT_MS: '10000' },
  log: new Log(LogLevel.ERROR),
}));
const backend = (await worker.ready).href;
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(fs.existsSync);
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS  ${message}`); };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync('test-results/loading-cancel', { recursive: true });
let phase = '';
let held = [];
const counts = new Map();
const errors = [];
async function emptyRoom() {
  for (let n = 0; n < 100; n++) {
    if ((await (await fetch(new URL('/presence', backend))).json()).online === 0) return;
    await delay(50);
  }
  throw new Error('Cancelled player remained in the public room');
}
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((endpoint) => {
    const RealWebSocket = window.WebSocket;
    const delayed = [];
    window.__holdJoin = false;
    window.__releaseJoin = () => { window.__holdJoin = false; for (const send of delayed.splice(0)) send(); };
    window.WebSocket = class extends RealWebSocket {
      constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', endpoint).href.replace('http:', 'ws:') : url, protocols); }
      send(data) {
        if (window.__holdJoin && JSON.parse(data).type === 'join') delayed.push(() => { if (this.readyState === RealWebSocket.OPEN) super.send(data); });
        else super.send(data);
      }
    };
    const realFetch = window.fetch;
    window.fetch = (input, init) => realFetch(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', endpoint) : input, init);
  }, backend);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/net::ERR_ABORTED|WebSocket is closed before the connection is established/.test(message.text())) errors.push(message.text());
  });
  await page.goto(`${base}?quality=low&shadows=low`, { waitUntil: 'domcontentloaded' });
  await completeGuestProfile(page, 'Cancel Test');
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    const count = (counts.get(url) ?? 0) + 1; counts.set(url, count);
    const weapon = /\/assets\/models\/shared\/weapons\/.*\.glb/.test(url);
    if ((phase === 'materials' && url.endsWith('/assets/materials.json')) || (phase === 'weapons' && weapon)
      || (phase === 'preview' && weapon && count >= 2)
      || (phase === 'map' && /\/assets\/models\/(european-town|industrial-complex|modern-city)\/.*\.glb/.test(url))
      || (phase === 'rotation' && /\/assets\/models\/(european-town|industrial-complex|modern-city)\/map-assets.json/.test(url))) held.push(request);
    else void request.continue().catch(() => {});
  });
  async function cancel(label) {
    await page.click('#loading .loading-back');
    await page.waitForSelector('#menu.visible');
    phase = '';
    await page.evaluate(() => window.__releaseJoin());
    await Promise.all(held.splice(0).map((request) => request.continue().catch(() => {})));
    await emptyRoom(); await delay(300);
    check(await page.evaluate(() => window.__crossfire.state() === 'menu' && window.__crossfire.stats().mapId === null
      && window.__crossfire.network().state === 'idle' && !window.__crossfire.loadingState().roundLoad
      && !document.querySelector('#error.visible') && !document.querySelector('#start.visible')), `${label}: Back returns home, removes the session and blocks late completion`);
  }
  await page.evaluate(() => { window.__holdJoin = true; });
  await page.click('#menu .primary'); await page.waitForSelector('#loading.visible');
  check(await page.$eval('.loading-back', (e) => { const r = e.getBoundingClientRect(); return r.left === 24 && r.top === 24; }), 'Back sits at the top left');
  check(await page.$eval('.loading-spinner', (e) => getComputedStyle(e).animationName === 'loading-spin' && getComputedStyle(e).animationDuration === '0.8s'), 'small loading wheel spins continuously');
  await page.screenshot({ path: 'test-results/loading-cancel/loading.png' });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  check(await page.$eval('.loading-spinner', (e) => getComputedStyle(e).animationName === 'none'), 'spinner respects reduced-motion preference');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await cancel('Waiting for the real join response');
  for (const stage of ['materials', 'weapons', 'preview', 'map']) {
    phase = stage; counts.clear();
    await page.click('#menu .primary'); await page.waitForSelector('#loading.visible');
    const deadline = Date.now() + 240000;
    while (!held.length && Date.now() < deadline) await delay(50);
    check(held.length > 0, `${stage}: actual asset transfer reached the cancellation barrier`);
    await cancel(stage);
  }
  await page.click('#menu .primary'); await page.waitForSelector('#start.visible', { timeout: 240000 });
  check(await page.evaluate(() => window.__crossfire.network().state === 'connected' && window.__crossfire.stats().missingMaterials.length === 0), 'retry after repeated cancellation joins the real match with valid materials');
  check(await page.$$eval('.weapon-card', (cards) => cards.every((card) => card.querySelectorAll('img').length === 1)), 'retry does not duplicate weapon preview images');
  phase = 'rotation'; counts.clear();
  const ns = await worker.getDurableObjectNamespace('ROOM'); const stub = ns.get(ns.idFromName('public-main'));
  try { await stub.advanceMapForTest(); } finally { stub[Symbol.dispose]?.(); }
  await page.waitForSelector('#loading.visible');
  const deadline = Date.now() + 30000;
  while (!held.length && Date.now() < deadline) await delay(50);
  check(held.length > 0, 'real round transition starts the next map load');
  await cancel('Round transition');
  await page.click('#menu .primary'); await page.waitForSelector('#start.visible', { timeout: 240000 });
  await page.click('#start .primary'); await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 15000 });
  check(await page.evaluate(() => { const n = window.__crossfire.network(); return n.snapshot.players.find((p) => p.id === n.selfId).alive; }), 'joining and server-approved spawning still work after cancelling a round transition');
  await page.evaluate(() => window.__crossfire.networkLeave()); await emptyRoom();
  check(errors.length === 0, `no uncaught or unexpected browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); await worker.dispose(); }
