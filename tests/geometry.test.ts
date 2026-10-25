import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regression test for z-fighting. It reads the exported town models (building shells, kit pieces, terrain), places every
 * mesh in world space and looks for pairs of triangles that face the same way, lie within 2 mm of one plane and overlap.
 * Such pairs flicker on screen. Before the fixes this found hundreds of square metres of them (window sills against
 * their reveals, stair treads against ground cells, gate jambs against wall ends, fascia boards against walls,
 * a facade built twice beside every passage...). Props are placed at runtime and are covered by tools/dev-zfight.mjs.
 */

interface Gltf {
  scenes: { nodes: number[] }[];
  scene?: number;
  nodes: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number; material?: number }[] }[];
  materials: { name: string }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

type Mat = number[]; // column-major 4x4

const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function local(n: Gltf['nodes'][number]): Mat {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function det3(m: Mat): number {
  return (
    m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])
  );
}

function readGlb(file: string): { json: Gltf; bin: Buffer } {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  const binStart = 20 + jsonLen;
  return { json, bin: buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart)) };
}

interface Tri {
  v: Float64Array; // 9
  n: [number, number, number];
  lo: [number, number, number];
  hi: [number, number, number];
  mat: string;
  entry: string; // node + primitive: one drawable piece
  node: string;
}

const EPS = 0.002;
const MIN_AREA = 0.0004;
const CELL = 2;

