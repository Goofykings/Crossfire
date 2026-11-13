import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,frames,ack,aim,origin} from './room-harness.mjs';
import {PROTOCOL_VERSION} from '../../tools/protocol-version.mjs';
const request=async(h,path,token,body)=>{const response=await fetch(new URL(path,h.base),{method:body?'POST':'GET',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
test('canonical hourly pricing: real purchases, stale quotes, concurrent receipts, restart and retired Darkness inventory',{timeout:30000},async t=>{
 const h=await harness(t),token=await h.profile();await h.central.legacyWalletForStatisticsTest(token,1000);await h.central.retiredInventoryForTest(token);
 const inventory=(await request(h,'/cosmetics',token)).data;assert.ok(!inventory.owned.some(id=>id.startsWith('darkness-')));assert.ok(inventory.owned.includes('blossom-shotgun'));assert.equal(inventory.equipped.rifle,'default-rifle');assert.equal(inventory.equipped.melee,'default-melee');
 assert.equal((await request(h,'/cosmetics/equip',token,{version:1,id:'darkness-rifle'})).status,403);assert.equal((await request(h,'/cosmetics/open',token,{version:1,requestId:'retired-darkness'})).status,409);assert.equal((await h.api('/profile',token)).data.profile.gems,1000);
 await h.central.saleForTest(true,169);const offer=(await request(h,'/cosmetics/offer')).data;assert.equal(offer.windows[0].price,169);assert.deepEqual((await request(h,'/cosmetics/offer')).data.windows,offer.windows);
 assert.equal((await request(h,'/cosmetics/open',token,{version:1,requestId:'forged',expectedPrice:100})).status,409);assert.equal((await h.api('/profile',token)).data.profile.gems,1000);
 const body={version:1,requestId:'sale-once',expectedPrice:169};const results=await Promise.all([request(h,'/cosmetics/open',token,body),request(h,'/cosmetics/open',token,body)]);
 for(const r of results){assert.equal(r.status,200);assert.equal(r.data.chargedPrice,169);assert.equal(r.data.gems,831);}assert.equal(results[0].data.item,results[1].data.item);
 await h.central.saleForTest(false);const expired=await request(h,'/cosmetics/open',token,{...body,requestId:'expired'});assert.equal(expired.status,409);assert.equal((await request(h,'/cosmetics/open',token,body)).data.chargedPrice,169);
 const regular=await request(h,'/cosmetics/open',token,{version:1,requestId:'normal',expectedPrice:250});assert.equal(regular.status,200);assert.equal(regular.data.chargedPrice,250);assert.equal(regular.data.gems,581);
 const windows=(await request(h,'/cosmetics/offer')).data.windows;await h.restart();assert.deepEqual((await request(h,'/cosmetics/offer')).data.windows,windows);assert.equal((await request(h,'/cosmetics/open',token,body)).data.gems,581);assert.equal((await h.api('/profile',token)).data.profile.gems,581);
});
test('verified developer metadata, authoritative Legendary elimination and expired-session participant continuity',{timeout:45000},async t=>{
 const h=await harness(t),tokens=[await h.profile(),await h.profile()],account=(await h.api('/profile',tokens[0])).data.profile.accountId;assert.match(account,/^[a-f0-9]{64}$/);
 await h.restart({DEVELOPER_ACCOUNT_IDS:account});assert.equal((await h.api('/profile',tokens[0])).data.profile.developer,true);assert.equal((await h.api('/profile',tokens[1])).data.profile.developer,false);
 await h.central.inventoryForTest(tokens[0],['blossom-sniper']);assert.equal((await request(h,'/cosmetics/equip',tokens[0],{version:1,id:'blossom-sniper'})).status,200);
 const ad=await h.create(tokens[0]);let a=await h.open(ad,tokens[0],{name:'Twin'});const b=await h.open(await h.admission(tokens[1],{roomId:ad.room.id}),tokens[1],{name:'Twin'}),room=h.room(ad.room.id);await h.spawn(a,'sniper');await h.spawn(b,'rifle');
 assert.equal(self(a).developer,true);assert.equal(self(b).developer,false);a.send({type:'chat',text:'Verified'});await until(()=>b.messages.find(m=>m.type==='chat'&&m.text==='Verified'&&m.developer===true),'decorated chat');
 const arena=await room.directionalArenaForTest();a.position=arena.sources.front;b.position=arena.center;await room.placeForCombatTest(a.id,a.position);await room.placeForCombatTest(b.id,b.position);
 const look=await aim(a,b);look.pitch=Math.atan2(b.position[1]+1.6-a.position[1]-1.64,Math.hypot(b.position[0]-a.position[0],b.position[2]-a.position[2]));frames(a,{...look,trigger:true});
 const event=await until(()=>b.messages.find(m=>m.type==='elimination'&&m.elimination.victimId===b.id)?.elimination,'confirmed Legendary elimination');assert.equal(event.cosmeticEffect.effect,'blossom-flower-burst');assert.equal(event.cosmeticEffect.cosmeticId,'blossom-sniper');assert.equal(event.killerDeveloper,true);assert.equal(event.victimDeveloper,false);assert.ok(Math.hypot(event.cosmeticEffect.position.x-b.position[0],event.cosmeticEffect.position.z-b.position[2])<.1);
 const oldId=a.id,oldLife=self(a).life;await room.dropSocketForTest(a.id);await until(()=>a.ws.readyState===3,'dropped socket');await until(async()=>!(await room.snapshotForTest()).players.some(p=>p.id===oldId),'server observed drop');await room.retireSessionForTest(oldId);
 a=await h.open(await h.admission(tokens[0],{roomId:ad.room.id}),tokens[0],{name:'Twin'});assert.equal(a.id,oldId);assert.equal(self(a).kills,1);assert.equal(self(a).score,event.award.total);assert.equal(self(a).life,oldLife);assert.equal(self(a).alive,false);await h.spawn(a,'rifle');assert.equal(self(a).life,oldLife+1);
 await room.qualifyMatchGemsForTest([a.id,b.id]);await room.advanceMapForTest();await room.flushRoomRewardsForTest();const result=(await room.snapshotForTest()).result;assert.equal(result.players.length,2);assert.equal(new Set(result.players.map(p=>p.id)).size,2);assert.equal(result.players.filter(p=>p.name==='Twin').length,2);assert.equal(result.players.find(p=>p.id===a.id).kills,1);assert.equal(result.players.find(p=>p.id===a.id).developer,true);
 await room.alarmForTest();assert.deepEqual((await room.snapshotForTest()).result,result);
 const board=await h.api('/leaderboard?period=all&stat=kills',tokens[0]);assert.equal(board.data.rows.find(r=>r.local).developer,true);
 assert.equal((await h.api('/health')).data.protocol,PROTOCOL_VERSION);
});
test('Farmstead roof landings replicate through the real Worker to two peers',{timeout:30000},async t=>{
 const h=await harness(t),tokens=[await h.profile(),await h.profile()],ad=await h.create(tokens[0],{mapId:'farmstead'}),room=h.room(ad.room.id),a=await h.open(ad,tokens[0]),b=await h.open(await h.admission(tokens[1],{roomId:ad.room.id}),tokens[1]);await h.spawn(a);await h.spawn(b);
 const roofs=await room.roofPositionsForTest();assert.ok(roofs.length>=8);
 for(const roof of roofs){const [x,y,z]=roof.position;await room.placeForCombatTest(a.id,[x,y+.7,z]);await until(()=>self(a).motion.grounded&&Math.abs(self(a).motion.position.y-y)<.05,'roof landing '+roof.tag);await until(()=>b.snapshot.players.some(p=>p.id===a.id&&p.motion.grounded&&Math.abs(p.motion.position.y-y)<.05&&Math.hypot(p.motion.position.x-x,p.motion.position.z-z)<.05),'peer sees roof landing');}
 const bounds=await room.farmBoundaryForTest();
 // Walk into the visible west fence from above the stone, while airborne.
 await room.placeForCombatTest(a.id,[bounds[0]+.7,6,-30]);
 for(let i=0;i<12;i++){const seq=frames(a,{yaw:Math.PI/2,z:1});await ack(a,seq);}
 assert.equal(self(a).alive,true);assert.ok(self(a).motion.position.x>bounds[0]);
 await until(()=>b.snapshot.players.some(p=>p.id===a.id&&p.motion.position.x>bounds[0]&&Math.abs(p.motion.position.z+30)<.1),'peer sees contained roof approach');
 // Secondary safety remains available for an already invalid position; it is
 // not the normal containment mechanism, and never awards an opponent a kill.
 await room.placeForCombatTest(a.id,[bounds[2]+.02,6,0]);await until(()=>!self(a).alive,'invalid position recovery');assert.equal(self(a).health,0);assert.equal(self(b).kills,0);assert.equal(self(a).death.award,null);
});
