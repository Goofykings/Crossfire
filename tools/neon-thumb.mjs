/** Captures the Neon Backstreets menu thumbnail from the real game scene and writes public/assets/maps/neon-backstreets/thumb.jpg
 * (384 x 216, the same size as the other maps' thumbnails).   node tools/neon-thumb.mjs [http://127.0.0.1:5181/] */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
await page.goto(`${base}?practice&autoplay&nohud&quality=ultra&map=neon-backstreets`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Thumb');
await page.waitForFunction(() => window.__crossfire.ready() && window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(6000);
// Neon Street from its fenced west end: arcade, mart, ramen blade and the hotel sign in one frame
await page.evaluate(() => window.__crossfire.freeCam(-18.6, 2.1, -15.4, 98, 3));
await delay(1500);
fs.mkdirSync('test-results/neon', { recursive: true });
await page.screenshot({ path: 'test-results/neon/thumb-source.png' });
await browser.close();
execFileSync('python', ['-B', '-I', '-c', "from PIL import Image; Image.open('test-results/neon/thumb-source.png').convert('RGB').resize((384, 216), Image.LANCZOS)"
  + ".save('public/assets/maps/neon-backstreets/thumb.jpg', quality=88)"], { stdio: 'inherit' });
console.log('wrote public/assets/maps/neon-backstreets/thumb.jpg');
