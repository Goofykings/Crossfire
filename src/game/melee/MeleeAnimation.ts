import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Presentation-only dual-dagger animation: clip sampling, crossfades and the equip/attack/
 * unequip state machine. No damage, hit or timing authority lives here; the combat layer
 * reads the same timing metadata (daggers.json) and drives this through play/attack calls.
 * Engine-free apart from Babylon's math types, so it is unit tested in Node. */

export type MeleeClipName = 'equip' | 'idle' | 'attack_cross' | 'attack_forward' | 'attack_finisher' | 'unequip' | 'flourish_r' | 'flourish_l';
export const MELEE_CLIPS: readonly MeleeClipName[] = ['equip', 'idle', 'attack_cross', 'attack_forward', 'attack_finisher', 'unequip', 'flourish_r', 'flourish_l'];
/** Cosmetic idle spins: they play only from the guard and never touch gameplay state. */
export const FLOURISH_CLIPS: readonly MeleeClipName[] = ['flourish_r', 'flourish_l'];
export type MeleeStage = 1 | 2 | 3;
type Window = [number, number];

/** One clip's timing (seconds from the clip start), exported by blender/melee/dagger_design.py. */
export interface MeleeClipMeta {
  name: MeleeClipName; duration: number; loop: boolean;
  /** Crossfade into this clip from whatever is playing. */
  blendIn: number;
  anticipation?: Window;
  /** Visual contact window, for gameplay synchronization (no damage is encoded here). */
  contact?: Window;
  /** Earliest time the next combo stage may start (chained attacks blend from here). */
  chainFrom?: number;
  /** From here the clip returns to the guard pose. */
  recovery?: number;
  /** Blade trail window. */
  trail?: Window;
  flourish?: Window;
  /** Equip: the gun lowers over gunDown and is hidden at gunHidden; hands leave it over `hands`. */
  gunDown?: Window; gunHidden?: number; reveal?: Window;
  /** Unequip: the daggers are hidden at `hidden`, the gun rises over gunUp, hands return over `hands`. */
  hidden?: number; gunUp?: Window; hands?: Window;
  next?: MeleeClipName; stage?: MeleeStage;
}
export interface MeleeHoldMeta { fingers: number[]; back: number[]; depth: number }
export interface MeleeModelMeta { file: string; triangles: number; length: number;
  anchors: Record<'grip' | 'tip' | 'edge' | 'guard' | 'pommel' | 'spin_pivot', number[]>; bounds: { min: number[]; max: number[] } }
export interface MeleeMetadata {
  version: 1; fps: number;
  hold: { r: MeleeHoldMeta; l: MeleeHoldMeta };
  spin: { pivot: number[]; axis: number[]; twirlAxis: number[] };
  /** First-person framing: the shoulder midpoint from the eye (camera space; the whole arm rig
   * moves, so arm geometry equals third person) and the share of the torso channel applied to
   * the camera-mounted arms. */
  firstPerson: { shoulders: number[]; body: number };
  combo: MeleeClipName[];
  /** Idle flourish clips and the random gap between them (seconds). */
  flourish: { clips: MeleeClipName[]; interval: [number, number] };
  clips: Record<MeleeClipName, MeleeClipMeta>;
  models: { r: MeleeModelMeta; l: MeleeModelMeta };
  arms: { file: string; triangles: number };
  clipsFile: string;
  checkpoints: Record<MeleeClipName, { t: number; hand_r: number[]; hand_l: number[]; tip_r: number[]; tip_l: number[]; scale_r: number; scale_l: number }[]>;
}

/** Animated node names in dagger_clips.glb (per side `_r` / `_l`, plus `body`). */
export type MeleeNode = 'socket_r' | 'socket_l' | 'spin_r' | 'spin_l' | 'spin_back_r' | 'spin_back_l' | 'twirl_r' | 'twirl_l'
  | 'carry_r' | 'carry_l' | 'pole_r' | 'pole_l' | 'body';
export const MELEE_NODES: readonly MeleeNode[] = ['socket_r', 'socket_l', 'spin_r', 'spin_l', 'spin_back_r', 'spin_back_l',
  'twirl_r', 'twirl_l', 'carry_r', 'carry_l', 'pole_r', 'pole_l', 'body'];

/** Linear keys sampled at the export rate: times in seconds, values packed per key. */
export interface Track { times: Float32Array; values: Float32Array; size: 3 | 4 }
export interface NodeTracks { position?: Track; rotation?: Track; scale?: Track }
/** Static transform of a node, used where a clip has no track for a property. */
export interface NodeRest { position: Vector3; rotation: Quaternion; scale: Vector3 }

