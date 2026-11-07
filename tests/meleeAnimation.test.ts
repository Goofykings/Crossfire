import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { Matrix, NullEngine, Quaternion, Scene, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { MeleeLibrary, holdMatrix, WRIST_TO_PALM } from '../src/game/melee/MeleeAssets';
import { MELEE_CLIPS, MeleeAnimator, compose, meleePose, rigSample, type MeleeClipName, type MeleeMetadata } from '../src/game/melee/MeleeAnimation';

afterEach(() => vi.unstubAllGlobals());
const META: MeleeMetadata = JSON.parse(fs.readFileSync('public/assets/models/shared/melee/daggers.json', 'utf8'));

async function library() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(`public/${url.replace(/^.*?assets\//, 'assets/')}`)));
  const engine = new NullEngine();
  const scene = new Scene(engine); scene.useRightHandedSystem = true;
  const lib = new MeleeLibrary(scene);
  await lib.load(new AbortController().signal);
  return { engine, scene, lib };
}

/** Tip of a dagger in the aim frame from a pose: socket * dagger-relative * tip anchor. */
function tip(pose: ReturnType<typeof meleePose>, i: number): Vector3 {
  const side = i ? 'l' : 'r', socket = pose.sockets[i];
  const world = pose.daggers[i].multiply(Matrix.Compose(Vector3.One(), socket.rotation, socket.position));
  return Vector3.TransformCoordinates(Vector3.FromArray(META.models[side].anchors.tip), world);
}

describe('dagger clips GLB', () => {
  it('has all eight clips and matches the Blender checkpoints in game coordinates', async () => {
    const { engine, scene, lib } = await library();
    const clips = lib.clips!;
    const sample = rigSample(), pose = meleePose();
    for (const name of MELEE_CLIPS) {
      for (const point of META.checkpoints[name]) {
        clips.sample(name, point.t, sample);
        compose(sample, pose);
        for (const [i, side] of [[0, 'r'], [1, 'l']] as const) {
          // Sampling at 60 Hz with linear keys: within 3 mm of Blender's own evaluation.
          expect(Vector3.Distance(pose.sockets[i].position, Vector3.FromArray(point[`hand_${side}`])), `${name} ${point.t} hand_${side}`).toBeLessThan(.003);
          if (point[`scale_${side}`] > .5) expect(Vector3.Distance(tip(pose, i), Vector3.FromArray(point[`tip_${side}`])), `${name} ${point.t} tip_${side}`).toBeLessThan(.006);
          expect(pose.scale[i]).toBeCloseTo(point[`scale_${side}`], 1);
        }
      }
    }
    scene.dispose(); engine.dispose();
  });

  it('holds the handle in the fist: the socket sits WRIST_TO_PALM along the hand and depth toward the palm', () => {
    const axes = { fingers: new Vector3(0, 1, 0), back: new Vector3(1, 0, 0) };
    for (const side of ['r', 'l'] as const) {
      const hold = META.hold[side], m = holdMatrix(hold, axes);
      // The grip's fingers/back directions (dagger space) land on the bone's own axes.
      expect(Vector3.TransformNormal(Vector3.FromArray(hold.fingers), m).subtract(axes.fingers).length()).toBeLessThan(1e-6);
      expect(Vector3.TransformNormal(Vector3.FromArray(hold.back), m).subtract(axes.back).length()).toBeLessThan(1e-6);
      const centre = Vector3.TransformCoordinates(Vector3.Zero(), m);
      expect(Vector3.Distance(centre, new Vector3(-hold.depth, WRIST_TO_PALM, 0))).toBeLessThan(1e-6);
    }
  });
});

