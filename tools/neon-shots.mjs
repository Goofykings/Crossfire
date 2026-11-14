/** Screenshots of Neon Backstreets from many viewpoints in real Chrome (free camera, local Practice with no bots).
 *   node tools/neon-shots.mjs [http://127.0.0.1:5181/] [group ...] [--chromebook] [--quality=low|medium|high|ultra]
 * Groups: aerial street lanes crossing inside elevated. Writes PNGs to test-results/neon[-chromebook]/ plus a
 * contact sheet per group (sheet-<group>.png). */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const chromebook = args.includes('--chromebook');
const quality = (args.find((a) => a.startsWith('--quality=')) ?? '--quality=high').split('=')[1];
const asked = args.filter((a) => !/^https?:/.test(a) && !a.startsWith('--'));  // group names
const out = `test-results/neon${chromebook ? '-chromebook' : quality === 'high' ? '' : '-' + quality}`;
fs.mkdirSync(out, { recursive: true });
const EYE = 1.64, UP = 3.55;
// [label, x, z, heading, pitch, y]; y defaults to eye height on the street
const GROUPS = {
  aerial: [['aerial-sw', -30, 30, 45, -38, 30], ['aerial-ne', 28, -28, 225, -36, 28], ['aerial-top', 0, 0.5, 0, -89, 62], ['aerial-se', 30, 28, 315, -34, 26]],
  street: [
    ['neon-st-from-west', -18.5, -16.3, 90, 3], ['neon-st-from-east', 16, -16.6, 270, 3], ['neon-st-north-walk', -6, -19.2, 100, 2, .15 + EYE],
    ['mart-front', -10, -17.6, 180, 6], ['ramen-front', 6.5, -18.2, 180, 8], ['west-fence-vista', -14, -16.5, 270, 2], ['ne-corner', 12, -15.5, 60, 4],
  ],
  lanes: [
    ['west-lane-south', -17.5, -11, 180, 2], ['west-lane-north', -17, 13, 0, 2], ['noodle-alley', -2.7, -12.8, 180, 10], ['noodle-alley-up', -2.7, -6, 0, 18],
    ['back-alley-east', -18, 17.5, 90, 2], ['back-alley-west', 18, 17.5, 270, 2], ['east-lane-south', 16, -12, 180, 3], ['east-lane-north', 16, 13, 0, 4],
    ['east-gap-vista', 15, 8.4, 90, 2], ['south-gap-vista', -4.6, 12, 180, 2],
  ],
  crossing: [
    ['crossing-from-west', -16, 0.5, 90, 3], ['crossing-from-east', 12.8, 1.5, 270, 2], ['crossing-to-balcony', 3, 3.5, 0, 14], ['crossing-to-terrace', 2, -2, 180, 12],
    ['market-court', -1, 14, 0, 4], ['underpass', 8, 14.4, 0, 2], ['kiosk-pillar', -6, 3.8, 70, 4], ['under-balcony', 0.5, -3.4, 90, 2],
  ],
  inside: [
    ['mart-aisles', -6.6, -11.4, 230, -4], ['mart-back', -13.8, -5.2, 40, -2], ['ramen-dining', 1.2, -8.6, 90, -4], ['ramen-kitchen-stair', 9.2, -5.6, 330, 10],
    ['laundromat', -6.2, 6, 240, -4], ['laundromat-back', -13, 13.6, 45, -2], ['se-stairwell', 11, 14.2, 0, 18], ['upper-room', 9.8, -6, 270, -3, UP + EYE],
  ],
  elevated: [
    ['balcony-west', 1.2, -3.6, 90, -6, UP + EYE], ['balcony-to-terrace', 6, -3.4, 175, -8, UP + EYE], ['terrace-to-balcony', 6, 5.4, 0, -6, UP + EYE],
    ['terrace-east', 11, 6.5, 300, -6, UP + EYE], ['upper-room-window', 6, -11.4, 0, -6, UP + EYE], ['court-landing', 2.3, 7.6, 0, -4, UP + EYE],
  ],
};

// --cam=label:x,z,heading,pitch[,y] adds a one-off group "cam" (several allowed) for quick before/after checks
const camArgs = args.filter((a) => a.startsWith('--cam='));
if (camArgs.length) {
  GROUPS.cam = camArgs.map((a) => { const [label, nums] = a.slice(6).split(':'); const [x, z, h, p, y] = nums.split(',').map(Number); return [label, x, z, h, p, y]; });
  if (!asked.length) asked.push('cam');
}
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto(`${base}?practice&autoplay&nohud&quality=${quality}&map=neon-backstreets`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Neon Shots');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
if (chromebook) await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
await delay(5000);
const missing = await page.evaluate(() => window.__crossfire.stats().missingMaterials);
if (missing?.length) console.log('MISSING MATERIALS', missing);
const sheets = {};
for (const [group, views] of Object.entries(GROUPS)) {
  if (asked.length && !asked.includes(group)) continue;
  const files = [];
  for (const [label, x, z, heading, pitch, y] of views) {
    await page.evaluate(([x, y, z, h, p]) => window.__crossfire.freeCam(x, y, z, h, p), [x, y ?? EYE, z, heading, pitch]);
    await delay(900);
    const file = `${out}/${group}-${label}.png`;
    await page.screenshot({ path: file });
    files.push(file);
  }
  sheets[group] = files;
  // contact sheet: 2 columns of half-size shots
  const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(2,480px);gap:2px">${files.map((f) =>
    `<div style="position:relative"><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="width:480px;display:block"><span style="position:absolute;left:4px;top:2px;color:#fff;font:12px sans-serif;text-shadow:0 0 3px #000">${f.split('/').pop()}</span></div>`).join('')}</body>`;
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: 962, height: Math.ceil(files.length / 2) * 272 });
  await sheet.setContent(html);
  await sheet.screenshot({ path: `${out}/sheet-${group}.png`, fullPage: true });
  await sheet.close();
}
await browser.close();
console.log('wrote', Object.entries(sheets).map(([n, f]) => `${n}: ${f.length}`).join(', '), 'to', out);
