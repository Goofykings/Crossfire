import {Color3,Matrix,MeshBuilder,StandardMaterial,Vector3,type Camera,type Scene,type Mesh,type LinesMesh} from '@babylonjs/core';
import {ZONE_MAPS,ZONE_SIZE,type ZoneState} from '../../shared/zoneControl';
import type {Snapshot} from '../../shared/protocol';
import './zoneControl.css';

const colors={blue:'#66aaff',red:'#ff665f',neutral:'#ffffff'};
export function markerPosition(x:number,y:number,front:boolean,width:number,height:number){
 if(!Number.isFinite(x))x=width/2;if(!Number.isFinite(y))y=height*2;
 let dx=x-width/2,dy=y-height/2;
 if(!front){dx=-dx;dy=Math.max(height/2,Math.abs(dy));}
 const margin=38,rx=Math.max(1,width/2-margin),ry=Math.max(1,height/2-margin);
 const scale=Math.max(1,Math.abs(dx)/rx,Math.abs(dy)/ry);
 const edge=scale>1||!front;dx/=scale;dy/=scale;
 // A near-center objective yields the crosshair its central sight picture.
 if(!edge&&Math.abs(dx)<38&&Math.abs(dy)<58)dy=-64;
 let screenX=width/2+dx,screenY=height/2+dy;
 // Reserve the timer/objective HUD at the top centre as well as the crosshair.
 if(Math.abs(dx)<165&&screenY<150){if(edge)screenX=width/2+(dx<0?-1:1)*Math.min(185,rx);else screenY=165;}
 return {x:screenX,y:screenY,edge,angle:Math.atan2(dy,dx)-Math.PI/2};
}
function marker(id:string){
 const root=document.createElement('div');root.className='zone-marker';root.dataset.zone=id;
 const face=document.createElement('div');face.className='zone-marker-face';
 const surface=document.createElement('div');surface.className='zone-marker-surface';
 const fill=document.createElement('span');fill.className='zone-marker-fill';
 const letter=document.createElement('strong');letter.textContent=id;
 surface.append(fill,letter);face.append(surface);root.append(face);return {root,fill};
}
/** One smoothed presentation value feeds both markers. Only server state decides
 * capture, ownership, occupants and points; no independent HUD capture clock. */
export class ZoneControlView {
 private key='';
 private readonly world=document.createElement('div');
 private readonly hud=document.createElement('div');
 private readonly items:{id:string;ground:Mesh;border:LinesMesh;material:StandardMaterial;world:ReturnType<typeof marker>;hud:ReturnType<typeof marker>;progress:number;capturing:string|null}[]=[];
 constructor(private readonly scene:Scene,parent:HTMLElement,private readonly camera:Camera){
  this.world.className='zone-world';this.hud.className='zone-hud';
  this.hud.setAttribute('aria-label','Zone Control objectives');parent.append(this.world,this.hud);this.clear();
 }
 clear():void {
  this.key='';for(const i of this.items){i.ground.dispose();i.border.dispose();i.material.dispose();}this.items.length=0;
  this.world.replaceChildren();this.hud.replaceChildren();this.world.hidden=this.hud.hidden=true;
 }
 update(snapshot:Snapshot|null,dt:number,visible:boolean):void {
  const state=snapshot?.zoneControl;
  if(!state){if(this.key)this.clear();return;}
  const key=`${snapshot.room}:${state.roundId}:${state.mapId}`;
  if(this.key!==key){
   this.clear();this.key=key;
   for(const d of ZONE_MAPS[state.mapId]){
    const [x,y,z]=d.position,h=ZONE_SIZE/2;
    const ground=MeshBuilder.CreateGround(`zone:${d.id}`,{width:ZONE_SIZE,height:ZONE_SIZE},this.scene);ground.position.set(x,y+.025,z);
    const material=new StandardMaterial(`zone:${d.id}:material`,this.scene);material.disableLighting=true;material.emissiveColor=Color3.White();material.alpha=.065;material.disableDepthWrite=true;material.backFaceCulling=false;ground.material=material;ground.isPickable=false;
    const points=[[-h,-h],[h,-h],[h,h],[-h,h],[-h,-h]].map(([a,b])=>new Vector3(x+a,y+.04,z+b));
    const border=MeshBuilder.CreateLines(`zone:${d.id}:border`,{points},this.scene);border.isPickable=false;
    const w=marker(d.id),hud=marker(d.id);this.world.append(w.root);this.hud.append(hud.root);
    this.items.push({id:d.id,ground,border,material,world:w,hud,progress:0,capturing:null});
   }
  }
  this.world.hidden=this.hud.hidden=!visible;
  const camera=this.camera;camera.computeWorldMatrix();
  const canvas=this.scene.getEngine().getRenderingCanvas(),width=canvas?.clientWidth||this.scene.getEngine().getRenderWidth(),height=canvas?.clientHeight||this.scene.getEngine().getRenderHeight();
  for(const i of this.items){
   const zone=state.zones.find(z=>z.id===i.id)!;
   const snap=i.capturing!==zone.capturing;i.capturing=zone.capturing;
   i.progress=snap?zone.progress:i.progress+(zone.progress-i.progress)*(1-Math.exp(-Math.max(0,dt)*22));
   if(Math.abs(i.progress-zone.progress)<.0002)i.progress=zone.progress;
   this.paint(i.world,zone,i.progress);this.paint(i.hud,zone,i.progress);
   const color=Color3.FromHexString(colors[zone.owner??'neutral']);i.border.color=color;i.material.emissiveColor=color;
   i.ground.setEnabled(visible);i.border.setEnabled(visible);
   const definition=ZONE_MAPS[state.mapId].find(d=>d.id===i.id)!;
   const anchor=Vector3.FromArray(definition.position).addInPlace(new Vector3(0,2.7,0));
   const point=Vector3.Project(anchor,Matrix.IdentityReadOnly,camera.getTransformationMatrix(),camera.viewport.toGlobal(width,height));
   const front=Vector3.Dot(anchor.subtract(camera.globalPosition),camera.getForwardRay().direction)>0;
   const p=markerPosition(point.x,point.y,front,width,height);
   i.world.root.style.left=`${p.x}px`;i.world.root.style.top=`${p.y}px`;i.world.root.dataset.edge=String(p.edge);i.world.root.style.setProperty('--zone-arrow',`${p.angle}rad`);
  }
 }
 private paint(m:ReturnType<typeof marker>,z:ZoneState,progress:number){
  m.root.style.setProperty('--zone-owner',colors[z.owner??'neutral']);m.root.style.setProperty('--zone-ink',z.owner?'#fff':'#18202a');
  m.fill.style.backgroundColor=colors[z.capturing??'neutral'];m.fill.style.height=`${progress*100}%`;
  m.root.dataset.owner=z.owner??'neutral';m.root.dataset.contested=String(z.contested);m.root.dataset.capturing=z.capturing??'';
  m.root.setAttribute('aria-label',`Zone ${z.id}: ${z.owner??'neutral'}${z.contested?', contested':z.capturing?`, ${z.capturing} capturing ${Math.round(progress*100)}%`:''}`);
 }
}
