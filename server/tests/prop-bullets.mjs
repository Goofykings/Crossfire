import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {harness} from './room-harness.mjs';
import {rayBulletMesh} from '../../src/physics/BulletMesh.ts';
const {meshes}=JSON.parse(fs.readFileSync(new URL('../../public/assets/models/shared/props/bullet-surfaces.json',import.meta.url),'utf8'));
for(const [mapId,types]of Object.entries({'european-town':['barrel','crate','bench','market_stall'],'industrial-complex':['workbench','crate_large'],'modern-city':['bench_modern'],'farmstead':['barrel','crate','bench']}))test(`authoritative prop surfaces: ${mapId}`,{timeout:20000},async t=>{
 const h=await harness(t),credential=await h.profile(),admission=await h.create(credential,{mapId}),client=await h.open(admission,credential);assert.equal(client.welcome.type,'welcome');const room=h.room(admission.room.id);
 for(const type of types){const mesh=meshes[type];for(let i=0;i<5;i++){
  const direction=[0,0,-1],origin=[mesh.center[0]+mesh.half[0]*(i-2)*.4,mesh.center[1]+mesh.half[1]*(i-2)*.35,mesh.center[2]+mesh.half[2]+15],expected=rayBulletMesh(mesh,origin.map((v,i)=>v-mesh.center[i]),direction,50),actual=await room.propBulletRayForTest(type,origin,direction,50);
  if(expected){assert.ok(actual,type+' expected surface');assert.ok(Math.abs(actual.distance-expected.distance)<1e-5,type+' exact authoritative hit');assert.ok(Math.abs(Math.hypot(...Object.values(actual.normal))-1)<1e-5);}else assert.equal(actual,null,type+' genuine mesh gap');
 }}
 if(types.includes('barrel'))assert.equal(await room.propBulletRayForTest('barrel',[.29,2,.29],[0,-1,0],4),null,'empty corners never block a bullet in the actual Durable Object');
});
