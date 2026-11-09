import {expect,it} from 'vitest';
import {FreeCamera,MeshBuilder,NullEngine,Scene,Vector3} from '@babylonjs/core';
import {PlayerSilhouettes} from '../src/rendering/PlayerSilhouettes';

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
  outlines.set([body],false,false);outlines.update(true);
  expect(scene.customRenderTargets).toHaveLength(0);
  expect(camera._postProcesses.filter(Boolean)).toHaveLength(0);expect(outlines.inspect().passes).toBe(0);
  outlines.set([body],true,true);outlines.update(true);expect(outlines.inspect().passes).toBe(1);expect(outlines.inspect().last).toBe(true);
  outlines.dispose();
 }finally{scene.dispose();engine.dispose();}
});
