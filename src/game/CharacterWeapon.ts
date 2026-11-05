import { RemoteMuzzleFlash } from '../weapons/RemoteMuzzleFlash';
import { meshesReady } from '../core/assetReadiness';
import { Matrix, Mesh, Quaternion, Space, TransformNode, Vector3, VertexBuffer, type AssetContainer, type Bone, type InstantiatedEntries, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { DampedSpring } from '../core/DampedSpring';
import { loadContainer } from '../core/loadContainer';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { WeaponAction, WeaponId } from '../weapons/Weapon';
import { RIG_CONFIGS } from '../weapons/WeaponView';
import { actionPose, type ActionAnchor, type ActionPose, type BodyPoint } from './CharacterActions';
import type { CharacterInstance } from './CharacterAsset';

type V3 = readonly [number, number, number];
type Shoulders = readonly [number, number, number, number];

/** One hand on the weapon, in unscaled weapon coordinates (+x right, +y up, -z muzzle).
 * `fingers` is the hand bone axis (wrist to knuckles), `back` the back-of-hand normal; the
 * curled fingers wrap the handle `axis` (perpendicular to both). The hand may turn about
 * that axis by up to `turn` radians to follow the forearm, keeping its grip. */
export interface HandHold { offset: V3; fingers: V3; back: V3; turn: number;
  /** Palm centre to handle axis (metres): palm half-thickness plus the handle's half-depth. */
  depth: number }
/** Weapon placement. Ready: `point` (grip_r) at `at` relative to the point between the
 * shoulders, in the aim frame (+x right, +y up, -z along the look). ADS: the butt pad at `at`
 * relative to the right shoulder joint, in the torso frame (the shoulder pocket), with the
 * weapon along the full look direction; the head then comes down to the stock. */
export interface HoldPlacement { point: 'grip_r' | 'butt'; at: V3; yaw: number; pitch: number; roll: number;
  /** Elbow bend hints relative to each shoulder (right, left), in the aim frame. */
  elbows: [V3, V3] }
/** Index finger curl added to the modelled grip per joint (radians; negative opens), and the
 * knuckle's spread toward the thumb (the trigger sits above the gripping fingers). */
type Curl = readonly [number, number, number, number];
export interface IndexPose { off: Curl; on: Curl; support: Curl }
export interface WeaponHold {
  ready: HoldPlacement; ads: HoldPlacement; hands: [HandHold, HandHold];
  /** Torso yaw toward the dominant side in ready and ADS (radians). */
  twist: [number, number];
  /** Peak cosmetic recoil per shot: metres back, radians of muzzle rise and shoulder give. */
  recoil: { kick: number; rise: number; torso: number; frequency: number };
  index: IndexPose;
  /** Front face of the trigger blade (unscaled weapon coordinates). */
  trigger: V3;
}

const WEAPON_SCALE = .85;
// Centre of the handle enclosed by the gripping glove (char_geometry.py finger curl):
// along the hand from the wrist, and toward the palm side.
const WRIST_TO_PALM = .08;
/** Each of three cascaded stages; the step response reaches 95% at ~6.3 time constants. */
const ADS_STAGE_TIME = .024;
/** Right eye centre in the bind pose (char_geometry.py EYE_X/EYE_Z on the head surface), glTF metres. */
const EYE_REST = new Vector3(.031, 1.655, -.0722);
/** Distal phalanx of the index finger (char_geometry.py FINGERS[0], last segment). */
const INDEX_TIP = .018;
/** Clavicle [right elevation, right protraction, left elevation, left protraction] (radians):
 * the support shoulder reaches forward; in ADS the firing shoulder lifts into the stock. */
const SHOULDERS_READY: Shoulders = [.02, 0, .02, .07];
const SHOULDERS_ADS: Shoulders = [.13, .05, .05, .13];
/** Pouches the support hand reaches during reloads, in the torso frame relative to the chest
 * joint (char_geometry.py: front-left magazine pouch on the vest, a shell pouch at the belt). */
const BODY_POINTS: Record<BodyPoint, V3> = { magPouch: [-.075, -.075, -.17], shellPouch: [-.13, -.2, -.13] };
/** Most the neck and head together turn to bring the eye to the sight line. */
const CHEEK_WELD_LIMIT = .6;

// The trigger hand lies across the pistol grip (slanted 20 degrees, bottom rearward) so the
// curled fingers wrap it; the support hand cups the fore-end diagonally from below.
const RIGHT_FINGERS: V3 = [-.3, -.33, -.9], RIGHT_BACK: V3 = [.958, -.1, -.28];
// Wrap axis (fingers x back) ~30 degrees off the bore: a diagonal cup, not a C-clamp.
const LEFT_FINGERS: V3 = [.8, .4, -.45], LEFT_BACK: V3 = [.35, -.916, -.196];
const READY_ELBOWS: [V3, V3] = [[.75, -.65, .1], [-.3, -1, -.1]];
const ADS_ELBOWS: [V3, V3] = [[.9, -.35, .25], [-.25, -1, -.15]];
// Trigger finger straight along the frame when not shooting, its pad on the blade when it is.
// The pad-on-trigger curls were fitted against each model's trigger blade (within ~1 cm).
const TRIGGER_OFF: Curl = [-.95, -.95, -.6, .25];
// Rifle-pattern fore-ends: index along the handguard, pointing at the target.
const SUPPORT_POINT: Curl = [-.75, -.85, -.55, 0];

/** Calibrated against each GLB's grip_r/grip_l/sight anchors and measured butt pad; see
 * docs/CHARACTER_ANIMATION.md. Grip anchors are palm contact points on the surface, so
 * `offset` moves each hand to the measured handle centre (grips ~1.7 cm, fore-ends 2-5 cm). */
export const WEAPON_HOLDS: Record<WeaponId, WeaponHold> = {
  rifle: {
    ready: { point: 'grip_r', at: [.10, -.21, -.17], yaw: .60, pitch: -.12, roll: -.12, elbows: READY_ELBOWS },
    ads: { point: 'butt', at: [-.095, .03, -.1], yaw: -.02, pitch: 0, roll: 0, elbows: ADS_ELBOWS },
    hands: [{ offset: [0, .012, -.025], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .03 },
      { offset: [0, .0325, .07], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .042 }],
    twist: [.18, .42],
    recoil: { kick: .035, rise: .06, torso: .025, frequency: 26 },
    index: { off: TRIGGER_OFF, on: [-.9, .9, .6, .2], support: SUPPORT_POINT },
    trigger: [0, -.012, -.027],
  },
  smg: {
    ready: { point: 'grip_r', at: [.08, -.13, -.22], yaw: .45, pitch: .15, roll: -.10, elbows: READY_ELBOWS },
    ads: { point: 'butt', at: [-.095, .035, -.1], yaw: -.02, pitch: 0, roll: 0, elbows: ADS_ELBOWS },
    hands: [{ offset: [0, .012, -.032], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .03 },
      { offset: [0, .014, 0], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .034 }],
    twist: [.16, .36],
    recoil: { kick: .025, rise: .045, torso: .015, frequency: 30 },
    index: { off: TRIGGER_OFF, on: [-1.2, 1, .8, 0], support: [0, 0, 0, 0] },
    trigger: [0, -.006, -.048],
  },
  shotgun: {
    ready: { point: 'grip_r', at: [.10, -.22, -.17], yaw: .62, pitch: -.14, roll: -.12, elbows: READY_ELBOWS },
    ads: { point: 'butt', at: [-.095, .018, -.1], yaw: -.02, pitch: 0, roll: 0, elbows: ADS_ELBOWS },
    hands: [{ offset: [0, .012, -.03], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .032 },
      { offset: [0, .021, .08], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .038 }],
    twist: [.18, .42],
    recoil: { kick: .06, rise: .13, torso: .05, frequency: 18 },
    // The whole support hand wraps and works the pump.
    index: { off: TRIGGER_OFF, on: [-1.2, 1, .8, 0], support: [0, 0, 0, 0] },
    trigger: [0, -.021, -.03],
  },
  sniper: {
    ready: { point: 'grip_r', at: [.10, -.27, -.19], yaw: .6, pitch: -.04, roll: -.05, elbows: READY_ELBOWS },
    ads: { point: 'butt', at: [-.095, .03, -.1], yaw: -.02, pitch: 0, roll: 0, elbows: ADS_ELBOWS },
    hands: [{ offset: [0, .012, -.025], fingers: RIGHT_FINGERS, back: RIGHT_BACK, turn: .9, depth: .03 },
      { offset: [0, .029, .12], fingers: LEFT_FINGERS, back: LEFT_BACK, turn: .9, depth: .034 }],
    twist: [.2, .44],
    recoil: { kick: .07, rise: .15, torso: .06, frequency: 16 },
    index: { off: TRIGGER_OFF, on: [-1.1, .9, .6, .2], support: SUPPORT_POINT },
    trigger: [0, -.012, -.028],
  },
};

/** Synchronized or local presentation inputs; none of them are sent anywhere. */
export interface HoldState {
  /** Look pitch in radians, positive up. */
  pitch: number;
  /** Wanted ADS (0 or 1, or the server's continuous amount). */
  ads: number;
  airborne: boolean;
  /** The weapon's gameplay action and its progress (0..1) at the presented time. */
  action: WeaponAction;
  progress: number;
}

// Rest-pose arm axes from blender/characters/char_geometry.py (40-degree A-pose),
// converted from Blender (x, y, z) to glTF (x, z, -y): along the bone and the back of
// the hand. The elbow flexes about the back-of-hand axis, toward the character's front.
const ARM_ANGLE = 40 * Math.PI / 180;
const restAlong = (side: number) => new Vector3(side * Math.sin(ARM_ANGLE), -Math.cos(ARM_ANGLE), 0);
const restBack = (side: number) => new Vector3(side * Math.cos(ARM_ANGLE), Math.sin(ARM_ANGLE), 0);
// Finger curl axis (char_geometry.py: cross(along, palm)); positive turns curl toward the palm.
const restCurl = (side: number) => new Vector3(0, 0, -side);

const vec = (v: V3) => new Vector3(v[0], v[1], v[2]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const scratch = {
  m: Matrix.Identity(), p: Matrix.Identity(), l: Matrix.Identity(), q: new Quaternion(),
  a: Vector3.Zero(), b: Vector3.Zero(), c: Vector3.Zero(), lx: Vector3.Zero(), lz: Vector3.Zero(),
};
const poseScratch = {
  axisRight: Vector3.Zero(), axisForward: Vector3.Zero(), axisUp: Vector3.Zero(), inverse: Matrix.Identity(),
  centre: Vector3.Zero(), right: Vector3.Zero(), up: Vector3.Zero(), tmp: Vector3.Zero(), tmp2: Vector3.Zero(),
  elevate: Vector3.Zero(), protract: Vector3.Zero(), aim: new Quaternion(), readyQ: new Quaternion(), adsQ: new Quaternion(),
  readyPos: Vector3.Zero(), adsPos: Vector3.Zero(), turn: new Quaternion(),
};
const weldScratch = {
  sight: Vector3.Zero(), bore: Vector3.Zero(), eye: Vector3.Zero(), target: Vector3.Zero(), tmp: Vector3.Zero(),
  from: Vector3.Zero(), to: Vector3.Zero(), axis: Vector3.Zero(),
};
/** One hand's target this frame: handle centre and hand axes (world), from its hold. */
interface HandTarget { hold: HandHold; localFingers: Vector3; localBack: Vector3; offset: Vector3;
  grip: Vector3; point: Vector3; fingers: Vector3; back: Vector3 }
const solveScratch = {
  axis: Vector3.Zero(), projected: Vector3.Zero(), tmp: Vector3.Zero(), spin: new Quaternion(), fingers: Vector3.Zero(),
  back: Vector3.Zero(), wrist: Vector3.Zero(), hint: Vector3.Zero(), pole: Vector3.Zero(),
};
/** Per-solve temporaries for the arm chains (the solve is synchronous and never re-entered). */
const arm = {
  shoulder: Vector3.Zero(), direction: Vector3.Zero(), bend: Vector3.Zero(), elbow: Vector3.Zero(), target: Vector3.Zero(),
  upperDir: Vector3.Zero(), foreDir: Vector3.Zero(), hinge: Vector3.Zero(), tmp: Vector3.Zero(),
};

/** Full rest (bind) matrix of a bone in skeleton space. */
function restChain(bone: Bone): Matrix {
  let rest = bone.getRestMatrix().clone();
  for (let parent = bone.getParent(); parent; parent = parent.getParent()) rest = rest.multiply(parent.getRestMatrix());
  return rest;
}
/** A world (skeleton-space) direction in a bone's own rest frame. */
function restLocal(bone: Bone, world: Vector3): Vector3 {
  return Vector3.TransformNormal(world, Matrix.Invert(restChain(bone))).normalize();
}

/** Writes a world-space orientation that maps local `axis`/`side` onto `wantAxis`/`wantSide`. */
function orient(node: TransformNode, axis: Vector3, side: Vector3, wantAxis: Vector3, wantSide: Vector3): void {
  const { m, p, l, q, a, b, c, lx, lz } = scratch;
  // Local orthonormal basis (rows) and the wanted world basis.
  Vector3.CrossToRef(axis, side, lz); lz.normalize();
  Vector3.CrossToRef(lz, axis, lx); lx.normalize();
  a.copyFrom(wantAxis).normalize();
  Vector3.CrossToRef(a, wantSide, c); c.normalize();
  Vector3.CrossToRef(c, a, b); b.normalize();
  // Row-vector convention: v_local * L^T * W maps the local basis onto the world basis.
  Matrix.FromValuesToRef(lx.x, axis.x, lz.x, 0, lx.y, axis.y, lz.y, 0, lx.z, axis.z, lz.z, 0, 0, 0, 0, 1, l);
  Matrix.FromValuesToRef(b.x, b.y, b.z, 0, a.x, a.y, a.z, 0, c.x, c.y, c.z, 0, 0, 0, 0, 1, m);
  l.multiplyToRef(m, m);
  const parent = node.parent as TransformNode | null;
  if (parent) {
    parent.getWorldMatrix().decompose(undefined, q);
    q.toRotationMatrix(p); p.transposeToRef(p);
    m.multiplyToRef(p, m);
  }
  node.rotationQuaternion ??= new Quaternion();
  Quaternion.FromRotationMatrixToRef(m, node.rotationQuaternion);
  node.computeWorldMatrix(true);
}

/** Recomputes world matrices top-down (parents listed first). Babylon caches a node's world
 * matrix once per render, so a joint read earlier in the frame would otherwise ignore a later
 * rotation of one of its parents. */
function refresh(nodes: readonly TransformNode[]): void { for (const node of nodes) node.computeWorldMatrix(true); }

/** Rotates a node about a world axis through its own pivot (the bone's joint); its world
 * matrix (and its children's) is recomputed by the caller once all its turns are applied. */
function turn(node: TransformNode | null, axis: Vector3, angle: number): void {
  // Uses the parent's current world matrix: callers recompute joints top-down (see refresh).
  if (node && Math.abs(angle) >= 1e-5) node.rotate(axis, angle, Space.WORLD);
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
    const { shoulder, direction, bend, elbow, target, upperDir, foreDir, hinge, tmp } = arm;
    shoulder.copyFrom(this.upper.getAbsolutePosition());
    const elbowRest = this.forearm.getAbsolutePosition(), handRest = this.hand.getAbsolutePosition();
    const a = Vector3.Distance(shoulder, elbowRest), b = Vector3.Distance(elbowRest, handRest);
    wrist.subtractToRef(shoulder, direction);
    const length = direction.length();
    this.reach = length - (a + b);
    // Keep a minimum ~12-degree bend so the hinge direction stays defined.
    const distance = Math.max(Math.abs(a - b) + .01, Math.min(length, (a + b) * .994));
    direction.scaleInPlace(1 / Math.max(1e-6, length));
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    pole.subtractToRef(shoulder, bend);
    bend.subtractInPlace(direction.scaleToRef(Vector3.Dot(bend, direction), tmp));
    if (bend.lengthSquared() < 1e-8) bend.copyFromFloats(0, -1, 0);
    bend.normalize();
    elbow.copyFrom(shoulder).addInPlace(direction.scaleToRef(along, tmp)).addInPlace(bend.scaleInPlace(Math.sqrt(Math.max(0, a * a - along * along))));
    target.copyFrom(shoulder).addInPlace(direction.scaleToRef(distance, tmp));
    elbow.subtractToRef(shoulder, upperDir).normalize(); target.subtractToRef(elbow, foreDir).normalize();
    // Flexion axis: rotating the upper-arm direction about it moves toward the forearm.
    Vector3.CrossToRef(upperDir, foreDir, hinge); hinge.normalize();
    orient(this.upper, this.upperAxis, this.upperHinge, upperDir, hinge);
    orient(this.forearm, this.foreAxis, this.foreHinge, foreDir, hinge);
    orient(this.hand, this.handAxis, this.handBack, fingers, back);
    this.forearmDir.copyFrom(foreDir);
  }
}

/** The three index phalanges of one hand, curled about the modelled grip's own axis; the
 * knuckle also spreads within the palm plane (about the back-of-hand axis). */
class IndexFinger {
  private readonly axes: Vector3[];
  private readonly spreadAxis: Vector3;
  /** Smoothed per-joint curl relative to the modelled grip, then the knuckle spread. */
  readonly curl = [0, 0, 0, 0];
  constructor(readonly nodes: TransformNode[], bones: Bone[], side: number) {
    this.axes = bones.map((bone) => restLocal(bone, restCurl(side)));
    this.spreadAxis = restLocal(bones[0], restBack(side)).scaleInPlace(side);
  }
  follow(target: Curl | number[], k: number): void { for (let i = 0; i < 4; i++) this.curl[i] += (target[i] - this.curl[i]) * k; }
  apply(extra = 0): void {
    if (Math.abs(this.curl[3]) > 1e-5) this.nodes[0].rotate(this.spreadAxis, this.curl[3], Space.LOCAL);
    for (let i = 0; i < 3; i++) this.nodes[i].rotate(this.axes[i], this.curl[i] + extra * (i === 0 ? .6 : 1), Space.LOCAL);
  }
  tip(): Vector3 {
    const last = this.nodes[2];
    return Vector3.TransformCoordinates(new Vector3(0, INDEX_TIP, 0), last.computeWorldMatrix(true));
  }
}

/** Rear-most point of the butt pad (unscaled weapon coordinates), measured from the mesh. */
function measureButt(container: AssetContainer): Vector3 {
  let max = -Infinity;
  const points: Vector3[] = [];
  for (const mesh of container.meshes) {
    const data = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!data || /mag|pump|bolt|shell/.test(mesh.name)) continue;
    for (let i = 0; i < data.length; i += 3) {
      const p = new Vector3(data[i], data[i + 1], data[i + 2]);
      if (p.z > max - .015) { if (p.z > max) max = p.z; points.push(p); }
    }
  }
  const pad = points.filter((p) => p.z > max - .012);
  if (!pad.length) return Vector3.Zero();
  const ys = pad.map((p) => p.y);
  return new Vector3(0, (Math.min(...ys) + Math.max(...ys)) / 2, max);
}

