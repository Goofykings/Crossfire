import {WEAPONS} from './Weapon';
import { cosmetic, defaultCosmetic, defaultEquipment, type Equipment } from '../../shared/cosmetics';
import { loadCosmeticAsset, visualCosmetic } from '../rendering/CosmeticAssets';
import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  PointLight,
  Quaternion,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type AssetContainer,
  type Scene,
} from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { RenderContext } from '../rendering/RenderContext';
import type { CasingType, Effects } from './Effects';
import type { Weapon, WeaponAction, WeaponId } from './Weapon';
import { WeaponMotion, type MotionInput } from './WeaponMotion';

export const WEAPON_RENDER_GROUP = 1;
/** Horizontal viewmodel FOV, independent of world/ADS/scope magnification. */
export const VIEWMODEL_FOV = Math.PI / 2;

type V3 = [number, number, number];
/** Camera-space offset and rotation of the weapon: [dx, dy, dz, pitch (muzzle up), yaw (muzzle left), roll (top left)]. */
type Pose6 = [number, number, number, number, number, number];
type Keys = [number, number[]][];

/** Placement and appearance of each existing weapon model. */
interface RigConfig {
  id: WeaponId;
  file: string;
  /** Model origin (the pistol grip) at the hip, in camera space, and the hip rotation (pitch, yaw, roll). */
  hip: V3;
  hipRot: V3;
  /** Distance from the eye to the sight point when aiming. */
  eye: number;
  casing: CasingType;
  flash: number;
  /** View-model kick per shot. */
  kick: number;
}

export const RIG_CONFIGS: Record<WeaponId, RigConfig> = {
  smg: {
    id: 'smg', file: cosmetic(defaultCosmetic('smg'))!.asset.model,
    hip: [0.20, -0.235, -0.4], hipRot: [0.03, 0.09, -0.06],
    eye: 0.20, casing: 'casing_rifle', flash: 0.75, kick: 0.7,
  },
  rifle: {
    id: 'rifle',
    file: cosmetic(defaultCosmetic('rifle'))!.asset.model,
    hip: [0.22, -0.24, -0.4],
    hipRot: [0.03, 0.09, -0.06],
    eye: 0.21,
    casing: 'casing_rifle',
    flash: 1.0,
    kick: 1,
  },
  shotgun: {
    id: 'shotgun',
    file: cosmetic(defaultCosmetic('shotgun'))!.asset.model,
    hip: [0.22, -0.235, -0.4],
    hipRot: [0.03, 0.09, -0.06],
    eye: 0.16,
    casing: 'casing_shell',
    flash: 1.5,
    kick: 2.6,
  },
  sniper: {
    id: 'sniper',
    file: cosmetic(defaultCosmetic('sniper'))!.asset.model,
    hip: [0.22, -0.235, -0.4],
    hipRot: [0.03, 0.09, -0.06],
    eye: 0.1,
    casing: 'casing_sniper',
    flash: 1.3,
    kick: 2.0,
  },
};

const DOWN: Pose6 = [0.04, -0.32, 0.08, -0.95, 0.25, 0.45];
const ZERO6: Pose6 = [0, 0, 0, 0, 0, 0];

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Piecewise smoothstep interpolation through keys [t, values]. */
function sample(keys: Keys, t: number): number[] {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1];
      const [t1, b] = keys[i];
      const k = smooth((t - t0) / Math.max(1e-6, t1 - t0));
      return a.map((v, j) => v + (b[j] - v) * k);
    }
  }
  return keys[keys.length - 1][1];
}

const v3 = (a: V3 | number[]) => new Vector3(a[0], a[1], a[2]);

const mulS = (a: number[], s: number) => a.map((v) => v * s);

/** One weapon's model, moving parts and anchors. */
interface Rig {
  cosmeticId:string;
  cfg: RigConfig;
  root: TransformNode;
  meshes: AbstractMesh[];
  anchors: Map<string, Vector3>;
  pump: TransformNode | null;
  bolt: TransformNode | null;
  muzzle: TransformNode;
  eject: TransformNode;
  flash: Mesh;
}

/** Moving weapon parts and camera-space action pose. */
interface Pose {
  weapon: number[];
  pump: number;
  bolt: [number, number];
}

/**
 * Existing weapon models with hip/ADS, sway, bob, recoil, sprint and switching.
 * Reloads lower and return the weapon; no hand or arm assets are loaded.
 * Render in a separate depth-cleared group so the model cannot clip into walls.
 */
