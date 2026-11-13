/** Real Chrome check that bullets leave their marks on the visible stone of the Farmstead perimeter wall (Practice, rifle):
 * fire a burst at each of the four walls from 6 m, at a pier and at a corner, in the High preset and in Chromebook mode, and
 * photograph the marks. The marks come from the shared raycast, so they sit on the drawn face (see tests/farmPerimeter.test.ts).
 *   node tools/farm-wall-impacts.mjs [http://127.0.0.1:5181/]        writes PNGs to test-results/farm-perimeter/impacts-*.png */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = 'test-results/farm-perimeter';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 600000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Wall Impacts');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(4000);
// [label, x, z, heading, pitch]
const VIEWS = [['north', -8, -41.5, 0, 6], ['south', 6, 39.5, 180, 6], ['west', -31.5, 12, 270, 6], ['east', 31.5, -12, 90, 6], ['pier-north', 6.6, -41.5, 0, 6], ['corner-se', 31, 39, 135, 8]];
for (const mode of ['high', 'chromebook']) {
  await page.evaluate((cb) => window.__crossfire.setSetting({ chromebookMode: cb }), mode === 'chromebook');
  await delay(3000);
  for (const [label, x, z, heading, pitch] of VIEWS) {
    await page.evaluate(([x, z, h, p]) => window.__crossfire.teleport(x, 0, z, h, p), [x, z, heading, pitch]);
    await delay(600);
    await page.evaluate(() => window.__crossfire.hold('fire', true));
    await delay(550);
    await page.evaluate(() => window.__crossfire.hold('fire', false));
    await delay(350);
    await page.screenshot({ path: `${out}/impacts-${mode}-${label}.png` });
    console.log('shot', mode, label);
  }
}
console.log('errors', errors.length, errors.slice(0, 3));
await browser.close();
