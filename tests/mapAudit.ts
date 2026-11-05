/**
 * Development map audit (pure Node). Loads a map's exported GLBs (building blocks, terrain and
 * every placed prop) as world-space triangles, plus the authoritative collision world the Worker
 * uses, and reports geometry problems that a build or a bounding-box test cannot see:
 *
 *  - reach:        multi-level walkable flood fill (0.25 m grid, controller step height, ladders)
 *                  from the spawns; unreachable spawns/routes and escapes beyond the play area
 *  - climb:        surfaces only reachable by jumping that are not authored walkways (roof escapes)
 *  - seeThrough:   from accessible eye/body positions, the first visible triangle is a culled back
 *                  face (a one-sided wall the player sees through)
 *  - walkThrough:  a visible solid surface in a player's path with no collision behind it
 *  - barrier:      collision where nothing is visible (invisible barrier across an open route)
 *  - floating / buried props, prop/prop and prop/architecture intersections
 *  - thinWall:     tall, long collision slabs thinner than 8 cm (zero-thickness walls)
 *  - light:        point lights with no fixture or mount near them
 *  - normals:      triangles whose winding disagrees with their stored vertex normals
 *  - deadEnd:      street/alley/passage areas with a single connection that are long corridors
 *
 * Each finding carries a world position so it can be inspected in the browser with freeCam. The
 * checks are heuristics: they find candidates for visual inspection, they do not prove a map correct.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createMapWorld } from '../shared/world';
import type { EnvironmentDefinition } from '../shared/environment';
import type { CollisionWorld } from '../src/physics/CollisionWorld';
import type { CollisionFile, MapLayout, PropCatalog, Rect } from '../src/maps/types';
import { MOVEMENT } from '../src/config/constants';

export type Severity = 'error' | 'warn' | 'info';
export interface Finding { check: string; severity: Severity; at: [number, number, number]; detail: string }

// ---------------------------------------------------------------------------------------------
// GLB loading
interface Gltf {
  scenes: { nodes: number[] }[]; scene?: number;
  nodes: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { name?: string; primitives: { attributes: { POSITION: number; NORMAL?: number }; indices?: number; material?: number }[] }[];
  materials?: { name: string }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}
type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function localMatrix(n: Gltf['nodes'][number]): Mat {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
function readGlb(file: string): { json: Gltf; bin: Buffer } {
  const buf = readFileSync(file), jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf, binStart = 20 + jsonLen;
  return { json, bin: buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart)) };
}
function accessor(json: Gltf, bin: Buffer, index: number, comps: number): Float64Array {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView], base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const size = a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
  const stride = view.byteStride ?? size * comps, out = new Float64Array(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
    const at = base + i * stride + c * size;
    out[i * comps + c] = a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5125 ? bin.readUInt32LE(at)
      : a.componentType === 5123 ? bin.readUInt16LE(at) : bin.readUInt8(at);
  }
  return out;
}

/** World triangles with material/source metadata in flat typed arrays. */
export class TriangleSet {
  v: number[] = []; // 9 per triangle
  n: number[] = []; // geometric unit normal, 3 per triangle
  mat: number[] = []; // material index
  src: number[] = []; // source index
  inverted = 0; // triangles whose winding disagrees with their vertex normals
  invertedAt: [number, number, number][] = [];
  readonly materials: string[] = [];
  readonly sources: string[] = [];
  private matIndex = new Map<string, number>();
  private srcIndex = new Map<string, number>();
  get count() { return this.mat.length; }
  material(i: number) { return this.materials[this.mat[i]]; }
  source(i: number) { return this.sources[this.src[i]]; }
  private id(map: Map<string, number>, list: string[], key: string) {
    let i = map.get(key);
    if (i === undefined) { i = list.length; list.push(key); map.set(key, i); }
    return i;
  }
  addGlb(file: string, source: string, placements: Mat[] = [IDENTITY]) {
    const { json, bin } = readGlb(file);
    const decoded = new Map<number, { pos: Float64Array; nrm?: Float64Array; idx: Float64Array | null; mat: string }[]>();
    const decode = (m: number) => {
      let prims = decoded.get(m);
      if (!prims) decoded.set(m, prims = json.meshes[m].primitives.map((p) => ({
        pos: accessor(json, bin, p.attributes.POSITION, 3), nrm: p.attributes.NORMAL === undefined ? undefined : accessor(json, bin, p.attributes.NORMAL, 3),
        idx: p.indices === undefined ? null : accessor(json, bin, p.indices, 1), mat: json.materials?.[p.material ?? -1]?.name ?? 'none' })));
      return prims;
    };
    const visit = (ni: number, parent: Mat) => {
      const node = json.nodes[ni], world = mul(parent, localMatrix(node));
      if (node.mesh !== undefined) for (const prim of decode(node.mesh)) for (const place of placements) this.addPrimitive(prim, mul(place, world), source);
      for (const c of node.children ?? []) visit(c, world);
    };
    for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, IDENTITY);
  }
  private addPrimitive(p: { pos: Float64Array; nrm?: Float64Array; idx: Float64Array | null; mat: string }, m: Mat, source: string) {
    const mat = this.id(this.matIndex, this.materials, p.mat.replace(/\.\d+$/, '')), src = this.id(this.srcIndex, this.sources, source);
    const count = p.idx ? p.idx.length : p.pos.length / 3;
    const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
    const tv = new Array<number>(9), tn = [0, 0, 0];
    for (let t = 0; t + 2 < count; t += 3) {
      const order = det < 0 ? [0, 2, 1] : [0, 1, 2];
      tn[0] = tn[1] = tn[2] = 0;
      for (let k = 0; k < 3; k++) {
        const vi = p.idx ? p.idx[t + order[k]] : t + order[k], x = p.pos[vi * 3], y = p.pos[vi * 3 + 1], z = p.pos[vi * 3 + 2];
        tv[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        tv[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        tv[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (p.nrm) {
          const nx = p.nrm[vi * 3], ny = p.nrm[vi * 3 + 1], nz = p.nrm[vi * 3 + 2];
          tn[0] += m[0] * nx + m[4] * ny + m[8] * nz; tn[1] += m[1] * nx + m[5] * ny + m[9] * nz; tn[2] += m[2] * nx + m[6] * ny + m[10] * nz;
        }
      }
      const ax = tv[3] - tv[0], ay = tv[4] - tv[1], az = tv[5] - tv[2], bx = tv[6] - tv[0], by = tv[7] - tv[1], bz = tv[8] - tv[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      nx /= len; ny /= len; nz /= len;
      if (p.nrm && Math.hypot(tn[0], tn[1], tn[2]) > 1e-6 && nx * tn[0] + ny * tn[1] + nz * tn[2] < -.5 * Math.hypot(tn[0], tn[1], tn[2])) {
        this.inverted++;
        if (this.invertedAt.length < 50) this.invertedAt.push([(tv[0] + tv[3] + tv[6]) / 3, (tv[1] + tv[4] + tv[7]) / 3, (tv[2] + tv[5] + tv[8]) / 3]);
      }
      this.v.push(...tv); this.n.push(nx, ny, nz); this.mat.push(mat); this.src.push(src);
    }
  }
}

/** Uniform 1 m (x, z) grid over triangles; rays march through it with a 2D DDA. */
export class TriangleGrid {
  private readonly cells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private tick = 1;
  constructor(readonly tris: TriangleSet, readonly cell = 1) {
    this.stamp = new Uint32Array(tris.count);
    for (let i = 0; i < tris.count; i++) {
      const v = tris.v;
      const x0 = Math.floor(Math.min(v[i * 9], v[i * 9 + 3], v[i * 9 + 6]) / cell), x1 = Math.floor(Math.max(v[i * 9], v[i * 9 + 3], v[i * 9 + 6]) / cell);
      const z0 = Math.floor(Math.min(v[i * 9 + 2], v[i * 9 + 5], v[i * 9 + 8]) / cell), z1 = Math.floor(Math.max(v[i * 9 + 2], v[i * 9 + 5], v[i * 9 + 8]) / cell);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, list = []);
        list.push(i);
      }
    }
  }
  private key(x: number, z: number) { return (x + 2048) * 4096 + (z + 2048); }
  /** Nearest hit along a unit direction within maxDist: triangle index, distance and whether it was hit from behind. */
  raycast(o: number[], d: number[], maxDist: number, filter?: (tri: number) => boolean): { tri: number; t: number; back: boolean } | null {
    const tick = ++this.tick;
    if (tick === 0xffffffff) { this.stamp.fill(0); this.tick = 1; }
    let best: { tri: number; t: number; back: boolean } | null = null;
    const c = this.cell;
    let cx = Math.floor(o[0] / c), cz = Math.floor(o[2] / c);
    const stepX = d[0] > 0 ? 1 : -1, stepZ = d[2] > 0 ? 1 : -1;
    const tDX = Math.abs(d[0]) > 1e-12 ? c / Math.abs(d[0]) : Infinity, tDZ = Math.abs(d[2]) > 1e-12 ? c / Math.abs(d[2]) : Infinity;
    let tMX = Math.abs(d[0]) > 1e-12 ? ((d[0] > 0 ? (cx + 1) * c - o[0] : o[0] - cx * c) / Math.abs(d[0])) : Infinity;
    let tMZ = Math.abs(d[2]) > 1e-12 ? ((d[2] > 0 ? (cz + 1) * c - o[2] : o[2] - cz * c) / Math.abs(d[2])) : Infinity;
    let tEnter = 0;
    while (tEnter <= maxDist) {
      const list = this.cells.get(this.key(cx, cz));
      if (list) for (const i of list) {
        if (this.stamp[i] === tick) continue;
        this.stamp[i] = tick;
        if (filter && !filter(i)) continue;
        const hit = this.intersect(i, o, d, best ? best.t : maxDist);
        if (hit !== null) best = { tri: i, t: hit, back: this.tris.n[i * 3] * d[0] + this.tris.n[i * 3 + 1] * d[1] + this.tris.n[i * 3 + 2] * d[2] > 0 };
      }
      const tExit = Math.min(tMX, tMZ);
      if (best && best.t <= tExit) break;
      tEnter = tExit;
      if (tMX < tMZ) { cx += stepX; tMX += tDX; } else { cz += stepZ; tMZ += tDZ; }
    }
    return best;
  }
  /** Triangles within `radius` of a point (approximate: tests vertex and centroid distances). */
  near(p: number[], radius: number): number {
    let best = Infinity;
    const c = this.cell, r = Math.ceil(radius / c);
    const cx = Math.floor(p[0] / c), cz = Math.floor(p[2] / c);
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      for (const i of this.cells.get(this.key(x, z)) ?? []) best = Math.min(best, this.pointTriangle(i, p));
    }
    return best;
  }
  private pointTriangle(i: number, p: number[]): number {
    // Closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5).
    const v = this.tris.v, a = [v[i * 9], v[i * 9 + 1], v[i * 9 + 2]], b = [v[i * 9 + 3], v[i * 9 + 4], v[i * 9 + 5]], cc = [v[i * 9 + 6], v[i * 9 + 7], v[i * 9 + 8]];
    const sub = (u: number[], w: number[]) => [u[0] - w[0], u[1] - w[1], u[2] - w[2]], dot = (u: number[], w: number[]) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
    const ab = sub(b, a), ac = sub(cc, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
    const dist = (q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (d1 <= 0 && d2 <= 0) return dist(a);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return dist(b);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); return dist([a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]); }
    const cp = sub(p, cc), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return dist(cc);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); return dist([a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t]); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return dist([b[0] + (cc[0] - b[0]) * t, b[1] + (cc[1] - b[1]) * t, b[2] + (cc[2] - b[2]) * t]);
    }
    const den = 1 / (va + vb + vc), s = vb * den, w = vc * den;
    return dist([a[0] + ab[0] * s + ac[0] * w, a[1] + ab[1] * s + ac[1] * w, a[2] + ab[2] * s + ac[2] * w]);
  }
  private intersect(i: number, o: number[], d: number[], maxT: number): number | null {
    const v = this.tris.v, b = i * 9;
    const e1x = v[b + 3] - v[b], e1y = v[b + 4] - v[b + 1], e1z = v[b + 5] - v[b + 2];
    const e2x = v[b + 6] - v[b], e2y = v[b + 7] - v[b + 1], e2z = v[b + 8] - v[b + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return null;
    const inv = 1 / det, tx = o[0] - v[b], ty = o[1] - v[b + 1], tz = o[2] - v[b + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return null;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (w < 0 || u + w > 1) return null;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 1e-4 && t < maxT ? t : null;
  }
}

// ---------------------------------------------------------------------------------------------
export interface LoadedMap {
  id: string; layout: MapLayout; collision: CollisionFile; catalog: PropCatalog; environment?: EnvironmentDefinition;
  world: CollisionWorld; tris: TriangleSet; grid: TriangleGrid; doubleSided: Set<string>; decals: Set<string>;
}

export function loadMap(id: string, root = '.'): LoadedMap {
  const dir = `${root}/public/assets/models/${id}`;
  const layout = JSON.parse(readFileSync(`${root}/src/maps/${id}/layout.json`, 'utf8')) as MapLayout;
  const collision = JSON.parse(readFileSync(`${dir}/collision.json`, 'utf8')) as CollisionFile;
  const catalog = JSON.parse(readFileSync(`${root}/public/assets/models/shared/props/props.json`, 'utf8')) as PropCatalog;
  const environment = existsSync(`${dir}/environment.json`) ? JSON.parse(readFileSync(`${dir}/environment.json`, 'utf8')) as EnvironmentDefinition : undefined;
  const assets = JSON.parse(readFileSync(`${dir}/map-assets.json`, 'utf8')) as { models: string[] };
  const materials = (JSON.parse(readFileSync(`${root}/public/assets/materials.json`, 'utf8')) as { materials: Record<string, { double_sided?: boolean; decal?: boolean }> }).materials;
  const tris = new TriangleSet();
  for (const model of assets.models) tris.addGlb(`${dir}/${model}`, model.startsWith('buildings') ? 'building' : 'terrain');
  const byType = new Map<string, Mat[]>();
  for (const p of [...layout.props, ...layout.obstacles]) {
    const entry = catalog.props[p.type];
    if (!entry) continue;
    const yaw = -p.heading * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
    // Rotation about +Y by yaw (right-handed), then translation: column-major.
    const m: Mat = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, p.pos[0], p.pos[1], p.pos[2], 1];
    byType.set(p.type, [...(byType.get(p.type) ?? []), m]);
  }
  for (const [type, places] of byType) tris.addGlb(`${root}/public/assets/models/shared/props/${catalog.props[type].file}`, `prop:${type}`, places);
  const world = createMapWorld(collision, layout, catalog, environment);
  const doubleSided = new Set(Object.entries(materials).filter(([, m]) => m.double_sided).map(([n]) => n));
  const decals = new Set(Object.entries(materials).filter(([, m]) => m.decal).map(([n]) => n));
  return { id, layout, collision, catalog, environment, world, tris, grid: new TriangleGrid(tris), doubleSided, decals };
}

