import { describe, it, expect } from 'vitest';
import { activatePowerup, absorbDamage, advanceBurn, applyBurn, canGrow, expirePowerup, maxHealth, pickupLocations,
  PowerupField, spawnBalance, type PowerupPlayer } from '../shared/powerups';
import { regenerate } from '../shared/health';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import { NO_INTENT, PlayerController, WEAPON_CLEARANCE } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { playerHeight, rayPlayer, roundMode, teammates } from '../shared/combat';
import { finalizeRound } from '../shared/scoring';
import { PROTOCOL_VERSION, parseClientMessage, parseServerMessage, validMotion, validResult } from '../shared/protocol';
import { WORLDS } from '../server/src/world';
import { powerupRemaining } from '../src/ui/PowerupHud';

const player=():PowerupPlayer=>({alive:true,health:100,regenAt:null,powerup:null,burn:null});
function ground(){const w=new CollisionWorld();w.add({c:[0,-1,0],h:[100,1,100]});return w;}
function run(p:PlayerController,n:number){for(let i=0;i<n;i++)p.fixedUpdate(FIXED_DT,NO_INTENT);}

describe('powerup authority and elapsed lifecycle',()=>{
  it('preserves health percentage through Giant, replacement and expiration, without healing',()=>{
    const s=player();s.health=40;activatePowerup(s,'giant',1000);
    expect(maxHealth(s)).toBe(150);expect(s.health).toBe(60);
    absorbDamage(s,15,2000);expect(s.health).toBe(45);
    expirePowerup(s,15999);expect(s.powerup?.type).toBe('giant');
    expirePowerup(s,16000);expect(s.health).toBe(30);expect(maxHealth(s)).toBe(100);
    activatePowerup(s,'giant',17000);activatePowerup(s,'shield',18000);expect(s.health).toBe(30);expect(s.powerup?.shield).toBe(75);
  });
  it('caps regeneration at the actual maximum and clears dead abilities',()=>{
    const s=player();activatePowerup(s,'giant',0);absorbDamage(s,3,100);
    regenerate(s,5100);expect(s.health).toBe(147);regenerate(s,5400);expect(s.health).toBe(150);
    s.alive=false;s.health=0;expirePowerup(s,6000);expect(s.powerup).toBeNull();expect(s.health).toBe(0);
  });
  it('absorbs shield first exactly once per damage transaction with overflow and expiry',()=>{
    const s=player();activatePowerup(s,'shield',1000);
    expect(absorbDamage(s,50,2000)).toBe(50);expect(s.health).toBe(100);expect(s.powerup?.shield).toBe(25);
    expect(absorbDamage(s,40,2100)).toBe(40);expect(s.health).toBe(85);expect(s.powerup?.shield).toBe(0);
    activatePowerup(s,'shield',3000);absorbDamage(s,10,18000);expect(s.health).toBe(75);expect(s.powerup).toBeNull();
  });
  it('burn is smooth 10 HP/s, finite 50 total, blocks regen and resets the full delay',()=>{
    const s=player();applyBurn(s,'a',1000);
    for(let t=1050;t<=6000;t+=50){advanceBurn(s,t);regenerate(s,t);}
    expect(s.health).toBeCloseTo(50,8);expect(s.burn).toBeNull();expect(s.regenAt).toBe(11000);
    advanceBurn(s,10000);regenerate(s,11000);expect(s.health).toBeCloseTo(50);
    regenerate(s,11100);expect(s.health).toBeCloseTo(51);
  });
  it('refreshes one burn and replaces ownership without stacking or repeated elapsed damage',()=>{
    const s=player();applyBurn(s,'a',1000);expect(advanceBurn(s,2000)?.ownerId).toBe('a');expect(s.health).toBe(90);
    applyBurn(s,'b',2000);advanceBurn(s,2000);expect(s.health).toBe(90);
    const restored=JSON.parse(JSON.stringify(s));expect(advanceBurn(restored,3000)?.ownerId).toBe('b');expect(restored.health).toBe(80);
    advanceBurn(restored,7000);expect(restored.health).toBe(40);advanceBurn(restored,8000);expect(restored.health).toBe(40);
  });
  it('consumes burn chronologically across shield/Giant expiry and dead states',()=>{
    const s=player();activatePowerup(s,'shield',0);applyBurn(s,'a',14000);advanceBurn(s,19000);
    expect(s.health).toBe(60);expect(s.powerup).toBeNull();expect(s.regenAt).toBe(24000);
    const giant=player();activatePowerup(giant,'giant',0);applyBurn(giant,'a',14000);advanceBurn(giant,19000);
    expect(giant.health).toBeCloseTo(150/1.5-10/1.5-40);expect(giant.powerup).toBeNull();
    s.alive=false;s.health=0;applyBurn(s,'a',20000);expect(s.burn).toBeNull();
  });
  it('uses authoritative duration for the HUD, clamped to zero and full duration',()=>{
    const s=player();activatePowerup(s,'fire',1000);expect(powerupRemaining(s.powerup,2000)).toBe(14000);
    expect(powerupRemaining(s.powerup,0)).toBe(15000);expect(powerupRemaining(s.powerup,20000)).toBe(0);
  });
});

