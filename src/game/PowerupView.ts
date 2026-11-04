import { Color3, Mesh, MeshBuilder, Quaternion, StandardMaterial, Vector3, type Scene } from '@babylonjs/core';
import { POWERUP_STYLE, type Pickup, type PowerupEvent, type PowerupType } from '../../shared/powerups';
import type { Snapshot, ShotResult } from '../../shared/protocol';
import type { RemotePlayers } from './RemotePlayers';

interface Cube { mesh: Mesh; marker: Mesh }
interface ActorEffect { shield: Mesh; flames: Mesh[]; shieldPoints: number; ripple: number }
interface Burst { mesh: Mesh; velocity: Vector3; age: number; duration: number }
/** Original, shared low-poly cosmetics. No rigid bodies, lights, networked
 * transforms or wall-visible outlines; every mesh uses ordinary world depth. */
export class PowerupView {
  private readonly materials = new Map<PowerupType, StandardMaterial>();
  private readonly cubes = new Map<string,Cube>();
  private readonly actors = new Map<string,ActorEffect>();
  private readonly bursts: Burst[]=[];
  private readonly source: Mesh;
  private round=-1;
  constructor(private readonly scene: Scene) {
    for(const type of ['giant','doubleJump','fire','shield'] as const) {
      const m=new StandardMaterial(`powerup:${type}`,scene),c=Color3.FromHexString(POWERUP_STYLE[type].color);
      m.diffuseColor=c;m.emissiveColor=c.scale(.35);m.specularColor=c.scale(.3);
      this.materials.set(type,m);
    }
    this.source=MeshBuilder.CreateBox('powerup-template',{size:.4},scene);this.source.setEnabled(false);this.source.isPickable=false;
  }
  private cube(p:Pickup):Cube {
    const mesh=this.source.clone(`pickup:${p.id}`,null)!;mesh.setEnabled(true);mesh.material=this.materials.get(p.type)!;mesh.isPickable=false;
    const marker=MeshBuilder.CreateTorus(`pickup-ground:${p.id}`,{diameter:.62,thickness:.025,tessellation:16},this.scene);
    marker.material=mesh.material;marker.position.set(p.position.x,p.position.y+.035,p.position.z);marker.isPickable=false;
    return {mesh,marker};
  }
  update(snapshot:Snapshot|null,serverNow:number,dt:number,remote:RemotePlayers,visible:boolean):void {
    if(!snapshot || snapshot.roundId!==this.round || !visible){this.clear();this.round=snapshot?.roundId??-1;if(!visible||!snapshot)return;}
    const pickups=snapshot.pickups??[], ids=new Set(pickups.map(p=>p.id));
    for(const [id,c] of this.cubes)if(!ids.has(id)){c.mesh.dispose();c.marker.dispose();this.cubes.delete(id);}
    for(const p of pickups){let c=this.cubes.get(p.id);if(!c){c=this.cube(p);this.cubes.set(p.id,c);}
      const t=serverNow/1000,phase=p.position.x*.31+p.position.z*.27;
      c.mesh.position.set(p.position.x,p.position.y+.82+Math.sin(t*2+phase)*.09,p.position.z);
      c.mesh.rotation.set(.15, t*.65+phase,.1);}
    const living=new Set(snapshot.players.filter(p=>p.alive&&remote.effectAnchor(p.id)).map(p=>p.id));
    for(const [id,e]of this.actors)if(!living.has(id)){e.shield.material?.dispose();e.shield.dispose();e.flames.forEach(f=>f.dispose());this.actors.delete(id);}
    for(const p of snapshot.players){const anchor=remote.effectAnchor(p.id);if(!p.alive||!anchor)continue;
      const shield=p.powerup?.type==='shield' && p.powerup.expiresAt>serverNow && p.powerup.shield>0;
      const burning=!!p.burn && p.burn.expiresAt>serverNow;
      let e=this.actors.get(p.id);if(!e&&!shield&&!burning)continue;
      if(!e){
        const shell=MeshBuilder.CreateCapsule(`powerup-shield:${p.id}`,{height:1.85,radius:.40,tessellation:12,subdivisions:2},this.scene);
        shell.parent=anchor;shell.position.y=.94;shell.isPickable=false;
        const mat=this.materials.get('shield')!.clone(`shield-shell:${p.id}`)!;mat.alpha=.075;mat.disableDepthWrite=true;shell.material=mat;
        const flames=Array.from({length:5},(_,i)=>{const f=this.source.clone(`burn:${p.id}:${i}`,anchor)!;f.material=this.materials.get('fire')!;f.isPickable=false;return f;});
        e={shield:shell,flames,shieldPoints:p.powerup?.shield??0,ripple:0};this.actors.set(p.id,e);
      }
      if(p.powerup?.type==='shield'&&(p.powerup.shield)<e.shieldPoints)e.ripple=.25;
      e.shieldPoints=p.powerup?.shield??0;e.ripple=Math.max(0,e.ripple-dt);
      e.shield.setEnabled((shield || e.ripple>0) && anchor.isEnabled());
      e.shield.position.y=(1.8-.65*p.motion.crouch)/2;
      e.shield.scaling.y=(1.8-.65*p.motion.crouch)/1.8;
      (e.shield.material as StandardMaterial).alpha=.075+e.ripple*.7;
      for(const [i,f]of e.flames.entries()){
        f.setEnabled(burning && anchor.isEnabled());
        const phase=(serverNow/750+i*.19)%1,angle=i*2.4;
        f.position.set(Math.sin(angle)*.28,.18+phase*(1.8-.65*p.motion.crouch)*.65,Math.cos(angle)*.28);
        f.scaling.set(.22*(1-phase)+.06,.45*(1-phase)+.1,.22*(1-phase)+.06);
        f.rotation.set(0,serverNow/400+i,.3*Math.sin(serverNow/180+i));
      }
    }
    for(let i=this.bursts.length-1;i>=0;i--){const b=this.bursts[i];b.age+=dt;
      if(b.age>=b.duration){b.mesh.dispose();this.bursts.splice(i,1);continue;}
      b.mesh.position.addInPlace(b.velocity.scale(dt));b.mesh.visibility=1-b.age/b.duration;
    }
  }
  event(event:PowerupEvent):void {
    if(event.kind!=='doubleJump')return;
    for(let i=0;i<8;i++) {
      const angle=i*Math.PI/4,mesh=this.source.clone('double-jump-spark',null)!;mesh.setEnabled(true);mesh.isPickable=false;
      mesh.material=this.materials.get('doubleJump')!;mesh.scaling.set(.09,.12,.09);mesh.position.copyFromFloats(event.position.x,event.position.y+.12,event.position.z);
      this.addBurst({mesh,velocity:new Vector3(Math.cos(angle)*.8,-1.2,Math.sin(angle)*.8),age:0,duration:.32});
    }
  }
  shot(shot:ShotResult):void {
    if(!shot.fire)return;
    for(const trace of shot.traces??[]) {
      const from=new Vector3(trace.from.x,trace.from.y,trace.from.z),to=new Vector3(trace.to.x,trace.to.y,trace.to.z),delta=to.subtract(from),length=delta.length();
      if(length<.01)continue;
      const mesh=MeshBuilder.CreateCylinder('fire-tracer',{height:length,diameter:.024,tessellation:5},this.scene);
      mesh.material=this.materials.get('fire')!;mesh.position.copyFrom(from.add(to).scale(.5));mesh.isPickable=false;
      mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),delta.scale(1/length),new Quaternion());
      this.addBurst({mesh,velocity:Vector3.Zero(),age:0,duration:.11});
    }
  }
  private addBurst(b:Burst):void {if(this.bursts.length>=64)this.bursts.shift()!.mesh.dispose();this.bursts.push(b);}
  inspect(){return {pickups:this.cubes.size,actors:this.actors.size,bursts:this.bursts.length,
    cubes:[...this.cubes].map(([id,c])=>({id,position:c.mesh.position.asArray(),rotation:c.mesh.rotation.y})),
    effects:[...this.actors].map(([id,e])=>({id,shield:e.shield.isEnabled(),alpha:e.shield.material?.alpha,
      flames:e.flames.filter(f=>f.isEnabled()).length}))};}
  clear():void {
    for(const c of this.cubes.values()){c.mesh.dispose();c.marker.dispose();}this.cubes.clear();
    for(const e of this.actors.values()){e.shield.material?.dispose();e.shield.dispose();e.flames.forEach(f=>f.dispose());}this.actors.clear();
    this.bursts.splice(0).forEach(b=>b.mesh.dispose());
  }
}
