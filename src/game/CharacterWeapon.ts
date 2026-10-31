import { BoneIKController, Matrix, Mesh, Quaternion, Space, TransformNode, Vector3, type AssetContainer, type InstantiatedEntries, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { loadContainer } from '../core/loadContainer';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { WeaponId } from '../weapons/Weapon';
import { RIG_CONFIGS } from '../weapons/WeaponView';
import type { CharacterInstance } from './CharacterAsset';

/** Local preview-only pose, expressed in character and weapon coordinates. */
export interface CharacterHoldPose {
  offset: [number, number, number]; yaw: number; pitch: number;
  elbows: [[number, number, number], [number, number, number]];
  hands: [[number, number, number], [number, number, number]];
}

/** Scene-local copies of the same GLBs used by the first-person weapon view. */
export class CharacterWeaponLibrary {
  private readonly containers = new Map<WeaponId, AssetContainer>();
  private readonly pending = new Map<WeaponId, Promise<void>>();
  constructor(private readonly scene: Scene, private readonly materials: MaterialLibrary) {}
  load(id: WeaponId, signal?: AbortSignal): Promise<void> {
    if (this.containers.has(id)) return Promise.resolve();
    const pending = this.pending.get(id);
    if (pending) return pending;
    const work = loadContainer(assetUrl(RIG_CONFIGS[id].file), this.scene, signal).then((container) => {
      if (signal?.aborted || this.scene.isDisposed) { container.dispose(); return; }
      for (const mesh of container.meshes) if (mesh.material) mesh.material = this.materials.get(mesh.material.name);
      this.containers.set(id, container);
    }).finally(() => { if (this.pending.get(id) === work) this.pending.delete(id); });
    this.pending.set(id, work);
    return work;
  }
  create(character: CharacterInstance, id: WeaponId): CharacterWeapon | null {
    const container = this.containers.get(id);
    return container ? new CharacterWeapon(this.scene, character, id, container) : null;
  }
}

/** Cosmetic upper-body pose; server collision and the first-person weapon are untouched. */
export class CharacterWeapon {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  private readonly entries: InstantiatedEntries;
  private readonly arms: BoneIKController[] = [];
  private readonly armRig: { upper: TransformNode; forearm: TransformNode; hand: TransformNode; target: TransformNode }[] = [];
  private readonly armNodes: TransformNode[] = [];
  private readonly poles: TransformNode[] = [];
  private readonly saved = new Map<TransformNode, Quaternion>();
  private readonly chest: TransformNode | null;
  private readonly head: TransformNode | null;
  private readonly grips: TransformNode[];
  private ads = 0;
  private pitch = 0;
  private yaw = 0;
  private homePose: CharacterHoldPose | null = null;

  constructor(scene: Scene, private readonly character: CharacterInstance, readonly id: WeaponId, container: AssetContainer) {
    this.root = new TransformNode(`held:${id}`, scene);
    this.root.parent = character.root;
    this.root.scaling.setAll(.85);
    this.entries = container.instantiateModelsToScene((name) => `held:${id}:${name}`, false, { doNotInstantiate: true });
    for (const root of this.entries.rootNodes) root.parent = this.root;
    this.meshes = this.root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const mesh of this.meshes) { mesh.isPickable = false; mesh.renderingGroupId = 0; }
    const nodes = this.root.getChildTransformNodes(false);
    // This loose reload prop is animated only in the first-person view.
    nodes.find((n) => n.name === `held:${id}:shell`)?.setEnabled(false);
    this.grips = ['grip_r', 'grip_l'].map((name) => nodes.find((n) => n.name === `held:${id}:${name}`)!).filter(Boolean);
    const bones = character.entries.skeletons[0].bones;
    this.chest = bones.find((b) => b.name === 'chest')?.getTransformNode() ?? null;
    this.head = bones.find((b) => b.name === 'head')?.getTransformNode() ?? null;
    for (const [index, side] of ['r', 'l'].entries()) {
      const upper = bones.find((b) => b.name === `upper_arm_${side}`);
      const forearm = bones.find((b) => b.name === `forearm_${side}`);
      const hand = bones.find((b) => b.name === `hand_${side}`)?.getTransformNode();
      const target = this.grips[index];
      const upperNode = upper?.getTransformNode(), forearmNode = forearm?.getTransformNode();
      if (!upper || !forearm || !upperNode || !forearmNode || !hand || !target) continue;
      this.armNodes.push(upperNode, forearmNode, hand);
      this.armRig.push({ upper: upperNode, forearm: forearmNode, hand, target });
      const pole = new TransformNode(`held:${id}:elbow-${side}`, scene);
      pole.parent = character.root; pole.position.set(side === 'r' ? .45 : -.45, .7, -.05);
      this.poles.push(pole);
      this.arms.push(new BoneIKController(character.meshes[0], forearm, { targetMesh: target, poleTargetMesh: pole }));
    }
  }
  setPose(pitch: number, ads: number, yaw = 0): void { this.pitch = pitch; this.yaw = yaw; this.ads = Math.max(0, Math.min(1, ads)); }
  setHomePose(pose: CharacterHoldPose): void { this.homePose = pose; }
  restore(): void {
    for (const [node, rotation] of this.saved) node.rotationQuaternion?.copyFrom(rotation);
    this.saved.clear();
  }
  update(): void {
    if (!this.chest) return;
    for (const node of [...this.armNodes, this.chest, this.head]) if (node?.rotationQuaternion) this.saved.set(node, node.rotationQuaternion.clone());
    this.character.root.computeWorldMatrix(true);
    const axis = Vector3.TransformNormal(Vector3.Right(), this.character.root.getWorldMatrix()).normalize();
    this.chest.rotate(axis, this.pitch * .16, Space.WORLD);
    this.head?.rotate(axis, this.pitch * .2, Space.WORLD);
    this.chest.computeWorldMatrix(true);
    const inverse = Matrix.Invert(this.character.root.getWorldMatrix());
    const chest = Vector3.TransformCoordinates(this.chest.getAbsolutePosition(), inverse);
    const offset = this.homePose?.offset ?? [.08 - .03 * this.ads, -.02 + .16 * this.ads, -.13];
    this.root.position.set(chest.x + offset[0], chest.y + offset[1], chest.z + offset[2]);
    this.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(this.homePose?.yaw ?? this.yaw, this.homePose?.pitch ?? this.pitch, 0);
    this.root.computeWorldMatrix(true);
    for (const grip of this.grips) grip.computeWorldMatrix(true);
    if (this.homePose) this.poseHomeArms(this.homePose);
    else for (const arm of this.arms) arm.update();
  }
  private poseHomeArms(pose: CharacterHoldPose): void {
    const rotateToward = (node: TransformNode, current: Vector3, target: Vector3) => {
      if (current.lengthSquared() < 1e-8 || target.lengthSquared() < 1e-8) return;
      current.normalize(); target.normalize();
      const axis = Vector3.Cross(current, target), length = axis.length();
      if (length < 1e-6) return;
      node.parent?.computeWorldMatrix(true);
      node.rotate(axis.scale(1 / length), Math.atan2(length, Vector3.Dot(current, target)), Space.WORLD);
      node.computeWorldMatrix(true);
    };
    for (const [index, arm] of this.armRig.entries()) {
      arm.upper.computeWorldMatrix(true); arm.forearm.computeWorldMatrix(true); arm.hand.computeWorldMatrix(true);
      const shoulder = arm.upper.getAbsolutePosition().clone(), elbow = arm.forearm.getAbsolutePosition().clone();
      const wrist = arm.hand.getAbsolutePosition().clone(), target = arm.target.getAbsolutePosition().clone();
      const upperLength = Vector3.Distance(shoulder, elbow), lowerLength = Vector3.Distance(elbow, wrist);
      const delta = target.subtract(shoulder), distance = Math.min(delta.length(), upperLength + lowerLength - .001);
      if (distance < .001) continue;
      const direction = delta.normalize();
      const along = Math.max(-upperLength, Math.min(upperLength, (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance)));
      const pole = Vector3.TransformCoordinates(Vector3.FromArray(pose.elbows[index]), this.character.root.getWorldMatrix()).subtract(shoulder);
      const bend = pole.subtract(direction.scale(Vector3.Dot(pole, direction))).normalize();
      const wantedElbow = shoulder.add(direction.scale(along)).addInPlace(bend.scale(Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2))));
      rotateToward(arm.upper, elbow.subtract(shoulder), wantedElbow.subtract(shoulder));
      arm.forearm.computeWorldMatrix(true); arm.hand.computeWorldMatrix(true);
      const actualElbow = arm.forearm.getAbsolutePosition().clone();
      rotateToward(arm.forearm, arm.hand.getAbsolutePosition().subtract(actualElbow), target.subtract(actualElbow));
      arm.hand.computeWorldMatrix(true);
      const handDirection = Vector3.TransformNormal(Vector3.Up(), arm.hand.getWorldMatrix());
      const wantedHand = Vector3.TransformNormal(Vector3.FromArray(pose.hands[index]), this.root.getWorldMatrix());
      rotateToward(arm.hand, handDirection, wantedHand);
    }
  }
  inspect() { return { id: this.id, ads: this.ads, pitch: this.pitch, meshes: this.meshes.length,
    instances: this.character.root.getChildTransformNodes(true).filter((n) => /^held:(rifle|smg|shotgun|sniper)$/.test(n.name)).length,
    grips: this.grips.map((g) => g.getAbsolutePosition().asArray()) }; }
  dispose(): void { this.restore(); for (const pole of this.poles) pole.dispose(); this.entries.dispose(); this.root.dispose(); }
}