/** Translation, rotation and scale of every melee node at one instant. */
export class NodeSample {
  readonly position = Vector3.Zero(); readonly rotation = Quaternion.Identity(); readonly scale = Vector3.One();
  copyFrom(o: NodeSample): this { this.position.copyFrom(o.position); this.rotation.copyFrom(o.rotation); this.scale.copyFrom(o.scale); return this; }
}
export type RigSample = Record<MeleeNode, NodeSample>;
export const rigSample = (): RigSample => Object.fromEntries(MELEE_NODES.map((n) => [n, new NodeSample()])) as RigSample;

function locate(times: Float32Array, t: number): number {
  let lo = 0, hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  return lo;
}
const qa = new Quaternion(), qb = new Quaternion();
function sampleVector(track: Track, t: number, out: Vector3): void {
  const i = locate(track.times, t), n = track.times.length;
  if (n === 1) { out.set(track.values[0], track.values[1], track.values[2]); return; }
  const k = Math.max(0, Math.min(1, (t - track.times[i]) / Math.max(1e-6, track.times[i + 1] - track.times[i]))), v = track.values;
  out.set(v[i * 3] + (v[i * 3 + 3] - v[i * 3]) * k, v[i * 3 + 1] + (v[i * 3 + 4] - v[i * 3 + 1]) * k, v[i * 3 + 2] + (v[i * 3 + 5] - v[i * 3 + 2]) * k);
}
function sampleRotation(track: Track, t: number, out: Quaternion): void {
  const i = locate(track.times, t), v = track.values;
  qa.set(v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3]);
  if (track.times.length === 1) { out.copyFrom(qa); return; }
  qb.set(v[i * 4 + 4], v[i * 4 + 5], v[i * 4 + 6], v[i * 4 + 7]);
  const k = Math.max(0, Math.min(1, (t - track.times[i]) / Math.max(1e-6, track.times[i + 1] - track.times[i])));
  Quaternion.SlerpToRef(qa, qb, k, out);
}

/** All clips' tracks, extracted once from the shared GLB. */
export class MeleeClipSet {
  constructor(readonly meta: MeleeMetadata, private readonly tracks: Map<MeleeClipName, Map<MeleeNode, NodeTracks>>,
    private readonly rest: Map<MeleeNode, NodeRest>) {
    for (const clip of MELEE_CLIPS) if (!tracks.has(clip)) throw new Error(`Melee clips are missing ${clip}`);
    for (const node of MELEE_NODES) if (!rest.has(node)) throw new Error(`Melee clips are missing node ${node}`);
  }
  clip(name: MeleeClipName): MeleeClipMeta { return this.meta.clips[name]; }
  /** Every node's local transform at clip time `t` (clamped; loops wrap). */
  sample(name: MeleeClipName, t: number, out: RigSample): RigSample {
    const meta = this.meta.clips[name], tracks = this.tracks.get(name)!;
    const time = meta.loop ? ((t % meta.duration) + meta.duration) % meta.duration : Math.max(0, Math.min(meta.duration, t));
    for (const node of MELEE_NODES) {
      const rest = this.rest.get(node)!, track = tracks.get(node), o = out[node];
      if (track?.position) sampleVector(track.position, time, o.position); else o.position.copyFrom(rest.position);
      if (track?.rotation) sampleRotation(track.rotation, time, o.rotation); else o.rotation.copyFrom(rest.rotation);
      if (track?.scale) sampleVector(track.scale, time, o.scale); else o.scale.copyFrom(rest.scale);
    }
    return out;
  }
}

/** Composed result consumed by the arm rigs (aim frame: metres from the shoulder midpoint,
 * +x right, +y up, -z along the look). Index 0 is the right hand, 1 the left. */
export interface MeleePose {
  /** Grip sockets: the handle centre and the dagger's grip orientation. */
  sockets: [{ position: Vector3; rotation: Quaternion }, { position: Vector3; rotation: Quaternion }];
  /** Each dagger relative to its socket (finger spin, twirl, reveal scale), row-vector matrix. */
  daggers: [Matrix, Matrix];
  /** Reveal scale; below 0.01 the dagger is hidden. */
  scale: [number, number];
  /** Elbow bend hints (unit directions from each shoulder). */
  poles: [Vector3, Vector3];
  /** Torso rotation (yaw left, pitch up, roll) as a quaternion in the aim frame. */
  body: Quaternion;
  /** 0: hands on the gun (melee not shown); 1: hands follow the sockets. */
  hands: number;
  /** 0: gun in its normal hold; 1: fully lowered. */
  gunLower: number;
  gunVisible: boolean;
  /** Blade trail strength (0..1) per hand, from the playing attack's trail window. */
  trail: number;
  clip: MeleeClipName | null; time: number;
}
export const meleePose = (): MeleePose => ({
  sockets: [{ position: Vector3.Zero(), rotation: Quaternion.Identity() }, { position: Vector3.Zero(), rotation: Quaternion.Identity() }],
  daggers: [Matrix.Identity(), Matrix.Identity()], scale: [0, 0], poles: [new Vector3(.8, -.6, .1), new Vector3(-.8, -.6, .1)],
  body: Quaternion.Identity(), hands: 0, gunLower: 0, gunVisible: true, trail: 0, clip: null, time: 0,
});

