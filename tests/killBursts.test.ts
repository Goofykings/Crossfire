import {afterEach,beforeEach,expect,it} from 'vitest';
import {NullEngine,Scene,Vector3} from '@babylonjs/core';
import {BURST_BUDGET,KillBursts} from '../src/weapons/KillBursts';
import {setSkinFxLite} from '../src/rendering/SkinFx';
import {KILL_EFFECTS} from '../shared/cosmetics';
import {LegendaryEffects} from '../src/game/LegendaryEffects';
import type {Elimination} from '../shared/protocol';

/** Legendary elimination particles (docs/KILL_EFFECTS.md): budgets, lifecycle and cleanup. Rendering itself is checked in the real engine by
 * tools/kill-effects-test.mjs. */
let engine:NullEngine,scene:Scene,bursts:KillBursts;
beforeEach(()=>{setSkinFxLite(false);engine=new NullEngine();scene=new Scene(engine);bursts=new KillBursts(scene);});
afterEach(()=>{bursts.dispose();scene.dispose();engine.dispose();setSkinFxLite(false);});
const at=()=>new Vector3(3,0,-4);
const counts=()=>{const i=bursts.inspect();return {flowers:i.flowers,petals:i.petals,flakes:i.flakes,sparkles:i.sparkles};};
const total=()=>Object.values(counts()).reduce((a,b)=>a+b,0);
const run=(seconds:number)=>bursts.step(seconds);

it('nothing is drawn and no mesh is enabled until an effect plays',()=>{
  expect(total()).toBe(0);expect(bursts.meshes().every(m=>!m.isEnabled())).toBe(true);
});

it('Blossom spawns only flowers and petals, Frosted only flakes and sparkles, at the event position',()=>{
  bursts.emit('blossom-flower-burst',at());run(.02);
  expect(counts().flowers).toBeGreaterThan(0);expect(counts().petals).toBeGreaterThan(0);expect(counts().flakes+counts().sparkles).toBe(0);
  bursts.clear();bursts.emit('frosted-blizzard',at());run(.02);
  expect(counts().flakes).toBeGreaterThan(0);expect(counts().sparkles).toBeGreaterThan(0);expect(counts().flowers+counts().petals).toBe(0);
  // Every instance matrix translation sits within a couple of metres of the death spot.
  for(const mesh of bursts.meshes().filter(m=>m.isEnabled())){
    const m=mesh.thinInstanceGetWorldMatrices?.()??[];for(const matrix of m){const p=matrix.getTranslation();expect(p.subtract(new Vector3(3,.95,-4)).length()).toBeLessThan(3);}
  }
});

it('every effect ends: no particle, burst or enabled mesh remains after its duration',()=>{
  for(const effect of ['blossom-flower-burst','frosted-blizzard'] as const){
    bursts.emit(effect,at());run(.1);expect(total()).toBeGreaterThan(0);
    run(2.4);expect(total()).toBe(0);expect(bursts.inspect().drawn).toBe(0);
  }
});

it('stacked eliminations stay inside the budget and never grow the pools',()=>{
  const full=BURST_BUDGET.full;
  for(let i=0;i<40;i++){bursts.emit(i%2?'blossom-flower-burst':'frosted-blizzard',at());run(.01);}
  const c=counts();
  expect(c.flowers).toBeLessThanOrEqual(full.flowers*full.bursts);expect(c.petals).toBeLessThanOrEqual(full.petals*full.bursts);
  expect(c.flakes).toBeLessThanOrEqual(full.flakes*full.bursts);expect(c.sparkles).toBeLessThanOrEqual(full.sparkles*full.bursts);
  expect(bursts.inspect().bursts).toBeLessThanOrEqual(full.bursts*2);
  run(2.6);expect(total()).toBe(0);
});

it('Chromebook mode uses the lite budget and opaque pools',()=>{
  setSkinFxLite(true);const lite=BURST_BUDGET.lite;
  for(let i=0;i<30;i++){bursts.emit(i%2?'blossom-flower-burst':'frosted-blizzard',at());run(.01);}
  const c=counts(),info=bursts.inspect();
  expect(info.blended).toBe(false);expect(c.flowers).toBeLessThanOrEqual(lite.flowers*lite.bursts);expect(c.petals).toBeLessThanOrEqual(lite.petals*lite.bursts);
  expect(c.flakes).toBeLessThanOrEqual(lite.flakes*lite.bursts);expect(c.sparkles).toBeLessThanOrEqual(lite.sparkles*lite.bursts);
  expect(lite.flowers+lite.petals).toBeLessThan((BURST_BUDGET.full.flowers+BURST_BUDGET.full.petals)/2);
});

it('reduced motion plays a smaller effect',()=>{
  bursts.emit('blossom-flower-burst',at());run(.3);const normal=counts();bursts.clear();
  bursts.emit('blossom-flower-burst',at(),{reduced:true});run(.3);const calm=counts();
  expect(calm.flowers+calm.petals).toBeLessThan(normal.flowers+normal.petals);
});

it('far viewers beyond the draw distance see nothing, and clear() empties everything at once',()=>{
  bursts.emit('blossom-flower-burst',at(),{distance:400});run(.05);expect(total()).toBe(0);
  bursts.emit('frosted-blizzard',at());run(.05);expect(total()).toBeGreaterThan(0);bursts.clear();expect(total()).toBe(0);expect(bursts.inspect().bursts).toBe(0);
});

it('dispose removes its meshes and materials from the scene',()=>{
  const names=()=>scene.meshes.filter(m=>m.name.startsWith('kill-burst-')).length,mats=()=>scene.materials.filter(m=>m.name.startsWith('kill-burst-')).length;
  expect(names()).toBe(4);expect(mats()).toBe(4);bursts.dispose();expect(names()).toBe(0);expect(mats()).toBe(0);
  bursts=new KillBursts(scene);
});

it('only the two Legendary ids reach the renderer; duplicates and money are ignored',()=>{
  expect(KILL_EFFECTS).toEqual(['money','blossom-flower-burst','frosted-blizzard']);
  const dispatcher=new LegendaryEffects(),seen:string[]=[];dispatcher.onEffect=e=>{seen.push(e.effect);};
  const make=(id:string,effect?:string)=>({id,killerId:'k',victimId:'v',cosmeticEffect:effect?{effect,cosmeticId:'x',position:{x:0,y:0,z:0}}:undefined}) as unknown as Elimination;
  dispatcher.accept(make('a'));dispatcher.accept(make('b','money'));dispatcher.accept(make('c','blossom-flower-burst'));dispatcher.accept(make('c','blossom-flower-burst'));dispatcher.accept(make('d','frosted-blizzard'));
  expect(seen).toEqual(['blossom-flower-burst','frosted-blizzard']);
});
