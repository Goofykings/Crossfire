import { Quaternion, Vector3, type TransformNode } from '@babylonjs/core';

/** Lightweight procedural ragdoll for an eliminated character: every joint is a damped spring
 * that starts exactly at the pose the player had (running, sliding, aiming, holding daggers)
 * and relaxes toward a limp resting pose. The body's own tipping over (DeathMotion) drives the
 * limbs through inertia, so arms and legs lag, swing and settle on their own clocks. Purely
 * cosmetic and engine-light: no physics bodies, no allocation per frame beyond a few vectors.
 *
 * A joint's rotation is `target * exp(d)`: `target` is the limp pose (rest * a small offset)
 * and `d` a rotation vector in the joint's own frame that the spring pulls to zero. */

export interface LimpSpec {
  name: string;
  /** Limp offset from the rest pose about the joint's local X, Y, Z (radians). */
  offset: [number, number, number];
  /** Natural frequency (Hz) and damping ratio; knees use high damping so they never hyperextend. */
  hz: number; zeta: number;
  /** How strongly the body's tipping rotation lags into this joint (rad/s² per rad/s). */
  gain: number;
  /** Keep the captured pose (fingers, wrist details) instead of relaxing. */
  hold?: boolean;
  /** Mirror lateral offsets between the left and right limb. */
  side?: 1 | -1;
  /** The limb comes to rest on the floor: its target direction follows gravity (see `child`). */
  floor?: boolean;
  /** Child joint whose position gives the bone direction (for `floor`). */
  child?: string;
}

/** Joints in parent-first order. Offsets are relative to the rest (A-pose) the rig was
 * exported in; arms stay close to it (a limp arm falls to the ground beside the body). */
export const LIMP_SPECS: LimpSpec[] = [
  { name: 'pelvis', offset: [0, 0, 0], hz: 1.6, zeta: .8, gain: 0 },
  { name: 'spine', offset: [.05, 0, 0], hz: 1.4, zeta: .75, gain: 2.2 },
  { name: 'chest', offset: [.04, 0, 0], hz: 1.3, zeta: .75, gain: 2.6 },
  { name: 'neck', offset: [.1, 0, 0], hz: 1.5, zeta: .4, gain: 5 },
  { name: 'head', offset: [.08, 0, 0], hz: 1.3, zeta: .35, gain: 6 },
  ...(['l', 'r'] as const).flatMap((s): LimpSpec[] => {
    const side = s === 'l' ? 1 : -1;
    return [
      { name: `clavicle_${s}`, offset: [0, 0, 0], hz: 1.6, zeta: .8, gain: 1.5, side },
      { name: `upper_arm_${s}`, offset: [-.1, 0, .05], hz: 1.15, zeta: .42, gain: 7.5, side, floor: true, child: `forearm_${s}` },
      { name: `forearm_${s}`, offset: [.32, 0, 0], hz: 1.3, zeta: .5, gain: 6, side },
      { name: `hand_${s}`, offset: [.12, 0, 0], hz: 1.6, zeta: .45, gain: 4, side },
      { name: `index_1_${s}`, offset: [0, 0, 0], hz: 1, zeta: 1, gain: 0, hold: true, side },
      { name: `index_2_${s}`, offset: [0, 0, 0], hz: 1, zeta: 1, gain: 0, hold: true, side },
      { name: `index_3_${s}`, offset: [0, 0, 0], hz: 1, zeta: 1, gain: 0, hold: true, side },
    ];
  }),
  ...(['l', 'r'] as const).flatMap((s): LimpSpec[] => {
    const side = s === 'l' ? 1 : -1;
    return [
      { name: `thigh_${s}`, offset: [.04, 0, .1], hz: 1.5, zeta: .55, gain: 4, side },
      { name: `shin_${s}`, offset: [-.05, 0, 0], hz: 1.7, zeta: .95, gain: 2.5, side },
      { name: `foot_${s}`, offset: [-.32, 0, .12], hz: 1.4, zeta: .6, gain: 3, side },
    ];
  }),
];

/** Small deterministic generator, so a given elimination always falls the same way. */
export function limpRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

interface Joint {
  node: TransformNode; spec: LimpSpec;
  target: Quaternion; targetInverse: Quaternion;
  /** Rest rotation of the chain above the joint, relative to the character root (parent frame). */
  parentRest: Quaternion;
  /** Floor-resting limbs: target without gravity, and the bone direction at rest (character frame). */
  baseTarget: Quaternion; restDir: Vector3 | null;
  d: Vector3; v: Vector3;
  k: number; c: number; delay: number; gain: number;
}

