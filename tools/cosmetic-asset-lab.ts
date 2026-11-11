/** Development-only visual review. Not imported by the game and never contacts inventory APIs. */
import {ArcRotateCamera,Camera,Color3,Color4,DirectionalLight,Engine,FreeCamera,HDRCubeTexture,HemisphericLight,Scene,TransformNode,Vector3} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {COSMETICS,defaultEquipment,type CosmeticDefinition} from '../shared/cosmetics';
import {loadCosmeticAsset} from '../src/rendering/CosmeticAssets';
import {MaterialLibrary} from '../src/rendering/MaterialLibrary';
import {CharacterAssetLibrary} from '../src/game/CharacterAsset';
import {CharacterWeaponLibrary} from '../src/game/CharacterWeapon';
import {WeaponView} from '../src/weapons/WeaponView';
import {WEAPONS,Weapon,type WeaponAction} from '../src/weapons/Weapon';
import {meshesReady,texturesReady} from '../src/core/assetReadiness';
import {assetUrl} from '../src/core/assets';
import type {RenderContext} from '../src/rendering/RenderContext';
import {setSkinFxLite,skinFxClock,skinFxInfo} from '../src/rendering/SkinFx';
const canvas=document.querySelector<HTMLCanvasElement>('#canvas')!,label=document.querySelector<HTMLElement>('#label')!;
const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true});engine.setHardwareScalingLevel(1);
const manifest=await(await fetch(assetUrl('assets/cosmetics/foundry-collection.json'))).json();
// Only this separate lab's JS realm gains staged definitions. No live registration or ownership grant.
const staged:CosmeticDefinition[]=manifest.items.map((entry:{catalogEntry:CosmeticDefinition})=>entry.catalogEntry);
(COSMETICS as CosmeticDefinition[]).push(...staged);
// Semi-auto sniper review (docs/SEMI_SNIPER.md): staged in memory only, on the AR ('rifle') rig presets, with ?semi.
const SEMI_ID='semi-sniper-review',SEMI_MODE=new URLSearchParams(location.search).has('semi');
if(new URLSearchParams(location.search).has('semi')){
 const semi:CosmeticDefinition={id:SEMI_ID,name:'Semi-Auto Sniper',weapon:'rifle',rarity:'common',ownership:'grant',compatibleWith:['rifle'],asset:{model:'assets/models/shared/weapons/semi_sniper.glb',binding:'shared'}};
 (COSMETICS as CosmeticDefinition[]).push(semi);staged.length=0;staged.push(semi);
}
let scene:Scene|null=null;
/* Review-only overrides (tools/skin-fx-test.mjs): backdrop colour and a fixed skin-animation time. */
const review:{background:[number,number,number]|null;time:number|null}={background:null,time:null};
const liveClock=skinFxClock.now;skinFxClock.now=()=>review.time??liveClock();
type View='locker'|'side'|'front'|'third'|'third-side'|'third-ads'|'third-snow'|'fp'|'ads'|'reload'|'recoil'|'walk'|'snow'|'ads-snow';
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function capture(id:string,context:View,low=false){
 setSkinFxLite(low);/* the Chromebook path of the shared skin shader */
 scene?.dispose();scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=review.background?new Color4(...review.background,1):new Color4(.10,.13,.18,1);scene.imageProcessingConfiguration.exposure=1.1;
 const s=scene,materials=new MaterialLibrary(s),signal=new AbortController().signal;
 const fill=new HemisphericLight('fill',new Vector3(0,1,0),s);fill.intensity=1.25;fill.groundColor=new Color3(.32,.36,.43);
 const key=new DirectionalLight('key',new Vector3(-1,-2,-1),s);key.intensity=2;
 if(!low){const hdr=new HDRCubeTexture(assetUrl('assets/env/sky_1k.hdr'),s,128,false,true,false,true);s.environmentTexture=hdr;s.environmentIntensity=.6;await texturesReady([hdr]);}
 await materials.load(undefined,signal);
 const item=COSMETICS.find(c=>c.id===id),crate=id==='foundry-crate';if(!item&&!crate)throw Error('Unknown staged asset');
 const camera=new FreeCamera('camera',new Vector3(0,0,0),s);camera.minZ=.1;camera.maxZ=100;camera.fov=1.3;camera.setTarget(new Vector3(0,0,-1));
 let inspect:unknown=null;
 if(context.startsWith('third')&&item){
  const library=new CharacterAssetLibrary(s),weapons=new CharacterWeaponLibrary(s,materials);await Promise.all([library.load(signal),weapons.load(item.weapon,signal,id)]);
  const parent=new TransformNode('root',s),character=library.instantiate(parent,'cosmetic-review')!;if(!character)throw Error('Actual character unavailable');
  const gun=weapons.create(character,item.weapon,id)!;s.useConstantAnimationDeltaTime=true;s.onBeforeAnimationsObservable.add(()=>gun.restore());s.onAfterAnimationsObservable.add(()=>gun.update());
  camera.fov=.6;camera.position.copyFrom(context==='third-side'?new Vector3(2.1,1.45,-.1):new Vector3(1.3,1.55,-2.0));camera.setTarget(new Vector3(0,1.17,-.12));
  const motion={velocity:{x:0,y:0,z:0},grounded:true,crouch:0,slideRemaining:0};gun.setState({ads:context==='third-ads'?1:0});
  await s.whenReadyAsync();await weapons.ready(signal);await meshesReady(character.meshes,signal);
  for(let i=0;i<75;i++){character.update(motion,1/60);gun.advance(1/60);s.render();}
  /* Frosted firing effect on a character: three shots at a real cadence, then the flurry mid-flight. */
  if(context==='third-snow'){camera.position.set(1.5,1.4,-.9);camera.setTarget(new Vector3(0,1.25,-.75));for(let i=0;i<3;i++){gun.fire();await wait(90);character.update(motion,1/60);gun.advance(1/60);s.render();}await wait(120);s.render();}
  inspect=gun.inspect();
 }else if(['fp','ads','reload','recoil','walk','snow','ads-snow'].includes(context)&&item){
  if(SEMI_MODE||new URLSearchParams(location.search).has('game')){camera.fovMode=Camera.FOVMODE_HORIZONTAL_FIXED;camera.fov=Math.PI/2;}/* game viewmodel: 90 degrees horizontal */
  const view=new WeaponView({scene:s,camera} as RenderContext,materials,null);await view.load(signal);await view.setCosmetics({...defaultEquipment(),[item.weapon]:id});view.select(item.weapon);
  const w=new Weapon(WEAPONS.find(w=>w.id===item.weapon)!);if(context==='ads'||context==='ads-snow')w.ads=1;
  if(context==='reload'){w.action=(item.weapon==='shotgun'?'shell':'reload') as WeaponAction;w.progress=.4;}
  await meshesReady(view.meshes,signal);await s.whenReadyAsync();
  const motion={speed:context==='walk'?3:0,grounded:true,sliding:false,crouch:0,sprinting:false};
  for(let i=0;i<60;i++){view.update(1/60,w,motion);s.render();}
  if(context==='recoil'){view.fire();view.update(1/60,w,motion);s.render();}
  let snow:unknown=null;
  if(context==='snow'||context==='ads-snow'){for(let i=0;i<4;i++){view.fire();await wait(90);view.update(1/60,w,motion);s.render();}await wait(110);for(let i=0;i<8;i++)view.update(1/60,w,motion);view.holdFlash(false);s.render();snow=view.snowInfo();}
  inspect={id:w.stats.id,cosmeticId:id,muzzle:view.muzzleWorld().asArray(),meshes:view.meshes.filter(m=>m.isEnabled()&&m.getTotalVertices()>0).length,action:view.debug.action,snow};
 }else{
  const definition=item??{id:'foundry-crate',asset:{model:manifest.crate.model,binding:'embedded'}} as CosmeticDefinition;
  const c=await loadCosmeticAsset(definition,s,materials,signal);c.addAllToScene();for(const mesh of c.meshes)mesh.computeWorldMatrix(true);
  const bounds=c.rootNodes[0].getHierarchyBoundingVectors(true),size=bounds.max.subtract(bounds.min),target=bounds.min.add(bounds.max).scale(.5);
  const orbit=new ArcRotateCamera('orbit',context==='side'?0:context==='front'?-Math.PI/2:.28,context==='front'?1.35:1.28,2,target,s);orbit.fov=.55;orbit.minZ=.01;
  orbit.radius=Math.max(size.y,size.z/engine.getAspectRatio(orbit),size.x/engine.getAspectRatio(orbit))/(2*Math.tan(orbit.fov/2))*1.5;s.activeCamera=orbit;
  await meshesReady(c.meshes,signal);await s.whenReadyAsync();s.render();inspect={meshes:c.meshes.filter(m=>m.getTotalVertices()>0).length,vertices:c.meshes.reduce((n,m)=>n+m.getTotalVertices(),0)};
 }
 await materials.ready(signal);await new Promise(resolve=>setTimeout(resolve,80));s.render();label.textContent=`${item?.name??'Foundry Crate'} | ${context} | ${low?'low: no environment reflections':'environment reflections'}`;
 const counter=(engine as unknown as {_drawCalls:{current:number}})._drawCalls,start=counter.current,cpu=[];
 for(let i=0;i<30;i++){const at=performance.now();s.render();cpu.push(performance.now()-at);}cpu.sort((a,b)=>a-b);
 const result={image:canvas.toDataURL('image/png'),inspect,drawCalls:(counter.current-start)/30,renderCpuMedianMs:cpu[15],renderCpuP95Ms:cpu[28],engineCount:Engine.Instances.length};
 return result;
}
(window as unknown as {__cosmeticLabScene:()=>Scene|null}).__cosmeticLabScene=()=>scene;
(window as unknown as {__cosmeticLab:unknown}).__cosmeticLab={capture,items:staged.map(c=>c.id),review,skinFx:skinFxInfo};
label.textContent='Asset lab ready. Use tools/review-cosmetic-assets.mjs. No inventory changes.';
