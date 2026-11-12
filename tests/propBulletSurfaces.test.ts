import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Ray,Vector3} from '@babylonjs/core';
import surfaces from '../public/assets/models/shared/props/bullet-surfaces.json';
import catalog from '../public/assets/models/shared/props/props.json';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {rayBulletMesh,opaqueAt,type BulletMesh} from '../src/physics/BulletMesh';
import {propImpactMark,MARK_OFFSET,MARK_VERTICES} from '../src/physics/ImpactMark';
import {MAP_IDS} from '../shared/maps';
import {WORLDS} from '../server/src/world';
import {traceWeaponShot} from '../shared/hitscan';
import {WEAPONS} from '../src/weapons/Weapon';
const meshes=surfaces.meshes as Record<string,BulletMesh>;
const fixture=(type:string,yaw=0,position=[0,0,0])=>{const world=new CollisionWorld(),size=(catalog.props as Record<string,{collider:number[]|null}>)[type].collider!;const box=world.add({c:[position[0],position[1]+size[1]/2,position[2]],h:size.map(v=>v/2) as [number,number,number],yaw,tag:type});world.addBulletSurface(meshes[type],position,yaw,type,[box]);return {world,box};};
it('generated surfaces are current for every solid GLB and extraction is deterministic',()=>{
 for(const [file,sha]of Object.entries(surfaces.sources))expect(createHash('sha256').update(readFileSync((file.startsWith('assets/')?'public/':'public/assets/models/shared/props/')+file)).digest('hex'),file).toBe(sha);
 expect(execFileSync(process.execPath,['tools/generate-bullet-surfaces.mjs','--check'],{encoding:'utf8'})).toContain('match all solid');
});
it('barrel silhouettes miss empty box corners but curved sides and inside-out rays hit the actual surface',()=>{
 const {world,box}=fixture('barrel');
 expect(world.raycast(.29,2,.29,0,-1,0,4)?.collider).toBe(box);
 expect(world.raycastBullet(.29,2,.29,0,-1,0,4)).toBeNull();
 const hit=world.raycastBullet(.2,.45,2,0,0,-1,4)!;expect(hit.point.z).toBeLessThan(.3);expect(hit.point.z).toBeGreaterThan(.15);expect(hit.normal.x).toBeGreaterThan(.2);expect(Math.hypot(...Object.values(hit.normal))).toBeCloseTo(1);
 expect(world.raycastBullet(0,.45,0,1,0,0,4)?.distance).toBeGreaterThan(.25);
 expect(world.overlapsCylinder(.29,.29,.05,0,.8)).toBe(true);
});
it('nearest hits, rotated offsets, crate faces, bench gaps, pipe profiles and angled metal are exact',()=>{
 for(const type of ['crate','bench','pipe_bundle','dumpster','cable_reel','electrical_cabinet']){
  const mesh=meshes[type],{world}=fixture(type,.7,[8,2,-4]),o=[.17,(type==='bench'?.46-mesh.center[1]:mesh.half[1]*.27),mesh.half[2]+3],d=[0,0,-1],local=rayBulletMesh(mesh,o,d,10);expect(local,type).not.toBeNull();
  const c=Math.cos(.7),s=Math.sin(.7),point=o.map((v,i)=>v+mesh.center[i]);const actual=world.raycastBullet(8+point[0]*c+point[2]*s,2+point[1],-4-point[0]*s+point[2]*c,-s,0,-c,10)!;expect(actual.distance,type).toBeCloseTo(local!.distance,5);
 }
 const bench=fixture('bench').world;expect(bench.raycast(0,.15,2,0,0,-1,4)).not.toBeNull();expect(bench.raycastBullet(0,.15,2,0,0,-1,4)).toBeNull();
 const barrel=fixture('barrel').world;barrel.add({c:[0,.45,1],h:[1,.45,.1]});expect(barrel.raycastBullet(0,.45,3,0,0,-1,5)?.point.z).toBeCloseTo(1.1);
});
it('BVH agrees with independent brute triangle intersection for all solid prop categories at varied angles and range',()=>{
 let compared=0;for(const [type,mesh]of Object.entries(meshes)){if(!mesh.indices.length)continue;
  for(let i=0;i<8;i++){const a=i*.79,o=new Vector3(Math.cos(a)*(mesh.half[0]+10),(.5-i/9)*mesh.half[1],Math.sin(a)*(mesh.half[2]+10)),d=o.scale(-1).normalize(),ray=new Ray(o,d,100);let nearest=Infinity;
   for(let j=0;j<mesh.indices.length;j+=3){const p=[0,1,2].map(k=>Vector3.FromArray(mesh.vertices,mesh.indices[j+k]*3));const hit=ray.intersectsTriangle(p[0],p[1],p[2]);if(hit&&hit.distance>1e-6&&opaqueAt(mesh,j/3,hit.bv!,1-hit.bu!-hit.bv!))nearest=Math.min(nearest,hit.distance);}
   const actual=rayBulletMesh(mesh,o.asArray(),d.asArray(),100);if(Number.isFinite(nearest)){expect(actual?.distance,type).toBeCloseTo(nearest,5);compared++;}else expect(actual,type).toBeNull();
  }
 }expect(compared).toBeGreaterThan(600);
},20000);
it('curved and edge decals are clipped to real triangles with bounded geometry and millimetre offsets',()=>{
 for(const type of ['barrel','crate','pipe_bundle','dumpster','bench']){
  const {world}=fixture(type);const mesh=meshes[type],hit=world.raycastBullet(mesh.center[0]+mesh.half[0]*.4,type==='bench'?.46:mesh.center[1],mesh.half[2]+3,0,0,-1,10);if(!hit)throw Error('Missing representative hit '+type);
  const mark=propImpactMark(hit,.11,.4)!;expect(mark.positions.length,type).toBeGreaterThan(0);expect(mark.positions.length/3).toBeLessThanOrEqual(MARK_VERTICES);
  for(let i=0;i<mark.positions.length;i+=3){const p=mark.positions.slice(i,i+3),n=mark.normals.slice(i,i+3),at=world.raycastBullet(p[0]+n[0]*.01,p[1]+n[1]*.01,p[2]+n[2]*.01,-n[0],-n[1],-n[2],.03);expect(at,type).not.toBeNull();expect(at!.distance,type).toBeCloseTo(.01+MARK_OFFSET,4);}
  expect(mark.uvs.every(v=>v>=-1e-6&&v<=1+1e-6)).toBe(true);
 }
});
it.each(MAP_IDS)('%s retains all movement solids and indexes every colliding prop for bullets',id=>{
 const world=WORLDS[id].world;expect([...world.all()].filter(c=>c.solid).every(c=>!c.bulletOnly)).toBe(true);
 const props=[...world.all()].filter(c=>c.tag.startsWith('prop:')&&c.solid);expect(props.length).toBeGreaterThan(0);expect(props.every(c=>c.bulletReplacement)).toBe(true);
 expect([...world.all()].filter(c=>c.bulletOnly).every(c=>!c.solid&&!!c.bulletMesh)).toBe(true);
});
it('shared real hitscan ends on curved cover instead of a movement box',()=>{
 const {world}=fixture('barrel'),stats=WEAPONS.find(w=>w.id==='sniper')!;
 const traces=traceWeaponShot(world,{x:.2,y:.45,z:3},0,0,stats,0,()=>[],()=>{throw Error('No target');},undefined,()=>.5);
 expect(traces[0].to.z).toBeLessThan(.3);expect(traces[0].to.z).toBeGreaterThan(.15);
});
import {PlayerController,NO_INTENT} from '../src/player/PlayerController';
import {FIXED_DT} from '../src/config/constants';
it.each(MAP_IDS)('%s bullet geometry leaves movement trajectories and queries unchanged',id=>{
 const world=WORLDS[id].world,old=new CollisionWorld();old.ladders.push(...world.ladders);old.slidePassages.push(...world.slidePassages);
 for(const c of world.all())if(!c.bulletOnly)old.add({c:[c.cx,c.cy,c.cz],h:[c.hx,c.hy,c.hz],yaw:c.yaw,tag:c.tag},{solid:c.solid,shootable:c.shootable});
 expect(world.query(-100,-20,-100,100,40,100).some(c=>c.bulletOnly)).toBe(false);
 const spawn=WORLDS[id].layout.spawns[0];for(const weapon of ['rifle','sniper','shotgun','smg'] as const){const a=new PlayerController(world),b=new PlayerController(old);for(const p of [a,b]){p.teleport({x:spawn.pos[0],y:spawn.pos[1],z:spawn.pos[2]},spawn.heading);p.weaponClearance=weapon;}
  for(let i=0;i<240;i++){const intent={...NO_INTENT,x:i%80<40?1:-1,z:i%120<80?1:0,jumpPressed:i===120,slide:i>20&&i<30};a.fixedUpdate(FIXED_DT,intent);b.fixedUpdate(FIXED_DT,intent);}expect(a.capture()).toEqual(b.capture());
 }
});
it('bounded indexed rays remain practical across real maps (local timing diagnostic)',()=>{
 const metrics:Record<string,number>={};for(const id of MAP_IDS){const {world,layout}=WORLDS[id],spawn=layout.spawns[0],[x,y,z]=spawn.pos;for(let i=0;i<100;i++)world.raycastBullet(x,y+1,z,Math.sin(i),0,Math.cos(i),100);const start=performance.now();for(let i=0;i<1000;i++)world.raycastBullet(x,y+1,z,Math.sin(i*.1),0,Math.cos(i*.1),100);metrics[id]=performance.now()-start;expect(metrics[id]).toBeLessThan(2000);}console.log('1000 shared bullet rays (ms)',metrics);
});
it('alpha-cut openings never stop bullets; opaque mask pixels and later solid surfaces still do',()=>{
 const mesh:BulletMesh={center:[0,0,0],half:[1,1,.01],vertices:[-1,-1,0,1,-1,0,1,1,0,-1,1,0],indices:[0,1,2,0,2,3],masks:[{width:2,height:2,bits:'AQ==',tile:1,flipY:false}],masked:{0:{mask:0,uv:[0,0,1,0,1,1]},1:{mask:0,uv:[0,0,1,1,0,1]}}};
 expect(rayBulletMesh(mesh,[-.5,-.5,2],[0,0,-1],5)?.distance).toBe(2);
 expect(rayBulletMesh(mesh,[.5,-.5,2],[0,0,-1],5)).toBeNull();
 const world=new CollisionWorld(),box=world.add({c:[0,0,0],h:[1,1,.01]});world.addBulletSurface(mesh,[0,0,0],0,'cutout',[box]);world.add({c:[0,0,-2],h:[1,1,.1],tag:'backing'});
 expect(world.raycastBullet(.5,-.5,2,0,0,-1,5)?.collider.tag).toBe('backing');expect(world.raycastBullet(-.5,-.5,2,0,0,-1,5)?.surfaceMasked).toBe(true);
});
it('long-range and oblique rays preserve exact prop silhouettes and nearest surfaces',()=>{
 const {world}=fixture('barrel');for(const distance of [2,15,75,150]){
  const front=world.raycastBullet(.2,.45,distance,0,0,-1,distance+5)!;expect(front.point.z).toBeGreaterThan(.15);expect(front.point.z).toBeLessThan(.3);
  const o=[distance,.45,distance],d=[-1/Math.SQRT2,0,-1/Math.SQRT2];const hit=world.raycastBullet(...o as [number,number,number],...d as [number,number,number],distance*2)!;expect(hit).not.toBeNull();expect(Math.hypot(hit.point.x,hit.point.z)).toBeCloseTo(.3,1);
  expect(world.raycastBullet(.29,distance,.29,0,-1,0,distance+2)).toBeNull();
 }
});
