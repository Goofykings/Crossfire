/** Review screenshots for the 2026-11-12 Farmstead clean-up (no yard fence, higher wall without extensions, thin vines, rounded bushes and hedges,
 * large hay bales, no underground), in real Chrome with a free camera in a Practice match on the Farmstead.
 *   node tools/farm-cleanup-shots.mjs [http://localhost:5182/] [group ...] [--chromebook]
 * groups: wall vines bushes hedges hay entrances aerial   (default: all). Writes PNGs and contact sheets to test-results/farm-cleanup/<mode>/. */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5182/';
const chromebook = process.argv.includes('--chromebook');
const asked = process.argv.slice(2).filter((a) => !/^https?:/.test(a) && !a.startsWith('--'));
const out = `test-results/farm-cleanup/${chromebook ? 'chromebook' : 'high'}`;
fs.mkdirSync(out, { recursive: true });
const EYE = 1.64;
// [label, x, z, heading, pitch, y]: compass heading (0 = north, 90 = east), y defaults to eye height
const GROUPS = {
  wall: [
    ['north-from-yard', -6, -38, 0, 6], ['north-close', -14, -44.2, 0, 8], ['north-along', -30, -46, 90, 4], ['east-from-yard', 28, -8, 90, 6],
    ['east-close', 34, 5, 90, 10], ['south-from-yard', 8, 34, 180, 6], ['south-close', 0, 43, 180, 12], ['west-from-yard', -27, 14, 270, 6],
    ['west-along', -36, -40, 180, 4], ['top-from-above', -20, -41, 0, -35, 8], ['pier-close', -36, 8, 270, 8], ['corner-nw', -30, -40, 315, 8],
    ['corner-se', 30, 38, 135, 8], ['wall-from-barn-forebay', -28, -19, 270, -2, 3.0 + EYE],
  ],
  vines: [
    ['vine-foot-close', -20, -46.2, 0, 6, 1.0], ['vine-mid-close', -22, -45.6, 0, 10, 2.2], ['vine-top-close', -24, -45.4, 0, 18, 3.0], ['vine-wide', -18, -43, 0, 8],
    ['vine-pier-close', 9, 42.2, 180, 8, 1.7], ['vine-east-close', 35.6, 12, 90, 8, 1.7], ['vine-west-close', -35.6, -20, 270, 8, 1.7], ['vine-south-wide', 12, 38, 180, 6],
    ['vine-foot-low', 24, -45.9, 0, -4, .5], ['vine-corner-ne', 34.6, -44.6, 45, 8, 1.7],
  ],
  bushes: [
    ['bush-south', -10.8, 28.4, 0, -2, 1.3], ['bush-north', -10.8, 22.0, 180, -2, 1.3], ['bush-west', -14.2, 25.2, 90, -2, 1.3], ['bush-east', -7.4, 25.2, 270, -2, 1.3],
    ['bush-above', -10.8, 25.2, 0, -80, 4.5], ['bush-close', -10.8, 27.0, 0, -6, 1.0], ['bush-diag', -13.2, 27.6, 45, -4, 1.4], ['bush-other-south', -29.0, -14.4, 0, -2, 1.3],
    ['bush-other-east', -26.4, -17.0, 270, -2, 1.3], ['bush-yard', 25.4, -17.6, 0, -2, 1.3], ['bush-pair-1', 3.0, -39.4, 0, -2, 1.3], ['bush-pair-2', 3.0, -44.6, 180, -2, 1.3],
  ],
  hedges: [
    ['tall-broadside', -26, -12, 270, 3], ['tall-endon', -22, -12, 270, 2], ['tall-from-above', -31, -12, 0, -75, 9], ['tall-diagonal', -27.5, -8, 315, 8],
    ['wide-broadside', -9.5, -6, 0, 3], ['wide-top', -9.5, -11.5, 0, -80, 9], ['block-corner', 17, 2, 45, 5], ['block-end', 25.5, 5, 270, 4],
    ['run-broadside', 29, 3.5, 180, 3], ['thin-end', 31, -5.5, 0, 3], ['low-hedge', 12.5, -6.5, 0, 2], ['strip-west', -33.5, -26, 270, 4],
  ],
  hay: [
    ['step-west', -27, 3.6, 90, 4], ['step-west-end', -31.2, 8.5, 180, 4], ['pyramid-north', 3, -33.5, 0, 4], ['pyramid-north-side', -2.5, -38.4, 90, 4],
    ['pyramid-north-above', 3, -38.4, 0, -60, 6], ['step-east', 25.5, 21, 90, 3], ['pyramid-south', 21, 34, 0, 3], ['single-north', 9.5, -38, 0, 3],
    ['step-centre', 0.5, -19.5, 0, 3], ['pyramid-west', -15, 3.5, 270, 3], ['step-yard-east', 19.5, -9, 90, 3],
  ],
  entrances: [
    ['old-north-portal', 0.5, -18.5, 0, 6, 1.7], ['old-north-portal-b', 6, -28, 270, 8], ['old-east-portal', 12, 9, 90, 8], ['old-east-portal-b', 24, 12, 270, 8],
    ['old-southwest-portal', -20, 12, 0, 8], ['old-southwest-portal-b', -23.5, -3.5, 135, 8], ['house-hall', -3.2, 11, 180, 4], ['house-hall-inside', -3.2, 1, 0, 8],
    ['barn-first-stall', -17, -30, 180, 6], ['barn-first-stall-b', -16.4, -39.5, 0, 6],
  ],
  aerial: [
    ['aerial-nw', -52, -58, 135, -30, 30], ['aerial-se', 52, 58, 315, -30, 30], ['aerial-top', 0, 0, 0, -89, 110], ['aerial-south', 0, 90, 0, -24, 40],
    ['aerial-ne', 52, -58, 225, -30, 30], ['aerial-sw', -52, 58, 45, -30, 30],
  ],
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 600000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); console.log('PAGEERR', String(e)); });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) { errors.push(m.text()); console.log('CONSOLE', m.text().slice(0, 200)); } });
await page.goto(`${base}?practice&autoplay&nohud&quality=${chromebook ? 'low' : 'high'}&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Cleanup Shots');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
if (chromebook) await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
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

const sheets = {};
for (const [group, views] of Object.entries(GROUPS)) {
  if (asked.length && !asked.includes(group)) continue;
  const files = [];
  for (const [label, x, z, heading, pitch, y] of views) {
    await page.evaluate(([x, y, z, h, p]) => window.__crossfire.freeCam(x, y, z, h, p), [x, y ?? EYE, z, heading, pitch]);
    await delay(900);
    const file = `${out}/${group}-${label}.png`;
    await page.screenshot({ path: file });
    files.push([label, file]);
  }
  sheets[group] = files;
  await sheet(group, files);
}
const stats = await page.evaluate(() => ({ foliage: window.__crossfire.foliage(), stats: window.__crossfire.stats() }));
console.log('foliage', JSON.stringify(stats.foliage), 'draw calls', stats.stats.drawCalls, 'missing materials', JSON.stringify(stats.stats.missingMaterials), 'errors', errors.length);
await browser.close();
fs.writeFileSync(`${out}/index.json`, JSON.stringify({ sheets, errors }, null, 1));
console.log('wrote', Object.entries(sheets).map(([n, f]) => `${n}: ${f.length}`).join(', '));