// ---------------------------------------------------------------------------------------------
/** Walkable surfaces reached from the spawns on a 0.25 m grid, by walking (step height) and by
 * walking + jumping. Returns node positions keyed by grid cell and level. */
export interface Reach { walk: Map<string, [number, number, number]>; jump: Map<string, [number, number, number]>; levels: Map<string, number[]> }
const STEP = MOVEMENT.stepHeight, CLIMB = 1.45, G = .25;
const WALK_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const JUMP_OFFSETS = [1, 2, 3].flatMap((k) => [[k, 0], [-k, 0], [0, k], [0, -k]]);

export function reach(map: LoadedMap): Reach {
  const { world, layout } = map;
  const [px0, pz0, px1, pz1] = layout.playArea;
  const levels = new Map<string, number[]>();
  const surfaces = (ix: number, iz: number) => {
    const key = `${ix},${iz}`;
    let list = levels.get(key);
    if (list) return list;
    list = [];
    const x = ix * G, z = iz * G;
    let maxY = 40;
    for (let k = 0; k < 8; k++) {
      const y = world.groundHeight(x, z, .05, maxY);
      if (!Number.isFinite(y)) break;
      if (!world.overlapsCylinder(x, z, MOVEMENT.radius * .9, y + .05, y + MOVEMENT.crouchHeight)) list.push(y);
      maxY = y - .3;
    }
    levels.set(key, list);
    return list;
  };
  const flood = (maxUp: number) => {
    const seen = new Map<string, [number, number, number]>(), queue: [number, number, number][] = [];
    const push = (ix: number, iz: number, y: number) => {
      const key = `${ix},${iz},${y.toFixed(2)}`;
      if (seen.has(key)) return;
      seen.set(key, [ix * G, y, iz * G]); queue.push([ix, iz, y]);
    };
    for (const s of layout.spawns) {
      const ix = Math.round(s.pos[0] / G), iz = Math.round(s.pos[2] / G);
      const y = surfaces(ix, iz).find((h) => Math.abs(h - s.pos[1]) < .3);
      if (y !== undefined) push(ix, iz, y);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const [ix, iz, y] = queue[qi];
      if (ix * G < px0 - 4 || ix * G > px1 + 4 || iz * G < pz0 - 4 || iz * G > pz1 + 4) continue;
      // Walking moves one cell; a jump also carries the body across up to 0.75 m of ledge or gap.
      for (const [dx, dz] of maxUp > STEP ? JUMP_OFFSETS : WALK_OFFSETS) {
        for (const h of surfaces(ix + dx, iz + dz)) {
          if (h - y > maxUp || y - h > (maxUp > STEP ? 50 : MOVEMENT.snapDown + STEP)) continue;
          // Clear standing (crouched) body along the move at the higher floor.
          const top = Math.max(h, y), steps = Math.max(Math.abs(dx), Math.abs(dz));
          let clear = true;
          for (let k = 1; k <= steps && clear; k++) {
            const f = (k - .5) / steps;
            clear = !world.overlapsCylinder((ix + dx * f) * G, (iz + dz * f) * G, MOVEMENT.radius * .9, top + .05, top + MOVEMENT.crouchHeight);
          }
          if (clear) push(ix + dx, iz + dz, h);
        }
      }
      // Ladders: climb between bottom and top within the authored region.
      for (const l of world.ladders) {
        const [wx, wz] = l.wall, [ox, oz] = l.out, x = ix * G, z = iz * G;
        const along = (x - wx) * oz - (z - wz) * ox, out = (x - wx) * ox + (z - wz) * oz;
        if (Math.abs(along) > .5 || out < 0 || out > 1.6) continue;
        for (const [from, to] of [[l.bottom, l.top], [l.top, l.bottom]]) {
          if (Math.abs(y - from) > .3) continue;
          for (let k = -6; k <= 6; k++) {
            const tx = Math.round((wx + ox * k * G) / G), tz = Math.round((wz + oz * k * G) / G);
            for (const h of surfaces(tx, tz)) if (Math.abs(h - to) < .3) push(tx, tz, h);
          }
        }
      }
    }
    return seen;
  };
  return { walk: flood(STEP), jump: flood(CLIMB), levels };
}