describe('melee animator', () => {
  async function animator() {
    const { engine, scene, lib } = await library();
    return { engine, scene, anim: new MeleeAnimator(lib.clips!) };
  }
  const run = (anim: MeleeAnimator, seconds: number, dt = 1 / 60, each?: () => void) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) { anim.advance(dt); each?.(); }
  };

  it('equips: the gun lowers and hides, the daggers appear, then settles into the looping guard', async () => {
    const { engine, scene, anim } = await animator();
    const pose = meleePose();
    expect(anim.pose(pose)).toMatchObject({ hands: 0, gunLower: 0, gunVisible: true });
    anim.equip();
    run(anim, .05); anim.pose(pose);
    expect(pose.gunVisible).toBe(true); expect(Math.max(...pose.scale)).toBeLessThan(.01);
    run(anim, .2); anim.pose(pose);
    expect(pose.gunVisible).toBe(false); expect(pose.gunLower).toBe(1); expect(pose.scale[0]).toBeGreaterThan(.9);
    run(anim, .4); anim.pose(pose);
    expect(anim.state).toBe('ready'); expect(pose.hands).toBe(1);
    const duration = META.clips.equip.duration;
    expect(duration).toBeGreaterThanOrEqual(.4); expect(duration).toBeLessThanOrEqual(.6);
    scene.dispose(); engine.dispose();
  });

  it('chains cross, forward and finisher without returning to the guard, then loops the combo', async () => {
    const { engine, scene, anim } = await animator();
    anim.equip(); run(anim, .6);
    expect(anim.attack()).toBe(1);
    expect(anim.clip).toBe('attack_cross');
    // Pressed early: buffered until the cross reaches chainFrom, then the forward starts.
    run(anim, .1); expect(anim.attack()).toBeNull();
    run(anim, META.clips.attack_cross.chainFrom! - .1 + .02);
    expect(anim.clip).toBe('attack_forward');
    run(anim, META.clips.attack_forward.chainFrom! + .01); expect(anim.attack()).toBe(3);
    run(anim, META.clips.attack_finisher.chainFrom! + .01); expect(anim.attack()).toBe(1);
    expect(anim.clip).toBe('attack_cross');
    scene.dispose(); engine.dispose();
  });

  it('never snaps: consecutive poses move smoothly through chains, returns and interruptions', async () => {
    const { engine, scene, anim } = await animator();
    const pose = meleePose(), history: Vector3[][] = [[], []], tips: Vector3[][] = [[], []];
    let speed = 0, jerk = 0, tipJerk = 0, at = '';
    const check = () => {
      anim.pose(pose);
      for (let i = 0; i < 2; i++) {
        const h = history[i], p = pose.sockets[i].position.clone();
        h.push(p); if (h.length > 3) h.shift();
        if (h.length >= 2) speed = Math.max(speed, Vector3.Distance(h[h.length - 1], h[h.length - 2]));
        // Second difference: a discontinuity is a one-frame spike; smooth strikes accelerate over frames.
        if (h.length === 3) {
          const a = h[2].subtract(h[1].scale(2)).add(h[0]).length();
          if (a > jerk) { jerk = a; at = `${anim.clip}@${anim.time.toFixed(3)}`; }
        }
        const t = tips[i];
        if (pose.scale[i] > .99) { t.push(tip(pose, i)); if (t.length > 3) t.shift(); } else t.length = 0;
        if (t.length === 3) tipJerk = Math.max(tipJerk, t[2].subtract(t[1].scale(2)).add(t[0]).length());
      }
    };
    anim.equip(); run(anim, .55, 1 / 60, check);
    for (let i = 0; i < 7; i++) { anim.attack(); run(anim, .2, 1 / 60, check); }   // mashed
    run(anim, 1.2, 1 / 60, check);                                                  // return to the guard
    anim.attack(); run(anim, .12, 1 / 60, check); anim.unequip(); run(anim, .5, 1 / 60, check); // interrupted
    // Baseline: each clip played on its own (the authored strikes' own accelerations).
    let baseline = 0, baseTip = 0;
    const sample = rigSample(), alone = meleePose();
    for (const name of MELEE_CLIPS) for (const phase of [0, .25, .5, .75]) {
      const h: Vector3[][] = [[], []], t: Vector3[][] = [[], []];
      for (let f = 0; f <= Math.round(META.clips[name].duration * 60); f++) {
        compose(anim.clips.sample(name, (f + phase) / 60, sample), alone);
        for (let i = 0; i < 2; i++) {
          h[i].push(alone.sockets[i].position.clone()); if (h[i].length > 3) h[i].shift();
          if (h[i].length === 3) baseline = Math.max(baseline, h[i][2].subtract(h[i][1].scale(2)).add(h[i][0]).length());
          t[i].push(tip(alone, i)); if (t[i].length > 3) t[i].shift();
          if (t[i].length === 3 && alone.scale[i] > .99) baseTip = Math.max(baseTip, t[i][2].subtract(t[i][1].scale(2)).add(t[i][0]).length());
        }
      }
    }
    console.info('melee motion', { speed: +speed.toFixed(3), jerk: +jerk.toFixed(3), at, tipJerk: +tipJerk.toFixed(3),
      baseline: +baseline.toFixed(3), baseTip: +baseTip.toFixed(3) });
    // The slash covers ~45 cm in about 30 ms (a deliberately violent 13-25 cm per 60 Hz frame).
    // Chains, returns and interruptions must not add a one-frame spike on top of what the
    // clips themselves contain.
    expect(speed).toBeLessThan(.3);
    expect(jerk, at).toBeLessThan(baseline * 1.15);
    expect(tipJerk).toBeLessThan(baseTip * 1.15);
    expect(anim.state).toBe('hidden');
    scene.dispose(); engine.dispose();
  });

  it('is frame-rate independent', async () => {
    const { engine, scene, anim } = await animator();
    const { anim: other } = { anim: new MeleeAnimator(anim.clips) };
    const a = meleePose(), b = meleePose();
    for (const x of [anim, other]) { x.equip(); }
    run(anim, .9, 1 / 30); run(other, .9, 1 / 144);
    anim.attack(); other.attack();
    run(anim, .2, 1 / 30); run(other, .2, 1 / 144);
    anim.pose(a); other.pose(b);
    expect(anim.clip).toBe(other.clip);
    expect(Vector3.Distance(a.sockets[0].position, b.sockets[0].position)).toBeLessThan(.02);
    expect(Quaternion.Dot(a.sockets[0].rotation, b.sockets[0].rotation) ** 2).toBeGreaterThan(.99);
    scene.dispose(); engine.dispose();
  });

  it('meets the speed targets: 250/250/400 ms swings, a fast strike and a ~100 ms crossed hold', async () => {
    const { engine, scene, lib } = await library();
    const clips = lib.clips!, sample = rigSample(), pose = meleePose();
    expect([META.clips.attack_cross.duration, META.clips.attack_forward.duration, META.clips.attack_finisher.duration]).toEqual([.25, .25, .4]);
    // Strike distance covered in the three fastest 60 Hz frames of each attack (the primary move).
    const fastest = (name: MeleeClipName, i: number) => {
      const path: Vector3[] = [];
      for (let f = 0; f <= Math.round(META.clips[name].duration * 60); f++) { compose(clips.sample(name, f / 60, sample), pose); path.push(pose.sockets[i].position.clone()); }
      let best = 0;
      for (let f = 0; f + 3 < path.length; f++) best = Math.max(best, Vector3.Distance(path[f], path[f + 3]));
      return best;
    };
    expect(fastest('attack_cross', 0)).toBeGreaterThan(.3);   // right hand: 30+ cm in 3 frames
    expect(fastest('attack_forward', 1)).toBeGreaterThan(.3); // left hand
    expect(fastest('attack_finisher', 0)).toBeGreaterThan(.25);
    // Attack 1 starts high on the right and ends the strike low on the left; attack 2 mirrors it.
    const at = (name: MeleeClipName, t: number, i: number) => { compose(clips.sample(name, t, sample), pose); return pose.sockets[i].position.clone(); };
    const r0 = at('attack_cross', 0, 0), r1 = at('attack_cross', .11, 0), l0 = at('attack_forward', 0, 1), l1 = at('attack_forward', .11, 1);
    expect(r0.x).toBeGreaterThan(.2); expect(r0.y).toBeGreaterThan(0); expect(r1.x).toBeLessThan(0); expect(r1.y).toBeLessThan(r0.y - .1);
    expect(l0.x).toBeLessThan(-.2); expect(l0.y).toBeGreaterThan(0); expect(l1.x).toBeGreaterThan(0); expect(l1.y).toBeLessThan(l0.y - .1);
    // Finisher: crossed with the right hand above and left of the left hand, held ~100 ms, then both arms go outward.
    const hold = [.11, .13, .15, .17, .19].map((t) => [at('attack_finisher', t, 0), at('attack_finisher', t, 1)]);
    for (const [right, left] of hold) { expect(right.y).toBeGreaterThan(left.y + .08); expect(right.x).toBeLessThan(left.x); }
    const crossed = hold[0], still = hold[hold.length - 1];
    expect(Vector3.Distance(crossed[0], still[0])).toBeLessThan(.03); expect(Vector3.Distance(crossed[1], still[1])).toBeLessThan(.03);
    const out = [at('attack_finisher', .25, 0), at('attack_finisher', .25, 1)];
    expect(out[0].x).toBeGreaterThan(.25); expect(out[1].x).toBeLessThan(-.25);
    // The release leaves the crossed pose within ~45 ms.
    expect(Vector3.Distance(at('attack_finisher', .2, 0), at('attack_finisher', .25, 0))).toBeGreaterThan(.35);
    scene.dispose(); engine.dispose();
  });

  it('sweeps the dagger across most of the first-person view (attacks 1 and 2) and spreads wide in the finisher', async () => {
    const { engine, scene, lib } = await library();
    const clips = lib.clips!, sample = rigSample(), pose = meleePose();
    const fp = META.firstPerson, body = Quaternion.Identity(), identity = Quaternion.Identity();
    /** Normalized device x/y of a dagger tip at clip time t (90 degree horizontal FOV, 16:9), as MeleeView frames the rig. */
    const ndc = (name: MeleeClipName, t: number, i: number) => {
      compose(clips.sample(name, t, sample), pose);
      Quaternion.SlerpToRef(identity, pose.body, fp.body, body);
      const p = tip(pose, i).applyRotationQuaternionInPlace(body).addInPlace(Vector3.FromArray(fp.shoulders));
      return { x: p.x / -p.z, y: p.y / -p.z / .5625, depth: -p.z };
    };
    const a1 = [ndc('attack_cross', .04, 0), ndc('attack_cross', .104, 0), ndc('attack_cross', .14, 0)];
    expect(a1[0].x).toBeGreaterThan(.6); expect(a1[0].y).toBeGreaterThan(.5);       // upper right
    expect(a1[1].x).toBeLessThan(-.55); expect(a1[1].y).toBeLessThan(0);              // lower left
    expect(a1[0].x - a1[1].x).toBeGreaterThan(1.3);                                   // 65%+ of the screen width (it was 0.86)
    const a2 = [ndc('attack_forward', .04, 1), ndc('attack_forward', .104, 1)];
    expect(a2[0].x).toBeLessThan(-.6); expect(a2[0].y).toBeGreaterThan(.5);
    expect(a2[1].x).toBeGreaterThan(.55); expect(a2[1].y).toBeLessThan(0);
    expect(a2[1].x - a2[0].x).toBeGreaterThan(1.3);
    // Never through the camera: every key of every attack keeps the tips well in front of it.
    for (const name of ['attack_cross', 'attack_forward', 'attack_finisher'] as const) for (let t = 0; t <= META.clips[name].duration; t += .01) for (const i of [0, 1])
      expect(ndc(name, t, i).depth, `${name} ${t.toFixed(2)} tip ${i} depth`).toBeGreaterThan(.2);
    // Finisher release: both daggers end far apart, one on each side of the view.
    const out = [ndc('attack_finisher', .29, 0), ndc('attack_finisher', .29, 1)];
    expect(out[0].x).toBeGreaterThan(.75); expect(out[1].x).toBeLessThan(-.75);
    expect(out[0].x - out[1].x).toBeGreaterThan(1.6);
    scene.dispose(); engine.dispose();
  });

  it('winds the finisher up slowly, holds the crossed arms 100-150 ms with some secondary motion, then releases fast', async () => {
    const { engine, scene, lib } = await library();
    const clips = lib.clips!, sample = rigSample(), pose = meleePose();
    const hand = (t: number, i: number) => { compose(clips.sample('attack_finisher', t, sample), pose); return pose.sockets[i].position.clone(); };
    const crossed = hand(.15, 0), crossedLeft = hand(.15, 1);
    // The crossed pose is held while both hands stay within 2.5 cm of it: 100-150 ms.
    const held: number[] = [];
    for (let t = 0; t <= .4; t += .005) if (Vector3.Distance(hand(t, 0), crossed) < .025 && Vector3.Distance(hand(t, 1), crossedLeft) < .025) held.push(t);
    const hold = held[held.length - 1] - held[0];
    expect(hold).toBeGreaterThanOrEqual(.1); expect(hold).toBeLessThanOrEqual(.15);
    // Not frozen: the hands drift a few millimetres and the torso keeps moving during the hold.
    expect(Vector3.Distance(hand(.1, 0), hand(.2, 0))).toBeGreaterThan(.004);
    compose(clips.sample('attack_finisher', .12, sample), pose); const b0 = pose.body.clone();
    compose(clips.sample('attack_finisher', .19, sample), pose); expect(Quaternion.Dot(b0, pose.body) ** 2).toBeLessThan(.99999);
    // The wind-up (guard -> crossed) takes about twice as long as the release (crossed -> far out).
    const arrive = held[0], release = .245 - held[held.length - 1];
    expect(arrive).toBeGreaterThan(release * 2);
    // The crossed pose is pulled well back toward the chest, with the right hand above the left.
    expect(crossed.z).toBeGreaterThan(-.31); expect(crossed.y).toBeGreaterThan(crossedLeft.y + .1);
    // The release travels much farther than before (right hand +0.45 m across, left the mirror).
    expect(hand(.245, 0).x - crossed.x).toBeGreaterThan(.42); expect(crossedLeft.x - hand(.245, 1).x).toBeGreaterThan(.42);
    // Contact metadata (shared with combat) is unchanged.
    expect(META.clips.attack_finisher.contact).toEqual([.215, .305]);
    expect(META.clips.attack_finisher.trail?.[0]).toBeGreaterThanOrEqual(.2);
    scene.dispose(); engine.dispose();
  });

  it('plays a cosmetic flourish every 6-12 seconds from the guard, never during combat or blends', async () => {
    const { engine, scene, anim } = await animator();
    let seed = 7; anim.rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const started: { at: number; clip: string | null }[] = []; let now = 0;
    anim.onFlourish = (clip) => started.push({ at: now, clip });
    anim.equip(); run(anim, .6);
    for (let f = 0; f < 60 * 70; f++) { now = f / 60; anim.advance(1 / 60); expect(anim.state).toBe('ready'); }
    expect(started.length).toBeGreaterThanOrEqual(5); expect(started.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < started.length; i++) {
      const gap = started[i].at - started[i - 1].at;   // flourish length (.52 s) plus the 6-12 s wait
      expect(gap).toBeGreaterThan(6.4); expect(gap).toBeLessThan(12.8);
    }
    expect(new Set(started.map((s) => s.clip)).size).toBe(2);
    // Combat resets the wait: nothing starts while attacking or within the guard's first seconds.
    const before = anim.flourishes;
    anim.attack(); run(anim, 5, 1 / 60, () => { if (anim.clip !== 'idle') expect(['attack_cross', 'idle']).toContain(anim.clip); });
    expect(anim.flourishes).toBe(before);
    scene.dispose(); engine.dispose();
  });

  it('cancels a flourish the moment an attack, unequip or reset arrives, blending without a snap', async () => {
    const { engine, scene, anim } = await animator();
    anim.equip(); run(anim, .8);
    const pose = meleePose(), last = [Vector3.Zero(), Vector3.Zero()];
    let worst = 0, first = true;
    const watch = () => {
      anim.pose(pose);
      for (let i = 0; i < 2; i++) { const p = pose.sockets[i].position; if (!first) worst = Math.max(worst, Vector3.Distance(p, last[i])); last[i].copyFrom(p); }
      first = false;
    };
    for (const interrupt of ['attack', 'unequip'] as const) {
      expect(anim.flourish('r')).toBe(true); expect(anim.clip).toBe('flourish_r'); expect(anim.state).toBe('ready');
      run(anim, .22, 1 / 60, watch);                      // mid-spin
      worst = 0; first = true;
      // The input is honoured on this very frame: no waiting for the spin to finish.
      if (interrupt === 'attack') expect(anim.attack()).toBe(1); else anim.unequip();
      expect(anim.clip).toBe(interrupt === 'attack' ? 'attack_cross' : 'unequip');
      run(anim, .3, 1 / 60, watch);
      expect(worst, interrupt).toBeLessThan(.3);          // an attack's strike is the fastest thing in the set
      if (interrupt === 'attack') run(anim, 1, 1 / 60, watch); else { run(anim, .3); anim.equip(); run(anim, .7); }
    }
    // A second interruption in the middle of a blend freezes the shown pose instead of jumping.
    anim.flourish('l'); run(anim, .03); anim.attack(); run(anim, .02);
    worst = 0; first = true; watch();
    anim.unequip(); run(anim, .2, 1 / 60, watch);
    expect(worst).toBeLessThan(.12);
    anim.flourish('l'); anim.reset(); expect(anim.state).toBe('hidden');
    scene.dispose(); engine.dispose();
  });

  it('keeps the other hand in its guard while one hand flourishes', async () => {
    const { engine, scene, lib } = await library();
    const sample = rigSample(), pose = meleePose(), guard = meleePose();
    compose(lib.clips!.sample('idle', 0, sample), guard);
    for (const [clip, moving, still] of [['flourish_r', 0, 1], ['flourish_l', 1, 0]] as const) {
      let moved = 0;
      for (let t = 0; t <= .52; t += 1 / 60) {
        compose(lib.clips!.sample(clip, t, sample), pose);
        expect(Vector3.Distance(pose.sockets[still].position, guard.sockets[still].position)).toBeLessThan(.002);
        moved = Math.max(moved, Vector3.Distance(pose.sockets[moving].position, guard.sockets[moving].position));
      }
      expect(moved).toBeGreaterThan(.03); expect(moved).toBeLessThan(.09);
      compose(lib.clips!.sample(clip, .52, sample), pose);
      expect(Vector3.Distance(pose.sockets[moving].position, guard.sockets[moving].position)).toBeLessThan(.002);
    }
    scene.dispose(); engine.dispose();
  });

  it('exposes the timing metadata the combat layer synchronizes to', () => {
    for (const name of ['attack_cross', 'attack_forward', 'attack_finisher'] as MeleeClipName[]) {
      const clip = META.clips[name];
      expect(clip.contact![0]).toBeGreaterThan(0);
      expect(clip.contact![1]).toBeLessThan(clip.chainFrom!);
      expect(clip.chainFrom!).toBeLessThanOrEqual(clip.duration);
      expect(clip.next).toBe(META.combo[(META.combo.indexOf(name) + 1) % 3]);
    }
    expect(META.clips.unequip.hidden).toBeLessThan(META.clips.unequip.duration);
  });
});
