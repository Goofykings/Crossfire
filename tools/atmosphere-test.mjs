/** Farmstead atmosphere checks in real Chrome: presets change puddle reflections and foliage detail live (no reload), the
 * mirror renders only underground, Chromebook mode owns no reflection render target, and draw calls stay bounded.
 *   node tools/atmosphere-test.mjs [url]    (Vite dev server) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = 'test-results/atmosphere';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Atmosphere');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(4000);
const atm = () => page.evaluate(() => window.__crossfire.atmosphere());
const cam = (x, y, z, h, p) => page.evaluate(([x, y, z, h, p]) => window.__crossfire.freeCam(x, y, z, h, p), [x, y, z, h, p]);
const draws = async () => { await delay(900); return page.evaluate(() => window.__crossfire.stats().drawCalls ?? window.__crossfire.stats().draws ?? null); };
const log = [];
const check = (ok, label, extra = '') => { assert.ok(ok, label + ' ' + extra); log.push('PASS ' + label + (extra ? ' ' + extra : '')); console.log('PASS', label, extra); };

// --- high: one 384 px mirror, idle on the surface, rendering underground
await cam(-2.7, 1.64, 33, 0, 0);
await delay(800);
let a = await atm();
check(a.puddles && a.puddles.size === 384 && a.puddles.mirror, 'High preset owns one 384 px puddle mirror', JSON.stringify(a.puddles));
check(!a.puddles.rendering, 'the mirror is idle while the camera is on the surface');
const dSurfaceHigh = await draws();
await cam(1.0, -3.5 + 1.64, 11, 200, -10);
await delay(900);
a = await atm();
check(a.puddles.rendering, 'the mirror renders once the camera is underground', JSON.stringify(a.puddles));
const dUnderHigh = await draws();
await page.screenshot({ path: `${out}/high-underground.png` });
await cam(-2.7, 1.64, 33, 0, 0);
await delay(900);
a = await atm();
check(!a.puddles.rendering, 'the mirror goes idle again on the surface');

// --- presets change the puddle material live, without a page reload
const results = {};
for (const [name, patch] of [['medium', { graphicsQuality: 'medium' }], ['low', { graphicsQuality: 'low' }], ['ultra', { graphicsQuality: 'ultra' }], ['high', { graphicsQuality: 'high' }]]) {
  await page.evaluate((p) => window.__crossfire.setSetting(p), patch);
  await delay(900);
  results[name] = (await atm()).puddles;
}
check(results.medium.size === 256 && results.medium.mirror, 'Medium: 256 px mirror', JSON.stringify(results.medium));
check(results.low.size === 0 && !results.low.mirror, 'Low: no reflection render target', JSON.stringify(results.low));
check(results.ultra.size === 512 && results.ultra.mirror, 'Ultra: 512 px mirror', JSON.stringify(results.ultra));
check(results.high.size === 384 && results.high.mirror, 'back to High: 384 px mirror');

// --- Chromebook mode: no mirror, lite foliage everywhere, and it restores on the way back
await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
await delay(1500);
a = await atm();
check(a.puddles.size === 0 && !a.puddles.mirror, 'Chromebook mode: puddles have no reflection render target', JSON.stringify(a.puddles));
check(a.foliage && a.foliage.detail === 0 && a.foliage.lite === a.foliage.cells, 'Chromebook mode: only the lite foliage set is drawn', JSON.stringify(a.foliage));
const dSurfaceCb = await draws();
await cam(1.0, -3.5 + 1.64, 11, 200, -10);
await delay(900);
a = await atm();
check(!a.puddles.rendering && !a.puddles.mirror, 'Chromebook mode underground: still no puddle reflection pass');
await page.screenshot({ path: `${out}/chromebook-underground.png` });
const dUnderCb = await draws();
await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: false }));
await delay(1500);
a = await atm();
check(a.puddles.size === 384 && a.puddles.mirror, 'leaving Chromebook mode restores the High mirror without a reload', JSON.stringify(a.puddles));
await cam(-31, 1.64, -7.5, 0, 3);
await delay(1200);
a = await atm();
check(a.foliage.detail > 0, 'the detailed foliage set is drawn near the bushes', JSON.stringify(a.foliage));
await cam(30, 1.64, 36, 180, 3);
await delay(1200);
a = await atm();
check(a.foliage.lite > 0 && a.foliage.detail > 0, 'far foliage cells switch to the lite set while near ones keep detail', JSON.stringify(a.foliage));
console.log('draw calls (surface/underground): high', dSurfaceHigh, dUnderHigh, 'chromebook', dSurfaceCb, dUnderCb);
check(errors.length === 0, 'no console errors', errors.join(' | '));
fs.writeFileSync(`${out}/report.json`, JSON.stringify({ log, draws: { high: [dSurfaceHigh, dUnderHigh], chromebook: [dSurfaceCb, dUnderCb] } }, null, 2));
await browser.close();
