import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NullEngine, PBRMaterial, RawTexture, Scene, Texture } from '@babylonjs/core';
import { MaterialLibrary } from '../src/rendering/MaterialLibrary';
import { GRAPHICS_PRESETS } from '../src/rendering/quality';

const manifest = JSON.parse(readFileSync('public/assets/materials.json', 'utf8'));
let engine: NullEngine, scene: Scene, library: MaterialLibrary;
beforeEach(async () => {
  engine = new NullEngine(); scene = new Scene(engine); library = new MaterialLibrary(scene);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(manifest))));
  await library.load('materials.json');
  // Real PBR materials with tiny GPU-free textures: isolate channel semantics
  // from image decoding, which the Chrome integration check covers separately.
  const textures = new Map<string, Texture>();
  vi.spyOn(library as unknown as { texture(path: string, tile: number, linear: boolean, invertY?: boolean): Texture }, 'texture')
    .mockImplementation((path, tile, linear, invertY) => {
      const key = `${path}:${tile}:${linear}:${invertY}`;
      if (!textures.has(key)) {
        const texture = RawTexture.CreateRGBTexture(new Uint8Array([200, 140, 255]), 1, 1, scene, false, false);
        texture.name = path; texture.gammaSpace = !linear; textures.set(key, texture);
      }
      return textures.get(key)!;
    });
});
afterEach(() => { scene.dispose(); engine.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const material = (name: string) => library.get(name) as PBRMaterial;

describe('Ultra material quality', () => {
  it('opts in without replacing any lower preset or enabling per-frame reflections', () => {
    expect(Object.keys(GRAPHICS_PRESETS)).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(GRAPHICS_PRESETS.medium.ultraMaterials).toBeUndefined();
    expect(GRAPHICS_PRESETS.ultra.reflectionSize).toBe(512);
    expect(GRAPHICS_PRESETS.ultra.batchCell).toBe(GRAPHICS_PRESETS.high.batchCell);
  });
  it('reads ORM green instead of opaque alpha, while preserving authored AO and roughness factors', () => {
    const stone = material('stone_rubble'), original = stone.metallicTexture;
    expect(stone.useRoughnessFromMetallicTextureAlpha).toBe(true);
    library.setUltra(true);
    expect(stone.useRoughnessFromMetallicTextureAlpha).toBe(false);
    expect(stone.useRoughnessFromMetallicTextureGreen).toBe(true);
    expect(stone.useAmbientOcclusionFromMetallicTextureRed).toBe(true);
    expect(stone.metallicTexture).toBe(original);
    expect(stone.roughness).toBe(1); expect(stone.metallic).toBe(0);
    expect(stone.clearCoat.isEnabled).toBe(false);
  });
  it('restores actual metal factors using the existing corrected ORM without changing normal/base textures', () => {
    const metal = material('galvanized'), base = metal.albedoTexture, normal = metal.bumpTexture, original = metal.metallicTexture;
    library.setUltra(true);
    expect(metal.metallicTexture!.name).toBe('assets/textures/weapons/gun_metal_orm.png');
    expect(metal.metallic).toBe(.9); expect(metal.useMetallnessFromMetallicTextureBlue).toBe(true);
    expect(metal.albedoTexture).toBe(base); expect(metal.bumpTexture).toBe(normal);
    library.setUltra(false);
    expect(metal.metallicTexture).toBe(original); expect(metal.useRoughnessFromMetallicTextureAlpha).toBe(true);
    expect(metal.enableSpecularAntiAliasing).toBe(false);
  });
  it('adds a selective paint finish while keeping wood, stone, cloth and rubber diffuse', () => {
    library.setUltra(true);
    for (const name of ['carpaint_red', 'steel_blue', 'container_red']) expect(material(name).clearCoat.isEnabled).toBe(true);
    for (const name of ['wood_dark', 'stone_rubble', 'canvas_red', 'gun_rubber', 'plastic_blue']) {
      expect(material(name).clearCoat.isEnabled).toBe(false); expect(material(name).metallic).toBe(0);
    }
    expect(material('carpaint_red').clearCoat.intensity).toBe(.45);
    expect(material('steel_blue').clearCoat.intensity).toBe(.14);
  });
  it('keeps glazing alpha and gun skins, shares tinted batches and reverses live changes', () => {
    const lens = material('gun_glass'), rifle = material('gun_fde');
    const tint = rifle.albedoColor.clone(), normal = rifle.bumpTexture;
    const a = library.canonical('steel_red'), b = library.canonical('steel_blue');
    expect(a.material).toBe(b.material);
    const originalAlpha = lens.alpha, originalMode = lens.transparencyMode;
    for (let i = 0; i < 3; i++) { library.setUltra(true); library.setUltra(false); }
    expect(lens.alpha).toBe(originalAlpha); expect(lens.transparencyMode).toBe(originalMode);
    expect(lens.metallic).toBe(manifest.materials.gun_glass.metallic);
    expect(rifle.albedoColor.equals(tint)).toBe(true); expect(rifle.bumpTexture).toBe(normal);
    expect((a.material as PBRMaterial).clearCoat.isEnabled).toBe(false);
  });
});

it('Chromebook materials remove specular IBL/normal/ORM/coat costs and restore the same skins and maps',()=>{
 library.setUltra(true);const m=material('galvanized'),base=m.albedoTexture,normal=m.bumpTexture,orm=m.metallicTexture;
 library.setChromebook(true);expect(m.reflectionColor.asArray()).toEqual([0,0,0]);expect(m.bumpTexture).toBeNull();expect(m.metallicTexture).toBeNull();expect(m.metallic).toBe(0);expect(m.clearCoat.isEnabled).toBe(false);expect(m.albedoTexture).toBe(base);
 library.setChromebook(false);expect(m.albedoTexture).toBe(base);expect(m.bumpTexture).toBe(normal);expect(m.metallicTexture).toBe(orm);expect(m.metallic).toBe(.9);expect(m.reflectionColor.asArray()).toEqual([1,1,1]);
});

it('cold Chromebook materials never request unused normal or ORM images',()=>{
 library.setChromebook(true);
 const load=vi.mocked((library as unknown as {texture: (path:string,tile:number,linear:boolean,invertY?:boolean)=>Texture}).texture);
 material('galvanized');material('stone_rubble');material('gun_fde');
 expect(load.mock.calls.length).toBeGreaterThan(0);
 expect(load.mock.calls.every(call=>!call[2])).toBe(true);
 library.setChromebook(false);
 expect(load.mock.calls.some(call=>call[2])).toBe(true);
 expect(material('galvanized').bumpTexture).not.toBeNull();
 expect(material('galvanized').metallicTexture).not.toBeNull();
});

it('retains a ready resized copy while material assignment is queued',async()=>{
 const m=material('stone_rubble'),source=m.albedoTexture as Texture;
 const copy=RawTexture.CreateRGBTexture(new Uint8Array([200,140,255]),1,1,scene,false,false);
 copy.getInternalTexture()!.isReady=true; // Simulate a cached GPU resize finishing before its assignment microtask.
 const cache=(library as unknown as {smallTextures:Map<Texture,Texture>}).smallTextures;
 cache.set(source,copy);
 const assignment=Promise.resolve().then(()=>{m.albedoTexture=copy;});
 library.setChromebook(true);
 expect(copy.getInternalTexture()).not.toBeNull();
 await assignment;library.trim();expect(m.albedoTexture?.isReady()).toBe(true);
});
