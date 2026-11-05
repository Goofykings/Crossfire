/** Repeatable map visual review (development only). Loads each map in local practice mode
 * and captures camera views derived from that map's own layout data (top-down overview,
 * corner aerials, landmark, streets, interiors, stairs, upper routes, ladders, rooftops,
 * underground passages, spawns), plus a few authored detail views per map.
 *
 *   node tools/map-review.mjs [url] [--map <id>] [--out <dir>] [--quality <q>] [--only a,b] [--views <json>]
 *     [--settings <json>]
 *
 * Default url http://127.0.0.1:5173/ (Vite dev server). Writes <out>/<map>/<nn>-<name>.png and
 * <out>/results.json with each view's camera pose and renderer statistics (draw calls,
 * active meshes, frame time) and each map's measured load time. Camera placement is not a
 * movement test: physical traversal is covered by the shared controller test suites. */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { setTimeout as delay } from 'node:timers/promises';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const base = args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:5173/';
const out = option('--out', 'test-results/map-review');
const quality = option('--quality', 'high');
// e.g. --settings '{"chromebookMode":true}': applied through the game's own settings hook after load
const settings = option('--settings', '');
const only = option('--only', '')?.split(',').filter(Boolean) ?? [];
const maps = option('--map', '') ? [option('--map')] : ['european-town', 'industrial-complex', 'modern-city'];
const EYE = 1.64;

const rectCentre = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
const headingTo = (from, to) => (Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180 / Math.PI + 360) % 360;
const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);

/** Views derived from layout data, so a regenerated map is reviewed without editing this file. */
function derivedViews(layout) {
  const views = [];
  const add = (name, x, y, z, heading, pitch = 0) => views.push({ name, pose: [x, y, z, heading, pitch] });
  const [px0, pz0, px1, pz1] = layout.playArea;
  const half = Math.max(px1 - px0, pz1 - pz0) / 2;
  add('overview', 0, half * 1.95, 0.01, 0, -89.9);
  // Aerials clear the tallest building (city towers reach ~20 m).
  const tallest = Math.max(12, ...layout.buildings.map((b) => b.height ?? b.floors * 3.3 + 2));
  for (const [sx, sz, name] of [[-1, -1, 'aerial-nw'], [1, -1, 'aerial-ne'], [1, 1, 'aerial-se'], [-1, 1, 'aerial-sw']])
    add(name, sx * half * 1.05, Math.max(half * .9, tallest + 10), sz * half * 1.05, headingTo([sx, sz], [0, 0]), -34);
  const zones = layout.ground.zones;
  const plaza = zones.find((z) => z.kind === 'plaza') ?? [...zones].filter((z) => z.kind === 'yard').sort((a, b) => area(b.rect) - area(a.rect))[0];
  if (plaza) {
    const [cx, cz] = rectCentre(plaza.rect), [x0, z0, x1, z1] = plaza.rect;
    add('landmark-south', cx, plaza.height + EYE, z1 - .6, 0, -4);
    add('landmark-west', x0 + .6, plaza.height + EYE, cz, 90, -4);
    add('landmark-high', cx, plaza.height + 9, z1 - .5, 0, -42);
  }
  const streets = zones.filter((z) => ['street', 'alley'].includes(z.kind)).sort((a, b) => area(b.rect) - area(a.rect)).slice(0, 5);
  for (const s of streets) {
    const [x0, z0, x1, z1] = s.rect, [cx, cz] = rectCentre(s.rect), alongX = x1 - x0 >= z1 - z0;
    if (alongX) add(`street-${s.id}`, x0 + .8, s.height + EYE, cz, 90, -2);
    else add(`street-${s.id}`, cx, s.height + EYE, z0 + .8, 180, -2);
  }
  for (const b of layout.buildings) {
    for (const room of b.rooms ?? []) {
      const [cx, cz] = rectCentre(room.rect), [x0, z0, x1, z1] = room.rect, alongX = x1 - x0 >= z1 - z0;
      add(`room-${b.id}`, alongX ? x0 + .5 : cx, EYE, alongX ? cz : z0 + .5, alongX ? 90 : 180, -6);
    }
    for (const interior of b.interiors ?? []) {
      const [x0, z0, x1, z1] = interior.rect, [cx, cz] = rectCentre(interior.rect);
      // Stand in the corner farthest from the building's raised stair/landing waypoints, so the
      // camera is on the floor rather than inside a flight.
      const raised = (layout.circulationRoutes ?? []).filter((r) => r.id === b.id).flatMap((r) => r.waypoints).filter((w) => w[1] > .3);
      const corners = [[x0 + .7, z0 + .7], [x1 - .7, z0 + .7], [x1 - .7, z1 - .7], [x0 + .7, z1 - .7]];
      const clearance = ([x, z]) => Math.min(Infinity, ...raised.map((w) => Math.hypot(w[0] - x, w[2] - z)));
      const [x, z] = corners.reduce((best, c) => clearance(c) > clearance(best) ? c : best);
      add(`interior-${b.id}`, x, EYE, z, headingTo([x, z], [cx, cz]), -8);
    }
  }
  for (const route of layout.circulationRoutes ?? []) {
    const w = route.waypoints;
    for (const [i, name] of [[0, 'entry'], [2, 'stair-turn'], [4, 'upper'], [w.length - 2, 'exit']]) {
      const a = w[Math.min(i, w.length - 2)], b = w[Math.min(i + 1, w.length - 1)];
      add(`circulation-${route.id}-${name}`, a[0], a[1] + EYE, a[2], headingTo([a[0], a[2]], [b[0], b[2]]), b[1] > a[1] + .3 ? 14 : -4);
    }
  }
  for (const route of layout.navigation?.upperRoutes ?? []) {
    const w = route.waypoints, a = w[0], b = w[Math.min(2, w.length - 1)], mid = w[Math.floor(w.length / 2)];
    add(`upper-${route.id}-stair`, a[0], a[1] + EYE, a[2], headingTo([a[0], a[2]], [b[0], b[2]]), 16);
    const next = w[Math.floor(w.length / 2) + 1] ?? w.at(-1);
    add(`upper-${route.id}-deck`, mid[0], mid[1] + EYE, mid[2], headingTo([mid[0], mid[2]], [next[0], next[2]]), -6);
  }
  for (const ladder of layout.ladders ?? []) {
    const [wx, wz] = ladder.wall, [ox, oz] = ladder.out;
    add(`ladder-${ladder.id}`, wx + ox * 3.2, ladder.bottom + EYE, wz + oz * 3.2, headingTo([ox, oz], [0, 0]), 22);
    add(`ladder-${ladder.id}-top`, wx - ox * 1.2, ladder.top + EYE, wz - oz * 1.2, headingTo([0, 0], [-ox, -oz]), -12);
  }
  for (const passage of layout.underground ?? []) {
    for (const [i, stair] of passage.entrances.entries()) {
      const [cx, cz] = rectCentre(stair.rect), [ox, oz] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[stair.side];
      add(`underground-${passage.id}-entrance-${i}`, cx + ox * 2.4, EYE, cz + oz * 2.4, headingTo([ox, oz], [0, 0]), -18);
    }
    const w = passage.waypoints ?? [];
    for (const [i, p] of w.entries()) if (i > 0 && i < w.length - 1 && p[1] < -1) {
      const q = w[i + 1];
      add(`underground-${passage.id}-${i}`, p[0], p[1] + EYE, p[2], headingTo([p[0], p[2]], [q[0], q[2]]), -3);
    }
  }
  for (const spawn of layout.spawns.filter((_, i) => i % 4 === 0))
    add(`spawn-${spawn.id}`, spawn.pos[0], spawn.pos[1] + EYE, spawn.pos[2], spawn.heading, -3);
  return views;
}

