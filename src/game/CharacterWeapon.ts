import { meshesReady } from '../core/assetReadiness';
import { Matrix, Mesh, Quaternion, Space, TransformNode, Vector3, type AssetContainer, type Bone, type InstantiatedEntries, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { DampedSpring } from '../core/DampedSpring';
import { loadContainer } from '../core/loadContainer';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { WeaponId } from '../weapons/Weapon';
import { RIG_CONFIGS } from '../weapons/WeaponView';
import type { CharacterInstance } from './CharacterAsset';

type V3 = readonly [number, number, number];

/** One hand on the weapon, in unscaled weapon coordinates (+x right, +y up, -z muzzle).
 * `fingers` is the hand bone axis (wrist to knuckles), `back` the back-of-hand normal; the
 * curled fingers wrap the handle `axis` (perpendicular to both). The hand may turn about
 * that axis by up to `turn` radians to follow the forearm, keeping its grip. */
export interface HandHold { offset: V3; fingers: V3; back: V3; turn: number;
  /** Palm centre to handle axis (metres): palm half-thickness plus the handle's half-depth. */
  depth: number }
/** Weapon placement in the aim frame (+x right, +y up, -z along the look direction).
 * `point` (a weapon anchor) is placed at `at`, relative to the point between the shoulders
 * for the ready hold, and to the head joint for ADS so the sight stays at the eye. */
export interface HoldPlacement { point: 'grip_r' | 'sight'; at: V3; yaw: number; pitch: number; roll: number;
  /** Elbow bend hints relative to each shoulder (right, left), in the aim frame. */
  elbows: [V3, V3] }
export interface WeaponHold {
  ready: HoldPlacement; ads: HoldPlacement; hands: [HandHold, HandHold];
  /** Torso yaw toward the dominant side in ready and ADS (radians). */
  twist: [number, number];
  /** Peak cosmetic recoil per shot: metres back, radians of muzzle rise and shoulder give. */
  recoil: { kick: number; rise: number; torso: number; frequency: number };
}

const WEAPON_SCALE = .85;
// Centre of the handle enclosed by the gripping glove (char_geometry.py finger curl):
// along the hand from the wrist, and toward the palm side.
const WRIST_TO_PALM = .08;
/** Each of three cascaded stages; the step response reaches 95% at ~6.3 time constants. */
const ADS_STAGE_TIME = .024;

// The trigger hand lies across the pistol grip (slanted 20 degrees, bottom rearward) so the
// curled fingers wrap it; the support hand cups the fore-end diagonally from below.
const RIGHT_FINGERS: V3 = [-.3, -.33, -.9], RIGHT_BACK: V3 = [.958, -.1, -.28];
// Wrap axis (fingers x back) ~30 degrees off the bore: a diagonal cup, not a C-clamp.
const LEFT_FINGERS: V3 = [.8, .4, -.45], LEFT_BACK: V3 = [.35, -.916, -.196];

/** Calibrated against each GLB's grip_r/grip_l/sight anchors; see docs/CHARACTER_ANIMATION.md.
 * Those anchors are palm contact points on the surface, so `offset` moves each hand to the
 * measured handle centre (pistol grips ~1.7 cm thick, fore-ends 2-5 cm). */
export const WEAPON_HOLDS: Record<WeaponId, WeaponHold> = {
  rifle: {
    ready: { point: 'grip_r', at: [.10, -.21, -.17], yaw: .60, pitch: -.12, roll: -.12, elbows: [[.4, -.9, .15], [-.3, -1, -.1]] },
    ads: { point: 'sight', at: [.075, .042, -.344], yaw: 0, pitch: 0, roll: 0, elbows: [[.65, -.6, .45], [-.3, -1, -.1]] },
    hands: [{ offset: [0, 0, -.015], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .03 },
      { offset: [0, .0325, .07], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .042 }],
    twist: [.18, .42],
    recoil: { kick: .035, rise: .06, torso: .025, frequency: 26 },
  },
  smg: {
    ready: { point: 'grip_r', at: [.08, -.13, -.22], yaw: .45, pitch: .15, roll: -.10, elbows: [[.4, -.9, .15], [-.3, -1, -.1]] },
    ads: { point: 'sight', at: [.075, .032, -.364], yaw: 0, pitch: 0, roll: 0, elbows: [[.65, -.6, .45], [-.3, -1, -.1]] },
    hands: [{ offset: [0, 0, 0], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .03 },
      { offset: [0, .014, 0], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .034 }],
    twist: [.16, .36],
    recoil: { kick: .025, rise: .045, torso: .015, frequency: 30 },
  },
  shotgun: {
    ready: { point: 'grip_r', at: [.10, -.22, -.17], yaw: .62, pitch: -.14, roll: -.12, elbows: [[.4, -.9, .15], [-.3, -1, -.1]] },
    ads: { point: 'sight', at: [.075, .047, -.314], yaw: 0, pitch: 0, roll: 0, elbows: [[.65, -.6, .45], [-.3, -1, -.1]] },
    hands: [{ offset: [0, 0, -.02], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .032 },
      { offset: [0, .021, .08], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .038 }],
    twist: [.18, .42],
    recoil: { kick: .06, rise: .13, torso: .05, frequency: 18 },
  },
  sniper: {
    ready: { point: 'grip_r', at: [.10, -.27, -.19], yaw: .6, pitch: -.04, roll: -.05, elbows: [[.4, -.9, .15], [-.3, -1, -.1]] },
    ads: { point: 'sight', at: [.075, .037, -.324], yaw: 0, pitch: 0, roll: 0, elbows: [[.65, -.6, .45], [-.3, -1, -.1]] },
    hands: [{ offset: [0, 0, -.015], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .03 },
      { offset: [0, .029, .12], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .034 }],
    twist: [.2, .44],
    recoil: { kick: .07, rise: .15, torso: .06, frequency: 16 },
  },
};

/** Synchronized or local presentation inputs; none of them are sent anywhere. */
export interface HoldState {
  /** Look pitch in radians, positive up. */
  pitch: number;
  /** Wanted ADS (0 or 1, or the server's continuous amount). */
  ads: number;
  airborne: boolean;
}

// Rest-pose arm axes from blender/characters/char_geometry.py (40-degree A-pose),
// converted from Blender (x, y, z) to glTF (x, z, -y): along the bone and the back of
// the hand. The elbow flexes about the back-of-hand axis, toward the character's front.
const ARM_ANGLE = 40 * Math.PI / 180;
const restAlong = (side: number) => new Vector3(side * Math.sin(ARM_ANGLE), -Math.cos(ARM_ANGLE), 0);
const restBack = (side: number) => new Vector3(side * Math.cos(ARM_ANGLE), Math.sin(ARM_ANGLE), 0);

const vec = (v: V3) => new Vector3(v[0], v[1], v[2]);

const scratch = {
  m: Matrix.Identity(), p: Matrix.Identity(), l: Matrix.Identity(), q: new Quaternion(),
  a: Vector3.Zero(), b: Vector3.Zero(), c: Vector3.Zero(), d: Vector3.Zero(), e: Vector3.Zero(),
};

/** Local axes of a bone in its own frame, derived from the actual rest matrices. */
function restLocal(bone: Bone, world: Vector3): Vector3 {
  let rest = bone.getRestMatrix().clone();
  for (let parent = bone.getParent(); parent; parent = parent.getParent()) rest = rest.multiply(parent.getRestMatrix());
  return Vector3.TransformNormal(world, Matrix.Invert(rest)).normalize();
}

/** Writes a world-space orientation that maps local `axis`/`side` onto `wantAxis`/`wantSide`. */
function orient(node: TransformNode, axis: Vector3, side: Vector3, wantAxis: Vector3, wantSide: Vector3): void {
  const { m, p, l, q, a, b, c } = scratch;
  // Local orthonormal basis (rows) and the wanted world basis.
  const lz = Vector3.Cross(axis, side).normalize(), lx = Vector3.Cross(lz, axis).normalize();
  a.copyFrom(wantAxis).normalize();
  c.copyFrom(Vector3.Cross(a, wantSide)).normalize();
  b.copyFrom(Vector3.Cross(c, a)).normalize();
  // Row-vector convention: v_local * L^T * W maps the local basis onto the world basis.
  Matrix.FromValuesToRef(lx.x, axis.x, lz.x, 0, lx.y, axis.y, lz.y, 0, lx.z, axis.z, lz.z, 0, 0, 0, 0, 1, l);
  Matrix.FromValuesToRef(b.x, b.y, b.z, 0, a.x, a.y, a.z, 0, c.x, c.y, c.z, 0, 0, 0, 0, 1, m);
  l.multiplyToRef(m, m);
  const parent = node.parent as TransformNode | null;
  if (parent) {
    parent.computeWorldMatrix(true).decompose(undefined, q);
    q.toRotationMatrix(p); p.transposeToRef(p);
    m.multiplyToRef(p, m);
  }
  node.rotationQuaternion ??= new Quaternion();
  Quaternion.FromRotationMatrixToRef(m, node.rotationQuaternion);
  node.computeWorldMatrix(true);
}

/** Hinged two-bone arm. The shoulder swings freely; the elbow bends only about its own
 * flexion axis, so the forearm never rolls through the joint, and the wrist is solved last. */
export class ArmChain {
  private readonly upperAxis: Vector3; private readonly upperHinge: Vector3;
  private readonly foreAxis: Vector3; private readonly foreHinge: Vector3;
  private readonly handAxis: Vector3; private readonly handBack: Vector3;
  reach = 0;
  /** Smoothed turn of the hand about its handle axis, and the last solved forearm. */
  turn = 0;
  readonly forearmDir = new Vector3(0, -1, 0);
  constructor(readonly upper: TransformNode, readonly forearm: TransformNode, readonly hand: TransformNode,
    bones: [Bone, Bone, Bone], readonly side: 1 | -1) {
    const along = restAlong(side), back = restBack(side);
    this.upperAxis = restLocal(bones[0], along); this.upperHinge = restLocal(bones[0], back);
    this.foreAxis = restLocal(bones[1], along); this.foreHinge = restLocal(bones[1], back);
    this.handAxis = restLocal(bones[2], along); this.handBack = restLocal(bones[2], back);
  }
  /** Bone-local axis directions; the hand's +Y and the A-pose glove back in world space. */
  handFrame(): { fingers: Vector3; back: Vector3 } {
    const world = this.hand.computeWorldMatrix(true);
    return { fingers: Vector3.TransformNormal(this.handAxis, world).normalize(), back: Vector3.TransformNormal(this.handBack, world).normalize() };
  }
  restAxes() { return { upper: this.upperAxis.asArray(), forearm: this.foreAxis.asArray(), hand: this.handAxis.asArray() }; }
  /** Positions the wrist at `wrist`, bends toward `pole` (world point) and orients the hand. */
  solve(wrist: Vector3, pole: Vector3, fingers: Vector3, back: Vector3): void {
    const shoulder = this.upper.getAbsolutePosition().clone();
    const elbowRest = this.forearm.getAbsolutePosition(), handRest = this.hand.getAbsolutePosition();
    const a = Vector3.Distance(shoulder, elbowRest), b = Vector3.Distance(elbowRest, handRest);
    const delta = wrist.subtract(shoulder), length = delta.length();
    this.reach = length - (a + b);
    // Keep a minimum ~12-degree bend so the hinge direction stays defined.
    const distance = Math.max(Math.abs(a - b) + .01, Math.min(length, (a + b) * .994));
    const direction = delta.scaleInPlace(1 / Math.max(1e-6, length));
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const hint = pole.subtract(shoulder);
    const bend = hint.subtractInPlace(direction.scale(Vector3.Dot(hint, direction)));
    if (bend.lengthSquared() < 1e-8) bend.copyFromFloats(0, -1, 0);
    bend.normalize();
    const elbow = shoulder.add(direction.scale(along)).addInPlace(bend.scale(Math.sqrt(Math.max(0, a * a - along * along))));
    const target = shoulder.add(direction.scale(distance));
    const upperDir = elbow.subtract(shoulder).normalize(), foreDir = target.subtract(elbow).normalize();
    // Flexion axis: rotating the upper-arm direction about it moves toward the forearm.
    const hinge = Vector3.Cross(upperDir, foreDir).normalize();
    orient(this.upper, this.upperAxis, this.upperHinge, upperDir, hinge);
    orient(this.forearm, this.foreAxis, this.foreHinge, foreDir, hinge);
    orient(this.hand, this.handAxis, this.handBack, fingers, back);
    this.forearmDir.copyFrom(foreDir);
  }
}

/** Scene-local copies of the same GLBs used by the first-person weapon view. */
export class CharacterWeaponLibrary {
  private readonly containers = new Map<WeaponId, AssetContainer>();
  private readonly pending = new Map<WeaponId, Promise<void>>();
  constructor(private readonly scene: Scene, private readonly materials: MaterialLibrary) {}
  load(id: WeaponId, signal?: AbortSignal): Promise<void> {
    const cached = this.containers.get(id);
    if (cached) {
      // A failed join can prune unused shared materials; rebind on retry.
      for (const mesh of cached.meshes) if (mesh.material) mesh.material = this.materials.get(mesh.material.name);
      return Promise.resolve();
    }
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
  async ready(signal?: AbortSignal): Promise<void> {
    await Promise.all([...this.containers.values()].map(c => meshesReady(c.meshes, signal)));
  }
  create(character: CharacterInstance, id: WeaponId): CharacterWeapon | null {
    const container = this.containers.get(id);
    return container ? new CharacterWeapon(this.scene, character, id, container) : null;
  }
}

/** Cosmetic weapon hold shared by remote players and the home preview. Layers, each
 * blended by elapsed time: animated locomotion clip (torso), look pitch, ADS, recoil,
 * landing and breathing. Server collision and the first-person weapon are untouched. */
export class CharacterWeapon {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  readonly hold: WeaponHold;
  private readonly entries: InstantiatedEntries;
  private readonly arms: ArmChain[] = [];
  private readonly saved = new Map<TransformNode, Quaternion>();
  private readonly spine: TransformNode | null;
  private readonly chest: TransformNode | null;
  private readonly head: TransformNode | null;
  private readonly grips: TransformNode[];
  private readonly anchors: Record<'grip_r' | 'sight', Vector3>;
  private readonly state: HoldState = { pitch: 0, ads: 0, airborne: false };
  /** Third-order ADS follower: starts gently and settles (95%) in ~150 ms. */
  private readonly adsStages = [0, 0, 0];
  private adsBlend = 0;
  private readonly recoil: DampedSpring;
  private readonly landing = new DampedSpring(15, .6);
  private dt = 0;
  private wasAirborne = false;
  private breath = Math.random() * 10;
  private shots = 0;
  /** Disabled only when the instance cannot be seen; smoothing still advances. */
  posing = true;

  constructor(scene: Scene, private readonly character: CharacterInstance, readonly id: WeaponId, container: AssetContainer) {
    this.hold = WEAPON_HOLDS[id];
    this.recoil = new DampedSpring(this.hold.recoil.frequency, .72);
    this.root = new TransformNode(`held:${id}`, scene);
    this.root.parent = character.root;
    this.root.scaling.setAll(WEAPON_SCALE);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.entries = container.instantiateModelsToScene((name) => `held:${id}:${name}`, false, { doNotInstantiate: true });
    for (const root of this.entries.rootNodes) root.parent = this.root;
    this.meshes = this.root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const mesh of this.meshes) { mesh.isPickable = false; mesh.renderingGroupId = 0; }
    const nodes = this.root.getChildTransformNodes(false);
    const node = (name: string) => nodes.find((n) => n.name === `held:${id}:${name}`);
    // This loose reload prop is animated only in the first-person view.
    node('shell')?.setEnabled(false);
    this.grips = ['grip_r', 'grip_l'].map((name) => node(name)!).filter(Boolean);
    // Anchor positions relative to the weapon root (unscaled); the GLB roots are identity.
    const local = (name: string) => node(name)?.position.clone() ?? Vector3.Zero();
    this.anchors = { grip_r: local('grip_r'), sight: local('sight') };
    const bones = character.entries.skeletons[0].bones;
    const find = (name: string) => bones.find((b) => b.name === name);
    this.spine = find('spine')?.getTransformNode() ?? null;
    this.chest = find('chest')?.getTransformNode() ?? null;
    this.head = find('head')?.getTransformNode() ?? null;
    for (const [side, suffix] of [[1, 'r'], [-1, 'l']] as const) {
      const chain = [find(`upper_arm_${suffix}`), find(`forearm_${suffix}`), find(`hand_${suffix}`)];
      const nodesFor = chain.map((b) => b?.getTransformNode());
      if (chain.some((b) => !b) || nodesFor.some((n) => !n)) continue;
      this.arms.push(new ArmChain(nodesFor[0]!, nodesFor[1]!, nodesFor[2]!, chain as [Bone, Bone, Bone], side));
    }
  }
  setState(state: Partial<HoldState>): void { Object.assign(this.state, state); }
  /** Back-compatible pitch/ADS setter. */
  setPose(pitch: number, ads: number): void { this.setState({ pitch, ads: Math.max(0, Math.min(1, ads)) }); }
  /** One cosmetic recoil impulse at the actual firing cadence. */
  fire(): void {
    this.shots++;
    // Unit-peak impulse for a single shot; rapid fire accumulates up to a cap below.
    this.recoil.velocity += this.hold.recoil.frequency * Math.E * .55;
  }
  /** Advance time-based smoothing (seconds). */
  advance(dt: number): void {
    dt = this.dt = Math.max(0, Math.min(.1, dt));
    // Sub-steps keep the discrete cascade close to its continuous S-curve at any frame rate.
    const target = Math.max(0, Math.min(1, this.state.ads)), steps = Math.ceil(dt / .004);
    const k = 1 - Math.exp(-dt / steps / ADS_STAGE_TIME);
    for (let n = 0; n < steps; n++) {
      let input = target;
      for (let i = 0; i < this.adsStages.length; i++) input = this.adsStages[i] += (input - this.adsStages[i]) * k;
    }
    this.adsBlend = this.adsStages[this.adsStages.length - 1];
    this.recoil.update(dt);
    if (this.wasAirborne && !this.state.airborne) this.landing.velocity -= .9;
    this.wasAirborne = this.state.airborne;
    this.landing.update(dt);
    this.breath += dt;
  }
  restore(): void {
    for (const [node, rotation] of this.saved) node.rotationQuaternion?.copyFrom(rotation);
    this.saved.clear();
  }
  private save(node: TransformNode | null): void {
    if (node?.rotationQuaternion && !this.saved.has(node)) this.saved.set(node, node.rotationQuaternion.clone());
  }
  /** Apply after the engine evaluates the locomotion clips this frame. */
  update(): void {
    if (!this.chest || !this.posing) return;
    for (const arm of this.arms) { this.save(arm.upper); this.save(arm.forearm); this.save(arm.hand); }
    this.save(this.spine); this.save(this.chest); this.save(this.head);
    const ads = Math.max(0, Math.min(1, this.adsBlend)), ready = 1 - ads;
    const recoil = Math.max(-.4, Math.min(1.6, this.recoil.value));
    const pitch = Math.max(-1.25, Math.min(1.25, this.state.pitch));
    const root = this.character.root;
    root.computeWorldMatrix(true);
    const world = root.getWorldMatrix();
    const right = Vector3.TransformNormal(Vector3.Right(), world).normalize();
    const forward = Vector3.TransformNormal(Vector3.Forward(true), world).normalize();
    // Torso follows the look; ADS leans in and drops the cheek to the stock; recoil is
    // absorbed by the shoulders. Rotations are about the character's own axes.
    const rotate = (node: TransformNode | null, axis: Vector3, angle: number) => {
      if (!node || Math.abs(angle) < 1e-5) return;
      node.parent instanceof TransformNode && node.parent.computeWorldMatrix(true);
      node.rotate(axis, angle, Space.WORLD); node.computeWorldMatrix(true);
    };
    // Bladed stance: the support shoulder turns toward the fore-end (more in ADS) while
    // the head counter-turns to keep facing the look direction.
    const up = Vector3.TransformNormal(Vector3.Up(), world).normalize();
    const twist = this.hold.twist[0] * ready + this.hold.twist[1] * ads;
    rotate(this.spine, up, -twist * .4);
    rotate(this.chest, up, -twist * .6);
    rotate(this.spine, right, pitch * .18);
    rotate(this.chest, right, pitch * .2 - ads * .07 + recoil * this.hold.recoil.torso);
    rotate(this.head, up, twist);
    // The head turns by the whole look pitch (spine + chest + head = 1); with the ADS lean
    // above, the cheek drops 0.1 rad onto the stock.
    rotate(this.head, right, pitch * .62 - ads * .03);
    rotate(this.head, forward, ads * .16);
    const [rightArm, leftArm] = this.arms;
    if (!rightArm || !leftArm) return;
    const inverse = Matrix.Invert(world);
    const shoulderR = Vector3.TransformCoordinates(rightArm.upper.getAbsolutePosition(), inverse);
    const shoulderL = Vector3.TransformCoordinates(leftArm.upper.getAbsolutePosition(), inverse);
    const centre = shoulderR.add(shoulderL).scaleInPlace(.5);
    const neck = this.head ? Vector3.TransformCoordinates(this.head.getAbsolutePosition(), inverse) : centre;
    // Breathing sway fades in ADS; the aim frame pitches around the shoulders.
    const sway = Math.sin(this.breath * 1.9), drift = Math.sin(this.breath * 1.1 + 1.3);
    const aim = Quaternion.RotationAxis(Vector3.Right(), pitch * .72);
    const place = (p: HoldPlacement, origin: Vector3, q: Quaternion) => {
      const anchor = this.anchors[p.point].scale(WEAPON_SCALE).applyRotationQuaternion(q);
      return { q, position: origin.add(vec(p.at).applyRotationQuaternion(q)).subtractInPlace(anchor) };
    };
    const r = this.hold.ready;
    const a = place(r, centre, aim.multiply(Quaternion.RotationYawPitchRoll(r.yaw, r.pitch, r.roll)));
    // ADS follows the full look pitch around the head joint.
    const b = place(this.hold.ads, neck, Quaternion.RotationAxis(Vector3.Right(), pitch));
    const rotation = Quaternion.Slerp(a.q, b.q, ads);
    const position = Vector3.Lerp(a.position, b.position, ads);
    const motion = 1 - .75 * ads;
    rotation.multiplyInPlace(Quaternion.RotationYawPitchRoll(drift * .008 * motion, sway * .01 * motion + recoil * this.hold.recoil.rise, 0));
    position.addInPlace(new Vector3(0, sway * .003 * motion + this.landing.value * .05, 0));
    // Recoil drives the weapon straight back along its own bore.
    position.addInPlace(new Vector3(0, 0, recoil * this.hold.recoil.kick).applyRotationQuaternion(rotation));
    this.root.position.copyFrom(position);
    this.root.rotationQuaternion!.copyFrom(rotation);
    this.solveArms(ready, ads, aim);
    // Out-of-reach grips pull the whole weapon toward the shoulders, not the hands off it.
    const overreach = Math.max(rightArm.reach, leftArm.reach);
    if (overreach > .002) {
      const pull = centre.subtract(this.root.position).normalize().scaleInPlace(overreach + .004);
      this.root.position.addInPlace(pull);
      this.solveArms(ready, ads, aim);
    }
  }
  private solveArms(ready: number, ads: number, aim: Quaternion): void {
    const root = this.character.root;
    this.root.computeWorldMatrix(true);
    const weaponWorld = this.root.getWorldMatrix(), rootWorld = root.getWorldMatrix();
    for (const [index, arm] of this.arms.entries()) {
      const hand = this.hold.hands[index], grip = this.grips[index];
      if (!grip) continue;
      grip.computeWorldMatrix(true);
      const preferred = Vector3.TransformNormal(vec(hand.fingers), weaponWorld).normalize();
      const backPreferred = Vector3.TransformNormal(vec(hand.back), weaponWorld).normalize();
      // Turn about the handle toward last frame's forearm so the wrist stays straight
      // without the fingers leaving the grip; eased by elapsed time to avoid jitter.
      const axis = Vector3.Cross(preferred, backPreferred).normalize();
      const projected = arm.forearmDir.subtract(axis.scale(Vector3.Dot(arm.forearmDir, axis)));
      if (projected.lengthSquared() > 1e-4) {
        projected.normalize();
        const wanted = Math.atan2(Vector3.Dot(Vector3.Cross(preferred, projected), axis), Vector3.Dot(preferred, projected));
        const clamped = Math.max(-hand.turn, Math.min(hand.turn, wanted));
        arm.turn += (clamped - arm.turn) * (1 - Math.exp(-this.dt / .06));
      }
      const spin = Quaternion.RotationAxis(axis, arm.turn);
      const fingers = preferred.applyRotationQuaternion(spin), back = backPreferred.applyRotationQuaternion(spin);
      const offset = Vector3.TransformNormal(vec(hand.offset), weaponWorld);
      // Grip anchors lie inside the weapon: the palm rests on its surface with the wrist behind.
      const wrist = grip.getAbsolutePosition().add(offset).addInPlace(back.scale(hand.depth)).subtractInPlace(fingers.scale(WRIST_TO_PALM));
      const hintA = this.hold.ready.elbows[index], hintB = this.hold.ads.elbows[index];
      const hint = new Vector3(hintA[0] * ready + hintB[0] * ads, hintA[1] * ready + hintB[1] * ads, hintA[2] * ready + hintB[2] * ads)
        .applyRotationQuaternion(aim);
      const pole = arm.upper.getAbsolutePosition().add(Vector3.TransformNormal(hint, rootWorld));
      arm.solve(wrist, pole, fingers, back);
    }
  }
  inspect() {
    const hands = this.arms.map((arm, index) => {
      const frame = arm.handFrame(), hold = this.hold.hands[index];
      const weaponWorld = this.root.getWorldMatrix();
      // Where the solved hand's enclosed handle centre is, and where it should be.
      const contact = arm.hand.getAbsolutePosition().add(frame.fingers.scale(WRIST_TO_PALM)).subtractInPlace(frame.back.scale(hold.depth));
      const handle = this.grips[index]?.getAbsolutePosition().add(Vector3.TransformNormal(vec(hold.offset), weaponWorld)) ?? contact;
      const forearm = arm.hand.getAbsolutePosition().subtract(arm.forearm.getAbsolutePosition()).normalize();
      const upper = arm.forearm.getAbsolutePosition().subtract(arm.upper.getAbsolutePosition()).normalize();
      return { contact: contact.asArray(), handle: handle.asArray(), gap: Vector3.Distance(contact, handle),
        fingers: frame.fingers.asArray(), back: frame.back.asArray(), turn: arm.turn,
        desiredFingers: Vector3.TransformNormal(vec(hold.fingers), weaponWorld).normalize().asArray(),
        desiredBack: Vector3.TransformNormal(vec(hold.back), weaponWorld).normalize().asArray(),
        reach: arm.reach, wristBend: Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(forearm, frame.fingers)))),
        elbowBend: Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(upper, forearm)))),
        forearmInWeapon: Vector3.TransformNormal(forearm, Matrix.Invert(weaponWorld)).normalize().asArray(),
        elbow: arm.forearm.getAbsolutePosition().asArray(), shoulder: arm.upper.getAbsolutePosition().asArray(), rest: arm.restAxes() };
    });
    return { id: this.id, ads: this.state.ads, adsBlend: this.adsBlend, pitch: this.state.pitch, shots: this.shots,
      recoil: this.recoil.value, meshes: this.meshes.length, posing: this.posing,
      instances: this.character.root.getChildTransformNodes(true).filter((n) => /^held:(rifle|smg|shotgun|sniper)$/.test(n.name)).length,
      grips: this.grips.map((g) => g.getAbsolutePosition().asArray()), hands,
      muzzle: this.root.getChildTransformNodes(false).find((n) => n.name === `held:${this.id}:muzzle`)?.getAbsolutePosition().asArray() ?? null,
      // Rear-most point of the weapon (the stock butt) and the head joint, in character-root space.
      butt: this.local(this.buttPoint()), head: this.head ? this.local(this.head.getAbsolutePosition()) : null,
      sight: this.local(Vector3.TransformCoordinates(this.anchors.sight, this.root.getWorldMatrix())) };
  }
  private buttPoint(): Vector3 {
    let max = -Infinity, best = Vector3.Zero();
    for (const mesh of this.meshes) {
      const box = mesh.getBoundingInfo().boundingBox;
      if (box.maximum.z > max) { max = box.maximum.z; best = Vector3.TransformCoordinates(new Vector3(0, box.center.y, box.maximum.z), mesh.computeWorldMatrix(true)); }
    }
    return best;
  }
  private local(point: Vector3): number[] {
    return Vector3.TransformCoordinates(point, Matrix.Invert(this.character.root.getWorldMatrix())).asArray().map((v) => +v.toFixed(3));
  }
  dispose(): void { this.restore(); this.entries.dispose(); this.root.dispose(); }
}
