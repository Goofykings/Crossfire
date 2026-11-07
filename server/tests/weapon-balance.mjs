import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,frames,ack} from './room-harness.mjs';

test('new magazines and shotgun hip/ADS cones use actual authoritative state',{timeout:30000},async t=>{
 const h=await harness(t),token=await h.profile(),ad=await h.create(token),c=await h.open(ad,token);
 await h.spawn(c,'shotgun');const room=h.room(ad.room.id),arena=await room.meleeArenaForTest(.65);await room.placeForCombatTest(c.id,arena.attacker);
 await until(()=>self(c).combat.gun.action==='idle','shotgun ready');
 const fire=async aim=>{const mark=c.messages.length;frames(c,{yaw:0,pitch:0,trigger:true,aim});await ack(c);return until(()=>c.messages.slice(mark).find(m=>m.type==='shot')?.shot,'real shotgun shot');};
 const angle=trace=>{const dx=trace.to.x-trace.from.x,dy=trace.to.y-trace.from.y,dz=trace.to.z-trace.from.z;return Math.acos(Math.max(-1,Math.min(1,-dz/Math.hypot(dx,dy,dz))))*180/Math.PI;};
 const hip=await fire(false);assert.equal(hip.traces.length,14);assert.ok(hip.traces.every(trace=>angle(trace)<=7.7+.001));assert.equal(self(c).combat.gun.ammo,1);
 const mark=c.messages.length;frames(c,{yaw:0,trigger:true});await ack(c);assert.equal(c.messages.slice(mark).filter(m=>m.type==='shot').length,0,'early follow-up cannot bypass authoritative cooldown');
 await until(async()=>{frames(c,{yaw:0,aim:true});await ack(c);return self(c).combat.gun.ads===1&&self(c).combat.gun.cooldown===0;},'real ADS blend and cooldown');
 const ads=await fire(true);assert.equal(ads.traces.length,14);assert.ok(ads.traces.every(trace=>angle(trace)<=4.4+.001),'only authority ADS narrows pellet cone');assert.equal(self(c).combat.gun.ammo,0);
 await until(()=>self(c).combat.gun.ammo===2&&self(c).combat.gun.action==='idle','unchanged shell reload completes');
 await h.leave(c);
 for(const [weapon,capacity]of [['smg',64],['sniper',4]]){const credential=await h.profile(),peer=await h.open(await h.admission(credential,{roomId:ad.room.id}),credential);await h.spawn(peer,weapon);assert.equal(self(peer).combat.gun.ammo,capacity);
  await until(()=>self(peer).combat.gun.action==='idle','equipped '+weapon);frames(peer,{trigger:true});await ack(peer);await until(()=>self(peer).combat.gun.ammo<capacity,'consumed '+weapon+' ammo');
  await until(()=>self(peer).combat.gun.action==='idle'&&self(peer).combat.gun.cooldown===0,'ready to reload '+weapon);frames(peer,{reload:true});await ack(peer);await until(()=>self(peer).combat.gun.ammo===capacity&&self(peer).combat.gun.action==='idle','server reload '+weapon);await h.leave(peer);
 }
});
