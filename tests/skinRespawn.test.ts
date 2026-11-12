import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {FreeCamera,MeshBuilder,NullEngine,PBRMaterial,Scene,Vector3} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {WeaponView} from '../src/weapons/WeaponView';
import {CosmeticMaterials} from '../src/rendering/CosmeticMaterials';
import {defaultEquipment,GUN_CATEGORIES,EXTRA_COLLECTIONS} from '../shared/cosmetics';
import type {RenderContext} from '../src/rendering/RenderContext';
import type {MaterialLibrary} from '../src/rendering/MaterialLibrary';
vi.mock('../src/core/loadContainer',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('../src/core/loadContainer')>();
 return {...actual,loadContainer:(url:string,scene:Scene,signal?:AbortSignal)=>actual.loadContainer(url,scene,signal??new AbortController().signal)};
});
afterEach(()=>vi.unstubAllGlobals());
it('all five firearm rigs recover equipped materials after spectator/default swaps and repeated new lives without asset/effect duplication',async()=>{
 const requests:string[]=[];vi.stubGlobal('fetch',async(url:string)=>{requests.push(String(url));return new Response(await readFile(`public/${String(url).replace(/^.*?assets\//,'assets/')}`));});
 const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',Vector3.Zero(),scene);scene.activeCamera=camera;
 const material=new PBRMaterial('fixture',scene),library={get:()=>material,ready:async()=>{}} as unknown as MaterialLibrary;
 const view=new WeaponView({scene,camera} as RenderContext,library,null);
 try{
  await view.load();
  // Exercise every extra family, including flow/frost/shade, through the actual cached rigs.
  for(const family of EXTRA_COLLECTIONS){
   const equipped=defaultEquipment();for(const w of GUN_CATEGORIES)equipped[w]=`${family.id}-${w}`;
   await view.setCosmetics(equipped);
   for(const w of GUN_CATEGORIES){view.select(w);expect(view.currentCosmetic).toBe(equipped[w]);}
   const before={requests:requests.length,meshes:scene.meshes.length,materials:scene.materials.length,observers:scene.onBeforeRenderObservable.observers.length};
   for(let life=0;life<3;life++){
    for(const w of GUN_CATEGORIES){
     await view.setCosmetic(w,`default-${w}`);view.select(w);view.motion.reset();
     await view.setCosmetic(w,equipped[w]);view.select(w);expect(view.currentCosmetic).toBe(equipped[w]);
     expect(view.meshes.filter(m=>m.isEnabled()&&m.material?.name.startsWith('cosmetic:')).length).toBeGreaterThan(0);
    }
   }
   expect({requests:requests.length,meshes:scene.meshes.length,materials:scene.materials.length,observers:scene.onBeforeRenderObservable.observers.length}).toEqual(before);
  }
 }finally{view.dispose();scene.dispose();engine.dispose();}
},30000);
it('dagger materials restore the same cached instances after spectator swaps; stale loads cannot overwrite newer requests',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),mesh=MeshBuilder.CreateBox('dagger',{},scene),base=new PBRMaterial('dagger_steel',scene);mesh.material=base;
 const library={get:()=>base} as unknown as MaterialLibrary,cache=new CosmeticMaterials([mesh],scene,library,'melee');
 try{
  await cache.apply('darkness-melee');const dark=mesh.material;expect(dark).not.toBe(base);
  for(let i=0;i<4;i++){await cache.apply();expect(mesh.material).toBe(base);await cache.apply('darkness-melee');expect(mesh.material).toBe(dark);}
  await Promise.all([cache.apply(),cache.apply('darkness-melee')]);expect(mesh.material).toBe(dark);expect(cache.size).toBe(2);
  cache.dispose();expect(scene.materials).not.toContain(dark);expect(scene.materials).toContain(base);
 }finally{scene.dispose();engine.dispose();}
});
