import { Color3, TransformNode, PBRMaterial, Texture, type Scene, type AssetContainer, type Material } from '@babylonjs/core';
import { cosmetic, defaultCosmetic, type CosmeticDefinition, type CosmeticCategory } from '../../shared/cosmetics';
import { loadContainer } from '../core/loadContainer';
import { assetUrl } from '../core/assets';
import { texturesReady } from '../core/assetReadiness';
import type { MaterialLibrary } from './MaterialLibrary';

export function visualCosmetic(weapon:CosmeticCategory,id?:string):CosmeticDefinition {
  const item=cosmetic(id);return item?.weapon===weapon&&item.compatibleWith.includes(weapon)?item:cosmetic(defaultCosmetic(weapon))!;
}
/** Shared by first person, armed characters and isolated previews. Cosmetic-only;
 * no placement, weapon stats or animation timing is read from cosmetic assets. */
export async function loadCosmeticAsset(item:CosmeticDefinition,scene:Scene,materials:MaterialLibrary,signal?:AbortSignal):Promise<AssetContainer>{
  const c=await loadContainer(assetUrl(item.asset.model),scene,signal);
  try {
    if(item.asset.secondaryModel){
      const other=await loadContainer(assetUrl(item.asset.secondaryModel),scene,signal);
      const pair=new TransformNode('cosmetic-dagger-pair',scene);
      for(const n of c.rootNodes){n.parent=pair;(n as TransformNode).position.x=.12;(n as TransformNode).rotation.z=-.18;}
      for(const n of other.rootNodes){n.parent=pair;(n as TransformNode).position.x=-.12;(n as TransformNode).rotation.z=.18;}
      for(const key of ['meshes','transformNodes','materials','textures','skeletons','animationGroups'] as const)(c[key] as unknown[]).push(...other[key]);
      c.transformNodes.push(pair);c.rootNodes=[pair];
    }
    await patchCosmetic(c,item,scene,materials,signal);
    await Promise.all([materials.ready(signal),texturesReady(c.textures,signal)]);return c;
  } catch(error){c.dispose();throw error;}
}

export async function patchCosmetic(c:Pick<AssetContainer,'meshes'|'materials'|'textures'>,item:CosmeticDefinition,scene:Scene,materials:MaterialLibrary,signal?:AbortSignal):Promise<void>{
    const copies=new Map<Material,Material>();
    for(const mesh of c.meshes){
      if(!mesh.material)continue;const name=mesh.material.name;
      if(name==='reticle_holo'){
        // The new optic's GLB placeholder is opaque white. Use its authored
        // alpha-cutout reticle in Locker/third person; WeaponView supplies its
        // existing additive material for first person.
        if(item.weapon==='semi-sniper')mesh.material=materials.get(name);
        continue;
      }
      const source=item.asset.binding==='shared'?materials.get(name):mesh.material;
      const patch=item.asset.materials?.[name];
      if(!patch){mesh.material=source;continue;}
      let copy=copies.get(source);
      if(!copy){
        copy=source.clone(`cosmetic:${item.id}:${name}`)!;copies.set(source,copy);c.materials.push(copy);
        if(!(copy instanceof PBRMaterial))throw Error(`Cosmetic material must use PBR: ${name}`);
        if(patch.color)copy.albedoColor=Color3.FromHexString(patch.color);
        if(patch.metallic!==undefined)copy.metallic=patch.metallic;
        if(patch.roughness!==undefined)copy.roughness=patch.roughness;
        for(const [key,property]of [['albedo','albedoTexture'],['normal','bumpTexture'],['orm','metallicTexture'],['emissive','emissiveTexture']] as const){
          const path=patch[key];if(!path)continue;
          const t=new Texture(assetUrl(path),scene,false,false);t.gammaSpace=key==='albedo'||key==='emissive';c.textures.push(t);copy[property]=t;
          // Weapon UVs are in metres, like MaterialLibrary's `tile`.
          if(patch.tile){t.uScale=t.vScale=1/patch.tile;}
          if(key==='emissive'&&patch.scroll){
            const [u,v]=patch.scroll,start=performance.now();
            const tick=scene.onBeforeRenderObservable.add(()=>{const s=(performance.now()-start)/1000;t.uOffset=(u*s)%1;t.vOffset=(v*s)%1;});
            t.onDisposeObservable.addOnce(()=>scene.onBeforeRenderObservable.remove(tick));
          }
        }
        if(patch.emissive)copy.emissiveColor=Color3.FromHexString(patch.emissiveColor??'#ffffff');
        // The library reads roughness from ORM alpha outside Ultra (alpha wins over green).
        // Skin ORMs are opaque RGB, so read green or every finish renders fully rough.
        if(patch.orm)copy.useRoughnessFromMetallicTextureAlpha=false;
        if(patch.clearcoat!==undefined){copy.clearCoat.isEnabled=patch.clearcoat>0;copy.clearCoat.intensity=patch.clearcoat;copy.clearCoat.roughness=.08;}
        copy.useRoughnessFromMetallicTextureGreen=true;copy.useMetallnessFromMetallicTextureBlue=true;copy.useAmbientOcclusionFromMetallicTextureRed=true;
      }
      mesh.material=copy;
    }
    await texturesReady(c.textures,signal);
}
