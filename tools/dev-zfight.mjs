import { completeGuestProfile } from './guest-profile-helper.mjs';
// Geometry audit: finds pairs of visible triangles that sit in (nearly) the same plane and overlap, which is what
// z-fights on screen. Needs a running server. Usage:
//   node tools/dev-zfight.mjs [--url http://localhost:5173/] [--eps 0.02] [--out test-results/zfight.json]
// Only same-facing pairs are reported as fights: back-to-back pairs are culled from either side and are listed as a count.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const URL = arg('url', 'http://localhost:5173/');
const EPS = Number(arg('eps', '0.02')); // max plane separation (m) still treated as fighting
const OUT = arg('out', 'test-results/zfight.json');
const MIN_AREA = Number(arg('min-area', '0.0004')); // m^2 of overlap

const DUMP = arg('dump', 'test-results/batches-dump.json');
let batches;
if (process.argv.includes('--reuse') && fs.existsSync(DUMP)) {
  batches = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
} else {
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 800, height: 450 },
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.goto(`${URL}?autoplay&nohud`, { waitUntil: 'domcontentloaded' });
await completeGuestProfile(page);
await page.waitForFunction(() => window.__crossfire && window.__crossfire.ready(), { timeout: 240000, polling: 500 });
batches = await page.evaluate(() => window.__crossfire.dumpBatches());
await browser.close();
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(DUMP, JSON.stringify(batches));
}

// ---- flatten to triangles ------------------------------------------------------------------------
const tris = []; // {a:[x,y,z], b, c, n, mat, src, alpha}
for (const b of batches) {
  const p = b.positions;
  const idx = b.indices;
  let o = 0;
  for (let t = 0; t < idx.length / 3; t++) {
    while (o + 1 < b.origin.length && b.origin[o + 1].tri <= t) o++;
    const v = [0, 1, 2].map((k) => [p[idx[t * 3 + k] * 3], p[idx[t * 3 + k] * 3 + 1], p[idx[t * 3 + k] * 3 + 2]]);
    const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
    const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    if (len < 1e-7) continue;
    tris.push({ v, n: n.map((x) => x / len), area: len / 2, mat: b.material, alpha: b.alpha, src: b.origin[o].name, inst: `${b.name}#${o}` });
  }
}
console.log(`${batches.length} batches, ${tris.length} triangles`);

// ---- spatial hash -------------------------------------------------------------------------------
const CELL = 2;
const grid = new Map();
const key = (x, y, z) => `${x},${y},${z}`;
tris.forEach((t, i) => {
  const lo = [0, 1, 2].map((k) => Math.min(t.v[0][k], t.v[1][k], t.v[2][k]) - EPS);
  const hi = [0, 1, 2].map((k) => Math.max(t.v[0][k], t.v[1][k], t.v[2][k]) + EPS);
  t.lo = lo;
  t.hi = hi;
  for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
    for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
      for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
        const k = key(x, y, z);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(i);
      }
});

// ---- 2D overlap area of two coplanar triangles (Sutherland-Hodgman) ------------------------------
function clip(subject, a, b) {
  const out = [];
  const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < subject.length; i++) {
    const p = subject[i];
    const q = subject[(i + 1) % subject.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
function area2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}
function overlapArea(A, B, drop) {
  const proj = (t) => t.v.map((p) => [p[(drop + 1) % 3], p[(drop + 2) % 3]]);
  let pa = proj(A);
  let pb = proj(B);
  const orient = (q) => (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
  if (orient(pa) < 0) pa = [pa[0], pa[2], pa[1]];
  if (orient(pb) < 0) pb = [pb[0], pb[2], pb[1]];
  let poly = pa;
  for (let i = 0; i < 3 && poly.length > 0; i++) poly = clip(poly, pb[i], pb[(i + 1) % 3]);
  return poly.length < 3 ? 0 : area2(poly);
}

// ---- pair search --------------------------------------------------------------------------------
const seen = new Set();
const found = [];
let backToBack = 0;
let hiddenBottoms = 0;
for (const [k, list] of grid) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const ia = Math.min(list[i], list[j]);
      const ib = Math.max(list[i], list[j]);
      const A = tris[ia];
      const B = tris[ib];
      const dot = A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2];
      if (Math.abs(dot) < 0.9995) continue;
      const pk = ia * 4000003 + ib;
      if (seen.has(pk)) continue;
      // bounding boxes must overlap (they were grown by EPS)
      if (A.lo[0] > B.hi[0] || A.hi[0] < B.lo[0] || A.lo[1] > B.hi[1] || A.hi[1] < B.lo[1] || A.lo[2] > B.hi[2] || A.hi[2] < B.lo[2]) continue;
      seen.add(pk);
      const d0 = A.n[0] * A.v[0][0] + A.n[1] * A.v[0][1] + A.n[2] * A.v[0][2];
      let sep = 0;
      for (const p of B.v) sep = Math.max(sep, Math.abs(A.n[0] * p[0] + A.n[1] * p[1] + A.n[2] * p[2] - d0));
      if (sep > EPS) continue;
      const drop = A.n.map(Math.abs).indexOf(Math.max(...A.n.map(Math.abs)));
      const ov = overlapArea(A, B, drop);
      if (ov < MIN_AREA) continue;
      if (dot < 0) {
        backToBack++;
        continue;
      }
      // faces pointing down at ground level are never seen
      if (A.n[1] < -0.9 && (A.v[0][1] + B.v[0][1]) / 2 < 0.06) {
        hiddenBottoms++;
        continue;
      }
      const c = [0, 1, 2].map((q) => (A.v[0][q] + A.v[1][q] + A.v[2][q] + B.v[0][q] + B.v[1][q] + B.v[2][q]) / 6);
      found.push({ a: ia, b: ib, sep, ov, c, n: A.n });
    }
  }
}
console.log(`same-facing overlapping near-coplanar pairs: ${found.length} (back-to-back ignored: ${backToBack}, ground-level undersides ignored: ${hiddenBottoms})`);