export class WeaponView {
  readonly root: TransformNode;
  private readonly pivot: TransformNode;
  private readonly rigs = new Map<string, Rig>();
  private desired:Partial<Equipment>={};
  private readonly cosmeticWork=new Map<string,Promise<void>>();
  private loaded=false;
  private disposed=false;
  private current: Rig | null = null;
  private flashLight: PointLight | null = null;
  private reticle: StandardMaterial | null = null;
  private readonly containers: AssetContainer[] = [];
  private flashTimer = 0;
  private throwTime = 0;
  throwGrenade(): void { this.throwTime = .36; }
  readonly motion = new WeaponMotion();
  private hidden = false;
  /** Dual daggers: how far the gun is lowered (0..1) and whether it is put away. */
  private meleeLower = 0;
  private meleeHidden = false;
  private savedNear: number | null = null;
  private readonly viewmodelProjection = Matrix.Identity();
  private readonly beforeGroup;
  private readonly afterGroup;
  /** Every weapon mesh: excluded from the sun by the game. */
  readonly meshes: AbstractMesh[] = [];
  /** Last frame's pose, for tests. */
  readonly debug = { action: 'idle' as WeaponAction, progress: 0, lower: 0, melee: 0, pump: 0, bolt: [0, 0] };

  constructor(
    private readonly ctx: RenderContext,
    private readonly materials: MaterialLibrary,
    private readonly effects: Effects | null,
  ) {
    const scene = ctx.scene;
    this.root = new TransformNode('weapon-root', scene);
    this.root.parent = ctx.camera;
    this.pivot = new TransformNode('weapon-pivot', scene);
    this.pivot.parent = this.root;
    scene.setRenderingAutoClearDepthStencil(WEAPON_RENDER_GROUP, true, true, false);
    // Share the eye/view transform (including lean and recoil), but give guns,
    // daggers and their effects a fixed horizontal projection. World FOV/ADS
    // still control gameplay and scope magnification, never model placement.
    this.beforeGroup = scene.onBeforeRenderingGroupObservable.add(info => {
      if (info.renderingGroupId !== WEAPON_RENDER_GROUP || scene.activeCamera !== ctx.camera) return;
      this.savedNear = ctx.camera.minZ; ctx.camera.minZ = .012;
      const engine = scene.getEngine();
      Matrix.PerspectiveFovRHToRef(VIEWMODEL_FOV, engine.getAspectRatio(ctx.camera), .012, ctx.camera.maxZ,
        this.viewmodelProjection, false, engine.isNDCHalfZRange, 0, engine.useReverseDepthBuffer);
      scene.setTransformMatrix(ctx.camera.getViewMatrix(), this.viewmodelProjection);
    });
    this.afterGroup = scene.onAfterRenderingGroupObservable.add(info => {
      if (info.renderingGroupId !== WEAPON_RENDER_GROUP || this.savedNear === null) return;
      ctx.camera.minZ = this.savedNear; this.savedNear = null;
      scene.setTransformMatrix(ctx.camera.getViewMatrix(), ctx.camera.getProjectionMatrix(true));
    });
  }

  async load(signal?: AbortSignal): Promise<void> {
    const scene = this.ctx.scene;
    const reticle = this.reticleMaterial(scene);
    this.reticle = reticle;
    await Promise.all(Object.values(RIG_CONFIGS).map((cfg) => this.loadRig(cfg, reticle, signal)));
    const light = new PointLight('muzzle-light', Vector3.Zero(), scene);
    light.diffuse = new Color3(1.0, 0.72, 0.38);
    light.specular = new Color3(0.5, 0.35, 0.2);
    light.range = 10;
    light.intensity = 0;
    this.flashLight = light;
    this.loaded=true;
    await this.setCosmetics({...defaultEquipment(),...this.desired});
    this.select('rifle');
  }

