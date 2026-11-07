import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { NullEngine, Scene, TransformNode, VertexBuffer, type Mesh } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { loadContainer } from '../src/core/loadContainer';
import { broadenCharacter } from '../src/game/CharacterProportions';

afterEach(() => vi.unstubAllGlobals());
it('broadens the actual shared body mesh while preserving height, head, hands, bones, clips and UVs', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(`public/${url.replace(/^.*?assets\//, 'assets/')}`)));
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const asset = await loadContainer('assets/characters/player.glb', scene, new AbortController().signal);
    const skeleton = asset.skeletons[0], bones = skeleton.bones.map(b => Array.from(b.getBindMatrix().m));
    const clips = asset.animationGroups.map(g => g.serialize());
    const meshes = asset.meshes.filter(m => m.getTotalVertices()) as Mesh[];
    const before = meshes.map(m => ({ positions: Array.from(m.getVerticesData(VertexBuffer.PositionKind)!),
      uv: Array.from(m.getVerticesData(VertexBuffer.UVKind)!), indices: Array.from(m.getIndices()!) }));
    broadenCharacter(asset.meshes);
    let widened = 0, unchangedHeadHands = 0, torso = 0, legs = 0, arms = 0;
    meshes.forEach((mesh, k) => {
      const p = mesh.getVerticesData(VertexBuffer.PositionKind)!, original = before[k].positions;
      const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!, indices = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
      expect(Array.from(mesh.getVerticesData(VertexBuffer.UVKind)!)).toEqual(before[k].uv);
      expect(Array.from(mesh.getIndices()!)).toEqual(before[k].indices);
      for (let v = 0; v < p.length / 3; v++) {
        const i = v * 3;
        expect(p[i + 1]).toBe(original[i + 1]); expect(p[i + 2]).toBe(original[i + 2]);
        const names = Array.from({length:4}, (_, j) => weights[v * 4 + j] > .00001 ? skeleton.bones[indices[v * 4 + j]]?.name : '').filter(Boolean);
        if (names.every(n => /^(head|neck|hand_|index_)/.test(n!))) {
          expect(p[i]).toBe(original[i]); unchangedHeadHands++;
        }
        if (Math.abs(p[i] - original[i]) > .00001) {
          widened++;
          if(names.includes('chest'))torso++;
          if(names.some(n=>n!.startsWith('thigh')))legs++;
          if(names.some(n=>n!.startsWith('upper_arm')))arms++;
        }
        if (names.length === 1 && names[0] === 'chest') expect(p[i]).toBeCloseTo(original[i] * 1.12, 6);
      }
    });
    expect(widened).toBeGreaterThan(100);expect(unchangedHeadHands).toBeGreaterThan(100);
    expect(torso).toBeGreaterThan(100);expect(legs).toBeGreaterThan(100);expect(arms).toBeGreaterThan(100);
    expect(skeleton.bones.map(b => Array.from(b.getBindMatrix().m))).toEqual(bones);
    expect(asset.animationGroups.map(g => g.serialize())).toEqual(clips);
    const once = meshes.map(m => Array.from(m.getVerticesData(VertexBuffer.PositionKind)!));
    broadenCharacter(asset.meshes);
    expect(meshes.map(m => Array.from(m.getVerticesData(VertexBuffer.PositionKind)!))).toEqual(once);
    const instances = [0, 1].map(i => asset.instantiateModelsToScene(n => `${i}:${n}`, false, {doNotInstantiate:true}));
    for(const entry of instances){
      const parent=new TransformNode('parent',scene);for(const root of entry.rootNodes)root.parent=parent;
      expect(parent.getChildMeshes().filter(m=>m.getTotalVertices()).map(m=>(m as Mesh).geometry)).toEqual(meshes.map(m=>m.geometry));
      entry.dispose();parent.dispose();
    }
    asset.dispose();
  } finally { scene.dispose(); engine.dispose(); }
});
