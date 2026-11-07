import { Matrix, Mesh, Quaternion, Space, TransformNode, Vector3, type InstantiatedEntries } from '@babylonjs/core';
import { ArmChain } from '../game/CharacterWeapon';
import { CharacterMelee, WRIST_TO_PALM, type MeleeLibrary } from '../game/melee/MeleeAssets';
import { shoulderReach, type MeleeClipName, type MeleeStage } from '../game/melee/MeleeAnimation';
import type { RenderContext } from '../rendering/RenderContext';
import { WEAPON_RENDER_GROUP } from './WeaponView';
import {meleeClip,type MeleeState} from '../../shared/melee';

/** Sway/bob pose of the existing view-model motion layer (WeaponMotion.pose). */
export interface ViewMotion { x: number; y: number; z: number; pitch: number; yaw: number; roll: number }

const s = {
  pos: Vector3.Zero(), fingers: Vector3.Zero(), back: Vector3.Zero(), wrist: Vector3.Zero(), pole: Vector3.Zero(),
  tmp: Vector3.Zero(), q: new Quaternion(), qw: new Quaternion(), body: new Quaternion(), axis: Vector3.Zero(), m: new Matrix(),
  identity: Quaternion.Identity(),
};

/** First-person dual daggers: the player's own arms and gloves (melee_arms.glb, the unchanged
 * 26-joint rig) on the camera, posed by the same clips and two-bone ArmChain IK as third
 * person. The whole shoulder rig is placed relative to the eye (daggers.json firstPerson), so
 * arm geometry and wrists match third person exactly. Renders in the depth-isolated weapon
 * group. Purely cosmetic: it never changes aim, camera or gameplay timing. */
export class MeleeView {
  readonly root: TransformNode;
  /** Shoulder midpoint: sway and the clip's torso channel rotate the rig about it. */
  private readonly pivot: TransformNode;
  private readonly rig: TransformNode;
  private entries: InstantiatedEntries | null = null;
  private melee: CharacterMelee | null = null;
  private readonly arms: ArmChain[] = [];
  private readonly clavicles: { node: TransformNode; rest: Quaternion; side: 1 | -1 }[] = [];
  /** Spine joints from the rig root to the chest, refreshed top-down after the pivot moves
   * (Babylon caches world matrices once per render). */
  private readonly spine: TransformNode[] = [];
  private readonly meshList: Mesh[] = [];
  private visible = true;
  private paused = false;
  private loaded: Promise<void> | null = null;
  private syncKey='';
  sync(state:MeleeState,now:number):string|null {
    const clip=meleeClip(state) as MeleeClipName|null,key=`${clip}:${state.startedAt}:${state.sequence}`;
    if(!this.melee||key===this.syncKey)return null;
    if(!clip){this.reset();this.syncKey=key;return null;}this.syncKey=key;
    this.melee.animator.play(clip,Math.max(0,(now-state.startedAt)/1000));this.melee.advance(0);return clip;
  }
  setCosmetic(id?:string):Promise<void> {return this.melee?.pair.setCosmetic(id)??Promise.resolve();}

  constructor(private readonly ctx: RenderContext, private readonly library: MeleeLibrary) {
    this.root = new TransformNode('melee-view', ctx.scene);
    this.root.parent = ctx.camera;
    this.pivot = new TransformNode('melee-view:shoulders', ctx.scene);
    this.pivot.parent = this.root;
    this.pivot.rotationQuaternion = Quaternion.Identity();
    this.rig = new TransformNode('melee-view:rig', ctx.scene);
    this.rig.parent = this.pivot;
    this.root.setEnabled(false);
  }

