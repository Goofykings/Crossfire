import type {Vec3} from '../player/PlayerController';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {sweepSphere} from '../../shared/grenades';
/** Client-only three-sphere body. No damage or authoritative movement changes. */
export class DeathMotion {
 readonly center:Vec3;readonly fall:{x:number;z:number};angle=0;time=0;
 private readonly velocity:Vec3;private readonly baseY:number;
 constructor(position:Vec3,direction:Vec3|null,private readonly world:CollisionWorld|null){
  this.baseY=position.y;this.center={x:position.x,y:position.y+.92,z:position.z};
  const n=Math.hypot(direction?.x??0,direction?.z??0),fall=n>.001?{x:direction!.x/n,z:direction!.z/n}:{x:0,z:1};let selected=fall;
  for(const turn of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,Math.PI]){const d={x:fall.x*Math.cos(turn)-fall.z*Math.sin(turn),z:fall.x*Math.sin(turn)+fall.z*Math.cos(turn)};
   if(!world||[-.6,0,.6].every(o=>!world.overlapsCylinder(position.x+d.x*(.4+o),position.z+d.z*(.4+o),.30,position.y+.02,position.y+.63))){selected=d;break;}}
  this.fall=selected;this.velocity={x:selected.x*2.4,y:1.5,z:selected.z*2.4};
 }
 points(center=this.center,angle=this.angle):Vec3[]{return[-.6,0,.6].map(o=>({x:center.x+this.fall.x*Math.sin(angle)*o,y:center.y+Math.cos(angle)*o,z:center.z+this.fall.z*Math.sin(angle)*o}));}
 advance(dt:number){let remaining=Math.min(.25,Math.max(0,dt));while(remaining>1e-8){const step=Math.min(1/120,remaining);remaining-=step;this.time+=step;this.velocity.y-=12*step;
  const angle=(1-Math.exp(-this.time*3.8))*Math.PI*.49,next={x:this.center.x+this.velocity.x*step,y:this.center.y+this.velocity.y*step,z:this.center.z+this.velocity.z*step};
  const old=this.points(),desired=this.points(next,angle);let fraction=1,normal:Vec3|null=null;
  if(this.world)for(let i=0;i<old.length;i++){const a=old[i],b=desired[i],hit=sweepSphere(this.world,a,{x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},.30);if(hit&&hit.fraction<fraction){fraction=Math.max(0,hit.fraction-.001);normal=hit.normal;}}
  else{const floor=this.baseY+.30+.6*Math.cos(angle);if(next.y<floor){next.y=floor;this.velocity.y=0;}}
  this.center.x+=(next.x-this.center.x)*fraction;this.center.y+=(next.y-this.center.y)*fraction;this.center.z+=(next.z-this.center.z)*fraction;this.angle+=(angle-this.angle)*fraction;
  if(normal){const into=this.velocity.x*normal.x+this.velocity.y*normal.y+this.velocity.z*normal.z;if(into<0){this.velocity.x-=into*normal.x;this.velocity.y-=into*normal.y;this.velocity.z-=into*normal.z;}if(normal.y>.5){this.velocity.x*=.93;this.velocity.z*=.93;}}
  const drag=Math.exp(-step*2.3);this.velocity.x*=drag;this.velocity.z*=drag;
 }}
}
