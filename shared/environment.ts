import type { BoxDesc, CollisionWorld } from '../src/physics/CollisionWorld';
import type { Vec3 } from '../src/player/PlayerController';
import { sweepSphere } from './grenades';

export const ENVIRONMENT = Object.freeze({ maxBodies:12,maxSigns:2,maxLights:1,maxStates:14,hz:10,step:1/120,maxSpeed:8,impulseScale:5,
  gravity:20,restitution:.42,sleepSpeed:.055,sleepDelay:.7,maxAngle:.30 });
export interface PropDefinition {
  id:string;asset:string;position:number[];yaw:number;radius:number;halfHeight:number;mass:number;tilt?:number[];
}
export interface SignDefinition { id:string;asset:string;position:number[];yaw:number }
export interface BasinDefinition { position:number[];yaw:number;halfWidth:number;halfDepth:number;height:number;flare:number }
export interface EnvironmentDefinition {
  version:number;bodies:PropDefinition[];signs:SignDefinition[];replaceProps:{index:number;boxes:BoxDesc[]}[];
  lights?:SignDefinition[];basins?:BasinDefinition[];
}
export const EMPTY_ENVIRONMENT:EnvironmentDefinition={version:1,bodies:[],signs:[],replaceProps:[]};
export interface PropState { id:string;position:Vec3;velocity:Vec3;yaw:number;spin:number;angle:number;angularVelocity:number;asleep:boolean }
export interface EnvironmentFrame { roundId:number;mapVersion:string;seq:number;at:number;full:boolean;states:PropState[] }
type Body={definition:PropDefinition;state:PropState;quiet:number;ground:boolean};
type Sign={definition:SignDefinition;state:PropState;quiet:number;light:boolean};
const vector=(p:number[]):Vec3=>({x:p[0],y:p[1],z:p[2]});
const copy=(s:PropState):PropState=>({...s,position:{...s.position},velocity:{...s.velocity}});
const clamp=(v:number,n:number)=>Math.max(-n,Math.min(n,v));

/** Room-owned decorative bodies: never player blockers or competitive cover.
 * All picking/impulses are driven by real server weapon rays, not client targets.
 * Deterministic bounded substeps and analytic primitives need no external engine. */
