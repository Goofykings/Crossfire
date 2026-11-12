/** Isolated review fixture: no connection, inventory grant, or gameplay endpoint. */
import {Color3,Color4,Matrix,Engine,FreeCamera,MeshBuilder,Scene,StandardMaterial,Vector3} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {updateResultGems} from '../src/ui/RoundResults';
import type {RoundResult} from '../shared/scoring';
import {PostFX} from '../src/rendering/PostFX';
import {PlayerSilhouettes} from '../src/rendering/PlayerSilhouettes';
import {HealthSaturation} from '../src/rendering/HealthSaturation';
import {GRAPHICS_PRESETS,CHROMEBOOK_PRESET} from '../src/rendering/quality';
import {MaterialLibrary} from '../src/rendering/MaterialLibrary';
import {WeaponView} from '../src/weapons/WeaponView';
import {WEAPONS,Weapon,type WeaponId} from '../src/weapons/Weapon';
import type {RenderContext} from '../src/rendering/RenderContext';
const canvas=document.querySelector<HTMLCanvasElement>('#view')!,engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});
engine.setHardwareScalingLevel(1);
const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(.1,.12,.15,1);
const camera=new FreeCamera('camera',new Vector3(0,1.6,0),scene);camera.setTarget(new Vector3(0,1.6,-5));camera.minZ=.1;
for(const [i,c]of [new Color3(.85,.08,.04),new Color3(.05,.85,.08),new Color3(.04,.12,.85)].entries()){
 const box=MeshBuilder.CreateBox('world-'+i,{width:1,height:1.5,depth:.3},scene);box.position.set((i-1)*1.4,1.6,-5);
 const mat=new StandardMaterial('color-'+i,scene);mat.disableLighting=true;mat.emissiveColor=c;box.material=mat;
}
const outline=MeshBuilder.CreateSphere('team-marker',{diameter:.6},scene);outline.position.set(0,3,-5);
const om=new StandardMaterial('team-body',scene);om.emissiveColor=new Color3(.4,.4,.4);om.disableLighting=true;outline.material=om;
const post=new PostFX(scene,camera),contours=new PlayerSilhouettes(scene,camera),health=new HealthSaturation();
contours.set([outline],true,true);let outlines=true;
scene.onAfterAnimationsObservable.add(()=>contours.update(outlines));
const materials=new MaterialLibrary(scene),signal=new AbortController().signal;await materials.load(undefined,signal);
const view=new WeaponView({scene,camera} as RenderContext,materials,null);await view.load(signal);view.setVisible(false);
engine.runRenderLoop(()=>scene.render());
const settle=async()=>{await scene.whenReadyAsync();for(let i=0;i<12;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
const review={
 resultReward(amount:number,practice=false){const panel=document.createElement('div');panel.innerHTML='<header class="result-banner"></header>';updateResultGems(panel,{gemRewards:{matchId:'review',awards:{self:amount}}} as RoundResult,'self',practice);return panel.textContent;},
 async quality(name:string){post.apply(name==='chromebook'?CHROMEBOOK_PRESET:GRAPHICS_PRESETS[name as keyof typeof GRAPHICS_PRESETS]);contours.keepLast();await settle();},
 async health(hp:number,active=true,life='one'){for(let i=0;i<120;i++)contours.setSaturation(health.update(1/60,hp,100,active,life));document.querySelector('#hud')!.textContent=`TEAM BLUE / ${hp} HP`;await settle();return contours.inspect();},
 outlines(on:boolean){outlines=on;},
 async skin(id:string,weapon:WeaponId){await view.setCosmetic(weapon,id);view.select(weapon);view.setVisible(true);view.update(1/60,new Weapon(WEAPONS.find(w=>w.id===weapon)!),{grounded:true,speed:0,sprinting:false,sliding:false,crouch:0});await settle();return{cosmetic:view.currentCosmetic,meshes:scene.meshes.length,materials:scene.materials.length};},
 hide(){view.setVisible(false);},
 async pixels(){const image=new Image();image.src=canvas.toDataURL();await image.decode();const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return [-1,0,1].map(i=>{const p=Vector3.Project(new Vector3(i*1.4,1.6,-5),Matrix.Identity(),scene.getTransformMatrix(),camera.viewport.toGlobal(c.width,c.height));return [...ctx.getImageData(Math.round(p.x),Math.round(p.y),1,1).data];});}
};
await review.quality('low');Object.assign(window,{__healthSkinReview:review});