  private async loadRig(cfg: RigConfig, reticle: StandardMaterial, signal?: AbortSignal, cosmeticId?:string): Promise<void> {
    const scene = this.ctx.scene,item=visualCosmetic(cfg.id,cosmeticId);
    const c = await loadCosmeticAsset(item, scene, this.materials, signal);
    if(this.disposed){c.dispose();throw new DOMException('Weapon view disposed','AbortError');}
    this.containers.push(c);
    c.addAllToScene();
    const root = c.rootNodes[0] as TransformNode;
    root.parent = this.pivot;
    root.position.setAll(0);
    root.rotationQuaternion = Quaternion.Identity();
    const meshes: AbstractMesh[] = [];
    for (const m of c.meshes) {
      if (m.getTotalVertices() === 0) continue;
      const name = m.material?.name ?? '';
      if (name === 'reticle_holo') {
        m.material = reticle;
        m.alphaIndex = 1000;
      }
      this.prepare(m);
      meshes.push(m);
    }
    const node = (n: string) => c.transformNodes.find((t) => t.name === n) ?? (c.meshes.find((m) => m.name === n) as TransformNode | undefined) ?? null;
    const anchors = new Map<string, Vector3>();
    for (const t of c.transformNodes) {
      if (['muzzle', 'sight', 'eject', 'grip_r', 'grip_l', 'mag_grip', 'port', 'bolt_grip'].includes(t.name)) anchors.set(t.name, t.position.clone());
    }
    const muzzle = node('muzzle')!;
    const eject = node('eject')!;
    // The loose loading shell belongs to the removed hand animation.
    node('shell')?.setEnabled(false);
    const bolt = node('bolt');
    // the bolt turns about the bore axis
    if (bolt) bolt.setPivotPoint(new Vector3(0, anchors.get('muzzle')?.y ?? 0.06, 0));
    const flash = this.createFlash(scene, cfg.flash);
    flash.parent = muzzle;
    const rig: Rig = { cosmeticId:item.id,cfg, root, meshes, anchors, pump: node('pump'), bolt, muzzle, eject, flash };
    root.setEnabled(false);
    this.meshes.push(...meshes, ...flash.getChildMeshes(false), flash);
    this.rigs.set(item.id, rig);
  }

  private prepare(m: AbstractMesh): void {
    m.renderingGroupId = WEAPON_RENDER_GROUP;
    m.isPickable = false;
    m.receiveShadows = false;
    m.alwaysSelectAsActiveMesh = true;
  }

  private reticleMaterial(scene: Scene): StandardMaterial {
    const mat = new StandardMaterial('reticle-holo', scene);
    const tex = new Texture(assetUrl('assets/textures/weapons/reticle_holo.png'), scene);
    tex.hasAlpha = true;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(1.0, 0.25, 0.2);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.alphaMode = 1; // ALPHA_ADD: a holographic reticle only adds light
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    return mat;
  }

