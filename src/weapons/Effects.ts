import {
  Color3,
  Color4,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  StandardMaterial,
  Texture,
  Vector3,
  type AbstractMesh,
  type Scene,
} from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';

const DECALS = 128;
const SPARK_SYSTEMS = 6;
const CASINGS = 18;

export type CasingType = 'casing_rifle' | 'casing_sniper' | 'casing_shell';

interface Casing {
  mesh: AbstractMesh;
  type: CasingType;
  vel: Vector3;
  spin: Vector3;
  life: number;
  ground: number;
  bounced: boolean;
}

/**
 * Bullet holes, impact sparks and dust, and ejected cases, all pooled to avoid per-shot allocation. Cases are world
 * objects: they fly out of the ejection port, tumble, bounce once on the ground (with a sound) and fade away.
 */
export class Effects {
  private readonly decal: Mesh;
  private readonly decalMatrices: Float32Array;
  private decalCursor = 0;
  private readonly sparks: ParticleSystem[] = [];
  private readonly dust: ParticleSystem[] = [];
  private sparkCursor = 0;
  private readonly casings: Casing[] = [];
  private readonly casingSources = new Map<CasingType, Mesh>();
  private casingCursor = 0;
  /** Called when a case first hits the ground (the game plays the bounce sound). */
  onCasingLand: ((type: CasingType, position: Vector3) => void) | null = null;

