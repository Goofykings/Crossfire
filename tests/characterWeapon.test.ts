import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FreeCamera, NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CharacterAssetLibrary, type CharacterInstance } from '../src/game/CharacterAsset';
import { assetUrl } from '../src/core/assets';
import { CharacterWeaponLibrary, WEAPON_HOLDS, type CharacterWeapon } from '../src/game/CharacterWeapon';
import { aimIntent } from '../src/game/RemotePlayers';
import type { CharacterMotion } from '../src/game/PlayerAnimation';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import type { PlayerState } from '../shared/protocol';

afterEach(() => vi.unstubAllGlobals());

const WEAPONS = ['rifle', 'shotgun', 'smg', 'sniper'] as const;
const still: CharacterMotion = { velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, slideRemaining: 0 };

/** Real GLBs, real animation evaluation and the same restore/update order as the game. */
async function rig() {
  const requested: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    return new Response(await readFile(`public/${url.replace(/^.*?assets\//, 'assets/')}`));
  });
  const engine = new NullEngine();
  const scene = new Scene(engine); scene.useRightHandedSystem = true; scene.useConstantAnimationDeltaTime = true;
  new FreeCamera('camera', new Vector3(0, 1.5, -4), scene);
  const characters = new CharacterAssetLibrary(scene);
  const material = new StandardMaterial('test', scene);
  const weapons = new CharacterWeaponLibrary(scene, { get: () => material } as unknown as MaterialLibrary);
  // A signal selects the cancellable fetch path (Node has no XMLHttpRequest).
  const signal = new AbortController().signal;
  await Promise.all([characters.load(signal), ...WEAPONS.map((id) => weapons.load(id, signal))]);
  const parent = new TransformNode('player', scene), character = characters.instantiate(parent, 'test')!;
  let weapon: CharacterWeapon | null = null;
  scene.onBeforeAnimationsObservable.add(() => weapon?.restore());
  scene.onAfterAnimationsObservable.add(() => weapon?.update());
  const equip = (id: typeof WEAPONS[number]) => { weapon?.dispose(); weapon = weapons.create(character, id); return weapon!; };
  /** Advance 1/60 s frames: locomotion clip, hold smoothing, render (animations + IK). */
  const step = (motion: CharacterMotion, frames: number, sample?: () => void) => {
    for (let i = 0; i < frames; i++) {
      character.update(motion, 1 / 60); weapon?.setState({ airborne: !motion.grounded }); weapon?.advance(1 / 60);
      scene.render(); sample?.();
    }
  };
  return { requested, engine, scene, character, weapons, parent, equip, step };
}

const joints = (c: CharacterInstance) => c.inspect().joints;

it('derives arm rest frames from the exported bind pose and attaches each actual weapon once', async () => {
  const { requested, engine, scene, character, equip } = await rig();
  expect(requested).toContain(assetUrl('assets/characters/player.json'));
  expect(requested).toContain(assetUrl('assets/characters/player.glb'));
  const weapon = equip('rifle');
  for (const hand of weapon.inspect().hands) {
    // Bones point along local +Y: the derived A-pose axes must agree with the skeleton.
    for (const axis of Object.values(hand.rest)) expect(Vector3.FromArray(axis).subtract(Vector3.Up()).length()).toBeLessThan(1e-4);
  }
  for (const id of WEAPONS) {
    const held = equip(id);
    expect(held.inspect()).toMatchObject({ id, instances: 1 });
    expect(held.inspect().grips).toHaveLength(2);
    expect(held.meshes.length).toBeGreaterThan(0);
  }
  equip('rifle').dispose();
  expect(scene.transformNodes.filter((n) => /^held:/.test(n.name))).toHaveLength(0);
  character.dispose(); scene.dispose(); engine.dispose();
});

