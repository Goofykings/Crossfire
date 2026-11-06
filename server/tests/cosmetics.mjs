import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,frames,ack,origin} from './room-harness.mjs';
const defaults=['default-rifle','default-smg','default-sniper','default-shotgun'];

test('cosmetics: real capability inventory, starter migration, strict equip, unaffordable crate, wallet/statistics preservation',{timeout:30000},async t=>{
 const h=await harness(t),token=await h.profile();await h.central.legacyWalletForStatisticsTest(token,37);
 const request=async(path='/cosmetics',body,credential=token)=>{const r=await fetch(new URL(path,h.base),{method:body?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+credential,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.headers.get('Content-Type')?.includes('application/json')?await r.json():await r.text()};};
 const career=(await h.api('/profile',token)).data.profile,stats=(await h.api('/stats',token)).data.totals;
 const a=await request();assert.equal(a.status,200);assert.deepEqual(a.data.owned,defaults);assert.equal(a.data.version,1);assert.equal(Object.keys(a.data.equipped).length,4);
 assert.equal((await request('/cosmetics',undefined,'b'.repeat(64))).status,401);
 for(const [body,status]of [[{version:1,id:'not-owned'},403],[{version:1,id:'default-rifle',owned:['gold']},400],[{version:1,id:'default-rifle',gems:100000},400],[{version:2,id:'default-rifle'},400]])assert.equal((await request('/cosmetics/equip',body)).status,status);
 const results=await Promise.all(defaults.map(id=>request('/cosmetics/equip',{version:1,id})));assert.ok(results.every(r=>r.status===200));assert.deepEqual((await request()).data.equipped,a.data.equipped);
 for(const path of ['/crates/open','/shop/open','/purchase'])assert.equal((await request(path,{version:1})).status,404);
 assert.equal((await request('/cosmetics/open',{version:1})).status,409,'37 gems cannot buy a 300-gem crate');
 const after=(await h.api('/profile',token)).data.profile;assert.equal(after.gems,37);for(const key of ['gems','revision','daily','weekly'])assert.deepEqual(after[key],career[key]);assert.deepEqual((await h.api('/stats',token)).data.totals,stats);
 assert.equal((await fetch(new URL('/cosmetics',h.base),{headers:{Origin:'https://hostile.invalid',Authorization:'Bearer '+token}})).status,403);
 await h.restart();const restored=await request();assert.deepEqual(restored.data.owned,defaults);assert.deepEqual(restored.data.equipped,a.data.equipped);assert.equal((await h.api('/profile',token)).data.profile.gems,37);
});

test('cosmetics: both public and custom-room snapshots carry validated equipment without combat or reconnect resets',{timeout:30000},async t=>{
 const h=await harness(t),aToken=await h.profile(),bToken=await h.profile(),ad=await h.create(aToken);
 let a=await h.open(ad,aToken),b=await h.open(await h.admission(bToken,{roomId:ad.room.id}),bToken);await h.spawn(a,'rifle');await h.spawn(b,'sniper');
 await until(()=>a.snapshot.players.some(p=>p.id===b.id&&p.cosmeticId==='default-sniper'),'remote cosmetic');assert.equal(self(a).cosmeticId,'default-rifle');
 frames(a,{trigger:true});await ack(a);await until(()=>self(a).combat.gun.ammo===29&&self(a).combat.gun.cooldown===0,'real shot and settled cooldown');
 const original=self(a),r=await fetch(new URL('/cosmetics/equip',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+aToken,'Content-Type':'application/json'},body:JSON.stringify({version:1,id:'default-rifle'})});assert.equal(r.status,200);
 const live=await h.room(ad.room.id).snapshotForTest(),p=live.players.find(p=>p.id===a.id);for(const key of ['health','weapon','life','kills','deaths','team'])assert.deepEqual(p[key],original[key]);assert.equal(p.combat.gun.ammo,29);
 const previous=a;a=await h.open(ad,aToken,{resumeToken:a.token,roomTicket:undefined});assert.equal(a.id,previous.id);assert.equal(self(a).cosmeticId,'default-rifle');assert.equal(self(a).combat.gun.ammo,29);assert.equal(a.snapshot.players.length,2);
 await h.leave(a);await h.leave(b);const pub=await h.open(await h.admission(aToken,{roomId:'public-main'}),aToken);await h.spawn(pub,'shotgun');assert.equal(self(pub).cosmeticId,'default-shotgun');
});

test('cosmetics: server crate spends gems and grants one unowned item atomically, never duplicates',{timeout:60000},async t=>{
 const h=await harness(t),token=await h.profile();await h.central.legacyWalletForStatisticsTest(token,650);
 const request=async(path,body)=>{const r=await fetch(new URL(path,h.base),{method:body?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 const stats=(await h.api('/stats',token)).data.totals;
 for(const body of [{version:1,id:'rich-rifle'},{version:1,rarity:'legendary'},{version:2},{version:1,gems:0}])assert.equal((await request('/cosmetics/open',body)).status,400,JSON.stringify(body));
 const opened=[];
 for(const left of [350,50]){const r=await request('/cosmetics/open',{version:1});assert.equal(r.status,200);assert.equal(r.data.gems,left);
  assert.match(r.data.item,/^(green-camo|blue-camo|red-camo|marble|rainbow-glow|rich)-(rifle|smg|sniper|shotgun)$/);assert.ok(!opened.includes(r.data.item),'no duplicate');opened.push(r.data.item);
  assert.ok(r.data.inventory.owned.includes(r.data.item));assert.equal(r.data.inventory.version,1);}
 const broke=await request('/cosmetics/open',{version:1});assert.equal(broke.status,409);
 const inv=await request('/cosmetics');for(const id of opened)assert.ok(inv.data.owned.includes(id));assert.equal(inv.data.owned.length,6);
 assert.equal((await h.api('/profile',token)).data.profile.gems,50);assert.deepEqual((await h.api('/stats',token)).data.totals,stats,'spending never changes lifetime earned statistics');
 const item=opened[0],weapon=item.split('-').pop();const eq=await request('/cosmetics/equip',{version:1,id:item});assert.equal(eq.status,200);assert.equal(eq.data.equipped[weapon],item);
 await h.restart();const restored=await request('/cosmetics');for(const id of opened)assert.ok(restored.data.owned.includes(id));assert.equal(restored.data.equipped[weapon],item);assert.equal((await h.api('/profile',token)).data.profile.gems,50);
});
