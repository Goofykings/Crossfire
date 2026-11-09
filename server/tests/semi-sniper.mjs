import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,ack,origin} from './room-harness.mjs';
import {PROTOCOL_VERSION as v} from '../../tools/protocol-version.mjs';
for(const privacy of ['public','private'])test(`semi-auto sniper: real ${privacy} room, held fire, damage, score, reload, duplicate protection and resume`,{timeout:35000},async t=>{
 const h=await harness(t),owner=await h.profile(),guest=await h.profile(),ad=await h.create(owner,{privacy});
 const admit=token=>h.admission(token,privacy==='private'?{code:ad.room.code}:{roomId:ad.room.id});
 const a=await h.open(ad,owner),b=await h.open(await admit(guest),guest);await h.spawn(a,'semi-sniper');await h.spawn(b,'rifle');
 const room=h.room(ad.room.id);assert.equal(self(a).combat.gun.ammo,15);assert.equal(self(a).cosmeticId,'default-semi-sniper');
 const place=async()=>{await room.placeForCombatTest(a.id,[-3,0,2]);await room.placeForCombatTest(b.id,[-3,0,-2]);};await place();
 let head=false;
 const batch=async(trigger,{reload=false,alternating=false}={})=>{
  const frames=Array.from({length:6},(_,k)=>({seq:++a.seq,yaw:0,pitch:Math.atan2((head?1.6:.9)-1.64,4),intent:{x:0,z:0,slide:false,aim:true,jumpPressed:false},combat:{trigger:alternating?k%2===0:trigger,reload}}));
  const message={v,type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,frames};a.send(message);await ack(a);return message;
 };
 await until(async()=>{await batch(false);return self(a).combat.gun.ads===1&&self(a).combat.gun.action==='idle';},'real ADS ready');
 const firstMark=a.messages.length;await batch(true);
 const first=await until(()=>a.messages.slice(firstMark).find(m=>m.type==='shot')?.shot,'confirmed body shot');
 assert.equal(first.weapon,'semi-sniper');assert.equal(first.hits.length,1);assert.equal(first.hits[0].id,b.id);assert.ok([32,33,34,35].includes(first.hits[0].amount));assert.equal(first.hits[0].head,false);
 for(let i=0;i<10;i++)await batch(true);
 assert.equal(a.messages.slice(firstMark).filter(m=>m.type==='shot').length,1,'holding across packets cannot repeat');assert.equal(self(a).combat.gun.ammo,14);
 await until(()=>b.messages.some(m=>m.type==='shot'&&m.shot.id===first.id),'peer shot/audio presentation event');
 await until(()=>self(b).health===100-first.hits[0].amount,'peer health synchronization');
 const macroMark=a.messages.length,ammoBefore=self(a).combat.gun.ammo;const duplicate=await batch(false,{alternating:true});
 a.send(duplicate);await until(()=>a.messages.some(m=>m.type==='error'&&m.code==='stale_input'),'duplicate packet rejected');
 assert.ok(a.messages.slice(macroMark).filter(m=>m.type==='shot').length<=1,'alternating six-frame burst cannot bypass rate');assert.ok(self(a).combat.gun.ammo>=ammoBefore-1);
 while(self(b).alive){await until(async()=>{await batch(false);return self(a).combat.gun.cooldown===0;},'next legal press');await batch(true);}
 await until(()=>self(a).score===100&&self(a).kills===1,'authoritative body elimination score');
 const death=self(b).death;assert.equal(death.weapon,'semi-sniper');assert.equal(death.head,false);assert.equal(death.award.base,100);
 await until(()=>Date.now()>=death.respawnAt,'respawn eligible');await h.spawn(b,'rifle');await place();head=true;
 const shots=[];
 for(let i=0;i<2;i++){
  await until(async()=>{await batch(false);return self(a).combat.gun.cooldown===0;},'headshot press ready');const mark=a.messages.length;await batch(true);
  const shot=await until(()=>a.messages.slice(mark).find(m=>m.type==='shot')?.shot,'headshot');assert.equal(shot.hits[0].amount,50);assert.equal(shot.hits[0].head,true);shots.push(shot);
 }
 await until(()=>!self(b).alive&&self(a).kills===2,'two exact head hits kill');assert.equal(self(b).death.weapon,'semi-sniper');assert.equal(self(b).death.award.headshot,50);
 assert.ok(b.messages.some(m=>m.type==='elimination'&&m.elimination.weapon==='semi-sniper'),'kill feed receives the fifth weapon');
 await batch(false,{reload:true});await until(()=>self(a).combat.gun.action==='idle'&&self(a).combat.gun.ammo===15,'partial authoritative reload');
 await batch(false);await batch(true);const remaining=self(a).combat.gun.ammo,identity=a.id,token=a.token;a.ws.close();await until(()=>a.ws.readyState===3,'transport closed');
 const resumed=await h.open(await admit(owner),owner,{resumeToken:token});assert.equal(resumed.id,identity);assert.equal(self(resumed).weapon,'semi-sniper');assert.equal(self(resumed).combat.gun.ammo,remaining);assert.equal(self(resumed).kills,2);assert.equal(resumed.snapshot.players.filter(p=>p.id===identity).length,1);
 const stats=(await h.api('/stats',owner)).data;assert.equal(stats.totals.kills,2);
 const inventory=await fetch(new URL('/cosmetics',h.base),{headers:{Origin:origin,Authorization:'Bearer '+owner}});const owned=await inventory.json();assert.ok(owned.owned.includes('default-semi-sniper'));assert.equal(owned.equipped['semi-sniper'],'default-semi-sniper');
});

test('semi-auto default migrates a persisted old inventory without spending gems, resetting skins or changing statistics',{timeout:15000},async t=>{
 const h=await harness(t),token=await h.profile();await h.central.inventoryForTest(token,['rich-rifle']);await h.central.legacyWalletForStatisticsTest(token,37);
 const request=async(id)=>{const r=await fetch(new URL(id?'/cosmetics/equip':'/cosmetics',h.base),{method:id?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+token,...(id?{'Content-Type':'application/json'}:{})},...(id?{body:JSON.stringify({version:1,id})}:{})});assert.equal(r.status,200);return r.json();};
 await request('rich-rifle');const revision=await h.central.legacyInventoryForSemiSniperTest(token),profile=(await h.api('/profile',token)).data.profile,stats=(await h.api('/stats',token)).data.totals;
 const restored=await request();assert.ok(restored.owned.includes('default-semi-sniper'));assert.equal(restored.equipped['semi-sniper'],'default-semi-sniper');assert.equal(restored.equipped.rifle,'rich-rifle');assert.equal(restored.revision,revision);assert.equal(restored.owned.length,7);
 const equipped=await request('default-semi-sniper');assert.equal(equipped.equipped['semi-sniper'],'default-semi-sniper');await h.restart();const saved=await request();assert.deepEqual(saved.owned,restored.owned);assert.deepEqual(saved.equipped,restored.equipped);
 const after=(await h.api('/profile',token)).data.profile;
 const {serverTime:beforeTime,...beforeState}=profile,{serverTime:afterTime,...afterState}=after;
 assert.deepEqual(afterState,beforeState);assert.ok(afterTime>=beforeTime);assert.equal(profile.gems,37);assert.deepEqual((await h.api('/stats',token)).data.totals,stats);
});
