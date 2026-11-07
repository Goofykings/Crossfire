import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FreeCamera, NullEngine, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CharacterAssetLibrary, type CharacterInstance } from '../src/game/CharacterAsset';
import { CharacterWeaponLibrary, type CharacterWeapon } from '../src/game/CharacterWeapon';
import { MeleeLibrary } from '../src/game/melee/MeleeAssets';
import { hashSeed, limpRandom } from '../src/game/LimpBody';
import type { CharacterMotion } from '../src/game/PlayerAnimation';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';

afterEach(() => vi.unstubAllGlobals());
const run = (speed: number, extra: Partial<CharacterMotion> = {}): CharacterMotion => ({ velocity: { x: 0, y: 0, z: -speed }, grounded: true, crouch: 0, slideRemaining: 0, ...extra });

async function rig(withGun: boolean) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(`public/${url.replace(/^.*?assets\//, 'assets/')}`)));
  const engine = new NullEngine();
  const scene = new Scene(engine); scene.useRightHandedSystem = true; scene.useConstantAnimationDeltaTime = true;
  new FreeCamera('camera', new Vector3(0, 1.5, -4), scene);
  const characters = new CharacterAssetLibrary(scene), melee = new MeleeLibrary(scene);
  const material = new StandardMaterial('test', scene);
  const weapons = new CharacterWeaponLibrary(scene, { get: () => material, ready: async () => {} } as unknown as MaterialLibrary);
  const signal = new AbortController().signal;
  await Promise.all([characters.load(signal), melee.load(signal), weapons.load('rifle', signal)]);
  const parent = new TransformNode('player', scene), character = characters.instantiate(parent, 'limp')!;
  let weapon: CharacterWeapon | null = null;
  const daggers = melee.createCharacterMelee('limp-melee')!;
  if (withGun) { weapon = weapons.create(character, 'rifle')!; weapon.melee = daggers; }
  scene.onBeforeAnimationsObservable.add(() => weapon?.restore());
  scene.onAfterAnimationsObservable.add(() => weapon?.update());
  const step = (frames: number, motion: CharacterMotion) => {
    for (let i = 0; i < frames; i++) { character.update(motion, 1 / 60); daggers.advance(1 / 60); weapon?.setState({ pitch: 0 }); weapon?.advance(1 / 60); scene.render(); }
  };
  const bones = new Map(character.entries.skeletons[0].bones.map((b) => [b.name, b.getTransformNode()!]));
  const point = (name: string) => { const node = bones.get(name)!; node.computeWorldMatrix(true); return node.getAbsolutePosition().clone(); };
  const refresh = () => { for (const node of bones.values()) node.computeWorldMatrix(true); };
  /** Knee flexion in degrees, signed: positive when the shin is bent back, negative when hyperextended. */
  const knee = (s: 'l' | 'r') => {
    refresh();
    const hip = point(`thigh_${s}`), kn = point(`shin_${s}`), ankle = point(`foot_${s}`);
    const thigh = kn.subtract(hip).normalize(), shin = ankle.subtract(kn).normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(thigh, shin)))) * 180 / Math.PI;
    // Bent backward means the ankle ends up behind the thigh line (+z in this rig, forward is -z).
    const back = -Vector3.Cross(thigh, shin).x;
    return back > 0 ? angle : -angle;
  };
  const rotations = () => [...bones.values()].map((n) => n.rotationQuaternion!.clone());
  return { engine, scene, character, step, point, knee, bones, rotations, refresh, weapon: () => weapon, daggers };
}

/** The tip-over the real DeathMotion produces (an exponential approach to ~88 degrees). */
const tip = (t: number) => (1 - Math.exp(-t * 3.8)) * Math.PI * .49;
const AXIS = new Vector3(1, 0, 0);
function fall(character: CharacterInstance, seconds: number, each?: (t: number) => void) {
  for (let f = 1; f <= Math.round(seconds * 60); f++) { const t = f / 60; character.poseDeath(t, tip(t), AXIS); each?.(t); }
}

