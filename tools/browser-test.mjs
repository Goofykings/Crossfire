/**
 * Headless browser smoke test + screenshot tool.
 *
 *   node tools/browser-test.mjs [--url http://localhost:5173/] [--out test-results] [--shots] [--perf]
 *
 * Launches the locally installed Chrome/Edge through puppeteer-core, opens the game with ?autoplay,
 * waits for the map, then:
 *   - reports console errors, missing materials and render statistics
 *   - walks the player through a scripted route (collision sanity in the real build)
 *   - fires at practice targets: hits, headshots (1.5x), sniper one-shot headshots, shotgun pellets
 *   - weapon switching, infinite reserve, weapon-only reload lowering/return and sounds (no hands/arms)
 *   - free-for-all: no safe zones
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

// --- free-for-all: no safe zones anywhere -----------------------------------------------------------
{
  const st = await page.evaluate(() => ({
    barriers: window.__crossfire.stats().zoneBarriers,
    zones: window.__crossfire.tactical().zones,
    info: window.__crossfire.mapInfo(),
  }));
  check(st.barriers === undefined && st.zones === undefined && !st.info.safeZones, 'free-for-all: no safe zones, barriers or zone labels');
  check(st.info.spawns.length >= 12 && st.info.spawns.every((q) => q.team === undefined), `free-for-all spawns spread over the map (${st.info.spawns.length})`);
}

// --- weapons: headshots, the three guns, infinite reserve, reload animation -------------------------
const cfw = (fn, ...a) => page.evaluate(fn, ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = (await cfw(() => window.__crossfire.mapInfo())).targets;
/** Stand `dist` m in front of a target (on its facing side), wait for it to be up, aim at a zone, fire one shot. */
async function shootTarget(id, zone, dist, scoped = false) {
  const t = targets.find((q) => q.id === id);
  const h = (t.heading * Math.PI) / 180;
  for (let k = 0; k < 40; k++) {
    const tp = await cfw((q) => window.__crossfire.targetPoints(q), id);
    if (tp.state === 'up' && tp.health === 100) break;
    await wait(250);
  }
  await cfw((q) => window.__crossfire.teleport(q[0], q[1] + 0.2, q[2], q[3], 0), [t.pos[0] + Math.sin(h) * dist, t.pos[1], t.pos[2] - Math.cos(h) * dist, (t.heading + 180) % 360]);
  await wait(350);
  if (scoped) {
    await cfw(() => window.__crossfire.hold('aim', true));
    await wait(500);
  }
  const pt = await cfw((q) => window.__crossfire.targetPoints(q), id);
  const aim = zone === 'head' ? pt.head : pt.body;
  await cfw((q) => window.__crossfire.aimAt(q.x, q.y, q.z), aim);
  await wait(120);
  await cfw((q) => window.__crossfire.aimAt(q.x, q.y, q.z), aim);
  await cfw(() => window.__crossfire.hold('fire', true));
  await wait(45);
  await cfw(() => window.__crossfire.hold('fire', false));
  await wait(150);
  const shot = await cfw(() => window.__crossfire.lastShot());
  const after = await cfw((q) => window.__crossfire.targetPoints(q), id);
  if (scoped) await cfw(() => window.__crossfire.hold('aim', false));
  return { shot, after };
}
async function select(slot, id) {
  await page.keyboard.press(`Digit${slot}`);
  for (let k = 0; k < 20; k++) {
    const w = await cfw(() => window.__crossfire.weapon());
    if (w.id === id && w.action === 'idle') return w;
    await wait(100);
  }
  return cfw(() => window.__crossfire.weapon());
}
// pick targets standing in the open (the terrace one was knocked down above)
const pool = targets.map((t) => t.id).filter((id) => id !== 'T05');
{
  let w = await select(1, 'rifle');
  check(w.id === 'rifle' && w.reserve === 'infinite', `key 1 selects the assault rifle; reserve ammunition is infinite (${w.reserve})`);
  const head = await shootTarget(pool[0], 'head', 6);
  check(head.shot.head && Math.abs(head.shot.damage - 37.5) < 1e-6, `rifle headshot deals 1.5x body damage (${head.shot.damage}, head=${head.shot.head})`);
  const body = await shootTarget(pool[1], 'body', 6);
  check(!body.shot.head && Math.abs(body.shot.damage - 25) < 1e-6, `rifle body shot deals body damage (${body.shot.damage})`);

  // Reload: a short weapon dip and return, without loading hands or displaying loose magazines.
  await cfw(() => window.__crossfire.hold('reload', true));
  await wait(40);
  await cfw(() => window.__crossfire.hold('reload', false));
  if (flag('shots')) {
    await wait(200);
    await page.screenshot({ path: path.join(OUT, 'reload-no-arms.png') });
  }
  const seen = { lowered: false, returned: false };
  for (let k = 0; k < 40; k++) {
    const v = (await cfw(() => window.__crossfire.weapon())).view;
    if (v.lower > 0.15) seen.lowered = true;
    if (seen.lowered && v.lower < 0.01) seen.returned = true;
    if (v.action === 'idle' && k > 5) break;
    await wait(60);
  }
  const sounds = await cfw(() => window.__crossfire.sounds());
  w = await cfw(() => window.__crossfire.weapon());
  check(seen.lowered && seen.returned, `reload lowers and returns the weapon (${JSON.stringify(seen)})`);
  check(w.viewMeshes.length > 0 && w.viewMeshes.every((n) => !/hand|forearm|mag-spare/i.test(n)), 'weapon is visible without hands, arms or a spare magazine');
  check(sounds.includes('mag_out') && sounds.includes('mag_in'), 'reload plays magazine-out and magazine-in sounds');
  check(w.ammo === 30, `magazine full after the reload (${w.ammo})`);
  // three magazines in a row: never runs dry
  for (let m = 0; m < 3; m++) {
    await cfw(() => window.__crossfire.hold('fire', true));
    await wait(3000);
    await cfw(() => window.__crossfire.hold('fire', false));
    await wait(3000);
  }
  w = await cfw(() => window.__crossfire.weapon());
  check(w.ammo === 30 && w.reserve === 'infinite', `three magazines emptied and reloaded, still full (${w.ammo}) with infinite reserve`);

  // sniper: one-shot headshot, body shot leaves the target standing, bolt worked after each shot
  w = await select(3, 'sniper');
  check(w.id === 'sniper', 'key 3 selects the sniper rifle');
  const sh = await shootTarget(pool[2], 'head', 14, true);
  check(sh.shot.head && sh.shot.damage >= 100 && sh.after.state !== 'up', `sniper headshot kills in one shot (${sh.shot.damage}, target ${sh.after.state})`);
  await wait(1300);
  const sb = await shootTarget(pool[3], 'body', 14, true);
  check(!sb.shot.head && sb.shot.damage === 75 && sb.after.state === 'up', `sniper body shot does not (${sb.shot.damage}, target ${sb.after.state})`);
  const snds = await cfw(() => window.__crossfire.sounds());
  check(['bolt_up', 'bolt_back', 'bolt_fwd', 'bolt_down'].every((n) => snds.includes(n)), 'the bolt is worked after a shot (bolt sounds)');
  // the bolt has to close before the eye goes back to the scope
  for (let k = 0; k < 30 && (await cfw(() => window.__crossfire.weapon())).action !== 'idle'; k++) await wait(100);
  await cfw(() => window.__crossfire.hold('aim', true));
  await wait(600);
  const sc = await cfw(() => window.__crossfire.weapon());
  if (flag('shots')) await page.screenshot({ path: path.join(OUT, 'sniper_scope.png') });
  check(sc.scope > 0.98, `aiming the sniper rifle shows the scope (${sc.scope.toFixed(2)})`);
  await cfw(() => window.__crossfire.hold('aim', false));
  await wait(400);

  // shotgun: a spread of pellets, a hard kick and a pump
  w = await select(2, 'shotgun');
  check(w.id === 'shotgun', 'key 2 selects the pump shotgun');
  const sg = await shootTarget(pool[4], 'body', 3);
  check(sg.shot.pellets === 9 && sg.shot.hits >= 6 && sg.shot.damage >= 70, `shotgun: 9 pellets, ${sg.shot.hits} on target at 3 m for ${sg.shot.damage.toFixed(0)} damage`);
  await wait(800);
  const gs = await cfw(() => window.__crossfire.sounds());
  check(gs.includes('shotgun_shot') && gs.includes('pump_back') && gs.includes('pump_fwd'), 'shotgun fires and is pumped (sounds)');
  for (const [slot, id] of [[3, 'sniper'], [2, 'shotgun']]) {
    await select(slot, id);
    await cfw(() => window.__crossfire.hold('reload', true));
    await wait(40);
    await cfw(() => window.__crossfire.hold('reload', false));
    let lowered = false;
    let returned = false;
    let limbsAbsent = true;
    for (let k = 0; k < 85; k++) {
      const state = await cfw(() => window.__crossfire.weapon());
      lowered ||= state.view.lower > 0.15;
      returned ||= lowered && state.view.lower < 0.01;
      limbsAbsent &&= state.viewMeshes.every((n) => !/hand|forearm|mag-spare/i.test(n));
      if (state.action === 'idle' && k > 5) break;
      await wait(60);
    }
    const loaded = await cfw(() => window.__crossfire.weapon());
    check(limbsAbsent, `${id}: no visible reload limbs or spare magazine`);
    check(lowered && returned && loaded.ammo === loaded.magazine && loaded.reserve === 'infinite', `${id}: reload dips, returns and fills the magazine with infinite reserve`);
  }
  await select(1, 'rifle');
}

