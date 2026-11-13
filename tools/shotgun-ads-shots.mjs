/** Shotgun side-by-side barrels (2026-11-13): first-person hip, ADS and reload frames in local ?practice mode.
 *   node tools/shotgun-ads-shots.mjs [http://localhost:5190/]  -> test-results/shotgun-ads/ */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';
const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://localhost:5190/';
const out = 'test-results/shotgun-ads'; fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?practice&autoplay&quality=high&map=farmstead`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Shotgun Shots');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
  await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
  await delay(3000);
  const cf = (fn, ...a) => page.evaluate((fn, a) => window.__crossfire[fn](...a), fn, a);
  for (let i = 0; i < 4; i++) { await cf('selectWeapon', i); await delay(900); const w = await cf('weapon'); if (w.id === 'shotgun') { console.log('shotgun at', i); break; } }
  await cf('teleport', 0, 0.05, 20, 0, 0); await delay(1500);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  await shot('hip'); 
  await cf('hold', 'aim', true); await delay(120); await shot('ads-mid'); await delay(900); await shot('ads');
  const w = await cf('weapon'); console.log('ads', JSON.stringify(w).slice(0, 300));
  await cf('hold', 'aim', false); await delay(700);
  await cf('hold', 'fire', true); await delay(60); await cf('hold', 'fire', false); await delay(90); await shot('fire');
  await delay(1200); await cf('hold', 'reload', true); await delay(60); await cf('hold', 'reload', false); await delay(700); await shot('reload');
  console.log('errors', errors.length, errors.join('|'));
} finally { await browser.close(); }
