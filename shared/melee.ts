import type { ControllerState, Vec3 } from '../src/player/PlayerController';
import type { CollisionWorld } from '../src/physics/CollisionWorld';
import { playerHeight, rayPlayer } from './combat';

/** Authored clip timings from daggers.json, guarded by the metadata compatibility test.
 * Seconds in the asset become milliseconds here. Combat never depends on rendering.
 * The fast-animation pass (2026-11-07) shortened the swings to 250/250/400 ms and moved the
 * hit windows with them (same 90 ms width); damage, range, arc and the combo reset are unchanged. */
export const MELEE = Object.freeze({damage:35,range:1.85,arc:55*Math.PI/180,comboReset:350,equip:500,unequip:400,
  attacks:[{clip:'attack_cross',duration:250,contact:70,contactEnd:160,chain:170},
    {clip:'attack_forward',duration:250,contact:70,contactEnd:160,chain:170},
    {clip:'attack_finisher',duration:400,contact:215,contactEnd:305,chain:310}] as const});
export type MeleeStage=1|2|3;
export const MELEE_IMPACT=Object.freeze({speeds:[1.4,1.4,3.1] as const,maxSpeed:8,lift:.8});
/** Called only inside the authoritative successful-damage path. Never teleports. */
export function meleeKnockback(player:import('../src/player/PlayerController').PlayerController,direction:Vec3,stage:MeleeStage):void {
 const n=Math.hypot(direction.x,direction.z);if(!Number.isFinite(n)||n<.001)return;
 const v=player.velocity,speed=MELEE_IMPACT.speeds[stage-1];v.x+=direction.x/n*speed;v.z+=direction.z/n*speed;
 const total=Math.hypot(v.x,v.z);if(total>MELEE_IMPACT.maxSpeed){v.x*=MELEE_IMPACT.maxSpeed/total;v.z*=MELEE_IMPACT.maxSpeed/total;}
 if(player.grounded){v.y=Math.max(v.y,MELEE_IMPACT.lift);player.grounded=false;}
 if(player.sliding){player.slideRemaining=0;player.slideCooldown=player.cfg.slideCooldown;}
}
export type MeleePhase='hidden'|'equipping'|'ready'|'attacking'|'unequipping';
export interface MeleeState {
  phase:MeleePhase;stage:MeleeStage;startedAt:number;sequence:number;contactDone:boolean;
  buffered:boolean;comboAt:number|null;toggleHeld:boolean;triggerHeld:boolean;
}
export const createMeleeState=():MeleeState=>({phase:'hidden',stage:1,startedAt:0,sequence:0,contactDone:false,buffered:false,comboAt:null,toggleHeld:false,triggerHeld:false});
export const meleeBlocked=(state?:MeleeState):boolean=>!!state&&state.phase!=='hidden';
export function meleeClip(state:MeleeState):string|null {
  return state.phase==='hidden'?null:state.phase==='equipping'?'equip':state.phase==='unequipping'?'unequip':state.phase==='ready'?'idle':MELEE.attacks[state.stage-1].clip;
}
/** One buffered press, one contact per swing, and server elapsed time. Missing
 * input does not manufacture key-release edges. Holding fire never repeats attacks. */
