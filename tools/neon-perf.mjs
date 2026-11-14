/** Uncapped frame rate and draw calls of a map in local Practice (no bots) at fixed street views, per preset.
 *   node tools/neon-perf.mjs [http://127.0.0.1:5181/] [map ...]   (default: neon-backstreets modern-city farmstead)
 * Only comparisons on the same machine in one run are meaningful (the dev iGPU heats up: alternate maps). */
import puppeteer from 'puppeteer-core';
import { setTimeout as delay } from 'node:timers/promises';
import { completeGuestProfile } from './guest-profile-helper.mjs';
const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5181/';
const maps = args.filter((a) => !/^https?:/.test(a));
const VIEWS = {
  'neon-backstreets': [[-12, 1.64, 0.5, 90, 0], [-17.2, 1.64, -16.6, 90, 0], [-18, 1.64, 17.5, 90, 0], [6, 5.2, 5.4, 0, -6]],
  'modern-city': [[-6, 1.84, 6, 45, 0], [-25, 1.84, -24, 90, 0], [1, 1.84, -16, 90, 0], [-20, 1.7, -5, 60, 0]],
  farmstead: [[-4, 1.64, 36, 0, 1], [-26, 1.64, -3, 0, 3], [21.8, 1.64, -4, 0, 3], [28, 1.64, 20.5, 90, 2]],
};
const PRESETS = [['low', ''], ['medium', ''], ['high', ''], ['low', 'chromebook']];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  protocolTimeout: 240000, defaultViewport: { width: 1600, height: 900 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
console.log('map               | preset     |  fps (4 views avg) | min view | draw calls');
for (const [quality, mode] of PRESETS) for (const map of maps.length ? maps : Object.keys(VIEWS)) {
  const page = await browser.newPage();
  await page.goto(`${base}?practice&autoplay&nohud&quality=${quality}&map=${map}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await completeGuestProfile(page, 'Perf');
  await page.waitForFunction(() => window.__crossfire.ready() && window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
  if (mode) await page.evaluate(() => window.__crossfire.setSetting({ chromebookMode: true }));
  await delay(4000);
  const fps = [], draws = [];
  for (const v of VIEWS[map]) {
    await page.evaluate((v) => window.__crossfire.freeCam(...v), v);
    await delay(2500);
    const st = await page.evaluate(() => window.__crossfire.stats());
    fps.push(st.fps); draws.push(st.drawCalls);
  }
  const avg = fps.reduce((a, b) => a + b, 0) / fps.length;
  console.log(`${map.padEnd(17)} | ${(mode || quality).padEnd(10)} | ${avg.toFixed(1).padStart(18)} | ${Math.min(...fps).toFixed(1).padStart(8)} | ${Math.round(draws.reduce((a, b) => a + b, 0) / draws.length)}`);
  await page.close();
}
await browser.close();
