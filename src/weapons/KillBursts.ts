import { Color3, Matrix, Mesh, Quaternion, StandardMaterial, Vector3, VertexData, type Observer, type Scene } from '@babylonjs/core';
import { skinFxLite } from '../rendering/SkinFx';

/** Legendary elimination effects (docs/KILL_EFFECTS.md):
 *   blossom-flower-burst  Blossom: pink flowers pop around the eliminated player, burst outward, petals flutter down.
 *   frosted-blizzard      Frosted: a dense snowflake swirl around the death spot, then a quick outward dispersal.
 * Cosmetic only and local: four thin-instanced meshes (flower, petal, snowflake, sparkle) of procedural geometry (no textures to
 * load or miss), preallocated particle pools (no allocation per emit or per frame), CPU integration for ~2 s, no physics, collision,
 * lights or network traffic. Budgets are strict: a fixed number of concurrent bursts per effect, the oldest fades out early.
 * Chromebook mode uses far fewer particles and renders them opaque (they shrink instead of fading): no blending, no sorting. */
export type KillBurstEffect = 'blossom-flower-burst' | 'frosted-blizzard';

interface Particle {
  on: boolean; burst: number; kicked: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; hold: number; size: number; angle: number; spin: number;
  ax: number; ay: number; az: number; ph: number; ph2: number; sw: number; fall: number; tint: number;
  // Blizzard orbit: centre, radius, start angle, angular speed, squash, tilt, height, rise.
  cx: number; cy: number; cz: number; r: number; th: number; w: number; squash: number; tilt: number; h: number; rise: number; end: number;
}
const particle = (): Particle => ({ on: false, burst: 0, kicked: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, hold: 0, size: 0, angle: 0, spin: 0,
  ax: 0, ay: 1, az: 0, ph: 0, ph2: 0, sw: 0, fall: 0, tint: 0, cx: 0, cy: 0, cz: 0, r: 0, th: 0, w: 0, squash: 1, tilt: 0, h: 0, rise: 0, end: 1 });

/** Per-effect budgets. Capacity is sized for the concurrent burst limit, so the pools never grow. */
export const BURST_BUDGET = {
  full: { bursts: 3, flowers: 26, petals: 44, flakes: 54, sparkles: 10 },
  lite: { bursts: 2, flowers: 11, petals: 14, flakes: 22, sparkles: 4 },
} as const;
const MAX_DISTANCE = 150;
const DURATION = { 'blossom-flower-burst': 2.1, 'frosted-blizzard': 1.45 } as const;

const FWD = new Vector3(0, 0, 1);
const rnd = (a = 0, b = 1): number => a + Math.random() * (b - a);
const smooth = (t: number): number => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
/** Eases to slightly above 1 then settles: the "pop" of a flower appearing. */
const popScale = (t: number): number => { if (t >= 1) return 1; if (t <= 0) return 0; const c = 1.9, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

/** One flat, rotation-symmetric blossom in the XY plane: a deep-pink heart, five notched petals (no overlap, so no coplanar faces) and a
 * warm centre. Vertex colours go from a deeper base to pale tips; the instance colour tints the whole flower. */
function flowerGeometry(): VertexData {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const vertex = (x: number, y: number, c: [number, number, number]): number => { positions.push(x, y, 0); colors.push(c[0], c[1], c[2], 1); return positions.length / 3 - 1; };
  // Petal outline in (radial, lateral) units; the notch at the tip is what makes it read as a cherry blossom.
  const outline: [number, number][] = [[.40, -.25], [.72, -.30], [.93, -.17], [1, -.08], [.88, 0], [1, .08], [.93, .17], [.72, .30], [.40, .25]];
  const baseColor: [number, number, number] = [.8, .38, .56], tipColor: [number, number, number] = [1, .8, .9];
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5 + Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    const at = (u: number, v: number): [number, number] => [c * u - s * v, s * u + c * v];
    const base = vertex(...at(.14, 0), baseColor);
    const ring = outline.map(([u, v]) => { const [x, y] = at(u, v); return vertex(x, y, [baseColor[0] + (tipColor[0] - baseColor[0]) * u, baseColor[1] + (tipColor[1] - baseColor[1]) * u, baseColor[2] + (tipColor[2] - baseColor[2]) * u]); });
    for (let i = 0; i + 1 < ring.length; i++) indices.push(base, ring[i], ring[i + 1]);
  }
  const centre = vertex(0, 0, [1, .95, .5]);
  const hex: number[] = [];
  for (let i = 0; i < 6; i++) hex.push(vertex(Math.cos(i * Math.PI / 3) * .125, Math.sin(i * Math.PI / 3) * .125, [1, .85, .35]));
  for (let i = 0; i < 6; i++) indices.push(centre, hex[i], hex[(i + 1) % 6]);
  return build(positions, indices, colors);
}

