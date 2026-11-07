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
  it('has all six clips and matches the Blender checkpoints in game coordinates', async () => {
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
    // Strikes peak near 8 m/s (13 cm per 60 Hz frame). Chains, returns and interruptions must
    // not add a one-frame spike on top of what the clips themselves contain.
    expect(speed).toBeLessThan(.15);
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
