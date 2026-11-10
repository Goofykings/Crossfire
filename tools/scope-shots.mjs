/** Semi-Auto Sniper scope captures in the real Practice game: hip, ADS, reload and recoil at several presets.
 *   node tools/scope-shots.mjs [http://127.0.0.1:5181/] [outDir]
 * The camera stays the game's own first-person camera; only the weapon is selected and aimed through __crossfire. */
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base = process.argv.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const out = process.argv.find((a, i) => i > 1 && !/^https?:/.test(a)) ?? 'test-results/scope';
fs.mkdirSync(out, { recursive: true });
const PRESETS = process.env.ONLYPRESET ? { [process.env.ONLYPRESET]: ({ high: 'quality=high' })[process.env.ONLYPRESET] } : { high: 'quality=high', low: 'quality=low&shadows=off&scale=.75', chromebook: 'quality=low&shadows=off&scale=.5' };

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, timeout: 120000,
  protocolTimeout: 240000, defaultViewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
for (const [name, query] of Object.entries(PRESETS)) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
  await page.goto(`${base}?practice&autoplay&nohud&map=farmstead&${query}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Scope Shots');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
  await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
  if (name === 'chromebook') await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
  await delay(4000);
  await page.evaluate((w) => { window.__crossfire.teleport(-2.7, 1.64, 33, 0, 0); window.__crossfire.selectWeapon(w); }, Number(process.env.WEAPON ?? 4));
  await delay(1800);
  const shot = async (label) => { await delay(500); await page.screenshot({ path: `${out}/${name}-${label}.png` }); };
  await shot('hip');
  for (const [label, heading, pitch] of [['hip-down', 0, -25], ['hip-up', 0, 30]]) {
    await page.evaluate(([h, p]) => window.__crossfire.look(h, p), [heading, pitch]); await shot(label);
  }
  await page.evaluate(() => window.__crossfire.look(0, 0));
  await page.evaluate(() => window.__crossfire.hold('aim', true));
  await delay(900); await shot('ads');
  await page.evaluate(() => window.__crossfire.hold('aim', false));
  await delay(600);
  await page.evaluate(() => window.__crossfire.hold('reload', true));
  await delay(500); await shot('reload'); await page.evaluate(() => window.__crossfire.hold('reload', false));
  await delay(3000);
  console.log(name, JSON.stringify(await page.evaluate(() => ({ view: window.__crossfire.weapon().view?.shown, meshes: window.__crossfire.weapon().viewMeshes }))));
  await page.close();
}
await browser.close();
