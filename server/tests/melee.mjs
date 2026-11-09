import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,frames,ack,origin} from './room-harness.mjs';
import {crateItems} from '../../shared/cosmetics.ts';

for(const mode of ['ffa','teams'])test(`authoritative dual daggers: combo, score, immunity, resume and gun preservation (${mode})`,{timeout:45000},async t=>{
 const h=await harness(t),token=await h.profile(),other=await h.profile(),ad=await h.create(token,{mode});
 let a=await h.open(ad,token);const b=await h.open(await h.admission(other,{roomId:ad.room.id}),other);await h.spawn(a);await h.spawn(b,'smg');
 const room=h.room(ad.room.id),arena=await room.meleeArenaForTest(.65);
 await room.placeForCombatTest(a.id,arena.attacker);await room.placeForCombatTest(b.id,arena.victim);
 await until(()=>self(a).combat.gun.action==='idle','gun equip complete');
 frames(a,{melee:true,yaw:0});await ack(a);await until(()=>self(a).combat.melee?.phase==='ready','equipped daggers').catch(error=>{throw Error(error.message+' '+JSON.stringify({combat:self(a).combat,errors:a.messages.filter(m=>m.type==='error')}));});
 assert.equal(self(a).weapon,'rifle');assert.equal(self(a).combat.gun.ammo,30);
 const attack=async stage=>{const before=a.messages.filter(m=>m.type==='melee').length;frames(a,{trigger:true,yaw:0});await ack(a);const event=await until(()=>a.messages.filter(m=>m.type==='melee')[before]?.event,'confirmed swing '+stage).catch(error=>{throw Error(error.message+' '+JSON.stringify({self:self(a).combat.melee,target:self(b).health,errors:a.messages.filter(m=>m.type==='error')}));});if(stage!==undefined)assert.equal(event.stage,stage);return event;};
 const first=await attack(1);assert.equal(first.hits[0]?.amount,35);await until(()=>self(b).health===65,'first authoritative damage');
 await until(()=>self(b).motion.position.z<arena.victim[2]-.015,'confirmed knockback moves target away from attacker').catch(error=>{throw Error(error.message+' '+JSON.stringify({arena,motion:self(b).motion}));});
 assert.ok(self(b).motion.position.y>=arena.victim[1]-.05,'knockback preserves map floor');
 // Resume the real authenticated session mid-combo; no health/score/gun reset.
 const id=a.id,resume=a.token;a.ws.terminate();await until(()=>a.ws.readyState===3,'real close');
 a=await h.open(await h.admission(token,{roomId:ad.room.id}),token,{resumeToken:resume});assert.equal(a.id,id);assert.equal(a.welcome.resumed,true);assert.equal(self(a).combat.gun.ammo,30);
 // A resumed connection can arrive after the short combo window, so inspect the
 // confirmed phase and begin a fresh deterministic three-hit sequence if necessary.
 // Establish an acknowledged release on the resumed socket before a new press;
 // a welcome snapshot can precede the final queued release from the old socket.
 frames(a,{yaw:0});await ack(a);
 const phase=self(a).combat.melee;assert.notEqual(phase.phase,'hidden');
 // The 350 ms gate can expire after a snapshot but before the new press arrives.
 // Both legal transitions retain the same session, inventory and damage already checked.
 const second=await attack();assert.ok([1,2].includes(second.stage),'resumed press continues stage 2 or starts stage 1 after actual expiry');assert.equal(second.hits[0]?.amount,35);await until(()=>self(b).health===30,'second authoritative damage');
 const third=await attack(second.stage%3+1);assert.equal(third.hits[0]?.amount,30);await until(()=>!self(b).alive&&self(a).score===100,'lethal score and victim snapshot');
 assert.equal(self(a).kills,1);assert.equal(self(b).death.weapon,'melee');assert.equal(self(b).death.head,false);assert.equal(self(b).death.award.total,100);assert.equal(self(a).combat.gun.ammo,30);
 assert.equal(new Set(a.messages.filter(m=>m.type==='melee').map(m=>m.event.id)).size,a.messages.filter(m=>m.type==='melee').length,'one confirmed contact per swing');
 const score=self(a).score;frames(a,{trigger:true,yaw:0});await ack(a);assert.equal(self(a).score,score,'dead body cannot award twice');
 frames(a,{melee:true});await ack(a);await until(()=>self(a).combat.melee.phase==='hidden','put away');assert.equal(self(a).weapon,'rifle');assert.equal(self(a).combat.gun.ammo,30);
 frames(a,{trigger:true});await ack(a);await until(()=>self(a).combat.gun.ammo<30,'same rifle can fire after melee');
 if(mode==='teams'){
  const allyToken=await h.profile(),ally=await h.open(await h.admission(allyToken,{roomId:ad.room.id}),allyToken);await h.spawn(ally);
  // Team assignment balances the living roster; make the relationship explicit.
  assert.equal(self(ally).team,self(a).team);await room.placeForCombatTest(ally.id,arena.victim);await room.placeForCombatTest(a.id,arena.attacker);
  frames(a,{melee:true});await ack(a);await until(()=>self(a).combat.melee.phase==='ready','ally test equip');const noHit=await attack(1);assert.equal(noHit.hits.length,0);assert.equal(self(ally).health,100);await h.leave(ally);
 }
 const stats=(await h.api('/stats',token)).data.totals;assert.equal(stats.kills,1);assert.equal(stats.points,100);
 await h.leave(a);await h.leave(b);
});