describe('shared Giant and double-jump prediction',()=>{
  it('scales size, walk/ADS/slide speeds, eye, weapon clearance and hit volume without changing feet',()=>{
    const w=ground(),p=new PlayerController(w);p.teleport({x:0,y:0,z:0});p.scale=1.5;run(p,30);
    expect(p.height).toBeCloseTo(2.7);expect(p.eyeHeight).toBeCloseTo(2.46);expect(p.cfg.radius).toBeCloseTo(.51);
    expect(p.cfg.walkSpeed).toBe(MOVEMENT.walkSpeed*1.5);expect(p.cfg.aimSpeed).toBe(MOVEMENT.aimSpeed*1.5);
    for(let i=0;i<120;i++)p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});expect(p.horizontalSpeed).toBeCloseTo(MOVEMENT.walkSpeed*1.5);expect(p.position.y).toBe(0);
    const m=p.capture();expect(playerHeight(m)).toBeCloseTo(2.7);
    expect(rayPlayer({x:m.position.x+.45,y:1,z:m.position.z+5},{x:0,y:0,z:-1},m)?.zone).toBe('body');
    const q=new PlayerController(w);q.restore(m);expect(q.capture()).toEqual(m);
  });
  it('refuses growth near walls/low ceilings, shrinks without moving, cannot walk through a small doorway',()=>{
    const w=ground();w.add({c:[0,2.5,0],h:[2,.2,2]});expect(canGrow(w,{x:0,y:0,z:0})).toBe(false);
    expect(canGrow(w,{x:5,y:0,z:0})).toBe(true);
    w.add({c:[4.55,1,0],h:[.1,1,2]});expect(canGrow(w,{x:5,y:0,z:0})).toBe(false);
    const p=new PlayerController(w);p.teleport({x:0,y:0,z:4});p.scale=1.5;
    for(let i=0;i<120;i++)p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});expect(p.position.z).toBeGreaterThan(2.49);
    const before={...p.position};p.scale=1;expect(p.position).toEqual(before);
  });
  it.each(['rifle','shotgun','sniper','smg'] as const)('%s keeps its scaled muzzle outside walls while a Giant aims and moves',weapon=>{
    const w=ground();w.add({c:[0,1.5,-5],h:[10,1.5,.1]});
    const p=new PlayerController(w);p.teleport({x:0,y:0,z:0});p.scale=1.5;p.weaponClearance=weapon;
    for(let i=0;i<240;i++)p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1,aim:true});
    expect(p.position.z-WEAPON_CLEARANCE[weapon]*1.5).toBeGreaterThan(-4.9);
    expect(p.horizontalSpeed).toBeLessThan(.01);
  });
  it('keeps the growing camera aligned with the authoritative eye and shrinks collision only as the head returns',()=>{
    const p=new PlayerController(ground());p.teleport({x:0,y:0,z:0});p.scale=1.5;run(p,15);
    expect(p.eyeScale).toBeCloseTo(1.25);expect(p.eyeHeight).toBeCloseTo(MOVEMENT.standEye*1.25);
    expect(p.bodyScale).toBe(1.5);run(p,15);p.scale=1;
    expect(p.height).toBeCloseTo(2.7);run(p,15);expect(p.height).toBeCloseTo(2.25);
    expect(playerHeight(p.capture())).toBeCloseTo(p.height);run(p,15);expect(p.height).toBeCloseTo(1.8);
  });
  it('gives exactly one extra airborne jump, twice normal height, preserving horizontal momentum and replay',()=>{
    const w=ground(),p=new PlayerController(w);p.teleport({x:0,y:0,z:0});p.doubleJump=true;
    p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true,z:1});run(p,24);
    const start=p.position.y,horizontal=p.horizontalSpeed;
    p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});expect(p.extraJumpCount).toBe(1);expect(p.horizontalSpeed).toBe(horizontal);
    let peak=p.position.y;for(let i=0;i<70;i++){p.fixedUpdate(FIXED_DT,NO_INTENT);peak=Math.max(peak,p.position.y);}
    expect(peak-start).toBeCloseTo(MOVEMENT.jumpSpeed**2/MOVEMENT.gravity,1);
    const q=new PlayerController(w);q.restore(p.capture());
    const v=p.velocity.y;p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});q.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});
    expect(p.velocity.y).toBeLessThan(v);expect(p.extraJumpCount).toBe(1);expect(q.capture()).toEqual(p.capture());
    run(p,240);expect(p.grounded).toBe(true);expect(p.extraJumpUsed).toBe(false);
    p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});run(p,2);p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});expect(p.extraJumpCount).toBe(2);
  });
  it('does not allow a third jump or ceiling penetration, and preserves normal jumps without the ability',()=>{
    const w=ground();w.add({c:[0,3.5,0],h:[5,.1,5]});const p=new PlayerController(w);p.teleport({x:0,y:0,z:0});p.doubleJump=true;
    p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});run(p,8);p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});
    for(let i=0;i<10;i++){p.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});expect(p.position.y+p.height).toBeLessThanOrEqual(3.4+.001);}
    expect(p.extraJumpCount).toBe(1);
    const normal=new PlayerController(ground());normal.teleport({x:0,y:0,z:0});normal.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});run(normal,8);
    normal.fixedUpdate(FIXED_DT,{...NO_INTENT,jumpPressed:true});expect(normal.extraJumpCount).toBe(0);
  });
});