const tmpQ = new Quaternion(), tmpQ2 = new Quaternion(), tmpV = new Vector3(), tmpD = new Vector3(), tmpA = new Vector3();

/** Rotation vector (axis * angle) of a quaternion, along the shortest arc. */
function logQuat(q: Quaternion, out: Vector3): Vector3 {
  const s = q.w < 0 ? -1 : 1, x = q.x * s, y = q.y * s, z = q.z * s, w = q.w * s;
  const sin = Math.hypot(x, y, z);
  if (sin < 1e-8) return out.set(0, 0, 0);
  const angle = 2 * Math.atan2(sin, w);
  return out.set(x / sin * angle, y / sin * angle, z / sin * angle);
}
function expQuat(v: Vector3, out: Quaternion): Quaternion {
  const angle = v.length();
  if (angle < 1e-8) return out.set(0, 0, 0, 1);
  const s = Math.sin(angle / 2) / angle;
  return out.set(v.x * s, v.y * s, v.z * s, Math.cos(angle / 2));
}

export class LimpBody {
  private readonly joints: Joint[] = [];
  private time = 0;
  private lastAngle = 0;
  private restPelvis: Vector3 | null = null;
  private basePelvis = Vector3.Zero();
  private pelvisNode: TransformNode | null = null;

  /** `rest` maps every bone node to its bind rotation (captured before any animation ran), and
   * `top` is the character root: the chain product up to it gives each joint's parent frame. */
  constructor(nodes: Map<string, TransformNode>, rest: Map<TransformNode, Quaternion>, top: TransformNode,
    restPelvisPosition: Vector3 | null, seed: number, specs: LimpSpec[] = LIMP_SPECS) {
    const random = limpRandom(seed);
    for (const spec of specs) {
      const node = nodes.get(spec.name);
      if (!node?.rotationQuaternion) continue;
      const rr = rest.get(node) ?? node.rotationQuaternion;
      const side = spec.side ?? 1;
      // Each limb gets its own relaxation: a little asymmetry in every offset, frequency and delay.
      const jitter = (amount: number) => (random() * 2 - 1) * amount;
      const offset: [number, number, number] = spec.hold ? [0, 0, 0] : [spec.offset[0] + jitter(.12), spec.offset[1] + jitter(.06), spec.offset[2] * side + jitter(.1)];
      const target = spec.hold ? node.rotationQuaternion.clone() : rr.multiply(Quaternion.FromEulerAngles(offset[0], offset[1], offset[2]));
      const hz = spec.hz * (.88 + random() * .24), k = (2 * Math.PI * hz) ** 2;
      const joint: Joint = {
        node, spec, target, targetInverse: Quaternion.Inverse(target), parentRest: Quaternion.Identity(), baseTarget: target.clone(), restDir: null,
        d: Vector3.Zero(), v: Vector3.Zero(), k, c: 2 * spec.zeta * Math.sqrt(k), delay: random() * .07, gain: spec.gain * (.8 + random() * .4),
      };
      // Chain product of the bind rotations above the joint, down from the character root.
      const chain: Quaternion[] = [];
      for (let p = node.parent as TransformNode | null; p && p !== top; p = p.parent as TransformNode | null) chain.push(rest.get(p) ?? p.rotationQuaternion ?? Quaternion.Identity());
      for (let i = chain.length - 1; i >= 0; i--) joint.parentRest.multiplyInPlace(chain[i]);
      if (spec.floor && spec.child) {
        const childPosition = nodes.get(spec.child)?.position;
        if (childPosition && childPosition.lengthSquared() > 1e-10) {
          // Bone direction at rest in the character frame: the child's offset along the bone, turned
          // by the chain's bind rotations and this joint's own.
          joint.restDir = childPosition.clone().normalize().applyRotationQuaternionInPlace(joint.parentRest.multiply(rr)).normalize();
        }
      }
      this.joints.push(joint);
    }
    const pelvis = nodes.get('pelvis');
    this.pelvisNode = pelvis ?? null; this.restPelvis = restPelvisPosition;
  }

  get jointCount(): number { return this.joints.length; }

  /** Freeze the pose the character has right now as the start of the relaxation. */
  capture(): void {
    this.time = 0; this.lastAngle = 0;
    for (const j of this.joints) {
      logQuat(j.targetInverse.multiply(j.node.rotationQuaternion!), j.d);
      j.v.set(0, 0, 0);
    }
    if (this.pelvisNode) this.basePelvis.copyFrom(this.pelvisNode.position);
  }

