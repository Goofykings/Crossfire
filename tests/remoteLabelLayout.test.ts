import {expect,it,vi} from 'vitest';
import {FreeCamera,MeshBuilder,NullEngine,Scene,TransformNode,Vector3} from '@babylonjs/core';
import {RemotePlayers} from '../src/game/RemotePlayers';
import {MaterialLibrary} from '../src/rendering/MaterialLibrary';

it('reads label viewport once for several players and preserves immediate opponent occlusion',()=>{
 const element=()=>({className:'',hidden:false,style:{},classList:{remove(){},toggle(){}},setAttribute(){},append(){},remove(){}});
 vi.stubGlobal('document',{createElement:element,addEventListener(){},removeEventListener(){}});
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const camera=new FreeCamera('camera',new Vector3(0,1.6,0),scene);scene.activeCamera=camera;camera.setTarget(new Vector3(0,1.6,6));
  let reads=0;const canvas={get clientWidth(){reads++;return 1280;},get clientHeight(){reads++;return 720;}};
  vi.spyOn(engine,'getRenderingCanvas').mockReturnValue(canvas as HTMLCanvasElement);
  const remote=new RemotePlayers(scene,element() as unknown as HTMLElement,new MaterialLibrary(scene));
  const state=remote as unknown as {avatars:Map<string,unknown>;dt:number;visibilityWorld:{occluded:()=>boolean}};state.dt=.05;
  const labels=[];
  for(let i=0;i<4;i++){
   const root=new TransformNode('root'+i,scene),mesh=MeshBuilder.CreateBox('body'+i,{height:1.8},scene);root.position.set(i-1.5,0,6);mesh.parent=root;
   const label=element();labels.push(label);
   state.avatars.set(String(i),{root,meshes:[mesh],label,height:1.8,character:null,weapon:null,visualScaleY:1,friendly:i===0,clearFor:0});
  }
  state.visibilityWorld={occluded:()=>false};reads=0;scene.onAfterAnimationsObservable.notifyObservers(scene);
  expect(reads).toBe(2);expect(labels.every(l=>!l.hidden)).toBe(true);
  state.visibilityWorld={occluded:()=>true};reads=0;scene.onAfterAnimationsObservable.notifyObservers(scene);
  expect(reads).toBe(2);expect(labels[0].hidden).toBe(false);expect(labels.slice(1).every(l=>l.hidden)).toBe(true);
 }finally{scene.dispose();engine.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
