/** Close-up review shots for the Farmstead polish: bushes and hedges, the house hall and barn stalls, the shelter's lamps and puddles.
 *   node tools/farm-extra-shots.mjs [url] [outDir] [quality query]    (Vite dev server) */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = args.find((a) => a.startsWith('test-results')) ?? 'test-results/farm2';
const query = args.find((a) => a.startsWith('quality=')) ?? 'quality=high';
const chromebook = args.includes('chromebook');
const only = args.filter((a) => ['bush', 'arch', 'shelter'].includes(a));
fs.mkdirSync(out, { recursive: true });
const EYE = 1.64, U = -3.5 + EYE;
const VIEWS = {
  bush: [['bush-hedge-front', -31, -7.5, 0, 3], ['bush-hedge-close', -31.2, -9.2, 15, 4], ['bush-hedge-yard', 20, 9.5, 0, 3], ['bush-hedge-side', -26.5, -12, 270, 3],
         ['bush-north-pair', 3, -38.5, 0, 6], ['bush-north-close', 1.6, -40.2, 0, 10], ['bush-west', -28.6, 20.4, 270, 6], ['bush-house', 12.9, 4.5, 0, 8], ['bush-far', 20, -14, 0, 3]],
  arch: [['arch-house-hall-north', -3.9, 0.2, 180, 0], ['arch-house-hall-south', -3.9, 7.0, 0, 0], ['arch-house-hall-wide', -1, 6.5, 330, -4], ['arch-house-hall-stair', -3.2, 1.5, 180, 14],
         ['arch-barn-stall2', -16.4, -25.2, 0, 0], ['arch-barn-stall1', -16.4, -35.5, 180, 0], ['arch-barn-stair-top', -16.4, -27.6, 0, 18], ['arch-barn-stalls-wide', -13.2, -26.3, 270, -4]],
  shelter: [['sh-hall-from-stair', -3.2, 8.4, 180, -3, U], ['sh-hall-west', 3.5, 11, 270, -2, U], ['sh-hall-bunks', 0, 12, 180, -3, U], ['sh-tunnel-dry', 4.4, 3.5, 0, -2, U],
            ['sh-junction', 1.6, -13.4, 0, -3, U], ['sh-junction-east', -3, -18.3, 90, -3, U], ['sh-cold', -15.5, 10.5, 270, -3, U], ['sh-cold-south', -19, 5.9, 180, -3, U],
            ['sh-gen', 8.5, 12, 90, -3, U], ['sh-pump', 14.5, 0.5, 90, -4, U], ['sh-bunk', 15, -20, 180, -4, U], ['sh-tool', -5.5, -26, 270, -3, U],
            ['sh-root', -14, -39, 270, -3, U], ['sh-barn-stair-bottom', -16.4, -37.4, 0, -4, U], ['sh-floor-puddle', 1.0, 11.0, 200, -22, U], ['sh-puddle-lamp1', 18.2, -3.4, 0, -11, U], ['sh-puddle-lamp2', -16.6, 10.6, 90, -11, U], ['sh-puddle-lamp3', -2.3, 8.6, 180, -14, U], ['sh-floor-puddle2', -16, 9.0, 170, -26, U]],
};
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto(`${base}?practice&autoplay&nohud&${query}&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Farm Extra');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
if (chromebook) await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
await delay(5000);
const tag = chromebook ? 'cb-' : '';
for (const [group, views] of Object.entries(VIEWS)) {
  if (only.length && !only.includes(group)) continue;
  for (const [label, x, z, heading, pitch, y] of views) {
    await page.evaluate(([x, y, z, h, p]) => window.__crossfire.freeCam(x, y, z, h, p), [x, y ?? EYE, z, heading, pitch]);
    await delay(900);
    await page.screenshot({ path: `${out}/${tag}${label}.png` });
  }
}
await browser.close();