/** A single cupped petal (length 1 along +X from the base): four rows by three columns, bent so a tumbling petal shows depth. */
function petalGeometry(): VertexData {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const rows = [[0, .05], [.32, .30], [.7, .28], [1, .08]] as const;
  for (const [u, half] of rows) for (const col of [-1, 0, 1]) {
    positions.push(u - .4, col * half, .16 * col * col * (half / .3) + .14 * u * u);
    const shade = .62 + .3 * u; colors.push(1, shade * .85, shade * .92, 1);
  }
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < 2; c++) {
    const a = r * 3 + c, b = a + 1, d = a + 3, e = d + 1;
    indices.push(a, d, b, b, d, e);
  }
  return build(positions, indices, colors);
}

/** Six-armed ice crystal with side branches, flat in the XY plane (about 30 triangles). */
function flakeGeometry(): VertexData {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const bar = (x0: number, y0: number, x1: number, y1: number, w: number): void => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w, ny = dx / l * w, base = positions.length / 3;
    positions.push(x0 + nx, y0 + ny, 0, x0 - nx, y0 - ny, 0, x1 - nx, y1 - ny, 0, x1 + nx, y1 + ny, 0);
    for (let i = 0; i < 4; i++) colors.push(1, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
    bar(0, 0, c, s, .085);
    for (const side of [-1, 1]) { const b = a + side * Math.PI / 3; bar(c * .58, s * .58, c * .58 + Math.cos(b) * .3, s * .58 + Math.sin(b) * .3, .06); }
  }
  return build(positions, indices, colors);
}