  constructor(private readonly scene: Scene) {
    // bullet hole decal: thin-instanced quad, one draw call for every hole
    const decalMat = new StandardMaterial('fx-hole', scene);
    const hole = new Texture(assetUrl('assets/textures/shared/fx/bullet_hole.png'), scene);
    hole.hasAlpha = true;
    decalMat.diffuseTexture = hole;
    decalMat.useAlphaFromDiffuseTexture = true;
    decalMat.diffuseColor = new Color3(1, 1, 1);
    decalMat.emissiveColor = new Color3(0.12, 0.11, 0.1);
    decalMat.specularColor = Color3.Black();
    decalMat.zOffset = -2;
    // double-sided: the decal is tiny and this avoids depending on the quad's facing convention
    decalMat.backFaceCulling = false;
    this.decal = MeshBuilder.CreatePlane('fx-decal', { size: 0.11, sideOrientation: Mesh.FRONTSIDE }, scene);
    this.decal.material = decalMat;
    this.decal.isPickable = false;
    this.decalMatrices = new Float32Array(16 * DECALS);
    const hidden = Matrix.Scaling(0, 0, 0);
    for (let i = 0; i < DECALS; i++) hidden.copyToArray(this.decalMatrices, i * 16);
    this.decal.thinInstanceSetBuffer('matrix', this.decalMatrices, 16, false);
    this.decal.alwaysSelectAsActiveMesh = true;

    const sparkTex = new Texture(assetUrl('assets/textures/shared/fx/spark.png'), scene);
    const dustTex = new Texture(assetUrl('assets/textures/shared/fx/glow.png'), scene);
    for (let i = 0; i < SPARK_SYSTEMS; i++) {
      const ps = new ParticleSystem(`fx-sparks-${i}`, 32, scene);
      ps.particleTexture = sparkTex;
      ps.emitter = Vector3.Zero();
      ps.minEmitBox = Vector3.Zero();
      ps.maxEmitBox = Vector3.Zero();
      ps.color1 = new Color4(1, 0.86, 0.5, 1);
      ps.color2 = new Color4(1, 0.6, 0.25, 1);
      ps.colorDead = new Color4(0.4, 0.15, 0.05, 0);
      ps.minSize = 0.012;
      ps.maxSize = 0.035;
      ps.minLifeTime = 0.08;
      ps.maxLifeTime = 0.25;
      ps.minEmitPower = 2;
      ps.maxEmitPower = 6;
      ps.gravity = new Vector3(0, -9.8, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.updateSpeed = 1 / 60;
      ps.start();
      this.sparks.push(ps);
      // a puff of dust and grit from the hit surface
      const d = new ParticleSystem(`fx-dust-${i}`, 24, scene);
      d.particleTexture = dustTex;
      d.emitter = Vector3.Zero();
      d.minEmitBox = Vector3.Zero();
      d.maxEmitBox = Vector3.Zero();
      d.color1 = new Color4(0.55, 0.52, 0.47, 0.45);
      d.color2 = new Color4(0.42, 0.4, 0.36, 0.35);
      d.colorDead = new Color4(0.4, 0.38, 0.35, 0);
      d.minSize = 0.06;
      d.maxSize = 0.2;
      d.minScaleX = 1;
      d.minLifeTime = 0.35;
      d.maxLifeTime = 0.8;
      d.minEmitPower = 0.3;
      d.maxEmitPower = 1.4;
      d.gravity = new Vector3(0, -0.6, 0);
      d.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      d.emitRate = 0;
      d.manualEmitCount = 0;
      d.updateSpeed = 1 / 60;
      d.start();
      this.dust.push(d);
    }
  }

  /** Load the case models (casings.glb) and build the pool. */
  async loadCasings(materials: MaterialLibrary): Promise<void> {
    const c = await LoadAssetContainerAsync(assetUrl('assets/models/shared/weapons/casings.glb'), this.scene);
    c.addAllToScene();
    for (const m of c.meshes) {
      if (m.getTotalVertices() === 0) continue;
      const name = (m.parent?.name && m.parent.name.startsWith('casing') ? m.parent.name : m.name).replace(/_primitive\d+$/, '');
      if (m.material) m.material = materials.get(m.material.name);
      const world = m.computeWorldMatrix(true).clone();
      m.setParent(null);
      (m as Mesh).bakeTransformIntoVertices(world);
      m.position.setAll(0);
      m.rotationQuaternion = Quaternion.Identity();
      m.scaling.setAll(1);
      // several primitives (brass head + red hull) become one mesh per case type
      const prev = this.casingSources.get(name as CasingType);
      this.casingSources.set(name as CasingType, prev ? Mesh.MergeMeshes([prev, m as Mesh], true, true, undefined, false, true)! : (m as Mesh));
    }
    for (const n of c.transformNodes) n.dispose();
    for (const src of this.casingSources.values()) {
      src.isVisible = false;
      src.isPickable = false;
    }
    // the whole pool exists from the start (so the scene's object count does not grow as cases are thrown)
    const first = this.casingSources.get('casing_rifle');
    for (let i = 0; i < CASINGS; i++) {
      const mesh = first ? first.createInstance(`casing:${i}`) : (null as unknown as AbstractMesh);
      if (mesh) {
        mesh.isPickable = false;
        mesh.rotationQuaternion = Quaternion.Identity();
        mesh.setEnabled(false);
      }
      this.casings.push({ mesh, type: 'casing_rifle', vel: Vector3.Zero(), spin: Vector3.Zero(), life: 0, ground: 0, bounced: true });
    }
  }

  /**
   * Throw a case out of the ejection port: `right` and `up` are the weapon's axes in world space, `carry` the
   * shooter's velocity, `ground` the floor height under the shooter.
   */
  ejectCasing(type: CasingType, at: Vector3, right: Vector3, up: Vector3, back: Vector3, carry: Vector3, ground: number): void {
    const src = this.casingSources.get(type);
    if (!src || !this.casings.length) return;
    const c = this.casings[this.casingCursor];
    this.casingCursor = (this.casingCursor + 1) % this.casings.length;
    if (!c.mesh || c.type !== type) {
      const name = c.mesh?.name ?? `casing:${this.casingCursor}`;
      c.mesh?.dispose();
      c.mesh = src.createInstance(name);
      c.mesh.isPickable = false;
      c.mesh.rotationQuaternion = Quaternion.Identity();
      c.type = type;
    }
    const strength = type === 'casing_shell' ? 1.6 : type === 'casing_sniper' ? 1.7 : 2.1;
    c.mesh.position.copyFrom(at);
    c.vel = right.scale(strength * (0.85 + Math.random() * 0.3)).add(up.scale(1.4 + Math.random() * 0.8)).add(back.scale(0.4)).add(carry);
    c.spin = new Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 30);
    c.mesh.rotationQuaternion = Quaternion.FromLookDirectionRH(right, up);
    c.mesh.scaling.setAll(1);
    c.mesh.setEnabled(true);
    c.life = 2.5;
    c.ground = ground;
    c.bounced = false;
  }

