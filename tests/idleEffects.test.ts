import {afterEach,expect,it,vi} from 'vitest';
import {FreeCamera,NullEngine,Scene,SolidParticleSystem,Vector3} from '@babylonjs/core';
import {GrenadeView} from '../src/weapons/GrenadeView';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import type {GrenadeExplosion} from '../shared/grenades';

let engine:NullEngine,scene:Scene,view:GrenadeView;
afterEach(()=>{view?.dispose();scene?.dispose();engine?.dispose();vi.restoreAllMocks();});

it('empty grenade pools sleep, wake for real effects, expire and wake again',()=>{
 engine=new NullEngine();scene=new Scene(engine);scene.activeCamera=new FreeCamera('test',Vector3.Zero(),scene);
 view=new GrenadeView(scene);view.setChromebook(true);view.setReduced(true);
 const world=new CollisionWorld(),upload=vi.spyOn(SolidParticleSystem.prototype,'setParticles');
 let now=1000;vi.spyOn(performance,'now').mockImplementation(()=>now);
 for(let i=0;i<120;i++)view.update(1/60,now,world);
 expect(upload).not.toHaveBeenCalled();
 const explode=(id:string)=>{
  const event:GrenadeExplosion={id,grenadeId:id,ownerId:'a',ownerLife:1,roundId:1,at:now,position:{x:0,y:0,z:-3},hits:[]};
  view.explode(event,now);view.update(1/60,now+40,world);
 };
 explode('first');expect(upload).toHaveBeenCalled();expect(view.inspect().particles).toBe(12);
 expect(view.inspect().clouds).toHaveLength(1);expect(view.inspect().burst.visibleFire).toBeGreaterThan(0);
 expect(scene.getMeshByName('smoke-clouds')?.isEnabled()).toBe(true);
 expect(view.inspect().rendering.enabled).toBe(true);
 now+=8000;view.update(8,now,world);upload.mockClear();
 for(let i=0;i<120;i++)view.update(1/60,now,world);
 expect(upload).not.toHaveBeenCalled();expect(view.inspect().clouds).toHaveLength(0);
 expect(view.inspect().rendering.enabled).toBe(false);
 expect(scene.getMeshByName('smoke-clouds')?.isEnabled()).toBe(false);
 explode('second');expect(upload).toHaveBeenCalled();expect(view.inspect().burst.visibleFire).toBeGreaterThan(0);
 view.clear();upload.mockClear();view.update(1/60,now,world);expect(upload).not.toHaveBeenCalled();
});
