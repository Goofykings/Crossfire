import { expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PerformanceObserver } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { FreeCamera, NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CharacterAssetLibrary } from '../src/game/CharacterAsset';
import { CharacterWeaponLibrary, type CharacterWeapon } from '../src/game/CharacterWeapon';
import type { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import type { WeaponId } from '../src/weapons/Weapon';

/** Opt-in CPU profile of the third-person rig (real GLBs, NullEngine, real animation
 * evaluation): CHARACTER_PERF=1 npx vitest run tests/characterPerf.test.ts
 * Writes test-results/character-perf.json. Node CPU only; GPU skinning is not measured. */
it.runIf(process.env.CHARACTER_PERF)('profiles the rig with 1, 3 and 6 posed characters', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(`public/${url.replace(/^.*?assets\//, 'assets/')}`)));
  const engine = new NullEngine();
  const scene = new Scene(engine); scene.useRightHandedSystem = true; scene.useConstantAnimationDeltaTime = true;
  new FreeCamera('camera', new Vector3(0, 1.5, -6), scene);
  const characters = new CharacterAssetLibrary(scene);
  const material = new StandardMaterial('m', scene);
  const library = new CharacterWeaponLibrary(scene, { get: () => material } as unknown as MaterialLibrary);
  const ids: WeaponId[] = ['rifle', 'smg', 'shotgun', 'sniper'];
  const signal = new AbortController().signal;
  await Promise.all([characters.load(signal), ...ids.map((id) => library.load(id, signal))]);
  const avatars: { character: NonNullable<ReturnType<CharacterAssetLibrary['instantiate']>>; weapon: CharacterWeapon }[] = [];
  let rigTime = 0;
  scene.onBeforeAnimationsObservable.add(() => { for (const a of avatars) a.weapon.restore(); });
  scene.onAfterAnimationsObservable.add(() => {
    const start = performance.now();
    for (const a of avatars) a.weapon.update();
    rigTime += performance.now() - start;
  });
  let collections = 0;
  const observer = new PerformanceObserver((list) => { collections += list.getEntries().length; });
  observer.observe({ entryTypes: ['gc'] });
  const results: Record<string, unknown>[] = [];
  // [characters, solve every Nth frame]: the last row is six distant players (RemotePlayers.solveInterval).
  for (const [count, every] of [[1, 1], [3, 1], [6, 1], [6, 3]]) {
    while (avatars.length < count) {
      const i = avatars.length, parent = new TransformNode(`p${i}`, scene);
      parent.position.set((i % 3 - 1) * 1.2, 0, Math.floor(i / 3) * 1.5);
      const character = characters.instantiate(parent, `perf${i}`)!;
      avatars.push({ character, weapon: library.create(character, ids[i % ids.length])! });
    }
    for (const a of avatars) a.weapon.solveEvery = every;
    // Mixed states: ADS, walking, firing and a reload, advanced like RemotePlayers does.
    const frame = (f: number) => {
      for (const [i, a] of avatars.entries()) {
        const walking = i % 2 === 1;
        a.character.update({ velocity: { x: 0, y: 0, z: walking ? -2.2 : 0 }, grounded: true, crouch: i === 2 ? 1 : 0, slideRemaining: 0 }, 1 / 60);
        a.weapon.setState({ ads: i % 3 === 0 ? 1 : 0, pitch: Math.sin(f / 40) * .3, action: i === 4 ? 'reload' : 'idle', progress: (f % 120) / 120 });
        if (i === 1 && f % 6 === 0) a.weapon.fire();
        a.weapon.advance(1 / 60);
      }
      scene.render();
    };
    for (let f = 0; f < 120; f++) frame(f);
    rigTime = 0; collections = 0;
    const frames = 600, start = performance.now();
    for (let f = 0; f < frames; f++) frame(f);
    const total = performance.now() - start;
    results.push({ characters: count, solveEvery: every, frameMs: +(total / frames).toFixed(3), rigMs: +(rigTime / frames).toFixed(3),
      rigMsPerCharacter: +(rigTime / frames / count).toFixed(3), gcEvents: collections,
      skinnedMeshes: scene.meshes.filter((m) => m.skeleton).length, solves: avatars.reduce((n, a) => n + a.weapon.solves, 0) });
  }
  observer.disconnect();
  // CHARACTER_PROFILE=<file>: a V8 CPU profile of 600 more frames with six characters.
  if (process.env.CHARACTER_PROFILE) {
    for (const a of avatars) a.weapon.solveEvery = 1;
    const session = new Session(); session.connect();
    await session.post('Profiler.enable'); await session.post('Profiler.start');
    for (let f = 0; f < 600; f++) {
      for (const a of avatars) { a.character.update({ velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, slideRemaining: 0 }, 1 / 60); a.weapon.advance(1 / 60); }
      scene.render();
    }
    const { profile } = await session.post('Profiler.stop');
    await writeFile(process.env.CHARACTER_PROFILE, JSON.stringify(profile));
    session.disconnect();
  }
  // Allocations by function (sampled, including objects already collected) over 300 frames.
  for (const a of avatars) a.weapon.solveEvery = 1;
  const session = new Session(); session.connect();
  await session.post('HeapProfiler.enable');
  await session.post('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const sampled = 300;
  for (let f = 0; f < sampled; f++) {
    for (const a of avatars) { a.character.update({ velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, slideRemaining: 0 }, 1 / 60); a.weapon.setState({ ads: f % 2 }); a.weapon.advance(1 / 60); }
    scene.render();
  }
  const { profile: heapProfile } = await session.post('HeapProfiler.stopSampling');
  session.disconnect();
  let rigBytes = 0, allBytes = 0;
  type HeapNode = { callFrame: { url: string; functionName: string; lineNumber: number }; selfSize: number; children: HeapNode[] };
  const sites = new Map<string, number>();
  const walk = (node: HeapNode, site: string | null) => {
    const own = /CharacterWeapon|CharacterActions/.test(node.callFrame.url) ? `${node.callFrame.functionName}:${node.callFrame.lineNumber + 1}` : null;
    const at = own ?? site;
    allBytes += node.selfSize;
    if (at) { rigBytes += node.selfSize; sites.set(at, (sites.get(at) ?? 0) + node.selfSize); }
    for (const child of node.children) walk(child, at);
  };
  walk(heapProfile.head as unknown as HeapNode, null);
  const allocation = { characters: avatars.length, rigKbPerCharacterFrame: +(rigBytes / sampled / avatars.length / 1024).toFixed(1),
    totalKbPerFrame: +(allBytes / sampled / 1024).toFixed(1),
    // Innermost rig function on each allocating stack (bytes per character-frame).
    sites: [...sites].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([at, bytes]) => [at, +(bytes / sampled / avatars.length).toFixed(0)]) };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/character-perf.json', JSON.stringify({ node: process.version, results, allocation }, null, 2));
  expect(results).toHaveLength(4);
}, 600000);