describe('limp ragdoll death', () => {
  it('has deterministic seeded randomness', () => {
    const a = limpRandom(hashSeed('death:1')), b = limpRandom(hashSeed('death:1')), c = limpRandom(hashSeed('death:2'));
    expect([a(), a()]).toEqual([b(), b()]);
    expect(a()).not.toBe(c());
  });

  it('starts exactly where the running pose was and relaxes the legs straight', async () => {
    const { engine, scene, character, step, knee, rotations, refresh, bones } = await rig(false);
    try {
      step(40, run(6));
      // Find a frame with a clearly bent knee (mid-stride) so the test measures a real change.
      let bent = 0;
      for (let i = 0; i < 40; i++) { step(1, run(6)); bent = Math.max(bent, Math.abs(knee('l')), Math.abs(knee('r'))); if (bent > 30) break; }
      expect(bent).toBeGreaterThan(30);
      const before = rotations();
      character.captureDeath(1234);
      character.poseDeath(0, 0, AXIS);
      // No snap: the first death frame equals the last living frame.
      const after = rotations();
      for (let i = 0; i < before.length; i++) expect(Quaternion.Dot(before[i], after[i]) ** 2, `joint ${i}`).toBeGreaterThan(.99999);
      let hyper = 0;
      fall(character, 1.8, () => { hyper = Math.min(hyper, knee('l'), knee('r')); });
      refresh();
      // Legs extend and relax: no running knee bend remains, and no knee ever folds the wrong way.
      expect(Math.abs(knee('l'))).toBeLessThan(14);
      expect(Math.abs(knee('r'))).toBeLessThan(14);
      expect(hyper).toBeGreaterThan(-8);
      expect(bones.size).toBeGreaterThan(20);
    } finally { scene.dispose(); engine.dispose(); }
  });

  it('moves every joint on its own clock and settles to a resting pose', async () => {
    const { engine, scene, character, step, bones } = await rig(false);
    try {
      step(30, run(6));
      character.captureDeath(99);
      const trace: Record<string, number[]> = { thigh_l: [], thigh_r: [], upper_arm_l: [], upper_arm_r: [], forearm_l: [], forearm_r: [] };
      const start = Object.fromEntries(Object.keys(trace).map((n) => [n, bones.get(n)!.rotationQuaternion!.clone()]));
      fall(character, 2, () => { for (const n of Object.keys(trace)) trace[n].push(Quaternion.Dot(start[n], bones.get(n)!.rotationQuaternion!)); });
      // Left and right limbs do not move in lockstep.
      for (const pair of [['thigh_l', 'thigh_r'], ['upper_arm_l', 'upper_arm_r'], ['forearm_l', 'forearm_r']]) {
        const a = trace[pair[0]], b = trace[pair[1]];
        const worst = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
        expect(worst, pair.join('/')).toBeGreaterThan(.0004);
      }
      // Settled: the last half second barely moves any joint.
      const tail = bones.get('forearm_l')!.rotationQuaternion!.clone();
      fall(character, 0.01);
      character.poseDeath(2.3, tip(2.3), AXIS);
      expect(Quaternion.Dot(tail, bones.get('forearm_l')!.rotationQuaternion!) ** 2).toBeGreaterThan(.9998);
    } finally { scene.dispose(); engine.dispose(); }
  });

  it('lets the arms rest on the floor whichever way the body falls (backward, forward or onto its side)', async () => {
    for (const [name, axis] of [['backward', new Vector3(1, 0, 0)], ['forward', new Vector3(-1, 0, 0)], ['left', new Vector3(0, 0, 1)], ['right', new Vector3(0, 0, -1)]] as const) {
      const { engine, scene, character, step, bones, refresh } = await rig(false);
      try {
        step(30, run(5));
        character.captureDeath(11);
        for (let f = 1; f <= 150; f++) character.poseDeath(f / 60, tip(f / 60), axis);
        refresh();
        // Gravity in the character's frame once the body lies down.
        const g = new Vector3(0, -1, 0).applyRotationQuaternionInPlace(Quaternion.RotationAxis(axis, -tip(2.5)));
        for (const s of ['l', 'r']) {
          const shoulder = bones.get(`upper_arm_${s}`)!.getAbsolutePosition(), elbow = bones.get(`forearm_${s}`)!.getAbsolutePosition();
          const c = Vector3.Dot(elbow.subtract(shoulder).normalize(), g);
          // Neither pointing into the floor nor sticking up in the air.
          expect(c, `${name} arm ${s}`).toBeGreaterThan(-.35);
          expect(c, `${name} arm ${s}`).toBeLessThan(.4);
        }
      } finally { scene.dispose(); engine.dispose(); }
    }
  });

  it('relaxes from a sliding pose and from the gun-and-dagger arm IK without snapping', async () => {
    for (const motion of [run(7, { slideRemaining: .6 }), run(0), run(4, { grounded: false })]) {
      const { engine, scene, character, step, rotations, weapon, daggers, knee } = await rig(true);
      try {
        daggers.animator.equip(); step(50, motion);
        expect(weapon()!.inspectMelee()?.hands).toBeGreaterThan(.9);
        const before = rotations();
        character.captureDeath(5);
        character.poseDeath(0, 0, AXIS);
        const after = rotations();
        for (let i = 0; i < before.length; i++) expect(Quaternion.Dot(before[i], after[i]) ** 2, `joint ${i}`).toBeGreaterThan(.99999);
        fall(character, 1.8);
        expect(Math.abs(knee('l'))).toBeLessThan(14);
      } finally { scene.dispose(); engine.dispose(); }
    }
  });
});
