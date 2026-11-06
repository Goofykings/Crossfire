import { Color3, Matrix, MeshBuilder, PBRMaterial, Quaternion, Texture, TransformNode, Vector3, type Mesh, type Node, type Observer, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';

/** Rich (Legendary) kill effect: gold coins and banknotes tumble around the gun.
 * Cosmetic only: two thin-instanced meshes, fixed capacity, CPU-integrated for
 * about 1.3 s, no physics or collision, nothing streamed over the network. */
interface Piece { p:Vector3; v:Vector3; axis:Vector3; angle:number; spin:number; age:number; life:number; bill:boolean; phase:number }
const LIFE = 1.35, COINS = 14, BILLS = 7, CAPACITY = 3;

export class MoneyBurst {
  private readonly coin:Mesh; private readonly bill:Mesh;
  private readonly pieces:Piece[]=[];
  private readonly coinMatrices=new Float32Array(COINS*CAPACITY*16);
  private readonly billMatrices=new Float32Array(BILLS*CAPACITY*16);
  private readonly q=new Quaternion(); private readonly m=new Matrix(); private readonly s=new Vector3();
  private readonly up=Vector3.Up(); private readonly scale:number; private readonly pop:number; private readonly observer:Observer<Scene>;
  /** `parent` is the camera for first person (camera-space positions), or null for world space. */
  /** scale: distances/speeds; size: piece size relative to scale (first person reads better a little larger). */
  constructor(private readonly scene:Scene,{parent=null,scale=1,group=0,pop=1,size=1}:{parent?:Node|null;scale?:number;group?:number;pop?:number;size?:number}={}){
    const root=new TransformNode('money-burst',scene);root.parent=parent;
    const gold=new PBRMaterial('money-coin',scene);gold.albedoColor=new Color3(1,.74,.28);gold.metallic=1;gold.roughness=.24;
    // Warm self-glow keeps coins readable in dark corners and distinct from a gold gun.
    gold.emissiveColor=new Color3(.62,.42,.1);
    const paper=new PBRMaterial('money-bill',scene);paper.albedoTexture=new Texture(assetUrl('assets/cosmetics/effects/banknote.jpg'),scene);
    paper.metallic=0;paper.roughness=.8;paper.backFaceCulling=false;paper.twoSidedLighting=true;paper.emissiveColor=new Color3(.12,.16,.1);
    paper.emissiveTexture=paper.albedoTexture;
    this.coin=MeshBuilder.CreateCylinder('money-coin',{diameter:.03*scale*size,height:.0045*scale*size,tessellation:14},scene);
    this.bill=MeshBuilder.CreatePlane('money-bill',{width:.072*scale*size,height:.034*scale*size,sideOrientation:2},scene);
    for(const [mesh,material,buffer] of [[this.coin,gold,this.coinMatrices],[this.bill,paper,this.billMatrices]] as const){
      mesh.material=material;mesh.parent=root;mesh.renderingGroupId=group;mesh.isPickable=false;mesh.receiveShadows=false;
      mesh.thinInstanceSetBuffer('matrix',buffer,16,false);mesh.thinInstanceCount=0;mesh.alwaysSelectAsActiveMesh=true;
    }
    this.scale=scale;this.pop=pop;
    this.observer=scene.onBeforeRenderObservable.add(()=>this.update(Math.min(.05,scene.getEngine().getDeltaTime()/1000)));
  }
  get active():number{return this.pieces.length;}
  /** Burst centred on `at` (world, or camera space when parented to the camera). `up` is
   * the local up axis, so first-person pieces fall down the screen. */
  emit(at:Vector3,up=Vector3.Up()):void{
    // Bounded: drop the oldest burst rather than growing buffers.
    const per=COINS+BILLS;while(this.pieces.length+per>per*CAPACITY)this.pieces.splice(0,per);
    for(let i=0;i<per;i++){
      const bill=i>=COINS,a=Math.random()*Math.PI*2,out=(.35+Math.random()*.55)*this.scale;
      const v=new Vector3(Math.cos(a)*out*this.pop,0,Math.sin(a)*out*this.pop).addInPlace(up.scale((1.1+Math.random()*1.1)*this.scale*this.pop));
      this.pieces.push({p:at.add(new Vector3((Math.random()-.5)*.06,(Math.random()*.05),(Math.random()-.5)*.06).scale(this.scale)),v,
        axis:new Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize(),angle:Math.random()*6,spin:(bill?4:10)+Math.random()*8,
        age:-Math.random()*.12,life:LIFE*(.8+Math.random()*.3),bill,phase:Math.random()*6});
    }
    this.up.copyFrom(up);
  }
  private update(dt:number):void{
    if(!this.pieces.length){if(this.coin.thinInstanceCount||this.bill.thinInstanceCount){this.coin.thinInstanceCount=0;this.bill.thinInstanceCount=0;}return;}
    const g=this.up.scale(-3.6*this.scale);let coins=0,bills=0;
    for(let i=this.pieces.length-1;i>=0;i--){
      const x=this.pieces[i];x.age+=dt;if(x.age>=x.life){this.pieces.splice(i,1);continue;}if(x.age<0)continue;
      if(x.bill){// Paper: strong drag and a side-to-side flutter while it drifts down.
        x.v.scaleInPlace(Math.exp(-3.2*dt));x.v.addInPlace(g.scale(dt*.45));
        x.p.addInPlace(x.v.scale(dt));x.p.x+=Math.sin(x.age*9+x.phase)*.05*this.scale*dt;
      }else{x.v.addInPlace(g.scale(dt));x.v.scaleInPlace(Math.exp(-.6*dt));x.p.addInPlace(x.v.scale(dt));}
      x.angle+=x.spin*dt;
      const fade=Math.min(1,x.age/.08,(x.life-x.age)/.22);this.s.setAll(Math.max(.001,fade));
      Quaternion.RotationAxisToRef(x.axis,x.angle,this.q);Matrix.ComposeToRef(this.s,this.q,x.p,this.m);
      if(x.bill)this.m.copyToArray(this.billMatrices,16*bills++);else this.m.copyToArray(this.coinMatrices,16*coins++);
    }
    this.coin.thinInstanceCount=coins;this.bill.thinInstanceCount=bills;
    this.coin.thinInstanceBufferUpdated('matrix');this.bill.thinInstanceBufferUpdated('matrix');
  }
  meshes():Mesh[]{return [this.coin,this.bill];}
  /** Compile both shaders up front so the first kill never hitches. */
  warm():Promise<void>{return Promise.all([this.coin,this.bill].map(m=>m.material!.forceCompilationAsync(m))).then(()=>{});}
  dispose():void{this.scene.onBeforeRenderObservable.remove(this.observer);const root=this.coin.parent;for(const mesh of [this.coin,this.bill]){mesh.material?.dispose(true,true);mesh.dispose();}(root as TransformNode|null)?.dispose();this.pieces.length=0;}
}