test('melee cosmetic starter migration and paired reward pool retain authoritative ownership',{timeout:30000},async t=>{
 const h=await harness(t),token=await h.profile();const inventory=await h.api('/cosmetics',token);assert.ok(inventory.data.owned.includes('default-melee'));assert.equal(inventory.data.equipped.melee,'default-melee');
 const equip=await fetch(new URL('/cosmetics/equip',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({version:1,id:'rich-melee'})});assert.equal(equip.status,403);
 await h.central.inventoryForTest(token,crateItems().filter(c=>c.id!=='rich-melee').map(c=>c.id));await h.central.legacyWalletForStatisticsTest(token,250);
 const body={version:1,requestId:crypto.randomUUID()},open=()=>fetch(new URL('/cosmetics/open',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const r of await Promise.all([open(),open()])){assert.equal(r.status,200);const result=await r.json();assert.equal(result.item,'rich-melee');assert.equal(result.gems,0);assert.equal(result.inventory.owned.length,42);}
 await h.restart();const retried=await open();assert.equal(retried.status,200);assert.equal((await retried.json()).gems,0);
 const equipped=await fetch(new URL('/cosmetics/equip',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({version:1,id:'rich-melee'})});assert.equal(equipped.status,200);assert.equal((await equipped.json()).equipped.melee,'rich-melee');
});

test('real Worker melee obeys close range, forward arc and solid walls',{timeout:30000},async t=>{
 const h=await harness(t),token=await h.profile(),ad=await h.create(token),a=await h.open(ad,token),bToken=await h.profile(),b=await h.open(await h.admission(bToken,{roomId:ad.room.id}),bToken);await h.spawn(a);await h.spawn(b);
 const room=h.room(ad.room.id),arena=await room.directionalArenaForTest();await room.placeForCombatTest(a.id,arena.sources.front);await room.placeForCombatTest(b.id,arena.center);
 await until(()=>self(a).combat.gun.action==='idle','gun settled');frames(a,{melee:true});await ack(a);await until(()=>self(a).combat.melee.phase==='ready','melee ready');
 async function miss(yaw,label){
  // Geometry cases are independent swings, not a combo timing test. Finish the
  // previous swing before pressing again, including its acknowledged release.
  // A busy CI Worker can skip the entire 90 ms contact window: stepMelee then
  // deliberately marks contactDone without publishing an event. Retry only that
  // completed, eventless swing; every actual contact must still miss.
  for(let attempt=0;attempt<3;attempt++){
   await until(()=>self(a).combat.melee.phase==='ready',label+' ready');
   frames(a,{yaw});await ack(a);
   const count=a.messages.filter(m=>m.type==='melee').length,sequence=self(a).combat.melee.sequence;
   frames(a,{trigger:true,yaw});await ack(a);
   const result=await until(()=>{
    const event=a.messages.filter(m=>m.type==='melee')[count]?.event;
    if(event)return {event};
    const state=self(a).combat.melee;
    return state.sequence===sequence+1&&state.phase==='ready'&&state.contactDone?{skipped:true}:null;
   },label);
   assert.equal(self(b).health,100,label);
   if(result.event){assert.equal(result.event.hits.length,0,label);return;}
  }
  assert.fail(label+': Worker skipped the contact window on three consecutive swings; '+JSON.stringify(self(a).combat.melee));
 }
 await miss(Math.PI,'outside short range');
 const close=await room.meleeArenaForTest();await room.placeForCombatTest(a.id,close.attacker);await room.placeForCombatTest(b.id,close.victim);await miss(Math.PI,'target behind attacker');
 const {pair:[p,q]}=await room.meleeWallForTest(),yaw=Math.atan2(-(q[0]-p[0]),-(q[2]-p[2]));await room.placeForCombatTest(a.id,p);await room.placeForCombatTest(b.id,q,(-yaw*180/Math.PI)+90);await miss(yaw,'actual wall blocks a target within melee range');
 await h.leave(a);await h.leave(b);
});

test('a melee finisher shares gun assists and persistent statistics',{timeout:30000},async t=>{
 const h=await harness(t),tokens=await Promise.all([h.profile(),h.profile(),h.profile()]),ad=await h.create(tokens[0]),a=await h.open(ad,tokens[0]),b=await h.open(await h.admission(tokens[1],{roomId:ad.room.id}),tokens[1]),helper=await h.open(await h.admission(tokens[2],{roomId:ad.room.id}),tokens[2]);
 for(const c of [a,b,helper])await h.spawn(c);const room=h.room(ad.room.id),arena=await room.meleeArenaForTest(),position=await room.smokeObservationForTest({x:arena.victim[0],y:arena.victim[1],z:arena.victim[2]});
 await room.placeManyForCombatTest([{id:a.id,pos:arena.attacker},{id:b.id,pos:arena.victim},{id:helper.id,pos:position}]);await until(()=>[a,b,helper].every(c=>self(c).combat.gun.action==='idle'),'weapons ready');
 const dx=arena.victim[0]-position[0],dz=arena.victim[2]-position[2],yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(arena.victim[1]+.9-position[1]-1.64,Math.hypot(dx,dz));
 // This is an assist test, not a randomized hip-fire accuracy test. Wait for the
 // actual ADS state before firing along the fixture's clear narrow sightline.
 await until(async()=>{frames(helper,{yaw,pitch,aim:true});await ack(helper);return self(helper).combat.gun.ads>=.99;},'helper authoritative ADS');
 const shotMark=helper.messages.length;frames(helper,{trigger:true,yaw,pitch,aim:true});await ack(helper);
 const shot=await until(()=>helper.messages.slice(shotMark).find(m=>m.type==='shot')?.shot,'helper confirmed shot');
 assert.equal(shot.hits[0]?.id,b.id,JSON.stringify(shot));assert.ok([20,21,22].includes(shot.hits[0].amount));const damagedHealth=100-shot.hits[0].amount;
 await until(()=>self(b).health===damagedHealth,'real helper rifle damage');
 frames(a,{melee:true,yaw:0});await ack(a);await until(()=>self(a).combat.melee.phase==='ready','melee equipped');
 for(const hp of [damagedHealth-35,damagedHealth-70,0]){frames(a,{trigger:true,yaw:0});await ack(a);await until(()=>self(b).health===hp,'confirmed melee damage '+hp).catch(error=>{throw Error(error.message+' '+JSON.stringify({health:self(b).health,expected:hp,melee:self(a).combat.melee,events:a.messages.filter(m=>m.type==='melee').slice(-3)}));});}
 await until(()=>self(a).score===100&&self(helper).score===50,'authoritative points');assert.equal(self(helper).assists,1);assert.equal(self(b).death.assists[0].id,helper.id);assert.equal(self(b).death.weapon,'melee');
 await until(async()=>{const stats=(await h.api('/stats',tokens[2])).data.totals;return stats.assists===1&&stats.points===50;},'persistent assist statistics');for(const c of [a,b,helper])await h.leave(c);
});
