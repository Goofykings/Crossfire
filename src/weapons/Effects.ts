import {
  Color3,
  Color4,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  StandardMaterial,
  Texture,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import { assetUrl } from '../core/assets';

const DECALS = 96;
const SPARK_SYSTEMS = 4;
const TRACERS = 6;

/** Bullet impact decals, spark bursts and beam tracers, all pooled to avoid per-shot allocation. */
export class Effects {
  private readonly decal: Mesh;
  private readonly decalMatrices: Float32Array;
  private decalCursor = 0;
  private readonly sparks: ParticleSystem[] = [];
  private sparkCursor = 0;
  private readonly tracers: { mesh: Mesh; life: number }[] = [];
  private tracerCursor = 0;

  constructor(scene: Scene) {
    // impact decal: thin-instanced quad, one draw call for every scorch mark
    const decalMat = new StandardMaterial('fx-scorch', scene);
    const scorch = new Texture(assetUrl('assets/textures/shared/fx/scorch.png'), scene);
    scorch.hasAlpha = true;
    decalMat.diffuseTexture = scorch;
    decalMat.useAlphaFromDiffuseTexture = true;
    decalMat.emissiveColor = new Color3(0.25, 0.22, 0.18);
    decalMat.specularColor = Color3.Black();
    decalMat.zOffset = -2;
    // double-sided: the decal is tiny and this avoids depending on the quad's facing convention
    decalMat.backFaceCulling = false;
    this.decal = MeshBuilder.CreatePlane('fx-decal', { size: 0.2, sideOrientation: Mesh.FRONTSIDE }, scene);
    this.decal.material = decalMat;
    this.decal.isPickable = false;
    this.decalMatrices = new Float32Array(16 * DECALS);
    const hidden = Matrix.Scaling(0, 0, 0);
    for (let i = 0; i < DECALS; i++) hidden.copyToArray(this.decalMatrices, i * 16);
    this.decal.thinInstanceSetBuffer('matrix', this.decalMatrices, 16, false);
    this.decal.alwaysSelectAsActiveMesh = true;

    const sparkTex = new Texture(assetUrl('assets/textures/shared/fx/spark.png'), scene);
    for (let i = 0; i < SPARK_SYSTEMS; i++) {
      const ps = new ParticleSystem(`fx-sparks-${i}`, 48, scene);
      ps.particleTexture = sparkTex;
      ps.emitter = Vector3.Zero();
      ps.minEmitBox = Vector3.Zero();
      ps.maxEmitBox = Vector3.Zero();
      ps.color1 = new Color4(0.6, 0.95, 1, 1);
      ps.color2 = new Color4(1, 0.85, 0.5, 1);
      ps.colorDead = new Color4(0.2, 0.3, 0.4, 0);
      ps.minSize = 0.02;
      ps.maxSize = 0.06;
      ps.minLifeTime = 0.12;
      ps.maxLifeTime = 0.35;
      ps.minEmitPower = 1.5;
      ps.maxEmitPower = 5;
      ps.gravity = new Vector3(0, -9.8, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.updateSpeed = 1 / 60;
      ps.start();
      this.sparks.push(ps);
    }

    const tracerMat = new StandardMaterial('fx-tracer', scene);
    tracerMat.emissiveColor = new Color3(0.35, 0.9, 1.4);
    tracerMat.disableLighting = true;
    tracerMat.alpha = 0.85;
    tracerMat.alphaMode = 1;
    tracerMat.fogEnabled = false;
    for (let i = 0; i < TRACERS; i++) {
      const m = MeshBuilder.CreateCylinder(`fx-tracer-${i}`, { height: 1, diameter: 0.018, tessellation: 5 }, scene);
      m.material = tracerMat;
      m.isPickable = false;
      m.setEnabled(false);
      m.rotationQuaternion = Quaternion.Identity();
      this.tracers.push({ mesh: m, life: 0 });
    }
  }

  impact(point: Vector3, normal: Vector3, spark = true): void {
    // align the quad with the surface, slightly off it, with a random roll
    const n = normal.normalizeToNew();
    const pos = point.add(n.scale(0.012));
    const up = Math.abs(n.y) > 0.95 ? Vector3.Forward() : Vector3.Up();
    const rot = Quaternion.FromLookDirectionRH(n.scale(-1), up);
    const roll = Quaternion.RotationAxis(n, Math.random() * Math.PI * 2);
    const s = 0.75 + Math.random() * 0.6;
    const m = Matrix.Compose(new Vector3(s, s, s), roll.multiply(rot), pos);
    m.copyToArray(this.decalMatrices, this.decalCursor * 16);
    this.decalCursor = (this.decalCursor + 1) % DECALS;
    this.decal.thinInstanceBufferUpdated('matrix');
    if (spark) this.burst(pos, n);
  }

  burst(pos: Vector3, normal: Vector3, count = 14): void {
    const ps = this.sparks[this.sparkCursor];
    this.sparkCursor = (this.sparkCursor + 1) % this.sparks.length;
    (ps.emitter as Vector3).copyFrom(pos);
    const spread = 0.8;
    ps.direction1 = normal.add(new Vector3(-spread, -spread * 0.3, -spread));
    ps.direction2 = normal.add(new Vector3(spread, spread, spread));
    ps.manualEmitCount = count;
  }

  tracer(from: Vector3, to: Vector3): void {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const d = to.subtract(from);
    const len = d.length();
    if (len < 0.5) return;
    const dir = d.scale(1 / len);
    t.mesh.position = from.add(d.scale(0.5));
    // cylinder axis is +y
    const axis = Vector3.Cross(Vector3.Up(), dir);
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(Vector3.Up(), dir))));
    t.mesh.rotationQuaternion = axis.lengthSquared() < 1e-8 ? Quaternion.Identity() : Quaternion.RotationAxis(axis.normalize(), angle);
    t.mesh.scaling.set(1, len, 1);
    t.mesh.setEnabled(true);
    t.life = 0.06;
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const k = Math.max(0, t.life / 0.06);
      t.mesh.scaling.x = t.mesh.scaling.z = 0.4 + k;
      if (t.life <= 0) t.mesh.setEnabled(false);
    }
  }

  clearDecals(): void {
    const hidden = Matrix.Scaling(0, 0, 0);
    for (let i = 0; i < DECALS; i++) hidden.copyToArray(this.decalMatrices, i * 16);
    this.decal.thinInstanceBufferUpdated('matrix');
  }

  dispose(): void {
    this.decal.dispose(false, true);
    for (const s of this.sparks) s.dispose();
    for (const t of this.tracers) t.mesh.dispose(false, true);
  }
}