function collect(files: string[]): Tri[] {
  const tris: Tri[] = [];
  for (const file of files) {
    const { json, bin } = readGlb(file);
    const cache = new Map<number, { pos: Float64Array; idx: number[] }[]>();
    const decode = (meshIndex: number) => {
      let prims = cache.get(meshIndex);
      if (prims) return prims;
      prims = json.meshes[meshIndex].primitives.map((p) => {
        const pa = json.accessors[p.attributes.POSITION];
        const pv = json.bufferViews[pa.bufferView];
        const stride = (pv.byteStride ?? 12) / 4;
        const base = (pv.byteOffset ?? 0) + (pa.byteOffset ?? 0);
        const pos = new Float64Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = bin.readFloatLE(base + (i * stride + k) * 4);
        const ia = json.accessors[p.indices!];
        const iv = json.bufferViews[ia.bufferView];
        const ibase = (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
        const idx: number[] = [];
        for (let i = 0; i < ia.count; i++) {
          idx.push(ia.componentType === 5125 ? bin.readUInt32LE(ibase + i * 4) : bin.readUInt16LE(ibase + i * 2));
        }
        return { pos, idx };
      });
      cache.set(meshIndex, prims);
      return prims;
    };
    const visit = (ni: number, parent: Mat) => {
      const node = json.nodes[ni];
      const world = mul(parent, local(node));
      if (node.mesh !== undefined) {
        const flip = det3(world) < 0;
        decode(node.mesh).forEach((prim, pi) => {
          const material = (json.materials[json.meshes[node.mesh!].primitives[pi].material ?? 0]?.name ?? '').replace(/\.\d{3}$/, '');
          const wp = new Float64Array(prim.pos.length);
          for (let i = 0; i < prim.pos.length; i += 3) {
            const x = prim.pos[i], y = prim.pos[i + 1], z = prim.pos[i + 2];
            wp[i] = world[0] * x + world[4] * y + world[8] * z + world[12];
            wp[i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
            wp[i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
          }
          for (let t = 0; t < prim.idx.length; t += 3) {
            const a = prim.idx[t], b = prim.idx[flip ? t + 2 : t + 1], c = prim.idx[flip ? t + 1 : t + 2];
            const v = new Float64Array([wp[a * 3], wp[a * 3 + 1], wp[a * 3 + 2], wp[b * 3], wp[b * 3 + 1], wp[b * 3 + 2], wp[c * 3], wp[c * 3 + 1], wp[c * 3 + 2]]);
            const e1 = [v[3] - v[0], v[4] - v[1], v[5] - v[2]];
            const e2 = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
            const n: [number, number, number] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
            const len = Math.hypot(...n);
            if (len < 1e-7) continue;
            n[0] /= len; n[1] /= len; n[2] /= len;
            const lo: [number, number, number] = [0, 0, 0];
            const hi: [number, number, number] = [0, 0, 0];
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(v[k], v[3 + k], v[6 + k]) - EPS;
              hi[k] = Math.max(v[k], v[3 + k], v[6 + k]) + EPS;
            }
            tris.push({ v, n, lo, hi, mat: material, entry: `${file}#${ni}.${pi}`, node: (node.name ?? '').replace(/#\d+$/, '') });
          }
        });
      }
      for (const c of node.children ?? []) visit(c, world);
    };
    const scene = json.scenes[json.scene ?? 0];
    for (const root of scene.nodes) visit(root, IDENTITY);
  }
  return tris;
}

function clip(poly: number[][], a: number[], b: number[]): number[][] {
  const out: number[][] = [];
  const side = (p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

function overlapArea(A: Tri, B: Tri, drop: number): number {
  const proj = (t: Tri) => [0, 1, 2].map((i) => [t.v[i * 3 + ((drop + 1) % 3)], t.v[i * 3 + ((drop + 2) % 3)]]);
  const orient = (q: number[][]) => (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
  let pa = proj(A), pb = proj(B);
  if (orient(pa) < 0) pa = [pa[0], pa[2], pa[1]];
  if (orient(pb) < 0) pb = [pb[0], pb[2], pb[1]];
  let poly = pa;
  for (let i = 0; i < 3 && poly.length > 0; i++) poly = clip(poly, pb[i], pb[(i + 1) % 3]);
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

interface Pair {
  a: Tri;
  b: Tri;
  area: number;
}

function findOverlaps(tris: Tri[]): Pair[] {
  const grid = new Map<string, number[]>();
  tris.forEach((t, i) => {
    for (let x = Math.floor(t.lo[0] / CELL); x <= Math.floor(t.hi[0] / CELL); x++)
      for (let y = Math.floor(t.lo[1] / CELL); y <= Math.floor(t.hi[1] / CELL); y++)
        for (let z = Math.floor(t.lo[2] / CELL); z <= Math.floor(t.hi[2] / CELL); z++) {
          const k = `${x},${y},${z}`;
          const l = grid.get(k);
          if (l) l.push(i);
          else grid.set(k, [i]);
        }
  });
  const seen = new Set<number>();
  const out: Pair[] = [];
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const ia = Math.min(list[i], list[j]), ib = Math.max(list[i], list[j]);
        const A = tris[ia], B = tris[ib];
        // same piece, same material: identical UVs and colours, so the pair cannot show a visible fight
        if (A.entry === B.entry && A.mat === B.mat) continue;
        const dot = A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2];
        if (dot < 0.9995) continue; // only same-facing pairs fight; back-to-back faces are culled from one side
        if (A.lo[0] > B.hi[0] || A.hi[0] < B.lo[0] || A.lo[1] > B.hi[1] || A.hi[1] < B.lo[1] || A.lo[2] > B.hi[2] || A.hi[2] < B.lo[2]) continue;
        const key = ia * 4000003 + ib;
        if (seen.has(key)) continue;
        seen.add(key);
        const d0 = A.n[0] * A.v[0] + A.n[1] * A.v[1] + A.n[2] * A.v[2];
        let sep = 0;
        for (let k = 0; k < 3; k++) sep = Math.max(sep, Math.abs(A.n[0] * B.v[k * 3] + A.n[1] * B.v[k * 3 + 1] + A.n[2] * B.v[k * 3 + 2] - d0));
        if (sep > EPS) continue;
        // undersides at ground level are never seen
        if (A.n[1] < -0.9 && (A.v[1] + B.v[1]) / 2 < 0.06) continue;
        const drop = A.n.map(Math.abs).indexOf(Math.max(...A.n.map(Math.abs)));
        const area = overlapArea(A, B, drop);
        if (area >= MIN_AREA) out.push({ a: A, b: B, area });
      }
    }
  }
  return out;
}

const index = JSON.parse(readFileSync('public/assets/models/european-town/map-assets.json', 'utf8')) as { models: string[] };
const files = index.models.map((f) => `public/assets/models/european-town/${f}`);
const isKit = (t: Tri, prefix: string) => t.node.startsWith(`KIT_${prefix}`);
const isShell = (t: Tri) => /_shell$/.test(t.node);
const isTerrain = (t: Tri) => t.node === 'terrain';
const sum = (pairs: Pair[]) => pairs.reduce((s, p) => s + p.area, 0);

describe('town geometry has no coplanar overlapping surfaces (z-fighting)', () => {
  const pairs = findOverlaps(collect(files));
  const either = (p: Pair, f: (t: Tri) => boolean, g: (t: Tri) => boolean) => (f(p.a) && g(p.b)) || (g(p.a) && f(p.b));

  it('keeps the total overlap negligible', () => {
    // a handful of centimetre-sized slivers where roof fascia meets cornice ends is all that is left
    expect(sum(pairs)).toBeLessThan(1.0);
  });

  it('window sills do not share a plane with the wall reveals', () => {
    expect(sum(pairs.filter((p) => either(p, (t) => isKit(t, 'sill'), isShell)))).toBeLessThan(0.01);
  });

  it('shutters do not overlap each other', () => {
    expect(sum(pairs.filter((p) => either(p, (t) => isKit(t, 'shut'), (t) => isKit(t, 'shut'))))).toBeLessThan(0.01);
  });

  it('stairs, ground cells, retaining walls and gates do not overlap', () => {
    expect(sum(pairs.filter((p) => isTerrain(p.a) && isTerrain(p.b)))).toBeLessThan(0.01);
  });

  it('door surrounds do not share planes with the plinth', () => {
    expect(sum(pairs.filter((p) => either(p, (t) => isKit(t, 'surround'), isShell)))).toBeLessThan(0.01);
  });

  it('buildings next to a passage do not duplicate its side wall', () => {
    const walls = pairs.filter((p) => isShell(p.a) && isShell(p.b) && p.a.node !== p.b.node);
    expect(sum(walls)).toBeLessThan(0.6);
  });
}, 120_000);
