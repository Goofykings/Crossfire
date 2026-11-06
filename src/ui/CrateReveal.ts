import { ArcRotateCamera, Color3, Color4, DirectionalLight, DynamicTexture, Engine, GlowLayer, HemisphericLight, MeshBuilder, ParticleSystem,
  Mesh, PointLight, Scene, StandardMaterial, TransformNode, Vector3, type AssetContainer } from '@babylonjs/core';
import { CATEGORY_NAMES, RARITIES, collection, type CosmeticDefinition, type Rarity } from '../../shared/cosmetics';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { loadCosmeticAsset } from '../rendering/CosmeticAssets';
import { studioEnvironment } from '../rendering/StudioEnvironment';
import { loadContainer } from '../core/loadContainer';
import { assetUrl } from '../core/assets';
import { meshesReady } from '../core/assetReadiness';
import { MoneyBurst } from '../weapons/MoneyBurst';
import { REVEAL, cameraPose, cratePose, heroPose, lidPose, stepSpring, wrapAngle } from './crateTimeline';

/** Saturated light colours for the reveal; the rarity names/colours stay the shared ones. */
export const REVEAL_COLORS:Record<Rarity,string> = { common:'#d6dde8', uncommon:'#39e57a', rare:'#4d8dff', epic:'#ff5a6e', legendary:'#ffc22e' };
const CRATE_MODEL='assets/cosmetics/crate/reward-crate/model.glb';
const LIDS=['lid_nw','lid_ne','lid_sw','lid_se'] as const;
const IDLE_SEAM=new Color3(.09,.24,.42);
type Phase='closed'|'loading'|'waiting'|'opening'|'hero'|'error';
export interface RevealActions {
  /** Server draw; resolves with the granted item. Rejections show in the overlay. */
  open(signal:AbortSignal):Promise<CosmeticDefinition>;
  equip(item:CosmeticDefinition):Promise<void>;
  isEquipped(item:CosmeticDefinition):boolean;
  canOpenAgain():boolean;
  onClose():void;
}
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};

function spriteTexture(scene:Scene,name:string,draw:(g:CanvasRenderingContext2D,w:number,h:number)=>void,w=64,h=64):DynamicTexture{
  const t=new DynamicTexture(name,{width:w,height:h},scene,true);const g=t.getContext() as CanvasRenderingContext2D;g.clearRect(0,0,w,h);draw(g,w,h);t.hasAlpha=true;t.update();return t;
}
function additive(scene:Scene,name:string,texture:DynamicTexture):StandardMaterial{
  // Colour comes from emissiveColor (rarity); the texture is only the soft alpha shape.
  // (A StandardMaterial emissiveTexture is ADDED to emissiveColor and would wash it white.)
  const m=new StandardMaterial(name,scene);m.disableLighting=true;m.emissiveColor=Color3.White();m.opacityTexture=texture;m.alphaMode=Engine.ALPHA_ADD;
  m.backFaceCulling=false;m.disableDepthWrite=true;return m;
}

/** Full-screen crate opening: closed crate, anticipation, rarity-coloured burst, the reward
 * shooting up, then a draggable hero preview that springs back to its hero angle.
 * Only presents a result the server already granted; one engine, disposed on close. */
export class CrateReveal {
  readonly element=node('div','crate-reveal');
  private readonly canvas=node('canvas');private readonly title=node('h1');private readonly rarity=node('p','reveal-rarity');
  private readonly weapon=node('p','reveal-weapon');private readonly status=node('p','reveal-status');
  private readonly equipButton=node('button','btn primary','EQUIP');private readonly againButton=node('button','btn','OPEN ANOTHER');
  private readonly closeButton=node('button','btn','CONTINUE');private readonly skipButton=node('button','btn reveal-skip','SKIP');
  private engine:Engine|null=null;private scene:Scene|null=null;private abort:AbortController|null=null;
  private actions:RevealActions|null=null;private item:CosmeticDefinition|null=null;private phase:Phase='closed';
  private t=0;private intro=0;private time=0;private motion=1;private timeScale=1;
  private crate:TransformNode|null=null;private lids:{mesh:TransformNode;rest:Vector3;seed:number}[]=[];
  private seam:StandardMaterial|null=null;private core:StandardMaterial|null=null;
  private tilt:TransformNode|null=null;private spin:TransformNode|null=null;private holder:TransformNode|null=null;
  private weaponContainer:AssetContainer|null=null;private heroRadius=2.2;
  private camera:ArcRotateCamera|null=null;private glow:GlowLayer|null=null;private rim:PointLight|null=null;private glowLight:PointLight|null=null;
  private leaks:Mesh[]=[];private column:Mesh|null=null;private rays:Mesh|null=null;
  private sparks:ParticleSystem|null=null;private burst:ParticleSystem|null=null;private motes:ParticleSystem|null=null;
  private money:MoneyBurst|null=null;private burstFired=false;private moneyAt=0;
  private drag={active:false,x:0,y:0,lastX:0,lastY:0,at:0};private yaw={x:0,v:0};private pitch={x:0,v:0};
  private color=Color3.White();private readonly resize=()=>this.fit();private paused=false;

