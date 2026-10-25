import {
  LoadAssetContainerAsync,
  Matrix,
  Quaternion,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type AssetContainer,
  type InstancedMesh,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import type { TargetPlacement } from '../maps/types';
import type { Collider, CollisionWorld } from '../physics/CollisionWorld';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { Damageable, DamageInfo } from './Damage';
import type { Point3 } from './SafeZones';

const DEG = Math.PI / 180;
/** Height of the plate hinge above the target's base (matches blender props.target_parts). */
const HINGE_Y = 0.92;
const PLATE_CENTER_Y = 0.47;
const PLATE_RADIUS = 0.42;
const DOWN_TIME = 3.0;

type TargetState = 'up' | 'falling' | 'down' | 'rising';

/** A static practice target: tips backwards when knocked down, resets automatically. */
export class PracticeTarget implements Damageable {
  readonly bodyRadius = 0.45;
  health = 100;
  state: TargetState = 'up';
  private tilt = 0; // radians, 0 = upright, -PI/2 = flat on its back
  private wobble = 0;
  private wobbleVel = 0;
  private timer = 0;
  readonly hinge: TransformNode;
  readonly plateCollider: Collider;
  readonly baseCollider: Collider;
  private readonly center: Point3;
  private readonly forward: { x: number; z: number };
  onStateChange: ((t: PracticeTarget, s: TargetState) => void) | null = null;

  constructor(
    readonly id: string,
    readonly root: TransformNode,
    hinge: TransformNode,
    world: CollisionWorld,
    placement: TargetPlacement,
  ) {
    this.hinge = hinge;
    const [x, y, z] = placement.pos;
    const yaw = -placement.heading * DEG;
    this.forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    this.center = { x, y: y + HINGE_Y + PLATE_CENTER_Y, z };
    this.plateCollider = world.add(
      { c: [x, this.center.y, z], h: [PLATE_RADIUS, PLATE_RADIUS + 0.03, 0.05], yaw, tag: `target:${id}` },
      { solid: false, shootable: true, userData: this },
    );
    this.baseCollider = world.add(
      { c: [x, y + 0.5, z], h: [0.3, 0.5, 0.25], yaw, tag: `target-stand:${id}` },
      { solid: true, shootable: true },
    );
  }

  get alive(): boolean {
    return this.state === 'up' && this.health > 0;
  }

  position(): Point3 {
    return this.center;
  }

  /** 'bullseye' when the hit lands in the yellow centre. */
  zoneAt(p: Point3): string {
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const dz = p.z - this.center.z;
    return Math.hypot(dx, dy, dz) < 0.075 ? 'bullseye' : 'body';
  }

  applyDamage(amount: number, info: DamageInfo): void {
    if (this.state !== 'up') return;
    this.health -= amount;
    // impulse: tip back a little in proportion to damage
    this.wobbleVel -= 2.5 + amount * 0.06;
    void info;
    if (this.health <= 0) {
      this.state = 'falling';
      this.plateCollider.shootable = false;
      this.onStateChange?.(this, this.state);
    }
  }

  update(dt: number): void {
    switch (this.state) {
      case 'up': {
        // damped spring wobble
        this.wobbleVel += (-this.wobble * 160 - this.wobbleVel * 9) * dt;
        this.wobble += this.wobbleVel * dt;
        this.tilt = this.wobble;
        break;
      }
      case 'falling':
        this.tilt -= dt * 9;
        if (this.tilt <= -Math.PI / 2) {
          this.tilt = -Math.PI / 2;
          this.state = 'down';
          this.timer = DOWN_TIME;
        }
        break;
      case 'down':
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'rising';
        break;
      case 'rising':
        this.tilt += dt * 3;
        if (this.tilt >= 0) {
          this.tilt = 0;
          this.wobble = 0;
          this.wobbleVel = -1.5;
          this.state = 'up';
          this.health = 100;
          this.plateCollider.shootable = true;
          this.onStateChange?.(this, this.state);
        }
        break;
    }
    this.hinge.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), this.tilt);
  }

  get facing(): { x: number; z: number } {
    return this.forward;
  }
}

export class TargetSystem {
  readonly targets: PracticeTarget[] = [];
  private container: AssetContainer | null = null;
  private readonly roots: TransformNode[] = [];
  readonly meshes: AbstractMesh[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly materials: MaterialLibrary,
  ) {}

  async load(placements: TargetPlacement[]): Promise<void> {
    const container = await LoadAssetContainerAsync(assetUrl('assets/models/shared/props/target.glb'), this.scene);
    this.container = container;
    container.addAllToScene();
    const sources = container.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];
    // which source meshes belong to the plate (child of the node named "plate")
    const isPlate = (m: AbstractMesh) => {
      for (let n: TransformNode | null = m as unknown as TransformNode; n; n = n.parent as TransformNode | null) {
        if (n.name === 'plate') return true;
      }
      return false;
    };
    for (const s of sources) {
      if (s.material) s.material = this.materials.get(s.material.name);
      const world = s.computeWorldMatrix(true).clone();
      s.setParent(null);
      // keep only the mesh-local part of the transform (plate meshes relative to the hinge)
      const local = isPlate(s) ? world.multiply(Matrix.Translation(0, -HINGE_Y, 0)) : world;
      s.bakeTransformIntoVertices(local);
      s.position.setAll(0);
      s.rotationQuaternion = Quaternion.Identity();
      s.scaling.setAll(1);
      s.isVisible = false;
      s.isPickable = false;
    }
    for (const n of container.transformNodes) n.dispose();

    for (const p of placements) {
      const root = new TransformNode(`target:${p.id}`, this.scene);
      root.position.set(p.pos[0], p.pos[1], p.pos[2]);
      root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -p.heading * DEG);
      const hinge = new TransformNode(`target-hinge:${p.id}`, this.scene);
      hinge.parent = root;
      hinge.position.set(0, HINGE_Y, 0);
      for (const s of sources) {
        const inst: InstancedMesh = s.createInstance(`${s.name}:${p.id}`);
        inst.parent = isPlate(s) ? hinge : root;
        inst.isPickable = false;
        this.meshes.push(inst);
      }
      this.roots.push(root);
      this.targets.push(new PracticeTarget(p.id, root, hinge, this.world, p));
    }
  }

  find(collider: Collider): PracticeTarget | null {
    return collider.userData instanceof PracticeTarget ? collider.userData : null;
  }

  update(dt: number): void {
    for (const t of this.targets) t.update(dt);
  }

  dispose(): void {
    for (const t of this.targets) {
      this.world.remove(t.plateCollider);
      this.world.remove(t.baseCollider);
    }
    for (const r of this.roots) r.dispose(false, false);
    this.container?.dispose();
    this.targets.length = 0;
  }
}
