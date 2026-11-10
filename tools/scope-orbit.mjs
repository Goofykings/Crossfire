/** Orbit the semi-sniper view-model in the real engine (inspectView) to find missing/culled scope faces.
 *   node tools/scope-orbit.mjs [url] [outDir] [quality query]    env WEAPON=4 (loadout index) */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = args.find((a) => a.startsWith('test-results')) ?? 'test-results/scope-orbit';
const query = args.find((a) => a.startsWith('quality=')) ?? 'quality=high';
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1000, height: 600 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
await page.goto(`${base}?practice&autoplay&nohud&map=farmstead&${query}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
await completeGuestProfile(page, 'Scope Orbit');
await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
await delay(3000);
await page.evaluate((w) => { window.__crossfire.teleport(-2.7, 1.64, 33, 0, 0); window.__crossfire.selectWeapon(w); }, Number(process.env.WEAPON ?? 4));
await delay(1500);
const views = [['left', 90, 80, 0.55], ['right', -90, 80, 0.55], ['rear', 0, 80, 0.55], ['front', 180, 80, 0.55], ['top', 90, 15, 0.55], ['below', 90, 170, 0.55],
  ['rear-left', 45, 70, 0.4], ['rear-right', -45, 70, 0.4], ['front-left', 135, 70, 0.5], ['front-right', -135, 70, 0.5]];
for (const [label, a, b, r] of views) {
  await page.evaluate(([a, b, r]) => window.__crossfire.inspectView(a, b, r), [a, b, r]);
  await delay(600);
  await page.screenshot({ path: `${out}/${label}.png` });
}
await browser.close();
