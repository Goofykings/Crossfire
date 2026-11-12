import { Color3, Matrix, Mesh, Quaternion, StandardMaterial, TransformNode, Vector3, VertexData, type Node, type Observer, type Scene } from '@babylonjs/core';
import { skinFxLite } from '../rendering/SkinFx';

/** Frosted (Legendary) firing effect: a few small snowflakes drift out from the gun and
 * fade. Cosmetic only: one thin-instanced mesh of six-armed flakes, fixed capacity,
 * CPU-integrated for well under a second, no physics, collision, lights or network.
 * Chromebook mode emits fewer flakes and renders them opaque (they shrink instead of
 * fading), so there is no blending or sorting cost. */
interface Flake { p: Vector3; v: Vector3; spin: number; angle: number; age: number; life: number; size: number; blue: number }
const CAPACITY = 72, LITE_CAPACITY = 20, PER_SHOT = 7, LITE_PER_SHOT = 3, MIN_GAP_MS = 55;

function flakeGeometry(): VertexData {
  // Three thin crossed bars: a flat six-armed star in the XY plane, 6 triangles.
  const positions: number[] = [], indices: number[] = [], normals: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a), w = .11, base = positions.length / 3;
    for (const [l, t] of [[-1, -w], [1, -w], [1, w], [-1, w]]) { positions.push(c * l - s * t, s * l + c * t, 0); normals.push(0, 0, 1); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals;
  return data;
}