export class EnvironmentSimulation {
  private readonly bodies:Body[];
  private readonly signs:Sign[];
  private readonly dirty=new Set<string>();
  private accumulator=0;
  constructor(readonly definition:EnvironmentDefinition,private readonly world:CollisionWorld) {
    if(definition.bodies.length>ENVIRONMENT.maxBodies||definition.signs.length>ENVIRONMENT.maxSigns||
      (definition.lights?.length??0)>ENVIRONMENT.maxLights||definition.bodies.length+definition.signs.length+(definition.lights?.length??0)>ENVIRONMENT.maxStates)throw new Error('Interactive prop budget exceeded');
    const state=(d:SignDefinition):PropState=>({id:d.id,position:vector(d.position),velocity:{x:0,y:0,z:0},yaw:d.yaw,
      spin:0,angle:0,angularVelocity:0,asleep:true});
    this.bodies=definition.bodies.map(d=>({definition:d,state:state(d),quiet:0,ground:false}));
    this.signs=[...definition.signs.map(d=>({definition:d,state:state(d),quiet:0,light:false})),
      ...(definition.lights??[]).map(d=>({definition:d,state:state(d),quiet:0,light:true}))];
  }
  get active():number{return [...this.bodies,...this.signs].filter(b=>!b.state.asleep).length;}
  capture():PropState[]{return [...this.bodies,...this.signs].map(b=>copy(b.state));}
  restore(states:PropState[]):void {
    for(const b of [...this.bodies,...this.signs]) {
      const s=states.find(s=>s.id===b.definition.id);if(!s||!validPropState(s))continue;
      if(Math.abs(s.angle)>ENVIRONMENT.maxAngle+.001)continue;
      b.state=copy(s);b.quiet=0;
    }
  }
  takeChanges():PropState[]{const states=this.capture().filter(s=>this.dirty.has(s.id));this.dirty.clear();return states;}
  private wake(b:Body|Sign):void{b.state.asleep=false;b.quiet=0;this.dirty.add(b.state.id);}
  /** Small objects do not stop bullets; only objects in front of the actual
   * world/player hit can react. A pellet wakes at most its nearest prop. */
  shoot(origin:Vec3,direction:Vec3,maxDistance:number,weapon:'rifle'|'smg'|'sniper'|'shotgun'):string|null {
    let best:{target:Body|Sign;distance:number;sign:boolean}|null=null;
    for(const b of this.bodies) {
      const r=b.definition.radius,h=b.definition.halfHeight,p=b.state.position;
      const o=[(origin.x-p.x)/r,(origin.y-p.y)/h,(origin.z-p.z)/r],d=[direction.x/r,direction.y/h,direction.z/r];
      const a=d.reduce((n,v)=>n+v*v,0),dot=o.reduce((n,v,i)=>n+v*d[i],0),c=o.reduce((n,v)=>n+v*v,0)-1;
      const discriminant=dot*dot-a*c;if(a<1e-12||discriminant<0||(-dot+Math.sqrt(discriminant))/a<0)continue;
      const t=Math.max(0,(-dot-Math.sqrt(discriminant))/a);
      if(t<=maxDistance&&(!best||t<best.distance))best={target:b,distance:t,sign:false};
    }
    for(const b of this.signs) {
      const p=b.state.position,c=Math.cos(b.definition.yaw),s=Math.sin(b.definition.yaw),ca=Math.cos(b.state.angle),sa=Math.sin(b.state.angle);
      const dx=origin.x-p.x,dz=origin.z-p.z,x=dx*c-dz*s,y=origin.y-p.y;
      const vx=direction.x*c-direction.z*s;
      const o=[x*ca+y*sa,-x*sa+y*ca+(b.light?.36:.29),dx*s+dz*c];
      const d=[vx*ca+direction.y*sa,-vx*sa+direction.y*ca,direction.x*s+direction.z*c];
      let near=0,far=maxDistance;const h=b.light?[.15,.18,.15]:[.026,.29,.39];
      for(let i=0;i<3;i++) {
        if(Math.abs(d[i])<1e-9){if(Math.abs(o[i])>h[i])far=-1;continue;}
        const a=(-h[i]-o[i])/d[i],z=(h[i]-o[i])/d[i];near=Math.max(near,Math.min(a,z));far=Math.min(far,Math.max(a,z));
      }
      if(near<=far&&(!best||near<best.distance))best={target:b,distance:near,sign:true};
    }
    if(!best)return null;
    this.wake(best.target);
    if(best.sign) {
      const b=best.target as Sign,localX=direction.x*Math.cos(b.definition.yaw)-direction.z*Math.sin(b.definition.yaw);
      const localZ=direction.x*Math.sin(b.definition.yaw)+direction.z*Math.cos(b.definition.yaw);
      const torque=b.light?(Math.abs(localX)>=Math.abs(localZ)*.65?localX:localZ*.65):localX;
      b.state.angularVelocity=clamp(b.state.angularVelocity+torque*(weapon==='sniper'?3.4:weapon==='shotgun'?.9:2.6),3.5);
    } else {
      const b=best.target as Body,k=({rifle:.22,smg:.15,sniper:.40,shotgun:.07}[weapon])*ENVIRONMENT.impulseScale/b.definition.mass;
      b.state.velocity.x+=direction.x*k;b.state.velocity.y+=direction.y*k+.08*ENVIRONMENT.impulseScale;b.state.velocity.z+=direction.z*k;
      const speed=Math.hypot(...Object.values(b.state.velocity));if(speed>ENVIRONMENT.maxSpeed)for(const key of ['x','y','z'] as const)b.state.velocity[key]*=ENVIRONMENT.maxSpeed/speed;
      b.state.spin=clamp(b.state.spin+k*.5,4);
      if(b.definition.asset==='apple'||b.definition.tilt)b.state.angularVelocity=clamp(b.state.angularVelocity+(direction.x-direction.z)*k,4);
    }
    return best.target.state.id;
  }
  advance(seconds:number):void {
    if(!this.active){this.accumulator=0;return;}
    this.accumulator+=Math.min(.25,Math.max(0,seconds));
    while(this.accumulator>=ENVIRONMENT.step){this.step(ENVIRONMENT.step);this.accumulator-=ENVIRONMENT.step;}
  }
  /** Tapered bin interiors use continuous sphere/plane contacts. Player and
   * bullet collision retains the conservative wooden shell in the world. */
  private sweep(b:Body,start:Vec3,delta:Vec3) {
    const {radius:r,halfHeight:h}=b.definition;
    let best=sweepSphere(this.world,start,delta,r,h,this.definition.basins?.length?c=>c.tag!=='interactive-bin':undefined);
    for(const bin of this.definition.basins??[]) {
      const c=Math.cos(bin.yaw),s=Math.sin(bin.yaw),x=start.x-bin.position[0],z=start.z-bin.position[2];
      const p=[x*c-z*s,start.y-bin.position[1],x*s+z*c],d=[delta.x*c-delta.z*s,delta.y,delta.x*s+delta.z*c];
      const slope=bin.flare/bin.height;
      for(const [axis,side,outside] of [[1,1,0],[0,-1,0],[0,1,0],[2,-1,0],[2,1,0],
        [0,-1,1],[0,1,1],[2,-1,1],[2,1,1]]) {
        const n=axis===1?[0,1,0]:axis===0?[-side,slope,0]:[0,slope,-side],length=Math.hypot(...n);
        for(let i=0;i<3;i++)n[i]*=(outside?-1:1)/length;
        const half=axis===0?bin.halfWidth:bin.halfDepth;
        const distance=axis===1?p[1]-h:((half-side*p[axis]+slope*p[1])*(outside?-1:1)-(outside?.025:0))/length-r;
        const into=n.reduce((v,a,i)=>v+a*d[i],0);if(into>=-1e-12||distance<-.0002)continue;
        const t=Math.max(0,-distance/into);if(t>1||(best&&t>=best.fraction))continue;
        const q=p.map((v,i)=>v+d[i]*t);
        if(axis===1){if(Math.abs(q[0])>bin.halfWidth+bin.flare||Math.abs(q[2])>bin.halfDepth+bin.flare)continue;}
        else if(q[1]-n[1]*r<-.0001||q[1]-n[1]*r>bin.height+.0001||Math.abs(q[axis===0?2:0])>(axis===0?bin.halfDepth:bin.halfWidth)+bin.flare+r)continue;
        best={fraction:t,normal:{x:n[0]*c+n[2]*s,y:n[1],z:-n[0]*s+n[2]*c}};
      }
      if(d[1]<0){
        const t=(bin.height+h-p[1])/d[1];
        if(t>=0&&t<=1&&(!best||t<best.fraction)){
          const x=p[0]+d[0]*t,z=p[2]+d[2]*t,wx=bin.halfWidth+bin.flare,wz=bin.halfDepth+bin.flare;
          if((Math.abs(Math.abs(x)-wx-.0125)<=.012501&&Math.abs(z)<=wz+.025)||
            (Math.abs(Math.abs(z)-wz-.0125)<=.012501&&Math.abs(x)<=wx+.025))
            best={fraction:t,normal:{x:0,y:1,z:0}};
        }
      }
    }
    return best;
  }
  private step(dt:number):void {
    for(const b of this.bodies) {
      const s=b.state;b.ground=false;if(s.asleep)continue;
      s.velocity.y-=ENVIRONMENT.gravity*dt;
      const velocityLength=Math.hypot(s.velocity.x,s.velocity.y,s.velocity.z);
      if(velocityLength>ENVIRONMENT.maxSpeed)for(const k of ['x','y','z'] as const)s.velocity[k]*=ENVIRONMENT.maxSpeed/velocityLength;
      let remaining=dt,ground=false;
      for(let i=0;i<4&&remaining>1e-6;i++) {
        const delta={x:s.velocity.x*remaining,y:s.velocity.y*remaining,z:s.velocity.z*remaining};
        const hit=this.sweep(b,s.position,delta),t=hit?.fraction??1;
        for(const k of ['x','y','z'] as const)s.position[k]+=delta[k]*t;
        if(!hit)break;
        const n=hit.normal,into=s.velocity.x*n.x+s.velocity.y*n.y+s.velocity.z*n.z;
        for(const k of ['x','y','z'] as const)s.position[k]+=n[k]*.0001;
        if(into<0){const bounce=Math.abs(into)<.4?0:ENVIRONMENT.restitution;
          for(const k of ['x','y','z'] as const)s.velocity[k]-=n[k]*into*(1+bounce);}
        ground ||= n.y>.5;remaining*=1-t;
      }
      b.ground=ground;
      this.dirty.add(s.id);
    }
    // Bounded all-pairs test (at most 12 bodies). Sleeping neighbours can be woken by contact.
    for(let pass=0;pass<3;pass++)for(let i=0;i<this.bodies.length;i++)for(let j=i+1;j<this.bodies.length;j++) {
      const a=this.bodies[i],b=this.bodies[j];if(a.state.asleep&&b.state.asleep)continue;
      const p=a.state.position,q=b.state.position,r=a.definition.radius+b.definition.radius,h=a.definition.halfHeight+b.definition.halfHeight;
      const dx=q.x-p.x,dy=q.y-p.y,dz=q.z-p.z,distance=Math.hypot(dx/r,dy/h,dz/r);
      if(distance>1.0001||distance<1e-8)continue;
      const normal={x:dx/(r*r),y:dy/(h*h),z:dz/(r*r)},n=Math.hypot(normal.x,normal.y,normal.z);
      for(const k of ['x','y','z'] as const)normal[k]/=n;
      const relative=(b.state.velocity.x-a.state.velocity.x)*normal.x+(b.state.velocity.y-a.state.velocity.y)*normal.y+(b.state.velocity.z-a.state.velocity.z)*normal.z;
      // Do not repeatedly wake a settled cluster over numerical contact noise.
      if(normal.y>.5)b.ground=true;if(normal.y<-.5)a.ground=true;
      if(relative<-.08||distance<.98){if(a.state.asleep)this.wake(a);if(b.state.asleep)this.wake(b);}
      const inverseA=1/a.definition.mass,inverseB=1/b.definition.mass,total=inverseA+inverseB;
      const correction=Math.min(.025,Math.max(0,1-distance)*Math.min(r,h)*.7),impulse=Math.max(0,-(1+.30)*relative/total);
      for(const k of ['x','y','z'] as const) {
        const da=-normal[k]*correction*inverseA/total,db=normal[k]*correction*inverseB/total;
        // Corrections must not push a neighbour inside static world geometry.
        const moveA={x:0,y:0,z:0},moveB={x:0,y:0,z:0};moveA[k]=da;moveB[k]=db;
        const hitA=this.sweep(a,p,moveA),hitB=this.sweep(b,q,moveB);
        p[k]+=da*(hitA?.fraction??1);q[k]+=db*(hitB?.fraction??1);
        a.state.velocity[k]-=normal[k]*impulse*inverseA;b.state.velocity[k]+=normal[k]*impulse*inverseB;
      }
      for(const body of [a,b]) {const v=body.state.velocity,speed=Math.hypot(v.x,v.y,v.z);
        if(speed>ENVIRONMENT.maxSpeed)for(const k of ['x','y','z'] as const)v[k]*=ENVIRONMENT.maxSpeed/speed;
        if(!body.state.asleep)this.dirty.add(body.state.id);}
    }
    for(const b of this.bodies){
      const s=b.state;if(s.asleep)continue;
      const damping=Math.exp(-(b.ground?7:1.1)*dt);s.velocity.x*=damping;s.velocity.z*=damping;s.spin*=damping;s.angularVelocity*=damping;
      s.yaw+=s.spin*dt;
      if(b.definition.asset==='apple'||b.definition.tilt){
        s.angle+=s.angularVelocity*dt;
        if(Math.abs(s.angle)>ENVIRONMENT.maxAngle){s.angle=clamp(s.angle,ENVIRONMENT.maxAngle);s.angularVelocity*= -.3;}
      }
      if(b.ground&&Math.hypot(s.velocity.x,s.velocity.z)<.025)s.velocity.x=s.velocity.z=0;
      b.quiet=b.ground&&Math.hypot(s.velocity.x,s.velocity.y,s.velocity.z)<ENVIRONMENT.sleepSpeed?b.quiet+dt:0;
      if(b.quiet>=ENVIRONMENT.sleepDelay||s.position.y<-30){s.asleep=true;s.velocity={x:0,y:0,z:0};s.spin=s.angularVelocity=0;}
    }
    for(const b of this.signs) {
      const s=b.state;if(s.asleep)continue;
      s.angularVelocity+=(-14*s.angle-1.8*s.angularVelocity)*dt;s.angle+=s.angularVelocity*dt;
      if(Math.abs(s.angle)>ENVIRONMENT.maxAngle){s.angle=clamp(s.angle,ENVIRONMENT.maxAngle);s.angularVelocity*= -.15;}
      b.quiet=Math.abs(s.angle)<.001&&Math.abs(s.angularVelocity)<.006?b.quiet+dt:0;
      if(b.quiet>.7){s.angle=s.angularVelocity=0;s.asleep=true;}
      this.dirty.add(s.id);
    }
  }
}