  constructor(){
    const e=this.element;e.hidden=true;e.tabIndex=-1;e.setAttribute('role','dialog');e.setAttribute('aria-modal','true');this.title.id='reveal-name';e.setAttribute('aria-labelledby','reveal-name');
    const header=node('header','reveal-title');header.append(node('p','reveal-kicker','NEW SKIN UNLOCKED'),this.title,this.rarity,this.weapon);
    const footer=node('footer','reveal-controls');for(const b of [this.equipButton,this.againButton,this.closeButton,this.skipButton])b.type='button';
    footer.append(this.equipButton,this.againButton,this.closeButton);this.status.setAttribute('role','status');
    this.canvas.setAttribute('aria-label','Crate reward 3D preview. Drag to rotate.');this.canvas.tabIndex=-1;
    e.append(node('div','reveal-bg'),node('div','reveal-rarity-bg'),node('div','reveal-flash'),this.canvas,header,this.status,node('p','reveal-hint','DRAG TO ROTATE'),footer,this.skipButton);
    this.equipButton.onclick=()=>void this.equip();this.againButton.onclick=()=>{if(this.actions?.canOpenAgain())void this.start(this.actions);};
    this.closeButton.onclick=()=>this.finish();this.skipButton.onclick=()=>this.skip();
    e.addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.stopPropagation();if(this.phase==='opening')this.skip();else if(this.phase!=='loading'&&this.phase!=='waiting')this.finish();}});
    this.canvas.addEventListener('pointerdown',ev=>{if(this.phase!=='hero')return;this.canvas.setPointerCapture(ev.pointerId);this.drag={active:true,x:ev.clientX,y:ev.clientY,lastX:ev.clientX,lastY:ev.clientY,at:performance.now()};this.yaw.v=this.pitch.v=0;e.classList.add('dragging');});
    this.canvas.addEventListener('pointermove',ev=>{if(!this.drag.active)return;const dx=ev.clientX-this.drag.lastX,dy=ev.clientY-this.drag.lastY,now=performance.now(),dt=Math.max(.008,(now-this.drag.at)/1000);
      this.yaw.x+=dx*.011;this.pitch.x=Math.max(-.75,Math.min(.75,this.pitch.x+dy*.007));this.yaw.v=dx*.011/dt;this.pitch.v=dy*.007/dt;this.drag.lastX=ev.clientX;this.drag.lastY=ev.clientY;this.drag.at=now;});
    const release=()=>{if(!this.drag.active)return;this.drag.active=false;e.classList.remove('dragging');
      // Keep a little of the flick, then spring back the short way to the hero angle.
      this.yaw.x=wrapAngle(this.yaw.x);this.yaw.v=Math.max(-6,Math.min(6,this.yaw.v*.35));this.pitch.v=Math.max(-4,Math.min(4,this.pitch.v*.35));};
    this.canvas.addEventListener('pointerup',release);this.canvas.addEventListener('pointercancel',release);this.canvas.addEventListener('lostpointercapture',release);
    document.body.append(e);
  }

  /** Opens the overlay with a closed crate and asks the server for the reward. */
  async start(actions:RevealActions):Promise<void>{
    this.reset();this.actions=actions;const abort=new AbortController();this.abort=abort;const {signal}=abort;
    this.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?0:1;this.timeScale=this.motion?1:1.6;
    const e=this.element;e.hidden=false;e.className='crate-reveal';e.dataset.phase=this.phase='loading';this.status.textContent='';this.setControls(false);
    e.style.setProperty('--reveal','#5c7cff');requestAnimationFrame(()=>e.classList.add('visible'));e.focus({preventScroll:true});
    try{
      await this.buildScene(signal);
      this.phase='waiting';e.dataset.phase='waiting';
      const item=await actions.open(signal);signal.throwIfAborted();this.item=item;
      this.color=Color3.FromHexString(REVEAL_COLORS[item.rarity]);e.style.setProperty('--reveal',REVEAL_COLORS[item.rarity]);e.style.setProperty('--rarity',RARITIES[item.rarity].color);
      e.dataset.rarity=item.rarity;this.title.textContent=item.name;this.rarity.textContent=RARITIES[item.rarity].name.toUpperCase();
      this.weapon.textContent=CATEGORY_NAMES[item.weapon];await this.loadReward(item,signal);
      // Let the drop-in land before the shake so the beats never overlap.
      while(this.intro<.75&&!signal.aborted)await new Promise(r=>setTimeout(r,30));signal.throwIfAborted();
      this.t=0;this.phase='opening';e.dataset.phase='opening';this.skipButton.hidden=false;
    }catch(error){
      if(signal.aborted)return;this.phase='error';e.dataset.phase='error';this.skipButton.hidden=true;
      // The server may already have granted the item; say so rather than implying a lost purchase.
      this.status.textContent=this.item?`${this.item.name} (${CATEGORY_NAMES[this.item.weapon]}) is unlocked in your Locker. Preview unavailable: ${(error as Error).message}`:(error as Error).message;
      this.closeButton.hidden=false;this.closeButton.textContent='BACK';this.closeButton.focus();
    }
  }
  close():void{this.reset();this.element.hidden=true;this.element.classList.remove('visible');this.phase='closed';this.actions=null;}
  private finish():void{const actions=this.actions;this.close();actions?.onClose();}
  private skip():void{if(this.phase==='opening'&&this.t<REVEAL.burst+REVEAL.controls)this.t=Math.max(this.t,REVEAL.burst+.9);}

  private reset():void{
    this.abort?.abort();this.abort=null;window.removeEventListener('resize',this.resize);this.engine?.stopRenderLoop();
    this.money?.dispose();this.money=null;this.weaponContainer=null;this.scene?.dispose();this.scene=null;this.engine?.dispose();this.engine=null;
    this.crate=this.tilt=this.spin=this.holder=null;this.lids=[];this.leaks=[];this.column=this.rays=null;this.sparks=this.burst=this.motes=null;this.camera=null;this.glow=null;
    this.item=null;this.t=this.intro=this.time=0;this.burstFired=false;this.moneyAt=0;this.yaw={x:0,v:0};this.pitch={x:0,v:0};this.drag.active=false;
  }
  private setControls(show:boolean):void{
    this.equipButton.hidden=this.againButton.hidden=this.closeButton.hidden=!show;this.skipButton.hidden=true;if(!show)return;
    this.closeButton.textContent='CONTINUE';this.updateEquip();this.againButton.disabled=!this.actions?.canOpenAgain();
    this.againButton.title=this.againButton.disabled?'Not enough gems or every crate item is owned':'';
  }
  private updateEquip(pending=false):void{const equipped=!!this.item&&!!this.actions?.isEquipped(this.item);this.equipButton.textContent=pending?'SAVING...':equipped?'EQUIPPED':'EQUIP';this.equipButton.disabled=pending||equipped;}
  private async equip():Promise<void>{
    const item=this.item;if(!item||!this.actions)return;this.updateEquip(true);this.status.textContent='';
    try{await this.actions.equip(item);}catch(error){this.status.textContent=(error as Error).message;}finally{if(this.item===item)this.updateEquip();}
  }

  private async buildScene(signal:AbortSignal):Promise<void>{
    const engine=new Engine(this.canvas,true,{preserveDrawingBuffer:true,stencil:true,alpha:true});this.engine=engine;
    engine.setHardwareScalingLevel(Math.max(1,devicePixelRatio/1.5));
    const scene=new Scene(engine);this.scene=scene;scene.useRightHandedSystem=true;scene.clearColor=new Color4(0,0,0,0);
    scene.imageProcessingConfiguration.exposure=1.1;scene.imageProcessingConfiguration.toneMappingEnabled=true;scene.imageProcessingConfiguration.toneMappingType=1;
    const camera=new ArcRotateCamera('reveal-camera',-Math.PI/2,1.17,2.9,new Vector3(0,REVEAL.crateTargetY,0),scene);camera.fov=.62;camera.minZ=.02;this.camera=camera;
    const fill=new HemisphericLight('reveal-fill',new Vector3(0,1,-.3),scene);fill.intensity=.55;fill.groundColor=new Color3(.12,.13,.18);
    const key=new DirectionalLight('reveal-key',new Vector3(-.55,-.85,.65),scene);key.intensity=2.4;
    this.rim=new PointLight('reveal-rim',new Vector3(0,2.3,1.5),scene);this.rim.intensity=0;
    this.glowLight=new PointLight('reveal-core',new Vector3(0,.75,0),scene);this.glowLight.intensity=0;this.glowLight.range=4;
    const glow=new GlowLayer('reveal-glow',scene,{mainTextureSamples:2,blurKernelSize:56});glow.intensity=1.05;this.glow=glow;
    const [crate]=await Promise.all([loadContainer(assetUrl(CRATE_MODEL),scene,signal),studioEnvironment(scene,.9,signal)]);
    crate.addAllToScene();const root=new TransformNode('reveal-crate',scene);this.crate=root;for(const n of crate.rootNodes)n.parent=root;
    root.rotation.y=-.42;
    const find=(name:string)=>crate.meshes.find(m=>m.name===name);
    this.seam=new StandardMaterial('reveal-seam',scene);this.seam.disableLighting=true;this.core=new StandardMaterial('reveal-core',scene);this.core.disableLighting=true;
    for(const [name,mat] of [['seam_glow',this.seam],['core_glow',this.core]] as const){const m=find(name);if(!m)throw Error(`Crate model is missing ${name}`);m.material=mat;}
    // Multi-material quarters import as a transform node with primitive children.
    this.lids=LIDS.map((name,i)=>{const mesh=find(name)??crate.transformNodes.find(n=>n.name===name);if(!mesh)throw Error(`Crate model is missing ${name}`);return {mesh,rest:mesh.position.clone(),seed:i+1};});
    // Light leaking out of the seams: thin additive shafts fanning out of the crate top.
    const beam=spriteTexture(scene,'reveal-beam',(g,w,h)=>{const grad=g.createLinearGradient(0,h,0,0);grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.35,'rgba(255,255,255,.55)');grad.addColorStop(1,'rgba(255,255,255,0)');
      const side=g.createLinearGradient(0,0,w,0);side.addColorStop(0,'rgba(0,0,0,1)');side.addColorStop(.5,'rgba(0,0,0,0)');side.addColorStop(1,'rgba(0,0,0,1)');g.fillStyle=grad;g.fillRect(0,0,w,h);g.globalCompositeOperation='destination-out';g.fillStyle=side;g.fillRect(0,0,w,h);},64,256);
    const leakMat=additive(scene,'reveal-leak',beam);
    for(let i=0;i<7;i++){const shaft=MeshBuilder.CreatePlane('reveal-leak-'+i,{width:.16+.1*(i%3),height:1.6},scene);shaft.material=leakMat;shaft.parent=root;
      shaft.setPivotPoint(new Vector3(0,-.8,0));shaft.position.set((i/6-.5)*.8,.78+.8,((i*37)%7/7-.5)*.5);shaft.rotation.set(0,i*.9,(i/6-.5)*.9);shaft.isPickable=false;this.leaks.push(shaft);}
    // A Y-billboard plane, not a cylinder: the beam texture's side fade then softens both
    // silhouette edges (on a cylinder the fade ran around it and the edges stayed hard).
    this.column=MeshBuilder.CreatePlane('reveal-column',{width:1.15,height:6},scene);this.column.billboardMode=Mesh.BILLBOARDMODE_Y;
    this.column.material=additive(scene,'reveal-column',beam);this.column.setPivotPoint(new Vector3(0,-3,0));this.column.position.y=.6+3;this.column.isPickable=false;
    const rays=spriteTexture(scene,'reveal-rays',(g,w)=>{const c=w/2;for(let i=0;i<18;i++){const a=i/18*Math.PI*2,d=.07+.05*(i%2);g.beginPath();g.moveTo(c,c);g.arc(c,c,c,a-d,a+d);g.closePath();
      const grad=g.createRadialGradient(c,c,0,c,c,c);grad.addColorStop(0,'rgba(255,255,255,.9)');grad.addColorStop(.25,'rgba(255,255,255,.45)');grad.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=grad;g.fill();}},512,512);
    this.rays=MeshBuilder.CreatePlane('reveal-rays',{size:5.2},scene);this.rays.material=additive(scene,'reveal-rays',rays);this.rays.position.set(0,REVEAL.heroY,1.4);this.rays.isPickable=false;
    const dot=spriteTexture(scene,'reveal-spark',(g,w)=>{const grad=g.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2);grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.3,'rgba(255,255,255,.8)');grad.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=grad;g.fillRect(0,0,w,w);});
    const particles=(name:string,capacity:number)=>{const p=new ParticleSystem(name,capacity,scene);p.particleTexture=dot;p.blendMode=ParticleSystem.BLENDMODE_ADD;p.updateSpeed=1/60;return p;};
    this.sparks=particles('reveal-sparks',220);Object.assign(this.sparks,{emitter:new Vector3(0,.5,0),minEmitBox:new Vector3(-.45,0,-.33),maxEmitBox:new Vector3(.45,.02,.33),
      direction1:new Vector3(-.8,2.2,-.8),direction2:new Vector3(.8,3.4,.8),minEmitPower:.5,maxEmitPower:1.1,minLifeTime:.35,maxLifeTime:.75,minSize:.012,maxSize:.035,gravity:new Vector3(0,-4,0),emitRate:0});
    this.burst=particles('reveal-burst',420);Object.assign(this.burst,{emitter:new Vector3(0,.62,0),minEmitBox:new Vector3(-.3,0,-.2),maxEmitBox:new Vector3(.3,.05,.2),
      direction1:new Vector3(-2.2,3.5,-2.2),direction2:new Vector3(2.2,7,2.2),minEmitPower:.7,maxEmitPower:1.35,minLifeTime:.55,maxLifeTime:1.35,minSize:.02,maxSize:.07,gravity:new Vector3(0,-6.5,0),emitRate:0,manualEmitCount:0});
    this.motes=particles('reveal-motes',160);Object.assign(this.motes,{emitter:new Vector3(0,REVEAL.heroY,0),minEmitBox:new Vector3(-1.1,-.9,-.4),maxEmitBox:new Vector3(1.1,.2,.6),
      direction1:new Vector3(-.05,.25,0),direction2:new Vector3(.05,.55,0),minEmitPower:.4,maxEmitPower:.8,minLifeTime:1.6,maxLifeTime:3,minSize:.01,maxSize:.03,emitRate:0});
    for(const p of [this.sparks,this.burst,this.motes])p.start();
    // Shafts/column/rays are already soft additive light; blooming them again washes out the shot.
    for(const m of [...this.leaks,this.column,this.rays])glow.addExcludedMesh(m);
    this.tilt=new TransformNode('reveal-tilt',scene);this.spin=new TransformNode('reveal-spin',scene);this.spin.parent=this.tilt;this.holder=new TransformNode('reveal-holder',scene);this.holder.parent=this.spin;
    this.tilt.setEnabled(false);this.paint(0);
    await meshesReady(crate.meshes,signal);signal.throwIfAborted();
    this.fit();window.addEventListener('resize',this.resize);
    engine.runRenderLoop(()=>{if(document.hidden)return;const dt=Math.min(.05,engine.getDeltaTime()/1000);this.frame(dt);scene.render();});
  }
  private async loadReward(item:CosmeticDefinition,signal:AbortSignal):Promise<void>{
    const scene=this.scene!,materials=new MaterialLibrary(scene);await materials.load(undefined,signal);
    const c=await loadCosmeticAsset(item,scene,materials,signal);this.weaponContainer=c;c.addAllToScene();
    for(const n of c.rootNodes)n.parent=this.holder;for(const m of c.meshes){m.computeWorldMatrix(true);m.isPickable=false;}
    // Normalize every category to the same on-screen size, pivoting about the bounds centre.
    const b=this.holder!.getHierarchyBoundingVectors(true),size=b.max.subtract(b.min),scale=1/Math.max(size.x,size.y,size.z);
    for(const n of c.rootNodes)(n as TransformNode).position?.subtractInPlace(b.min.add(b.max).scale(.5));this.holder!.scaling.setAll(scale);
    await meshesReady(c.meshes,signal);
    if(collection(item.collection)?.killEffect==='money')this.money=new MoneyBurst(scene,{scale:2.4});
    this.fit();
  }
  private fit():void{
    const engine=this.engine,camera=this.camera;if(!engine||!camera)return;engine.resize();
    // The normalized reward is 1 m long: keep it ~60% of the width, or ~42% of the height on tall screens.
    const aspect=engine.getAspectRatio(camera),half=Math.tan(camera.fov/2);
    this.heroRadius=Math.max(1/(.56*2*half*aspect),1/(.84*2*half),1.6);
  }
  private paint(seam:number,core=seam*.6):void{
    // Closed, the seams idle in a dim neutral ice blue (black read as a hole under the lid);
    // charging crossfades them to the rarity colour, so nothing is spoiled before the pop.
    const c=this.color,k=Math.min(Math.max(seam,0),1),idle=this.burstFired?0:1-k;
    this.seam?.emissiveColor.copyFrom(IDLE_SEAM.scale(idle).add(c.scale(k)).add(new Color3(1,1,1).scale(Math.max(0,Math.min(seam-1,1))*.35)));
    this.core?.emissiveColor.copyFrom(c.scale(Math.min(core,1.4)));
  }

  private frame(dt:number):void{
    const e=this.element,camera=this.camera!,crate=this.crate!;this.time+=dt;
    if(this.phase==='loading'||this.phase==='waiting'||this.phase==='error'){
      // Drop in with a landing squash, then breathe while the server answers.
      this.intro+=dt;const k=Math.min(1,this.intro/.36),land=this.intro-.36;
      crate.position.y=(1-k*k)*1.4;const sq=land>0?.14*Math.exp(-6*land)*Math.cos(15*land):0;
      crate.scaling.set(1+sq*.5,1-sq+.012*Math.sin(this.time*3)*this.motion,1+sq*.5);crate.rotation.y=-.42+Math.sin(this.time*.8)*.1*this.motion;
      if(this.phase==='waiting'&&this.intro>.9)crate.rotation.z=Math.sin(this.time*30)*.006*this.motion;
      camera.target.y=REVEAL.crateTargetY;camera.beta=1.17;camera.radius=2.9;return;
    }
    if(this.phase!=='opening'&&this.phase!=='hero')return;
    if(this.paused)dt=0;this.t+=dt*(this.t<REVEAL.burst?this.timeScale:1);const t=this.t;
    const pose=cratePose(t,this.motion);
    crate.position.y=pose.crateY;crate.scaling.set(pose.squashXZ,pose.squashY,pose.squashXZ);crate.rotation.set(pose.tiltX,-.42+(t<REVEAL.burst?Math.sin(this.time*.8)*.1*this.motion:0),pose.tiltZ);
    this.paint(pose.seam,pose.core);
    // Full bloom sells the flash; ease it off once the reward is up so the hero stays crisp.
    this.glow!.intensity=1.05-.45*Math.min(1,Math.max(0,(t-REVEAL.burst-.3)/.8));this.glowLight!.diffuse=this.color;this.glowLight!.intensity=pose.core*1.6;
    for(const l of this.lids){const p=lidPose(t,l.rest.x,l.rest.z,l.seed,this.motion);l.mesh.position.set(l.rest.x+p.x,l.rest.y+p.y,l.rest.z+p.z);
      // Tip outward about the horizontal axis perpendicular to its flight, plus a little twist.
      const len=Math.hypot(l.rest.x,l.rest.z)||1;l.mesh.rotationQuaternion=null;l.mesh.rotation.set(l.rest.z/len*p.angle,p.spin,-l.rest.x/len*p.angle);l.mesh.setEnabled(p.visible);}
    // Shafts widen as pressure builds, so the light visibly forces its way out of the seams.
    const pressure=Math.min(1,Math.max(0,(t-REVEAL.pop)/(REVEAL.burst-REVEAL.pop)));
    for(const [i,s] of this.leaks.entries()){s.visibility=pose.leak*(.6+.4*Math.sin(this.time*9+i*1.7));s.scaling.y=.6+pose.leak*.75;s.scaling.x=.75+1.1*pressure*pressure;s.setEnabled(pose.leak>.01);
      (s.material as StandardMaterial).emissiveColor=this.color;}
    this.column!.visibility=pose.column;this.column!.setEnabled(pose.column>.01);this.column!.scaling.set(1-.55*Math.max(0,t-REVEAL.burst),pose.column,1-.55*Math.max(0,t-REVEAL.burst));(this.column!.material as StandardMaterial).emissiveColor=this.color.scale(.75);
    this.sparks!.emitRate=t>REVEAL.pop&&t<REVEAL.burst?60+260*((t-REVEAL.pop)/(REVEAL.burst-REVEAL.pop))**2:0;
    for(const p of [this.sparks!,this.burst!,this.motes!]){p.color1=new Color4(this.color.r,this.color.g,this.color.b,1);p.color2=new Color4(1,1,1,1);p.colorDead=new Color4(this.color.r,this.color.g,this.color.b,0);}
    if(!this.burstFired&&t>=REVEAL.burst){
      this.burstFired=true;this.burst!.manualEmitCount=this.motion?380:120;e.classList.add('burst');e.dataset.phase='burst';
      this.tilt!.setEnabled(true);if(this.money)this.moneyAt=REVEAL.burst+.5;
    }
    if(this.money&&this.moneyAt&&t>=this.moneyAt){this.moneyAt=0;this.money.emit(new Vector3(0,REVEAL.heroY+.35,0));}// Legendary: the Rich effect rains on the reveal too.
    const hero=heroPose(t),cam=cameraPose(t);
    // Frame the reward a little below centre so the title above it never overlaps.
    camera.target.y=cam.targetY+.1*cam.zoom;camera.beta=cam.beta;camera.radius=2.9+(this.heroRadius-2.9)*cam.zoom;
    this.rim!.diffuse=this.color;this.rim!.intensity=cam.zoom*3.2;
    this.rays!.visibility=cam.zoom*.32;e.classList.toggle('charging',t>=REVEAL.pop);this.rays!.rotation.z=this.time*.12;(this.rays!.material as StandardMaterial).emissiveColor=this.color;
    this.motes!.emitRate=t>REVEAL.burst+.4?24:0;
    if(hero.visible){
      if(!this.drag.active){stepSpring(this.yaw,dt);stepSpring(this.pitch,dt);}
      const bob=t>REVEAL.burst+REVEAL.rise?Math.sin(this.time*2)*.022*this.motion:0,sway=Math.sin(this.time*.7)*.05*this.motion;
      this.tilt!.position.y=hero.y+bob;this.tilt!.rotation.x=-(REVEAL.heroPitch+this.pitch.x);this.tilt!.scaling.setAll(hero.scale);
      this.spin!.rotation.y=REVEAL.heroYaw+hero.spin+this.yaw.x+sway;this.spin!.rotation.z=-.08;
    }
    if(this.phase==='opening'&&t>=REVEAL.burst+REVEAL.title){this.phase='hero';e.dataset.phase='hero';}
    if(this.phase==='hero'&&this.equipButton.hidden&&t>=REVEAL.burst+REVEAL.controls){this.setControls(true);(this.equipButton.disabled?this.closeButton:this.equipButton).focus();}
  }
  /** Test hook: freeze the timeline and/or jump to a time (seconds since anticipation). */
  debug(paused:boolean,seek?:number):void{this.paused=paused;if(seek!==undefined&&(this.phase==='opening'||this.phase==='hero'))this.t=seek;}
  /** Test/diagnostic view of the actual scene state. */
  inspect(){
    const s=this.spin,tilt=this.tilt;return {phase:this.phase,t:this.t,item:this.item?.id??null,rarity:this.item?.rarity??null,
      background:getComputedStyle(this.element).getPropertyValue('--reveal').trim(),seam:this.seam?.emissiveColor.clone().clampToRef(0,1,new Color3()).toHexString()??null,
      lids:this.lids.map(l=>({name:l.mesh.name,y:+l.mesh.position.y.toFixed(3),dx:+(l.mesh.position.x-l.rest.x).toFixed(3),visible:l.mesh.isEnabled()})),
      hero:tilt&&s?{enabled:tilt.isEnabled(),y:+tilt.position.y.toFixed(3),yaw:+s.rotation.y.toFixed(3),pitch:+tilt.rotation.x.toFixed(3),offset:+this.yaw.x.toFixed(3),scale:+tilt.scaling.x.toFixed(3)}:null,
      camera:this.camera?{beta:+this.camera.beta.toFixed(3),targetY:+this.camera.target.y.toFixed(3),radius:+this.camera.radius.toFixed(3)}:null,
      money:this.money?.active??0,meshes:this.weaponContainer?.meshes.filter(m=>m.getTotalVertices()>0).length??0,
      fps:this.engine?.getFps()??0,drawCalls:this.scene?.getActiveMeshes().length??0};
  }
}
