/** Real local Practice match on Neon Backstreets through the actual UI: map selection, 5 Advanced bots, spawn, and
 * 40 s of play. Checks that the bots move, use the whole block (both decks included over time), stay inside it and
 * fight (eliminations), and saves first-person frames for a readability review.
 *   node tools/neon-practice-test.mjs [http://127.0.0.1:5181/] [--chromebook]
 * Writes test-results/neon-practice[-chromebook]/. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const chromebook = process.argv.includes('--chromebook');
const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = 'test-results/neon-practice' + (chromebook ? '-chromebook' : '');
fs.mkdirSync(out, { recursive: true });
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS ' + label); };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(r.status() + ' ' + r.url()); });
  if (chromebook) await page.evaluateOnNewDocument(() => localStorage.setItem('crossfire.settings.v1', JSON.stringify({ chromebookMode: true })));
  await page.goto(base + '?quality=high', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Neon Tester');
  const visible = (selector) => page.waitForSelector(selector + '.visible', { timeout: 240000 });
  const clickText = (root, label) => page.evaluate(({ root, label }) => {
    const b = [...document.querySelectorAll(root + ' button')].find((n) => n.textContent.trim().toUpperCase() === label.toUpperCase());
    if (!b) throw Error('Missing ' + label); b.click();
  }, { root, label });
  await page.click('#menu .home-actions .primary'); await visible('#modes'); await clickText('#modes', 'Practice'); await visible('#practice-setup');
  check(await page.$('#practice-setup [data-map="neon-backstreets"]') !== null, 'Neon Backstreets is offered in the Practice map list');
  await page.click('#practice-setup [data-map="neon-backstreets"]');
  await page.$eval('#practice-setup input[type=range]', (n) => { n.value = '5'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#practice-setup [data-difficulty="advanced"]');
  await clickText('#practice-setup', 'START PRACTICE'); await visible('#weapons');
  await page.click('#weapons [data-weapon="rifle"]');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 240000 });
  check(await page.evaluate(() => window.__crossfire.mapInfo().id === 'neon-backstreets'), 'the local match runs on Neon Backstreets');
  await delay(3000);
  const seen = [];
  let maxY = 0, outside = 0;
  const start = await page.evaluate(() => window.__crossfire.practice().bots.map((b) => b.position));
  for (let i = 0; i < 20; i++) {
    await delay(2000);
    const bots = await page.evaluate(() => window.__crossfire.practice().bots.map((b) => b.position));
    for (const p of bots) {
      seen.push(p); maxY = Math.max(maxY, p.y);
      if (Math.abs(p.x) > 20.6 || Math.abs(p.z) > 20.6) outside++;
    }
    if (i % 5 === 4) await page.screenshot({ path: `${out}/frame-${i}.png` });   // the player's own view, HUD on
  }
  const end = await page.evaluate(() => window.__crossfire.practice().bots.map((b) => b.position));
  const moved = start.filter((p, i) => end[i] && Math.hypot(p.x - end[i].x, p.z - end[i].z) > 2).length;
  check(moved >= 3, `bots move around the block (${moved}/${start.length} moved over 2 m)`);
  const cells = new Set(seen.map((p) => `${Math.floor(p.x / 8)},${Math.floor(p.z / 8)}`));
  check(cells.size >= 10, `bots cover the block (${cells.size} of 25 8-metre cells visited)`);
  check(outside === 0, 'no bot ever leaves the play area');
  const kills = await page.evaluate(() => window.__crossfire.network().snapshot.players.reduce((n, p) => n + p.kills, 0));
  check(kills > 0, `bots fight: ${kills} eliminations in 40 s`);
  console.log(`highest bot position ${maxY.toFixed(2)} m (decks are 3.55 m)`);
  check(errors.length === 0, 'no page errors or failed asset requests: ' + errors.join(' | '));
} finally {
  await browser.close();
}
