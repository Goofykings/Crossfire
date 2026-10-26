/**
 * Wall-gap audit: finds places where you can see into (or through) something solid. Needs a running server.
 *
 *   node tools/dev-wallgaps.mjs [--url http://localhost:5173/] [--map european-town] [--reveal 0.45] [--out test-results/wallgaps-<map>.json]
 *
 * From a grid of walkable points it casts horizontal rays at knee, chest and eye height. A ray that enters a solid
 * collision box (building, wall, arch) and travels more than `reveal` metres inside it without hitting a visible
 * triangle looked through a hole: a missing wall, a gap at a corner or a slit between two pieces. Window and door
 * reveals and roller-door recesses are shallower than `reveal`, so they do not count; nor do rays that only graze a
 * face (under 17° to it) or see-through walls (fences, railings). Results are grouped by the box they pass into.
 * Exit code 1 if any gap is found.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const URL = arg('url', 'http://localhost:5173/');
const MAP = arg('map', 'european-town');
const REVEAL = Number(arg('reveal', '1.0'));
const OUT = arg('out', `test-results/wallgaps-${MAP}.json`);
const SOLID = /^(building|wall|arch):/;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 800, height: 450 },
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.goto(`${URL}?autoplay&nohud&map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 240000, polling: 500 });
const batches = await page.evaluate(() => window.__crossfire.dumpBatches());
const { boxes } = await page.evaluate(async (m) => (await fetch(`assets/models/${m}/collision.json`)).json(), MAP);
const info = await page.evaluate(() => window.__crossfire.mapInfo());
const play = info.playArea;
const seeThrough = new Set(info.walls.filter((w) => w.style === 'fence' || w.style === 'railing').map((w) => `wall:${w.id}`));
await browser.close();

// ---- triangles in a 3D grid -------------------------------------------------------------------------
const CELL = 1;
const T = []; // flat: ax ay az bx by bz cx cy cz
const src = [];
for (const b of batches) {
  if (b.alpha < 0.99) continue; // blended surfaces (none in the static map) do not hide anything
  const p = b.positions;
  const idx = b.indices;
  let o = 0;
  for (let t = 0; t < idx.length / 3; t++) {
    while (o + 1 < b.origin.length && b.origin[o + 1].tri <= t) o++;
    for (let k = 0; k < 3; k++) T.push(p[idx[t * 3 + k] * 3], p[idx[t * 3 + k] * 3 + 1], p[idx[t * 3 + k] * 3 + 2]);
    src.push(b.origin[o].name);
  }
}
const grid = new Map();
const key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
for (let i = 0; i < T.length / 9; i++) {
  const o = i * 9;
  const lo = [Math.min(T[o], T[o + 3], T[o + 6]), Math.min(T[o + 1], T[o + 4], T[o + 7]), Math.min(T[o + 2], T[o + 5], T[o + 8])];
  const hi = [Math.max(T[o], T[o + 3], T[o + 6]), Math.max(T[o + 1], T[o + 4], T[o + 7]), Math.max(T[o + 2], T[o + 5], T[o + 8])];
  if (hi[1] < -0.5 || lo[1] > 6) continue; // rays stay between 0.3 and 3 m above the ground
  for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
    for (let y = Math.max(-1, Math.floor(lo[1] / CELL)); y <= Math.min(6, Math.floor(hi[1] / CELL)); y++)
      for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
        const k = key(x, y, z);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(i);
      }
}
console.log(`${MAP}: ${T.length / 9} triangles, ${boxes.length} collision boxes`);

// Möller-Trumbore, both faces (a back face is still a visible surface from the other side's point of view: it blocks)
function hitTri(i, ox, oy, oz, dx, dy, dz) {
  const o = i * 9;
  const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
  const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const tx = ox - T[o], ty = oy - T[o + 1], tz = oz - T[o + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-4 ? t : Infinity;
}

// first visible surface along a horizontal ray up to tMax (walks the grid in small steps; rays are horizontal)
function firstSurface(ox, oy, oz, dx, dz, tMax) {
  const seen = new Set();
  let best = Infinity;
  const cy = Math.floor(oy / CELL);
  for (let s = 0; s <= tMax + CELL; s += CELL * 0.5) {
    if (best <= s - CELL) break;
    const cx = Math.floor((ox + dx * s) / CELL), cz = Math.floor((oz + dz * s) / CELL);
    for (const [ax, az] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const l = grid.get(key(cx + ax, cy, cz + az));
      if (!l) continue;
      for (const i of l) {
        if (seen.has(i)) continue;
        seen.add(i);
        const t = hitTri(i, ox, oy, oz, dx, 0, dz);
        if (t < best) best = t;
      }
    }
  }
  return best;
}

function firstSurfaceSrc(ox, oy, oz, dx, dz, tMax) {
  let best = Infinity, who = null;
  const cy = Math.floor(oy / CELL);
  const seen = new Set();
  for (let s = 0; s <= tMax + CELL; s += CELL * 0.5) {
    if (best <= s - CELL) break;
    const cx = Math.floor((ox + dx * s) / CELL), cz = Math.floor((oz + dz * s) / CELL);
    for (const [ax, az] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const l = grid.get(key(cx + ax, cy, cz + az));
      if (!l) continue;
      for (const i of l) {
        if (seen.has(i)) continue;
        seen.add(i);
        const t = hitTri(i, ox, oy, oz, dx, 0, dz);
        if (t < best) {
          best = t;
          who = src[i];
        }
      }
    }
  }
  return { t: best, src: who };
}

// entry distance into an oriented box (yaw about +Y, same convention as CollisionWorld)
function boxEntry(b, ox, oy, oz, dx, dz) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  // world -> local: inverse of world.x = lx*c + lz*s, world.z = -lx*s + lz*c
  const rx = ox - b.c[0], rz = oz - b.c[2];
  const lx = rx * c - rz * s, lz = rx * s + rz * c;
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  // stay clear of the box's top and bottom faces (a ray along a face is not looking through anything)
  if (Math.abs(oy - b.c[1]) > b.h[1] - 0.05) return null;
  let t0 = -Infinity, t1 = Infinity, cos = 1;
  for (const [o, d, h] of [[lx, ldx, b.h[0]], [lz, ldz, b.h[2]]]) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) > h) return null;
      continue;
    }
    let a = (-h - o) / d, z = (h - o) / d;
    if (a > z) [a, z] = [z, a];
    if (a > t0) {
      t0 = a;
      cos = Math.abs(d); // the entry face is perpendicular to this axis
    }
    t1 = Math.min(t1, z);
  }
  if (t1 < t0 || t1 <= 0) return null;
  return { t0: Math.max(0, t0), t1, cos };
}

// thin boxes (awnings, balconies, arch slabs, railings) are see-through by design; only walls of full height count
const solid = boxes.filter((b) => SOLID.test(b.tag) && b.h[1] >= 1.0 && !seeThrough.has(b.tag));
const floors = boxes.filter((b) => /^(ground|terrace|stairs)/.test(b.tag));
function groundAt(x, z) {
  let g = -Infinity;
  for (const b of floors) {
    const e = boxEntry({ ...b, c: [b.c[0], 0, b.c[2]], h: [b.h[0], 1e9, b.h[2]] }, x, 0, z, 1, 0);
    if (e && e.t0 === 0) g = Math.max(g, b.c[1] + b.h[1]);
  }
  return g;
}
function insideSolid(x, y, z, r) {
  for (const b of solid) {
    const e = boxEntry({ ...b, h: [b.h[0] + r, b.h[1], b.h[2] + r] }, x, y, z, 1, 0);
    if (e && e.t0 === 0) return true;
  }
  return false;
}

const DIRS = 24;
const HEIGHTS = [0.4, 1.6, 2.4];
const gaps = new Map();
let rays = 0;
for (let x = play[0] + 0.5; x < play[2]; x += 1) {
  for (let z = play[1] + 0.5; z < play[3]; z += 1) {
    const g = groundAt(x, z);
    if (!Number.isFinite(g) || insideSolid(x, g + 1, z, 0.3)) continue;
    for (const h of HEIGHTS) {
      const y = g + h;
      for (let k = 0; k < DIRS; k++) {
        const a = (k / DIRS) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        let first = null;
        for (const b of solid) {
          const e = boxEntry(b, x, y, z, dx, dz);
          if (e && e.t0 < 12 && (!first || e.t0 < first.e.t0)) first = { b, e };
        }
        if (!first || first.e.cos < 0.3) continue;
        rays++;
        const depth = Math.min(REVEAL, first.e.t1 - first.e.t0 - 0.02);
        if (depth < 0.15) continue; // grazing a corner or a thin slab
        const t = firstSurface(x, y, z, dx, dz, first.e.t0 + depth + 0.05);
        if (t > first.e.t0 + depth) {
          const px = x + dx * first.e.t0, pz = z + dz * first.e.t0;
          const k2 = `${first.b.tag}@${Math.round(px * 2) / 2},${Math.round(pz * 2) / 2},${Math.round(y)}`;
          // how deep the first surface really is, and what it belongs to (a deep recess vs. a see-through hole)
          const far = firstSurfaceSrc(x, y, z, dx, dz, first.e.t1 + 3);
          const rec = gaps.get(k2) ?? {
            tag: first.b.tag, at: [+px.toFixed(2), +y.toFixed(2), +pz.toFixed(2)], from: [x, +y.toFixed(2), z],
            dir: [+dx.toFixed(3), +dz.toFixed(3)], boxDepth: +(first.e.t1 - first.e.t0).toFixed(2),
            surfaceDepth: Number.isFinite(far.t) ? +(far.t - first.e.t0).toFixed(2) : null, surface: far.src, rays: 0,
          };
          rec.rays++;
          gaps.set(k2, rec);
        }
      }
    }
  }
}
const list = [...gaps.values()].sort((a, b) => b.rays - a.rays);
const byTag = {};
for (const g of list) byTag[g.tag] = (byTag[g.tag] ?? 0) + g.rays;
console.log(`${rays} rays into solid boxes; ${list.length} gap spots`);
for (const [tag, n] of Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  const spots = list.filter((g) => g.tag === tag).slice(0, 3).map((g) => `(${g.at.join(', ')})`).join(' ');
  console.log(`  ${tag.padEnd(22)} ${String(n).padStart(4)} rays  ${spots}`);
}
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(list, null, 1));
process.exit(list.length ? 1 : 0);
