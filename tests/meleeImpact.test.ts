import {expect,it} from 'vitest';
import {MELEE,meleeKnockback} from '../shared/melee';
import {PlayerController,NO_INTENT} from '../src/player/PlayerController';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {MeleeImpact} from '../src/player/MeleeImpact';
import {MeleeFeedback} from '../src/game/melee/MeleeFeedback';
import {DeathMotion} from '../src/game/DeathMotion';
import type {MeleeResult} from '../shared/protocol';
import fs from 'node:fs';

it('first two authoritative impulses match, third is stronger and controller sweeps walls/floors',()=>{
 const run=(stage:1|2|3,wall=false)=>{const world=new CollisionWorld();world.add({c:[0,-.5,0],h:[8,.5,8]});if(wall)world.add({c:[0,2,-.65],h:[8,2,.1]});
  const p=new PlayerController(world);p.teleport({x:0,y:0,z:0});p.grounded=true;meleeKnockback(p,{x:0,y:0,z:-1},stage);const speed=p.horizontalSpeed;
  for(let i=0;i<120;i++){p.fixedUpdate(1/120,{...NO_INTENT});expect(p.position.y).toBeGreaterThanOrEqual(-.001);expect(world.overlapsCylinder(p.position.x,p.position.z,.32,p.position.y+.45,p.position.y+p.height-.01)).toBe(false);}
  return{speed,z:p.position.z};};
 const first=run(1),second=run(2),third=run(3);expect(first).toEqual(second);expect(third.speed).toBeGreaterThan(first.speed*2);expect(third.z).toBeLessThan(first.z);expect(run(3,true).z).toBeGreaterThan(-.25);
});
it('impulses normalize attack direction and cap accumulated speed without teleporting',()=>{
 const p=new PlayerController(new CollisionWorld()),position={...p.position};for(let i=0;i<100;i++)meleeKnockback(p,{x:100,y:1000,z:0},3);
 expect(p.horizontalSpeed).toBeLessThanOrEqual(8);expect(p.velocity.z).toBe(0);expect(p.position).toEqual(position);
});
it.each([30,60,144])('finite camera response alternates, scales and returns exactly at %s FPS',fps=>{
 const samples=(stage:1|2|3)=>{const effect=new MeleeImpact();effect.hit(stage);const result=[];for(let i=0;i<fps;i++)result.push(effect.update(1/fps));expect(result.at(-1)).toBe(0);return result;};
 const first=samples(1),second=samples(2),third=samples(3);expect(Math.min(...first)).toBeLessThan(0);expect(Math.max(...second)).toBeGreaterThan(0);expect(Math.max(...third.map(Math.abs))).toBeGreaterThan(Math.max(...second));expect(Math.min(...third)).toBeLessThan(0);expect(Math.max(...third)).toBeGreaterThan(0);
 const effect=new MeleeImpact();for(let i=0;i<30;i++){effect.hit(3);expect(Math.abs(effect.update(.02))).toBeLessThan(.2);}effect.hit(3);expect(effect.update(.02,true)).toBe(0);effect.reset();expect(effect.update(0)).toBe(0);
});
it('presentation accepts each timely confirmation once and drops old animation contacts',()=>{
 const feedback=new MeleeFeedback(),event:MeleeResult={id:'confirmed',roundId:1,shooterId:'a',life:1,at:100,stage:3,hits:[]};
 expect(feedback.accept(event,100)).toBe(true);expect(feedback.accept(event,101)).toBe(false);
 expect(feedback.accept({...event,id:'late'},100+MELEE.attacks[2].duration-MELEE.attacks[2].contact+1)).toBe(false);
 expect(feedback.accept({...event,id:'future'},0)).toBe(false);
});
it('finisher death emphasis is once-only, stronger and still collision safe',()=>{
 const run=(emphasize:boolean)=>{const w=new CollisionWorld();w.add({c:[0,-.5,0],h:[8,.5,8]});w.add({c:[0,2,1.7],h:[8,2,.1]});const d=new DeathMotion({x:0,y:0,z:0},{x:0,y:0,z:1},w);if(emphasize){d.emphasize();d.emphasize();}
  for(let i=0;i<240;i++){d.advance(1/120);for(const p of d.points())expect(w.overlapsCylinder(p.x,p.z,.29,p.y-.29,p.y+.29)).toBe(false);}
  const before={...d.center};d.emphasize();d.advance(1/120);expect(Math.hypot(d.center.x-before.x,d.center.z-before.z)).toBeLessThan(.001);return d.center.z;};
 expect(run(true)).toBeGreaterThan(run(false));
});
it('original swooshes are paired short variants, with a longer finisher and crisp impact',()=>{
 const load=(name:string)=>fs.readFileSync(`public/assets/audio/${name}.wav`),duration=(b:Buffer)=>(b.length-44)/b.readUInt32LE(28);
 const a=load('melee_swing1'),b=load('melee_swing2'),third=load('melee_swing3'),impact=load('melee_impact');
 expect(Math.abs(duration(a)-duration(b))).toBeLessThan(.01);expect(a.equals(b)).toBe(false);expect(duration(third)).toBeGreaterThan(duration(a)*1.4);expect(duration(impact)).toBeLessThan(.08);
});
