import {GRENADE,sweepSphere} from '../../shared/grenades';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {Vec3} from '../player/PlayerController';

/** Low arc checked with the same swept sphere as real throws; never targets through walls. */
export function botThrow(world:CollisionWorld,eye:Vec3,target:Vec3){
 const dx=target.x-eye.x,dz=target.z-eye.z,d=Math.hypot(dx,dz);
 if(d<6||d>20||Math.abs(target.y-eye.y)>4)return null;
 const direct={x:dx,y:target.y+1-eye.y,z:dz},length=Math.hypot(direct.x,direct.y,direct.z);
 if(world.raycast(eye.x,eye.y,eye.z,direct.x/length,direct.y/length,direct.z/length,length))return null;
 const time=.55+d*.025,horizontal=(d-.38)/time;
 const vertical=(target.y+.15-(eye.y-.1)+.5*GRENADE.gravity*time*time)/time-GRENADE.lift;
 const speed=Math.hypot(horizontal,vertical);
 if(speed<GRENADE.minSpeed||speed>GRENADE.maxSpeed)return null;
 const pitch=Math.atan2(vertical,horizontal),yaw=Math.atan2(-dx,-dz);
 const direction={x:dx/d*Math.cos(pitch),y:Math.sin(pitch),z:dz/d*Math.cos(pitch)};
 let previous={x:eye.x+direction.x*.38,y:eye.y+direction.y*.38-.1,z:eye.z+direction.z*.38};const start={...previous};
 for(let t=1/30;t<time;t+=1/30){
  const next={x:start.x+direction.x*speed*t,y:start.y+(direction.y*speed+GRENADE.lift)*t-.5*GRENADE.gravity*t*t,z:start.z+direction.z*speed*t};
  if(sweepSphere(world,previous,{x:next.x-previous.x,y:next.y-previous.y,z:next.z-previous.z},GRENADE.radius))return null;
  previous=next;
 }
 return{yaw,pitch,strength:(speed-GRENADE.minSpeed)/(GRENADE.maxSpeed-GRENADE.minSpeed)};
}
