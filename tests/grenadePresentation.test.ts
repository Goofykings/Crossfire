import { afterEach, expect, it, vi } from 'vitest';
import { FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
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
    const flashes=view.inspect().samples.filter(p=>p.flash);
    expect(flashes).toHaveLength(2);
    for(const p of flashes){expect(p.age).toBeCloseTo(.005);expect(p.color![3]).toBeGreaterThan(.7);}
    clock.mockReturnValue(10100);view.update(.2,10100,world);
    expect(view.inspect().samples.filter(p=>p.flash)).toHaveLength(2);
    clock.mockReturnValue(10810);view.update(.001,10810,world);
    expect(view.inspect().particles).toBe(0); // Expire even if the simulation dt is clamped.
    view.clear();expect(view.inspect().projectiles).toBe(0);
  } finally {view.dispose();engine.dispose();}
});
