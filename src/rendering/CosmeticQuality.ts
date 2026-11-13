import {Color3,PBRMaterial} from '@babylonjs/core';
import type {CosmeticMaterial} from '../../shared/cosmetics';
import type {MaterialLibrary} from './MaterialLibrary';
import {observeSkinFxQuality,skinFxLite} from './SkinFx';

/** Keep the finish on the same material. Reflection-free rendering needs a
 * dielectric albedo: a fully metallic PBR surface has no diffuse response.
 * Pattern/emission maps and colors never change when optional shading is cut.
 */
export function followCosmeticQuality(material:PBRMaterial,source:()=>PBRMaterial,patch:CosmeticMaterial,library:MaterialLibrary):void{
 const own={albedo:material.albedoTexture,normal:material.bumpTexture,orm:material.metallicTexture,emissive:material.emissiveTexture};
 const scene=material.getScene();let disposed=false;
 const refresh=()=>{
  if(disposed||scene.isDisposed)return;
  const base=source(),lite=!!library.chromebookMode||skinFxLite();
  material.albedoTexture=patch.fx?.type==='flow'?null:patch.albedo?own.albedo:base.albedoTexture;
  material.emissiveTexture=patch.fx?.type==='flow'?null:patch.emissive?own.emissive:base.emissiveTexture;
  material.bumpTexture=lite?null:patch.normal?own.normal:base.bumpTexture;
  material.metallicTexture=lite?null:patch.orm?own.orm:base.metallicTexture;
  material.metallic=lite?0:patch.metallic??base.metallic;
  material.roughness=lite?1:patch.roughness??base.roughness;
  material.reflectionColor=lite?Color3.Black():base.reflectionColor.clone();
  material.environmentIntensity=lite?0:base.environmentIntensity;
  material.enableSpecularAntiAliasing=!lite&&base.enableSpecularAntiAliasing;
  material.useRoughnessFromMetallicTextureAlpha=patch.orm?false:base.useRoughnessFromMetallicTextureAlpha;
  const coat=patch.clearcoat??base.clearCoat.intensity;
  material.clearCoat.isEnabled=!lite&&(patch.clearcoat!==undefined?coat>0:base.clearCoat.isEnabled);
  material.clearCoat.intensity=coat;material.clearCoat.roughness=patch.clearcoat!==undefined ? .08 : base.clearCoat.roughness;
 };
 const observer=library.onQualityChanged?.add(refresh),unsubscribe=observeSkinFxQuality(refresh);
 const cleanup=()=>{if(disposed)return;disposed=true;if(observer)library.onQualityChanged.remove(observer);unsubscribe();scene.onDisposeObservable.remove(sceneObserver);};
 const sceneObserver=scene.onDisposeObservable.addOnce(cleanup);material.onDisposeObservable.addOnce(cleanup);
 refresh();
}
