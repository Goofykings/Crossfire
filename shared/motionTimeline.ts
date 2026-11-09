import type {ControllerState} from '../src/player/PlayerController';

/** Identical body interpolation for presentation and authoritative historical hits. */
export function interpolateMotion(a:ControllerState,b:ControllerState,k:number):ControllerState {
 const mix=(x:number,y:number)=>x+(y-x)*k;
 return {...(k<.5?a:b),position:{x:mix(a.position.x,b.position.x),y:mix(a.position.y,b.position.y),z:mix(a.position.z,b.position.z)},
  velocity:{x:mix(a.velocity.x,b.velocity.x),y:mix(a.velocity.y,b.velocity.y),z:mix(a.velocity.z,b.velocity.z)},
  yaw:a.yaw+Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw))*k,pitch:mix(a.pitch,b.pitch),
  crouch:mix(a.crouch,b.crouch),lean:mix(a.lean,b.lean),slideRemaining:mix(a.slideRemaining,b.slideRemaining)};
}
