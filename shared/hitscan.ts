import {applySpread,damageAt,rollDamage,pelletSpreadAt,type WeaponStats} from '../src/weapons/Weapon';
import type {CollisionWorld} from '../src/physics/CollisionWorld';
import type {ControllerState,Vec3} from '../src/player/PlayerController';
import {rayPlayer} from './combat';
export interface ShotBody<T> {value:T;motion:ControllerState}
export interface PelletHit {distance:number;zone:'head'|'body';point:Vec3;direction:Vec3;bodyDamage:number}
/** Shared authoritative ray/pellet resolution. Targets are sampled for each pellet,
 * so an eliminated body cannot absorb the rest of a shotgun shot. Team policy and
 * damage transitions remain with the caller; teammates still physically block rays. */
export function traceWeaponShot<T>(world:CollisionWorld,origin:Vec3,yaw:number,pitch:number,stats:WeaponStats,spread:number,
  targets:()=>Iterable<ShotBody<T>>,hit:(target:T,impact:PelletHit)=>void,
  trace?:(direction:Vec3,distance:number)=>void,random:()=>number=Math.random,ads=0):{from:Vec3;to:Vec3}[]{
 const cp=Math.cos(pitch),aim=applySpread({x:-Math.sin(yaw)*cp,y:Math.sin(pitch),z:-Math.cos(yaw)*cp},spread,random),traces:{from:Vec3;to:Vec3}[]=[];
 for(let k=0;k<stats.pellets;k++){
  const direction=stats.pellets>1?applySpread(aim,pelletSpreadAt(stats,ads),random):aim;
  const wall=world.raycastBullet(origin.x,origin.y,origin.z,direction.x,direction.y,direction.z,stats.range);
  let nearest:{target:T;distance:number;zone:'head'|'body'}|null=null;
  for(const body of targets()){const contact=rayPlayer(origin,direction,body.motion);if(contact&&contact.distance<=stats.range&&(!nearest||contact.distance<nearest.distance))nearest={target:body.value,...contact};}
  const distance=Math.min(stats.range,wall?.distance??Infinity,nearest?.distance??Infinity),point={x:origin.x+direction.x*distance,y:origin.y+direction.y*distance,z:origin.z+direction.z*distance};
  traces.push({from:{...origin},to:point});trace?.(direction,distance);
  if(nearest&&(!wall||wall.distance>nearest.distance+.0001))hit(nearest.target,{distance:nearest.distance,zone:nearest.zone,point,direction,bodyDamage:damageAt(stats,nearest.distance,rollDamage(stats,random))});
 }
 return traces;
}