export type MeleeState = 'hidden' | 'equipping' | 'ready' | 'attacking' | 'unequipping';
interface Layer { clip: MeleeClipName; time: number }
const ease = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
const span = (t: number, w?: Window) => (w ? ease((t - w[0]) / Math.max(1e-6, w[1] - w[0])) : 1);
/** Crossfade weight: smootherstep has zero acceleration at both ends, so a blend never adds
 * a kick on top of the clips' own strikes. */
const fadeCurve = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * c * (c * (c * 6 - 15) + 10); };

/** Gun/hand weights a clip implies at time t. */
function weights(meta: MeleeClipMeta, t: number): { hands: number; gunLower: number; gunVisible: number; trail: number } {
  if (meta.name === 'equip') return { hands: span(t, meta.hands), gunLower: span(t, meta.gunDown), gunVisible: t < (meta.gunHidden ?? 0) ? 1 : 0, trail: 0 };
  if (meta.name === 'unequip') return { hands: 1 - span(t, meta.hands), gunLower: 1 - span(t, meta.gunUp), gunVisible: t >= (meta.hidden ?? meta.duration) ? 1 : 0, trail: 0 };
  const trail = meta.trail ? Math.max(0, Math.min(1, Math.min((t - meta.trail[0]) / .012, (meta.trail[1] - t) / .025))) : 0;
  return { hands: 1, gunLower: 1, gunVisible: 0, trail };
}

const dm = { a: new Matrix(), b: new Matrix(), c: new Matrix(), d: new Matrix(), scale: Vector3.One() };
const scratch = { from: rigSample(), to: rigSample() };

/** Per character: which clip plays, crossfades between clips and the resulting pose.
 * Advance with real elapsed seconds; nothing depends on the frame rate. */
export class MeleeAnimator {
  private current: Layer | null = null;
  private previous: Layer | null = null;
  /** `previous` is a frozen copy of an interrupted blend (see snapshot), not a playing clip. */
  private held = false;
  private fade = 1;
  private fadeTime = 0;
  private queued: MeleeStage | null = null;
  private lastStage: MeleeStage = 3;
  private sinceAttack = Infinity;
  /** Seconds until the next idle flourish (Infinity while anything else is playing). */
  private flourishIn = Infinity;
  private readonly sample = rigSample();
  private readonly heldSample = rigSample();
  private readonly heldWeights = { hands: 0, gunLower: 0, gunVisible: 1, trail: 0 };
  /** Seconds after an attack ends within which `attack()` continues the combo. */
  comboWindow = .35;
  /** Random source for flourish timing and hand choice (tests inject their own). */
  rng: () => number = Math.random;
  /** Idle flourishes started so far. */
  flourishes = 0;
  /** Called when an idle flourish starts, e.g. to play its sound. */
  onFlourish: ((clip: MeleeClipName) => void) | null = null;
  constructor(readonly clips: MeleeClipSet) {}