/** Four-point glint (the "brighter crystalline highlight"): two thin diamonds. */
function sparkleGeometry(): VertexData {
  const positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const diamond = (lx: number, ly: number, wx: number, wy: number): void => {
    const base = positions.length / 3;
    positions.push(lx, ly, 0, wx, wy, 0, -lx, -ly, 0, -wx, -wy, 0);
    for (let i = 0; i < 4; i++) colors.push(1, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  diamond(0, 1, .16, 0); diamond(1, 0, 0, .16);
  diamond(.5, .5, .09, -.09); diamond(.5, -.5, .09, .09);
  return build(positions, indices, colors);
}

function build(positions: number[], indices: number[], colors: number[]): VertexData {
  const data = new VertexData(); data.positions = positions; data.indices = indices; data.colors = colors;
  data.normals = positions.map((_, i) => (i % 3 === 2 ? 1 : 0)); return data;
}

/** A pool of particles drawn as one thin-instanced mesh. */
class Field {
  readonly mesh: Mesh;
  readonly parts: Particle[];
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  private blended = true;
  constructor(scene: Scene, name: string, geometry: VertexData, readonly capacity: number) {
    const material = new StandardMaterial(`kill-burst-${name}`, scene);
    // Unlit: the colour is the vertex colour times the instance tint, so nothing depends on scene lights or the sun.
    material.disableLighting = true; material.emissiveColor = Color3.White(); material.backFaceCulling = false; material.fogEnabled = false;
    this.mesh = new Mesh(`kill-burst-${name}`, scene);
    geometry.applyToMesh(this.mesh);
    this.mesh.material = material; this.mesh.renderingGroupId = 0; this.mesh.isPickable = false; this.mesh.receiveShadows = false; this.mesh.alwaysSelectAsActiveMesh = true;
    this.matrices = new Float32Array(capacity * 16); this.colors = new Float32Array(capacity * 4);
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    this.mesh.thinInstanceCount = 0; this.mesh.hasVertexAlpha = true;
    // With no instances Babylon would draw the template itself at the origin: keep the mesh off while idle.
    this.mesh.setEnabled(false);
    this.parts = Array.from({ length: capacity }, particle);
  }
  get active(): number { let n = 0; for (const p of this.parts) if (p.on) n++; return n; }
  /** A free particle, or the one closest to expiry when the pool is full (the budget never grows). */
  take(limit = this.capacity): Particle {
    let pick = this.parts[0], best = -Infinity;
    for (let i = 0; i < limit; i++) { const p = this.parts[i]; if (!p.on) return p; const used = p.age / p.life; if (used > best) { best = used; pick = p; } }
    return pick;
  }
  setBlended(value: boolean): void { if (this.blended !== value) { this.blended = value; this.mesh.hasVertexAlpha = value; } }
  get isBlended(): boolean { return this.blended; }
  commit(count: number): void {
    this.mesh.thinInstanceCount = count; this.mesh.setEnabled(count > 0);
    if (count > 0) { this.mesh.thinInstanceBufferUpdated('matrix'); this.mesh.thinInstanceBufferUpdated('color'); }
  }
  write(n: number, m: Matrix, r: number, g: number, b: number, a: number): void {
    m.copyToArray(this.matrices, n * 16); const o = n * 4; this.colors[o] = r; this.colors[o + 1] = g; this.colors[o + 2] = b; this.colors[o + 3] = a;
  }
  clear(): void { for (const p of this.parts) p.on = false; this.commit(0); }
  dispose(): void { this.mesh.material?.dispose(); this.mesh.dispose(); }
}

const FLOWER_TINTS: readonly (readonly [number, number, number])[] = [[1, .2, .5], [1, .6, .76], [.82, .08, .34]];
const PETAL_TINTS: readonly (readonly [number, number, number])[] = [[1, .62, .78], [1, .3, .56], [.86, .12, .4], [1, .88, .93]];
const FLAKE_TINTS: readonly (readonly [number, number, number])[] = [[1, 1, 1], [.5, .76, 1], [.32, .62, 1]];

export class KillBursts {
  private readonly flowers: Field; private readonly petals: Field; private readonly flakes: Field; private readonly sparkles: Field;
  private readonly fields: Field[];
  private readonly bursts: { id: number; effect: KillBurstEffect; start: number; until: number }[] = [];
  private readonly q = new Quaternion(); private readonly face = new Quaternion(); private readonly m = new Matrix();
  private readonly s = new Vector3(); private readonly p = new Vector3();
  private readonly observer: Observer<Scene>;
  private nextId = 1; private tick = performance.now(); private clock = 0; private emitted = 0;
  constructor(private readonly scene: Scene) {
    const max = BURST_BUDGET.full;
    this.flowers = new Field(scene, 'flower', flowerGeometry(), max.flowers * max.bursts);
    this.petals = new Field(scene, 'petal', petalGeometry(), max.petals * max.bursts);
    this.flakes = new Field(scene, 'flake', flakeGeometry(), max.flakes * max.bursts);
    this.sparkles = new Field(scene, 'sparkle', sparkleGeometry(), max.sparkles * max.bursts);
    this.fields = [this.flowers, this.petals, this.flakes, this.sparkles];
    // Own clock: the engine's frame delta only advances inside its render loop.
    this.observer = scene.onBeforeRenderObservable.add(() => { const now = performance.now(); if (this.frozen) { this.tick = now; return; } this.update(Math.min(.05, Math.max(0, (now - this.tick) / 1000))); this.tick = now; });
  }
  /** Review hook: freezes the effect clock so a test can step it to exact ages (`step`) and screenshot each one. */
  private frozen = false;
  freeze(on: boolean): void { this.frozen = on; this.tick = performance.now(); }
  step(seconds: number): void { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) this.update(Math.min(1 / 60, seconds - t)); }
  get active(): number { return this.fields.reduce((n, f) => n + f.active, 0); }
  inspect() {
    const lite = skinFxLite();
    return { lite, bursts: this.bursts.length, ages: this.bursts.map((b) => +(this.clock - b.start).toFixed(3)), emitted: this.emitted, flowers: this.flowers.active, petals: this.petals.active, flakes: this.flakes.active, sparkles: this.sparkles.active,
      blended: this.flowers.isBlended, capacity: this.fields.map((f) => f.capacity), budget: lite ? BURST_BUDGET.lite : BURST_BUDGET.full, drawn: this.fields.filter((f) => f.mesh.isEnabled()).length };
  }
  meshes(): Mesh[] { return this.fields.map((f) => f.mesh); }

  /** `at` is the eliminated player's feet in world space (the authoritative event position). `distance` scales particles up for far
   * viewers and `reduced` honours prefers-reduced-motion with a calmer, smaller effect. */
  emit(effect: KillBurstEffect, at: Vector3, { distance = 0, reduced = false }: { distance?: number; reduced?: boolean } = {}): void {
    if (distance > MAX_DISTANCE) return;
    const lite = skinFxLite(), budget = lite ? BURST_BUDGET.lite : BURST_BUDGET.full;
    for (const f of this.fields) f.setBlended(!lite);
    // Concurrent budget per effect: the oldest burst of this kind fades out early instead of piling up.
    const same = this.bursts.filter((b) => b.effect === effect);
    while (same.length >= budget.bursts) { const old = same.shift()!; this.retire(old.id); this.bursts.splice(this.bursts.indexOf(old), 1); }
    const id = this.nextId++; this.emitted++;
    this.bursts.push({ id, effect, start: this.clock, until: this.clock + DURATION[effect] + .1 });
    const boost = 1 + Math.min(1.5, Math.max(0, distance - 12) / 25), calm = reduced ? .5 : 1;
    if (effect === 'blossom-flower-burst') this.emitBlossom(id, at, budget, boost, calm, reduced);
    else this.emitBlizzard(id, at, budget, boost, calm, reduced);
  }
  /** Removes everything now (map change, leaving the match). */
  clear(): void { for (const f of this.fields) f.clear(); this.bursts.length = 0; }

  private retire(id: number): void {
    for (const f of this.fields) for (const p of f.parts) if (p.on && p.burst === id) p.life = Math.min(p.life, Math.max(p.age, 0) + .16);
  }

  private emitBlossom(id: number, at: Vector3, budget: { bursts: number; flowers: number; petals: number }, boost: number, calm: number, reduced: boolean): void {
    const cy = at.y + .95;
    const spawn = (field: Field, count: number, petal: boolean): void => {
      // Only the first `bursts * perBurst` particles of a pool are used, so the active quality mode sets the real ceiling.
      const limit = (petal ? budget.petals : budget.flowers) * budget.bursts;
      for (let i = 0; i < count; i++) {
        const p = field.take(limit);
        // Direction on a slightly tall ellipsoid; flowers sit on a shell around the body so they surround it without hiding it entirely.
        let dx = rnd(-1, 1), dy = rnd(-1, 1), dz = rnd(-1, 1); const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        const rho = petal ? rnd(.25, .7) : rnd(.4, .72);
        p.on = true; p.burst = id; p.kicked = false;
        p.x = at.x + dx * rho; p.y = Math.max(at.y + .08, cy + dy * rho * 1.3); p.z = at.z + dz * rho;
        // The pieces pop in over ~0.12 s, hold for a beat, then burst outward together.
        p.age = -rnd(0, reduced ? .2 : .12); p.hold = rnd(.15, .24);
        const speed = (petal ? rnd(1.8, 4.2) : rnd(2.4, 4.6)) * calm;
        p.vx = dx * speed; p.vy = dy * speed * .75 + .6 * calm; p.vz = dz * speed;
        p.life = (petal ? rnd(1.65, 2.05) : rnd(1.5, 1.85)) * (reduced ? .85 : 1);
        p.size = (petal ? rnd(.07, .125) : rnd(.085, .165) * (Math.random() < .12 ? 1.35 : 1)) * boost;
        p.angle = rnd(0, 6.3); p.spin = (petal ? rnd(2.2, 6) : rnd(-2.4, 2.4)) * calm * (Math.random() < .5 ? -1 : 1);
        p.ax = rnd(-1, 1); p.ay = rnd(-1, 1); p.az = rnd(-1, 1); const al = Math.hypot(p.ax, p.ay, p.az) || 1; p.ax /= al; p.ay /= al; p.az /= al;
        p.ph = rnd(0, 6.3); p.ph2 = rnd(0, 6.3); p.sw = rnd(3.2, 6.2); p.fall = petal ? rnd(.42, .85) : rnd(.6, 1.05);
        const roll = Math.random(); p.tint = petal ? (roll < .5 ? 0 : roll < .78 ? 1 : roll < .92 ? 2 : 3) : (roll < .42 ? 0 : roll < .82 ? 1 : 2);
        p.cy = at.y;
      }
    };
    spawn(this.flowers, Math.round(budget.flowers * calm), false);
    spawn(this.petals, Math.round(budget.petals * calm), true);
  }

  private emitBlizzard(id: number, at: Vector3, budget: { bursts: number; flakes: number; sparkles: number }, boost: number, calm: number, reduced: boolean): void {
    const spawn = (field: Field, count: number, sparkle: boolean): void => {
      const limit = (sparkle ? budget.sparkles : budget.flakes) * budget.bursts;
      for (let i = 0; i < count; i++) {
        const p = field.take(limit);
        p.on = true; p.burst = id; p.kicked = false;
        p.cx = at.x; p.cz = at.z; p.cy = at.y + .95;
        // Varied orbits: radius, squash and tilt differ per flake, so the swirl is never a clean ring. A fifth spin the other way.
        p.r = .14 + .72 * Math.pow(Math.random(), .8); p.th = rnd(0, 6.3);
        p.w = rnd(5, 12) * (Math.random() < .2 ? -.7 : 1) * (reduced ? .25 : 1);
        p.squash = rnd(.55, 1); p.tilt = rnd(0, 3.14);
        p.h = (Math.random() + Math.random() - 1) * .85; p.rise = rnd(.05, .3) * calm;
        p.age = -rnd(0, .1); p.end = rnd(.85, 1.03);
        p.life = p.end + rnd(.22, .3);
        p.size = (sparkle ? rnd(.075, .13) : rnd(.032, .068)) * boost;
        p.angle = rnd(0, 6.3); p.spin = rnd(-9, 9) * (reduced ? .25 : 1);
        p.ph = rnd(0, 6.3); p.ph2 = rnd(0, 6.3); p.sw = rnd(4, 9);
        const roll = Math.random(); p.tint = sparkle ? 0 : roll < .45 ? 0 : roll < .85 ? 1 : 2;
        p.fall = rnd(2.4, 4.6) * (reduced ? .4 : 1);
      }
    };
    spawn(this.flakes, Math.round(budget.flakes * calm), false);
    spawn(this.sparkles, Math.round(budget.sparkles * calm), true);
  }

  private update(dt: number): void {
    this.clock += dt;
    for (let i = this.bursts.length - 1; i >= 0; i--) if (this.clock > this.bursts[i].until) this.bursts.splice(i, 1);
    let any = false;
    for (const f of this.fields) for (const p of f.parts) if (p.on) { any = true; break; }
    if (!any) { for (const f of this.fields) if (f.mesh.isEnabled()) f.commit(0); return; }
    const camera = this.scene.activeCamera;
    if (camera) camera.getWorldMatrix().decompose(undefined, this.face); else this.face.copyFromFloats(0, 0, 0, 1);
    const blended = this.flowers.isBlended;
    this.updateBlossom(this.flowers, false, dt, blended); this.updateBlossom(this.petals, true, dt, blended);
    this.updateBlizzard(this.flakes, false, dt, blended); this.updateBlizzard(this.sparkles, true, dt, blended);
  }

  private updateBlossom(field: Field, petal: boolean, dt: number, blended: boolean): void {
    const tints = petal ? PETAL_TINTS : FLOWER_TINTS; let n = 0;
    for (const x of field.parts) {
      if (!x.on) continue;
      x.age += dt;
      if (x.age >= x.life) { x.on = false; continue; }
      if (x.age < 0) continue;
      if (x.age < x.hold) {
        // Held: a slow drift so the cluster breathes before it bursts.
        x.x += x.vx * .04 * dt; x.y += x.vy * .04 * dt; x.z += x.vz * .04 * dt;
      } else {
        x.kicked = true;
        // Fast expansion that drags to a stop, then a slow flutter downward with sideways sway.
        const drag = Math.exp(-4.2 * dt); x.vx *= drag; x.vz *= drag; x.vy *= drag;
        x.vy += (-x.fall - x.vy) * Math.min(1, 1.6 * dt);
        x.x += x.vx * dt + Math.sin(x.age * x.sw + x.ph) * .42 * dt; x.z += x.vz * dt + Math.cos(x.age * x.sw * .8 + x.ph2) * .3 * dt; x.y += x.vy * dt;
        // Never sink through the floor: pieces land softly and are already fading by then.
        if (x.y < x.cy + .03) { x.y = x.cy + .03; x.vy = 0; x.vx *= .9; x.vz *= .9; }
      }
      x.angle += x.spin * dt;
      const fade = Math.min(1, (x.life - x.age) / .4), pop = popScale(x.age / .11);
      const size = x.size * pop * (blended ? .88 + .12 * fade : Math.max(.02, fade));
      this.p.set(x.x, x.y, x.z);
      if (petal) {
        this.s.setAll(size);
        Quaternion.RotationAxisToRef(this.axis(x), x.angle, this.q);
      } else {
        // Flowers face the camera and spin about the view axis; a gentle squash keeps them from reading as flat decals.
        this.s.set(size, size * (.84 + .16 * Math.cos(x.age * 3.4 + x.ph)), size);
        Quaternion.RotationAxisToRef(FWD, x.angle, this.q); this.face.multiplyToRef(this.q, this.q);
      }
      Matrix.ComposeToRef(this.s, this.q, this.p, this.m);
      const t = tints[x.tint];
      field.write(n++, this.m, t[0], t[1], t[2], blended ? fade * .96 : 1);
    }
    field.commit(n);
  }

  private readonly axisVec = new Vector3();
  private axis(x: Particle): Vector3 { return this.axisVec.set(x.ax, x.ay, x.az); }

  private updateBlizzard(field: Field, sparkle: boolean, dt: number, blended: boolean): void {
    let n = 0;
    for (const x of field.parts) {
      if (!x.on) continue;
      x.age += dt;
      if (x.age >= x.life) { x.on = false; continue; }
      if (x.age < 0) continue;
      const t = x.age;
      if (t < x.end) {
        // Swirl: an orbit that gathers outward over the first 0.25 s, with its own squash/tilt, a rising spiral and two sine turbulences.
        const radius = x.r * (.5 + .5 * smooth(t / .25)) * (1 + .22 * Math.sin(t * 3.1 + x.ph));
        const a = x.th + x.w * t, ex = Math.cos(a) * radius, ez = Math.sin(a) * radius * x.squash;
        const ct = Math.cos(x.tilt), st = Math.sin(x.tilt);
        x.x = x.cx + ex * ct - ez * st + Math.sin(t * x.sw + x.ph) * .05 + Math.sin(t * x.sw * 2.1 + x.ph2) * .025;
        x.z = x.cz + ex * st + ez * ct + Math.cos(t * x.sw * .9 + x.ph2) * .05;
        x.y = x.cy + x.h + t * x.rise + Math.sin(t * 4.3 + x.ph) * .12;
      } else {
        if (!x.kicked) {
          // Disperse: leave along the orbit's tangent with a strong outward kick, then drag to a stop while fading.
          x.kicked = true;
          let ox = x.x - x.cx, oz = x.z - x.cz; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
          const out = x.fall, tang = x.w * .08 * Math.min(1.2, ol + .3);
          x.vx = ox * out - oz * tang; x.vz = oz * out + ox * tang; x.vy = rnd(.2, 1.1) * (x.fall / 3.5);
        }
        const drag = Math.exp(-3.4 * dt); x.vx *= drag; x.vy *= drag; x.vz *= drag; x.vy -= .35 * dt;
        x.x += x.vx * dt; x.y += x.vy * dt; x.z += x.vz * dt;
      }
      if (x.y < x.cy - .9 + .04) x.y = x.cy - .9 + .04;
      x.angle += x.spin * dt;
      const fade = Math.min(1, (x.life - x.age) / .25), appear = smooth(t / .12);
      let size = x.size * appear * (blended ? .75 + .25 * fade : Math.max(.02, fade));
      // Sparkles twinkle: their size pulses so they catch the eye.
      if (sparkle) size *= .55 + .45 * Math.abs(Math.sin(t * 9 + x.ph));
      this.s.setAll(size); this.p.set(x.x, x.y, x.z);
      Quaternion.RotationAxisToRef(FWD, x.angle, this.q); this.face.multiplyToRef(this.q, this.q);
      Matrix.ComposeToRef(this.s, this.q, this.p, this.m);
      const c = FLAKE_TINTS[x.tint];
      field.write(n++, this.m, c[0], c[1], c[2], blended ? fade * .95 : 1);
    }
    field.commit(n);
  }

  /** Compiles every shader variant up front (blended and opaque) so the first elimination never hitches. */
  async warm(): Promise<void> {
    const keep = this.flowers.isBlended;
    for (const blended of [true, false]) {
      for (const f of this.fields) f.setBlended(blended);
      await Promise.all(this.fields.map((f) => f.mesh.material!.forceCompilationAsync(f.mesh, { useInstances: true })));
    }
    for (const f of this.fields) f.setBlended(keep);
  }
  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    for (const f of this.fields) f.dispose();
    this.bursts.length = 0;
  }
}
