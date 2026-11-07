import { afterEach, expect, it, vi } from 'vitest';
import { Constants, FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { GrenadeView } from '../src/weapons/GrenadeView';
import { CollisionWorld } from '../src/physics/CollisionWorld';

afterEach(() => vi.restoreAllMocks());
it('shows a just-received flash even after a slow frame, then cleans up by its actual elapsed lifetime', () => {
  const clock=vi.spyOn(performance,'now').mockReturnValue(10000);
  const engine=new NullEngine(),scene=new Scene(engine),world=new CollisionWorld();
  scene.activeCamera=new FreeCamera('test-camera',new Vector3(0,1.64,3),scene);
  const view=new GrenadeView(scene);
  try {
    view.explode({id:'blast:g',grenadeId:'g',ownerId:'real-event-fixture',ownerLife:1,roundId:0,at:10000,
      position:{x:0,y:.065,z:0},hits:[]});
    clock.mockReturnValue(10005);
    view.update(.2,10005,world); // Most of this frame elapsed BEFORE the event arrived.
    const flash=view.inspect().burst.active[0];
    expect(flash.age).toBeCloseTo(.005);
    expect(flash.flash).toBeGreaterThan(.7);
    expect(scene.getMaterialByName('explosion-additive')!.alphaMode).toBe(Constants.ALPHA_ADD);
    expect(scene.lights.some(l=>l.intensity>0)).toBe(true);
    clock.mockReturnValue(10100);view.update(.2,10100,world);
    expect(view.inspect().burst.active[0].flash).toBe(0);
    expect(view.inspect().burst.active[0].fire).toBeGreaterThan(0);
    clock.mockReturnValue(10810);view.update(.001,10810,world);
    expect(view.inspect().particles).toBe(0); // Expire even if the simulation dt is clamped.
    expect(view.inspect().burst.active).toHaveLength(0);
    expect(view.inspect().clouds).toHaveLength(1);
    for(let i=0;i<20;i++)view.explode({id:`burst:${i}`,grenadeId:`g:${i}`,ownerId:'fixture',ownerLife:1,roundId:0,at:10810,position:{x:0,y:0,z:0},hits:[]},10810);
    view.update(0,10810,world);
    expect(view.inspect().burst.active).toHaveLength(4);
    expect(scene.lights).toHaveLength(2);
    expect(scene.lights.every(l=>!l.shadowEnabled)).toBe(true);
    view.setReduced(true);view.update(0,10930,world);
    expect(view.inspect().burst.visibleFire).toBe(16);
    expect(view.inspect().burst.visibleGlow).toBe(24);
    view.setReduced(false);view.update(0,10930,world);
    expect(view.inspect().burst.visibleFire).toBe(32);
    expect(view.inspect().burst.visibleGlow).toBe(128);
    view.clear();expect(view.inspect().projectiles).toBe(0);
    expect(view.inspect().burst.visibleFire).toBe(0);
    expect(view.inspect().burst.visibleGlow).toBe(0);
    expect(scene.lights.every(l=>l.includedOnlyMeshes.length===0)).toBe(true);
    expect(view.inspect().burst.active).toHaveLength(0);
  } finally {view.dispose();engine.dispose();}
});