  get state(): MeleeState {
    const clip = this.current?.clip;
    if (!clip) return 'hidden';
    if (clip === 'equip') return 'equipping';
    if (clip === 'unequip') return 'unequipping';
    return clip === 'idle' || clip === 'flourish_r' || clip === 'flourish_l' ? 'ready' : 'attacking';
  }
  get clip(): MeleeClipName | null { return this.current?.clip ?? null; }
  get time(): number { return this.current?.time ?? 0; }
  /** Start (or switch to) a clip `time` seconds in, crossfading by its blendIn. A switch in the
   * middle of another crossfade freezes the pose being shown and blends from that, so an
   * interruption (an attack during a flourish, a gun swap mid-attack) never snaps. */
  play(clip: MeleeClipName, time = 0): void {
    const meta = this.clips.clip(clip);
    if (this.current && meta.blendIn > 0) {
      if (this.previous && this.fade < 1) this.snapshot();
      else { this.previous = this.current; this.held = false; }
      this.fade = 0; this.fadeTime = meta.blendIn;
    } else { this.previous = null; this.held = false; this.fade = 1; }
    this.current = { clip, time };
    if (meta.stage) { this.lastStage = meta.stage; this.sinceAttack = 0; }
    this.flourishIn = clip === 'idle' ? this.nextFlourish() : Infinity;
  }
  equip(): void { if (this.state === 'hidden' || this.state === 'unequipping') this.play('equip'); }
  unequip(): void { if (this.state !== 'hidden' && this.state !== 'unequipping') { this.queued = null; this.play('unequip'); } }
  /** Immediately hidden (death, respawn, round reset); the gun is back in hand. */
  reset(): void {
    this.current = this.previous = null; this.held = false; this.queued = null; this.fade = 1; this.sinceAttack = Infinity;
    this.lastStage = 3; this.flourishIn = Infinity;
  }
  /** Local presentation request: the next combo stage (or `stage`). Starts now when ready (a
   * flourish in progress is cancelled by the blend) or once the playing attack reaches
   * chainFrom; one request is buffered. Returns the stage that started, or null if it was
   * buffered or ignored. */
  attack(stage?: MeleeStage): MeleeStage | null {
    const state = this.state;
    if (state === 'hidden' || state === 'unequipping') return null;
    const wanted = stage ?? this.nextStage();
    if (state === 'attacking') {
      const meta = this.clips.clip(this.current!.clip);
      if (this.current!.time < (meta.chainFrom ?? meta.duration)) { this.queued = wanted; return null; }
    } else if (state === 'equipping') { this.queued = wanted; return null; }
    this.play(this.clips.meta.combo[wanted - 1]);
    return wanted;
  }
  private nextStage(): MeleeStage {
    const chained = this.state === 'attacking' || this.sinceAttack <= this.comboWindow;
    return chained ? ((this.lastStage % 3) + 1) as MeleeStage : 1;
  }
  private nextFlourish(): number {
    const [lo, hi] = this.clips.meta.flourish?.interval ?? [6, 12];
    return lo + (hi - lo) * this.rng();
  }
  /** Idle flourish: only from a settled guard (no crossfade running), never mid-combat. */
  private startFlourish(): void {
    const options = this.clips.meta.flourish?.clips;
    if (!options?.length) { this.flourishIn = Infinity; return; }
    const clip = options[Math.min(options.length - 1, Math.floor(this.rng() * options.length))];
    this.flourishes++;
    this.play(clip);
    this.onFlourish?.(clip);
  }
  /** Test hook: start a flourish now (only from the guard). */
  flourish(side?: 'r' | 'l'): boolean {
    if (this.state !== 'ready' || this.previous) return false;
    const clip: MeleeClipName = side ? `flourish_${side}` : (this.rng() < .5 ? 'flourish_r' : 'flourish_l');
    this.flourishes++;
    this.play(clip);
    this.onFlourish?.(clip);
    return true;
  }
  advance(dt: number): void {
    dt = Math.max(0, Math.min(.1, dt));
    if (this.previous) {
      if (!this.held) this.previous.time += dt;
      this.fade = Math.min(1, this.fade + dt / Math.max(1e-6, this.fadeTime));
      if (this.fade >= 1) { this.previous = null; this.held = false; }
    }
    const layer = this.current;
    if (!layer) return;
    layer.time += dt;
    const meta = this.clips.clip(layer.clip);
    if (meta.stage) this.sinceAttack = 0; else this.sinceAttack += dt;
    if (this.queued && (layer.clip === 'idle' || (meta.stage && layer.time >= (meta.chainFrom ?? meta.duration))
      || (layer.clip === 'equip' && layer.time >= meta.duration))) {
      const stage = this.queued; this.queued = null;
      this.play(this.clips.meta.combo[stage - 1]);
      return;
    }
    if (!meta.loop && layer.time >= meta.duration) {
      if (layer.clip === 'unequip') this.reset();
      else this.play('idle', layer.time - meta.duration);
      return;
    }
    if (layer.clip === 'idle' && !this.previous && (this.flourishIn -= dt) <= 0) this.startFlourish();
  }
  /** Freeze the pose currently shown (a blend in progress) as the next crossfade's source. */
  private snapshot(): void {
    const { sample, wt } = this.blend();
    for (const node of MELEE_NODES) this.heldSample[node].copyFrom(sample[node]);
    Object.assign(this.heldWeights, wt);
    this.previous = { clip: this.current!.clip, time: 0 }; this.held = true;
  }
  /** The blended rig sample and gun/hand weights at the current time. */
  private blend(): { sample: RigSample; wt: { hands: number; gunLower: number; gunVisible: number; trail: number } } {
    const layer = this.current!;
    const to = this.clips.sample(layer.clip, layer.time, scratch.to);
    const w = this.previous ? fadeCurve(this.fade) : 1;
    let sample: RigSample = to;
    const wt = weights(this.clips.clip(layer.clip), layer.time);
    if (this.previous && w < 1) {
      let from: RigSample, wf: typeof wt;
      if (this.held) { from = this.heldSample; wf = this.heldWeights; }
      else { from = this.clips.sample(this.previous.clip, this.previous.time, scratch.from); wf = weights(this.clips.clip(this.previous.clip), this.previous.time); }
      for (const node of MELEE_NODES) {
        const a = from[node], b = to[node], o = this.sample[node];
        Vector3.LerpToRef(a.position, b.position, w, o.position);
        Quaternion.SlerpToRef(a.rotation, b.rotation, w, o.rotation);
        Vector3.LerpToRef(a.scale, b.scale, w, o.scale);
      }
      sample = this.sample;
      wt.hands = wf.hands + (wt.hands - wf.hands) * w; wt.gunLower = wf.gunLower + (wt.gunLower - wf.gunLower) * w;
      wt.gunVisible = w < .5 ? wf.gunVisible : wt.gunVisible; wt.trail = wf.trail + (wt.trail - wf.trail) * w;
    }
    return { sample, wt };
  }
  /** The blended pose at the current time (written into `out`). */
  pose(out: MeleePose): MeleePose {
    const layer = this.current;
    if (!layer) {
      out.hands = 0; out.gunLower = 0; out.gunVisible = true; out.scale[0] = out.scale[1] = 0; out.trail = 0;
      out.clip = null; out.time = 0; return out;
    }
    const { sample, wt } = this.blend();
    compose(sample, out);
    out.hands = wt.hands; out.gunLower = wt.gunLower; out.gunVisible = wt.gunVisible > .5; out.trail = wt.trail;
    out.clip = layer.clip; out.time = layer.time;
    return out;
  }
  inspect() {
    return { state: this.state, clip: this.clip, time: +this.time.toFixed(3), previous: this.held ? 'held' : this.previous?.clip ?? null,
      fade: +this.fade.toFixed(3), queued: this.queued, lastStage: this.lastStage,
      flourishIn: Number.isFinite(this.flourishIn) ? +this.flourishIn.toFixed(2) : null, flourishes: this.flourishes };
  }
}

