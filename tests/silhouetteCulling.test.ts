import {expect,it,vi} from 'vitest';
import {FreeCamera,Matrix,MeshBuilder,NullEngine,Scene,StandardMaterial,Vector3} from '@babylonjs/core';
import {PlayerSilhouettes} from '../src/rendering/PlayerSilhouettes';
import {GeometryBatcher} from '../src/rendering/StaticBatcher';
import {batchSilhouetteGeometry} from '../src/rendering/SilhouetteGeometry';

it('contours retain visible occluders and detach the entire pass when no players need it',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const camera=new FreeCamera('camera',Vector3.Zero(),scene);scene.activeCamera=camera;
  camera.setTarget(new Vector3(0,0,10));camera.getViewMatrix(true);camera.getProjectionMatrix(true);
  const front=MeshBuilder.CreateBox('wall',{},scene),behind=MeshBuilder.CreateBox('behind-camera',{},scene);
  front.position.z=5;behind.position.z=-10;
  for(const m of [front,behind]){m.metadata={canonical:'wall'};m.computeWorldMatrix(true);}
  const body=MeshBuilder.CreateBox('player',{},scene);body.position.z=3;body.computeWorldMatrix(true);
  const outlines=new PlayerSilhouettes(scene,camera);outlines.setWorld([front,behind]);outlines.set([body],false,true);outlines.update(true);
  expect(scene.customRenderTargets[0].renderList).toContain(front);
  expect(scene.customRenderTargets[0].renderList).not.toContain(behind);
  expect(outlines.inspect().passes).toBe(1);
  const pooled=scene.customRenderTargets[0].renderList;
  const dirty=vi.spyOn(front,'_markSubMeshesAsLightDirty');
  for(let i=0;i<60;i++)outlines.update(true);
  expect(dirty).not.toHaveBeenCalled();dirty.mockRestore();
  outlines.update(true);expect(scene.customRenderTargets[0].renderList).toBe(pooled);
  outlines.set([body],false,false);outlines.update(true);
  expect(scene.customRenderTargets).toHaveLength(0);
  expect(camera._postProcesses.filter(Boolean)).toHaveLength(0);expect(outlines.inspect().passes).toBe(0);
  outlines.set([body],true,true);outlines.update(true);expect(outlines.inspect().passes).toBe(1);expect(outlines.inspect().last).toBe(true);
  outlines.dispose();
 }finally{scene.dispose();engine.dispose();}
});
it('depth-only batches retain exact static surfaces and leave live foliage/weapon geometry independent',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const camera=new FreeCamera('camera',Vector3.Zero(),scene);scene.activeCamera=camera;camera.setTarget(new Vector3(0,0,10));
  const box=MeshBuilder.CreateBox('source',{},scene),material=new StandardMaterial('world',scene),b=new GeometryBatcher(scene,40);
  for(const [name,x]of [['stone',2],['wood',3],['leaf_bush',4]] as const)b.add(box,Matrix.Translation(x,0,6),{material,name,tint:[1,1,1]});
  const sources=b.build(),world=sources.filter(m=>m.metadata.canonical!=='leaf_bush'),leaf=sources.find(m=>m.metadata.canonical==='leaf_bush')!;
  const proxy=batchSilhouetteGeometry(scene,sources,material);
  expect(proxy.meshes).toHaveLength(1);expect(proxy.sources.size).toBe(2);expect(proxy.sources.has(leaf)).toBe(false);
  const mesh=proxy.meshes[0];expect(mesh.layerMask).toBe(0);expect(mesh.isPickable).toBe(false);expect(mesh.metadata?.canonical).toBeUndefined();
  expect(Array.from(mesh.getVerticesData('position')!)).toEqual(world.flatMap(m=>Array.from(m.getVerticesData('position')!)));
  expect(mesh.getTotalIndices()).toBe(world.reduce((n,m)=>n+m.getTotalIndices(),0));
  for(const m of world)expect(m.isDisposed()).toBe(false);
  mesh.dispose();
  const outlines=new PlayerSilhouettes(scene,camera);outlines.setWorld(sources);expect(outlines.inspect()).toMatchObject({staticBatches:1,staticSources:2});
  const body=MeshBuilder.CreateBox('player',{},scene);body.position.z=5;body.computeWorldMatrix(true);outlines.set([body],false,true);outlines.update(true);
  expect(scene.customRenderTargets[0].renderList).toContain(leaf);leaf.setEnabled(false);outlines.update(true);expect(scene.customRenderTargets[0].renderList).not.toContain(leaf);
  outlines.clear();expect(scene.meshes.some(m=>m.name.startsWith('silhouette:static:'))).toBe(false);
  expect(world.every(m=>!m.isDisposed())).toBe(true);outlines.dispose();
 }finally{scene.dispose();engine.dispose();}
});
