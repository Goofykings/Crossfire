import { RIFLE, SHOTGUN, SNIPER, type MagazineReload, type WeaponAction, type WeaponId } from '../weapons/Weapon';

/** Third-person weapon handling, keyed to the gameplay action's own progress (0..1), so the
 * visible hand work can never change reload, pump or bolt timing. Points are in unscaled
 * weapon coordinates (+x right, +y up, -z muzzle), relative to one anchor per track. */
export type V3 = readonly [number, number, number];
type Keys = readonly (readonly [number, readonly number[]])[];
export type ActionAnchor = 'mag_grip' | 'port' | 'bolt_grip';
/** Body points the support hand visits: the vest's front-left magazine pouch and a belt
 * shell pouch (torso frame, relative to the chest joint; see CharacterWeapon). */
export type BodyPoint = 'magPouch' | 'shellPouch';

export interface ActionClip {
  /** [weight, x, y, z, body]: the support hand leaves its grip for the anchor plus offset,
   * or (body = 1) for a pouch on the body. */
  support?: { anchor: ActionAnchor; body: BodyPoint; keys: Keys };
  /** [weight]: the trigger hand leaves the grip for the (moving) bolt knob. */
  bolt?: Keys;
  /** [rotation about the bore, travel back] of the bolt part. */
  boltMotion?: Keys;
  /** [travel back] of the pump part; the support hand rides on it. */
  pump?: Keys;
  /** [x, y, z, yaw, pitch, roll] added to the hold in the aim frame. */
  weapon?: Keys;
  /** [right elevation, right protraction, left elevation, left protraction] in radians. */
  clavicles?: Keys;
  /** The magazine travels with the support hand between these fractions. */
  magazine?: readonly [number, number];
  /** The loose shell rides in the support hand until this fraction. */
  shell?: number;
}

export interface ActionPose {
  support: number; supportAnchor: ActionAnchor; supportOffset: V3; supportBody: number; bodyPoint: BodyPoint;
  bolt: number; boltMotion: readonly [number, number]; pump: number;
  weapon: readonly [number, number, number, number, number, number];
  clavicles: readonly [number, number, number, number];
  magazine: boolean; shell: boolean;
  /** True while the gun is being worked: the trigger finger stays off the trigger. */
  busy: boolean;
}

const ZERO6 = [0, 0, 0, 0, 0, 0] as const;
const ease = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** Piecewise smoothstep through keys [t, values]; holds the end values outside them. */
export function sampleKeys(keys: Keys, t: number): number[] {
  if (t <= keys[0][0]) return [...keys[0][1]];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1], [t1, b] = keys[i];
      const k = ease((t - t0) / Math.max(1e-6, t1 - t0));
      return a.map((v, j) => v + (b[j] - v) * k);
    }
  }
  return [...keys[keys.length - 1][1]];
}

/** Magazine change: reach the magazine, press and pull it, stow it at the vest, bring the
 * fresh one up under the well, seat it on the gameplay seat fraction, optionally tap the
 * bolt release, and return to the fore-end. The weapon cants its well toward the hand. */
function magazineClip(out: number, seat: number, release: number | null, tilt: readonly number[]): ActionClip {
  const pouch = [1, 0, -.13, .02, 1] as const, end = release === null ? Math.min(.95, seat + .2) : Math.min(1, release + .12);
  const pull = [0, .002, .045, .14, .018, .03];
  return {
    support: { anchor: 'mag_grip', body: 'magPouch', keys: [
      [0, [0, 0, 0, 0, 0]], [out - .1, [1, 0, 0, 0, 0]], [out, [1, 0, 0, 0, 0]], [out + .08, [1, 0, -.13, .02, 0]],
      [out + .17, pouch], [(out + seat) / 2 + .02, pouch], [seat - .08, [1, 0, -.11, .01, 0]], [seat, [1, 0, 0, 0, 0]],
      [seat + .05, [1, 0, 0, 0, 0]],
      ...(release === null ? [] : [[release - .05, [1, -.03, .14, .05, 0]], [release, [1, -.03, .14, .05, 0]]] as const),
      [end, [0, 0, 0, 0, 0]]] },
    weapon: [[0, ZERO6], [out - .1, tilt], [out + .08, tilt.map((v, i) => v + pull[i])], [seat - .08, tilt],
      [seat + .02, tilt.map((v, i) => v + (i === 2 ? -.012 : 0))], [release ?? seat + .05, tilt], [end, ZERO6]],
    clavicles: [[0, [0, 0, 0, 0]], [out, [0, 0, .04, .06]], [out + .08, [0, 0, -.05, -.02]], [seat - .08, [0, 0, 0, .04]],
      [seat, [0, 0, .06, .08]], [end, [0, 0, 0, 0]]],
    magazine: [out, seat],
  };
}

