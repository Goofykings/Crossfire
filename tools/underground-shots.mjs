/** Screenshots of the underground spaces and their street portals in real Chrome (free camera).
 *   node tools/underground-shots.mjs [http://127.0.0.1:5181/] [metro|cellar|all]
 * Writes PNGs and contact sheets to test-results/underground/. Used for the visual inspection of the
 * Civic Central metro station and the cistern/wine cellar; positions are authored for the current
 * layouts (tools/underground_layouts.py). */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const which = process.argv.find((a) => ['metro', 'cellar', 'all'].includes(a)) ?? 'all';
const out = 'test-results/underground';
fs.mkdirSync(out, { recursive: true });
const eye = (floor) => floor + 1.65;
const MAPS = {
  metro: { map: 'modern-city', floor: -3.8, views: [
    ['overview-west-east', -10.8, 0.8, 90, -1], ['overview-east-west', 20.8, 0.8, 270, -1], ['ticket-hall-from-north', 4.3, -3.0, 180, -2],
    ['ticket-hall-from-south', 4.3, 4.4, 0, -2], ['gate-line', 3.0, 0.75, 90, -3], ['gate-line-east', 14.0, 0.75, 270, -3],
    ['east-zone-benches', 11.0, -1.75, 60, -4], ['west-zone-vending', -3.0, -1.75, 215, -5], ['civic-stair-up', 4.3, -2.6, 0, 14],
    ['south-stair-up', 4.3, 4.2, 180, 14], ['waiting-room', -7.6, -2.4, 0, -6], ['vending-alcove', -7.2, 3.0, 180, -6],
    ['ticket-office', 14.4, -2.2, 0, -6], ['utility-room', 11.0, 3.0, 180, -6], ['pillar-row-close', -8.0, -1.75, 90, 0],
    ['route-map', -4.9, 2.2, 0, 0], ['poster-wall', -10.2, 2.2, 0, 0], ['ceiling-lights', 6.0, 0.8, 90, 28],
    ['street-civic-stair', 4.3, -14.4, 180, -16, 1.7], ['street-south-stair', 4.3, 17.2, 0, -16, 1.7], ['street-plaza-wide', 9.5, -1.6, 345, -8, 1.7]] },
  cellar: { map: 'european-town', floor: -3.5, views: [
    ['market-stair-bottom', -10.1, -7.2, 180, -2], ['hall-from-nw', -12.1, -3.6, 125, -2], ['hall-from-se', -1.6, 3.4, 300, -2],
    ['tank-close', -9.6, 2.2, 0, -8], ['vault-entrance', -12.2, 0.0, 270, -1], ['vault-west', -15.0, 0.0, 270, -2], ['vault-east', -17.0, 0.0, 90, -2],
    ['north-store', -4.1, -6.6, 0, -3], ['sw-store', -9.5, 6.6, 180, -4], ['cistern-stair-up', -3.9, 2.6, 180, 16],
    ['market-stair-up', -10.1, -8.6, 0, 16], ['hall-ceiling', -7.0, 0.0, 90, 25],
    ['street-market-portal', -11.0, -6.0, 0, -8, 1.7], ['street-cistern-portal', -3.0, 17.0, 0, -8, 1.7]] },
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const sheets = [];
for (const [name, cfg] of Object.entries(MAPS)) {
  if (which !== 'all' && which !== name) continue;
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
  await page.goto(`${base}?practice&autoplay&nohud&quality=high&map=${cfg.map}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Underground');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
  await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
  await delay(4000);
  const files = [];
  for (const [label, x, z, heading, pitch, y] of cfg.views) {
    await page.evaluate(([x, y, z, h, p]) => window.__crossfire.freeCam(x, y, z, h, p), [x, y ?? eye(cfg.floor), z, heading, pitch]);
    await delay(900);
    const file = `${out}/${name}-${label}.png`;
    await page.screenshot({ path: file });
    files.push([label, file]);
  }
  sheets.push([name, files]);
  await page.close();
}
await browser.close();
fs.writeFileSync(`${out}/index.json`, JSON.stringify(Object.fromEntries(sheets), null, 1));
console.log('wrote', sheets.map(([n, f]) => `${n}: ${f.length} views`).join(', '));