/** Scene-local copies of the same GLBs used by the first-person weapon view. */
export class CharacterWeaponLibrary {
  private readonly containers = new Map<WeaponId, AssetContainer>();
  private readonly butts = new Map<WeaponId, Vector3>();
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
      this.butts.set(id, measureButt(container));
    }).finally(() => { if (this.pending.get(id) === work) this.pending.delete(id); });
    this.pending.set(id, work);
    return work;
  }
  async ready(signal?: AbortSignal): Promise<void> {
    await Promise.all([...this.containers.values()].map(c => meshesReady(c.meshes, signal)));
  }
  create(character: CharacterInstance, id: WeaponId): CharacterWeapon | null {
    const container = this.containers.get(id);
    return container ? new CharacterWeapon(this.scene, character, id, container, this.butts.get(id)!) : null;
  }
}

/** Cosmetic weapon hold shared by remote players and the home preview. Layers, each
 * blended by elapsed time: animated locomotion clip (torso), look pitch, ADS, shoulders,
 * gameplay action (reload/pump/bolt hand work), recoil, landing, breathing and fingers.
 * Server collision, gameplay timing and the first-person weapon are untouched. */
export class CharacterWeapon {
  readonly root: TransformNode;
  readonly meshes: Mesh[];
  readonly hold: WeaponHold;
  private readonly entries: InstantiatedEntries;
  private readonly arms: ArmChain[] = [];
  private readonly fingers: IndexFinger[] = [];
  private readonly clavicles: (TransformNode | null)[];
  /** Animated rotations of the posed joints this frame (reused, restored before animation). */
  private readonly saved = new Map<TransformNode, { rotation: Quaternion; active: boolean }>();
  private readonly posed: TransformNode[];
  /** Clavicles then shoulder joints (parents first): refreshed after the torso and the shrug. */
  private readonly shoulderJoints: TransformNode[];
  private readonly spine: TransformNode | null;
  private readonly chest: TransformNode | null;
  private readonly neck: TransformNode | null;
  private readonly head: TransformNode | null;
  private readonly eyeLocal: Vector3 | null;
  private readonly flash: RemoteMuzzleFlash;
  private readonly grips: TransformNode[];
  private readonly anchors: Record<'grip_r' | 'grip_l' | 'sight' | 'butt' | 'muzzle' | ActionAnchor, Vector3>;
  private readonly parts: { mag: TransformNode | null; pump: TransformNode | null; bolt: TransformNode | null; shell: TransformNode | null };
  private readonly state: HoldState = { pitch: 0, ads: 0, airborne: false, action: 'idle', progress: 0 };
  /** Third-order ADS follower: starts gently and settles (95%) in ~150 ms. */
  private readonly adsStages = [0, 0, 0];
  private adsBlend = 0;
  private action: ActionPose = actionPose('rifle', 'idle', 0);
  private readonly recoil: DampedSpring;
  private readonly landing = new DampedSpring(15, .6);
  private dt = 0;
  private wasAirborne = false;
  private breath = Math.random() * 10;
  private shots = 0;
  /** Seconds since the last shot (trigger finger stays on through bursts), trigger pull pulse. */
  private sinceShot = Infinity;
  private pull = 0;
  private onTrigger = 0;
  private readonly fingerTarget = [0, 0, 0, 0];
  private readonly handTargets: HandTarget[];
  private slide = 0;
  private weld = { angle: 0, residual: 0 };
  private readonly shoulders = [0, 0, 0, 0];
  /** Constant hold vectors, scaled where they are weapon-space offsets. */
  private readonly readyAt: Vector3;
  private readonly adsAt: Vector3;
  private readonly readyTurn: Quaternion;
  private readonly adsTurn: Quaternion;
  private readonly gripScaled: Vector3;
  private readonly buttScaled: Vector3;
  /** This frame's torso frame and chest joint (character-root space) for body targets. */
  private readonly torso = Quaternion.Identity();
  private readonly chestAt = Vector3.Zero();
  /** Disabled only when the instance cannot be seen; smoothing still advances. */
  posing = true;
  /** Solve every Nth posed frame (distant players); other frames reuse the last solve. */
  solveEvery = 1;
  private frame = 0;
  private readonly cache = new Map<TransformNode, Quaternion>();
  private readonly cachedRoot = { position: Vector3.Zero(), rotation: Quaternion.Identity(), valid: false };
  solves = 0;

