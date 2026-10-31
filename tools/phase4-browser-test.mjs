/** Two actual browser players, real server combat, and a local Durable Object. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4198/crossfire/';
const out = 'test-results/phase4-browser'; fs.mkdirSync(out, { recursive: true });
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const check = (v, label) => { assert.ok(v, label); console.log(`PASS ${label}`); };
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
const fixture = new Miniflare(convertV4MiniflareOptions({ name: 'phase4-browser',
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/phase4-browser-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: 'ffa' }, log: new Log(LogLevel.ERROR) }));
let browser;
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM');
  const room = ns.get(ns.idFromName('public-main'));
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000,
    defaultViewport: { width: 1100, height: 720 }, protocolTimeout: 240000,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [], errors = [];
  for (const [index, name] of ['Killer Guest', 'Victim Guest'].entries()) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.evaluateOnNewDocument((server, weapon) => {
      localStorage.setItem('crossfire.pending-weapon', weapon);
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', server).href.replace('http:', 'ws:') : url, protocols); }
      };
      const fetch = window.fetch;
      window.fetch = (input, init) => fetch(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', server) : input, init);
    }, backend, index ? 'rifle' : 'sniper');
    await page.goto(`${base}?multiplayer${index ? '' : '&autoplay'}&quality=low&shadows=off&scale=0.5`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    if (index) await page.click('#menu .home-actions .primary');
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible')
      || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    const error = await page.$eval('#error', (e) => e.classList.contains('visible') ? e.innerText : '');
    check(!error, `${name} joins (${error})`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
    page.id = (await page.evaluate(() => window.__crossfire.network())).selfId;
  }
  const [killer, victim] = pages;
  const arena = await room.leanArenaForTest();
  await room.placeForCombatTest(killer.id, arena.shooter, 0);
  await room.placeForCombatTest(victim.id, arena.victim, 0);
  await delay(1000);
  const dx = arena.victim[0] - arena.shooter[0], dz = arena.victim[2] - arena.shooter[2];
  const heading = Math.atan2(dx, -dz) * 180 / Math.PI;
  const pitch = Math.atan2(arena.victim[1] + 1.66 - arena.shooter[1] - 1.64, Math.hypot(dx, dz)) * 180 / Math.PI;
  await killer.evaluate((h, p) => { window.__crossfire.look(h, p); window.__crossfire.hold('aim', true); }, heading, pitch);
  await delay(1200);
  await killer.evaluate(() => window.__crossfire.hold('fire', true));
  await until(async () => (await victim.evaluate(() => window.__crossfire.network())).snapshot.players.find((p) => p.id === victim.id)?.death,
    'server-confirmed elimination', 15000);
  await killer.evaluate(() => { window.__crossfire.hold('fire', false); window.__crossfire.hold('aim', false); });
  const death = (await victim.evaluate(() => window.__crossfire.spectate())).death;
  check(death.killerId === killer.id && death.victimId === victim.id && death.weapon === 'sniper'
    && death.respawnAt - death.at === 3000, 'actual damage creates the authoritative elimination and deadline');
  await victim.waitForSelector('#spectate.visible');
  check(await victim.$eval('.respawn-button', (b) => b.disabled), 'respawn is disabled immediately');
  check(await victim.$eval('.respawn-button', (b) => { const [r, g, blue] = getComputedStyle(b).backgroundColor.match(/\d+/g).map(Number);
    return Math.max(r, g, blue) - Math.min(r, g, blue) < 30; }), 'disabled respawn button is gray');
  check((await victim.$eval('.spectate-by', (e) => e.textContent)).includes('Killer Guest'), 'victim sees the actual killer');
  await until(async () => !(await killer.evaluate((id) => window.__crossfire.network().rendered.some((p) => p.id === id), victim.id)),
    'eliminated body fades and is removed', 5000);
  check(true, 'the eliminated remote body disappears after its death animation');
  await until(async () => (await killer.$eval('.kill-feed', (e) => e.textContent)).includes('Victim Guest'), 'kill feed');
  check(await killer.$eval('.elimination-confirmation', (e) => e.textContent.includes('ELIMINATION') && e.textContent.includes('Victim Guest')),
    'killer receives a server-confirmed elimination notification');
  check(await killer.$eval('.kill-feed-entry', (e) => e.querySelector('.combat-name-friendly')?.textContent === 'Killer Guest'
    && e.querySelector('.combat-name-opponent')?.textContent === 'Victim Guest'
    && e.querySelector('svg')?.dataset.weapon === 'sniper'), 'kill feed shows actual names, relationship colors and weapon');
  await victim.screenshot({ path: `${out}/spectate.png` });
  await room.dropSocketForTest(victim.id);
  await until(async () => (await victim.evaluate(() => window.__crossfire.network())).state === 'connected', 'victim reconnects');
  const resumed = await until(async () => { const s = await victim.evaluate(() => window.__crossfire.spectate()); return s.death?.id === death.id && s; }, 'same spectator session');
  check(resumed.death.respawnAt === death.respawnAt, 'reconnection retains the same elimination and respawn deadline');
  const camera = await until(async () => { const s = await victim.evaluate(() => window.__crossfire.spectate());
    return s.target && Math.hypot(...s.target.map((v, i) => v - s.camera[i])) < .45 && s; }, 'camera follows actual killer');
  check(!!camera.target, 'spectator camera follows the synchronized killer viewpoint');
  await victim.click('.spectate-controls .btn:nth-of-type(1)');
  await victim.click('#weapons .weapon-card[data-weapon="shotgun"]');
  check(await victim.$('#spectate.visible'), 'weapon selection returns to spectating');
  check((await killer.evaluate(() => window.__crossfire.network())).snapshot.players.find((p) => p.id === killer.id).weapon === 'sniper',
    'selecting a next-life weapon does not change the killer loadout');
  await victim.click('.spectate-controls .btn:nth-of-type(2)');
  await victim.waitForSelector('#settings.visible');
  await victim.evaluate(() => [...document.querySelectorAll('#settings .settings-foot button')].find((b) => b.textContent.trim() === 'Back').click());
  check(await victim.$('#spectate.visible'), 'settings Back returns to spectating');
  check((await killer.$$eval('.kill-feed-entry', (rows) => rows.length)) <= 1, 'no duplicate kill feed event after reconnect');
  await killer.evaluate(() => window.__crossfire.networkLeave());
  await until(async () => !(await victim.evaluate(() => window.__crossfire.spectate())).target, 'killer leaves');
  check((await victim.evaluate(() => window.__crossfire.spectate())).camera.every(Number.isFinite), 'spectator retains a safe view after the killer leaves');
  await until(async () => !(await victim.$eval('.respawn-button', (b) => b.disabled)), 'respawn becomes eligible', 12000);
  await victim.click('.respawn-button');
  await victim.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
  const life = (await victim.evaluate(() => window.__crossfire.network())).snapshot.players.find((p) => p.id === victim.id);
  check(life.alive && life.weapon === 'shotgun' && life.death === null, 'respawn uses the selected server-approved weapon');
  check(await victim.evaluate(() => window.__crossfire.state() === 'playing'), 'normal pointer-lock play resumes after respawn');
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
} finally { await browser?.close(); await fixture.dispose(); }