it('keeps both hands on every weapon with natural elbows and wrists in each stance', async () => {
  const { engine, scene, character, equip, step } = await rig();
  const stances: [string, CharacterMotion, number, number][] = [
    ['ready', still, 0, 0], ['ads', still, 1, 0], ['crouch', { ...still, crouch: 1 }, 0, 0],
    ['crouch ads', { ...still, crouch: 1 }, 1, 0], ['look up ads', still, 1, .6], ['look down', still, 0, -.7],
    ['run', { ...still, velocity: { x: 0, y: 0, z: -4.7 } }, 0, 0],
    ['slide', { ...still, velocity: { x: 0, y: 0, z: -6 }, slideRemaining: .8, crouch: .6 }, 0, 0],
    ['airborne', { ...still, grounded: false, velocity: { x: 0, y: 2, z: 0 } }, 0, 0],
  ];
  for (const id of WEAPONS) {
    const weapon = equip(id);
    for (const [name, motion, ads, pitch] of stances) {
      weapon.setState({ ads, pitch });
      step(motion, 45);
      const state = weapon.inspect(), j = joints(character);
      for (const [index, hand] of state.hands.entries()) {
        const label = `${id} ${name} ${index ? 'support' : 'trigger'} hand`;
        expect(hand.gap, `${label} encloses its handle`).toBeLessThan(.01);
        expect(hand.wristBend, `${label} wrist`).toBeLessThan(55 * Math.PI / 180);
        expect(hand.elbowBend, `${label} elbow`).toBeLessThan(140 * Math.PI / 180);
        // Elbows stay outside and below their shoulders, never folded through the chest.
        const side = index ? -1 : 1, elbow = hand.elbow, shoulder = hand.shoulder;
        expect(Math.sign(elbow[0] - shoulder[0] * .3) || side, `${label} elbow side`).toBe(side);
        expect(elbow[1], `${label} elbow height`).toBeLessThan(shoulder[1] + .05 + Math.max(0, pitch) * .25);
      }
      // Weapon held in front of the chest, not inside it.
      expect(Math.min(state.grips[0][2], state.grips[1][2]), `${id} ${name} in front`).toBeLessThan(j.upper_arm_r[2]);
    }
    if (id === 'rifle') {
      // ADS lifts the sight to the eye line: well above the ready grip.
      weapon.setState({ ads: 0, pitch: 0 }); step(still, 45);
      const ready = weapon.inspect().sight![1];
      weapon.setState({ ads: 1 }); step(still, 45);
      const aimed = weapon.inspect();
      expect(aimed.sight![1] - ready).toBeGreaterThan(.2);
      expect(Math.abs(aimed.sight![1] - (aimed.head![1] + .04))).toBeLessThan(.03);
    }
  }
  character.dispose(); scene.dispose(); engine.dispose();
});

it('blends every transition by elapsed time without snapping bones or detaching hands', async () => {
  const { engine, scene, character, equip, step } = await rig();
  const weapon = equip('rifle');
  const crouch = { ...still, crouch: 1 };
  const run = { ...still, velocity: { x: 0, y: 0, z: -4.7 } };
  const slide = { ...still, velocity: { x: 0, y: 0, z: -6 }, slideRemaining: .8, crouch: .6 };
  const air = { ...still, grounded: false, velocity: { x: 0, y: 3, z: 0 } };
  step(still, 60);
  const points = () => { const j = joints(character), s = weapon.inspect(); return [j.hand_r, j.hand_l, j.forearm_r, j.forearm_l, j.head, s.muzzle!]
    .map((p) => Vector3.FromArray(p)); };
  let previous = points(), velocity = previous.map(() => Vector3.Zero());
  let worstStep = 0, worstGap = 0;
  const worstJerk = previous.map(() => 0);
  const sample = () => {
    const now = points();
    for (const [i, p] of now.entries()) {
      const moved = p.subtract(previous[i]);
      worstStep = Math.max(worstStep, moved.length());
      // A pop shows up as a sudden change of per-frame displacement, not as fast motion.
      const jerk = moved.subtract(velocity[i]).length();
      worstJerk[i] = Math.max(worstJerk[i], jerk);
      velocity[i] = moved;
    }
    for (const hand of weapon.inspect().hands) worstGap = Math.max(worstGap, hand.gap);
    previous = now;
  };
  const sequence: [CharacterMotion, number, number][] = [
    [still, 1, 20], [still, 0, 20], [crouch, 0, 30], [crouch, 1, 25], [still, 1, 30], [crouch, 1, 25],
    [still, 0, 25], [run, 0, 30], [slide, 0, 40], [still, 0, 30], [air, 0, 20], [still, 0, 30],
  ];
  for (const [motion, ads, frames] of sequence) { weapon.setState({ ads }); step(motion, frames, sample); }
  // Fast 150 ms raises are allowed; teleports are not (bounded displacement and its change).
  // Hands, forearms and head move with the body; the muzzle tip has a 0.66 m lever arm.
  expect(worstStep).toBeLessThan(.13);
  expect(Math.max(...worstJerk.slice(0, 5))).toBeLessThan(.05);
  expect(worstJerk[5]).toBeLessThan(.07);
  expect(worstGap).toBeLessThan(.01);
  character.dispose(); scene.dispose(); engine.dispose();
});

