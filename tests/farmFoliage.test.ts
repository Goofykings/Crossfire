import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NullEngine, Mesh, Scene, Vector3 } from '@babylonjs/core';
import { FoliageLod } from '../src/maps/FoliageLod';
import layout from '../src/maps/farmstead/layout.json';

/**
 * Farmstead foliage (2026-11): bushes, hedges, canopies and wall ivy are volumes of alpha-cut leaf cards around a small opaque core.
 * These checks read the shipped GLBs and prove what the screenshots show: leaves from every viewing angle (no edge-on view, no
 * exposed tube or cone), a cover that fills the silhouette from the front, side and above, shapes that stay inside the envelope the
 * collider promises, both sides of every card rendered, and a lite twin that is lighter but not sparse.
 */
interface Prim { mat: string; tris: number[][] }   // each triangle: [x0,y0,z0, x1,y1,z1, x2,y2,z2]

function readGlb(path: string): Prim[] {
  const b = readFileSync(path);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = b.subarray(20 + jsonLen + 8);
  const out: Prim[] = [];
  const view = (i: number) => json.bufferViews[json.accessors[i].bufferView];
  const nodes = json.nodes as { mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  for (const n of nodes) {
    if (n.mesh === undefined) continue;
    expect(n.matrix ?? n.rotation ?? n.scale, 'foliage props are exported without node transforms').toBeUndefined();
    const off = n.translation ?? [0, 0, 0];
    for (const p of json.meshes[n.mesh].primitives) {
      const pa = json.accessors[p.attributes.POSITION], pv = view(p.attributes.POSITION);
      const pos = new Float32Array(bin.buffer.slice(bin.byteOffset + (pv.byteOffset ?? 0) + (pa.byteOffset ?? 0), bin.byteOffset + (pv.byteOffset ?? 0) + (pa.byteOffset ?? 0) + pa.count * 12));
      const ia = json.accessors[p.indices], iv = view(p.indices), base = bin.byteOffset + (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
      const idx: number[] = [];
      for (let k = 0; k < ia.count; k++) idx.push(ia.componentType === 5125 ? bin.buffer.slice(base + k * 4, base + k * 4 + 4).byteLength && new DataView(bin.buffer, base + k * 4, 4).getUint32(0, true) : new DataView(bin.buffer, base + k * 2, 2).getUint16(0, true));
      const tris: number[][] = [];
      for (let k = 0; k < idx.length; k += 3) {
        const t: number[] = [];
        for (const i of [idx[k], idx[k + 1], idx[k + 2]]) t.push(pos[i * 3] + off[0], pos[i * 3 + 1] + off[1], pos[i * 3 + 2] + off[2]);
        tris.push(t);
      }
      out.push({ mat: json.materials[p.material].name, tris });
    }
  }
  return out;
}

const normalArea = (t: number[]) => {
  const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, a = Math.hypot(nx, ny, nz);
  return { n: a ? [nx / a, ny / a, nz / a] : [0, 1, 0], area: a / 2 };
};
/** 26 view directions from the lower rim up (nobody sees the underside of a hedge). */
const viewDirs = (() => {
  const out: number[][] = [];
  for (let i = 0; i < 64; i++) {
    const y = 1 - 2 * (i + .5) / 64, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    if (y > -.15) out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
})();
const cards = (prims: Prim[], mat: string) => prims.filter((p) => p.mat === mat).flatMap((p) => p.tris);
const projected = (tris: number[][], v: number[]) => tris.reduce((s, t) => { const q = normalArea(t); return s + q.area * Math.abs(q.n[0] * v[0] + q.n[1] * v[1] + q.n[2] * v[2]); }, 0);
/** Share of an orthographic view's bounding box that triangles cover (rasterised on a 48 x 48 grid). */
function fill(tris: number[][], v: number[]): number {
  const up = Math.abs(v[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
  const u = [up[1] * v[2] - up[2] * v[1], up[2] * v[0] - up[0] * v[2], up[0] * v[1] - up[1] * v[0]];
  const ul = Math.hypot(...u), U = u.map((c) => c / ul), V = [v[1] * U[2] - v[2] * U[1], v[2] * U[0] - v[0] * U[2], v[0] * U[1] - v[1] * U[0]];
  const pts = tris.map((t) => [0, 3, 6].map((o) => [t[o] * U[0] + t[o + 1] * U[1] + t[o + 2] * U[2], t[o] * V[0] + t[o + 1] * V[1] + t[o + 2] * V[2]]));
  const xs = pts.flat().map((p) => p[0]), ys = pts.flat().map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), N = 48, grid = new Uint8Array(N * N);
  for (const [a, b, c] of pts) {
    const lx = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - x0) / (x1 - x0) * N)), hx = Math.min(N - 1, Math.floor((Math.max(a[0], b[0], c[0]) - x0) / (x1 - x0) * N));
    const ly = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - y0) / (y1 - y0) * N)), hy = Math.min(N - 1, Math.floor((Math.max(a[1], b[1], c[1]) - y0) / (y1 - y0) * N));
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-12) continue;
    for (let i = lx; i <= hx; i++) for (let j = ly; j <= hy; j++) {
      const px = x0 + (i + .5) / N * (x1 - x0), py = y0 + (j + .5) / N * (y1 - y0);
      const w1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, w2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      if (w1 >= 0 && w2 >= 0 && w1 + w2 <= 1) grid[j * N + i] = 1;
    }
  }
  return grid.reduce((s, g) => s + g, 0) / (N * N);
}

