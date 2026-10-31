import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CharacterAssetLibrary } from '../src/game/CharacterAsset';
import { assetUrl } from '../src/core/assets';
import { CharacterWeaponLibrary } from '../src/game/CharacterWeapon';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';

afterEach(() => vi.unstubAllGlobals());

it('attaches actual weapon assets to the actual animated rig and updates its pose without duplicate meshes', async () => {
  const requested: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    const file = `public/${url.replace(/^.*?assets\//, 'assets/')}`;
    return new Response(await readFile(file));
  });
  const engine = new NullEngine();
  const scene = new Scene(engine); scene.useRightHandedSystem = true;
  const signal = new AbortController().signal;
  const characters = new CharacterAssetLibrary(scene);
  const material = new StandardMaterial('test', scene);
  const weapons = new CharacterWeaponLibrary(scene, { get: () => material } as unknown as MaterialLibrary);
  await Promise.all([characters.load(signal), ...(['rifle', 'shotgun', 'smg', 'sniper'] as const).map((id) => weapons.load(id, signal))]);
  expect(requested).toContain(assetUrl('assets/characters/player.json'));
  expect(requested).toContain(assetUrl('assets/characters/player.glb'));
  const parent = new TransformNode('player', scene), character = characters.instantiate(parent, 'test');
  expect(character).not.toBeNull();
  const weapon = weapons.create(character!, 'rifle');
  expect(weapon).not.toBeNull();
  const before = weapon!.inspect();
  expect(before.grips).toHaveLength(2);
  expect(before.meshes).toBeGreaterThan(0);
  character!.update({ velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, slideRemaining: 0 }, 1 / 60);
  weapon!.setPose(.35, 1); weapon!.update();
  const after = weapon!.inspect();
  expect(after.pitch).toBe(.35); expect(after.ads).toBe(1);
  expect(after.grips.flat().every(Number.isFinite)).toBe(true);
  const joints = character!.inspect().joints;
  expect(Vector3.Distance(Vector3.FromArray(after.grips[0]), Vector3.FromArray(joints.hand_r))).toBeLessThan(.1);
  expect(Vector3.Distance(Vector3.FromArray(after.grips[1]), Vector3.FromArray(joints.hand_l))).toBeLessThan(.1);
  weapon!.dispose();
  expect(scene.transformNodes.filter((n) => n.name === 'held:rifle')).toHaveLength(0);
  for (const id of ['shotgun', 'smg', 'sniper'] as const) {
    const replacement = weapons.create(character!, id);
    expect(replacement?.inspect()).toMatchObject({ id, instances: 1 });
    expect(replacement?.inspect().grips).toHaveLength(2);
    replacement?.dispose();
  }
  character!.dispose(); scene.dispose(); engine.dispose();
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
