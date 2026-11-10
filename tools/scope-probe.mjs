/** Hide the semi-sniper view-model primitives one at a time and capture the ADS and hip views.
 *   node tools/scope-probe.mjs [url] [quality-query] [outDir] */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const query = args.find((a) => a.startsWith('quality=')) ?? 'quality=high';
const out = args.find((a) => a.startsWith('test-results')) ?? 'test-results/scope-probe';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
await page.goto(`${base}?practice&autoplay&nohud&map=farmstead&${query}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Scope Probe');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(3000);
await page.evaluate(() => { window.__crossfire.teleport(-2.7, 1.64, 33, 0, 0); window.__crossfire.selectWeapon(4); });
await delay(1500);
const list = await page.evaluate(() => window.__crossfire.viewMeshDebug());
console.table(list.filter((m) => m.name.startsWith('semi_sniper') || m.name.startsWith('mag_')));
const only = process.env.ONLY ? process.env.ONLY.split(',') : list.map((m) => m.name);
for (const mode of ['hip', 'ads']) {
  if (mode === 'ads') { await page.evaluate(() => window.__crossfire.hold('aim', true)); await delay(1000); }
  await page.screenshot({ path: `${out}/${mode}-all.png` });
  for (const name of only) {
    const others = list.map((m) => m.name).filter((n) => n.startsWith('semi_sniper') && n !== name);
    await page.evaluate((o) => window.__crossfire.viewMeshDebug(o, false), others);
    await delay(250);
    await page.screenshot({ path: `${out}/${mode}-only-${name}.png` });
    await page.evaluate((o) => window.__crossfire.viewMeshDebug(o, true), others);
  }
}
await browser.close();
