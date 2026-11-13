import {expect,it,vi} from 'vitest';
import {NullEngine,Scene,TransformNode,PBRMaterial,MeshBuilder,Vector3} from '@babylonjs/core';
import {RemotePlayers} from '../src/game/RemotePlayers';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import type {Elimination} from '../shared/protocol';

/** A Blossom elimination turns the victim's model into flowers: hidden on the same frame, no falling body, normal lifetime afterwards. */
it('a vanishing victim is hidden at once, skips the fall pose and material copies, and is deleted like any dead avatar',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('root',scene),mesh=MeshBuilder.CreateBox('body',{},scene),mat=new PBRMaterial('body',scene);mesh.material=mat;
  root.position.set(2,0,-3);
  const clone=vi.spyOn(mat,'clone'),capture=vi.fn(),remove=vi.fn(),a={life:2,root,meshes:[mesh],weapon:null,character:{captureDeath:capture},label:{hidden:false},melee:null,death:undefined as unknown};
  const fake={lightweightDeaths:false,avatars:new Map([['victim',a]]),meleeFinishers:new Set(),collisionWorld:new CollisionWorld(),silhouettes:{remove}};
  try{
    const event={victimId:'victim',victimLife:2,id:'blossom',direction:{x:0,y:0,z:1}} as Elimination;
    RemotePlayers.prototype.eliminate.call(fake as unknown as RemotePlayers,event,true);
    expect(root.isEnabled()).toBe(false);expect(a.label.hidden).toBe(true);expect(remove).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();expect(capture).not.toHaveBeenCalled();expect(mesh.material).toBe(mat);
    expect(a.death).toMatchObject({vanish:true,elapsed:0,materials:[]});
    // The flowers start where the model was drawn.
    const shown=RemotePlayers.prototype.vanishedAt.call(fake as unknown as RemotePlayers,'victim') as Vector3;
    expect(shown.x).toBe(2);expect(shown.z).toBe(-3);expect(RemotePlayers.prototype.vanishedAt.call(fake as unknown as RemotePlayers,'nobody')).toBeNull();
    // A repeated event does nothing.
    RemotePlayers.prototype.eliminate.call(fake as unknown as RemotePlayers,event,true);expect(remove).toHaveBeenCalledTimes(1);
  }finally{scene.dispose();engine.dispose();}
});

it('an ordinary elimination keeps the full falling death and is not marked as vanished',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('root',scene),mesh=MeshBuilder.CreateBox('body',{},scene);
  const capture=vi.fn(),a={life:2,root,meshes:[mesh],weapon:null,character:{captureDeath:capture},label:{hidden:false},melee:null,death:undefined as {vanish?:boolean}|undefined};
  const fake={lightweightDeaths:true,avatars:new Map([['victim',a]]),meleeFinishers:new Set(),collisionWorld:new CollisionWorld(),silhouettes:{remove:vi.fn()}};
  try{
    RemotePlayers.prototype.eliminate.call(fake as unknown as RemotePlayers,{victimId:'victim',victimLife:2,id:'plain',direction:{x:0,y:0,z:1}} as Elimination);
    expect(root.isEnabled()).toBe(true);expect(capture).toHaveBeenCalledTimes(1);expect(a.death?.vanish).toBeUndefined();
    expect(RemotePlayers.prototype.vanishedAt.call(fake as unknown as RemotePlayers,'victim')).toBeNull();
  }finally{scene.dispose();engine.dispose();}
});
