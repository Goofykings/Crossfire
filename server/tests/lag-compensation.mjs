import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {harness,until,self,frames,ack} from './room-harness.mjs';

test('real Worker hits the recent displayed position, limits old claims and retains solid-wall blocking',{timeout:30000},async t=>{
 const h=await harness(t),token=await h.profile(),ad=await h.create(token),a=await h.open(ad,token),other=await h.profile(),b=await h.open(await h.admission(other,{roomId:ad.room.id}),other);
 await h.spawn(a);await h.spawn(b);
 const room=h.room(ad.room.id),arena=await room.directionalArenaForTest();
 await room.placeManyForCombatTest([{id:a.id,pos:arena.sources.front},{id:b.id,pos:arena.center}]);
 const yaw=Math.PI,pitch=Math.atan2(.9-1.64,2.2);
 await until(async()=>{frames(a,{yaw,pitch,aim:true});await ack(a);return self(a).combat.gun.ads>.99;},'authoritative ADS');
 const displayed=a.snapshot.serverTime;
 await room.placeForCombatTest(b.id,arena.sources.right);
 const mark=a.messages.length;frames(a,{yaw,pitch,aim:true,trigger:true,viewTime:displayed});await ack(a);
 const shot=await until(()=>a.messages.slice(mark).find(m=>m.type==='shot')?.shot,'historical shot');
 assert.equal(shot.hits[0]?.id,b.id,'The recent rendered body is hittable after the current body has moved sideways');
 await until(()=>self(b).health<100,'authoritative historical damage');
 const health=self(b).health;
 await delay(350); // The old body must be outside even the maximum rewind budget.
 await until(()=>self(a).combat.gun.cooldown===0,'next legal shot');
 const next=a.messages.length;frames(a,{yaw,pitch,aim:true,trigger:true,viewTime:1});await ack(a);
 const stale=await until(()=>a.messages.slice(next).find(m=>m.type==='shot')?.shot,'bounded old claim');
 assert.equal(stale.hits.length,0,'An arbitrarily old timestamp cannot recover a retired target pose');assert.equal(self(b).health,health);
 const {pair:[p,q]}=await room.meleeWallForTest();await room.placeManyForCombatTest([{id:a.id,pos:p},{id:b.id,pos:q}]);
 const wallYaw=Math.atan2(-(q[0]-p[0]),-(q[2]-p[2])),wallPitch=Math.atan2(q[1]+.9-p[1]-1.64,Math.hypot(q[0]-p[0],q[2]-p[2]));
 await until(()=>self(a).combat.gun.cooldown===0,'wall shot ready');
 const wallMark=a.messages.length;frames(a,{yaw:wallYaw,pitch:wallPitch,aim:true,trigger:true,viewTime:a.snapshot.serverTime});await ack(a);
 const blocked=await until(()=>a.messages.slice(wallMark).find(m=>m.type==='shot')?.shot,'wall shot');
 assert.equal(blocked.hits.length,0,'Historical hitboxes never bypass the actual wall raycast');assert.equal(self(b).health,health);
});
