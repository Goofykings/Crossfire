import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, NullEngine, PBRMaterial, RawTexture, Scene, Texture, Vector3, VertexData } from '@babylonjs/core';
import { FoliageLod } from '../src/maps/FoliageLod';
import { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import { PuddleReflections } from '../src/rendering/PuddleReflections';
import { CHROMEBOOK_PRESET, GRAPHICS_PRESETS } from '../src/rendering/quality';

/**
 * Farmstead polish (2026-11-10): bush and hedge foliage has a detailed and a lite set, drawn by distance and by Chromebook
 * mode; the shelter's puddles reflect through ONE planar mirror from Medium up and own no render target on Low or Chromebook.
 */
const manifest = JSON.parse(readFileSync('public/assets/materials.json', 'utf8'));
let engine: NullEngine, scene: Scene;
beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterEach(() => { scene.dispose(); engine.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function batch(name: string, canonical: string, at: Vector3): Mesh {
  const m = new Mesh(name, scene);
  const v = new VertexData();
  v.positions = [at.x - 1, at.y, at.z - 1, at.x + 1, at.y, at.z - 1, at.x, at.y + 1, at.z + 1];
  v.indices = [0, 1, 2];
  v.applyToMesh(m);
  m.metadata = { canonical };
  return m;
}

describe('foliage detail sets', () => {
  it('has a lite twin of every foliage material and the new shelter materials', () => {
    for (const name of ['leaf_bush', 'leaf_bush_lite', 'leaf_core', 'puddle', 'concrete_wet', 'bulb_warm', 'bulb_cold', 'bulb_dead', 'scope_glass']) {
      expect(name in manifest.materials, name).toBe(true);
    }
    const a = manifest.materials.leaf_bush, b = manifest.materials.leaf_bush_lite;
    // the batcher keys canonical materials by their definition without the tint: the twins must differ or they would merge
    const key = (d: Record<string, unknown>) => JSON.stringify({ ...d, tint: 0 });
    expect(key(a)).not.toEqual(key(b));
    expect(a.albedo).toEqual(b.albedo);
    expect(a.alpha_cutoff).toBeGreaterThan(0);
    expect(a.double_sided).toBe(true);
  });

  it('draws detail near a cell, lite beyond the distance, lite everywhere in Chromebook mode, with hysteresis', () => {
    const near = batch('batch:leaf_bush|0|0|1', 'leaf_bush', new Vector3(0, 0, 0)), nearLite = batch('batch:leaf_bush_lite|0|0|1', 'leaf_bush_lite', new Vector3(0, 0, 0));
    const far = batch('batch:leaf_bush|3|0|1', 'leaf_bush', new Vector3(120, 0, 0)), farLite = batch('batch:leaf_bush_lite|3|0|1', 'leaf_bush_lite', new Vector3(120, 0, 0));
    const other = batch('batch:grass|0|0|1', 'grass', new Vector3(0, 0, 0));
    const lod = new FoliageLod([near, nearLite, far, farLite, other], 42);
    expect(lod.count).toBe(2);
    lod.update(new Vector3(0, 1.6, 0));
    expect([near.isEnabled(), nearLite.isEnabled(), far.isEnabled(), farLite.isEnabled(), other.isEnabled()]).toEqual([true, false, false, true, true]);
    lod.update(new Vector3(100, 1.6, 0));
    expect([near.isEnabled(), nearLite.isEnabled(), far.isEnabled(), farLite.isEnabled()]).toEqual([false, true, true, false]);
    // 44 m from the first cell is inside the +-4 m hysteresis band: it stays as it was (detail was chosen at the origin)
    lod.update(new Vector3(0, 1.6, 0));
    lod.update(new Vector3(44, 1.6, 0));
    expect(near.isEnabled()).toBe(true);
    lod.update(new Vector3(47, 1.6, 0));
    expect(near.isEnabled()).toBe(false);
    lod.setLite(true);
    expect([near.isEnabled(), nearLite.isEnabled(), far.isEnabled(), farLite.isEnabled()]).toEqual([false, true, false, true]);
    lod.update(new Vector3(0, 1.6, 0));
    expect(near.isEnabled(), 'distance never overrides Chromebook mode').toBe(false);
    lod.setLite(false);
    lod.update(new Vector3(0, 1.6, 0));
    expect(near.isEnabled()).toBe(true);
    expect(lod.inspect()).toEqual({ cells: 2, detail: 1, lite: 1 });
  });
});

describe('puddle reflections', () => {
  async function setup() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(manifest))));
    const library = new MaterialLibrary(scene);
    await library.load('materials.json');
    vi.spyOn(library as unknown as { texture(...a: unknown[]): Texture }, 'texture').mockImplementation(() => RawTexture.CreateRGBTexture(new Uint8Array([200, 140, 255]), 1, 1, scene, false, false));
    const puddle = library.get('puddle') as PBRMaterial;
    const floor = batch('batch:puddle|0|0|1', 'puddle', new Vector3(0, -3.5, 0));
    const wall = batch('batch:concrete_wall|0|0|1', 'concrete_wall', new Vector3(0, -3.5, 0));
    const grass = batch('batch:grass|0|0|1', 'grass', new Vector3(0, 0, 0));
    return { library, puddle, floor, reflections: new PuddleReflections(scene, puddle, [floor, wall, grass], -3.5, [floor]), wall, grass };
  }

  it('is a quality preset: Low and Chromebook have none, Medium and up reflect, sized by preset', () => {
    expect(GRAPHICS_PRESETS.low.puddleReflections).toBe(0);
    expect(GRAPHICS_PRESETS.medium.puddleReflections).toBe(256);
    expect(GRAPHICS_PRESETS.high.puddleReflections).toBe(384);
    expect(GRAPHICS_PRESETS.ultra.puddleReflections).toBe(512);
    expect(CHROMEBOOK_PRESET.puddleReflections).toBe(0);
  });

  it('owns one planar mirror at higher presets and no render target on Low or Chromebook', async () => {
    const { puddle, reflections } = await setup();
    reflections.apply(0);
    expect(puddle.reflectionTexture).toBeNull();
    expect(puddle.metallic).toBe(0);
    expect(reflections.inspect().mirror).toBe(false);
    reflections.apply(384);
    expect(reflections.inspect()).toMatchObject({ size: 384, mirror: true, rendering: false });
    expect(puddle.reflectionTexture).not.toBeNull();
    expect(puddle.metallic).toBe(1);
    const mirrors = scene.textures.filter((t) => t.name === 'puddle-mirror');
    expect(mirrors.length).toBe(1);
    reflections.apply(512);
    expect(scene.textures.filter((t) => t.name === 'puddle-mirror').length, 'one mirror at a time, the old one is released').toBe(1);
    reflections.apply(0);
    expect(scene.textures.filter((t) => t.name === 'puddle-mirror').length).toBe(0);
    expect(puddle.reflectionTexture).toBeNull();
  });

  it('reflects only the underground materials and renders only while the camera is below the slab', async () => {
    const { reflections, wall, grass, floor } = await setup();
    reflections.apply(256);
    const mirror = scene.textures.find((t) => t.name === 'puddle-mirror') as unknown as { renderList: unknown[]; refreshRate: number };
    expect(mirror.renderList.length).toBe(0);
    reflections.update(1.64);
    expect(reflections.inspect().rendering).toBe(false);
    reflections.update(-1.9);
    expect(reflections.inspect().rendering).toBe(true);
    expect(mirror.refreshRate).toBe(2);
    expect(mirror.renderList).toContain(wall);
    expect(mirror.renderList).not.toContain(grass);
    expect(mirror.renderList, 'a puddle never reflects itself').not.toContain(floor);
    reflections.update(1.64);
    expect(mirror.renderList.length).toBe(0);
    expect(mirror.refreshRate).toBe(0);
  });

  it('is left alone by the library quality passes (Chromebook mode must not blacken or flatten the managed material)', async () => {
    const { library, puddle, reflections } = await setup();
    reflections.apply(384);
    library.setChromebook(true);
    library.setUltra(true);
    expect(puddle.metallic).toBe(1);
    expect(puddle.roughness).toBeLessThan(0.2);
    library.setChromebook(false);
    expect(MaterialLibrary.MANAGED.has('puddle')).toBe(true);
  });
});
