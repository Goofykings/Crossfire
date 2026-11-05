/** Screenshots of map audit findings (development only): run the audit with MAP_AUDIT=1 first
 * (npx vitest run tests/mapIntegrity.test.ts), then
 *   node tools/map-audit-shots.mjs <map> [--check seeThrough] [--limit 12] [url]
 * Each finding is viewed from 2.5 m in front of its position (or from the recorded viewpoint),
 * at the finding's height. Writes test-results/map-audit/<map>/<check>-<n>.png. */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { setTimeout as delay } from 'node:timers/promises';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const id = args[0];
const check = option('--check', 'seeThrough'), limit = Number(option('--limit', 12));
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5173/';
const report = JSON.parse(fs.readFileSync(`test-results/map-audit/${id}.json`, 'utf8'));
const findings = report.findings.filter((f) => f.check === check).slice(0, limit);
const out = `test-results/map-audit/${id}`;
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  protocolTimeout: 300000, defaultViewport: { width: 960, height: 540 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
try {
  const page = await browser.newPage();
  await page.goto(`${base}?practice&autoplay&nohud&map=${id}&quality=medium`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await completeGuestProfile(page, 'Map Auditor');
  await page.waitForFunction(() => window.__crossfire.ready() && window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
  await delay(2500);
  for (const [n, f] of findings.entries()) {
    const from = f.detail.match(/from (-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/);
    const eye = from ? from.slice(1).map(Number) : [f.at[0], f.at[1], f.at[2] + 2.5];
    const heading = (Math.atan2(f.at[0] - eye[0], -(f.at[2] - eye[2])) * 180 / Math.PI + 360) % 360;
    await page.evaluate((p) => window.__crossfire.freeCam(...p), [eye[0], eye[1], eye[2], heading, 0]);
    await delay(700);
    const file = `${out}/${check}-${String(n + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: file });
    console.log(file, f.at.join(','), f.detail);
  }
} finally { await browser.close(); }
