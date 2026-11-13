/** Real authoritative damage/results, canonical wallets and durable room outbox. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,frames,aim,ack} from './room-harness.mjs';

for(const mode of ['ffa','teams'])for(const custom of [false,true])test(`match gems: ${mode}, ${custom?'custom room':'public-main'}, confirmed once across restart`,{timeout:45000},async t=>{
 const h=await harness(t,{MATCH_MODE:mode}),tokens=await Promise.all([h.profile(),h.profile(),h.profile()]);
 let ad,room;
 if(custom){ad=await h.create(tokens[0],{mapId:'european-town',mode});room=h.room(ad.room.id);}
 else{ad=await h.admission(tokens[0],{roomId:'public-main'});room=h.central;let state=await room.snapshotForTest();while(state.mapId!=='european-town')state=await room.advanceMapForTest();}
 const a=await h.open(ad,tokens[0]),b=await h.open(await h.admission(tokens[1],{roomId:ad.room.id}),tokens[1]),c=await h.open(await h.admission(tokens[2],{roomId:ad.room.id}),tokens[2]);
 await h.spawn(a,'sniper');await h.spawn(b,'smg');await h.spawn(c,'rifle');
 const arena=await room.directionalArenaForTest();for(const [peer,position]of [[a,arena.sources.front],[b,arena.center],[c,arena.sources.left]]){peer.position=position;await room.placeForCombatTest(peer.id,position);}
 if(mode==='teams'){assert.equal(self(a).team,self(c).team);assert.notEqual(self(a).team,self(b).team);}
 const look=await aim(c,b),mark=c.messages.length;frames(c,{...look,trigger:true});await until(()=>c.messages.slice(mark).some(m=>m.type==='shot'&&m.shot.shooterId===c.id&&m.shot.hits.some(hit=>hit.id===b.id&&[20,21,22].includes(hit.amount))),'actual contributor hit');
 const target=await aim(a,b),p=a.position,q=b.position;target.pitch=Math.atan2(q[1]+1.6-p[1]-1.64,Math.hypot(q[0]-p[0],q[2]-p[2]));frames(a,{...target,trigger:true});await ack(a);
 await until(()=>self(a).kills===1&&a.snapshot.players.find(p=>p.id===c.id)?.assists===1,'real final scoring');
 await room.qualifyMatchGemsForTest([a.id,b.id,c.id]);
 const before=await Promise.all(tokens.map(async token=>(await h.api('/profile',token)).data.profile.gems));
 // A genuine transport drop before the results must not forfeit an earned
 // placement. It still pays the persistent wallet while this browser is absent.
 await room.dropSocketForTest(b.id);await until(()=>b.ws.readyState===3,'victim disconnected before result');
 if(custom)await h.central.loseRewardAckForTest();
 await room.advanceMapForTest();if(custom){await room.flushRoomRewardsForTest().catch(()=>{});await room.flushRoomRewardsForTest();}
 const finished=await until(async()=>{const s=await room.snapshotForTest();return s.result?.gemRewards?s:null;},'durably confirmed gem receipt'),result=finished.result;
 const expected=mode==='ffa'?{[a.id]:10,[c.id]:0,[b.id]:0}:{[a.id]:35,[c.id]:15,[b.id]:0};assert.deepEqual(result.gemRewards.awards,expected);assert.equal(result.gemRewards.matchId,`${ad.room.id}:round:${result.roundId}`);
 const after=await Promise.all(tokens.map(async(token,i)=>{const profile=(await h.api('/profile',token)).data.profile,stats=(await h.api('/stats',token)).data.totals;assert.ok(profile.gems-before[i]>=expected[[a,b,c][i].id]);assert.equal(stats.gems,profile.gems);return profile.gems;}));
 // Repeated result/alarm/outbox reads cannot grant another reward.
 await room.alarmForTest();if(custom)await room.flushRoomRewardsForTest();assert.deepEqual(await Promise.all(tokens.map(async token=>(await h.api('/profile',token)).data.profile.gems)),after);
 const id=a.id,token=a.token;await h.restart();const resumed=await h.open(ad,tokens[0],{resumeToken:token});assert.equal(resumed.id,id);assert.deepEqual(resumed.snapshot.result.gemRewards,result.gemRewards);
 assert.deepEqual(await Promise.all(tokens.map(async token=>(await h.api('/profile',token)).data.profile.gems)),after);
});

test('incomplete/solo online matches confirm zero gems without changing wallets',{timeout:15000},async t=>{
 const h=await harness(t),token=await h.profile();
 // Existing randomized daily MVP/win challenges can independently pay 100 gems
 // even in this short fixture round. Choose the existing combat-only challenge
 // fixture before admission so this assertion isolates match-placement rewards.
 await h.central.prepareRoomChallengesForTest(token);
 const ad=await h.create(token),room=h.room(ad.room.id),a=await h.open(ad,token);await h.spawn(a);const before=(await h.api('/profile',token)).data.profile.gems;
 await room.advanceMapForTest();await room.flushRoomRewardsForTest();const result=(await room.snapshotForTest()).result;assert.equal(result.gemRewards.awards[a.id],0);assert.equal((await h.api('/profile',token)).data.profile.gems,before);
});

test('intentional Leave forfeits placement, preserves standings and does not promote the next player',{timeout:20000},async t=>{
 const h=await harness(t),tokens=[await h.profile(),await h.profile()],ad=await h.create(tokens[0]),room=h.room(ad.room.id);
 const a=await h.open(ad,tokens[0]),b=await h.open(await h.admission(tokens[1],{roomId:ad.room.id}),tokens[1]);await h.spawn(a,'sniper');await h.spawn(b,'smg');
 const arena=await room.directionalArenaForTest();a.position=arena.sources.front;b.position=arena.center;await room.placeForCombatTest(a.id,a.position);await room.placeForCombatTest(b.id,b.position);
 const look=await aim(a,b);look.pitch=Math.atan2(b.position[1]+1.6-a.position[1]-1.64,Math.hypot(b.position[0]-a.position[0],b.position[2]-a.position[2]));frames(a,{...look,trigger:true});await until(()=>self(a).kills===1,'confirmed real elimination');
 await room.qualifyMatchGemsForTest([a.id,b.id]);await h.leave(a);const before=(await h.api('/profile',tokens[0])).data.profile.gems;
 await room.advanceMapForTest();await room.flushRoomRewardsForTest();const result=(await room.snapshotForTest()).result;
 assert.equal(result.players.find(p=>p.id===a.id).score,150);assert.equal(result.gemRewards.awards[a.id],0);assert.equal(result.gemRewards.awards[b.id],0);assert.equal((await h.api('/profile',tokens[0])).data.profile.gems,before);
});
