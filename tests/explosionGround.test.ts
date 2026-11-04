import { expect, it } from 'vitest';
import { FreeCamera, MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { ExplosionGround } from '../src/weapons/ExplosionGround';
import { CollisionWorld } from '../src/physics/CollisionWorld';

it('projects bounded scorch marks onto actual nearby floors, never onto distant ground',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),world=new CollisionWorld();
  new FreeCamera('test',new Vector3(0,2,4),scene);
  const floor=MeshBuilder.CreateBox('batch:floor',{width:20,height:1,depth:20},scene);floor.position.y=-.5;floor.computeWorldMatrix(true);
  world.add({c:[0,-.5,0],h:[10,.5,10]});
  const ground=new ExplosionGround(scene),event={id:'blast:a',grenadeId:'a',ownerId:'a',ownerLife:1,roundId:0,at:1000,position:{x:0,y:.065,z:0},hits:[]};
  try{
    ground.explode({...event,position:{x:0,y:2,z:0}},1000,false);ground.update(1000,world);
    expect(ground.inspect().marks).toBe(0);
    for(let i=0;i<30;i++){ground.explode({...event,id:`blast:${i}`},1000,false);ground.update(1000,world);}
    expect(ground.inspect().marks).toBe(24);expect(ground.inspect().rocks).toBe(48);
    expect(ground.inspect().markArea/ground.inspect().bulletArea).toBeCloseTo(10.124,2);
    for(let t=1010;t<=2700;t+=10)ground.update(t,world);
    const rocks=scene.getMeshByName('blast-rocks-batch')!; rocks.refreshBoundingInfo({});
    expect(rocks.getBoundingInfo().boundingBox.minimumWorld.y).toBeGreaterThan(-.1);
    ground.update(2900,world);expect(ground.inspect().rocks).toBe(0);expect(rocks.isEnabled()).toBe(false);
    ground.clear();expect(ground.inspect().marks).toBe(0);
  }finally{ground.dispose();scene.dispose();engine.dispose();}
});
