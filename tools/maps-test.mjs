/**
 * Multi-map browser test: every map in the registry, map switching and leaks.
 *
 *   node tools/maps-test.mjs [--url http://localhost:5173/] [--shots] [--out test-results/maps]
 *
 * Needs a running server (npm run dev, or tools/serve-dist.mjs). For each map: loads it through the same path as the
 * Play button, then checks materials, console errors, a free-for-all spawn (grounded, no safe zones or barriers),
 * walking, the Tab map (layout id, marker on the player) and a headshot on a practice target (1.5x body damage). Then
 * it switches maps twice round and checks that scene object counts return to the same values (no leaks) and that
 * applied settings survive the switches. Exit code 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('url', 'http://localhost:5173/');
const OUT = opt('out', 'test-results/maps');
const shots = args.includes('--shots');
fs.mkdirSync(OUT, { recursive: true });

const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found; set CHROME_PATH');
  process.exit(2);
}
const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath, headless: 'new', defaultViewport: { width: 1600, height: 900 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
const api = (fn, ...a) => page.evaluate(fn, ...a);

// Maps remain available to the runtime and test API without a home-screen selector.
const ids = fs.readdirSync('src/maps', { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(`src/maps/${d.name}/layout.json`))
  .map((d) => d.name);
check(ids.length === 3, `all three existing map layouts remain available (${ids.join(', ')})`);

// --- each existing map through the gameplay loading path -------------------------------------------
await page.goto(`${BASE}?autoplay&nohud&quality=low&shadows=low`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 240000, polling: 500 });
await api(() => window.__crossfire.setSetting({ fov: 101, mouseSensitivity: 1.35 }));
const memory = {};
for (const round of [1, 2]) {
  for (const id of ids) {
    const t0 = Date.now();
    const loaded = await api((m) => window.__crossfire.play(m), id);
    await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 240000, polling: 250 });
    await wait(1500);
    memory[`${id}#${round}`] = await api(() => window.__crossfire.memory());
    if (round === 2) continue;
    console.log(`\n== ${id} (loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    const stats = await api(() => window.__crossfire.stats());
    check(loaded === id && stats.mapId === id, `${id}: loaded through Play (${stats.mapId})`);
    check(stats.missingMaterials.length === 0, `${id}: all materials resolve (${stats.missingMaterials.join(', ') || 'none missing'})`);
    const info = await api(() => window.__crossfire.mapInfo());
    // spawn: free-for-all, anywhere on the map, on the ground
    const spawned = await api(() => window.__crossfire.player());
    await wait(300);
    const onSpawn = info.spawns.some((q) => Math.hypot(q.pos[0] - spawned.x, q.pos[2] - spawned.z) < 0.5);
    check(spawned.grounded && onSpawn && !info.safeZones, `${id}: spawns grounded on a free-for-all spawn point, no safe zones (${info.spawns.length} spawns)`);
    // walk forward from a spawn along its facing (spawns face their longest open line)
    const sp = info.spawns[0];
    await api((s) => window.__crossfire.teleport(s.pos[0], s.pos[1] + 0.2, s.pos[2], s.heading, 0), sp);
    await wait(200);
    await api(() => window.__crossfire.hold('forward', true));
    await wait(1200);
    await api(() => window.__crossfire.hold('forward', false));
    const walked = await api(() => window.__crossfire.player());
    const dist = Math.hypot(walked.x - sp.pos[0], walked.z - sp.pos[2]);
    check(dist > 2 && walked.grounded, `${id}: walking moves the player (${dist.toFixed(1)} m, grounded=${walked.grounded})`);
    // tactical map
    await api(() => (document.getElementById('ui').style.display = ''));
    await api(() => window.__crossfire.hold('map', true));
    await wait(300);
    const tac = await api(() => window.__crossfire.tactical());
    const off = tac.expected ? Math.hypot(tac.marker.x - tac.expected.x, tac.marker.y - tac.expected.y) : 99;
    check(tac.visible && tac.domVisible && tac.map === id && off < 1, `${id}: Tab map shows this map with the marker on the player (${off.toFixed(2)} px)`);
    if (shots) await page.screenshot({ path: path.join(OUT, `${id}_tactical.png`) });
    await api(() => window.__crossfire.hold('map', false));
    await api(() => (document.getElementById('ui').style.display = 'none'));
    // shooting: stand 5 m in front of a target, put one rifle round through its head (1.5x body damage)
    const target = info.targets[0];
    const h = (target.heading * Math.PI) / 180;
    const fx = target.pos[0] + Math.sin(h) * 5, fz = target.pos[2] - Math.cos(h) * 5;
    const look = ((target.heading + 180) % 360);
    await api((q) => window.__crossfire.teleport(q[0], q[1] + 0.2, q[2], q[3], 0), [fx, target.pos[1], fz, look]);
    await wait(500);
    const tp = await api((q) => window.__crossfire.targetPoints(q), target.id);
    await api((q) => window.__crossfire.aimAt(q.x, q.y, q.z), tp.head);
    await wait(100);
    await api((q) => window.__crossfire.aimAt(q.x, q.y, q.z), tp.head);
    const s0 = await api(() => window.__crossfire.stats());
    await api(() => window.__crossfire.hold('fire', true));
    await wait(45);
    await api(() => window.__crossfire.hold('fire', false));
    await wait(200);
    const s1 = await api(() => window.__crossfire.stats());
    const shot = await api(() => window.__crossfire.lastShot());
    check(s1.hits > s0.hits && shot.head && Math.abs(shot.damage - 37.5) < 1e-6,
      `${id}: headshot on practice target ${target.id} deals 1.5x body damage (${shot.damage}, head=${shot.head})`);
    if (shots) {
      await page.screenshot({ path: path.join(OUT, `${id}_target.png`) });
    }
  }
}

// --- map switching: scene object counts come back to the same values ---------------------------------
console.log('');
for (const id of ids) {
  const a = memory[`${id}#1`];
  const b = memory[`${id}#2`];
  const keys = ['meshes', 'materials', 'textures', 'geometries', 'lights', 'transformNodes'];
  const grew = keys.filter((k) => b[k] > a[k]);
  check(grew.length === 0, `${id}: no leak after switching away and back (${keys.map((k) => `${k} ${a[k]}->${b[k]}`).join(', ')}; library ${a.library.materials}->${b.library.materials} mats, ${a.library.textures}->${b.library.textures} tex)`);
}
const settings = await api(() => ({ applied: window.__crossfire.settings(), live: window.__crossfire.live() }));
check(settings.applied.fov === 101 && Math.abs(settings.live.fovDeg - 101) < 1 && settings.applied.mouseSensitivity === 1.35,
  `settings survive map switches (fov ${settings.applied.fov}, live ${settings.live.fovDeg.toFixed(1)}, sensitivity ${settings.applied.mouseSensitivity})`);
check(errors.length === 0, `no console errors (${errors.length})`);
for (const e of errors.slice(0, 8)) console.log('   ', e.slice(0, 300));
await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall map checks passed');
process.exit(failures.length ? 1 : 0);
