import { Constants, Mesh, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData, type Scene } from '@babylonjs/core';
import type { MeleeClipName } from './MeleeAnimation';

/** Short-lived blade trails: a thin luminous strip swept along the dagger tip's animated path
 * (never a fixed screen position), built from sampled tip/guard positions and smoothed with a
 * Catmull-Rom curve. Purely cosmetic: it reads the animated pose and writes only its own two
 * meshes. One dynamic mesh per hand, one shared additive material; idle trails cost nothing
 * (the meshes are disabled). */

/** Which daggers leave a trail for an attack clip, and whether it is the dramatic finisher. */
export interface TrailPlan { sides: readonly [boolean, boolean]; finisher: boolean }
const PLANS: Partial<Record<MeleeClipName, TrailPlan>> = {
  attack_cross: { sides: [true, false], finisher: false },
  attack_forward: { sides: [false, true], finisher: false },
  attack_finisher: { sides: [true, true], finisher: true },
};
export const trailPlan = (clip: MeleeClipName | null): TrailPlan | null => (clip && PLANS[clip]) || null;

interface Layer { halfWidth: number; alpha: number; life: number; r: number; g: number; b: number }
interface Profile { layers: Layer[] }
/** Index 0 is a diagonal slash, 1 the finisher. Each layer is a camera-facing strip centred on the
 * blade tip's path (half widths in metres); layers fade at their own pace: a bright thin core
 * first, then a wider, softer halo. */
const PROFILES: Profile[] = [
  { layers: [{ halfWidth: .0065, alpha: .75, life: .15, r: .78, g: .95, b: 1 }, { halfWidth: .017, alpha: .2, life: .22, r: .32, g: .62, b: 1 }] },
  { layers: [{ halfWidth: .0095, alpha: .95, life: .2, r: 1, g: .95, b: .76 }, { halfWidth: .026, alpha: .34, life: .32, r: 1, g: .56, b: .2 }] },
];
const MAX_LIFE = .32;
const CAPACITY = 56;
const POINTS = CAPACITY * 3 + 1;
const MIN_STEP = .004;
/** How far along the blade (behind the tip) the strip's centre line runs, so it grows out of the blade. */
const INSET = .12;

let materials = new WeakMap<Scene, StandardMaterial>();
function trailMaterial(scene: Scene): StandardMaterial {
  let m = materials.get(scene);
  if (m && !scene.materials.includes(m)) m = undefined;
  if (!m) {
    m = new StandardMaterial('melee-trail', scene);
    m.disableLighting = true; m.emissiveColor.set(1, 1, 1); m.diffuseColor.set(0, 0, 0); m.specularColor.set(0, 0, 0);
    m.backFaceCulling = false; m.disableDepthWrite = true; m.alphaMode = Constants.ALPHA_ADD;
    m.fogEnabled = false;
    materials.set(scene, m);
  }
  return m;
}

const scratch = {
  px: new Float32Array(CAPACITY), py: new Float32Array(CAPACITY), pz: new Float32Array(CAPACITY),
  ax: new Float32Array(CAPACITY), ay: new Float32Array(CAPACITY), az: new Float32Array(CAPACITY),
  age: new Float32Array(CAPACITY), str: new Float32Array(CAPACITY), kind: new Uint8Array(CAPACITY),
};
/** Smoothed centre-line points of one flush (newest first). */
const line = {
  x: new Float32Array(POINTS), y: new Float32Array(POINTS), z: new Float32Array(POINTS),
  age: new Float32Array(POINTS), str: new Float32Array(POINTS), kind: new Uint8Array(POINTS),
};

/** Catmull-Rom between p1 and p2 (neighbours p0, p3) at u in [0, 1]. */
const spline = (p0: number, p1: number, p2: number, p3: number, u: number) =>
  .5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);