/** Sockets, poles and body straight from the rig; each dagger relative to its socket is the
 * spin (about the pinch point), the return from the pivot, the twirl and the reveal scale. */
export function compose(sample: RigSample, out: MeleePose): MeleePose {
  for (let i = 0; i < 2; i++) {
    const s = i ? 'l' : 'r', socket = sample[`socket_${s}`];
    out.sockets[i].position.copyFrom(socket.position); out.sockets[i].rotation.copyFrom(socket.rotation).normalize();
    out.poles[i].copyFrom(sample[`pole_${s}`].position);
    if (out.poles[i].lengthSquared() < 1e-8) out.poles[i].set(i ? -.8 : .8, -.6, .1);
    out.poles[i].normalize();
    const spin = sample[`spin_${s}`], back = sample[`spin_back_${s}`], twirl = sample[`twirl_${s}`], carry = sample[`carry_${s}`];
    const scale = Math.max(0, carry.scale.x);
    out.scale[i] = scale;
    const k = Math.max(scale, .01);
    Matrix.ComposeToRef(dm.scale.setAll(k), carry.rotation, carry.position, dm.a);
    Matrix.ComposeToRef(twirl.scale, twirl.rotation, twirl.position, dm.b);
    dm.a.multiplyToRef(dm.b, dm.c);
    Matrix.ComposeToRef(back.scale, back.rotation, back.position, dm.b);
    dm.c.multiplyToRef(dm.b, dm.d);
    Matrix.ComposeToRef(spin.scale, spin.rotation, spin.position, dm.b);
    dm.d.multiplyToRef(dm.b, out.daggers[i]);
  }
  out.body.copyFrom(sample.body.rotation).normalize();
  return out;
}

/** Shoulder involvement implied by a socket (aim frame): reaching forward protracts the
 * clavicle, raising the hand elevates it. [elevation, protraction] in radians. */
export function shoulderReach(socket: Vector3): [number, number] {
  const elevate = Math.max(-.04, Math.min(.18, (socket.y + .06) * .7));
  const protract = Math.max(-.04, Math.min(.24, (-socket.z - .36) * 1.1));
  return [elevate, protract];
}
