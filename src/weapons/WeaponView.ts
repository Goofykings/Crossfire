import {
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  MeshBuilder,
  PointLight,
  Quaternion,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type Scene,
} from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { RenderContext } from '../rendering/RenderContext';

export const WEAPON_RENDER_GROUP = 1;
const HIP = new Vector3(0.2, -0.235, -0.44);
const SPRINT_ROT = new Vector3(-0.18, 0.5, 0.15);
const ADS_EYE_DISTANCE = 0.3;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * First-person weapon model: hip/ADS poses, sway, bob, recoil, reload and sprint animation and a
 * muzzle flash. Rendered in its own rendering group with a cleared depth buffer so it never clips
 * into walls.
 */
export class WeaponView {
  readonly root: TransformNode;
  private readonly pivot: TransformNode;
  private muzzle: TransformNode | null = null;
  private sight = new Vector3(0, 0.178, -0.13);
  private flash: Mesh | null = null;
  private flashLight: PointLight | null = null;
  private flashTimer = 0;
  private swayX = 0;
  private swayY = 0;
  private kick = 0;
  private kickVel = 0;
  private sprint = 0;
  readonly meshes: AbstractMesh[] = [];

  constructor(
    private readonly ctx: RenderContext,
    private readonly materials: MaterialLibrary,
  ) {
    const scene = ctx.scene;
    this.root = new TransformNode('weapon-root', scene);
    this.root.parent = ctx.camera;
    this.pivot = new TransformNode('weapon-pivot', scene);
    this.pivot.parent = this.root;
    scene.setRenderingAutoClearDepthStencil(WEAPON_RENDER_GROUP, true, true, false);
  }

  async load(): Promise<void> {
    const scene = this.ctx.scene;
    const c = await LoadAssetContainerAsync(assetUrl('assets/models/shared/weapons/blaster.glb'), scene);
    c.addAllToScene();
    const top = c.rootNodes[0] as TransformNode;
    top.parent = this.pivot;
    top.position.setAll(0);
    top.rotationQuaternion = Quaternion.Identity();
    for (const m of c.meshes) {
      if (m.material) m.material = this.materials.get(m.material.name);
      m.renderingGroupId = WEAPON_RENDER_GROUP;
      m.isPickable = false;
      m.receiveShadows = false;
      this.meshes.push(m);
    }
    this.muzzle = c.transformNodes.find((n) => n.name === 'muzzle') ?? null;
    const sightNode = c.transformNodes.find((n) => n.name === 'sight');
    if (sightNode) {
      top.computeWorldMatrix(true);
      this.sight = sightNode.position.clone();
    }
    this.createFlash(scene);
  }

  private createFlash(scene: Scene): void {
    const mat = new StandardMaterial('muzzle-flash', scene);
    const tex = new Texture(assetUrl('assets/textures/shared/fx/muzzle_flash.png'), scene);
    tex.hasAlpha = true;
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.alphaMode = 1; // ALPHA_ADD
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    const a = MeshBuilder.CreatePlane('flash-a', { size: 0.22 }, scene);
    const b = MeshBuilder.CreatePlane('flash-b', { size: 0.2 }, scene);
    b.rotation.y = Math.PI / 2;
    const cBill = MeshBuilder.CreatePlane('flash-c', { size: 0.16 }, scene);
    cBill.rotation.x = Math.PI / 2;
    const flash = Mesh.MergeMeshes([a, b, cBill], true)!;
    flash.material = mat;
    flash.renderingGroupId = WEAPON_RENDER_GROUP;
    flash.isPickable = false;
    flash.parent = this.muzzle ?? this.pivot;
    flash.position.set(0, 0, this.muzzle ? -0.05 : -0.6);
    flash.setEnabled(false);
    this.flash = flash;
    const light = new PointLight('muzzle-light', Vector3.Zero(), scene);
    light.diffuse = new Color3(0.4, 0.9, 1.0);
    light.specular = new Color3(0.2, 0.5, 0.6);
    light.range = 9;
    light.intensity = 0;
    light.parent = this.muzzle ?? this.pivot;
    this.flashLight = light;
  }

  /** World-space muzzle position (beam origin for tracers). */
  muzzleWorld(): Vector3 {
    const n = this.muzzle ?? this.pivot;
    n.computeWorldMatrix(true);
    return n.getAbsolutePosition().clone();
  }

  fire(): void {
    this.kickVel += 7.5;
    this.flashTimer = 0.05;
    if (this.flash) {
      this.flash.setEnabled(true);
      this.flash.rotation.z = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.5;
      this.flash.scaling.setAll(s);
    }
    if (this.flashLight) this.flashLight.intensity = 6;
  }

  addSway(dx: number, dy: number): void {
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX - dx * 0.00011));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY + dy * 0.00011));
  }

  setVisible(v: boolean): void {
    this.root.setEnabled(v);
  }

  update(
    dt: number,
    s: { ads: number; reloadProgress: number; reloading: boolean; sprinting: boolean; bobX: number; bobY: number; crouch: number },
  ): void {
    // springs
    this.kickVel += (-this.kick * 300 - this.kickVel * 24) * dt;
    this.kick += this.kickVel * dt;
    this.swayX *= Math.exp(-dt * 9);
    this.swayY *= Math.exp(-dt * 9);
    this.sprint += ((s.sprinting ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);

    const ads = smooth(s.ads);
    const adsPos = new Vector3(-this.sight.x, -this.sight.y, -ADS_EYE_DISTANCE - this.sight.z);
    const pos = Vector3.Lerp(HIP, adsPos, ads);
    const swayK = 1 - ads * 0.8;
    pos.x += (this.swayX + s.bobX * 0.6) * swayK;
    pos.y += (this.swayY + s.bobY * 0.7) * swayK - s.crouch * 0.01;
    pos.z += this.kick * 0.035;
    let rx = -this.kick * 0.09 * (1 - ads * 0.5) + this.swayY * 1.5;
    let ry = this.swayX * 1.6;
    let rz = this.swayX * 1.2;
    // sprint pose
    rx += SPRINT_ROT.x * this.sprint;
    ry += SPRINT_ROT.y * this.sprint;
    rz += SPRINT_ROT.z * this.sprint;
    pos.x -= 0.03 * this.sprint;
    pos.y -= 0.04 * this.sprint;
    // reload: dip, roll and come back
    if (s.reloading) {
      const t = s.reloadProgress;
      const k = t < 0.2 ? smooth(t / 0.2) : t > 0.8 ? smooth((1 - t) / 0.2) : 1;
      rx -= 0.45 * k;
      rz += 0.6 * k;
      pos.y -= 0.09 * k;
      pos.z += 0.04 * k;
      // a little "cell seating" bump in the middle
      if (t > 0.5 && t < 0.62) pos.y += Math.sin(((t - 0.5) / 0.12) * Math.PI) * 0.02;
    }
    this.pivot.position.copyFrom(pos);
    this.pivot.rotationQuaternion = Quaternion.RotationYawPitchRoll(ry, rx, rz);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash?.setEnabled(false);
        if (this.flashLight) this.flashLight.intensity = 0;
      }
    }
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
