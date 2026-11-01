/** Real browser HUD/results plus real WebSocket opponents. No fabricated score events. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/';
const mode = process.argv[3] ?? 'ffa';
const phase3 = process.argv.includes('--phase3');
const out = `test-results/polish-phase${phase3 ? 3 : 2}-${mode}`; fs.mkdirSync(out, { recursive: true });
const check = (v, label) => { assert.ok(v, label); console.log(`PASS ${label}`); };
async function until(fn, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await delay(20); }
  throw new Error(`Timed out: ${label}`);
}
const state = (p) => p.evaluate(() => window.__crossfire.network());
const me = (s) => s.snapshot.players.find((p) => p.id === s.selfId);
const hold = (p, key, value) => p.evaluate((key, value) => window.__crossfire.hold(key, value), key, value);
const fixture = new Miniflare(convertV4MiniflareOptions({ name: `polish-scoring-${mode}`,
  modules: [{ type: 'ESModule', path: fileURLToPath(new URL('../server/tests/runtime-fixture.mjs', import.meta.url)) },
    { type: 'ESModule', path: fileURLToPath(new URL('../server/dist/index.js', import.meta.url)) }],
  compatibilityDate: '2026-10-25', host: '127.0.0.1', port: 0,
  resourcePersistencePath: fs.mkdtempSync('server/.wrangler/polish-scoring-'),
  durableObjects: { ROOM: { className: 'PublicRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: new URL(base).origin, MATCH_MODE: mode }, log: new Log(LogLevel.ERROR) }));
let browser; const sockets = [], timers = [], awards = [], errors = [];
try {
  const backend = (await fixture.ready).href, ns = await fixture.getDurableObjectNamespace('ROOM'), room = ns.get(ns.idFromName('public-main'));
  let round = await room.advanceMapForTest(); while (round.mapId !== 'european-town') round = await room.advanceMapForTest();
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: 120000, protocolTimeout: 240000,
    defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [];
  for (const name of ['Scoring Alpha', 'Scoring Bravo']) {
    const context = await browser.createBrowserContext(), page = await context.newPage(); pages.push(page);
    await page.evaluateOnNewDocument((backend) => {
      const Socket = window.WebSocket;
      window.__polishSocketOpens = 0;
      window.WebSocket = class extends Socket { constructor(url, protocols) { super(new URL(String(url)).pathname === '/ws' ? new URL('/ws', backend).href.replace('http:', 'ws:') : url, protocols); window.__polishSocketOpens++; } };
      const fetch = window.fetch;
      window.fetch = (input, init) => fetch(new URL(String(input), location.href).pathname === '/presence' ? new URL('/presence', backend) : input, init);
    }, backend);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=.6`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await completeGuestProfile(page, name);
    await page.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#error.visible') || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 240000 });
    check(!await page.$('#error.visible'), `${name} joins the real Worker`);
    if (!await page.evaluate(() => window.__crossfire.ready())) await page.click('#start .btn.primary');
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 60000 });
    page.playerId = (await state(page)).selfId;
  }
  const [a, b] = pages, arena = await room.directionalArenaForTest();
  await room.placeForCombatTest(a.playerId, arena.center, 0); await room.placeForCombatTest(b.playerId, arena.observer, 0);
  if (phase3) {
    const before = (await state(a)).snapshot.players.find((p) => p.id === b.playerId).motion.position;
    await hold(b, 'right', true); await delay(350); await hold(b, 'right', false); await delay(250);
    const after = (await state(a)).snapshot.players.find((p) => p.id === b.playerId).motion.position;
    check(Math.hypot(after.x - before.x, after.z - before.z) > .05, 'second browser movement reaches the first browser');
    const opens = await Promise.all(pages.map(async (p) => (await state(p)).diagnostics.opens));
    const stableUntil = Date.now() + 61000;
    while (Date.now() < stableUntil) {
      await delay(5000);
      for (const [i, page] of pages.entries()) {
        const current = await state(page);
        check(current.state === 'connected' && current.diagnostics.opens === opens[i], `stable two-browser connection ${i + 1}`);
        check(new Set(current.snapshot.players.map((p) => p.id)).size === current.snapshot.players.length, 'no duplicate remote identities');
      }
    }
    await room.placeForCombatTest(b.playerId, arena.observer, 0);
  }
  async function openTarget(spawn = true) {
    const ws = new WebSocket(new URL('/ws', backend).href.replace('http:', 'ws:'), { origin: new URL(base).origin }); sockets.push(ws);
    const messages = []; ws.on('message', (raw) => messages.push(JSON.parse(String(raw)))); ws.on('error', () => {});
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const send = (m) => ws.send(JSON.stringify({ v: 12, ...m }));
    send({ type: 'join', name: `Opponent ${sockets.length}` });
    const welcome = await until(() => messages.find((m) => m.type === 'welcome'), 'opponent joins');
    timers.push(setInterval(() => { if (ws.readyState === WebSocket.OPEN) send({ type: 'ping', at: Date.now() }); }, 500));
    if (spawn) {
      send({ type: 'spawn', weapon: 'rifle', requestId: crypto.randomUUID(), roundId: welcome.snapshot.roundId, mapVersion: welcome.snapshot.mapVersion });
      await until(() => messages.find((m) => m.type === 'spawned'), 'opponent spawns');
    }
    return { ws, send, id: welcome.selfId, team: welcome.snapshot.players.find((p) => p.id === welcome.selfId).team, messages };
  }
  if (mode === 'teams') await openTarget(false); // Legitimate balancing makes subsequent targets opponents.
  const expectedAwards = [150, 170, 190, 210, 230, 250, 270];
  let precedingEliminationAt = null;
  for (let i = 0; i < 7; i++) {
    const target = await openTarget();
    if (mode === 'teams') check(target.team !== me(await state(a)).team, 'target is an actual opposing team member');
    await room.placeForCombatTest(target.id, arena.sources.front, 180);
    await a.evaluate((p) => window.__crossfire.aimAt(p[0], p[1] + 1.6, p[2]), arena.sources.front);
    await hold(a, 'aim', true); await delay(300);
    await hold(a, 'fire', true);
    try { await until(() => target.messages.find((m) => m.type === 'elimination' && m.elimination.victimId === target.id), 'real elimination'); }
    finally { await hold(a, 'fire', false); }
    const event = target.messages.find((m) => m.type === 'elimination' && m.elimination.victimId === target.id).elimination;
    awards.push(event.award);
    const gap = precedingEliminationAt === null ? 0 : event.at - precedingEliminationAt;
    precedingEliminationAt = event.at;
    check(event.award.total === expectedAwards[i], `elimination ${i + 1}: ${event.award.total}/${expectedAwards[i]} points, ${gap} ms since previous kill`);
    await until(async () => (await a.$eval('.elimination-confirmation', (e) => e.textContent)).includes(`+${expectedAwards[i]}`), 'earned points feedback');
    if (i === 2) {
      const text = await a.$eval('.elimination-confirmation', (e) => e.textContent);
      check(text.includes('+50 Headshot') && text.includes('+40 Triple Elimination'), 'feedback shows only the earned headshot/combo bonuses');
      check(await a.$$eval('.kill-feed-entry', (rows, name) => rows.filter((r) => r.textContent.includes(name)).length, event.victimName) === 1, 'confirmed elimination appears once in the kill feed');
      await a.screenshot({ path: `${out}/triple-elimination.png` });
    }
    target.send({ type: 'leave' }); await delay(70);
  }
  await hold(a, 'aim', false);
  await until(async () => me(await state(a)).score === 1470, 'full authoritative points');
  await a.keyboard.down('Tab'); await delay(150);
  const board = await a.$eval('.scoreboard', (e) => ({ visible: !e.hidden, text: e.innerText,
    scores: [...e.querySelectorAll('td[data-score]')].map((c) => ({ raw: c.dataset.score, text: c.textContent })) }));
  check(board.visible && board.scores.some((s) => s.raw === '1470' && s.text === '1.4k'), 'Tab leaderboard displays truncated score without changing its numeric value');
  await a.screenshot({ path: `${out}/leaderboard.png` }); await a.keyboard.up('Tab');
  const before = me(await state(a)), deadline = (await state(a)).snapshot.match.endsAt;
  const initialOpens = (await state(a)).diagnostics.opens;
  await a.evaluate(() => window.__crossfire.networkReconnect());
  await until(async () => (await state(a)).state === 'connected' && (await state(a)).diagnostics.opens > initialOpens && me(await state(a)).score === 1470, 'score resume');
  check(me(await state(a)).kills === before.kills && (await state(a)).snapshot.match.endsAt === deadline, 'reconnection retains points, kills and original deadline');
  await a.reload({ waitUntil: 'domcontentloaded', timeout: 240000 });
  await pageReady(a);
  check((await state(a)).selfId === a.playerId && me(await state(a)).score === 1470
    && (await state(a)).snapshot.match.endsAt === deadline, 'browser refresh resumes the same authoritative player and countdown');
  const hud = await a.$eval('.match-hud', (e) => ({ text: e.innerText, hidden: e.hidden }));
  check(!hud.hidden && hud.text.includes(mode === 'teams' ? 'TEAMS' : 'FFA'), 'centered match HUD uses the actual server mode');
  if (mode === 'teams') check((await state(a)).snapshot.match.teamScores[before.team] === 7, 'team HUD retains the existing elimination-based match score');
  const result = (await room.advanceMapForTest()).result;
  await a.waitForSelector('#results.visible', { timeout: 30000 }); await b.waitForSelector('#results.visible', { timeout: 30000 });
  check(await a.$eval('.result-title', (e) => e.textContent) === 'VICTORY', 'winning player sees VICTORY');
  check(await b.$eval('.result-title', (e) => e.textContent) === 'DEFEAT', 'opponent sees DEFEAT');
  check(result.mvp.id === a.playerId && await b.$eval('.result-mvp', (e) => e.textContent.includes('Scoring Alpha') && e.textContent.includes('1470')), 'server-determined MVP name and full points appear on results');
  if (phase3) {
    check(result.players.length === 9 && result.players.some((p) => p.kills === 7 && p.score === 1470 && p.weapon === 'rifle'), 'full frozen roster includes seven departed real opponents and both browsers');
    const rows = await a.$$eval('.result-board tbody tr', (rows) => rows.map((row) => ({ id: row.dataset.playerId, score: row.querySelector('[data-score]')?.textContent, weapon: row.querySelector('[data-weapon]')?.dataset.weapon })));
    check(rows.length === result.players.length && rows.some((p) => p.id === a.playerId && p.score === '1.4k' && p.weapon === 'rifle'), 'complete results show compact points and authoritative weapons');
    check(await a.$eval('.result-board tr.local', (row) => row.dataset.playerId) === a.playerId, 'local results row remains highlighted');
    check(await a.$$eval('.result-team-score', (e) => e.length) === (mode === 'teams' ? 2 : 0), 'only Teams shows actual team match totals');
    for (const [width, height] of [[1366, 768], [1280, 720], [1024, 600]]) {
      await a.setViewport({ width, height }); await delay(800);
      check(await a.$eval('.round-results', (e) => {
        const banner = e.querySelector('.result-title').getBoundingClientRect(), buttons = e.querySelector('.result-actions').getBoundingClientRect();
        return banner.top >= 0 && buttons.bottom <= innerHeight && e.getBoundingClientRect().right <= innerWidth;
      }), `banner and actions fit ${width}x${height}`);
      await a.screenshot({ path: `${out}/victory-${width}.png` });
    }
    await a.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    check(await a.$eval('.result-banner', (e) => getComputedStyle(e).animationName) === 'none', 'reduced-motion skips banner movement and staged delays');
    await a.emulateMediaFeatures([]); await a.setViewport({ width: 1280, height: 720 });
  }
  await a.screenshot({ path: `${out}/victory.png` }); await b.screenshot({ path: `${out}/defeat.png` });
  const resultOpens = (await state(a)).diagnostics.opens;
  await a.evaluate(() => window.__crossfire.networkReconnect()); await a.waitForSelector('#results.visible');
  await until(async () => (await state(a)).state === 'connected' && (await state(a)).diagnostics.opens > resultOpens, 'results reconnect');
  check(JSON.stringify((await state(a)).snapshot.result) === JSON.stringify(result), 'frozen round result survives reconnection');
  await a.evaluate(() => window.__crossfire.networkReconnect());
  await a.click('#results .btn.primary');
  try {
    await a.waitForFunction(() => window.__crossfire?.ready() || (window.__crossfire.network().state === 'connected'
      && document.querySelector('#start.visible .btn.primary:not(:disabled)')), { timeout: 60000 });
    // The normal next-round flow includes loadout/spawn approval. If the
    // diagnostic autoplay spawn raced the disconnect, use that real button.
    if (!await a.evaluate(() => window.__crossfire.ready())) await a.click('#start .btn.primary');
    await a.waitForFunction(() => window.__crossfire.ready(), { timeout: 20000 });
  } catch (error) {
    console.error(await a.evaluate(() => ({ state: window.__crossfire.state(), screens: [...document.querySelectorAll('.screen.visible')].map((e) => e.id),
      connection: window.__crossfire.network().state, error: document.querySelector('#error.visible')?.textContent,
      spawnError: document.querySelector('.spawn-error')?.textContent })));
    throw error;
  }
  check(me(await state(a)).score === 0 && me(await state(a)).comboCount === 0, 'next match resets points and combo after results acknowledgment');
  if (phase3) {
    await b.click('#results .btn.primary');
    await b.waitForFunction(() => window.__crossfire.ready() || document.querySelector('#start.visible .btn.primary:not(:disabled)'), { timeout: 60000 });
    if (!await b.evaluate(() => window.__crossfire.ready())) await b.click('#start .btn.primary');
    await b.waitForFunction(() => window.__crossfire.ready(), { timeout: 30000 });
    await room.advanceMapForTest();
    for (const page of pages) {
      await page.waitForSelector('#results.visible');
      await page.waitForFunction(() => document.querySelector('.result-title')?.textContent === 'DRAW');
    }
    check((await state(a)).snapshot.result.draw, 'actual zero-score next round produces authoritative DRAW');
    await delay(800); await a.screenshot({ path: `${out}/draw.png` });
    const opens = await a.evaluate(() => window.__polishSocketOpens);
    await a.click('#results .result-actions .btn:not(.primary)'); await a.waitForSelector('#menu.visible');
    await delay(1500);
    check((await state(a)).state === 'idle' && await a.evaluate(() => window.__polishSocketOpens) === opens, 'Return to Lobby intentionally disconnects without reconnecting');
    await until(async () => !(await room.snapshotForTest()).players.some((p) => p.id === a.playerId), 'departed browser is removed from the actual room');
    await b.click('#results .result-actions .btn:not(.primary)');
  }
  check(errors.length === 0, `no uncaught errors (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ mode, awards, board, hud, result, errors }, null, 2));
  async function pageReady(page) {
    try { await page.waitForFunction(() => window.__crossfire?.ready() || document.querySelector('#results.visible'), { timeout: 60000 }); }
    catch (error) {
      console.error(await page.evaluate(() => ({ state: window.__crossfire.state(), screens: [...document.querySelectorAll('.screen.visible')].map((e) => e.id),
        error: document.querySelector('#error.visible')?.textContent, connection: window.__crossfire.network().state,
        alive: window.__crossfire.network().snapshot?.players.find((p) => p.id === window.__crossfire.network().selfId)?.alive })));
      throw error;
    }
  }
} finally {
  for (const timer of timers) clearInterval(timer);
  for (const ws of sockets) ws.terminate();
  await browser?.close(); await fixture.dispose();
}