// ---------------------------------------------------------------------------------------------
const DECOR = /foliage|flowers|canvas|chainlink|lantern_glass|lamp_|glass|fruit|produce|wire|posters|sign|street_signs|reticle|target|water|soil|headlight|taillight|plastic_wrap|shop_sign|cardboard/;
const inRect = (x: number, z: number, r: Rect, m = 0) => x >= r[0] - m && x <= r[2] + m && z >= r[1] - m && z <= r[3] + m;

export function audit(map: LoadedMap, options: { rayStride?: number } = {}): { findings: Finding[]; reach: Reach; stats: Record<string, number> } {
  const findings: Finding[] = [];
  const { layout, world, tris, grid, catalog } = map;
  const add = (check: string, severity: Severity, at: number[], detail: string) =>
    findings.push({ check, severity, at: [+at[0].toFixed(2), +at[1].toFixed(2), +at[2].toFixed(2)], detail });
  const R = reach(map);
  const play = layout.playArea;

  // reach: spawns, escapes, authored walkways
  const walkCells = new Set([...R.walk.values()].map(([x, , z]) => `${Math.round(x / G)},${Math.round(z / G)}`));
  for (const s of layout.spawns) if (!walkCells.has(`${Math.round(s.pos[0] / G)},${Math.round(s.pos[2] / G)}`)) add('reach', 'error', s.pos, `spawn ${s.id} is not on reachable walkable ground`);
  for (const [, p] of R.jump) if (!inRect(p[0], p[2], play, .6)) { add('reach', 'error', p, 'walkable surface outside the play area is reachable (map escape)'); break; }
  const authored = (x: number, y: number, z: number) => y < 1.3 || (layout.upperRoutes ?? []).some((r) => inRect(x, z, r.rect, .6))
    || (layout.circulationRoutes ?? []).some((r) => { const b = layout.buildings.find((v) => v.id === r.id); return b && inRect(x, z, b.rect, 7.5); })
    || layout.buildings.some((b) => (b as { serviceRoof?: boolean }).serviceRoof && inRect(x, z, b.rect, 1.5))
    || ((layout as { underground?: { rect: Rect }[] }).underground ?? []).some((u) => inRect(x, z, u.rect, .5));
  const climbs = new Map<string, [number, number, number]>();
  // Lowest walkable floor near each cell: standing on a bench or a cart beside it is not a climb.
  const floorNear = new Map<string, number>();
  for (const [x, y, z] of R.walk.values()) {
    const k = `${Math.round(x)},${Math.round(z)}`;
    floorNear.set(k, Math.min(floorNear.get(k) ?? Infinity, y));
  }
  const floorAt = (x: number, z: number) => {
    let best = Infinity;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) best = Math.min(best, floorNear.get(`${Math.round(x) + dx},${Math.round(z) + dz}`) ?? Infinity);
    return best;
  };
  for (const [key, p] of R.jump) if (!R.walk.has(key) && !authored(p[0], p[1], p[2]) && p[1] - floorAt(p[0], p[2]) > 1.15) {
    const cell = `${Math.round(p[0] / 2)},${Math.round(p[2] / 2)},${Math.round(p[1])}`;
    if (!climbs.has(cell)) climbs.set(cell, p);
  }
  for (const p of climbs.values()) add('climb', 'warn', p, `unauthored surface at ${p[1].toFixed(2)} m reachable by jumping`);

  // ray checks from accessible positions
  const stride = options.rayStride ?? 1;
  const samples = [...R.walk.values()].filter(([x, , z]) => Math.abs(x / stride - Math.round(x / stride)) < 1e-6 && Math.abs(z / stride - Math.round(z / stride)) < 1e-6);
  const dirs = Array.from({ length: 16 }, (_, k) => [Math.sin(k * Math.PI / 8), 0, -Math.cos(k * Math.PI / 8)]);
  const seenKeys = new Set<string>();
  const once = (check: string, at: number[]) => { const k = `${check}:${Math.round(at[0] * 2)},${Math.round(at[1] * 2)},${Math.round(at[2] * 2)}`; if (seenKeys.has(k)) return false; seenKeys.add(k); return true; };
  let rays = 0;
  for (const [x, y, z] of samples) for (const h of [.45, 1.15, 1.7]) for (const d of dirs) {
    const o = [x, y + h, z];
    rays++;
    const notDecal = (i: number) => !map.decals.has(tris.material(i));
    const vis = grid.raycast(o, d, 24, notDecal);
    if (vis && vis.back && !map.doubleSided.has(tris.material(vis.tri))) {
      const at = [o[0] + d[0] * vis.t, o[1], o[2] + d[2] * vis.t];
      // A real hole is an area: the back face must persist when the ray shifts 4 cm in each
      // direction (a seam or corner where two closed solids meet is not a see-through wall).
      const side = [-d[2], 0, d[0]];
      const persistent = [[side, .04], [side, -.04], [[0, 1, 0], .04], [[0, 1, 0], -.04]].every(([axis, k]) => {
        const a = axis as number[], q = [o[0] + a[0] * (k as number), o[1] + a[1] * (k as number), o[2] + a[2] * (k as number)];
        const hit = grid.raycast(q, d, vis.t + .5, notDecal);
        return hit && hit.back && Math.abs(hit.t - vis.t) < .25;
      });
      if (persistent && once('seeThrough', at)) add('seeThrough', 'error', at, `back face of ${tris.material(vis.tri)} (${tris.source(vis.tri)}) seen from ${o.map((v) => v.toFixed(2))}`);
      if (persistent) continue;
    }
    const col = world.raycast(o[0], o[1], o[2], d[0], 0, d[2], 24, (c) => c.solid);
    if (vis && !vis.back) {
      const m = tris.material(vis.tri), src = tris.source(vis.tri);
      const propType = src.startsWith('prop:') ? src.slice(5) : null;
      const solidVisual = !DECOR.test(m) && !(propType && !catalog.props[propType]?.collider);
      if (solidVisual && vis.t < 20 && (!col || col.distance > vis.t + .05)) {
        const at = [o[0] + d[0] * vis.t, o[1], o[2] + d[2] * vis.t];
        // Probe 15 cm behind the visible surface along its normal (robust at grazing angles):
        // architecture the player can touch must have a solid there.
        const n = [tris.n[vis.tri * 3], tris.n[vis.tri * 3 + 1], tris.n[vis.tri * 3 + 2]];
        const behind = [at[0] - n[0] * .15, at[1] - n[1] * .15, at[2] - n[2] * .15];
        const solidBehind = world.overlapsCylinder(behind[0], behind[2], .05, behind[1] - .05, behind[1] + .05);
        // Only the face the player walks into counts (not an edge seen at a grazing angle), and a thin
        // visible element (rail, post, sign) need not block: require a surface wider than the player.
        const facing = -(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]);
        if (!solidBehind && Math.abs(n[1]) < .7 && facing > .35 && once('walkThrough', at) && solidWidth(grid, tris, o, d, vis.t))
          add('walkThrough', 'warn', at, `visible ${m} (${src}) at ${vis.t.toFixed(2)} m has no collision behind it (seen from ${o.map((v) => v.toFixed(2))})`);
      }
    }
    if (col && !col.collider.tag.startsWith('boundary') && !col.collider.tag.startsWith('prop:') && (!vis || vis.t > col.distance + .35)) {
      const at = [o[0] + d[0] * col.distance, o[1], o[2] + d[2] * col.distance];
      // Invisible only if no rendered surface lies within 30 cm of the collision face.
      if (grid.near(at, .3) > .3 && once('barrier', at)) add('barrier', 'warn', at, `collision ${col.collider.tag} at ${col.distance.toFixed(2)} m with nothing visible within 0.3 m (seen from ${o.map((v) => v.toFixed(2))})`);
    }
  }

  // props: support, burial, intersections
  const placements = [...layout.props, ...layout.obstacles];
  const replaced = new Set(map.environment?.replaceProps.map((r) => r.index) ?? []);
  const boxes = map.collision.boxes.filter((b) => b.tag !== 'ground' && !b.tag.startsWith('boundary'));
  const propBoxes: { i: number; type: string; c: number[]; h: number[]; yaw: number }[] = [];
  for (const [i, p] of placements.entries()) {
    const entry = catalog.props[p.type];
    if (!entry) { add('prop', 'error', p.pos, `unknown prop type ${p.type}`); continue; }
    if (p.type === 'wall_lantern' || p.type.startsWith('sign_') && !entry.collider) {
      if (grid.near([p.pos[0], p.pos[1] + entry.size[1] / 2, p.pos[2]], .45) > .4) add('floating', 'error', p.pos, `${p.type} has no wall behind it`);
      continue;
    }
    const base = p.pos[1], [w, , dpt] = entry.collider ?? entry.size;
    const yaw = -p.heading * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
    // Support under each corner and the centre (props may bridge small gaps but not hang).
    const pts = [[0, 0], [-.4, -.4], [.4, -.4], [-.4, .4], [.4, .4]].map(([a, b]) => [p.pos[0] + a * w * c + b * dpt * s, p.pos[2] - a * w * s + b * dpt * c]);
    const support = pts.map(([x, z]) => world.groundHeight(x, z, .02, base + .03));
    // Ignore the prop's own collider: query below the base only.
    const unsupported = support.filter((h) => !(h > base - .06)).length;
    if (unsupported >= 3) add('floating', 'error', p.pos, `${p.type} base ${base.toFixed(2)} m has support under only ${5 - unsupported}/5 sample points`);
    else if (unsupported) add('floating', 'info', p.pos, `${p.type} overhangs an edge (${unsupported}/5 points unsupported)`);
    if (entry.collider && !replaced.has(i)) {
      const h = entry.collider;
      propBoxes.push({ i, type: p.type, c: [p.pos[0], base + h[1] / 2, p.pos[2]], h: [h[0] / 2, h[1] / 2, h[2] / 2], yaw });
    }
  }
  const overlap = (a: { c: number[]; h: number[]; yaw: number }, b: { c: number[]; h: number[]; yaw?: number }) => {
    // Separating axis test for yaw-only boxes; returns minimum penetration depth (<= 0 means apart).
    const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw ?? 0, (b.yaw ?? 0) + Math.PI / 2].map((t) => [Math.cos(t), -Math.sin(t)]);
    const extent = (box: { h: number[]; yaw?: number }, ax: number[]) => {
      const t = box.yaw ?? 0, ux = [Math.cos(t), -Math.sin(t)], uz = [Math.sin(t), Math.cos(t)];
      return box.h[0] * Math.abs(ux[0] * ax[0] + ux[1] * ax[1]) + box.h[2] * Math.abs(uz[0] * ax[0] + uz[1] * ax[1]);
    };
    let depth = Math.min(a.h[1] + b.h[1] - Math.abs(a.c[1] - b.c[1]));
    for (const ax of axes) {
      const dist = Math.abs((a.c[0] - b.c[0]) * ax[0] + (a.c[2] - b.c[2]) * ax[1]);
      depth = Math.min(depth, extent(a, ax) + extent(b, ax) - dist);
    }
    return depth;
  };
  for (const p of propBoxes) {
    for (const b of boxes) {
      const depth = overlap(p, b);
      if (depth > .06) { add('intersect', 'warn', p.c, `${p.type} intersects ${b.tag} by ${depth.toFixed(2)} m`); break; }
    }
  }
  for (let a = 0; a < propBoxes.length; a++) for (let b = a + 1; b < propBoxes.length; b++) {
    const depth = overlap(propBoxes[a], propBoxes[b]);
    if (depth > .04) add('intersect', 'warn', propBoxes[a].c, `${propBoxes[a].type} intersects ${propBoxes[b].type} by ${depth.toFixed(2)} m`);
  }

  // thin collision walls
  for (const b of map.collision.boxes) {
    const height = b.h[1] * 2, len = Math.max(b.h[0], b.h[2]) * 2, thick = Math.min(b.h[0], b.h[2]) * 2;
    if (height >= 1.5 && len >= 1 && thick < .08 && !/rail|post|guard|glass|window|sign|fence|light|envelope|lintel|support|shelf|storage/.test(b.tag))
      add('thinWall', 'warn', b.c, `${b.tag} is ${thick.toFixed(3)} m thick, ${len.toFixed(2)} m long, ${height.toFixed(2)} m high`);
  }

  // lights need a fixture nearby
  for (const l of layout.lights) {
    const d = grid.near(l.pos, 1);
    if (d > .6) add('light', 'error', l.pos, `point light has no visible fixture within ${Math.min(d, 1).toFixed(2)} m`);
  }

  // inverted triangles
  if (tris.inverted) add('normals', tris.inverted > 20 ? 'warn' : 'info', tris.invertedAt[0] ?? [0, 0, 0], `${tris.inverted} triangles wound against their vertex normals`);

  // dead-end corridors in the authored route graph
  const regions = [...layout.ground.zones.map((z) => ({ id: z.id, kind: z.kind, rect: z.rect })), ...layout.ground.covered];
  const touching = (a: Rect, b: Rect) => {
    const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), oz = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    return (ox >= 1.2 && oz >= -.01) || (oz >= 1.2 && ox >= -.01);
  };
  for (const r of regions) {
    if (!['street', 'alley', 'passage'].includes(r.kind)) continue;
    const links = regions.filter((o) => o !== r && touching(r.rect, o.rect));
    const length = Math.max(r.rect[2] - r.rect[0], r.rect[3] - r.rect[1]);
    if (links.length <= 1 && length > 6) add('deadEnd', 'warn', [(r.rect[0] + r.rect[2]) / 2, 0, (r.rect[1] + r.rect[3]) / 2], `${r.kind} ${r.id} (${length} m) connects only to ${links.map((l) => l.id).join(', ') || 'nothing'}`);
  }

  return { findings, reach: R, stats: { triangles: tris.count, rays, walkNodes: R.walk.size, jumpNodes: R.jump.size, inverted: tris.inverted } };
}

/** A visible surface wider than a player: probes parallel rays 0.25 m to either side. */
function solidWidth(grid: TriangleGrid, tris: TriangleSet, o: number[], d: number[], t: number): boolean {
  const side = [-d[2], 0, d[0]];
  let hits = 0;
  for (const s of [-.25, .25]) {
    const q = [o[0] + side[0] * s, o[1], o[2] + side[2] * s];
    const hit = grid.raycast(q, d, t + .6);
    if (hit && !hit.back && Math.abs(hit.t - t) < .5 && !DECOR.test(tris.material(hit.tri))) hits++;
  }
  return hits === 2;
}