export class SnowBurst {
  private readonly mesh: Mesh;
  private readonly root: TransformNode;
  private readonly flakes: Flake[] = [];
  private readonly matrices = new Float32Array(CAPACITY * 16);
  private readonly colors = new Float32Array(CAPACITY * 4);
  private readonly q = new Quaternion(); private readonly face = new Quaternion(); private readonly m = new Matrix(); private readonly s = new Vector3();
  private readonly observer: Observer<Scene>;
  private readonly scale: number;
  private last = -Infinity; private blended = true; private tick = performance.now();
  /** `parent` is the camera for first person (camera-space flakes), or null for world space.
   * `scale` sizes distances and speeds (the first-person gun sits about 0.4 m from the eye). */
  constructor(private readonly scene: Scene, { parent = null, scale = 1, group = 0 }: { parent?: Node | null; scale?: number; group?: number } = {}) {
    this.root = new TransformNode('snow-burst', scene); this.root.parent = parent;
    const material = new StandardMaterial('snow-flake', scene);
    material.disableLighting = true; material.emissiveColor = Color3.White(); material.backFaceCulling = false; material.fogEnabled = false;
    this.mesh = new Mesh('snow-flakes', scene);
    flakeGeometry().applyToMesh(this.mesh);
    this.mesh.material = material; this.mesh.parent = this.root; this.mesh.renderingGroupId = group;
    this.mesh.isPickable = false; this.mesh.receiveShadows = false; this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    this.mesh.thinInstanceCount = 0;
    this.mesh.hasVertexAlpha = true;
    // With no instances Babylon would draw the unit-size template itself at the root: keep it off while idle.
    this.mesh.setEnabled(false);
    this.scale = scale;
    // Own clock: the engine's frame delta only advances inside its render loop.
    this.observer = scene.onBeforeRenderObservable.add(() => { const now = performance.now(); this.update(Math.min(.05, Math.max(0, (now - this.tick) / 1000))); this.tick = now; });
  }
  get active(): number { return this.flakes.length; }
  /** One shot. `at` is a world position near the gun; `forward` the world firing direction.
   * Automatic fire is rate-limited so a full magazine stays a light flurry. */
  emit(at: Vector3, forward: Vector3, now = performance.now()): void {
    if (now - this.last < MIN_GAP_MS) return;
    this.last = now;
    const lite = skinFxLite(), capacity = lite ? LITE_CAPACITY : CAPACITY, count = lite ? LITE_PER_SHOT : PER_SHOT;
    if (this.blended === lite) { this.blended = !lite; this.mesh.hasVertexAlpha = !lite; }
    const parent = this.root.parent as TransformNode | null;
    let origin = at, dir = forward;
    if (parent) {
      const inverse = parent.getWorldMatrix().clone().invert();
      origin = Vector3.TransformCoordinates(at, inverse); dir = Vector3.TransformNormal(forward, inverse);
    }
    dir = dir.normalizeToNew();
    while (this.flakes.length + count > capacity) this.flakes.shift();
    for (let i = 0; i < count; i++) {
      // Outward from the barrel axis in every direction, a little forward, slowly sinking.
      const side = new Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5);
      side.subtractInPlace(dir.scale(Vector3.Dot(side, dir))).normalize();
      const v = side.scale((.18 + Math.random() * .24) * this.scale).addInPlace(dir.scale((.03 + Math.random() * .1) * this.scale));
      this.flakes.push({ p: origin.add(side.scale((.03 + Math.random() * .02) * this.scale)).addInPlace(dir.scale((Math.random() - .7) * .1 * this.scale)), v,
        spin: (Math.random() - .5) * 5, angle: Math.random() * 6.3, age: 0, life: .5 + Math.random() * .35,
        size: (.009 + Math.random() * .008) * this.scale, blue: Math.random() < .4 ? 1 : 0 });
    }
  }
  private update(dt: number): void {
    if (!this.flakes.length) { if (this.mesh.isEnabled()) { this.mesh.thinInstanceCount = 0; this.mesh.setEnabled(false); } return; }
    // World-space flakes face the camera; camera-space flakes already do.
    const camera = this.scene.activeCamera;
    if (this.root.parent || !camera) this.face.copyFromFloats(0, 0, 0, 1);
    else camera.getWorldMatrix().decompose(undefined, this.face);
    let n = 0;
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i]; f.age += dt;
      if (f.age >= f.life) { this.flakes.splice(i, 1); continue; }
      f.v.scaleInPlace(Math.exp(-3.4 * dt)); f.v.y -= .16 * this.scale * dt;
      f.p.addInPlace(f.v.scale(dt)); f.angle += f.spin * dt;
      const fade = Math.min(1, f.age / .05, (f.life - f.age) / (f.life * .55));
      // Blended flakes keep their size and fade; opaque ones shrink away.
      this.s.setAll(f.size * (this.blended ? .7 + .3 * fade : Math.max(.02, fade)));
      Quaternion.RotationAxisToRef(Vector3.Forward(), f.angle, this.q); this.face.multiplyToRef(this.q, this.q);
      Matrix.ComposeToRef(this.s, this.q, f.p, this.m); this.m.copyToArray(this.matrices, n * 16);
      this.colors[n * 4] = f.blue ? .72 : 1; this.colors[n * 4 + 1] = f.blue ? .88 : 1; this.colors[n * 4 + 2] = 1; this.colors[n * 4 + 3] = this.blended ? fade * .9 : 1;
      n++;
    }
    this.mesh.thinInstanceCount = n; this.mesh.setEnabled(n > 0);
    this.mesh.thinInstanceBufferUpdated('matrix'); this.mesh.thinInstanceBufferUpdated('color');
  }
  meshes(): Mesh[] { return [this.mesh]; }
  inspect() { return { active: this.flakes.length, blended: this.blended, capacity: skinFxLite() ? LITE_CAPACITY : CAPACITY }; }
  /** Compile up front so the first shot never hitches. */
  warm(): Promise<void> { this.blended=!skinFxLite();this.mesh.hasVertexAlpha=this.blended;return this.mesh.material!.forceCompilationAsync(this.mesh, { useInstances: true }).then(() => {}); }
  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.mesh.material?.dispose(); this.mesh.dispose(); this.root.dispose(); this.flakes.length = 0;
  }
}