/** One hand's ribbon: a ring of tip + (guard - tip) samples with birth times. */
class Ribbon {
  readonly mesh: Mesh;
  private readonly tip = new Float32Array(CAPACITY * 3);
  private readonly axis = new Float32Array(CAPACITY * 3);
  private readonly born = new Float64Array(CAPACITY);
  private readonly strength = new Float32Array(CAPACITY);
  private readonly kind = new Uint8Array(CAPACITY);
  private count = 0;
  private head = 0;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  vertices = 0;
  constructor(scene: Scene, name: string, material: StandardMaterial, private sub: number, private layers: number) {
    this.positions = new Float32Array(2 * POINTS * 3 * 3);
    this.colors = new Float32Array(2 * POINTS * 3 * 4);
    const indices: number[] = [];
    for (let layer = 0; layer < 2; layer++) for (let p = 0; p < POINTS - 1; p++) {
      const a = (layer * POINTS + p) * 3, b = a + 3;
      indices.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
    }
    this.mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = this.positions; data.indices = indices; data.colors = this.colors;
    data.applyToMesh(this.mesh, true);
    this.mesh.material = material; this.mesh.hasVertexAlpha = true;
    this.mesh.isPickable = false; this.mesh.alwaysSelectAsActiveMesh = true; this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.receiveShadows = false; this.mesh.setEnabled(false);
  }
  configure(sub: number, layers: number): void { this.sub = sub; this.layers = layers; }
  get live(): number { return this.count; }
  clear(): void { this.count = 0; this.mesh.setEnabled(false); this.vertices = 0; }
  private slot(i: number): number { return (this.head - i + CAPACITY) % CAPACITY; }
  push(tip: Vector3, guard: Vector3, strength: number, kind: number, now: number): void {
    if (this.count) {
      const s = this.slot(0) * 3;
      const dx = tip.x - this.tip[s], dy = tip.y - this.tip[s + 1], dz = tip.z - this.tip[s + 2];
      if (dx * dx + dy * dy + dz * dz < MIN_STEP * MIN_STEP && now - this.born[this.slot(0)] < .02) { this.setHead(tip, guard); return; }
    }
    this.head = (this.head + 1) % CAPACITY;
    this.count = Math.min(CAPACITY, this.count + 1);
    const s = this.head * 3;
    this.tip[s] = tip.x; this.tip[s + 1] = tip.y; this.tip[s + 2] = tip.z;
    this.axis[s] = guard.x - tip.x; this.axis[s + 1] = guard.y - tip.y; this.axis[s + 2] = guard.z - tip.z;
    this.born[this.head] = now; this.strength[this.head] = strength; this.kind[this.head] = kind;
  }
  /** Move the newest sample onto where the blade really is this frame (after the arm IK). */
  setHead(tip: Vector3, guard: Vector3): void {
    if (!this.count) return;
    const s = this.head * 3;
    this.tip[s] = tip.x; this.tip[s + 1] = tip.y; this.tip[s + 2] = tip.z;
    this.axis[s] = guard.x - tip.x; this.axis[s + 1] = guard.y - tip.y; this.axis[s + 2] = guard.z - tip.z;
  }
  /** Drop expired samples, then rebuild the strip vertices (faced toward `eye`); disables the
   * mesh when empty. */
  flush(now: number, eye: Vector3): void {
    while (this.count && now - this.born[this.slot(this.count - 1)] >= MAX_LIFE) this.count--;
    if (!this.count) { if (this.vertices) this.clear(); return; }
    const n = this.count, sc = scratch;
    for (let i = 0; i < n; i++) {
      const k = this.slot(i), s = k * 3;
      sc.ax[i] = this.axis[s]; sc.ay[i] = this.axis[s + 1]; sc.az[i] = this.axis[s + 2];
      sc.px[i] = this.tip[s] + sc.ax[i] * INSET; sc.py[i] = this.tip[s + 1] + sc.ay[i] * INSET; sc.pz[i] = this.tip[s + 2] + sc.az[i] * INSET;
      sc.age[i] = now - this.born[k]; sc.str[i] = this.strength[k]; sc.kind[i] = this.kind[k];
    }
    // Smooth centre line (Catmull-Rom through the samples, newest first).
    const last = n - 1, steps = this.sub, ln = line;
    let m = 0;
    for (let i = 0; i < Math.max(1, last); i++) {
      const i0 = Math.max(0, i - 1), i2 = Math.min(last, i + 1), i3 = Math.min(last, i + 2);
      for (let k = 0; k < (last ? steps : 1); k++, m++) {
        const u = k / steps;
        ln.x[m] = spline(sc.px[i0], sc.px[i], sc.px[i2], sc.px[i3], u); ln.y[m] = spline(sc.py[i0], sc.py[i], sc.py[i2], sc.py[i3], u);
        ln.z[m] = spline(sc.pz[i0], sc.pz[i], sc.pz[i2], sc.pz[i3], u);
        ln.age[m] = sc.age[i] + (sc.age[i2] - sc.age[i]) * u; ln.str[m] = sc.str[i] + (sc.str[i2] - sc.str[i]) * u; ln.kind[m] = sc.kind[i];
      }
    }
    if (last) { ln.x[m] = sc.px[last]; ln.y[m] = sc.py[last]; ln.z[m] = sc.pz[last]; ln.age[m] = sc.age[last]; ln.str[m] = sc.str[last]; ln.kind[m] = sc.kind[last]; m++; }
    const pos = this.positions, col = this.colors;
    let wx = 0, wy = 1, wz = 0;
    for (let layer = 0; layer < 2; layer++) {
      const base = layer * POINTS;
      let p = 0;
      if (layer < this.layers) for (; p < m; p++) {
        // Lateral direction: perpendicular to both the path and the line of sight.
        const a = Math.max(0, p - 1), b = Math.min(m - 1, p + 1);
        const tx = ln.x[b] - ln.x[a], ty = ln.y[b] - ln.y[a], tz = ln.z[b] - ln.z[a];
        const vx = ln.x[p] - eye.x, vy = ln.y[p] - eye.y, vz = ln.z[p] - eye.z;
        const cx = ty * vz - tz * vy, cy = tz * vx - tx * vz, cz = tx * vy - ty * vx;
        const len = Math.hypot(cx, cy, cz);
        if (len > 1e-9) { wx = cx / len; wy = cy / len; wz = cz / len; }
        const L = PROFILES[ln.kind[p]].layers[layer], t = Math.max(0, 1 - ln.age[p] / L.life);
        const w = L.halfWidth * Math.pow(t, .6), alpha = t > 0 ? L.alpha * ln.str[p] * Math.pow(t, 1.5) : 0;
        const v = (base + p) * 9, c = (base + p) * 12;
        pos[v] = ln.x[p] - wx * w; pos[v + 1] = ln.y[p] - wy * w; pos[v + 2] = ln.z[p] - wz * w;
        pos[v + 3] = ln.x[p]; pos[v + 4] = ln.y[p]; pos[v + 5] = ln.z[p];
        pos[v + 6] = ln.x[p] + wx * w; pos[v + 7] = ln.y[p] + wy * w; pos[v + 8] = ln.z[p] + wz * w;
        // Bright centre, soft transparent edges.
        col[c] = L.r; col[c + 1] = L.g; col[c + 2] = L.b; col[c + 3] = 0;
        col[c + 4] = Math.min(1, L.r * .55 + .45); col[c + 5] = Math.min(1, L.g * .55 + .45); col[c + 6] = Math.min(1, L.b * .55 + .45); col[c + 7] = alpha;
        col[c + 8] = L.r; col[c + 9] = L.g; col[c + 10] = L.b; col[c + 11] = 0;
      }
      // Unused slots collapse onto the last point and are transparent.
      const lx = p ? pos[(base + p - 1) * 9 + 3] : 0, ly = p ? pos[(base + p - 1) * 9 + 4] : 0, lz = p ? pos[(base + p - 1) * 9 + 5] : 0;
      for (; p < POINTS; p++) {
        const v = (base + p) * 9, c = (base + p) * 12;
        for (let q = 0; q < 3; q++) { pos[v + q * 3] = lx; pos[v + q * 3 + 1] = ly; pos[v + q * 3 + 2] = lz; col[c + q * 4 + 3] = 0; }
      }
    }
    this.vertices = m * 3 * this.layers;
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, col);
    this.mesh.setEnabled(true);
  }
  dispose(): void { this.mesh.dispose(); }
}

