import { Color3, PBRMaterial, Texture, type Scene, type AssetContainer, type Material } from '@babylonjs/core';
import { cosmetic, defaultCosmetic, type CosmeticDefinition } from '../../shared/cosmetics';
import type { WeaponId } from '../weapons/Weapon';
import { loadContainer } from '../core/loadContainer';
import { assetUrl } from '../core/assets';
import { texturesReady } from '../core/assetReadiness';
import type { MaterialLibrary } from './MaterialLibrary';

export function visualCosmetic(weapon:WeaponId,id?:string):CosmeticDefinition {
  const item=cosmetic(id);return item?.weapon===weapon&&item.compatibleWith.includes(weapon)?item:cosmetic(defaultCosmetic(weapon))!;
}
/** Shared by first person, armed characters and isolated previews. Cosmetic-only;
 * no placement, weapon stats or animation timing is read from cosmetic assets. */
export async function loadCosmeticAsset(item:CosmeticDefinition,scene:Scene,materials:MaterialLibrary,signal?:AbortSignal):Promise<AssetContainer>{
  const c=await loadContainer(assetUrl(item.asset.model),scene,signal);
  try {
    const copies=new Map<Material,Material>();
    for(const mesh of c.meshes){
      if(!mesh.material)continue;const name=mesh.material.name;
      if(name==='reticle_holo')continue;
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
        for(const [key,property]of [['albedo','albedoTexture'],['normal','bumpTexture'],['orm','metallicTexture']] as const){
          const path=patch[key];if(!path)continue;
          const t=new Texture(assetUrl(path),scene,false,false);t.gammaSpace=key==='albedo';c.textures.push(t);copy[property]=t;
        }
        copy.useRoughnessFromMetallicTextureGreen=true;copy.useMetallnessFromMetallicTextureBlue=true;copy.useAmbientOcclusionFromMetallicTextureRed=true;
      }
      mesh.material=copy;
    }
    await Promise.all([materials.ready(signal),texturesReady(c.textures,signal)]);return c;
  } catch(error){c.dispose();throw error;}
}
