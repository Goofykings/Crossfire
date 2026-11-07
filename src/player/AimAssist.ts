import type {Vec3} from './PlayerController';
const DEG=Math.PI/180,wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
/** Voluntary-input correction only: no aim, spread, damage or hit authority here. */
export const AIM_ASSIST=Object.freeze({cone:2.5*DEG,range:35,minRange:2,strength:.12,response:6,maxRate:1*DEG,
 maxCorrection:.25*DEG,windowMs:180,rearmMs:100,minInputRate:.4*DEG,maxInputRate:180*DEG,motionRate:4*DEG,motionSpeed:.35,trackingRatio:.6});
export interface AimTarget{id:string;point:Vec3;velocity:Vec3;grounded:boolean;sliding:boolean}
interface AimInput{enabled:boolean;now:number;dt:number;yaw:number;pitch:number;inputYaw:number;inputPitch:number;eye:Vec3;
 targets:AimTarget[];canSee:(target:AimTarget)=>boolean;firing:boolean;recoiling:boolean}
const angles=(eye:Vec3,p:Vec3)=>{const x=p.x-eye.x,y=p.y-eye.y,z=p.z-eye.z;return {yaw:Math.atan2(-x,-z),pitch:Math.atan2(y,Math.hypot(x,z)),distance:Math.hypot(x,y,z)};};
export class AimAssist {
 private target:string|null=null;private started=0;private total=0;private lastInput=-Infinity;private blockedUntil=0;private velocity:Vec3|null=null;
 reset(){this.target=null;this.total=0;this.velocity=null;this.lastInput=-Infinity;}
 suppress(now:number){this.blockedUntil=Math.max(this.blockedUntil,now+350);}
 step(i:AimInput):{yaw:number;pitch:number}{
  const zero={yaw:0,pitch:0},dt=Math.max(.0001,Math.min(.1,i.dt)),input=Math.hypot(i.inputYaw,i.inputPitch),rate=input/dt;
  if(!i.enabled){this.reset();return zero;}
  if(i.now-this.lastInput>AIM_ASSIST.rearmMs){this.target=null;this.total=0;this.velocity=null;}
  if(rate<AIM_ASSIST.minInputRate)return zero;this.lastInput=i.now;
  if(i.firing){this.suppress(i.now);return zero;}
  if(i.recoiling||i.now<this.blockedUntil||rate>AIM_ASSIST.maxInputRate)return zero;
  const candidates=i.targets.map(t=>({t,a:angles(i.eye,t.point)})).map(v=>({...v,yaw:wrap(v.a.yaw-i.yaw),pitch:v.a.pitch-i.pitch}))
   .filter(v=>v.a.distance>=AIM_ASSIST.minRange&&v.a.distance<=AIM_ASSIST.range&&Math.hypot(v.yaw,v.pitch)<=AIM_ASSIST.cone).sort((a,b)=>Math.hypot(a.yaw,a.pitch)-Math.hypot(b.yaw,b.pitch));
  // Retain the chosen identity until a new manual aiming gesture. Losing LOS,
  // moving outside the cone or expiry must not select a different nearby enemy.
  const v=this.target?candidates.find(v=>v.t.id===this.target):candidates[0];if(!v)return zero;
  if(!this.target){this.target=v.t.id;this.started=i.now;this.total=0;}
  if(i.now-this.started>AIM_ASSIST.windowMs||this.total>=AIM_ASSIST.maxCorrection)return zero;
  const error=Math.hypot(v.yaw,v.pitch);if(error<.00001||i.inputYaw*v.yaw+i.inputPitch*v.pitch<input*error*.8||i.inputYaw*v.yaw<-.00000001||i.inputPitch*v.pitch<-.00000001)return zero;
  if(!v.t.grounded||v.t.sliding||!i.canSee(v.t))return zero;
  const speed=Math.hypot(v.t.velocity.x,v.t.velocity.y,v.t.velocity.z),next=angles(i.eye,{x:v.t.point.x+v.t.velocity.x*dt,y:v.t.point.y+v.t.velocity.y*dt,z:v.t.point.z+v.t.velocity.z*dt});
  const my=wrap(next.yaw-v.a.yaw)/dt,mp=(next.pitch-v.a.pitch)/dt,motion=Math.hypot(my,mp);
  const changed=this.velocity&&speed>.35&&(this.velocity.x*v.t.velocity.x+this.velocity.y*v.t.velocity.y+this.velocity.z*v.t.velocity.z)<0;
  this.velocity={...v.t.velocity};
  if(changed||((motion>AIM_ASSIST.motionRate||speed>AIM_ASSIST.motionSpeed)&&(rate<motion*AIM_ASSIST.trackingRatio||i.inputYaw*my+i.inputPitch*mp<input*motion*.7)))return zero;
  const proximity=.25+.75*(1-error/AIM_ASSIST.cone);
  const amount=Math.min(error*(1-Math.exp(-AIM_ASSIST.response*dt))*proximity,input*AIM_ASSIST.strength*proximity,AIM_ASSIST.maxRate*dt,AIM_ASSIST.maxCorrection-this.total);
  this.total+=amount;return {yaw:v.yaw/error*amount,pitch:v.pitch/error*amount};
 }
 inspect(){return {target:this.target,total:this.total,started:this.started,blockedUntil:this.blockedUntil};}
}
