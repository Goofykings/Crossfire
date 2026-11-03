import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerController, NO_INTENT } from '../src/player/PlayerController';
import { GRENADE, advanceGrenade, blastDamage, sweepSphere, throwGrenade, type GrenadeState } from '../shared/grenades';
import { defaultBindings, sanitizeBindings, bindingConflict } from '../src/config/keybindings';
import { parseClientMessage, parseServerMessage, PROTOCOL_VERSION } from '../shared/protocol';
import { WeaponMotion } from '../src/weapons/WeaponMotion';
import { MOVEMENT, FIXED_DT } from '../src/config/constants';

const floor = () => { const w = new CollisionWorld(); w.add({ c:[0,-.5,0],h:[30,.5,30] }); return w; };
const projectile = (patch: Partial<GrenadeState> = {}): GrenadeState => ({ id:'g',ownerId:'a',ownerLife:1,roundId:0,
  at:1000,explodeAt:3000,updatedAt:1000,position:{x:0,y:1.54,z:-.38},velocity:{x:0,y:1.5,z:-7.8},...patch });
describe('continuous shared grenade physics', () => {
  it('uses elapsed time and stops at the two second fuse', () => {
    const a=projectile(),b=projectile(),w=floor();
    advanceGrenade(a,3000,w); for(let t=1050;t<=3000;t+=50)advanceGrenade(b,t,w);
    expect(a.position.x).toBeCloseTo(b.position.x,5); expect(a.position.z).toBeCloseTo(b.position.z,5);
    expect(a.position.y).toBeCloseTo(b.position.y,5); expect(a.updatedAt).toBe(3000);
    const before=structuredClone(a);advanceGrenade(a,10000,w);expect(a).toEqual(before);
  });
  it('bounces and settles above a floor without tunneling', () => {
    const g=projectile({velocity:{x:1,y:-70,z:0}});advanceGrenade(g,1100,floor());
    expect(g.position.y).toBeGreaterThanOrEqual(GRENADE.radius);expect(g.velocity.y).toBeGreaterThan(0);
    const settled=projectile();advanceGrenade(settled,3000,floor());expect(settled.position.y).toBeGreaterThanOrEqual(GRENADE.radius-.001);
    expect(Math.hypot(settled.velocity.x,settled.velocity.z)).toBeLessThan(.1);
  });
  it.each([0,Math.PI/4])('sweeps a thin wall at yaw %s', yaw => {
    const w=floor();w.add({c:[0,1.5,-2],h:[4,2,.005],yaw});
    const hit=sweepSphere(w,{x:0,y:1,z:0},{x:0,y:0,z:-10},GRENADE.radius);
    expect(hit).not.toBeNull();expect(hit!.fraction).toBeLessThan(.21);
    const g=projectile({velocity:{x:0,y:0,z:-70}});advanceGrenade(g,1100,w);
    expect(g.position.x*Math.sin(yaw)+(g.position.z+2)*Math.cos(yaw)).toBeGreaterThan(GRENADE.radius);
    expect(g.velocity.x*Math.sin(yaw)+g.velocity.z*Math.cos(yaw)).toBeGreaterThan(0);
  });
  it('validates body-to-lean and forward throw origins against solids', () => {
    const w=floor(),eye={x:0,y:1.64,z:0},d={x:0,y:0,z:-1},zero={x:0,y:0,z:0},data={id:'g',ownerId:'a',ownerLife:1,roundId:0,at:1};
    expect(throwGrenade(w,eye,eye,d,zero,data)?.explodeAt).toBe(2001);
    w.add({c:[0,1,-.2],h:[2,1,.02]});
    const g=throwGrenade(w,eye,eye,d,zero,data);expect(g === null || g.position.z>-.12).toBe(true);
    expect(throwGrenade(w,{...eye,z:-.4},eye,d,zero,data)).toBeNull();
  });
  it.each([0, -.2, -.45])('roughly doubles practical throw range at pitch %s without changing blast balance', pitch => {
    const eye={x:0,y:1.64,z:0},direction={x:0,y:-Math.sin(pitch),z:-Math.cos(pitch)};
    const g=throwGrenade(floor(),eye,eye,direction,{x:0,y:0,z:0},{id:'g',ownerId:'a',ownerLife:1,roundId:0,at:1000})!;
    const old=structuredClone(g);
    old.velocity={x:direction.x*7.8,y:direction.y*7.8+GRENADE.lift,z:direction.z*7.8};
    advanceGrenade(g,g.explodeAt,floor());advanceGrenade(old,old.explodeAt,floor());
    const ratio=(Math.abs(g.position.z)-.38)/(Math.abs(old.position.z)-.38);
    expect(ratio).toBeGreaterThan(1.8);expect(ratio).toBeLessThan(2.8);
    expect(GRENADE.damage).toBe(100);expect(GRENADE.damageRadius).toBe(1.8);expect(GRENADE.fuseMs).toBe(2000);
  });
});
describe('authoritative radial damage', () => {
  it('caps at 100, falls linearly and reaches zero at 1.8m', () => {
    const w=floor(),motion=new PlayerController(w).capture(),at={x:0,y:.065,z:0};
    expect(blastDamage(w,at,motion)).toBe(100);
    motion.position.x=1e-14;expect(blastDamage(w,at,motion)).toBe(100);
    motion.position.x=.9;expect(blastDamage(w,at,motion)).toBeCloseTo(50);
    motion.position.x=1.8;expect(blastDamage(w,at,motion)).toBe(0);
  });
  it('uses actual lowered/airborne body extents and solid occlusion', () => {
    const w=floor(),m=new PlayerController(w).capture();m.position.x=1;
    expect(blastDamage(w,{x:0,y:.1,z:0},m)).toBeGreaterThan(0);
    w.add({c:[.5,1,0],h:[.015,1,1]});expect(blastDamage(w,{x:0,y:.1,z:0},m)).toBe(0);
    m.position={x:0,y:3,z:0};expect(blastDamage(floor(),{x:0,y:.1,z:0},m)).toBe(0);
    m.position.y=0;m.crouch=1;expect(blastDamage(floor(),{x:0,y:2.7,z:0},m)).toBeLessThan(blastDamage(floor(),{x:0,y:2.7,z:0},{...m,crouch:0}));
  });
});
describe('held crouch and existing controls', () => {
  it('lowers smoothly, slows walking and returns only with headroom', () => {
    const w=floor(),p=new PlayerController(w);p.teleport({x:0,y:0,z:0},0);
    p.fixedUpdate(FIXED_DT,{...NO_INTENT,crouch:true});expect(p.crouch).toBeGreaterThan(0);expect(p.crouch).toBeLessThan(1);
    for(let i=0;i<120;i++)p.fixedUpdate(FIXED_DT,{...NO_INTENT,crouch:true,z:1});
    expect(p.height).toBeCloseTo(MOVEMENT.crouchHeight);expect(p.horizontalSpeed).toBeCloseTo(MOVEMENT.crouchSpeed);
    w.add({c:[p.position.x,1.6,p.position.z],h:[2,.2,2]});
    for(let i=0;i<120;i++)p.fixedUpdate(FIXED_DT,NO_INTENT);expect(p.height).toBeLessThan(1.41);
    p.position.x=6;for(let i=0;i<120;i++)p.fixedUpdate(FIXED_DT,NO_INTENT);expect(p.height).toBe(MOVEMENT.standHeight);
  });
  it('turns the crouched weapon outward at the hip and restores exact ADS alignment', () => {
    const stand=new WeaponMotion(),crouch=new WeaponMotion();
    const input={speed:0,grounded:true,sliding:false,crouch:0,ads:0,sprinting:false};
    for(let i=0;i<60;i++){stand.update(1/60,input);crouch.update(1/60,{...input,crouch:1});}
    expect(crouch.pose.yaw-stand.pose.yaw).toBeGreaterThan(.04);
    expect(crouch.pose.roll-stand.pose.roll).toBeLessThan(-.04);
    for(let i=0;i<60;i++){stand.update(1/60,{...input,ads:1});crouch.update(1/60,{...input,crouch:1,ads:1});}
    expect(crouch.pose).toEqual(stand.pose);
  });
  it('migrates the old factory R reload, preserving a customized R binding', () => {
    const old=defaultBindings() as Record<string,string[]>;delete old.grenade;delete old.crouch;old.reload=['KeyR'];
    expect(sanitizeBindings(old).grenade).toEqual(['KeyG']);expect(sanitizeBindings(old).reload).toEqual(['KeyR']);
    old.forward=['KeyI'];const custom=sanitizeBindings(old);
    expect(custom.reload).toEqual(['KeyR']);expect(custom.forward).toEqual(['KeyI']);expect(custom.grenade).toEqual(['KeyG']);
    expect(bindingConflict(custom,'grenade',['KeyR'])).toBe('reload');expect(sanitizeBindings(custom)).toEqual(custom);
  });
});
describe('strict grenade/crouch wire protocol', () => {
  it('accepts held input but rejects client grenade positions and invalid versions', () => {
    const frame={seq:1,yaw:0,pitch:0,intent:{...NO_INTENT,crouch:true},combat:{trigger:false,reload:false,grenade:true}};
    const input={v:PROTOCOL_VERSION,type:'input',roundId:0,mapVersion:'test',frames:[frame]};
    expect(parseClientMessage(JSON.stringify(input))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({...input,v:PROTOCOL_VERSION-1}))).toBeNull();
    expect(parseClientMessage(JSON.stringify({...input,frames:[{...frame,combat:{...frame.combat,position:{x:0,y:0,z:0}}}]}))).toBeNull();
  });
  it('validates fuse, bounds, damage and unique victims', () => {
    const event={kind:'throw',id:'throw:g',projectile:projectile()},message={v:PROTOCOL_VERSION,type:'grenade',event};
    expect(parseServerMessage(JSON.stringify(message))).not.toBeNull();
    expect(parseServerMessage(JSON.stringify({...message,event:{...event,projectile:projectile({explodeAt:2000})}}))).toBeNull();
    const hit={id:'b',life:1,amount:100,health:0,killed:true,direction:{x:0,y:1,z:0}};
    const blast={kind:'explode',id:'blast:g',grenadeId:'g',ownerId:'a',ownerLife:1,roundId:0,at:3000,position:{x:0,y:0,z:0},hits:[hit]};
    expect(parseServerMessage(JSON.stringify({...message,event:blast}))).not.toBeNull();
    expect(parseServerMessage(JSON.stringify({...message,event:{...blast,hits:[hit,hit]}}))).toBeNull();
    expect(parseServerMessage(JSON.stringify({...message,event:{...blast,hits:[{...hit,amount:101}]}}))).toBeNull();
  });
});