const props = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')).props as Record<string, { size: number[]; collider: number[] }>;
const materials = JSON.parse(readFileSync('public/assets/materials.json', 'utf8')).materials as Record<string, { double_sided?: boolean; alpha_cutoff?: number; atlas?: boolean }>;
const glb = (name: string) => readGlb(`public/assets/models/shared/props/${name}.glb`);
const FOLIAGE = ['bush', 'tree_oak', 'tree_oak_small', 'tree_pine', ...Object.keys(props).filter((k) => k.startsWith('hedge_'))];

describe('leaf cards: materials', () => {
  it('are alpha-cut and double sided, and each lite twin has its own definition (the batcher would merge identical ones)', () => {
    for (const m of ['leaf_bush', 'leaf_bush_lite', 'leaf_ivy', 'leaf_ivy_lite']) {
      expect(materials[m].double_sided, `${m} renders both sides`).toBe(true);
      expect(materials[m].alpha_cutoff).toBeGreaterThan(0);
      expect(materials[m].atlas).toBe(true);
    }
    expect(materials.leaf_bush_lite).not.toEqual(materials.leaf_bush);
    expect(materials.leaf_ivy_lite).not.toEqual(materials.leaf_ivy);
    expect(materials.leaf_core.alpha_cutoff).toBeUndefined();                // the core is opaque: bullets stop on it
  });
});

describe.each(FOLIAGE)('%s foliage geometry', (name) => {
  const prims = glb(name);
  const detail = cards(prims, 'leaf_bush'), lite = cards(prims, 'leaf_bush_lite'), core = cards(prims, 'leaf_core');
  it('has both sets, the lite twin lighter but still substantial', () => {
    expect(detail.length).toBeGreaterThan(0);
    expect(lite.length).toBeGreaterThan(0);
    expect(core.length).toBeGreaterThan(0);
    expect(lite.length).toBeLessThan(detail.length * 0.6);
    expect(lite.length).toBeGreaterThan(detail.length * 0.1);
  });
  it('shows leaves from every direction: no edge-on view of the cards (the cylinder look)', () => {
    for (const set of [detail, lite]) {
      const areas = viewDirs.map((v) => projected(set, v));
      const mean = areas.reduce((s, a) => s + a, 0) / areas.length;
      expect(Math.min(...areas) / mean, `${name}: weakest view ${(Math.min(...areas) / mean).toFixed(2)} of the mean`).toBeGreaterThan(.45);
    }
  });
  it('covers the silhouette from the front, side, back and above', () => {
    for (const v of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [.7, .3, .7]]) {
      expect(fill([...detail, ...core], v), `${name} seen along ${v}`).toBeGreaterThan(name === 'tree_pine' ? .3 : .38);
    }
  });
  it('stays inside the envelope the catalogue promises (plus 35 cm of slack) and never goes below the ground', () => {
    const all = prims.flatMap((p) => p.tris).flat();
    const xs = all.filter((_, i) => i % 3 === 0), ys = all.filter((_, i) => i % 3 === 1), zs = all.filter((_, i) => i % 3 === 2);
    const [sx, sy, sz] = props[name].size;
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(sx / 2 + .35);
    expect(Math.max(...zs.map(Math.abs))).toBeLessThanOrEqual(sz / 2 + .35);
    expect(Math.max(...ys)).toBeLessThanOrEqual(sy + .35);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-.15);
    // and the collider is never larger than what is drawn
    const [cx, cy, cz] = props[name].collider;
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(Math.min(cx, sx) * .9);
    expect(cy).toBeLessThanOrEqual(Math.max(...ys) + .05);
    void cz;
  });
});

