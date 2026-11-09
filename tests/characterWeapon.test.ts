import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FreeCamera, NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CharacterAssetLibrary, type CharacterInstance } from '../src/game/CharacterAsset';
import { assetUrl } from '../src/core/assets';
import { CharacterWeaponLibrary, WEAPON_HOLDS, type CharacterWeapon } from '../src/game/CharacterWeapon';
import { aimIntent, solveInterval } from '../src/game/RemotePlayers';
import type { CharacterMotion } from '../src/game/PlayerAnimation';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import type { PlayerState } from '../shared/protocol';
import type { WeaponAction } from '../src/weapons/Weapon';

afterEach(() => vi.unstubAllGlobals());

const WEAPONS = ['rifle', 'shotgun', 'smg', 'sniper', 'semi-sniper'] as const;
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
  const weapons = new CharacterWeaponLibrary(scene, { get: () => material, ready: async () => {} } as unknown as MaterialLibrary);
  // A signal selects the cancellable fetch path (Node has no XMLHttpRequest).
  const signal = new AbortController().signal;
  await Promise.all([characters.load(signal), ...WEAPONS.map((id) => weapons.load(id, signal))]);
  const parent = new TransformNode('player', scene), character = characters.instantiate(parent, 'test')!;
  let weapon: CharacterWeapon | null = null;
  scene.onBeforeAnimationsObservable.add(() => {weapon?.restore();character.restoreLean();});
  scene.onAfterAnimationsObservable.add(() => {character.applyLean();weapon?.update();});
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
it('controlled peeking keeps feet planted and hands on each weapon at hip and ADS',async()=>{
 const {engine,scene,character,equip,step}=await rig();
 try{for(const id of WEAPONS){const gun=equip(id);
  for(const ads of [0,1]){
   character.setLean(0);gun.setState({ads});step(still,18);const rest=joints(character);
   for(const lean of [-1,1]){
   character.setLean(lean);gun.setState({ads});step(still,18);const pose=joints(character);
   expect(pose.foot_l).toEqual(rest.foot_l);expect(pose.foot_r).toEqual(rest.foot_r);
   expect((pose.head[0]-rest.head[0])*lean).toBeGreaterThan(.10);expect(Math.abs(pose.head[0]-rest.head[0])).toBeLessThan(.28);
   for(const hand of gun.inspect().hands)expect(hand.gap).toBeLessThan(.015);
   }
  }
 }}finally{character.dispose();scene.dispose();engine.dispose();}
});
it('keeps weapon contacts together in the low passage presentation',async()=>{
 const {engine,scene,parent,character,equip,step}=await rig();
 try{scene.onBeforeAnimationsObservable.add(()=>{parent.scaling.y=1;});
  scene.onAfterAnimationsObservable.add(()=>{parent.scaling.y=.78/1.15;parent.computeWorldMatrix(true);});
  for(const id of WEAPONS){const gun=equip(id);for(const ads of [0,1]){gun.setState({ads});step({...still,crouch:1,slideRemaining:.5},20);
   for(const hand of gun.inspect().hands)expect(hand.gap).toBeLessThan(.025);
  }}
 }finally{character.dispose();scene.dispose();engine.dispose();}
});

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

// Actual GLB loading plus all four weapons x nine poses exceeded 6.6s on the cohosted test machine.
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
        // Elbows stay on their own side and below their shoulders, never folded through the
        // chest: an inward support elbow must be reaching well forward, under the fore-end.
        const side = index ? -1 : 1, elbow = hand.elbow, shoulder = hand.shoulder;
        expect(elbow[0] * side, `${label} elbow side`).toBeGreaterThan(-.02);
        expect(elbow[0] * side > shoulder[0] * side * .3 || elbow[2] < shoulder[2] - .15, `${label} elbow clear of the chest`).toBe(true);
        expect(elbow[1], `${label} elbow height`).toBeLessThan(shoulder[1] + .05 + Math.max(0, pitch) * .25);
      }
      // Weapon held in front of the chest, not inside it.
      expect(Math.min(state.grips[0][2], state.grips[1][2]), `${id} ${name} in front`).toBeLessThan(j.upper_arm_r[2]);
    }
    weapon.setState({ ads: 0, pitch: 0 }); step(still, 45);
    const ready = weapon.inspect();
    weapon.setState({ ads: 1 }); step(still, 45);
    const aimed = weapon.inspect();
    // ADS raises the sight toward the eye line, well above the ready hold.
    expect(aimed.sight![1] - ready.sight![1], `${id} ADS raise`).toBeGreaterThan(.12);
    // The butt pad rests in the shoulder pocket (next to the lifted shoulder joint, inside
    // it and in front of it), clearly below the jaw rather than beside it.
    expect(Math.abs(aimed.butt[1] - aimed.shoulder![1]), `${id} butt at shoulder height`).toBeLessThan(.05);
    expect(aimed.butt[1], `${id} butt below the jaw`).toBeLessThan(aimed.head![1] - .07);
    expect(aimed.shoulder![0] - aimed.butt[0], `${id} butt inside the shoulder joint`).toBeGreaterThan(.02);
    expect(aimed.shoulder![2] - aimed.butt[2], `${id} butt in front of the shoulder joint`).toBeGreaterThan(.06);
    // Cheek weld: the head drops and tilts onto the stock, bounded, bringing the eye close
    // to the sight line; the trigger finger rests on the blade.
    expect(aimed.weld.angle).toBeGreaterThan(.2);
    expect(aimed.weld.angle).toBeLessThanOrEqual(.6 + 1e-6);
    expect(aimed.weld.residual, `${id} eye near the sight line`).toBeLessThan(.065);
    expect(aimed.triggerGap!, `${id} trigger finger on the trigger`).toBeLessThan(.012);
    expect(ready.triggerGap!, `${id} trigger finger off the trigger at rest`).toBeGreaterThan(.04);
    // The firing shoulder lifts into the stock in ADS.
    expect(aimed.clavicles![0]).toBeGreaterThan(ready.clavicles![0] + .08);
    for (const hand of aimed.hands) expect(hand.wristBend, `${id} ADS wrist`).toBeLessThan(35 * Math.PI / 180);
  }
  character.dispose(); scene.dispose(); engine.dispose();
}, 15_000);

