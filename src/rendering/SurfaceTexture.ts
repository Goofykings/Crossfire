import {DynamicTexture,Texture,type Scene} from '@babylonjs/core';

/** Upload once during loading, independently of the game's render-target state.
 * The result remains a mipmapped, repeating color texture on every GPU. */
export async function compactSurfaceTexture(source:Texture,scene:Scene,limit:number,signal:AbortSignal):Promise<Texture>{
  const size=source.getSize(),ratio=Math.min(1,limit/Math.max(size.width,size.height));
  const width=Math.max(1,Math.round(size.width*ratio)),height=Math.max(1,Math.round(size.height*ratio));
  // Babylon has already loaded this URL. Reuse the browser's response cache,
  // including on constrained school Wi-Fi, instead of revalidating every image.
  const response=await fetch(source.url!,{signal,cache:'force-cache'});
  if(!response.ok)throw new Error(`Texture resize failed: ${response.status} ${source.name}`);
  const bitmap=await createImageBitmap(await response.blob(),{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});
  try{
    signal.throwIfAborted();
    if(scene.isDisposed)throw new Error('Texture scene disposed');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Texture resize canvas unavailable');
    context.drawImage(bitmap,0,0,width,height);
    const copy=new DynamicTexture(`compact:${source.name}`,canvas,scene,true,Texture.TRILINEAR_SAMPLINGMODE);
    copySurfaceSampling(source,copy);copy.update(source.invertY);
    return copy;
  }finally{bitmap.close();}
}

/** UV density, repeat seams and alpha survive a quality change exactly. */
export function copySurfaceSampling(source:Texture,copy:Texture):void{
  copy.coordinatesMode=source.coordinatesMode;copy.coordinatesIndex=source.coordinatesIndex;
  copy.wrapU=source.wrapU;copy.wrapV=source.wrapV;
  copy.uScale=source.uScale;copy.vScale=source.vScale;copy.uOffset=source.uOffset;copy.vOffset=source.vOffset;
  copy.uAng=source.uAng;copy.vAng=source.vAng;copy.wAng=source.wAng;
  copy.uRotationCenter=source.uRotationCenter;copy.vRotationCenter=source.vRotationCenter;copy.wRotationCenter=source.wRotationCenter;
  copy.homogeneousRotationInUVTransform=source.homogeneousRotationInUVTransform;
  copy.gammaSpace=source.gammaSpace;copy.hasAlpha=source.hasAlpha;copy.level=source.level;
  copy.anisotropicFilteringLevel=source.anisotropicFilteringLevel;
}