  impact(point: Vector3, normal: Vector3, spark = true): void {
    // align the quad with the surface, slightly off it, with a random roll
    const n = normal.normalizeToNew();
    const pos = point.add(n.scale(0.008));
    const up = Math.abs(n.y) > 0.95 ? Vector3.Forward() : Vector3.Up();
    const rot = Quaternion.FromLookDirectionRH(n.scale(-1), up);
    const roll = Quaternion.RotationAxis(n, Math.random() * Math.PI * 2);
    const s = 0.8 + Math.random() * 0.45;
    const m = Matrix.Compose(new Vector3(s, s, s), roll.multiply(rot), pos);
    m.copyToArray(this.decalMatrices, this.decalCursor * 16);
    this.decalCursor = (this.decalCursor + 1) % DECALS;
    this.decal.thinInstanceBufferUpdated('matrix');
    if (spark) this.burst(pos, n, 6, true);
  }

  /** Sparks (and optionally dust) flying off a surface. */
  burst(pos: Vector3, normal: Vector3, count = 14, dust = false): void {
    const i = this.sparkCursor;
    this.sparkCursor = (this.sparkCursor + 1) % this.sparks.length;
    const ps = this.sparks[i];
    (ps.emitter as Vector3).copyFrom(pos);
    const spread = 0.8;
    ps.direction1 = normal.add(new Vector3(-spread, -spread * 0.3, -spread));
    ps.direction2 = normal.add(new Vector3(spread, spread, spread));
    ps.manualEmitCount = count;
    if (dust) {
      const d = this.dust[i];
      (d.emitter as Vector3).copyFrom(pos);
      d.direction1 = normal.add(new Vector3(-0.4, -0.1, -0.4));
      d.direction2 = normal.add(new Vector3(0.4, 0.5, 0.4));
      d.manualEmitCount = 7;
    }
  }

  update(dt: number): void {
    for (const c of this.casings) {
      if (c.life <= 0 || !c.mesh) continue;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addInPlace(c.vel.scale(dt));
      const q = Quaternion.RotationYawPitchRoll(c.spin.y * dt, c.spin.x * dt, c.spin.z * dt);
      c.mesh.rotationQuaternion = q.multiply(c.mesh.rotationQuaternion!);
      if (c.mesh.position.y < c.ground + 0.006) {
        c.mesh.position.y = c.ground + 0.006;
        if (!c.bounced) {
          c.bounced = true;
          this.onCasingLand?.(c.type, c.mesh.position.clone());
          c.vel.y = Math.abs(c.vel.y) * 0.3;
          c.vel.x *= 0.4;
          c.vel.z *= 0.4;
          c.spin.scaleInPlace(0.4);
        } else {
          c.vel.setAll(0);
          c.spin.setAll(0);
        }
      }
      if (c.life < 0.4) c.mesh.scaling.setAll(Math.max(0.01, c.life / 0.4));
      if (c.life <= 0) c.mesh.setEnabled(false);
    }
  }

  clearDecals(): void {
    const hidden = Matrix.Scaling(0, 0, 0);
    for (let i = 0; i < DECALS; i++) hidden.copyToArray(this.decalMatrices, i * 16);
    this.decal.thinInstanceBufferUpdated('matrix');
    for (const c of this.casings) {
      c.life = 0;
      c.mesh?.setEnabled(false);
    }
  }

  dispose(): void {
    this.decal.dispose(false, true);
    for (const s of this.sparks) s.dispose();
    for (const d of this.dust) d.dispose();
    for (const c of this.casings) c.mesh?.dispose();
    for (const m of this.casingSources.values()) m.dispose();
  }
}