const RIFLE_TILT = [0, -.04, .02, .16, .14, .38];
const SNIPER_TILT = [0, -.05, .02, .12, .1, .3];
const rifle = RIFLE.reload as MagazineReload, sniper = SNIPER.reload as MagazineReload;
const cue = (cues: MagazineReload['cues'], name: string) => cues.find((c) => c.cue === name)!.at;
const rifleClips: Partial<Record<WeaponAction, ActionClip>> = {
  reload: magazineClip(cue(rifle.cues, 'mag_out'), rifle.seatAt, null, RIFLE_TILT),
  reloadEmpty: magazineClip(cue(rifle.emptyCues, 'mag_out'), rifle.emptySeatAt, cue(rifle.emptyCues, 'bolt_release'), RIFLE_TILT),
};

/** Bolt knob path matching the first-person cycle (rotation up, back, forward, down). */
function boltWork(up: number, back: number, forward: number, down: number) {
  return [[0, [0, 0]], [up - .04, [0, 0]], [up + .04, [1.05, 0]], [back + .02, [1.05, .09]], [(back + forward) / 2 + .02, [1.05, .09]],
    [forward + .02, [1.05, 0]], [down + .02, [0, 0]], [1, [0, 0]]] as const;
}
const sniperEmpty = magazineClip(cue(sniper.emptyCues, 'mag_out'), sniper.emptySeatAt, null, SNIPER_TILT);
const sniperClips: Partial<Record<WeaponAction, ActionClip>> = {
  reload: magazineClip(cue(sniper.cues, 'mag_out'), sniper.seatAt, null, SNIPER_TILT),
  reloadEmpty: { ...sniperEmpty,
    bolt: [[0, [0]], [cue(sniper.emptyCues, 'bolt_up') - .07, [0]], [cue(sniper.emptyCues, 'bolt_up') - .02, [1]],
      [cue(sniper.emptyCues, 'bolt_down') + .02, [1]], [1, [0]]],
    boltMotion: boltWork(cue(sniper.emptyCues, 'bolt_up'), cue(sniper.emptyCues, 'bolt_back'), cue(sniper.emptyCues, 'bolt_fwd'), cue(sniper.emptyCues, 'bolt_down')) },
  // The trigger hand works the bolt and returns; the weapon cants slightly toward it.
  cycle: {
    bolt: [[0, [0]], [.16, [1]], [.84, [1]], [1, [0]]],
    boltMotion: boltWork(...SNIPER.cycleCues.filter((c) => c.cue !== 'eject').map((c) => c.at) as [number, number, number, number]),
    weapon: [[0, ZERO6], [.16, [0, -.01, .015, 0, .04, .12]], [.84, [0, -.01, .015, 0, .04, .12]], [1, ZERO6]],
    clavicles: [[0, [0, 0, 0, 0]], [.36, [.05, -.05, 0, 0]], [.6, [.04, .04, 0, 0]], [1, [0, 0, 0, 0]]],
  },
};

