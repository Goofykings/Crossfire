/** Close-up screenshots of the facade posters on every map (docs/map-posters/<map>.json, written by the
 * Blender exporter) in real Chrome with the free camera.
 *   node tools/poster-shots.mjs [http://127.0.0.1:5181/] [--per-map 8]
 * Writes test-results/posters/<map>-<n>-<building>-<cell>.png */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const perMap = Number(args[args.indexOf('--per-map') + 1] || 8);
const out = 'test-results/posters';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
for (const map of ['european-town', 'industrial-complex', 'modern-city']) {
  const list = JSON.parse(fs.readFileSync(`docs/map-posters/${map}.json`, 'utf8')).facade;
  // Spread over distinct atlas cells, then buildings.
  const picked = []; const seen = new Set();
  for (const p of list) if (!seen.has(p.cell) && picked.length < perMap) { seen.add(p.cell); picked.push(p); }
  for (const p of list) if (picked.length < perMap && !picked.includes(p)) picked.push(p);
  for (const p of list.filter((q) => q.interior).slice(0, 3)) if (!picked.includes(p)) picked.push(p);
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
  await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=${map}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Posters');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
  await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
  await delay(3000);
  let n = 0;
  for (const p of picked) {
    const [nx, nz] = p.normal, d = 2.7;
    const heading = (Math.atan2(-nx, nz) * 180 / Math.PI + 360) % 360;
    await page.evaluate(([x, y, z, h, pitch]) => window.__crossfire.freeCam(x, y, z, h, pitch), [p.x + nx * d, p.y + p.h / 2 + 0.25, p.z + nz * d, heading, -4]);
    await delay(800);
    await page.screenshot({ path: `${out}/${map}-${String(++n).padStart(2, '0')}-${p.building}-c${p.cell}${p.interior ? '-in' : ''}.png` });
  }
  console.log(map, picked.length, 'posters photographed of', list.length);
  await page.close();
}
await browser.close();
