/** Actual first/third-person rigs, without inventory grants or a network connection. */
import {Camera,Color3,Color4,DirectionalLight,FreeCamera,HemisphericLight,PBRMaterial,Scene,TransformNode,Vector3,type AbstractMesh,type Engine} from '@babylonjs/core';
import {cosmetic,defaultCosmetic} from '../shared/cosmetics';
import {MaterialLibrary} from '../src/rendering/MaterialLibrary';
import {studioEnvironment} from '../src/rendering/StudioEnvironment';
import {setSkinFxLite} from '../src/rendering/SkinFx';
import {WeaponView} from '../src/weapons/WeaponView';
import {MeleeView} from '../src/weapons/MeleeView';
import {Weapon,WEAPONS} from '../src/weapons/Weapon';
import {MeleeLibrary} from '../src/game/melee/MeleeAssets';
import {CharacterAssetLibrary} from '../src/game/CharacterAsset';
import {CharacterWeaponLibrary} from '../src/game/CharacterWeapon';
import {meshesReady} from '../src/core/assetReadiness';
import type {RenderContext} from '../src/rendering/RenderContext';

export async function auditContexts(engine:Engine,id:string,mode:string){
 const item=cosmetic(id);if(!item)throw Error('Unregistered cosmetic '+id);
 const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.useConstantAnimationDeltaTime=true;scene.clearColor=new Color4(0,0,0,0);
 const library=new MaterialLibrary(scene),signal=new AbortController().signal,chrome=mode==='chromebook';
 const camera=new FreeCamera('context-camera',Vector3.Zero(),scene);camera.minZ=.012;camera.maxZ=100;camera.fovMode=Camera.FOVMODE_HORIZONTAL_FIXED;camera.fov=Math.PI/2;camera.setTarget(new Vector3(0,0,-1));
 const fill=new HemisphericLight('context-fill',Vector3.Up(),scene);fill.intensity=1.15;fill.groundColor=new Color3(.28,.3,.34);fill.specular=Color3.Black();
 const sun=new DirectionalLight('context-sun',new Vector3(-1,-2,-1),scene);sun.intensity=2;
 let gun:WeaponView|undefined,melee:MeleeView|undefined,daggers:MeleeLibrary|undefined;
 const frames:{context:string;image:string;meshes:string[];materials:{name:string;metallic:number|null;normal:boolean;orm:boolean}[]}[]=[];
 const capture=async(context:string,meshes:readonly AbstractMesh[])=>{
  await library.ready();await meshesReady(meshes);await scene.whenReadyAsync();scene.render();await new Promise(resolve=>requestAnimationFrame(resolve));scene.render();
  const shown=meshes.filter(m=>m.getTotalVertices()>0&&m.isEnabled()&&m.isVisible&&m.visibility>0),materials=[...new Set(shown.map(m=>m.material))].filter((m):m is PBRMaterial=>m instanceof PBRMaterial&&m.name.startsWith('cosmetic:'));
  if(!shown.length||(!id.startsWith('default-')&&!materials.length))throw Error('Lost equipped skin '+id+' '+context);
  frames.push({context,image:engine.getRenderingCanvas()!.toDataURL('image/png'),meshes:shown.map(m=>m.name),materials:materials.map(m=>({name:m.name,metallic:m.metallic,normal:!!m.bumpTexture,orm:!!m.metallicTexture}))});
 };
 try{
  await library.load();library.setChromebook(chrome);setSkinFxLite(chrome);if(!chrome)await studioEnvironment(scene,.6);
  if(item.weapon==='melee'){
   daggers=new MeleeLibrary(scene);melee=new MeleeView({scene,camera} as RenderContext,daggers);await melee.load(signal);await melee.setCosmetic(id);melee.freeze('idle',.2);
   const pose={x:0,y:0,z:0,pitch:0,yaw:0,roll:0};melee.update(pose);await capture('first-person',scene.meshes.filter(m=>m.renderingGroupId===1));
   await melee.setCosmetic('default-melee');await melee.setCosmetic(id);melee.reset();melee.freeze('idle',.2);melee.update(pose);
   await capture('cached-new-life',scene.meshes.filter(m=>m.renderingGroupId===1));melee.setVisible(false);melee.update(pose);
  }else{
   gun=new WeaponView({scene,camera} as RenderContext,library,null);await gun.load(signal);await gun.setCosmetic(item.weapon,id);gun.select(item.weapon);
   const weapon=new Weapon(WEAPONS.find(w=>w.id===item.weapon)!),motion={speed:0,grounded:true,sliding:false,crouch:0,sprinting:false};
   gun.update(1/60,weapon,motion);await capture('first-person',gun.meshes);
   weapon.ads=1;gun.update(1/60,weapon,motion);await capture('ads',gun.meshes);
   weapon.ads=0;weapon.action=item.weapon==='shotgun'?'shell':'reload';weapon.progress=.4;gun.update(1/60,weapon,motion);await capture('reload',gun.meshes);
   weapon.action='idle';gun.fire();gun.update(1/60,weapon,motion);gun.holdFlash(false);await capture('recoil',gun.meshes);
   gun.setVisible(false);gun.motion.reset();await gun.setCosmetic(item.weapon,defaultCosmetic(item.weapon));await gun.setCosmetic(item.weapon,id);gun.select(item.weapon);gun.setVisible(true);gun.update(1/60,weapon,motion);await capture('cached-new-life',gun.meshes);gun.setVisible(false);
  }
  // CharacterWeapon is shared by multiplayer characters, bots and the home preview.
  const characters=new CharacterAssetLibrary(scene),weapons=new CharacterWeaponLibrary(scene,library),weaponId=item.weapon==='melee'?'rifle':item.weapon;
  await Promise.all([characters.load(signal),weapons.load(weaponId,signal,item.weapon==='melee'?undefined:id)]);
  const character=characters.instantiate(new TransformNode('context-player',scene),'context-player')!,held=weapons.create(character,weaponId,item.weapon==='melee'?undefined:id)!;
  if(daggers){held.melee=daggers.createCharacterMelee('context-daggers');await held.melee!.pair.setCosmetic(id);held.melee!.animator.play('idle');held.melee!.advance(.2);}
  scene.onBeforeAnimationsObservable.add(()=>held.restore());scene.onAfterAnimationsObservable.add(()=>held.update());
  camera.fovMode=Camera.FOVMODE_VERTICAL_FIXED;camera.fov=.6;camera.position.set(1.3,1.55,-2);camera.setTarget(new Vector3(0,1.17,-.12));
  for(const ads of [0,1]){held.setState({ads});for(let i=0;i<30;i++){character.update({velocity:{x:0,y:0,z:0},grounded:true,crouch:0,slideRemaining:0},1/60);held.advance(1/60);scene.render();}
   await capture(ads?'third-person-ads':'third-person',daggers?held.melee!.pair.meshes:held.meshes);
  }
  held.melee?.dispose();held.dispose();character.dispose();return {id,mode,frames};
 }finally{gun?.dispose();melee?.dispose();daggers?.dispose();scene.dispose();library.dispose();}
}