export function validPropState(x:unknown):x is PropState {
  if(!x||typeof x!=='object')return false;const s=x as Record<string,unknown>;
  const vec=(v:unknown)=>!!v&&typeof v==='object'&&['x','y','z'].every(k=>typeof (v as Record<string,unknown>)[k]==='number'&&Number.isFinite((v as Record<string,number>)[k])&&Math.abs((v as Record<string,number>)[k])<1000);
  return Object.keys(s).every(k=>['id','position','velocity','yaw','spin','angle','angularVelocity','asleep'].includes(k))
    &&typeof s.id==='string'&&s.id.length>0&&s.id.length<=64&&vec(s.position)&&vec(s.velocity)
    &&['yaw','spin','angle','angularVelocity'].every(k=>typeof s[k]==='number'&&Number.isFinite(s[k]))
    &&Math.abs(s.angle as number)<=ENVIRONMENT.maxAngle+.001&&Math.abs(s.spin as number)<=8
    &&Math.abs(s.angularVelocity as number)<=4&&typeof s.asleep==='boolean';
}
export function validEnvironmentFrame(x:unknown):x is EnvironmentFrame {
  if(!x||typeof x!=='object')return false;const f=x as Record<string,unknown>;
  return Object.keys(f).every(k=>['roundId','mapVersion','seq','at','full','states'].includes(k))
    &&Number.isSafeInteger(f.roundId)&&(f.roundId as number)>=0&&typeof f.mapVersion==='string'&&f.mapVersion.length<=64
    &&Number.isSafeInteger(f.seq)&&(f.seq as number)>=0&&Number.isSafeInteger(f.at)&&(f.at as number)>=0
    &&typeof f.full==='boolean'&&Array.isArray(f.states)&&f.states.length<=ENVIRONMENT.maxStates
    &&f.states.every(validPropState)&&new Set(f.states.map(s=>s.id)).size===f.states.length;
}
