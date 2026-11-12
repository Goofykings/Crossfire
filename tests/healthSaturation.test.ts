import {expect,it} from 'vitest';
import {FreeCamera,NullEngine,Scene,Vector3,Effect} from '@babylonjs/core';
import {healthSaturation,HealthSaturation} from '../src/rendering/HealthSaturation';
import {PlayerSilhouettes} from '../src/rendering/PlayerSilhouettes';
it('matches health anchors and interpolates monotonically without thresholds',()=>{
 for(const [hp,s]of [[100,1],[75,.9],[50,.65],[25,.3],[10,.1],[1,.05]])expect(healthSaturation(hp)).toBeCloseTo(s);
 let previous=0;for(let hp=0;hp<=100;hp+=.1){const s=healthSaturation(hp);expect(s).toBeGreaterThanOrEqual(previous-1e-10);previous=s;}
 expect(healthSaturation(50,200)).toBe(.3);expect(healthSaturation(NaN)).toBe(1);
});
it('damage/healing ease in both directions, independently of frame rate',()=>{
 const run=(hz:number)=>{const c=new HealthSaturation();c.update(0,100,100,true,'life1');for(let i=0;i<hz/2;i++)c.update(1/hz,10,100,true,'life1');return c;};
 const a=run(30),b=run(120);expect(a.value).toBeCloseTo(b.value,8);expect(a.value).toBeGreaterThan(.1);expect(a.value).toBeLessThan(.13);
 const old=a.value;a.update(1/60,100,100,true,'life1');expect(a.value).toBeGreaterThan(old);expect(a.value).toBeLessThan(1);
 for(let i=0;i<150;i++)a.update(1/60,100,100,true,'life1');expect(a.value).toBe(1);
});
it('new life, death/spectating and menu reset immediately instead of inheriting gray',()=>{
 const c=new HealthSaturation();c.update(0,10,100,true,'one');c.update(1,10,100,true,'one');expect(c.value).toBeLessThan(.11);
 expect(c.update(1/60,100,100,true,'two')).toBe(1);c.update(1,1,100,true,'two');expect(c.update(.01,1,100,false,'two')).toBe(1);
});
it('reuses the final contour pass; color-only mode adds no mask/world draws and is detached at full health',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',Vector3.Zero(),scene);scene.activeCamera=camera;
 const pass=new PlayerSilhouettes(scene,camera);
 try{pass.setSaturation(.1);pass.update(false);expect(pass.inspect()).toMatchObject({passes:1,last:true,saturation:.1,enabled:false});
  expect(scene.customRenderTargets).toHaveLength(0);pass.keepLast();expect(camera._postProcesses.filter(Boolean)).toHaveLength(1);
  pass.setSaturation(1);pass.update(false);expect(camera._postProcesses.filter(Boolean)).toHaveLength(0);
  const shader=Effect.ShadersStore.crossfireSilhouetteFragmentShader;expect(shader.indexOf('scene.rgb=mix')).toBeLessThan(shader.indexOf('mix(scene.rgb,color'));
  pass.setSaturation(.05);pass.clear();expect(pass.inspect()).toMatchObject({passes:0,saturation:1});
 }finally{pass.dispose();scene.dispose();engine.dispose();}
});
