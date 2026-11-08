/** Captures the Farmstead menu thumbnail source from the real game scene (tools/farm-thumb.py crops it to 384 x 216).
 *   node tools/farm-thumb.mjs [http://127.0.0.1:5181/] */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Thumb');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(5000);
// the yard seen from the south-west, low enough to stay out of the distance fog
await page.evaluate(() => window.__crossfire.freeCam(-38, 21, 50, 36, -23));
await delay(1500);
fs.mkdirSync('test-results/farm', { recursive: true });
await page.screenshot({ path: 'test-results/farm/thumb-source.png' });
await browser.close();
console.log('wrote test-results/farm/thumb-source.png; then: python -B -I tools/farm-thumb.py');