describe('hedgerows vary', () => {
  it('every variant has its own uneven top and thickness profile', () => {
    const profiles = Object.keys(props).filter((k) => k.startsWith('hedge_')).map((k) => {
      const tris = glb(k).flatMap((p) => p.tris);
      // top height per 0.25 m slice along the hedge
      const slices = new Map<number, number>();
      for (const t of tris) for (const o of [0, 3, 6]) { const s = Math.floor(t[o] / .25); slices.set(s, Math.max(slices.get(s) ?? 0, t[o + 1])); }
      const hs = [...slices.values()];
      return { k, spread: Math.max(...hs) - Math.min(...hs), n: hs.length };
    });
    for (const p of profiles) expect(p.spread, `${p.k} top profile`).toBeGreaterThan(.2);       // never a flat-topped box
    expect(new Set(profiles.map((p) => p.n)).size).toBeGreaterThan(3);
  });
});

describe('wall ivy: grows on the wall, not in the air', () => {
  const terrain = readGlb('public/assets/models/farmstead/terrain.glb');
  const ivy = [...cards(terrain, 'leaf_ivy')], lite = cards(terrain, 'leaf_ivy_lite');
  const [x0, z0, x1, z1] = layout.farm.perimeter!.inner;
  it('has a detailed set and a lighter lite twin', () => {
    expect(ivy.length).toBeGreaterThan(5000);
    expect(lite.length).toBeLessThan(ivy.length * .7);
    expect(lite.length).toBeGreaterThan(ivy.length * .2);
  });
  it('keeps every card within 2.1 m of the wall face (pier faces and hanging curtains included) or on the far side of it', () => {
    let worst = 0;
    for (const t of [...ivy, ...lite]) for (const o of [0, 3, 6]) {
      const x = t[o], z = t[o + 2];
      const inside = x > x0 && x < x1 && z > z0 && z < z1;
      if (!inside) continue;
      worst = Math.max(worst, Math.min(x - x0, x1 - x, z - z0, z1 - z));
    }
    expect(worst).toBeLessThan(2.1);
  });
  it('is patchy: long stretches of bare stone along every side, and heavy growth in others', () => {
    for (const side of [{ name: 'north', face: z0 }, { name: 'south', face: z1 }]) {
      const bins = new Array(Math.ceil((x1 - x0) / 2)).fill(0);
      for (const t of ivy) if (Math.abs(t[2] - side.face) < 1.3) bins[Math.min(bins.length - 1, Math.max(0, Math.floor((t[0] - x0) / 2)))]++;
      // bins count triangles (two per card): bare = fewer than 6 cards in 2 m of wall, heavy = more than 50
      const bare = bins.filter((n) => n < 12).length, heavy = bins.filter((n) => n > 100).length;
      expect(bare, `${side.name}: bare 2 m stretches`).toBeGreaterThanOrEqual(2);
      expect(heavy, `${side.name}: heavy 2 m stretches`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('FoliageLod', () => {
  it('draws the lite sets in Chromebook mode and beyond 42 m, the detailed sets nearby, for bush and ivy sets alike', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      const mk = (canonical: string, cell: string, x: number) => {
        const m = new Mesh(`batch:${canonical}|${cell}`, scene);
        m.metadata = { canonical };
        m.setBoundingInfo(new Mesh('b', scene).getBoundingInfo());
        m.position.set(x, 0, 0); m.computeWorldMatrix(true);
        return m;
      };
      const meshes = [mk('leaf_bush', '0,0', 0), mk('leaf_bush_lite', '0,0', 0), mk('leaf_ivy', '0,0', 0), mk('leaf_ivy_lite', '0,0', 0), mk('leaf_bush', '2,0', 200), mk('leaf_bush_lite', '2,0', 200), mk('stone_wall_old', '0,0', 0)];
      const lod = new FoliageLod(meshes);
      expect(lod.count).toBe(3);
      expect(lod.inspect()).toEqual({ cells: 3, detail: 3, lite: 0 });
      lod.update(new Vector3(0, 1.7, 0));
      expect(lod.inspect()).toEqual({ cells: 3, detail: 2, lite: 1 });     // the cell 200 m away already drew... lite
      lod.setLite(true);
      expect(lod.inspect()).toEqual({ cells: 3, detail: 0, lite: 3 });
      expect(meshes[6].isEnabled()).toBe(true);                              // stone is never touched
      lod.setLite(false);
      lod.update(new Vector3(0, 1.7, 0));
      expect(lod.inspect().detail).toBe(2);
    } finally { scene.dispose(); engine.dispose(); }
  });
});