it('works the gun with visible hand actions that rejoin the grips', async () => {
  const { engine, scene, character, equip, step } = await rig();
  const crouch = { ...still, crouch: 1 }, walk = { ...still, velocity: { x: 0, y: 0, z: -2.2 } };
  // Each case plays the gameplay action sequence at its real durations (shell reloads chain).
  const cases: [typeof WEAPONS[number], [WeaponAction, number][], CharacterMotion][] = [
    ['rifle', [['reload', 2.1]], still], ['rifle', [['reloadEmpty', 2.6]], walk], ['smg', [['reload', 1.65]], crouch],
    ['sniper', [['cycle', 1.05]], still], ['sniper', [['reloadEmpty', 3.6]], still], ['shotgun', [['cycle', .6]], walk],
    ['shotgun', [['shellStart', .45], ['shell', .5], ['shell', .5], ['shellEnd', .4]], crouch],
  ];
  for (const [id, sequence, motion] of cases) {
    const weapon = equip(id), action = sequence.map(([name]) => name).join('+');
    weapon.setState({ ads: 0, action: 'idle', progress: 0 }); step(motion, 30);
    const rest = weapon.inspect();
    const frames = sequence.flatMap(([name, seconds]) => {
      const count = Math.round(seconds * 60);
      return Array.from({ length: count }, (_, f) => [name, (f + 1) / count] as const);
    });
    let previous = rest.hands.map((h) => Vector3.FromArray(h.contact)), velocity = previous.map(() => Vector3.Zero());
    let away = 0, bolt = 0, pump = 0, magazine = 0, shell = false, jerk = 0, gap = 0;
    for (const [name, progress] of frames) {
      weapon.setState({ action: name, progress });
      step(motion, 1);
      const s = weapon.inspect();
      away = Math.max(away, s.action.support); bolt = Math.max(bolt, s.action.bolt); pump = Math.max(pump, s.action.pump);
      magazine = Math.max(magazine, s.action.mag ? Math.hypot(...s.action.mag) : 0); shell ||= s.action.shell;
      // Hands track their (moving) targets, without teleports between frames.
      for (const [i, hand] of s.hands.entries()) {
        gap = Math.max(gap, hand.gap);
        const now = Vector3.FromArray(hand.contact), moved = now.subtract(previous[i]);
        jerk = Math.max(jerk, moved.subtract(velocity[i]).length());
        velocity[i] = moved; previous[i] = now;
      }
    }
    expect(gap, `${id} ${action} hands on their targets`).toBeLessThan(.01);
    expect(jerk, `${id} ${action} smooth hand motion`).toBeLessThan(.03);
    if (action.startsWith('reload')) { expect(away).toBeGreaterThan(.99); expect(magazine, `${id} magazine travels`).toBeGreaterThan(.1); }
    if (action.includes('shell+')) { expect(away).toBeGreaterThan(.99); expect(shell).toBe(true); }
    if (id === 'sniper') expect(bolt, 'trigger hand works the bolt').toBeGreaterThan(.99);
    if (id === 'shotgun' && action === 'cycle') expect(pump, 'pump stroke').toBeCloseTo(.085, 3);
    // Finished: back on both grips with the parts at rest.
    weapon.setState({ action: 'idle', progress: 0 }); step(motion, 20);
    const done = weapon.inspect();
    for (const [i, hand] of done.hands.entries()) {
      expect(Vector3.Distance(Vector3.FromArray(hand.handle), Vector3.FromArray(hand.contact)), `${id} ${action} hand ${i} back on its grip`).toBeLessThan(.01);
      // Same handle relative to the weapon's own grip anchor as before the action (walking moves both).
      const offset = (h: typeof hand, grip: number[]) => Vector3.Distance(Vector3.FromArray(h.handle), Vector3.FromArray(grip));
      expect(Math.abs(offset(hand, done.grips[i]) - offset(rest.hands[i], rest.grips[i])), `${id} ${action} hand ${i} at its rest grip`).toBeLessThan(.005);
    }
    expect(done.action.mag?.every((v) => Math.abs(v) < 1e-6) ?? true).toBe(true);
  }
  character.dispose(); scene.dispose(); engine.dispose();
});

it('reuses the last solve for distant players on skipped frames', async () => {
  const { engine, scene, character, equip, step } = await rig();
  const weapon = equip('rifle');
  step(still, 20);
  weapon.solveEvery = 3;
  const before = weapon.solves;
  step(still, 30, () => { for (const hand of weapon.inspect().hands) expect(hand.gap).toBeLessThan(.01); });
  expect(weapon.solves - before).toBe(10);
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
  // The presented (interpolated) action wins over the newest sample's.
  expect(aimIntent(player(true, 'idle'), 'reload')).toBe(0);
  expect(aimIntent(player(true, 'reload'), 'idle')).toBe(1);
  // Distant players solve their arms less often; low graphics quality brings that closer.
  expect([solveInterval(8), solveInterval(20), solveInterval(40), solveInterval(10, .5), solveInterval(20, .5)]).toEqual([1, 2, 3, 2, 3]);
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
