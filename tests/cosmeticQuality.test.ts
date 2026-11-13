import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MeshBuilder,NullEngine,PBRMaterial,RawTexture,Scene,Texture} from '@babylonjs/core';
import {cosmetic} from '../shared/cosmetics';
import {patchCosmetic} from '../src/rendering/CosmeticAssets';
import {MaterialLibrary} from '../src/rendering/MaterialLibrary';
import {setSkinFxLite} from '../src/rendering/SkinFx';
let engine:NullEngine,scene:Scene,library:MaterialLibrary;
beforeEach(async()=>{
 engine=new NullEngine();scene=new Scene(engine);library=new MaterialLibrary(scene);
 vi.stubGlobal('fetch',async()=>new Response(readFileSync('public/assets/materials.json','utf8')));await library.load();
 const maps=new Map<string,Texture>();
 const cache=(library as unknown as {textures:Map<string,Texture>}).textures;
 vi.spyOn(library as unknown as {texture(path:string,tile:number,linear:boolean,invertY?:boolean):Texture},'texture').mockImplementation(path=>{
  if(!maps.get(path)?.getInternalTexture()){const t=RawTexture.CreateRGBTexture(new Uint8Array([200,140,255]),1,1,scene,false,false);t.name=path;t.getInternalTexture()!.isReady=true;maps.set(path,t);cache.set(path,t);}return maps.get(path)!;
 });
});
afterEach(()=>{scene.dispose();engine.dispose();setSkinFxLite(false);vi.restoreAllMocks();vi.unstubAllGlobals();});
async function richSteel(){
 const mesh=MeshBuilder.CreateBox('gold-part',{},scene);mesh.material=new PBRMaterial('gun_steel',scene);
 const container={meshes:[mesh],materials:[] as PBRMaterial[],textures:[] as Texture[]};
 await patchCosmetic(container,cosmetic('rich-rifle')!,scene,library);return {mesh,material:mesh.material as PBRMaterial,container};
}
it('cold Chromebook Rich keeps its authored gold color while using a diffuse no-reflection finish',async()=>{
 library.setChromebook(true);const {material}=await richSteel();
 expect(material.albedoColor.toHexString()).toBe('#F5B040');expect(material.metallic).toBe(0);expect(material.bumpTexture).toBeNull();expect(material.metallicTexture).toBeNull();expect(material.clearCoat.isEnabled).toBe(false);
});
it('live Chromebook changes update the existing cosmetic clone and restore its authored finish',async()=>{
 const {mesh,material}=await richSteel(),color=material.albedoColor.toHexString();expect(material.metallic).toBe(1);
 for(let i=0;i<3;i++){library.setChromebook(true);expect(mesh.material).toBe(material);expect(material.metallic).toBe(0);expect(material.albedoColor.toHexString()).toBe(color);library.setChromebook(false);expect(material.metallic).toBe(1);expect(material.roughness).toBe(.3);expect(material.reflectionColor.asArray()).toEqual([1,1,1]);}
});
it('independent embedded dagger and preview materials follow the same lightweight setting',async()=>{
 const mesh=MeshBuilder.CreateBox('blade',{},scene);mesh.material=new PBRMaterial('dagger_steel',scene);
 await patchCosmetic({meshes:[mesh],materials:[],textures:[]},cosmetic('rich-melee')!,scene,library);const material=mesh.material as PBRMaterial;
 setSkinFxLite(true);expect(material.metallic).toBe(0);setSkinFxLite(false);expect(material.metallic).toBe(1);
});
it('reuses inherited textures without owning them, and pruning keeps maps used by a live cosmetic',async()=>{
 const {material,container}=await richSteel(),source=library.get('gun_steel') as PBRMaterial;
 expect(material.albedoTexture).toBe(source.albedoTexture);expect(material.bumpTexture).toBe(source.bumpTexture);
 expect(container.textures).not.toContain(source.bumpTexture);
 const texture=source.bumpTexture!,dispose=vi.spyOn(texture,'dispose');
 library.prune(new Set([material]));expect(dispose).not.toHaveBeenCalled();expect(texture.getInternalTexture()).not.toBeNull();
 library.setChromebook(true);expect(material.metallic).toBe(0);library.setChromebook(false);expect(material.metallic).toBe(1);
});
it('removes quality listeners when a cached cosmetic is disposed',async()=>{
 const before=library.onQualityChanged.observers.length,{material}=await richSteel();
 expect(library.onQualityChanged.observers.length).toBe(before+1);material.dispose();
 expect(library.onQualityChanged.observers.filter(o=>!o._willBeUnregistered).length).toBe(before);
 library.setChromebook(true);setSkinFxLite(true);expect(scene.materials).not.toContain(material);
});
