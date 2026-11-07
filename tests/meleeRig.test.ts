import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { FreeCamera, NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CharacterAssetLibrary } from '../src/game/CharacterAsset';
import { CharacterWeaponLibrary, type CharacterWeapon } from '../src/game/CharacterWeapon';
import { MeleeLibrary } from '../src/game/melee/MeleeAssets';
import { MELEE_CLIPS, type MeleeClipName } from '../src/game/melee/MeleeAnimation';
import type { CharacterMotion } from '../src/game/PlayerAnimation';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import { MeleeView } from '../src/weapons/MeleeView';
import type { RenderContext } from '../src/rendering/RenderContext';
import { createMeleeState } from '../shared/melee';

afterEach(() => vi.unstubAllGlobals());
const still: CharacterMotion = { velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, slideRemaining: 0 };
const WEAPONS = ['rifle', 'smg', 'shotgun', 'sniper'] as const;

/** Real character, gun and dagger GLBs with the game's restore/update order. */
async function rig() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(`public/${url.replace(/^.*?assets\//, 'assets/')}`)));
  const engine = new NullEngine();
  const scene = new Scene(engine); scene.useRightHandedSystem = true; scene.useConstantAnimationDeltaTime = true;
  new FreeCamera('camera', new Vector3(0, 1.5, -4), scene);
  const characters = new CharacterAssetLibrary(scene), melee = new MeleeLibrary(scene);
  const material = new StandardMaterial('test', scene);
  const weapons = new CharacterWeaponLibrary(scene, { get: () => material, ready: async () => {} } as unknown as MaterialLibrary);
  const signal = new AbortController().signal;
  await Promise.all([characters.load(signal), melee.load(signal), ...WEAPONS.map((id) => weapons.load(id, signal))]);
  const parent = new TransformNode('player', scene), character = characters.instantiate(parent, 'test')!;
  const daggers = melee.createCharacterMelee('test-melee')!;
  let weapon: CharacterWeapon | null = null;
  scene.onBeforeAnimationsObservable.add(() => weapon?.restore());
  scene.onAfterAnimationsObservable.add(() => weapon?.update());
  const equip = (id: typeof WEAPONS[number]) => { weapon?.dispose(); weapon = weapons.create(character, id); weapon!.melee = daggers; return weapon!; };
  const step = (frames: number, sample?: () => void, pitch = 0) => {
    for (let i = 0; i < frames; i++) {
      character.update(still, 1 / 60); daggers.advance(1 / 60);
      weapon?.setState({ pitch }); weapon?.advance(1 / 60); scene.render(); sample?.();
    }
  };
  return { engine, scene, character, daggers, melee, equip, step, weapon: () => weapon! };
}

it('reapplies the observed melee pose after a death reset even when its snapshot key is unchanged',async()=>{
  const {engine,scene,melee}=await rig(),view=new MeleeView({scene,camera:scene.activeCamera} as RenderContext,melee);
  try{
    await view.load(new AbortController().signal);const state={...createMeleeState(),phase:'ready' as const,startedAt:100};
    view.sync(state,600);view.advance(.2);expect(view.gunVisible).toBe(false);
    view.reset();expect(view.gunVisible).toBe(true);
    view.sync(state,600);view.advance(.2);expect(view.gunVisible).toBe(false);expect(view.state).toBe('ready');
  }finally{view.dispose();scene.dispose();engine.dispose();}
});

it('keeps both hands on their dagger handles through every clip, with natural wrists', async () => {
  const { engine, scene, daggers, equip, step, weapon } = await rig();
  equip('rifle');
  step(5);
  const stats: Record<string, { gap: number; wrist: number; reach: number; worstAt: number }> = {};
  for (const clip of MELEE_CLIPS) {
    daggers.animator.play(clip as MeleeClipName);
    const s = { gap: 0, wrist: 0, reach: -1, worstAt: 0 };
    const frames = Math.round(daggers.animator.clips.clip(clip).duration * 60);
    step(frames, () => {
      const m = weapon().inspectMelee()!;
      if (m.hands < .999) return;
      for (const hand of m.fit) {
        if (hand.gap > s.gap) { s.gap = hand.gap; s.worstAt = m.time; }
        s.wrist = Math.max(s.wrist, hand.wristBend); s.reach = Math.max(s.reach, hand.reach);
      }
    });
    stats[clip] = { gap: +s.gap.toFixed(4), wrist: +(s.wrist * 180 / Math.PI).toFixed(1), reach: +s.reach.toFixed(3), worstAt: +s.worstAt.toFixed(3) };
  }
  console.info('melee fit', stats);
  for (const [clip, s] of Object.entries(stats)) {
    // Within reach the IK lands the fist on the socket; at full extension the dagger stays in
    // the fist (it is parented to the hand) and the hand stops just short.
    expect(s.gap, clip).toBeLessThan(.03);
    expect(s.wrist, clip).toBeLessThan(30);
  }
  scene.dispose(); engine.dispose();
});

