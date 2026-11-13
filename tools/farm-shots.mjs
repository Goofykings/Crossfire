/** Screenshots of the Farmstead from many viewpoints in real Chrome (free camera): aerial overviews, every
 * building from outside and inside, the balconies, the loft, the shacks, the dirt paths and the
 * long sightlines.
 *   node tools/farm-shots.mjs [http://127.0.0.1:5181/] [group ...]      groups: aerial yard buildings inside sight
 * Writes PNGs to test-results/farm/ and contact sheets (test-results/farm/sheet-<group>.png). */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const asked = process.argv.filter((a) => !/^https?:/.test(a) && !a.endsWith('.mjs') && !a.endsWith('node.exe') && !a.includes('\\') && !a.includes('/'));
const out = 'test-results/farm';
fs.mkdirSync(out, { recursive: true });
const EYE = 1.64;
// [label, x, z, heading, pitch, y]; y defaults to standing on the ground
const GROUPS = {
  aerial: [
    ['aerial-sw', -62, 62, 40, -34, 40], ['aerial-se', 62, 62, 320, -34, 40], ['aerial-ne', 60, -62, 225, -33, 40], ['aerial-nw', -60, -62, 135, -33, 40],
    ['aerial-top', 0, 0, 0, -88, 95], ['aerial-south', 0, 78, 0, -30, 34],
  ],
  yard: [
    ['south-gate-looking-north', -2.7, 43, 0, 1], ['south-gate-from-inside', -2.7, 33, 0, 2], ['garage-path-west', -6, 30.4, 270, 1], ['barn-path-north', -26, -3, 0, 3],
    ['cabin-path-north', 21.8, -4, 0, 3], ['house-east-path', 22, -4.4, 270, 2], ['west-yard', -28, 1.4, 270, 2], ['east-yard-north', 28, -16.6, 90, 2],
    ['east-yard-south', 28, 20.5, 90, 2], ['north-yard', 1.8, -38, 0, 2], ['corner-se', 29, 36, 135, 0], ['meadow-trees', -6, -26, 20, 4],
  ],
  buildings: [
    ['house-south', -2, 27, 0, 4], ['house-south-east', 16, 23, 330, 6], ['house-north-west', -22, -15, 120, 6], ['house-balcony-close', 7, 20, 0, 14],
    ['barn-south-forebay', -20, -8, 0, 8], ['barn-west', -40, -30, 90, 6, 5], ['barn-north-east', -2, -42, 255, 8], ['cabin-south', 21.5, -10, 0, 10],
    ['cabin-west', 6, -31, 90, 8], ['cabin-east', 38, -31, 270, 8], ['garage-south-east', -10, 36, 305, 3], ['garage-front', -24, 36, 0, 3],
    ['shack-market', -18.9, -6.5, 0, 3], ['shack-wood', 26.75, 10.8, 180, 3], ['shack-tool', 22, 35.8, 0, 3], ['shack-hay', -10.1, 43, 0, 3],
  ],
  inside: [
    ['house-hall-from-south', -2.8, 7.2, 0, 0], ['house-living', -8, -6, 190, -1], ['house-kitchen', 9.6, -2.4, 300, 0], ['house-dining', 4, 6.5, 70, 0],
    ['house-pantry', -12.8, 6.4, 20, 0], ['house-upper-landing', 2.2, -0.2, 180, 0, 3.4 + EYE], ['house-upper-room', 9, -3, 270, 0, 3.4 + EYE],
    ['house-balcony-south', 8, 9.5, 180, -5, 3.4 + EYE], ['house-balcony-view', 2.9, 13.2, 180, -3, 3.4 + EYE], ['house-stairs-up', 2.2, 5.2, 0, 22],
    ['barn-bay-from-south', -26, -24.6, 0, 8], ['barn-bay-from-north', -26, -36, 180, 2], ['barn-stalls', -13, -33, 90, -2], ['barn-loft-west', -13, -33, 270, -2, 3.0 + EYE],
    ['barn-loft-east', -21.4, -34, 90, -3, 3.0 + EYE], ['barn-forebay-deck', -14, -20, 180, -6, 3.0 + EYE], ['barn-loft-stair', -20.3, -25.5, 0, 24],
    ['cabin-ground-west', 18, -29, 0, 0], ['cabin-ground-east', 27, -32, 270, 0], ['cabin-upper-west', 18, -29.5, 0, 0, 3.4 + EYE], ['cabin-upper-east', 25, -33, 180, 0, 3.4 + EYE],
    ['cabin-balcony-south', 22, -24, 180, -4, 3.4 + EYE], ['cabin-balcony-gap', 21.9, -23.0, 180, -26, 3.4 + EYE], ['cabin-balcony-west', 14.6, -24.8, 0, -3, 3.4 + EYE],
    ['garage-bay', -22, 27, 0, 0], ['garage-bay-north', -23.5, 20.4, 180, 0], ['garage-workshop', -17, 27.4, 0, 0],
  ],
  sight: [
    ['cabin-balcony-to-barn', 15, -23.6, 250, -4, 3.4 + EYE], ['cabin-balcony-to-house', 22, -23.4, 210, -4, 3.4 + EYE], ['barn-forebay-to-south', -22, -19.2, 160, -4, 3.0 + EYE],
    ['house-balcony-to-gate', 5, 13.4, 180, -3, 3.4 + EYE], ['garage-door-to-yard', -24, 27, 90, 0], ['gate-to-house', -2.7, 38, 0, 2],
  ],
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Farm Shots');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(5000);
const sheets = {};
for (const [group, views] of Object.entries(GROUPS)) {
  if (asked.length && !asked.includes(group)) continue;
  const files = [];
  for (const [label, x, z, heading, pitch, y] of views) {
    await page.evaluate(([x, y, z, h, p]) => window.__crossfire.freeCam(x, y, z, h, p), [x, y ?? EYE + 0.0, z, heading, pitch]);
    await delay(850);
    const file = `${out}/${group}-${label}.png`;
    await page.screenshot({ path: file });
    files.push([label, file]);
  }
  sheets[group] = files;
}
await browser.close();
fs.writeFileSync(`${out}/index.json`, JSON.stringify(sheets, null, 1));
console.log('wrote', Object.entries(sheets).map(([n, f]) => `${n}: ${f.length}`).join(', '));