  constructor(scene: Scene, private readonly character: CharacterInstance, readonly id: WeaponId, container: AssetContainer, butt: Vector3) {
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
    const node = (name: string) => nodes.find((n) => n.name === `held:${id}:${name}`) ?? null;
    // Moving parts animate with the third-person hand work; the loose shell rides in the hand.
    this.parts = { mag: node('mag'), pump: node('pump'), bolt: node('bolt'), shell: node('shell') };
    this.parts.shell?.setEnabled(false);
    for (const part of Object.values(this.parts)) if (part) part.rotationQuaternion ??= Quaternion.Identity();
    this.grips = ['grip_r', 'grip_l'].map((name) => node(name)!).filter(Boolean);
    // Anchor positions relative to the weapon root (unscaled); the GLB roots are identity.
    const local = (name: string) => node(name)?.position.clone() ?? Vector3.Zero();
    this.anchors = { grip_r: local('grip_r'), grip_l: local('grip_l'), sight: local('sight'), butt, muzzle: local('muzzle'),
      mag_grip: local('mag_grip'), port: local('port'), bolt_grip: local('bolt_grip') };
    this.flash=new RemoteMuzzleFlash(scene,this.root,this.anchors.muzzle);
    // The bolt turns about the bore axis, as in the first-person view.
    this.parts.bolt?.setPivotPoint(new Vector3(0, this.anchors.muzzle.y, 0));
    const bones = character.entries.skeletons[0].bones;
    const find = (name: string) => bones.find((b) => b.name === name);
    const nodeOf = (name: string) => find(name)?.getTransformNode() ?? null;
    this.spine = nodeOf('spine'); this.chest = nodeOf('chest'); this.neck = nodeOf('neck'); this.head = nodeOf('head');
    this.clavicles = [nodeOf('clavicle_r'), nodeOf('clavicle_l')];
    const headBone = find('head');
    // The eye in the head joint's own frame, from the bind pose.
    this.eyeLocal = headBone ? Vector3.TransformCoordinates(EYE_REST, Matrix.Invert(restChain(headBone))) : null;
    for (const [side, suffix] of [[1, 'r'], [-1, 'l']] as const) {
      const chain = [find(`upper_arm_${suffix}`), find(`forearm_${suffix}`), find(`hand_${suffix}`)];
      const nodesFor = chain.map((b) => b?.getTransformNode());
      if (chain.some((b) => !b) || nodesFor.some((n) => !n)) continue;
      this.arms.push(new ArmChain(nodesFor[0]!, nodesFor[1]!, nodesFor[2]!, chain as [Bone, Bone, Bone], side));
      const index = [1, 2, 3].map((k) => find(`index_${k}_${suffix}`));
      if (index.every((b) => b?.getTransformNode())) this.fingers.push(new IndexFinger(index.map((b) => b!.getTransformNode()!), index as Bone[], side));
    }
    const { ready, ads } = this.hold;
    this.readyAt = vec(ready.at); this.adsAt = vec(ads.at);
    this.readyTurn = Quaternion.RotationYawPitchRoll(ready.yaw, ready.pitch, ready.roll);
    this.adsTurn = Quaternion.RotationYawPitchRoll(ads.yaw, ads.pitch, ads.roll);
    this.gripScaled = this.anchors.grip_r.scale(WEAPON_SCALE); this.buttScaled = this.anchors.butt.scale(WEAPON_SCALE);
    this.handTargets = this.hold.hands.map((hold) => ({ hold, localFingers: vec(hold.fingers).normalize(), localBack: vec(hold.back).normalize(),
      offset: vec(hold.offset), grip: Vector3.Zero(), point: Vector3.Zero(), fingers: Vector3.Zero(), back: Vector3.Zero() }));
    this.shoulderJoints = [...this.clavicles, ...this.arms.map((arm) => arm.upper)].filter((n): n is TransformNode => !!n);
    this.posed = [this.spine, this.chest, this.neck, this.head, ...this.clavicles,
      ...this.arms.flatMap((arm) => [arm.upper, arm.forearm, arm.hand]), ...this.fingers.flatMap((f) => f.nodes)]
      .filter((n): n is TransformNode => !!n);
  }
  setState(state: Partial<HoldState>): void { Object.assign(this.state, state); }
  /** Back-compatible pitch/ADS setter. */
  setPose(pitch: number, ads: number): void { this.setState({ pitch, ads: Math.max(0, Math.min(1, ads)) }); }
  /** One cosmetic recoil impulse at the actual firing cadence. */
  fire(): void {
    this.shots++; this.flash.fire();
    this.sinceShot = 0; this.pull = 1;
    // Unit-peak impulse for a single shot; rapid fire accumulates up to a cap below.
    this.recoil.velocity += this.hold.recoil.frequency * Math.E * .55;
  }
  /** Advance time-based smoothing (seconds). */
  advance(dt: number): void {
    this.flash.update();
    dt = this.dt = Math.max(0, Math.min(.1, dt));
    // Sub-steps keep the discrete cascade close to its continuous S-curve at any frame rate.
    const target = Math.max(0, Math.min(1, this.state.ads)), steps = Math.ceil(dt / .004);
    const k = 1 - Math.exp(-dt / steps / ADS_STAGE_TIME);
    for (let n = 0; n < steps; n++) {
      let input = target;
      for (let i = 0; i < this.adsStages.length; i++) input = this.adsStages[i] += (input - this.adsStages[i]) * k;
    }
    this.adsBlend = this.adsStages[this.adsStages.length - 1];
    this.action = actionPose(this.id, this.state.action, this.state.progress);
    this.recoil.update(dt);
    if (this.wasAirborne && !this.state.airborne) this.landing.velocity -= .9;
    this.wasAirborne = this.state.airborne;
    this.landing.update(dt);
    this.breath += dt;
    this.sinceShot += dt;
    this.pull *= Math.exp(-dt / .045);
    // Finger on the trigger while aiming or shooting, never while the gun is being worked.
    const wanted = !this.action.busy && (this.state.ads > .5 || this.sinceShot < .6) ? 1 : 0;
    this.onTrigger += (wanted - this.onTrigger) * (1 - Math.exp(-dt / .07));
    const [trigger, support] = this.fingers;
    const fk = 1 - Math.exp(-dt / .06), index = this.hold.index, want = this.fingerTarget;
    // Working the bolt, the index closes around the knob with the other fingers (modelled curl).
    for (let i = 0; i < 4; i++) want[i] = (index.off[i] + (index.on[i] - index.off[i]) * this.onTrigger) * (1 - this.action.bolt);
    trigger?.follow(want, fk);
    // The support index wraps whatever the hand is holding when it leaves the fore-end.
    for (let i = 0; i < 4; i++) want[i] = index.support[i] * (1 - this.action.support);
    support?.follow(want, fk);
  }
  restore(): void {
    this.saved.forEach((slot, node) => { if (slot.active) { node.rotationQuaternion?.copyFrom(slot.rotation); slot.active = false; } });
  }
  private save(node: TransformNode): void {
    if (!node.rotationQuaternion) return;
    const slot = this.saved.get(node);
    if (!slot) this.saved.set(node, { rotation: node.rotationQuaternion.clone(), active: true });
    else if (!slot.active) { slot.rotation.copyFrom(node.rotationQuaternion); slot.active = true; }
  }
  /** Apply after the engine evaluates the locomotion clips this frame. */
  update(): void {
    if (!this.chest || !this.posing) return;
    for (const node of this.posed) this.save(node);
    if (this.solveEvery > 1 && this.cachedRoot.valid && ++this.frame % this.solveEvery !== 0) { this.reuse(); return; }
    this.solve();
    this.solves++;
    for (const node of this.posed) {
      const cached = this.cache.get(node);
      if (cached) cached.copyFrom(node.rotationQuaternion!); else this.cache.set(node, node.rotationQuaternion!.clone());
    }
    this.cachedRoot.position.copyFrom(this.root.position); this.cachedRoot.rotation.copyFrom(this.root.rotationQuaternion!);
    this.cachedRoot.valid = true;
  }
  /** Distant players: the last solved bone rotations and weapon transform, relative to the
   * animated character root, which still moves and plays its clips every frame. */
  private reuse(): void {
    this.cache.forEach((rotation, node) => node.rotationQuaternion!.copyFrom(rotation));
    this.root.position.copyFrom(this.cachedRoot.position); this.root.rotationQuaternion!.copyFrom(this.cachedRoot.rotation);
  }
  /** Torso orientation in character-root space, from joints fixed to the chest. */
  private torsoFrame(inverse: Matrix, out: Quaternion): Quaternion {
    const t = poseScratch, [r, l] = this.clavicles.length === 2 && this.clavicles.every(Boolean) ? this.clavicles : [this.arms[0].upper, this.arms[1].upper];
    Vector3.TransformCoordinatesToRef(r!.getAbsolutePosition(), inverse, t.right);
    t.right.subtractInPlace(Vector3.TransformCoordinatesToRef(l!.getAbsolutePosition(), inverse, t.tmp)).normalize();
    if (this.neck && this.chest) {
      Vector3.TransformCoordinatesToRef(this.neck.getAbsolutePosition(), inverse, t.up);
      t.up.subtractInPlace(Vector3.TransformCoordinatesToRef(this.chest.getAbsolutePosition(), inverse, t.tmp));
    } else t.up.set(0, 1, 0);
    t.up.subtractInPlace(t.right.scaleToRef(Vector3.Dot(t.up, t.right), t.tmp)).normalize();
    Quaternion.RotationQuaternionFromAxisToRef(t.right, t.up, Vector3.CrossToRef(t.right, t.up, t.tmp), out);
    return out;
  }
  private solve(): void {
    const ads = Math.max(0, Math.min(1, this.adsBlend)), ready = 1 - ads, action = this.action, t = poseScratch;
    const recoil = clamp(this.recoil.value, -.4, 1.6);
    const pitch = clamp(this.state.pitch, -1.25, 1.25);
    const root = this.character.root;
    root.computeWorldMatrix(true);
    const world = root.getWorldMatrix();
    const right = Vector3.TransformNormalToRef(Vector3.RightReadOnly, world, t.axisRight).normalize();
    const forward = Vector3.TransformNormalToRef(Vector3.Forward(true), world, t.axisForward).normalize();
    const up = Vector3.TransformNormalToRef(Vector3.UpReadOnly, world, t.axisUp).normalize();
    // Bladed stance: the support shoulder turns toward the fore-end (more in ADS) while the
    // head counter-turns to keep facing the look; the torso follows the look pitch, ADS
    // leans in and recoil is absorbed by the chest. Rotations are about the root's axes.
    const twist = this.hold.twist[0] * ready + this.hold.twist[1] * ads;
    turn(this.spine, up, -twist * .4);
    turn(this.spine, right, pitch * .18);
    this.spine?.computeWorldMatrix(true);
    turn(this.chest, up, -twist * .6);
    turn(this.chest, right, pitch * .2 - ads * .07 + recoil * this.hold.recoil.torso);
    this.chest!.computeWorldMatrix(true);
    this.neck?.computeWorldMatrix(true);
    turn(this.head, up, twist);
    // The head turns by the whole look pitch (spine + chest + head = 1); the cheek weld
    // below adds the drop onto the stock and a slight tilt toward it.
    turn(this.head, right, pitch * .62);
    turn(this.head, forward, ads * .12);
    this.head?.computeWorldMatrix(true);
    const [rightArm, leftArm] = this.arms;
    if (!rightArm || !leftArm) return;
    const inverse = world.invertToRef(t.inverse);
    // The ready hold was calibrated around the shoulder joints before any shrug.
    refresh(this.shoulderJoints);
    const centre = Vector3.TransformCoordinatesToRef(rightArm.upper.getAbsolutePosition(), inverse, t.centre);
    centre.addInPlace(Vector3.TransformCoordinatesToRef(leftArm.upper.getAbsolutePosition(), inverse, t.tmp)).scaleInPlace(.5);
    const torso = this.torsoFrame(inverse, this.torso);
    Vector3.TransformCoordinatesToRef(this.chest!.getAbsolutePosition(), inverse, this.chestAt);
    // Shoulders: support reach, ADS lift into the stock, recoil pushes the firing side back.
    const base = this.shoulders;
    for (let i = 0; i < 4; i++) base[i] = SHOULDERS_READY[i] * ready + SHOULDERS_ADS[i] * ads + action.clavicles[i];
    base[0] += recoil * .03; base[1] -= recoil * .06;
    const elevate = Vector3.TransformNormalToRef(t.tmp.set(0, 0, 1).applyRotationQuaternionInPlace(torso), world, t.elevate).normalize();
    const protract = Vector3.TransformNormalToRef(t.tmp.set(0, 1, 0).applyRotationQuaternionInPlace(torso), world, t.protract).normalize();
    for (let i = 0; i < 2; i++) {
      const side = i ? -1 : 1;
      turn(this.clavicles[i], elevate, side * base[i * 2]);
      turn(this.clavicles[i], protract, side * base[i * 2 + 1]);
    }
    refresh(this.shoulderJoints);
    // Breathing sway fades in ADS; the ready frame pitches around the shoulders.
    const sway = Math.sin(this.breath * 1.9), drift = Math.sin(this.breath * 1.1 + 1.3);
    const aim = Quaternion.RotationAxisToRef(Vector3.RightReadOnly, pitch * .72, t.aim);
    const readyQ = aim.multiplyToRef(this.readyTurn, t.readyQ);
    const readyPos = t.readyPos.copyFrom(centre).addInPlace(this.readyAt.applyRotationQuaternionToRef(aim, t.tmp))
      .subtractInPlace(this.gripScaled.applyRotationQuaternionToRef(readyQ, t.tmp));
    // ADS: the butt pad sits in the shoulder pocket (a torso landmark next to the lifted
    // shoulder joint) and the weapon points along the full look direction.
    const adsQ = Quaternion.RotationAxisToRef(Vector3.RightReadOnly, pitch, t.adsQ).multiplyInPlace(this.adsTurn);
    const adsPos = Vector3.TransformCoordinatesToRef(rightArm.upper.getAbsolutePosition(), inverse, t.adsPos)
      .addInPlace(this.adsAt.applyRotationQuaternionToRef(torso, t.tmp)).subtractInPlace(this.buttScaled.applyRotationQuaternionToRef(adsQ, t.tmp2));
    const rotation = Quaternion.SlerpToRef(readyQ, adsQ, ads, this.root.rotationQuaternion!);
    const position = Vector3.LerpToRef(readyPos, adsPos, ads, this.root.position);
    // Gameplay action: the weapon tilts toward the working hand (aim frame offsets).
    const w = action.weapon;
    position.addInPlace(t.tmp.set(w[0], w[1], w[2]).applyRotationQuaternionInPlace(aim));
    rotation.multiplyInPlace(Quaternion.RotationYawPitchRollToRef(w[3], w[4], w[5], t.turn));
    const motion = 1 - .75 * ads;
    rotation.multiplyInPlace(Quaternion.RotationYawPitchRollToRef(drift * .008 * motion, sway * .01 * motion + recoil * this.hold.recoil.rise, 0, t.turn));
    position.y += sway * .003 * motion + this.landing.value * .05;
    // Recoil drives the weapon straight back along its own bore.
    position.addInPlace(t.tmp.set(0, 0, recoil * this.hold.recoil.kick).applyRotationQuaternionInPlace(rotation));
    this.animateParts();
    this.slide = 0;
    this.solveArms(ready, ads, aim, true);
    // ADS: an out-of-reach support hand slides back along the fore-end; anything left over
    // pulls the whole weapon toward the shoulders (along the bore in ADS), never a hand off.
    if (leftArm.reach > .002 && ads > .01 && action.support < .5) {
      this.slide = Math.min(.09, leftArm.reach + .004) * ads;
      this.solveArms(ready, ads, aim, false);
    }
    const overreach = Math.max(rightArm.reach, leftArm.reach);
    if (overreach > .002) {
      const toCentre = centre.subtractToRef(position, t.tmp).normalize();
      const back = t.tmp2.set(0, 0, 1).applyRotationQuaternionInPlace(rotation);
      position.addInPlace(Vector3.LerpToRef(toCentre, back, ads, t.tmp).normalize().scaleInPlace(overreach + .004));
      this.solveArms(ready, ads, aim, false);
    }
    this.cheekWeld(ads);
    for (let i = 0; i < this.fingers.length; i++) this.fingers[i].apply(i === 0 ? this.pull * .32 : 0);
  }
  /** Magazine, pump, bolt and shell follow the action (unscaled weapon coordinates); the
   * magazine and the loose shell travel with the support hand's actual target. */
  private animateParts(): void {
    const { mag, pump, bolt, shell } = this.parts, a = this.action;
    if (pump) pump.position.z = a.pump;
    if (bolt) {
      Quaternion.RotationAxisToRef(Vector3.Forward(), a.boltMotion[0], bolt.rotationQuaternion!);
      bolt.position.z = a.boltMotion[1];
    }
    const carried = (a.magazine && mag) || (a.shell && shell) ? this.supportLocal() : null;
    if (mag) {
      if (a.magazine && carried) mag.position.copyFrom(carried.subtract(this.anchors.mag_grip)); else mag.position.setAll(0);
    }
    if (shell) {
      shell.setEnabled(a.shell);
      if (a.shell && carried) shell.position.copyFrom(carried.subtract(this.anchors.port));
    }
  }
  /** The support hand's action target in unscaled weapon coordinates. */
  private supportLocal(): Vector3 {
    const a = this.action, away = this.anchors[a.supportAnchor].add(vec(a.supportOffset));
    if (a.supportBody <= 0) return away;
    // Body point (character-root space) into weapon space: the weapon root is a child of the character root.
    const body = this.chestAt.add(vec(BODY_POINTS[a.bodyPoint]).applyRotationQuaternion(this.torso));
    const toWeapon = Matrix.Compose(this.root.scaling, this.root.rotationQuaternion!, this.root.position).invert();
    return Vector3.Lerp(away, Vector3.TransformCoordinates(body, toWeapon), a.supportBody);
  }
  /** Brings the right eye toward the sight line: the neck and head drop and tilt onto the
   * stock (cheek weld), bounded so the head never folds. The weapon stays in the pocket. */
  private cheekWeld(ads: number): void {
    this.weld.angle = 0;
    if (!this.head || !this.eyeLocal || ads < .01) { this.weld.residual = 0; return; }
    const weaponWorld = this.root.computeWorldMatrix(true), w = weldScratch;
    const sight = Vector3.TransformCoordinatesToRef(this.anchors.sight, weaponWorld, w.sight);
    const bore = Vector3.TransformNormalToRef(Vector3.Forward(true), weaponWorld, w.bore).normalize();
    // The eye and its closest point on the sight line.
    const eye = () => Vector3.TransformCoordinatesToRef(this.eyeLocal!, this.head!.getWorldMatrix(), w.eye);
    const onLine = (e: Vector3) => w.target.copyFrom(sight).addInPlace(bore.scaleToRef(Vector3.Dot(e.subtractToRef(sight, w.tmp), bore), w.tmp));
    let left = CHEEK_WELD_LIMIT;
    for (let k = 0; k < 2; k++) {
      const node = k ? this.head : this.neck, share = k ? 1 : .4;
      if (!node) continue;
      const pivot = node.getAbsolutePosition(), e = eye(), target = onLine(e);
      const from = e.subtractToRef(pivot, w.from), to = target.subtractToRef(pivot, w.to);
      const axis = Vector3.CrossToRef(from, to, w.axis);
      if (axis.lengthSquared() < 1e-10) continue;
      const angle = Math.min(left, Math.acos(clamp(Vector3.Dot(from.normalize(), to.normalize()), -1, 1)) * share);
      turn(node, axis.normalize(), angle * ads);
      if (node === this.neck) node.computeWorldMatrix(true);
      this.head.computeWorldMatrix(true);
      left -= angle; this.weld.angle += angle * ads;
    }
    const e = eye();
    this.weld.residual = Vector3.Distance(e, onLine(e));
  }
  /** World-space handle centre and hand frame for each hand this frame (reused buffers). */
  private targets(): readonly HandTarget[] {
    const weaponWorld = this.root.getWorldMatrix(), a = this.action;
    for (let index = 0; index < this.arms.length; index++) {
      const target = this.handTargets[index], hand = target.hold, grip = target.grip;
      Vector3.TransformNormalToRef(target.localFingers, weaponWorld, target.fingers); target.fingers.normalize();
      Vector3.TransformNormalToRef(target.localBack, weaponWorld, target.back); target.back.normalize();
      grip.copyFrom(index ? this.anchors.grip_l : this.anchors.grip_r).addInPlace(target.offset);
      if (index === 1) {
        // The support hand rides the pump, slides back when overreaching and leaves for
        // the magazine or loading port during reloads.
        grip.z += a.pump + this.slide / WEAPON_SCALE;
        if (a.support > 0) Vector3.LerpToRef(grip, this.supportLocal(), a.support, grip);
        Vector3.TransformCoordinatesToRef(grip, weaponWorld, target.point);
      } else {
        Vector3.TransformCoordinatesToRef(grip, weaponWorld, target.point);
        if (a.bolt > 0 && this.parts.bolt) {
          // The trigger hand follows the actual (moving) bolt knob.
          const knob = Vector3.TransformCoordinates(this.anchors.bolt_grip, this.parts.bolt.computeWorldMatrix(true));
          Vector3.LerpToRef(target.point, knob, a.bolt, target.point);
        }
      }
      void hand;
    }
    return this.handTargets;
  }
  /** `ease`: the first pass this frame advances each hand's smoothed turn about its handle. */
  private solveArms(ready: number, ads: number, aim: Quaternion, ease: boolean): void {
    this.root.computeWorldMatrix(true);
    const rootWorld = this.character.root.getWorldMatrix(), t = solveScratch;
    const targets = this.targets();
    for (let index = 0; index < this.arms.length; index++) {
      const arm = this.arms[index], { point, fingers: preferred, back: backPreferred, hold: hand } = targets[index];
      // Turn about the handle toward last frame's forearm so the wrist stays straight
      // without the fingers leaving the grip; eased by elapsed time to avoid jitter.
      const axis = Vector3.CrossToRef(preferred, backPreferred, t.axis).normalize();
      const projected = arm.forearmDir.subtractToRef(axis.scaleToRef(Vector3.Dot(arm.forearmDir, axis), t.tmp), t.projected);
      if (ease && projected.lengthSquared() > 1e-4) {
        projected.normalize();
        const wanted = Math.atan2(Vector3.Dot(Vector3.CrossToRef(preferred, projected, t.tmp), axis), Vector3.Dot(preferred, projected));
        const clamped = Math.max(-hand.turn, Math.min(hand.turn, wanted));
        arm.turn += (clamped - arm.turn) * (1 - Math.exp(-this.dt / .06));
      }
      Quaternion.RotationAxisToRef(axis, arm.turn, t.spin);
      const fingers = preferred.applyRotationQuaternionToRef(t.spin, t.fingers), back = backPreferred.applyRotationQuaternionToRef(t.spin, t.back);
      // Grip anchors lie inside the weapon: the palm rests on its surface with the wrist behind.
      const wrist = t.wrist.copyFrom(point).addInPlace(back.scaleToRef(hand.depth, t.tmp)).subtractInPlace(fingers.scaleToRef(WRIST_TO_PALM, t.tmp));
      const hintA = this.hold.ready.elbows[index], hintB = this.hold.ads.elbows[index];
      t.hint.set(hintA[0] * ready + hintB[0] * ads, hintA[1] * ready + hintB[1] * ads, hintA[2] * ready + hintB[2] * ads).applyRotationQuaternionInPlace(aim);
      const pole = t.pole.copyFrom(arm.upper.getAbsolutePosition()).addInPlace(Vector3.TransformNormalToRef(t.hint, rootWorld, t.tmp));
      arm.solve(wrist, pole, fingers, back);
    }
  }
  inspect() {
    const weaponWorld = this.root.getWorldMatrix();
    const targets = this.arms.length ? this.targets() : [];
    const hands = this.arms.map((arm, index) => {
      const frame = arm.handFrame(), hold = this.hold.hands[index];
      // Where the solved hand's enclosed handle centre is, and where it should be.
      const contact = arm.hand.getAbsolutePosition().add(frame.fingers.scale(WRIST_TO_PALM)).subtractInPlace(frame.back.scale(hold.depth));
      const handle = targets[index]?.point.clone() ?? contact;
      const forearm = arm.hand.getAbsolutePosition().subtract(arm.forearm.getAbsolutePosition()).normalize();
      const upper = arm.forearm.getAbsolutePosition().subtract(arm.upper.getAbsolutePosition()).normalize();
      return { contact: contact.asArray(), handle: handle.asArray(), gap: Vector3.Distance(contact, handle),
        fingers: frame.fingers.asArray(), back: frame.back.asArray(), turn: arm.turn,
        desiredFingers: Vector3.TransformNormal(vec(hold.fingers), weaponWorld).normalize().asArray(),
        desiredBack: Vector3.TransformNormal(vec(hold.back), weaponWorld).normalize().asArray(),
        reach: arm.reach, wristBend: Math.acos(clamp(Vector3.Dot(forearm, frame.fingers), -1, 1)),
        elbowBend: Math.acos(clamp(Vector3.Dot(upper, forearm), -1, 1)),
        forearmInWeapon: Vector3.TransformNormal(forearm, Matrix.Invert(weaponWorld)).normalize().asArray(),
        elbow: arm.forearm.getAbsolutePosition().asArray(), shoulder: arm.upper.getAbsolutePosition().asArray(), rest: arm.restAxes(),
        index: this.fingers[index] ? { curl: [...this.fingers[index].curl], tip: this.local(this.fingers[index].tip()) } : null };
    });
    const trigger = Vector3.TransformCoordinates(vec(this.hold.trigger), weaponWorld);
    const tip = this.fingers[0]?.tip();
    const eye = this.head && this.eyeLocal ? Vector3.TransformCoordinates(this.eyeLocal, this.head.getWorldMatrix()) : null;
    const butt = Vector3.TransformCoordinates(this.anchors.butt, weaponWorld);
    return { id: this.id, ads: this.state.ads, adsBlend: this.adsBlend, pitch: this.state.pitch, shots: this.shots,
      recoil: this.recoil.value, meshes: this.meshes.length, posing: this.posing, solves: this.solves, solveEvery: this.solveEvery,
      instances: this.character.root.getChildTransformNodes(true).filter((n) => /^held:(rifle|smg|shotgun|sniper)$/.test(n.name)).length,
      grips: this.grips.map((g) => g.getAbsolutePosition().asArray()), hands,
      flash: this.flash.inspect(),
      muzzle: Vector3.TransformCoordinates(this.anchors.muzzle, weaponWorld).asArray(),
      // Butt pad, head joint, right eye and sight in character-root space.
      butt: this.local(butt), head: this.head ? this.local(this.head.getAbsolutePosition()) : null,
      eye: eye ? this.local(eye) : null, sight: this.local(Vector3.TransformCoordinates(this.anchors.sight, weaponWorld)),
      shoulder: this.arms[0] ? this.local(this.arms[0].upper.getAbsolutePosition()) : null,
      weld: { ...this.weld }, triggerGap: tip ? Vector3.Distance(tip, trigger) : null, onTrigger: this.onTrigger,
      action: { name: this.state.action, progress: this.state.progress, support: this.action.support, bolt: this.action.bolt,
        pump: this.action.pump, magazine: this.action.magazine, shell: this.action.shell,
        mag: this.parts.mag?.position.asArray() ?? null, boltMotion: [...this.action.boltMotion] },
      clavicles: this.clavicles.every(Boolean) ? [...this.shoulders] : null };
  }
  private local(point: Vector3): number[] {
    return Vector3.TransformCoordinates(point, Matrix.Invert(this.character.root.getWorldMatrix())).asArray().map((v) => +v.toFixed(3));
  }
  stopFiring():void{this.flash.update(Infinity);}
  muzzleWorld(): Vector3 { return Vector3.TransformCoordinates(this.anchors.muzzle,this.root.computeWorldMatrix(true)); }
  dispose(): void { this.flash.dispose(); this.restore(); this.entries.dispose(); this.root.dispose(); }
}
