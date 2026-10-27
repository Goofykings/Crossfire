import { completeGuestProfile } from './guest-profile-helper.mjs';
/**
 * Measure frame rate across graphics presets and viewpoints (uncapped, headless Chrome/Edge).
 *   node tools/perf-test.mjs [--url http://localhost:5173/] [--width 1920] [--height 1080] [--map european-town]
 * Prints a table; numbers are only meaningful relative to the machine they were measured on.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const BASE = opt('url', 'http://localhost:5173/');
const W = Number(opt('width', 1920));
const H = Number(opt('height', 1080));
const MAP = opt('map', 'european-town');
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
  .filter(Boolean)
  .find((p) => fs.existsSync(p));

const presets = [
  ['low', 'off', 0.75],
  ['low', 'low', 1],
  ['medium', 'medium', 1],
  ['high', 'high', 1],
];
// per map: an open square, a lane and the longest street view (teleport x, y, z, heading, pitch)
const VIEWS = {
  'european-town': [
    ['plaza', [-6, 0, -3, 110, 0]],
    ['north lane', [-16, 0.72, -25, 90, 0]],
    ['long view', [-31, 0, -29, 90, 0]],
  ],
  'industrial-complex': [
    ['loading sq', [-5, 0.2, 5, 45, 0]],
    ['north lane', [-31, 0.2, -28.5, 90, 0]],
    ['long view', [-32, 0.2, -14, 90, 0]],
  ],
  'modern-city': [
    ['plaza', [-6, 0.2, 6, 45, 0]],
    ['north st', [-25, 0.2, -24, 90, 0]],
    ['long view', [1, 0.2, -16, 90, 0]],
  ],
};
const views = VIEWS[MAP];
if (!views) {
  console.error(`no viewpoints for map "${MAP}" (known: ${Object.keys(VIEWS).join(', ')})`);
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  defaultViewport: { width: W, height: H },
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const probe = await browser.newPage();
const gpu = await (async () => {
  await probe.goto('about:blank');
  return probe.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const e = c.getExtension('WEBGL_debug_renderer_info');
    return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
})();
console.log(`GPU: ${gpu}\nResolution: ${W}x${H}\nMap: ${MAP}\n`);
console.log('preset (gfx/shadows/scale) | view        |   fps | draw calls');
for (const [q, s, scale] of presets) {
  const page = await browser.newPage();
  await page.goto(`${BASE}?autoplay&nohud&quality=${q}&shadows=${s}&scale=${scale}&map=${MAP}`, { waitUntil: 'domcontentloaded' });
  await completeGuestProfile(page);
  await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
  for (const [name, v] of views) {
    await page.evaluate((v) => window.__crossfire.teleport(...v), v);
    await new Promise((r) => setTimeout(r, 3500));
    const st = await page.evaluate(() => window.__crossfire.stats());
    console.log(`${`${q}/${s}/${scale}`.padEnd(26)} | ${name.padEnd(11)} | ${st.fps.toFixed(1).padStart(5)} | ${st.drawCalls}`);
  }
  await page.close();
}
await browser.close();