// Shell loading: the gun rolls its loading port toward the support hand, which shuttles
// between a belt pouch and the port; every shell starts and ends at the pouch.
const POUCH = [1, 0, -.065, .02, 1] as const;
const SHELL_TILT = [0, -.035, .02, .1, .06, -.55];
const shotgunClips: Partial<Record<WeaponAction, ActionClip>> = {
  cycle: {
    pump: [[0, [0]], [.12, [0]], [.36, [.085]], [.46, [.085]], [.68, [0]], [1, [0]]],
    weapon: [[0, ZERO6], [.3, [0, -.01, .01, 0, .03, .03]], [.7, [0, -.006, .005, 0, .015, .015]], [1, ZERO6]],
    clavicles: [[0, [0, 0, 0, 0]], [.36, [0, 0, .02, -.06]], [.68, [0, 0, 0, .02]], [1, [0, 0, 0, 0]]],
  },
  shellStart: { support: { anchor: 'port', body: 'shellPouch', keys: [[0, [0, ...POUCH.slice(1)]], [1, POUCH]] }, weapon: [[0, ZERO6], [.7, SHELL_TILT], [1, SHELL_TILT]],
    clavicles: [[0, [0, 0, 0, 0]], [1, [0, 0, -.03, .03]]] },
  shell: { support: { anchor: 'port', body: 'shellPouch', keys: [[0, POUCH], [.32, [1, 0, -.065, .02, 0]],
    [SHOTGUN.reload.kind === 'shells' ? SHOTGUN.reload.insertAt : .72, [1, 0, 0, 0, 0]], [1, POUCH]] }, weapon: [[0, SHELL_TILT], [1, SHELL_TILT]],
    clavicles: [[0, [0, 0, -.03, .03]], [.72, [0, 0, .03, .07]], [1, [0, 0, -.03, .03]]],
    shell: SHOTGUN.reload.kind === 'shells' ? SHOTGUN.reload.insertAt : .72 },
  shellEnd: { support: { anchor: 'port', body: 'shellPouch', keys: [[0, POUCH], [1, [0, ...POUCH.slice(1)]]] }, weapon: [[0, SHELL_TILT], [1, ZERO6]],
    clavicles: [[0, [0, 0, -.03, .03]], [1, [0, 0, 0, 0]]] },
};

export const ACTION_CLIPS: Record<WeaponId, Partial<Record<WeaponAction, ActionClip>>> = {
  rifle: rifleClips, smg: rifleClips, 'semi-sniper': rifleClips, sniper: sniperClips, shotgun: shotgunClips,
};

const IDLE: ActionPose = { support: 0, supportAnchor: 'mag_grip', supportOffset: [0, 0, 0], supportBody: 0, bodyPoint: 'magPouch', bolt: 0, boltMotion: [0, 0], pump: 0,
  weapon: ZERO6, clavicles: [0, 0, 0, 0], magazine: false, shell: false, busy: false };

/** The cosmetic hand/part pose for an action at a progress fraction. */
export function actionPose(id: WeaponId, action: WeaponAction, progress: number): ActionPose {
  const clip = ACTION_CLIPS[id][action];
  if (!clip) return action === 'idle' ? IDLE : { ...IDLE, busy: true };
  const p = Math.max(0, Math.min(1, progress));
  const support = clip.support ? sampleKeys(clip.support.keys, p) : [0, 0, 0, 0, 0];
  const bolt = clip.boltMotion ? sampleKeys(clip.boltMotion, p) : [0, 0];
  return {
    support: support[0], supportAnchor: clip.support?.anchor ?? 'mag_grip', supportOffset: [support[1], support[2], support[3]],
    supportBody: support[4], bodyPoint: clip.support?.body ?? 'magPouch',
    bolt: clip.bolt ? sampleKeys(clip.bolt, p)[0] : 0, boltMotion: [bolt[0], bolt[1]],
    pump: clip.pump ? sampleKeys(clip.pump, p)[0] : 0,
    weapon: (clip.weapon ? sampleKeys(clip.weapon, p) : ZERO6) as unknown as ActionPose['weapon'],
    clavicles: (clip.clavicles ? sampleKeys(clip.clavicles, p) : [0, 0, 0, 0]) as unknown as ActionPose['clavicles'],
    magazine: !!clip.magazine && p >= clip.magazine[0] && p < clip.magazine[1],
    shell: clip.shell !== undefined && p < clip.shell, busy: true,
  };
}
