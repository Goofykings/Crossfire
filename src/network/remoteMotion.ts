import type {ControllerState,Vec3} from '../player/PlayerController';
import type {CollisionWorld} from '../physics/CollisionWorld';
import {MOVEMENT} from '../config/constants';
import {playerHeight} from '../../shared/combat';

export const MAX_EXTRAPOLATION_MS=100;
/** Short visual dead reckoning only. Real collision bands keep predictions out of walls. */
export function extrapolatedPosition(m:ControllerState,milliseconds:number,world:CollisionWorld|null):Vec3 {
 const dt=Math.max(0,Math.min(MAX_EXTRAPOLATION_MS,milliseconds))/1000,p=m.position,v=m.velocity;
 if(dt===0)return {...p};
 let x=p.x+v.x*dt,z=p.z+v.z*dt,y=p.y;
 if(world){const moved=world.moveCylinder(p.x,p.z,v.x*dt,v.z*dt,MOVEMENT.radius,
  p.y+(m.grounded?MOVEMENT.stepHeight:.00001),p.y+playerHeight(m));x=moved.x;z=moved.z;}
 if(!m.grounded){
  y=p.y+v.y*dt-MOVEMENT.gravity*dt*dt*.5;
  if(world){
   const floor=world.groundHeight(x,z,MOVEMENT.radius,Math.max(p.y,y));
   if(Number.isFinite(floor))y=Math.max(y,floor);
   const ceiling=world.ceilingHeight(x,z,MOVEMENT.radius,Math.min(y,p.y)+MOVEMENT.stepHeight);
   if(Number.isFinite(ceiling))y=Math.min(y,ceiling-playerHeight(m));
  }
 }
 return {x,y,z};
}