const origin = Vector3.Zero();
/** Both daggers' trails. Parent them to the camera rig for the first-person view (positions
 * are then in that node's space, seen from its origin) or leave them in the world for other
 * players (pass the camera position to `flush`). */
export class MeleeTrails {
  private readonly ribbons: [Ribbon, Ribbon];
  private now = 0;
  private reduced = false;
  constructor(scene: Scene, name: string, options: { parent?: TransformNode | null; renderingGroupId?: number } = {}) {
    const material = trailMaterial(scene);
    this.ribbons = [new Ribbon(scene, `${name}:trail_r`, material, 2, 2), new Ribbon(scene, `${name}:trail_l`, material, 2, 2)];
    for (const r of this.ribbons) {
      if (options.parent) r.mesh.parent = options.parent;
      if (options.renderingGroupId !== undefined) r.mesh.renderingGroupId = options.renderingGroupId;
    }
  }
  /** Fewer layers and no extra smoothing for Chromebook mode. */
  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    for (const r of this.ribbons) r.configure(reduced ? 1 : 2, reduced ? 1 : 2);
  }
  /** Advance the trail clock (call once per animation sub-step, before pushing its samples). */
  tick(dt: number): void { this.now += dt; }
  push(side: 0 | 1, finisher: boolean, tip: Vector3, guard: Vector3, strength: number): void {
    this.ribbons[side].push(tip, guard, Math.max(0, Math.min(1, strength)), finisher ? 1 : 0, this.now);
  }
  head(side: 0 | 1, tip: Vector3, guard: Vector3): void { this.ribbons[side].setHead(tip, guard); }
  /** Rebuild the vertices for this frame (the meshes switch off when nothing is alive). */
  flush(eye: Vector3 = origin): void { for (const r of this.ribbons) r.flush(this.now, eye); }
  get live(): number { return this.ribbons[0].live + this.ribbons[1].live; }
  clear(): void { for (const r of this.ribbons) r.clear(); }
  /** Compile the material before the first attack so it never hitches. */
  async warm(): Promise<void> {
    const mesh = this.ribbons[0].mesh;
    try { await mesh.material?.forceCompilationAsync(mesh); } catch { /* the first draw compiles it instead */ }
  }
  inspect() {
    return { live: this.live, vertices: this.ribbons[0].vertices + this.ribbons[1].vertices, reduced: this.reduced,
      drawCalls: this.ribbons.filter((r) => r.mesh.isEnabled()).length, layers: this.reduced ? 1 : 2 };
  }
  dispose(): void { for (const r of this.ribbons) r.dispose(); }
}

/** Test hook: forget the shared material (a new scene gets a fresh one anyway). */
export function resetTrailMaterials(): void { materials = new WeakMap(); }
