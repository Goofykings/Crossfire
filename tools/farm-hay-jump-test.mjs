/** Real-game check of the Farmstead hay bales (2026-11-13): in the local `?practice` mode (the controller is authoritative, so teleporting sticks), the player runs at a stack with the game's own input and
 * jumps; the position comes from the running simulation. Checks the crown of a round bale (1.08 m), the bale above it (2.03 m) and the walk-off.
 *   node tools/farm-hay-jump-test.mjs [http://localhost:5182/]
 * Screenshots go to test-results/farm-cleanup/hay-jump/. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5182/';
const out = 'test-results/farm-cleanup/hay-jump';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Hay Jump');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
  await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
  await delay(3000);
  const pos = () => page.evaluate(() => { const p = window.__crossfire.player(); return { x: p.x, y: p.y, z: p.z, grounded: p.grounded }; });
  const hold = (a, v) => page.evaluate(([a, v]) => window.__crossfire.hold(a, v), [a, v]);
  const tp = (x, y, z, h) => page.evaluate(([x, y, z, h]) => window.__crossfire.teleport(x, y, z, h, 0), [x, y, z, h]);
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  // The small pyramid at (10, 30): ground bales at z 29.45 and 30.55 (axis along x), the upper bale between them at z 30, 0.95 m up. Run south at the
  // first one and jump about a metre and a half before it: the crown is 1.08 m.
  await tp(10, 0.05, 26.0, 180); await delay(600);
  await hold('forward', true); await delay(150);
  let best = 0;
  for (let i = 0; i < 40; i++) {
    const p = await pos();
    if (p.z > 27.3 && p.grounded && i < 38) { await hold('jump', true); await delay(50); await hold('jump', false); break; }
    await delay(20);
  }
  for (let i = 0; i < 14; i++) { await delay(80); const p = await pos(); best = Math.max(best, p.grounded ? p.y : 0); }
  await hold('forward', false); await delay(500);
  const onFirst = await pos(); await shot('on-first-bale');
  console.log('on first bale', JSON.stringify(onFirst), 'highest standing', best.toFixed(2));
  assert.ok(onFirst.y > 0.95 && onFirst.y < 1.2, `standing on the first round bale (y ${onFirst.y.toFixed(2)})`);
  // second jump toward the upper bale (south, over the notch)
  await tp(10, 1.1, 29.0, 180); await delay(400);
  await hold('forward', true); await delay(60); await hold('jump', true); await delay(60); await hold('jump', false);
  let top = 0, shotTaken = false;
  for (let i = 0; i < 30; i++) {
    await delay(50); const p = await pos();
    if (p.grounded) top = Math.max(top, p.y);
    if (p.grounded && p.y > 1.9 && !shotTaken) { shotTaken = true; await shot('on-top-bale'); }
  }
  await hold('forward', false); await delay(300);
  console.log('highest standing level on the second jump', top.toFixed(2));
  assert.ok(top > 1.95 && top < 2.2, `stood on the upper bale (highest ${top.toFixed(2)})`);
  // walk off the far end
  await hold('forward', true); await delay(2200); await hold('forward', false); await delay(800);
  const down = await pos(); await shot('walked-off');
  console.log('after walking off', JSON.stringify(down));
  assert.ok(down.y < 1.2, `back at a lower level (y ${down.y.toFixed(2)})`);
  assert.equal(errors.length, 0, errors.join(' | '));
  console.log('PASS round hay bales climbed and walked off in the real game');
} catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { await browser.close(); }
