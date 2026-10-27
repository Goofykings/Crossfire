import { completeGuestProfile } from './guest-profile-helper.mjs';
/** Two independent browser sessions against running Vite + Wrangler. No fake players.
 * VITE_MULTIPLAYER_URL must be set before starting Vite.
 * node tools/multiplayer-test.mjs [--url http://127.0.0.1:5180/]
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const i = process.argv.indexOf('--url');
const base = i < 0 ? 'http://127.0.0.1:5180/' : process.argv[i + 1];
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true,
  defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const errors = [];
const wire = new WeakMap();
const check = (condition, message) => { assert.ok(condition, message); console.log(`PASS  ${message}`); };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function open(context) {
  const page = await context.newPage();
  const frames = [];
  wire.set(page, frames);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    try {
      const m = JSON.parse(response.payloadData);
      if (m.type) frames.push({ type: m.type, id: m.id, code: m.code, at: m.snapshot?.serverTime, ids: m.snapshot?.players.map((p) => p.id) });
      if (frames.length > 20) frames.shift();
    } catch {}
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=low`, { waitUntil: 'domcontentloaded' });
  await completeGuestProfile(page);
  await page.waitForFunction(() => window.__crossfire?.ready() || document.querySelector('#error.visible'), { timeout: 240000 });
  const state = await page.evaluate(() => ({ network: window.__crossfire.network(), error: document.querySelector('#error.visible p')?.textContent }));
  assert.ok(!state.error, state.error);
  return page;
}
const state = (p) => p.evaluate(() => window.__crossfire.network());
try {
  const contextA = await browser.createBrowserContext();
  const contextB = await browser.createBrowserContext();
  const a = await open(contextA), b = await open(contextB);
  await a.waitForFunction(() => window.__crossfire.network().snapshot?.players.length === 2, { timeout: 15000 });
  await b.waitForFunction(() => window.__crossfire.network().rendered.length === 1, { timeout: 15000 });
  const sa = await state(a), sb = await state(b);
  const aId = sa.selfId, bId = sb.selfId;
  check(aId !== bId && sa.snapshot.room === 'public-main' && sb.snapshot.room === 'public-main', 'independent browser sessions join public-main with distinct IDs');
  check(sa.snapshot.players.length === 2 && sb.snapshot.players.length === 2, 'both browsers receive exactly the two real connected players');
  check(await a.evaluate(() => window.__crossfire.mapInfo().targets.length === 24), 'original map data is preserved');
  // Public movement-test scenes omit practice target colliders/visuals, unlike the practice path.
  const start = (await state(a)).snapshot.players.find((p) => p.id === aId).motion.position;
  await a.evaluate(() => window.__crossfire.hold('forward', true));
  await delay(1000);
  await a.evaluate(() => window.__crossfire.hold('forward', false));
  await delay(500);
  const moved = (await state(b)).snapshot.players.find((p) => p.id === aId).motion.position;
  const distance = Math.hypot(moved.x - start.x, moved.z - start.z);
  check(distance > 1 && distance < 6, `browser A input produces validated movement visible to browser B (${distance.toFixed(2)} m)`);
  const rendered = (await state(b)).rendered.find((p) => p.id === aId);
  check(rendered && Math.hypot(rendered.x - moved.x, rendered.z - moved.z) < 0.5, 'remote body interpolates to the actual server position');
  await a.evaluate(() => window.__crossfire.look(90, 10));
  await delay(500);
  const orientation = (await state(b)).snapshot.players.find((p) => p.id === aId).motion;
  check(Math.abs(orientation.yaw + Math.PI / 2) < 0.02 && Math.abs(orientation.pitch - Math.PI / 18) < 0.02, 'yaw and pitch synchronize through real WebSockets');

  await a.evaluate(() => window.__crossfire.networkReconnect());
  await b.waitForFunction((id) => !window.__crossfire.network().snapshot.players.some((p) => p.id === id), { timeout: 5000 }, aId);
  await a.waitForFunction(() => window.__crossfire.network().state === 'connected', { timeout: 15000 });
  await b.waitForFunction(() => window.__crossfire.network().snapshot.players.length === 2, { timeout: 15000 });
  check((await state(a)).selfId === aId, 'automatic reconnection resumes the original authenticated player');
  check((await state(b)).snapshot.players.filter((p) => p.id === aId).length === 1, 'reconnection does not duplicate players');

  await b.evaluate(() => window.__crossfire.networkLeave());
  await a.waitForFunction(() => window.__crossfire.network().snapshot.players.length === 1 && window.__crossfire.network().rendered.length === 0, { timeout: 5000 });
  check((await state(a)).snapshot.players[0].id === aId, 'leaving removes the real remote player and rendered body');
  await contextB.close();

  // Exercise an actual failed connection and bounded automatic retries using browser network controls.
  await a.setOfflineMode(true);
  await a.evaluate(() => window.__crossfire.networkReconnect());
  await a.waitForSelector('#error.visible', { timeout: 60000 });
  check(await a.$$eval('#error button', (buttons) => buttons.map((b) => b.textContent.trim()).join(',') === 'Retry,Back'), 'failed connections show Retry and Back, with no practice fallback');
  await a.setOfflineMode(false);
  await a.click('#error .btn.primary');
  await a.waitForFunction(() => window.__crossfire.ready(), { timeout: 20000 });
  check((await state(a)).state === 'connected', 'Retry recovers a real server connection');
  await a.evaluate(() => window.__crossfire.networkLeave());
  check(await a.evaluate(() => document.querySelector('.logo')?.getAttribute('aria-label') === 'CROSSFIRE'
    && /^PLAY \d+ Players? Online$/.test(document.querySelector('#menu').innerText.trim().split(/\s+/).join(' '))
    && document.querySelectorAll('.home-nav button').length === 2), 'normal home layout remains minimal');
  check(errors.length === 0, `no uncaught browser errors: ${errors.join('; ')}`);
  await contextA.close();
} catch (error) {
  for (const page of await browser.pages()) {
    try { console.log('Browser diagnostic', await page.evaluate(() => ({ state: window.__crossfire?.network().state,
      self: window.__crossfire?.network().selfId, count: window.__crossfire?.network().snapshot?.players.length,
      at: window.__crossfire?.network().snapshot?.serverTime, error: document.querySelector('#error.visible p')?.textContent })), wire.get(page)); } catch {}
  }
  throw error;
} finally { await browser.close(); }