  load(signal?: AbortSignal): Promise<void> {
    this.loaded ??= this.performLoad(signal).catch((error) => { this.loaded = null; throw error; });
    return this.loaded;
  }
  private async performLoad(signal?: AbortSignal): Promise<void> {
    await this.library.loadArms(signal);
    const entries = this.library.instantiateArms('melee-view:arms'), melee = this.library.createCharacterMelee('melee-view');
    if (!entries || !melee) throw new Error('Melee assets are not loaded');
    this.entries = entries; this.melee = melee;
    for (const node of entries.rootNodes) node.parent = this.rig;
    const skeleton = entries.skeletons[0], bones = skeleton.bones;
    const find = (name: string) => bones.find((b) => b.name === name)!;
    for (const name of ['root', 'pelvis', 'spine', 'chest']) { const node = find(name)?.getTransformNode(); if (node) this.spine.push(node); }
    for (const [side, suffix] of [[1, 'r'], [-1, 'l']] as const) {
      const chain = [find(`upper_arm_${suffix}`), find(`forearm_${suffix}`), find(`hand_${suffix}`)];
      this.arms.push(new ArmChain(chain[0].getTransformNode()!, chain[1].getTransformNode()!, chain[2].getTransformNode()!,
        chain as [typeof chain[0], typeof chain[0], typeof chain[0]], side));
      const clavicle = find(`clavicle_${suffix}`).getTransformNode()!;
      clavicle.rotationQuaternion ??= Quaternion.Identity();
      this.clavicles.push({ node: clavicle, rest: clavicle.rotationQuaternion.clone(), side });
    }
    // The rig's own shoulder midpoint sits on the pivot (bind pose, before any IK).
    this.rig.computeWorldMatrix(true);
    for (const node of this.rig.getChildTransformNodes(false)) node.computeWorldMatrix(true);
    const inverse = Matrix.Invert(this.rig.getWorldMatrix());
    const mid = Vector3.TransformCoordinates(this.arms[0].upper.getAbsolutePosition().add(this.arms[1].upper.getAbsolutePosition()).scale(.5), inverse);
    this.rig.position.copyFrom(mid.negate());
    const fp = melee.pair.meta.firstPerson;
    this.root.position.set(fp.shoulders[0], fp.shoulders[1], fp.shoulders[2]);
    for (const mesh of [...entries.rootNodes.flatMap((n) => n.getChildMeshes(false)), ...melee.pair.meshes]) {
      if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
      mesh.renderingGroupId = WEAPON_RENDER_GROUP; mesh.isPickable = false; mesh.receiveShadows = false;
      mesh.alwaysSelectAsActiveMesh = true;
      this.meshList.push(mesh);
    }
    melee.pair.bind([this.arms[0].hand, this.arms[1].hand], [this.arms[0].handAxes(), this.arms[1].handAxes()]);
    await this.library.whenReady(signal);
  }

  /** Every first-person melee mesh: excluded from the sun like the gun view-model. */
  get meshes(): Mesh[] { return this.meshList; }
  get ready(): boolean { return !!this.melee; }
  get state() { return this.melee?.animator.state ?? 'hidden'; }
  /** Gun presentation for WeaponView while the daggers are out. */
  get gunLower(): number { return this.melee?.pose.gunLower ?? 0; }
  get gunVisible(): boolean { return this.melee?.pose.gunVisible ?? true; }
  equip(): void { this.melee?.animator.equip(); }
  unequip(): void { this.melee?.animator.unequip(); }
  attack(stage?: MeleeStage): MeleeStage | null { return this.melee?.animator.attack(stage) ?? null; }
  play(clip: MeleeClipName, time = 0): void { this.melee?.animator.play(clip, time); }
  /** Death, respawn or round reset: daggers gone, gun back immediately. */
  reset(): void { this.syncKey='';this.melee?.animator.reset(); this.melee?.advance(0); }
  /** Test hook: hold a clip at a time (no advancing) for repeatable screenshots; null resumes. */
  freeze(clip: MeleeClipName | null, time = 0): void {
    this.paused = !!clip;
    // Reset first: play() would otherwise crossfade from the current clip, frozen at fade 0.
    if (clip && this.melee) { this.melee.animator.reset(); this.melee.animator.play(clip, time); this.melee.advance(0); }
  }
  /** Test hooks: pause where the clip is, then advance by exact steps (real transitions,
   * repeatable frames). */
  pause(on: boolean): void { this.paused = on; }
  step(dt: number): void { this.melee?.advance(dt); }
  setVisible(visible: boolean): void { this.visible = visible; }

  /** Advance the clip (real seconds); call before WeaponView.update so the gun lowers in step. */
  advance(dt: number): void { this.melee?.advance(this.paused ? 0 : dt); }

