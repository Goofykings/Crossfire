/** Isolated actual-asset audit. No staged registry entries, inventory or networking. */
import '@babylonjs/loaders/glTF';
import {ArcRotateCamera,Color3,Color4,DirectionalLight,Engine,HemisphericLight,PBRMaterial,Scene,Vector3,type AssetContainer} from '@babylonjs/core';
import {COSMETICS} from '../shared/cosmetics';
import {MaterialLibrary} from '../src/rendering/MaterialLibrary';
import {loadCosmeticAsset} from '../src/rendering/CosmeticAssets';
import {meshesReady} from '../src/core/assetReadiness';
import {studioEnvironment} from '../src/rendering/StudioEnvironment';
import {GRAPHICS_PRESETS} from '../src/rendering/quality';
import {setSkinFxLite,skinFxClock} from '../src/rendering/SkinFx';
import {auditContexts} from './cosmetic-context-audit';

const canvas=document.querySelector<HTMLCanvasElement>('canvas')!,engine=new Engine(canvas,false,{preserveDrawingBuffer:true,stencil:true});
engine.setHardwareScalingLevel(1);
const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(0,0,0,0);scene.imageProcessingConfiguration.exposure=1.1;
const camera=new ArcRotateCamera('audit-camera',.25,1.28,2,Vector3.Zero(),scene);camera.fov=.55;camera.minZ=.01;
const ambient=new HemisphericLight('audit-ambient',Vector3.Up(),scene);ambient.intensity=1.1;ambient.diffuse=new Color3(.78,.84,1);ambient.groundColor=new Color3(.28,.3,.34);ambient.specular=Color3.Black();
const sun=new DirectionalLight('audit-sun',new Vector3(-1,-2,-1),scene);sun.intensity=2;
const library=new MaterialLibrary(scene);await library.load();const environment=await studioEnvironment(scene,.6);skinFxClock.now=()=>0;
let container:AssetContainer|null=null,id='',preset='high';
function quality(name:string){
 const chrome=name==='chromebook',p=chrome?GRAPHICS_PRESETS.low:GRAPHICS_PRESETS[name as keyof typeof GRAPHICS_PRESETS];if(!p)throw Error('Unknown preset '+name);
 library.setUltra(!!p.ultraMaterials);library.setChromebook(chrome);setSkinFxLite(chrome);library.setAnisotropy(p.anisotropy);scene.environmentTexture=chrome?null:environment;preset=name;
}
async function ready(){if(!container)throw Error('No asset');await library.ready();await meshesReady(container.meshes);await scene.whenReadyAsync();scene.render();await new Promise(resolve=>requestAnimationFrame(resolve));scene.render();}
async function load(next:string,mode='high'){
 container?.dispose();container=null;skinFxClock.now=()=>0;quality(mode);const item=COSMETICS.find(c=>c.id===next);if(!item)throw Error('Unregistered cosmetic '+next);
 container=await loadCosmeticAsset(item,scene,library);container.addAllToScene();id=next;
 for(const mesh of container.meshes)mesh.computeWorldMatrix(true);
 const bounds=container.rootNodes[0].getHierarchyBoundingVectors(true),size=bounds.max.subtract(bounds.min);camera.setTarget(bounds.min.add(bounds.max).scale(.5));camera.alpha=.25;camera.beta=1.28;
 camera.radius=Math.max(size.y,size.z/engine.getAspectRatio(camera),size.x/engine.getAspectRatio(camera))/(2*Math.tan(camera.fov/2))*1.5;camera.minZ=camera.radius*.05;camera.maxZ=camera.radius*30;
 await ready();return inspect();
}
function inspect(){
 if(!container)throw Error('No asset');
 const meshes=container.meshes.filter(m=>m.getTotalVertices()>0&&m.isEnabled()),materials=[...new Set(meshes.map(m=>m.material))].filter((m):m is PBRMaterial=>m instanceof PBRMaterial);
 const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const context=copy.getContext('2d')!;context.drawImage(canvas,0,0);const pixels=context.getImageData(0,0,copy.width,copy.height).data;
 let count=0,luminance=0,dark=0,signature=2166136261;for(let i=0;i<pixels.length;i+=4){for(let j=0;j<4;j++)signature=Math.imul(signature^pixels[i+j],16777619);if(pixels[i+3]>240){count++;const l=(pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722)/255;luminance+=l;if(l<.05)dark++;}}
 return {id,preset,meshes:meshes.map(m=>m.name),signature:signature>>>0,camera:{active:scene.activeCamera?.name,radius:camera.radius,target:camera.target.asArray()},pixels:count,luminance:count?luminance/count:0,dark:count?dark/count:0,
  materials:materials.map(m=>({name:m.name,metallic:m.metallic,roughness:m.roughness,reflection:m.reflectionColor.asArray(),normal:!!m.bumpTexture,orm:!!m.metallicTexture,coat:m.clearCoat.isEnabled,textures:m.getActiveTextures().map(t=>({name:t.name,ready:t.isReady(),size:t.getSize()}))}))};
}
const audit={items:COSMETICS.map(c=>({id:c.id,name:c.name,weapon:c.weapon})),presets:['chromebook',...Object.keys(GRAPHICS_PRESETS)],load,
 async switch(name:string){const before=container!.meshes.map(m=>m.material);quality(name);await ready();if(container!.meshes.some((m,i)=>m.material!==before[i]))throw Error('Quality switch replaced a material');return inspect();},
 async animate(){skinFxClock.now=()=>.75;await new Promise(resolve=>setTimeout(resolve,350));await ready();return inspect();},
 async contexts(next:string,mode:string){container?.dispose();container=null;return auditContexts(engine,next,mode);},capture(){return canvas.toDataURL('image/png');},inspect};
(window as unknown as {__cosmeticAudit:typeof audit}).__cosmeticAudit=audit;