export function stepMelee(s:MeleeState,now:number,input:{melee?:boolean;trigger:boolean}|undefined,gunIdle=true):{stage:MeleeStage;sequence:number}|null {
  let contact:{stage:MeleeStage;sequence:number}|null=null;
  const attack=!!input?.trigger&&!s.triggerHeld,toggle=!!input?.melee&&!s.toggleHeld;
  if(input){s.triggerHeld=input.trigger;s.toggleHeld=!!input.melee;}
  const start=()=>{s.stage=s.comboAt!==null&&now-s.comboAt<=MELEE.comboReset?((s.stage%3)+1) as MeleeStage:1;
    s.phase='attacking';s.startedAt=now;s.sequence++;s.contactDone=false;s.buffered=false;s.comboAt=null;};
  const elapsed=now-s.startedAt;
  if(s.phase==='attacking'){
    const meta=MELEE.attacks[s.stage-1];
    if(!s.contactDone&&elapsed>=meta.contact){s.contactDone=true;if(elapsed<=meta.contactEnd)contact={stage:s.stage,sequence:s.sequence};}
    if(attack)s.buffered=true;
    if(s.buffered&&elapsed>=meta.chain){s.comboAt=now;start();}
    else if(elapsed>=meta.duration){s.phase='ready';s.comboAt=s.startedAt+meta.duration;s.startedAt=now;}
  }else if(s.phase==='equipping'&&elapsed>=MELEE.equip){s.phase='ready';s.startedAt=now;}
  else if(s.phase==='unequipping'&&elapsed>=MELEE.unequip){s.phase='hidden';s.startedAt=now;s.comboAt=null;}
  if(attack&&s.phase==='equipping')s.buffered=true;
  if(s.phase==='ready'&&s.buffered)start();
  if(toggle&&s.phase==='hidden'&&gunIdle){s.phase='equipping';s.startedAt=now;s.comboAt=null;s.buffered=false;}
  else if(toggle&&s.phase!=='hidden'&&s.phase!=='unequipping') {s.phase='unequipping';s.startedAt=now;s.buffered=false;s.comboAt=null;}
  else if(attack&&s.phase==='ready')start();
  return contact;
}
export function validMelee(x:unknown):x is MeleeState {
  if(!x||typeof x!=='object'||Array.isArray(x))return false;const s=x as MeleeState;
  return Object.keys(s).length===9&&['hidden','equipping','ready','attacking','unequipping'].includes(s.phase)&&[1,2,3].includes(s.stage)
    &&Number.isSafeInteger(s.startedAt)&&s.startedAt>=0&&Number.isSafeInteger(s.sequence)&&s.sequence>=0
    &&(s.comboAt===null||Number.isSafeInteger(s.comboAt)&&s.comboAt>=0)
    &&['contactDone','buffered','toggleHeld','triggerHeld'].every(k=>typeof (s as unknown as Record<string,unknown>)[k]==='boolean');
}
export interface MeleeHit {point:Vec3;direction:Vec3;distance:number}
/** Select one nearest exposed body inside the short forward cone. Both the body
 * center and near capsule surface must have LOS, so a blade never bypasses a wall. */
export function traceMelee<T>(world:CollisionWorld,attacker:ControllerState,targets:Iterable<{value:T;motion:ControllerState}>):{target:T;hit:MeleeHit}|null {
  const origin={...attacker.position,y:attacker.position.y+playerHeight(attacker)*.72};
  const cp=Math.cos(attacker.pitch),aim={x:-Math.sin(attacker.yaw)*cp,y:Math.sin(attacker.pitch),z:-Math.cos(attacker.yaw)*cp};
  let nearest:{target:T;hit:MeleeHit}|null=null;
  for(const body of targets){
    const p=body.motion.position,target={x:p.x,y:p.y+playerHeight(body.motion)*.66,z:p.z};
    const delta={x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z},n=Math.hypot(delta.x,delta.y,delta.z);
    if(n<.01||n>MELEE.range+.3)continue;const dir={x:delta.x/n,y:delta.y/n,z:delta.z/n};
    if(dir.x*aim.x+dir.y*aim.y+dir.z*aim.z<Math.cos(MELEE.arc/2))continue;
    const contact=rayPlayer(origin,dir,body.motion);if(!contact||contact.distance>MELEE.range)continue;
    const wall=world.raycast(origin.x,origin.y,origin.z,dir.x,dir.y,dir.z,n);
    if(wall&&wall.distance<n-.01)continue;
    if(!nearest||contact.distance<nearest.hit.distance)nearest={target:body.value,hit:{distance:contact.distance,direction:dir,point:{x:origin.x+dir.x*contact.distance,y:origin.y+dir.y*contact.distance,z:origin.z+dir.z*contact.distance}}};
  }
  return nearest;
}
