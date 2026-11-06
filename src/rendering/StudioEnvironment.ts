import { EquiRectangularCubeTexture, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';

/** Studio reflections for isolated preview scenes (Locker, thumbnails, crate reveal) only.
 * Without an environment, metallic finishes such as Rich gold render nearly black.
 * Map scenes keep their own HDR skies. Resolves once the cube faces are uploaded. */
export function studioEnvironment(scene:Scene,intensity=1,signal?:AbortSignal):Promise<EquiRectangularCubeTexture>{
  return new Promise((resolve,reject)=>{
    const texture=new EquiRectangularCubeTexture(assetUrl('assets/cosmetics/studio.jpg'),scene,256,false,true,
      ()=>{if(signal?.aborted){texture.dispose();reject(signal.reason);return;}scene.environmentTexture=texture;scene.environmentIntensity=intensity;resolve(texture);},
      message=>{texture.dispose();reject(Error(`Studio environment failed: ${message??'unknown error'}`));});
  });
}