  /** Advance to `elapsed` seconds after the elimination and write every joint. `angle` is the
   * body's tipping angle and `axis` its rotation axis in the character's pre-fall frame. */
  pose(elapsed: number, angle: number, axis: Vector3): void {
    const step = 1 / 120;
    let rate = 0;
    const dt = Math.max(0, elapsed - this.time);
    if (dt > 1e-6) {
      rate = Math.max(0, (angle - this.lastAngle) / dt);
      for (let t = 0; t < dt - 1e-9; t += step) this.integrate(Math.min(step, dt - t), this.time + t, rate, axis);
      this.time = elapsed; this.lastAngle = angle;
    }
    this.restOnFloor(angle, axis);
    for (const j of this.joints) {
      expQuat(j.d, tmpQ);
      j.target.multiplyToRef(tmpQ, j.node.rotationQuaternion!);
    }
    if (this.pelvisNode && this.restPelvis) {
      // The hips return to their standing height so every pose lands in the same lying shape.
      const u = Math.min(1, elapsed / .35), e = u * u * (3 - 2 * u);
      Vector3.LerpToRef(this.basePelvis, this.restPelvis, e, this.pelvisNode.position);
    }
  }

  /** Limbs that rest on the floor follow gravity: once the body lies down, an arm that would point
   * into the floor or hang in the air (a body on its side) swings to lie flat on it. For a body on
   * its back the A-pose arms already lie on the floor and barely change. */
  private restOnFloor(angle: number, axis: Vector3): void {
    const lie = Math.max(0, Math.min(1, (angle - .25) / (Math.PI * .3))), fraction = lie * lie * (3 - 2 * lie);
    for (const j of this.joints) {
      if (!j.restDir) continue;
      if (fraction <= 0) { j.target.copyFrom(j.baseTarget); j.targetInverse.copyFrom(Quaternion.Inverse(j.baseTarget)); continue; }
      // Gravity in the character's frame once the body has tipped `angle` about `axis`.
      expQuat(tmpA.copyFrom(axis).normalize().scaleInPlace(-angle), tmpQ);
      const g = tmpV.set(0, -1, 0).applyRotationQuaternionInPlace(tmpQ);
      const c = Vector3.Dot(j.restDir, g);
      // Flat on the floor, tipped slightly into it so the arm touches rather than hovers.
      const flat = tmpD.copyFrom(j.restDir).addInPlace(tmpA.copyFrom(g).scaleInPlace(.12 - c)).normalize();
      const wanted = Vector3.Lerp(j.restDir, flat, fraction).normalize();
      Quaternion.FromUnitVectorsToRef(j.restDir, wanted, tmpQ);
      // Turn the rotation (character frame) into the joint's parent frame, ahead of its own offsets.
      const pr = j.parentRest;
      Quaternion.Inverse(pr).multiplyToRef(tmpQ, tmpQ2);
      tmpQ2.multiplyToRef(pr, tmpQ2);
      tmpQ2.multiplyToRef(j.baseTarget, j.target);
      Quaternion.InverseToRef(j.target, j.targetInverse);
    }
  }

  private integrate(dt: number, at: number, rate: number, axis: Vector3): void {
    for (const j of this.joints) {
      if (j.spec.hold || at < j.delay) continue;
      // Inertia: as the body rotates about `axis` the limb stays behind, i.e. rotates about -axis
      // relative to it. Express that in the joint's own frame (parent frame, then target frame).
      tmpA.copyFrom(axis).scaleInPlace(-j.gain * rate);
      tmpV.copyFrom(tmpA).applyRotationQuaternionInPlace(Quaternion.InverseToRef(j.parentRest, tmpQ));
      tmpD.copyFrom(tmpV).applyRotationQuaternionInPlace(j.targetInverse);
      // Semi-implicit Euler: stable at the 120 Hz step for every frequency used here.
      j.v.x += (-j.k * j.d.x - j.c * j.v.x + tmpD.x) * dt;
      j.v.y += (-j.k * j.d.y - j.c * j.v.y + tmpD.y) * dt;
      j.v.z += (-j.k * j.d.z - j.c * j.v.z + tmpD.z) * dt;
      j.d.x += j.v.x * dt; j.d.y += j.v.y * dt; j.d.z += j.v.z * dt;
    }
  }

  /** Largest remaining rotation (radians) between a joint and its limp pose. */
  settled(): number {
    let worst = 0;
    for (const j of this.joints) if (!j.spec.hold) worst = Math.max(worst, j.d.length());
    return worst;
  }
  /** Joint rotation relative to its limp target (test/diagnostic). */
  jointOffset(name: string): number | null {
    const j = this.joints.find((x) => x.spec.name === name);
    return j ? j.d.length() : null;
  }
}