  private createFlash(scene: Scene, scale: number): Mesh {
    const mk = (name: string, file: string) => {
      const mat = new StandardMaterial(name, scene);
      const tex = new Texture(assetUrl(`assets/textures/shared/fx/${file}`), scene);
      tex.hasAlpha = true;
      mat.diffuseTexture = tex;
      mat.emissiveTexture = tex;
      mat.opacityTexture = tex;
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.disableLighting = true;
      mat.alphaMode = 1; // ALPHA_ADD
      mat.backFaceCulling = false;
      mat.fogEnabled = false;
      mat.disableDepthWrite = true;
      return mat;
    };
    const front = MeshBuilder.CreatePlane('flash-front', { size: 0.16 * scale }, scene);
    front.material = mk('muzzle-flash', 'muzzle_flash.png');
    const sideMat = mk('muzzle-flash-side', 'muzzle_flash_side.png');
    const root = new Mesh('flash', scene);
    front.parent = root;
    for (const roll of [0, Math.PI / 2]) {
      const side = MeshBuilder.CreatePlane('flash-side', { width: 0.3 * scale, height: 0.15 * scale }, scene);
      side.material = sideMat;
      // plume along -z (out of the muzzle): the texture's left edge sits at the muzzle
      side.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), roll).multiply(Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2));
      side.position.set(0, 0, -0.15 * scale * 0.95);
      side.parent = root;
    }
    for (const m of root.getChildMeshes(false)) {
      this.prepare(m);
      m.alphaIndex = 1001;
    }
    root.setEnabled(false);
    return root;
  }

  setCosmetic(weapon:WeaponId,id:string):Promise<void>{return this.setCosmetics({...defaultEquipment(),...this.desired,[weapon]:id});}
  async setCosmetics(equipment:Equipment):Promise<void>{
    this.desired={...equipment};for(const cfg of Object.values(RIG_CONFIGS))this.desired[cfg.id]=visualCosmetic(cfg.id,equipment[cfg.id]).id;if(!this.loaded||this.disposed)return;
    await Promise.all(Object.values(RIG_CONFIGS).map(cfg=>{const item=visualCosmetic(cfg.id,equipment[cfg.id]);if(this.rigs.has(item.id))return Promise.resolve();
      let work=this.cosmeticWork.get(item.id);if(!work){work=this.loadRig(cfg,this.reticle!,undefined,item.id).finally(()=>this.cosmeticWork.delete(item.id));this.cosmeticWork.set(item.id,work);}return work;}));
    if(!this.disposed&&this.currentId)this.select(this.currentId);
  }

  /** Show the weapon with this id (called when it is equipped). */
  select(id: WeaponId): void {
    const rig = this.rigs.get(this.desired[id]??defaultCosmetic(id));
    if (!rig || rig === this.current) return;
    this.current?.root.setEnabled(false);
    this.current?.flash.setEnabled(false);
    this.current = rig;
    this.motion.reset();
    rig.root.setEnabled(!this.hidden && !this.meleeHidden);
  }

  get currentId(): WeaponId | null {
    return this.current?.cfg.id ?? null;
  }

  /** World-space muzzle position. */
  muzzleWorld(): Vector3 {
    const n = this.current?.muzzle ?? this.pivot;
    n.computeWorldMatrix(true);
    return n.getAbsolutePosition().clone();
  }

  fire(): void {
    const rig = this.current;
    if (!rig) return;
    this.motion.fire(rig.cfg.kick*(rig.cfg.id==='sniper'?(WEAPONS.find(w=>w.id==='sniper')!.viewKick/16):1));
    this.flashTimer = 0.045;
    rig.flash.setEnabled(!this.hidden && !this.meleeHidden);
    rig.flash.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), Math.random() * Math.PI * 2);
    rig.flash.scaling.setAll(0.85 + Math.random() * 0.35);
    if (this.flashLight) {
      this.flashLight.position.copyFrom(this.muzzleWorld());
      this.flashLight.intensity = 5 * rig.cfg.flash;
    }
  }

  /** Debug: keep the muzzle flash on (checking its look in screenshots). */
  holdFlash(on: boolean): void {
    const rig = this.current;
    if (!rig) return;
    rig.flash.setEnabled(on);
    this.flashTimer = on ? 1e9 : 0;
  }

  /** Throw a spent case out of the ejection port (world space). */
  eject(carry: Vector3, ground: number): void {
    const rig = this.current;
    if (!rig || !this.effects) return;
    rig.eject.computeWorldMatrix(true);
    const m = rig.root.computeWorldMatrix(true);
    const right = Vector3.TransformNormal(Vector3.Right(), m).normalize();
    const up = Vector3.TransformNormal(Vector3.Up(), m).normalize();
    const back = Vector3.TransformNormal(Vector3.Backward(), m).normalize();
    this.effects.ejectCasing(rig.cfg.casing, rig.eject.getAbsolutePosition().clone(), right, up, back, carry, ground);
  }

  addSway(dx: number, dy: number): void {
    this.motion.addSway(dx, dy);
  }

  land(speed: number): void { this.motion.land(speed); }

  setVisible(v: boolean): void {
    this.root.setEnabled(v);
    if (!v) this.throwTime = 0;
  }

  /** Hide the weapon (scoped sniper view) without stopping the animation. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.current?.root.setEnabled(!hidden && !this.meleeHidden);
    if (hidden) this.current?.flash.setEnabled(false);
  }

  /** Dual daggers (MeleeView): the gun lowers out of view and is put away; switching back it
   * rises from the same lowered pose. Cosmetic only; the weapon state machine is untouched. */
  setMelee(lower: number, visible: boolean): void {
    this.meleeLower = Math.max(0, Math.min(1, lower));
    if (visible === !this.meleeHidden) return;
    this.meleeHidden = !visible;
    this.current?.root.setEnabled(!this.hidden && visible);
    if (!visible) this.current?.flash.setEnabled(false);
  }



  update(
    dt: number,
    w: Weapon,
    s: Omit<MotionInput, 'ads'>,
  ): void {
    const rig = this.current;
    if (!rig) return;
    const pose = this.pose(rig, w);
    this.throwTime = Math.max(0, this.throwTime - dt);
    const throwLower = Math.sin(Math.PI * (1 - this.throwTime / .36)) * .20;
    const ads = smooth(w.ads);
    const motion = this.motion.update(dt, { ...s, ads });
    const sight = rig.anchors.get('sight') ?? Vector3.Zero();
    const hip = v3(rig.cfg.hip);
    hip.y += .105; // The former low hip framing put grips below the viewport.
    const adsPos = new Vector3(-sight.x, -sight.y, -rig.cfg.eye - sight.z);
    const pos = Vector3.Lerp(hip, adsPos, ads);
    pos.x += motion.x;
    pos.y += motion.y - throwLower;
    pos.z += motion.z;
    const hr = rig.cfg.hipRot;
    let rx = motion.pitch + hr[0] * (1 - ads);
    let ry = motion.yaw + hr[1] * (1 - ads);
    let rz = motion.roll + hr[2] * (1 - ads);
    const wp = this.meleeLower > 0 ? pose.weapon.map((v, i) => v + DOWN[i] * smooth(this.meleeLower)) : pose.weapon;
    pos.x += wp[0];
    pos.y += wp[1];
    pos.z += wp[2];
    rx += wp[3];
    ry += wp[4];
    rz += wp[5];
    this.pivot.position.copyFrom(pos);
    this.pivot.rotationQuaternion = Quaternion.RotationYawPitchRoll(ry, rx, rz);

    // moving parts
    if (rig.pump) rig.pump.position.z = pose.pump;
    if (rig.bolt) {
      rig.bolt.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), pose.bolt[0]);
      rig.bolt.position.z = pose.bolt[1];
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        rig.flash.setEnabled(false);
        if (this.flashLight) this.flashLight.intensity = 0;
      }
    }
    Object.assign(this.debug, {
      action: w.action,
      progress: w.progress,
      lower: -wp[1] + throwLower, melee: this.meleeLower,
      pump: pose.pump,
      bolt: pose.bolt,
    });
  }

  // --- animation -----------------------------------------------------------------------------
  private pose(rig: Rig, w: Weapon): Pose {
    const p = w.progress;
    const out: Pose = { weapon: ZERO6, pump: 0, bolt: [0, 0] };
    const action = w.action;
    if (action === 'equip') out.weapon = mulS(DOWN, 1 - smooth(p));
    else if (action === 'holster' || action === 'holstered') out.weapon = mulS(DOWN, action === 'holstered' ? 1 : smooth(p));
    else if (action === 'cycle') this.cyclePose(rig, p, out);
    else {
      const r = w.stats.reload;
      let lower = 0;
      // A short 180 ms movement at each end; gameplay reload durations and cues stay in Weapon.
      if ((action === 'reload' || action === 'reloadEmpty') && r.kind === 'magazine') {
        const duration = action === 'reloadEmpty' ? r.emptyTime : r.time;
        lower = Math.min(smooth(p * duration / 0.18), smooth((1 - p) * duration / 0.18));
      } else if (r.kind === 'shells') {
        // Stay lowered across successive shells so shell boundaries never snap the model up.
        if (action === 'shellStart') lower = smooth(p * r.start / 0.18);
        else if (action === 'shell') lower = 1;
        else if (action === 'shellEnd') lower = 1 - smooth(p * r.end / 0.18);
      }
      out.weapon = [0, -0.24 * lower, 0.035 * lower, -0.12 * lower, 0, 0];
    }
    return out;
  }

  /** Pump stroke (shotgun) or bolt cycle (sniper) after a shot. */
  private cyclePose(rig: Rig, p: number, out: Pose): void {
    if (rig.pump) {
      const z = sample([[0, [0]], [0.12, [0]], [0.36, [0.085]], [0.46, [0.085]], [0.68, [0]], [1, [0]]], p)[0];
      out.pump = z;
      out.weapon = sample([[0, ZERO6], [0.3, [0, -0.012, 0.012, 0.05, 0.03, 0.06]], [0.7, [0, -0.008, 0.006, 0.02, 0.02, 0.03]], [1, ZERO6]], p);
    } else if (rig.bolt) {
      this.boltPose(p, out);
      out.weapon = sample([[0, ZERO6], [0.15, [0.0, 0.0, 0.01, 0.06, 0.1, 0.22]], [0.85, [0.0, 0.0, 0.01, 0.06, 0.1, 0.22]], [1, ZERO6]], p);
    }
  }

  /** Preserve the sniper bolt cycle without a hand animation. */
  private boltPose(p: number, out: Pose): void {
    const [rot, back] = sample([[0, [0, 0]], [0.18, [0, 0]], [0.3, [1.05, 0]], [0.5, [1.05, 0.09]], [0.56, [1.05, 0.09]], [0.7, [1.05, 0]], [0.8, [0, 0]], [1, [0, 0]]], p) as [number, number];
    out.bolt = [rot, back];
  }

  dispose(): void {
    this.disposed=true;
    this.ctx.scene.onBeforeRenderingGroupObservable.remove(this.beforeGroup);
    this.ctx.scene.onAfterRenderingGroupObservable.remove(this.afterGroup);
    this.flashLight?.dispose();
    for (const container of this.containers) container.dispose();
    this.containers.length = 0;
    this.root.dispose(false, false);
    this.reticle?.dispose(false, true);
  }
}
