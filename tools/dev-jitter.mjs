// Flicker test. Renders each view several times with the camera nudged by millimetres, then (tools/jitter_analyze.py)
// compares the frames: a stable surface barely changes when the camera moves a millimetre, a z-fight rewrites its
// pattern. Needs a running dev server.   node tools/dev-jitter.mjs [--url http://localhost:5173/] [--out test-results/jitter]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL = arg('url', 'http://localhost:5173/');
const OUT = arg('out', 'test-results/jitter');
const FRAMES = Number(arg('frames', '8'));
const ONLY = arg('only', '');
if (!arg('only', '')) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// name, x, y, z, heading (compass deg), pitch (deg)
const VIEWS = [
  ['probe_known_zfight', 3.0, 1.64, 3.5, 0, 0], // a deliberate z-fight, placed only for this view
  ['stairs_top_from_east', 8.5, 1.64, -25, 270, -4],
  ['stairs_top_from_above', 7.5, 3.0, -25, 270, -38],
  ['stairs_top_on_terrace', -1.5, 2.4, -25, 90, -22],
  ['stairs_south_side', 0.0, 1.64, -17.5, 0, -6],
  ['court_stairs', 21, 1.64, -29, 90, -12],
  ['court_gate_west', 17.5, 1.64, -29, 90, 0],
  ['court_gate_south', 25.5, 1.64, -21.5, 0, 0],
  ['sills_ground_floor', -22, 1.64, -27.6, 0, 6],
  ['sills_upper_floor', -10, 1.64, 16.2, 180, 38],
  ['sills_second_row', 10.1, 1.64, -16.5, 0, 30],
  ['tunnel_B23_inside_wall', 14, 1.64, -18.5, 180, 0],
  ['tunnel_B23_approach', 9, 1.64, -18.5, 90, 0],
  ['tunnel_B37_inside_wall', 23, 1.64, -1.5, 180, 0],
  ['tunnel_B57_inside_wall', -14, 1.64, 18.5, 0, 0],
  ['party_wall_B54_B57', -14, 1.64, 14.5, 180, 20],
  ['door_plinth', -20.5, 1.64, -28.4, 0, -2],
  ['door_plinth_2', -29.0, 1.64, -17.5, 270, -2],
  ['cornice_corner', -14.6, 1.64, -27, 350, 55],
  ['roof_edges_up', -18, 1.64, -26, 10, 50],
  ['plaza_inlay', -3.5, 1.64, 3.2, 28, -22],
  ['gutter_inlay_long_lane', -12, 1.64, -25, 90, -12],
  ['drain_grate', -16.4, 1.64, -17.5, 0, -30],
  ['flower_pots', -29, 1.64, -13, 90, -14],
  ['shopfront', -21.2, 1.64, -2.0, 90, 2],
  ['crates', -5.2, 1.64, -16.0, 0, -22],
  // transparent surfaces (alpha-blended zone barriers and labels): sorting artifacts would show here
  ['zone_barrier_north', -31, 1.64, -15, 180, 0],
  ['zone_barrier_south_close', -27, 1.64, 10.2, 0, 4],
  ['zone_barrier_tunnel', -17, 1.64, 1.5, 270, 0],
  ['zone_barrier_red_inside', 31, 1.64, 3, 180, 8],
];

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1280, height: 720 },
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.goto(`${URL}?autoplay&nohud`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 240000, polling: 500 });
// ready() means loaded, not that every shader has compiled: meshes without a ready effect are skipped. Warm up first.
await page.evaluate(() => window.__crossfire.freeCam(0, 1.64, 8, 0, 0));
await new Promise((r) => setTimeout(r, 6000));
for (const [name, x, y, z, h, p] of VIEWS.filter((v) => !ONLY || ONLY.split(',').includes(v[0]))) {
  if (name === 'probe_known_zfight') await page.evaluate(() => window.__crossfire.fightProbe(3.0, 1.5, -1.0));
  let settle = 900;
  for (let i = 0; i < FRAMES; i++) {
    // Nudge the camera only along its view direction, 0.4 mm per frame. That changes every depth value by a few
    // buffer steps (which is what rewrites a z-fight) but moves the image by a small fraction of a pixel.
    const hr = (h * Math.PI) / 180;
    const pr = (p * Math.PI) / 180;
    const fwd = [Math.sin(hr) * Math.cos(pr), Math.sin(pr), -Math.cos(hr) * Math.cos(pr)];
    const k = i * 0.0004;
    await page.evaluate(
      (a) => window.__crossfire.freeCam(a.x, a.y, a.z, a.h, a.p),
      { x: x + fwd[0] * k, y: y + fwd[1] * k, z: z + fwd[2] * k, h, p },
    );
    await new Promise((r) => setTimeout(r, settle));
    settle = 200;
    await page.screenshot({ path: path.join(OUT, `${name}__${i}.png`) });
  }
  if (name === 'probe_known_zfight') await page.evaluate(() => window.__crossfire.clearFightProbe());
  console.log('captured', name);
}
await browser.close();