// --- tactical map (hold Tab) -------------------------------------------------------------------
{
  const tac = () => page.evaluate(() => window.__crossfire.tactical());
  // the page was opened with ?nohud for clean screenshots; the overlay lives in the HUD, so show the UI again
  await page.evaluate(() => (document.getElementById('ui').style.display = ''));
  // a known open spot: the first spawn point, facing east
  const sp = await page.evaluate(() => {
    const s = window.__crossfire.mapInfo().spawns[0];
    return { x: s.pos[0], z: s.pos[2] };
  });
  await page.evaluate((p) => window.__crossfire.teleport(p.x, 0.2, p.z, 90, 0), sp);
  await new Promise((r) => setTimeout(r, 300));
  const focusBefore = (await tac()).focus;
  check(!(await tac()).visible, 'tactical map hidden before Tab');
  await page.keyboard.down('Tab');
  await new Promise((r) => setTimeout(r, 250));
  let t = await tac();
  check(t.visible && t.domVisible, 'holding Tab shows the tactical map');
  check(t.focus === focusBefore, `Tab does not move keyboard focus (${focusBefore} -> ${t.focus})`);
  const mapId = await page.evaluate(() => window.__crossfire.stats().mapId);
  check(!!t.map && t.map === mapId, `tactical layout belongs to the loaded map (${t.map} / ${mapId})`);
  const off = Math.hypot(t.marker.x - t.expected.x, t.marker.y - t.expected.y);
  check(off < 1, `player marker sits on the player's world position (${off.toFixed(2)} px off)`);
  check(Math.abs(t.marker.rotation - Math.PI / 2) < 0.02, `marker faces east for heading 90 (rotation ${t.marker.rotation.toFixed(3)} rad)`);
  check(t.marker.teammates === 0, 'no teammate markers without teammate data');
  // walking east while the map is open: movement keeps working and the marker moves right on the map
  const m0 = t.marker;
  await page.evaluate(() => window.__crossfire.hold('forward', true));
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => window.__crossfire.hold('forward', false));
  t = await tac();
  check(t.visible && t.marker.x - m0.x > 5 && Math.abs(t.marker.y - m0.y) < 2, `marker moves east (right) while walking east with the map open (dx=${(t.marker.x - m0.x).toFixed(1)}, dy=${(t.marker.y - m0.y).toFixed(1)})`);
  // (screenshots stall the page's frames for a moment, so they come after the movement checks)
  if (flag('shots')) await page.screenshot({ path: path.join(OUT, 'tactical_map.png') });
  // turning north rotates the arrow to point up
  await page.evaluate(() => window.__crossfire.look(0, 0));
  await new Promise((r) => setTimeout(r, 150));
  t = await tac();
  check(Math.abs(t.marker.rotation) < 0.02, `marker points north after turning north (rotation ${t.marker.rotation.toFixed(3)})`);
  // free-for-all: reported players never appear (nobody is a teammate, and enemies are never shown)
  const p = await page.evaluate(() => window.__crossfire.player());
  await page.evaluate((q) => {
    window.__crossfire.remotePlayer({ id: 'test-ally', name: 'Ally', team: 'blue', x: q.x + 2, z: q.z + 2, yaw: 0 });
    window.__crossfire.remotePlayer({ id: 'test-enemy', team: 'red', x: q.x - 2, z: q.z - 2 });
  }, p);
  await new Promise((r) => setTimeout(r, 150));
  t = await tac();
  check(t.marker.teammates === 0, `free-for-all: no markers for other players, friend or foe (${t.marker.teammates})`);
  if (flag('shots')) await page.screenshot({ path: path.join(OUT, 'tactical_map_teammate.png') });
  await page.evaluate(() => window.__crossfire.clearRemotePlayers());
  await page.keyboard.up('Tab');
  await new Promise((r) => setTimeout(r, 150));
  t = await tac();
  check(!t.visible && !t.domVisible, 'releasing Tab hides the tactical map');
}

check(errors.length === 0, `no console errors (${errors.length})`);
for (const e of errors.slice(0, 10)) console.log('   ', e.slice(0, 400));

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall browser checks passed');
process.exit(failures.length ? 1 : 0);