describe('pickup geometry, rates, exactly-once collection and rotation',()=>{
  it.each(Object.entries(WORLDS))('%s produces a distributed navigable pool away from stairs and solids',(_id,map)=>{
    const pool=pickupLocations(map.layout,map.world);expect(pool.length).toBeGreaterThan(12);
    for(const p of pool){expect(canGrow(map.world,p)).toBe(true);expect(p.x).toBeGreaterThan(map.layout.playArea[0]);expect(p.x).toBeLessThan(map.layout.playArea[2]);
      expect(map.world.groundHeight(p.x,p.z,.2,p.y+.1)).toBeCloseTo(p.y);}
    expect(new Set(pool.map(p=>`${p.x>=0},${p.z>=0}`)).size).toBe(4);
  });
  it('uses actual active-player tiers, bounded spawn cadence, no duplicates, no idle accumulation',()=>{
    expect([1,2,3,4,5,6,7,16].map(n=>spawnBalance(n).cap)).toEqual([2,2,3,3,4,4,5,5]);
    expect([1,3,5].map(n=>spawnBalance(n).interval)).toEqual([20000,15000,10000]);
    const pool=Array.from({length:10},(_,i)=>({x:i*8,y:0,z:0})),f=new PowerupField(pool,1,0);let seq=0;
    f.spawn(19999,1,()=>String(++seq),()=>0);expect(f.state.pickups).toHaveLength(0);
    f.spawn(20000,1,()=>String(++seq),()=>0);expect(f.state.pickups).toHaveLength(1);
    f.spawn(60000,1,()=>String(++seq),()=>0);expect(f.state.pickups).toHaveLength(2);
    f.spawn(80000,1,()=>String(++seq),()=>0);expect(f.state.pickups).toHaveLength(2);
    expect(new Set(f.state.pickups.map(p=>p.position.x)).size).toBe(2);
    const pos=f.state.pickups[0].position;expect(f.collect(pos,()=>false)).toBeUndefined();expect(f.collect(pos,()=>true)).toBeDefined();expect(f.collect(pos,()=>true)).toBeUndefined();
    f.spawn(90000,0,()=>String(++seq));expect(f.state.nextSpawn).toBe(110000);
    const restored=new PowerupField(pool,1,91000,JSON.parse(JSON.stringify(f.state)));expect(restored.state).toEqual(f.state);
    expect(new PowerupField(pool,2,91000,f.state).state.pickups).toHaveLength(0);
  });
  it('rotates all three modes and uses FFA winner/MVP/scoring for Powerups',()=>{
    expect(new Set(Array.from({length:100},(_,i)=>roundMode(42,i)))).toEqual(new Set(['ffa','teams','powerups']));
    expect(teammates('powerups','blue','blue')).toBe(false);
    const result=finalizeRound({roundId:1,mapId:'european-town',mode:'powerups',endsAt:600000,players:{a:{id:'a',name:'A',score:100,kills:1,deaths:0,team:null}}},{blue:0,red:0});
    expect(result.winner?.id).toBe('a');expect(result.mvp?.id).toBe('a');expect(result.teamScores).toBeNull();expect(validResult(result)).toBe(true);
  });
  it('strictly validates new messages and rejects client-authored powerups, size and damage',()=>{
    const event={kind:'pickup',id:'p',playerId:'a',life:1,roundId:0,at:1000,position:{x:0,y:0,z:0},pickupId:'cube',ability:'giant'};
    expect(parseServerMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'powerup',event}))).not.toBeNull();
    expect(parseServerMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'powerup',event:{...event,ability:'god'}}))).toBeNull();
    expect(parseClientMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'powerup',event}))).toBeNull();
    expect(parseClientMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'input',roundId:0,mapVersion:'a',frames:[{seq:1,yaw:0,pitch:0,intent:{...NO_INTENT,scale:99},combat:{trigger:false,reload:false}}]}))).toBeNull();
    expect(validMotion({...new PlayerController(ground()).capture(),scale:2})).toBe(false);
  });
});
