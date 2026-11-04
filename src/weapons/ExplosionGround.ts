import { Color3, Color4, Mesh, MeshBuilder, Ray, SolidParticleSystem, StandardMaterial, Texture, Vector3, type Scene } from '@babylonjs/core';
import { sweepSphere, type GrenadeExplosion } from '../../shared/grenades';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { assetUrl } from '../core/assets';

/** Bounded cosmetic rocks and surface-projected scorch marks. Never gameplay colliders. */
export class ExplosionGround {
  private readonly rocks: SolidParticleSystem;
  private readonly rockMaterial: StandardMaterial;
  private readonly markMaterial: StandardMaterial;
  private readonly marks: Mesh[] = [];
  private readonly pending: GrenadeExplosion[] = [];
  private readonly motion = Array.from({length:48}, () => ({ at:0, updated:0, live:false, sleeping:false, velocity:Vector3.Zero() }));
  private cursor = 0;
  constructor(private readonly scene: Scene) {
    this.rockMaterial = new StandardMaterial('blast-rocks',scene);
    this.rockMaterial.diffuseColor = new Color3(.25,.23,.21); this.rockMaterial.specularColor = Color3.Black();
    const source = MeshBuilder.CreatePolyhedron('blast-rock-source',{type:1,size:1},scene);
    this.rocks = new SolidParticleSystem('blast-rocks-batch',scene,{updatable:true});
    this.rocks.addShape(source,48); source.dispose();
    const mesh=this.rocks.buildMesh(); mesh.material=this.rockMaterial; mesh.isPickable=false;
    mesh.hasVertexAlpha=true; mesh.alwaysSelectAsActiveMesh=true;
    for(const p of this.rocks.particles){p.scaling.setAll(0);p.color=new Color4(1,1,1,0);} this.rocks.setParticles();
    this.markMaterial=new StandardMaterial('blast-scorch',scene);
    const texture=new Texture(assetUrl('assets/textures/shared/fx/bullet_hole.png'),scene);texture.hasAlpha=true;
    this.markMaterial.diffuseTexture=texture;this.markMaterial.useAlphaFromDiffuseTexture=true;
    this.markMaterial.diffuseColor=new Color3(.16,.14,.12);this.markMaterial.specularColor=Color3.Black();
    this.markMaterial.zOffset=-2;this.markMaterial.backFaceCulling=false;
  }
  explode(e: GrenadeExplosion, now: number, reduced: boolean): void {
    this.pending.push(e); if(this.pending.length>24)this.pending.shift();
    if(now-e.at>300)return;
    let hash=2166136261;for(const c of e.id)hash=Math.imul(hash^c.charCodeAt(0),16777619);
    const phase=(hash>>>0)/4294967296*Math.PI*2;
    for(let i=0;i<(reduced?5:12);i++){
      const index=this.cursor++%48,p=this.rocks.particles[index],m=this.motion[index];
      const angle=phase+i*2.399963,speed=2.5+i%4*.7;
      p.position.set(e.position.x,e.position.y+.1,e.position.z);p.scaling.set(.04+i%3*.014,.025,.035);
      p.color!.a=1;p.rotation.set(phase,i,angle);
      Object.assign(m,{at:e.at,updated:e.at,live:true,sleeping:false});m.velocity.set(Math.cos(angle)*speed,2+i%4*.5,Math.sin(angle)*speed);
    }
  }
  update(now: number, world: CollisionWorld): void {
    for(const e of this.pending.splice(0)){
      // Only scorch a real nearby floor, never a midair explosion's remote ground.
      const hit=world.raycast(e.position.x,e.position.y+.05,e.position.z,0,-1,0,.8,c=>c.solid);
      if(!hit||hit.normal.y<.75)continue;
      const origin=new Vector3(e.position.x,e.position.y+.05,e.position.z);
      const pick=this.scene.pickWithRay(new Ray(origin,new Vector3(0,-1,0),.8),m=>m instanceof Mesh&&m.name.startsWith('batch:')&&m.isEnabled());
      if(!pick?.hit||!pick.pickedPoint||!(pick.pickedMesh instanceof Mesh)||Math.abs(pick.pickedPoint.y-hit.point.y)>.06)continue;
      const mark=MeshBuilder.CreateDecal('blast-scorch',pick.pickedMesh,{position:pick.pickedPoint,normal:new Vector3(hit.normal.x,hit.normal.y,hit.normal.z),size:new Vector3(.35,.35,.1),angle:(e.at%628)/100});
      mark.material=this.markMaterial;mark.isPickable=false;this.marks.push(mark);
      if(this.marks.length>24)this.marks.shift()!.dispose();
    }
    for(let i=0;i<48;i++){
      const m=this.motion[i],p=this.rocks.particles[i];if(!m.live)continue;
      const age=(now-m.at)/1000;
      if(age>=1.8){m.live=false;p.scaling.setAll(0);p.color!.a=0;continue;}
      let left=Math.min(.3,Math.max(0,(now-m.updated)/1000));m.updated=now;
      while(left>1e-6&&!m.sleeping){
        const dt=Math.min(left,1/120);left-=dt;m.velocity.y-=14*dt;
        const delta=m.velocity.scale(dt),hit=sweepSphere(world,p.position,delta,.025);
        p.position.addInPlace(delta.scale(hit?.fraction??1));
        if(hit){
          const n=hit.normal,dot=m.velocity.x*n.x+m.velocity.y*n.y+m.velocity.z*n.z;
          p.position.addInPlaceFromFloats(n.x*.001,n.y*.001,n.z*.001);
          if(dot<0){m.velocity.subtractInPlace(new Vector3(n.x,n.y,n.z).scale(dot*1.3));m.velocity.scaleInPlace(.65);}
          if(n.y>.5&&m.velocity.length()<.7){m.sleeping=true;m.velocity.setAll(0);}
        }
        p.rotation.x+=m.velocity.z*dt*3;p.rotation.z-=m.velocity.x*dt*3;
      }
      p.color!.a=Math.min(1,(1.8-age)/.4);
    }
    this.rocks.mesh.setEnabled(this.motion.some(m=>m.live));this.rocks.setParticles();
  }
  inspect(){return {rocks:this.motion.filter(m=>m.live).length,sleeping:this.motion.filter(m=>m.live&&m.sleeping).length,marks:this.marks.length,budget:48,markArea:.35**2,bulletArea:.11**2};}
  clear():void{this.pending.length=0;for(const m of this.motion)m.live=false;for(const p of this.rocks.particles){p.scaling.setAll(0);p.color!.a=0;}this.rocks.setParticles();this.rocks.mesh.setEnabled(false);this.marks.splice(0).forEach(m=>m.dispose());}
  dispose():void{this.clear();this.rocks.dispose();this.rockMaterial.dispose();this.markMaterial.dispose(false,true);}
}
