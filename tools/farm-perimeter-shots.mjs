/** Review screenshots of the Farmstead perimeter wall and its foliage in real Chrome (free camera, Practice map):
 * the wall from inside, its four corners, piers, plinth, coping and vines, the aerials, hedges (broadside, end-on and from above),
 * the oaks and pines from every side, the underground entrances, and the same views in Chromebook mode.
 *   node tools/farm-perimeter-shots.mjs [http://127.0.0.1:5181/] [group ...]      groups: wall corners hedges trees entrances chromebook
 * Writes PNGs and contact sheets to test-results/farm-perimeter/. */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const asked = process.argv.slice(2).filter((a) => !/^https?:/.test(a));
const out = 'test-results/farm-perimeter';
fs.mkdirSync(out, { recursive: true });
const EYE = 1.64;
// [label, x, z, heading, pitch, y]: compass heading (0 = north, 90 = east), y defaults to eye height
const GROUPS = {
  wall: [
    ['north-wall-from-yard', -6, -38, 0, 4], ['north-wall-close', -14, -44.2, 0, 6], ['north-wall-along-east', -30, -46, 90, 3], ['east-wall-from-yard', 28, -8, 90, 4],
    ['east-wall-close', 34, 5, 90, 8], ['south-wall-from-yard', 8, 34, 180, 4], ['south-wall-close', 0, 43, 180, 10], ['west-wall-from-yard', -27, 14, 270, 4],
    ['west-wall-along-south', -36, -40, 180, 3], ['wall-top-from-above', -20, -41, 0, -35, 8], ['pier-close', -36, 8, 270, 6], ['wall-from-barn-forebay', -28, -19, 270, -2, 3.0 + EYE],
  ],
  corners: [
    ['corner-nw', -30, -40, 315, 6], ['corner-ne', 30, -40, 45, 6], ['corner-se', 30, 38, 135, 6], ['corner-sw', -30, 38, 225, 6],
    ['corner-nw-close', -35, -45, 315, 8], ['corner-se-close', 35, 43.5, 135, 8],
    ['aerial-nw', -52, -58, 135, -30, 30], ['aerial-se', 52, 58, 315, -30, 30], ['aerial-top', 0, 0, 0, -89, 110], ['aerial-south', 0, 90, 0, -24, 40],
  ],
  hedges: [
    ['tall-broadside', -26, -12, 270, 3], ['tall-endon', -22, -12, 270, 2], ['tall-from-above', -31, -12, 0, -75, 9], ['tall-side-angle', -27.5, -8, 315, 8],
    ['wide-broadside', -9.5, -6, 0, 3], ['wide-top', -9.5, -11.5, 0, -80, 9], ['block-corner', 17, 2, 45, 5], ['block-end', 25.5, 5, 270, 4],
    ['run-broadside', 29, 3.5, 180, 3], ['thin-end', 31, -5.5, 0, 3], ['short-low-pair', 20, 11, 0, 2], ['low-hedge', 12.5, -6.5, 0, 2],
    ['strip-west', -33.5, -26, 270, 4], ['strip-east', 31, -24, 90, 4], ['strip-north', -15, -42, 0, 4], ['strip-south', 14, 40, 180, 5],
  ],
  trees: [
    ['oak-front', -8.6, -22.5, 0, 12], ['oak-side', -2, -29.3, 270, 12], ['oak-back', -8.6, -36.5, 180, 12], ['oak-top', -8.6, -29.3, 0, -85, 18],
    ['oak-canopy-under', -8.6, -29.3, 0, 60, 1.7], ['oaks-row', 0, -14, 0, 3], ['pine-side', -30, -14.4, 270, 4], ['pine-far', -22, -14.4, 270, 10],
    ['pine-top', -34.7, -14.4, 0, -85, 16], ['pine-close', -34.7, -9.5, 180, 14], ['bush-close', -13.3, -12.8, 180, -6], ['bushes-row', -17, -9.6, 90, -2],
  ],
  entrances: [
    ['north-portal-street', -7, -29, 60, -10, 1.7], ['east-portal-street', 12, 9, 90, -8, 1.7], ['southwest-portal-street', -20, 12, 0, -12, 1.7],
    ['house-hall-stair', -3.2, 11, 180, -3, 1.7], ['gate-to-house', -2.7, 38, 0, 2],
  ],
};
// the same viewpoints with Chromebook mode on
const CHROMEBOOK = [...GROUPS.wall.slice(0, 4), ...GROUPS.corners.slice(0, 2), ...GROUPS.hedges.slice(0, 3), ...GROUPS.trees.slice(0, 2)];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 600000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.log('PAGEERR', String(e)); });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) { errors.push(m.text()); console.log('CONSOLE', m.text().slice(0, 200)); } });
await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Perimeter Shots');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(5000);

async function sheet(name, files, columns = 3) {
  const p = await browser.newPage();
  const images = files.map(([label, file]) => ({ label, src: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') }));
  const w = 640, h = 360, rows = Math.ceil(images.length / columns);
  await p.setViewport({ width: columns * w, height: rows * (h + 22) });
  await p.setContent(`<body style="margin:0;background:#111;font:13px sans-serif;color:#eee;display:grid;grid-template-columns:repeat(${columns},${w}px)">${
    images.map((i) => `<figure style="margin:0"><img src="${i.src}" style="width:${w}px;height:${h}px;object-fit:cover;display:block"><figcaption style="height:22px;line-height:22px;padding:0 6px">${i.label}</figcaption></figure>`).join('')}</body>`);
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await p.screenshot({ path: `${out}/sheet-${name}.png` });
  await p.close();
}

async function shoot(prefix, views) {
  const files = [];
  for (const [label, x, z, heading, pitch, y] of views) {
    await page.evaluate(([x, y, z, h, p]) => window.__crossfire.freeCam(x, y, z, h, p), [x, y ?? EYE, z, heading, pitch]);
    await delay(900);
    const file = `${out}/${prefix}-${label}.png`;
    await page.screenshot({ path: file });
    files.push([label, file]);
  }
  return files;
}

const sheets = {};
for (const [group, views] of Object.entries(GROUPS)) {
  if (asked.length && !asked.includes(group)) continue;
  sheets[group] = await shoot(group, views);
  await sheet(group, sheets[group]);
}
if (!asked.length || asked.includes('chromebook')) {
  await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
  await delay(4000);
  const info = await page.evaluate(() => ({ foliage: window.__crossfire.foliage(), stats: window.__crossfire.stats() }));
  console.log('chromebook foliage', JSON.stringify(info.foliage), 'draw calls', info.stats.drawCalls);
  sheets.chromebook = await shoot('chromebook', CHROMEBOOK);
  await sheet('chromebook', sheets.chromebook);
  await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: false }));
}
const foliage = await page.evaluate(() => window.__crossfire.foliage());
console.log('foliage cells', JSON.stringify(foliage), 'errors', errors.length);
await browser.close();
fs.writeFileSync(`${out}/index.json`, JSON.stringify({ sheets, errors }, null, 1));
console.log('wrote', Object.entries(sheets).map(([n, f]) => `${n}: ${f.length}`).join(', '));
