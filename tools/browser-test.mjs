/**
 * Headless browser smoke test + screenshot tool.
 *
 *   node tools/browser-test.mjs [--url http://localhost:5173/] [--out test-results] [--shots] [--perf]
 *
 * Launches the locally installed Chrome/Edge through puppeteer-core, opens the game with ?autoplay,
 * waits for the map, then:
 *   - reports console errors, missing materials and render statistics
 *   - walks the player through a scripted route (collision sanity in the real build)
 *   - fires at a practice target and checks hits / safe-zone blocking
 *   - optionally captures screenshots from several viewpoints (--shots)
 * Exit code is non-zero when a check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const BASE = opt('url', 'http://localhost:5173/');
const OUT = opt('out', 'test-results');
const QUALITY = opt('quality', 'medium');
fs.mkdirSync(OUT, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found; set CHROME_PATH');
  process.exit(2);
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  defaultViewport: { width: 1600, height: 900 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t);
  if (m.type() === 'error' || t.startsWith('[crossfire]')) console.log(`  [console.${m.type()}] ${t.slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(String(e)));

async function open(query) {
  await page.goto(`${BASE}?autoplay&quality=${QUALITY}&${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 180000, polling: 500 });
  await new Promise((r) => setTimeout(r, 1500));
}

const t0 = Date.now();
await open('nohud');
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c && c.getExtension('WEBGL_debug_renderer_info');
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log(`renderer: ${gl}; map ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
let stats = await page.evaluate(() => window.__crossfire.stats());
console.log('map stats', JSON.stringify(stats.map));
check(stats.missingMaterials.length === 0, `all GLB materials resolve (missing: ${stats.missingMaterials.join(', ') || 'none'})`);

// --- screenshots ------------------------------------------------------------------------------
const views = [
  ['spawn_blue', [-29, 0, 0, 90, 0]],
  ['plaza', [-6, 0, -3, 110, 2]],
  ['north_lane', [-16, 0.72, -25, 90, 0]],
  ['alley_arch', [-27, 0, -13.5, 0, 6]],
  ['court', [23, 0.54, -27.5, 245, 0]],
  ['red_spawn', [24, 0, 1.5, 90, 4]],
  ['narrow_lane', [10, 0, -14, 0, 3]],
  ['sun_check', [3.6, 0, 3.6, 200, 42]],
];
if (flag('shots')) {
  for (const [name, [x, y, z, h, p]] of views) {
    await page.evaluate((v) => window.__crossfire.teleport(v[0], v[1], v[2], v[3], v[4]), [x, y, z, h, p]);
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  screenshot ${name}`);
  }
}

// --- performance sample -----------------------------------------------------------------------
await page.evaluate(() => window.__crossfire.teleport(-6, 0, -3, 110, 0));
await new Promise((r) => setTimeout(r, 3000));
stats = await page.evaluate(() => window.__crossfire.stats());
console.log(`perf @1600x900 ${QUALITY}: ${stats.fps.toFixed(1)} fps, ${stats.frameMs.toFixed(2)} ms frame, ${stats.drawCalls} draw calls, ${stats.activeMeshes} active meshes, ${stats.totalVertices} vertices`);

// --- movement through the real collision ------------------------------------------------------
await page.evaluate(() => window.__crossfire.teleport(-29, 0, 1.5, 90, 0));
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => window.__crossfire.hold('forward', true));
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => window.__crossfire.hold('forward', false));
let pos = await page.evaluate(() => window.__crossfire.player());
check(pos.x > -25 && pos.x < -14, `walked east out of blue spawn through the gatehouse (x=${pos.x.toFixed(2)})`);
check(pos.grounded, 'player is grounded after walking');

// walk into a wall: cross the gate yard westward along z=-3 -> must stop at the gatehouse wall (x=-21)
await page.evaluate(() => window.__crossfire.teleport(-17, 0, -3, 270, 0));
await page.evaluate(() => window.__crossfire.hold('forward', true));
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => window.__crossfire.hold('forward', false));
pos = await page.evaluate(() => window.__crossfire.player());
check(pos.x > -21 + 0.3 && pos.x < -21 + 0.4, `stopped by the gatehouse wall at radius distance (x=${pos.x.toFixed(2)})`);

// climb the north-lane stairs
await page.evaluate(() => window.__crossfire.teleport(-16, 0, -25, 90, 0));
await page.evaluate(() => window.__crossfire.hold('forward', true));
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.__crossfire.hold('forward', false));
pos = await page.evaluate(() => window.__crossfire.player());
check(Math.abs(pos.y - 0.72) < 0.05, `climbed the terrace stairs (y=${pos.y.toFixed(2)})`);

// --- shooting ---------------------------------------------------------------------------------
// target T05 sits on the terrace at (-9, 0.72, -25) facing east; stand east of it and shoot west
await page.evaluate(() => window.__crossfire.teleport(-3, 0.72, -25, 270, -1.5));
await new Promise((r) => setTimeout(r, 500));
const before = await page.evaluate(() => window.__crossfire.stats());
await page.evaluate(() => window.__crossfire.hold('aim', true));
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => window.__crossfire.hold('fire', true));
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => window.__crossfire.hold('fire', false));
await page.evaluate(() => window.__crossfire.hold('aim', false));
await new Promise((r) => setTimeout(r, 300));
if (flag('shots')) await page.screenshot({ path: path.join(OUT, 'shooting.png') });
const after = await page.evaluate(() => window.__crossfire.stats());
check(after.shots > before.shots, `weapon fired (${after.shots - before.shots} shots, ammo ${after.ammo})`);
check(after.hits > before.hits, `hits registered on the practice target (${after.hits - before.hits})`);
check(after.downs > before.downs, `target knocked down (${after.downs - before.downs})`);

// safe zone: shooting from inside blue spawn at the protected target must not register hits
await page.evaluate(() => window.__crossfire.teleport(-27.5, 0, 0.4, 0, 0));
await new Promise((r) => setTimeout(r, 400));
const zoneStats = await page.evaluate(() => window.__crossfire.stats());
check(zoneStats.zone === 'blue', `player inside the blue safe zone is detected (zone=${zoneStats.zone})`);
// T11 (protected target) at (-31.6, 0, 5.4) facing east; aim at its plate from inside the zone
await page.evaluate(() => {
  const dx = -31.6 - -27.5;
  const dz = 5.4 - 0.4;
  const heading = (Math.atan2(dx, -dz) * 180) / Math.PI;
  window.__crossfire.look(heading, 0);
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => window.__crossfire.hold('fire', true));
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => window.__crossfire.hold('fire', false));
await new Promise((r) => setTimeout(r, 200));
if (flag('shots')) await page.screenshot({ path: path.join(OUT, 'safe_zone_blocked.png') });
const zoneAfter = await page.evaluate(() => window.__crossfire.stats());
check(zoneAfter.shots > zoneStats.shots && zoneAfter.hits === zoneStats.hits, 'no damage dealt from inside the safe zone');

// entrance barriers + labels exist, and the veil's plane coincides with where protection starts
// (blue north entrance: zone edge z = -7, body radius 0.34 -> plane at z = -7.34, x in [-33, -29])
const veil = await page.evaluate(() => window.__crossfire.stats());
check(veil.zoneBarriers === 6 && veil.zoneLabels === 6, `safe-zone barriers and labels present (${veil.zoneBarriers} / ${veil.zoneLabels})`);
await page.evaluate(() => window.__crossfire.teleport(-31, 0, -7.45, 180, 0));
await new Promise((r) => setTimeout(r, 400));
const beforeVeil = await page.evaluate(() => window.__crossfire.stats().zone);
await page.evaluate(() => window.__crossfire.teleport(-31, 0, -7.2, 180, 0));
await new Promise((r) => setTimeout(r, 400));
const behindVeil = await page.evaluate(() => window.__crossfire.stats().zone);
check(beforeVeil === null && behindVeil === 'blue', `protection starts at the veil (before=${beforeVeil}, past=${behindVeil})`);

check(errors.length === 0, `no console errors (${errors.length})`);
for (const e of errors.slice(0, 10)) console.log('   ', e.slice(0, 400));

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall browser checks passed');
process.exit(failures.length ? 1 : 0);
