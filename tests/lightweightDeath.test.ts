import {expect,it,vi} from 'vitest';
import {NullEngine,Scene,TransformNode,PBRMaterial,MeshBuilder} from '@babylonjs/core';
import {RemotePlayers} from '../src/game/RemotePlayers';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import type {Elimination} from '../shared/protocol';
it('Chromebook death keeps the ragdoll/lifetime without copying or compiling transparent materials',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('root',scene),mesh=MeshBuilder.CreateBox('body',{},scene),mat=new PBRMaterial('body',scene);mesh.material=mat;
 const clone=vi.spyOn(mat,'clone'),capture=vi.fn(),a={life:2,root,meshes:[mesh],weapon:null,character:{captureDeath:capture},label:{hidden:false},melee:null,death:undefined};
 const fake={lightweightDeaths:true,avatars:new Map([['victim',a]]),meleeFinishers:new Set(),collisionWorld:new CollisionWorld(),silhouettes:{remove:vi.fn()}};
 try{const event={victimId:'victim',victimLife:2,id:'death',direction:{x:0,y:0,z:1}} as Elimination;
  RemotePlayers.prototype.eliminate.call(fake as unknown as RemotePlayers,event);
  expect(clone).not.toHaveBeenCalled();expect(mesh.material).toBe(mat);expect(a.death).toMatchObject({materials:[],elapsed:0});expect(capture).toHaveBeenCalledTimes(1);expect(a.label.hidden).toBe(true);
  RemotePlayers.prototype.eliminate.call(fake as unknown as RemotePlayers,event);expect(capture).toHaveBeenCalledTimes(1);
 }finally{scene.dispose();engine.dispose();}
});