// ---- group ---------------------------------------------------------------------------------------
// A pair is harmless when both faces belong to the same piece and use the same material: world-space UVs and the
// same vertex colours make them render pixel-identically. Everything else can flicker. Tier 1 (< TIER1 m apart) will
// fight at normal viewing distances; tier 2 only at long range.
const TIER1 = Number(arg('tier1', '0.002'));
const clean = (s) =>
  s
    .replace(/#\d+$/, '')
    .replace(/\.\d{3}$/, '')
    .replace(/B\d+_shell_primitive\d+/, 'Bxx_shell')
    .replace(/KIT_shut_(open|closed)_.*?__/, 'KIT_shut_$1__')
    .replace(/KIT_(sill|flowerbox)_[\d.]+__/, 'KIT_$1__')
    .replace(/KIT_win_.*?__/, 'KIT_win__')
    .replace(/KIT_(door|surround|grille|threshold|balcony|shop|hsign)_.*?__/, 'KIT_$1__');
const groups = new Map();
let benign = 0;
for (const f of found) {
  const A = tris[f.a];
  const B = tris[f.b];
  if (A.inst === B.inst && A.mat === B.mat) {
    benign++;
    continue;
  }
  const tier = f.sep < TIER1 ? 'T1' : 'T2';
  const names = [clean(A.src), clean(B.src)].sort();
  const mats = [A.mat, B.mat].sort();
  const axis = ['x', 'y', 'z'][f.n.map(Math.abs).indexOf(Math.max(...f.n.map(Math.abs)))];
  const gk = `${tier} ${names[0]} | ${names[1]} | ${mats[0]} + ${mats[1]} | n=${axis}`;
  let g = groups.get(gk);
  if (!g) groups.set(gk, (g = { key: gk, tier, pairs: 0, area: 0, sepMax: 0, examples: [], alpha: Math.min(A.alpha, B.alpha) }));
  g.pairs++;
  g.area += f.ov;
  g.sepMax = Math.max(g.sepMax, f.sep);
  if (g.examples.length < 4) {
    g.examples.push(f.c.map((x) => Math.round(x * 100) / 100));
    (g.tris ??= []).push([f.a, f.b]);
  }
}
const sorted = [...groups.values()].sort((x, y) => (x.tier === y.tier ? y.area - x.area : x.tier < y.tier ? -1 : 1));
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ eps: EPS, pairs: found.length, benign, backToBack, groups: sorted }, null, 1));
const t1 = sorted.filter((g) => g.tier === 'T1');
const t2 = sorted.filter((g) => g.tier === 'T2');
const sum = (l) => l.reduce((a, g) => a + g.area, 0).toFixed(1);
console.log(`benign (same piece, same material): ${benign}`);
console.log(`TIER 1 (< ${TIER1 * 1000} mm): ${t1.length} families, ${sum(t1)} m2   TIER 2 (to ${EPS * 1000} mm): ${t2.length} families, ${sum(t2)} m2`);
for (const g of sorted.slice(0, Number(arg('top', '40')))) {
  console.log(`${g.area.toFixed(2).padStart(7)} m2 ${String(g.pairs).padStart(5)}x  ${g.key}  e.g. ${JSON.stringify(g.examples[0])}${g.alpha < 1 ? ' [alpha]' : ''}`);
}

// --explain <substring>: print the actual triangles of the first examples of matching families
const want = arg('explain', '');
if (want) {
  const fmt = (t) => t.v.map((p) => `(${p.map((x) => x.toFixed(3)).join(', ')})`).join(' ');
  for (const g of sorted.filter((x) => x.key.includes(want)).slice(0, 3)) {
    console.log(`
== ${g.key}`);
    for (const [a, b] of g.tris.slice(0, 2)) {
      console.log(`  A ${tris[a].src} [${tris[a].mat}] n=${tris[a].n.map((x) => x.toFixed(2))}
    ${fmt(tris[a])}`);
      console.log(`  B ${tris[b].src} [${tris[b].mat}]
    ${fmt(tris[b])}`);
    }
  }
}
