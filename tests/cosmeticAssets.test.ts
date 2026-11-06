import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {NullEngine,PBRMaterial,Scene} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {COSMETICS,type CosmeticDefinition} from '../shared/cosmetics';
import {loadCosmeticAsset} from '../src/rendering/CosmeticAssets';
import type {MaterialLibrary} from '../src/rendering/MaterialLibrary';
afterEach(()=>vi.unstubAllGlobals());
it('material variants isolate their overrides from the original weapon and other instances',async()=>{
 vi.stubGlobal('fetch',async(url:string)=>new Response(await readFile(`public/${url.replace(/^.*?assets\//,'assets/')}`)));
 const engine=new NullEngine(),scene=new Scene(engine),shared=new PBRMaterial('shared',scene);shared.metallic=.1;shared.roughness=.8;
 const materials={get:()=>shared,ready:async()=>{}} as unknown as MaterialLibrary;
 const base=COSMETICS.find(c=>c.weapon==='rifle')!,variant:CosmeticDefinition={...base,id:'test-only-material',asset:{...base.asset,materials:{gun_fde:{color:'#123456',metallic:.7,roughness:.3}}}};
 const signal=new AbortController().signal;
 try{
  const original=await loadCosmeticAsset(base,scene,materials,signal),changed=await loadCosmeticAsset(variant,scene,materials,signal);
  const copies=changed.meshes.map(m=>m.material).filter((m):m is PBRMaterial=>m instanceof PBRMaterial&&m.name.startsWith('cosmetic:'));
  expect(copies.length).toBeGreaterThan(0);expect(new Set(copies).size).toBe(1);
  expect(copies[0].albedoColor.toHexString()).toBe('#123456');expect(copies[0].metallic).toBe(.7);expect(copies[0].roughness).toBe(.3);
  expect(shared.metallic).toBe(.1);expect(shared.roughness).toBe(.8);expect(original.meshes.some(m=>m.material===shared)).toBe(true);
  changed.dispose();expect(scene.materials.includes(shared)).toBe(true);original.dispose();
 }finally{scene.dispose();engine.dispose();}
});
it('embedded GLB materials remain attached instead of being replaced by the shared palette',async()=>{
 vi.stubGlobal('fetch',async(url:string)=>new Response(await readFile(`public/${url.replace(/^.*?assets\//,'assets/')}`)));
 const engine=new NullEngine(),scene=new Scene(engine),get=vi.fn(()=>new PBRMaterial('unexpected',scene)),materials={get,ready:async()=>{}} as unknown as MaterialLibrary;
 try{
  const base=COSMETICS[0],asset=await loadCosmeticAsset({...base,asset:{...base.asset,binding:'embedded'}},scene,materials,new AbortController().signal);
  expect(get).not.toHaveBeenCalled();expect(asset.meshes.some(m=>m.material?.name==='gun_fde')).toBe(true);asset.dispose();
 }finally{scene.dispose();engine.dispose();}
});
