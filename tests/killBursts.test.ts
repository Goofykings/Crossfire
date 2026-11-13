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
/** Live instance positions straight from each thin-instance matrix buffer (getWorldMatrices caches the first read). */
const positions=()=>bursts.meshes().filter(m=>m.isEnabled()&&m.thinInstanceCount>0).flatMap(m=>{
  const data=(m as unknown as {_thinInstanceDataStorage:{matrixData:Float32Array}})._thinInstanceDataStorage.matrixData,out:Vector3[]=[];
  for(let i=0;i<m.thinInstanceCount;i++)out.push(new Vector3(data[i*16+12],data[i*16+13],data[i*16+14]));return out;});
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

it('2026-11-13 budgets: Blossom +50%, Frosted x2, each burst really spawns that many',()=>{
  const full=BURST_BUDGET.full;
  expect([full.flowers,full.petals]).toEqual([39,66]);expect([full.flakes]).toEqual([108]);
  bursts.emit('blossom-flower-burst',at());run(.05);expect(counts().flowers).toBe(full.flowers);expect(counts().petals).toBe(full.petals);bursts.clear();
  bursts.emit('frosted-blizzard',at());run(.05);expect(counts().flakes).toBe(full.flakes);expect(counts().sparkles).toBe(full.sparkles);
});

it('Blossom starts inside the body column and bursts out; pieces turn and fall at different rates',()=>{
  bursts.emit('blossom-flower-burst',at());run(.05);
  const near=positions();
  expect(near.length).toBeGreaterThan(90);
  for(const p of near){expect(Math.hypot(p.x-3,p.z+4)).toBeLessThan(.45);expect(p.y).toBeGreaterThan(.05);expect(p.y).toBeLessThan(1.9);}
  run(1.2);
  const later=positions();
  const reach=later.map(p=>Math.hypot(p.x-3,p.z+4)).sort((x,y)=>x-y);
  expect(reach[Math.floor(reach.length*.9)]).toBeGreaterThan(1.2);   // it has expanded well past the body (0.3 m column)
  expect(reach.reduce((x,y)=>x+y,0)/reach.length).toBeGreaterThan(.6);
  const heights=new Set(later.map(p=>Math.round(p.y*20)));expect(heights.size).toBeGreaterThan(8);   // not one falling sheet
});

it('Frosted trails: curved ribbons for a portion of the flakes, in one mesh, gone with the effect',()=>{
  const full=BURST_BUDGET.full,trailMesh=bursts.meshes().find(m=>m.name==='kill-burst-trail')!;
  bursts.emit('frosted-blizzard',at());run(.4);
  let i=bursts.inspect();
  expect(i.trails).toBe(full.trails);expect(i.trails).toBeLessThan(full.flakes/2);expect(trailMesh.isEnabled()).toBe(true);
  // The whole index list stays drawn (a shortened sub-mesh range loses its bounding info and breaks Babylon's transparent sort); unused ribbons are zeroed.
  expect(trailMesh.subMeshes[0].indexCount).toBe(i.trailCapacity*full.trailSegments*6);expect(trailMesh.subMeshes[0].IsGlobal).toBe(true);
  const pos=trailMesh.getVerticesData('position')!,stride=(full.trailSegments+1)*6;
  expect(Array.from(pos.slice(full.trails*stride)).every((v)=>v===0)).toBe(true);
  expect(Array.from(pos.slice(0,full.trails*stride)).every(Number.isFinite)).toBe(true);
  // A ribbon is narrow and bends: its centre line is not straight (curvature) while each cross-section stays thin.
  const mid=(k:number)=>[0,1,2].map(a=>(pos[k*6+a]+pos[k*6+3+a])/2);
  const width=(k:number)=>Math.hypot(pos[k*6]-pos[k*6+3],pos[k*6+1]-pos[k*6+4],pos[k*6+2]-pos[k*6+5]);
  for(let k=0;k<=full.trailSegments;k++)expect(width(k)).toBeLessThan(.05);
  const a=mid(0),b=mid(Math.floor(full.trailSegments/2)),c=mid(full.trailSegments);
  const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],bc=[c[0]-b[0],c[1]-b[1],c[2]-b[2]];
  const cross=Math.hypot(ab[1]*bc[2]-ab[2]*bc[1],ab[2]*bc[0]-ab[0]*bc[2],ab[0]*bc[1]-ab[1]*bc[0]);
  expect(cross).toBeGreaterThan(1e-5);
  run(2);i=bursts.inspect();expect(i.trails).toBe(0);expect(trailMesh.isEnabled()).toBe(false);
});

it('Chromebook mode: fewer, shorter, opaque trails; nothing stacks past the ribbon capacity',()=>{
  setSkinFxLite(true);const lite=BURST_BUDGET.lite,trailMesh=bursts.meshes().find(m=>m.name==='kill-burst-trail')!;
  bursts.emit('frosted-blizzard',at());run(.4);
  const i=bursts.inspect();
  expect(i.trails).toBe(lite.trails);expect(i.trailSegments).toBe(lite.trailSegments);expect(trailMesh.hasVertexAlpha).toBe(false);
  expect(lite.trails*lite.trailSegments).toBeLessThan(BURST_BUDGET.full.trails*BURST_BUDGET.full.trailSegments/6);
  for(let n=0;n<30;n++){bursts.emit('frosted-blizzard',at());run(.02);}
  expect(bursts.inspect().trails).toBeLessThanOrEqual(i.trailCapacity);run(2.5);expect(bursts.inspect().drawn).toBe(0);
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
  expect(names()).toBe(5);expect(mats()).toBe(5);bursts.dispose();expect(names()).toBe(0);expect(mats()).toBe(0);
  bursts=new KillBursts(scene);
});

it('only the two Legendary ids reach the renderer; duplicates and money are ignored',()=>{
  expect(KILL_EFFECTS).toEqual(['money','blossom-flower-burst','frosted-blizzard']);
  const dispatcher=new LegendaryEffects(),seen:string[]=[];dispatcher.onEffect=e=>{seen.push(e.effect);};
  const make=(id:string,effect?:string)=>({id,killerId:'k',victimId:'v',cosmeticEffect:effect?{effect,cosmeticId:'x',position:{x:0,y:0,z:0}}:undefined}) as unknown as Elimination;
  dispatcher.accept(make('a'));dispatcher.accept(make('b','money'));dispatcher.accept(make('c','blossom-flower-burst'));dispatcher.accept(make('c','blossom-flower-burst'));dispatcher.accept(make('d','frosted-blizzard'));
  expect(seen).toEqual(['blossom-flower-burst','frosted-blizzard']);
});