it('parents the daggers to the hands: the grip anchor is exactly the enclosed handle centre', async () => {
  const { engine, scene, daggers, equip, step, weapon } = await rig();
  equip('smg');
  daggers.animator.equip(); step(40);
  daggers.animator.attack(); step(12);
  const m = weapon().inspectMelee()!;
  for (let i = 0; i < 2; i++) expect(Vector3.Distance(Vector3.FromArray(m.grips[i]), Vector3.FromArray(m.fit[i].hand))).toBeLessThan(.002);
  expect(m.daggersVisible).toEqual([true, true]);
  expect(m.gunVisible).toBe(false);
  scene.dispose(); engine.dispose();
});

it('lowers and hides every gun on equip and brings it back to the grip on unequip', async () => {
  const { engine, scene, daggers, equip, step, weapon } = await rig();
  for (const id of WEAPONS) {
    equip(id); daggers.animator.reset(); step(4);
    const before = weapon().inspect();
    daggers.animator.equip(); step(6);
    expect(weapon().inspectMelee()!.gunVisible).toBe(true);
    step(30);
    expect(weapon().inspectMelee()).toMatchObject({ gunVisible: false, daggersVisible: [true, true], state: 'ready' });
    daggers.animator.unequip(); step(16);
    expect(weapon().inspectMelee()!.daggersVisible).toEqual([false, false]);
    step(14);
    const after = weapon().inspect();
    expect(weapon().inspectMelee()).toMatchObject({ gunVisible: true, state: 'hidden', hands: 0 });
    // Hands back on the gun grips exactly as before the switch.
    for (let i = 0; i < 2; i++) expect(after.hands[i].gap).toBeLessThan(Math.max(.012, before.hands[i].gap + .004));
  }
  scene.dispose(); engine.dispose();
});

it('survives a gun swap while the daggers are out (the daggers belong to the character)', async () => {
  const { engine, scene, daggers, equip, step, weapon } = await rig();
  equip('rifle'); daggers.animator.equip(); step(40);
  equip('shotgun'); step(3);
  expect(weapon().inspectMelee()).toMatchObject({ gunVisible: false, daggersVisible: [true, true] });
  scene.dispose(); engine.dispose();
});

/** Closest distance between segments p0-p1 and q0-q1. */
function segmentDistance(p0: Vector3, p1: Vector3, q0: Vector3, q1: Vector3): number {
  let best = Infinity;
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++)
    best = Math.min(best, Vector3.Distance(Vector3.Lerp(p0, p1, i / 20), Vector3.Lerp(q0, q1, j / 20)));
  return best;
}

it('keeps the forearms apart where the arms cross (no arm passes through the other)', async () => {
  const { engine, scene, daggers, equip, step, weapon } = await rig();
  equip('rifle'); step(3);
  let closest = Infinity, at = '', worst: number[][] = [];
  for (const clip of MELEE_CLIPS) {
    daggers.animator.reset(); daggers.animator.play(clip as MeleeClipName);
    step(Math.round(daggers.animator.clips.clip(clip).duration * 60), () => {
      const hands = weapon().inspect().hands;
      // Elbow to the enclosed handle centre of both arms.
      const [r, l] = hands.map((h) => ({ elbow: Vector3.FromArray(h.elbow), wrist: Vector3.FromArray(h.contact) }));
      const d = segmentDistance(r.elbow, r.wrist, l.elbow, l.wrist);
      if (d < closest) { closest = d; at = `${clip}@${daggers.animator.time.toFixed(3)}`;
        worst = [r.elbow, r.wrist, l.elbow, l.wrist].map((v) => v.asArray().map((c) => +c.toFixed(3))); }
    });
  }
  console.info('forearm clearance', closest.toFixed(3), at, JSON.stringify(worst));
  // Segments run elbow -> enclosed handle centre; cuffs/gloves there are ~3.1-3.3 cm in
  // radius, so 6 cm between centrelines is arms brushing as they cross, never passing through.
  expect(closest, at).toBeGreaterThan(.06);
  scene.dispose(); engine.dispose();
});
