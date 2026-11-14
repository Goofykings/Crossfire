import {Engine,Scene,FreeCamera,HemisphericLight,MeshBuilder,StandardMaterial,Vector3,Matrix,SceneInstrumentation,type RenderTargetTexture} from '@babylonjs/core';
import {GeometryBatcher} from '../src/rendering/StaticBatcher';
import {PlayerSilhouettes} from '../src/rendering/PlayerSilhouettes';
const canvas=document.querySelector('canvas')!,engine=new Engine(canvas,false,{preserveDrawingBuffer:true}),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(3,1.6,-6),scene);scene.activeCamera=camera;
new HemisphericLight('ambient',Vector3.Up(),scene);
const batch=new GeometryBatcher(scene,40),box=MeshBuilder.CreateBox('source',{},scene),cylinder=MeshBuilder.CreateCylinder('curved',{height:1.2,diameter:.8,tessellation:16},scene);
for(let i=0;i<12;i++){
 const material=new StandardMaterial('surface'+i,scene);
 const transform=Matrix.Scaling(i%3===0?1.4:.5,i%4===0?2.5:1,.4).multiply(Matrix.RotationY(i*.23)).multiply(Matrix.Translation(1+(i%4)*1.3,.6,1+Math.floor(i/4)*2));
 batch.add(i%3===0?cylinder:box,transform,{material,name:'surface'+i,tint:[1,1,1]});
}
const sources=batch.build();box.setEnabled(false);cylinder.setEnabled(false);
const body=MeshBuilder.CreateCapsule('body',{height:1.8,radius:.3},scene);body.position.set(3,.9,4);
const instrument=new SceneInstrumentation(scene);instrument.captureFrameTime=true;
async function sample(batched:boolean,x:number,z:number){
 camera.position.set(x,1.6,z);camera.setTarget(body.position);camera.getViewMatrix(true);camera.getProjectionMatrix(true);
 const outline=new PlayerSilhouettes(scene,camera,batched);outline.setWorld(sources);outline.set([body],false,true);outline.update(true);
 const mask=(outline as unknown as {mask:RenderTargetTexture}).mask;
 const end=performance.now()+10000;while(!scene.isReady()||!mask.isReadyForRendering()){scene.render();if(performance.now()>end)throw Error('Mask shaders not ready');await new Promise(r=>setTimeout(r,16));}
 for(let i=0;i<3;i++){outline.update(true);scene.render();}
 const pixels=await mask.readPixels();if(!pixels)throw Error('No mask pixels');
 const bytes=Array.from(new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength)),draws=instrument.drawCallsCounter.current;
 const main=await engine.readPixels(0,0,engine.getRenderWidth(),engine.getRenderHeight()),color=Array.from(new Uint8Array(main.buffer,main.byteOffset,main.byteLength));
 outline.dispose();return{bytes,color,draws};
}
Object.assign(window,{maskAudit:async()=>{
 const rows=[];for(const [x,z]of [[3,-6],[0,-2],[7,2],[2,8],[5,-4]]){
  const before=await sample(false,x,z),after=await sample(true,x,z);let changed=0,red=0;
  for(let i=0;i<before.bytes.length;i++){if(before.bytes[i]!==after.bytes[i])changed++;if(i%4===0&&before.bytes[i]>127)red++;}
  if(changed)throw Error(`Depth mask changed at ${x},${z}: ${changed} bytes`);
  if(before.color.some((v,i)=>v!==after.color[i]))throw Error('Main scene pixels changed');
  rows.push({x,z,changed,visiblePlayerPixels:red,beforeDraws:before.draws,afterDraws:after.draws});
 }return rows;
}});
