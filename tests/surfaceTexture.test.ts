import {expect,it} from 'vitest';
import {NullEngine,RawTexture,Scene,Texture} from '@babylonjs/core';
import {copySurfaceSampling} from '../src/rendering/SurfaceTexture';

it('preserves repeating, rotated UVs, alpha and color space when replacing a surface image',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const source=RawTexture.CreateRGBATexture(new Uint8Array(16),2,2,scene),copy=source.clone() as Texture;
  try{
    source.wrapU=Texture.WRAP_ADDRESSMODE;source.wrapV=Texture.MIRROR_ADDRESSMODE;
    source.uScale=.357142857;source.vScale=2.5;source.uOffset=.125;source.vOffset=.25;source.wAng=.2;
    source.uRotationCenter=.25;source.vRotationCenter=.75;source.coordinatesIndex=1;
    source.hasAlpha=true;source.gammaSpace=true;source.anisotropicFilteringLevel=2;
    copy.wrapU=copy.wrapV=Texture.CLAMP_ADDRESSMODE;copy.coordinatesMode=Texture.PROJECTION_MODE;
    copySurfaceSampling(source,copy);
    expect(copy.wrapU).toBe(Texture.WRAP_ADDRESSMODE);expect(copy.wrapV).toBe(Texture.MIRROR_ADDRESSMODE);
    expect(copy.getTextureMatrix().equals(source.getTextureMatrix())).toBe(true);
    expect(copy.coordinatesMode).toBe(Texture.EXPLICIT_MODE);expect(copy.coordinatesIndex).toBe(1);
    expect(copy.hasAlpha).toBe(true);expect(copy.gammaSpace).toBe(true);expect(copy.anisotropicFilteringLevel).toBe(2);
  }finally{scene.dispose();engine.dispose();}
});