  /** Pose the arms for this frame from the clip and the view-model's sway/bob. */
  update(motion: ViewMotion): void {
    const melee = this.melee;
    const shown = !!melee && this.visible && melee.animator.state !== 'hidden';
    if (this.root.isEnabled() !== shown) this.root.setEnabled(shown);
    if (!shown || !melee) return;
    const pose = melee.pose, fp = melee.pair.meta.firstPerson;
    // Sway/bob shared with the gun, plus a share of the clip's torso channel about the shoulders.
    Quaternion.RotationYawPitchRollToRef(motion.yaw, motion.pitch, motion.roll, s.q);
    Quaternion.SlerpToRef(s.identity, pose.body, fp.body, s.body);
    s.q.multiplyToRef(s.body, this.pivot.rotationQuaternion!);
    this.pivot.position.set(motion.x, motion.y, motion.z);
    this.pivot.computeWorldMatrix(true);
    this.rig.computeWorldMatrix(true);
    for (const node of this.entries!.rootNodes) node.computeWorldMatrix(true);
    for (const node of this.spine) node.computeWorldMatrix(true);
    for (const c of this.clavicles) c.node.rotationQuaternion!.copyFrom(c.rest);
    const pivotWorld = this.pivot.getWorldMatrix();
    pivotWorld.decompose(undefined, s.qw);
    // Shoulders: reaching protracts, raising lifts (pivot frame: +z back, +y up).
    const elevate = Vector3.TransformNormalToRef(Vector3.Backward(true), pivotWorld, s.axis).normalize().clone();
    const protract = Vector3.TransformNormalToRef(Vector3.UpReadOnly, pivotWorld, s.axis).normalize().clone();
    for (let i = 0; i < 2; i++) {
      const c = this.clavicles[i], [lift, reach] = shoulderReach(pose.sockets[i].position);
      c.node.rotate(elevate, c.side * lift, Space.WORLD);
      c.node.rotate(protract, c.side * reach, Space.WORLD);
      c.node.computeWorldMatrix(true);
    }
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i], socket = pose.sockets[i], hold = melee.pair.meta.hold[i ? 'l' : 'r'];
      arm.upper.computeWorldMatrix(true);
      Vector3.TransformCoordinatesToRef(socket.position, pivotWorld, s.pos);
      s.qw.multiplyToRef(socket.rotation, s.q);
      s.fingers.set(hold.fingers[0], hold.fingers[1], hold.fingers[2]).applyRotationQuaternionInPlace(s.q).normalize();
      s.back.set(hold.back[0], hold.back[1], hold.back[2]).applyRotationQuaternionInPlace(s.q).normalize();
      s.wrist.copyFrom(s.pos).addInPlace(s.back.scaleToRef(hold.depth, s.tmp)).subtractInPlace(s.fingers.scaleToRef(WRIST_TO_PALM, s.tmp));
      s.pole.copyFrom(arm.upper.getAbsolutePosition()).addInPlace(pose.poles[i].applyRotationQuaternionToRef(s.qw, s.tmp));
      arm.solve(s.wrist, s.pole, s.fingers, s.back);
    }
    melee.pair.update(pose);
  }

  inspect() {
    const melee = this.melee;
    if (!melee) return { ready: false };
    const camera = this.ctx.camera, view = camera.getViewMatrix();
    const local = (p: Vector3) => Vector3.TransformCoordinates(p, view).asArray().map((v) => +v.toFixed(3));
    const fit = this.arms.map((arm, i) => {
      const hold = melee.pair.meta.hold[i ? 'l' : 'r'], frame = arm.handFrame();
      const contact = arm.hand.getAbsolutePosition().add(frame.fingers.scale(WRIST_TO_PALM)).subtractInPlace(frame.back.scale(hold.depth));
      const forearm = arm.hand.getAbsolutePosition().subtract(arm.forearm.getAbsolutePosition()).normalize();
      return { reach: +arm.reach.toFixed(3), wristBend: +(Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(forearm, frame.fingers)))) * 180 / Math.PI).toFixed(1),
        hand: local(contact), elbow: local(arm.forearm.getAbsolutePosition()) };
    });
    return { ready: true, cosmeticId:melee.pair.appearance, ...melee.animator.inspect(), shown: this.root.isEnabled(), gunLower: melee.pose.gunLower, gunVisible: melee.pose.gunVisible,
      daggersVisible: melee.pair.roots.map((r) => r.isEnabled()), scale: [...melee.pose.scale],
      tips: melee.pair.anchor('tip').map(local), grips: melee.pair.anchor('grip').map(local), fit, paused: this.paused };
  }

  dispose(): void { this.melee?.dispose(); this.entries?.dispose(); this.root.dispose(); this.melee = null; this.entries = null; }
}