it('times the ADS blend near 150 ms and returns cosmetic recoil to rest', async () => {
  const { engine, scene, character, equip, step } = await rig();
  const weapon = equip('rifle');
  step(still, 30);
  weapon.setState({ ads: 1 });
  let frames = 0;
  while (weapon.inspect().adsBlend < .95 && frames < 60) { step(still, 1); frames++; }
  expect(frames / 60).toBeGreaterThan(.1);
  expect(frames / 60).toBeLessThan(.19);
  weapon.setState({ ads: 0 }); frames = 0;
  while (weapon.inspect().adsBlend > .05 && frames < 60) { step(still, 1); frames++; }
  expect(frames / 60).toBeLessThan(.19);
  step(still, 30);
  const rest = weapon.inspect().muzzle!;
  weapon.fire(); step(still, 3);
  const kicked = weapon.inspect();
  expect(kicked.shots).toBe(1);
  expect(kicked.muzzle![1] - rest[1]).toBeGreaterThan(.005);
  expect(Math.max(...kicked.hands.map((h) => h.gap))).toBeLessThan(.01);
  step(still, 40);
  expect(Math.abs(weapon.inspect().recoil)).toBeLessThan(.02);
  // Heavier weapons kick harder than the automatic ones.
  expect(WEAPON_HOLDS.shotgun.recoil.rise).toBeGreaterThan(WEAPON_HOLDS.rifle.recoil.rise);
  expect(WEAPON_HOLDS.sniper.recoil.rise).toBeGreaterThan(WEAPON_HOLDS.smg.recoil.rise);
  character.dispose(); scene.dispose(); engine.dispose();
});

it('derives remote ADS intent from synchronized aim and action like the weapon state machine', () => {
  const player = (aimHeld: boolean, action: string, weapon: PlayerState['weapon'] = 'rifle') =>
    ({ weapon, combat: { aimHeld, gun: { action } } }) as unknown as PlayerState;
  expect(aimIntent(player(true, 'idle'))).toBe(1);
  expect(aimIntent(player(false, 'idle'))).toBe(0);
  expect(aimIntent(player(true, 'reload'))).toBe(0);
  expect(aimIntent(player(true, 'cycle', 'shotgun'))).toBe(1);
  expect(aimIntent(player(true, 'cycle', 'sniper'))).toBe(0);
  expect(aimIntent({ weapon: null, combat: { aimHeld: true, gun: null } } as unknown as PlayerState)).toBe(0);
});

it('keeps character asset failures nonfatal when the metadata is unavailable', async () => {
  vi.stubGlobal('fetch', async () => new Response('Not found', { status: 404 }));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const characters = new CharacterAssetLibrary(scene);
    await expect(characters.load()).resolves.toBeUndefined();
    expect(characters.inspect()).toMatchObject({ state: 'error', file: null });
  } finally { warning.mockRestore(); scene.dispose(); engine.dispose(); }
});