/** Authored detail views that layout data cannot infer (edit when a map is redesigned). */
const viewsFile = option('--views', 'tools/map-review-views.json');
const EXTRA = JSON.parse(fs.existsSync(viewsFile) ? fs.readFileSync(viewsFile, 'utf8') : '{}');

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
  protocolTimeout: 300000, defaultViewport: { width: 1280, height: 720 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-background-timer-throttling'] });
const page = await browser.newPage(), errors = [], results = { quality, settings: settings ? JSON.parse(settings) : null, maps: {} };
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/assets/')) errors.push(`${r.status()} ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error' && /shader|WebGL|framebuffer|material/i.test(m.text())) errors.push(m.text()); });
try {
  const t0 = Date.now();
  await page.goto(`${base}?practice&autoplay&nohud&map=${maps[0]}&quality=${quality}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await completeGuestProfile(page, 'Map Reviewer');
  await page.waitForFunction(() => window.__crossfire.ready(), { timeout: 300000 });
  if (settings) await page.evaluate((p) => window.__crossfire.setSetting(p), JSON.parse(settings));
  let firstLoad = Date.now() - t0;
  for (const id of maps) {
    const start = Date.now();
    if ((await page.evaluate(() => window.__crossfire.stats())).mapId !== id) await page.evaluate((m) => window.__crossfire.loadMap(m), id);
    await page.waitForFunction(() => window.__crossfire.loadingState().sceneReady, { timeout: 300000 });
    const loadMs = firstLoad ?? Date.now() - start;
    firstLoad = null;
    const layout = JSON.parse(fs.readFileSync(`src/maps/${id}/layout.json`, 'utf8'));
    let views = [...derivedViews(layout), ...(EXTRA[id] ?? []).map(([name, ...pose]) => ({ name, pose }))].map((v, i) => ({ ...v, index: i + 1 }));
    if (only.length) views = views.filter((v) => only.some((o) => v.name.includes(o)));
    fs.mkdirSync(`${out}/${id}`, { recursive: true });
    const captured = [];
    await delay(2500);
    for (const [i, view] of views.entries()) {
      await page.evaluate((p) => window.__crossfire.freeCam(...p), view.pose);
      await delay(i === 0 ? 2500 : 900);
      const file = `${out}/${id}/${String(view.index).padStart(2, '0')}-${view.name}.png`;
      await page.screenshot({ path: file });
      const stats = await page.evaluate(() => { const s = window.__crossfire.stats(); return { fps: s.fps, frameMs: s.frameMs, drawCalls: s.drawCalls, activeMeshes: s.activeMeshes, missing: s.missingMaterials }; });
      if (stats.missing?.length) errors.push(`${id} ${view.name}: missing materials ${stats.missing}`);
      captured.push({ ...view, file, stats });
    }
    const draws = captured.map((v) => v.stats.drawCalls).sort((a, b) => a - b);
    results.maps[id] = { loadMs, views: captured, drawCalls: { median: draws[Math.floor(draws.length / 2)], max: draws.at(-1) } };
    console.log(`${id}: ${captured.length} views, load ${loadMs} ms, draw calls median ${results.maps[id].drawCalls.median} max ${results.maps[id].drawCalls.max}`);
  }
  results.errors = errors;
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  if (errors.length) { console.error(errors); process.exitCode = 1; }
} finally { await browser.close(); }
