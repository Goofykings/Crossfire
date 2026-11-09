import type {ControllerState} from '../src/player/PlayerController';
import {interpolateMotion} from './motionTimeline';

export const MAX_REWIND_MS=300;
export function shotViewTime(now:number,requested:number|undefined,rtt:number):number {
 if(requested===undefined)return now;
 // RTT comes from a server-issued challenge, never a client latency claim.
 const allowance=Math.min(MAX_REWIND_MS,Math.max(0,rtt)*.5+200);
 return Math.max(now-allowance,Math.min(now,requested));
}
interface Pose {at:number;life:number;round:number;motion:ControllerState}
/** Small in-memory history, deliberately discarded on restart, respawn or teleport. */
export class MotionHistory {
 private poses:Pose[]=[];
 clear():void {this.poses=[];}
 record(at:number,life:number,round:number,motion:ControllerState):void {
  const last=this.poses.at(-1);
  if(last&&(last.life!==life||last.round!==round||at<last.at||Math.hypot(motion.position.x-last.motion.position.x,motion.position.y-last.motion.position.y,motion.position.z-last.motion.position.z)>2.5))this.clear();
  const pose={at,life,round,motion:{...motion,position:{...motion.position},velocity:{...motion.velocity}}};
  if(this.poses.at(-1)?.at===at)this.poses[this.poses.length-1]=pose;else this.poses.push(pose);
  while(this.poses.length>2&&(this.poses[1].at<at-MAX_REWIND_MS-150||this.poses.length>64))this.poses.shift();
 }
 sample(at:number,life:number,round:number):ControllerState|null {
  const first=this.poses[0],last=this.poses.at(-1);
  if(!first||!last||first.life!==life||first.round!==round||at<first.at)return null;
  for(let i=1;i<this.poses.length;i++){
   const b=this.poses[i],a=this.poses[i-1];
   if(at<=b.at)return interpolateMotion(a.motion,b.motion,Math.max(0,Math.min(1,(at-a.at)/Math.max(1,b.at-a.at))));
  }
  return interpolateMotion(last.motion,last.motion,0);
 }
}
