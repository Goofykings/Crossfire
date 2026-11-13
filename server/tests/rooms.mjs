import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {harness,until,self,frames,ack,aim,origin} from './room-harness.mjs';
import {PROTOCOL_VERSION as v} from '../../tools/protocol-version.mjs';

test('rooms: actual admission, private authorization, capacity races and isolation',{timeout:45000},async t=>{
 const h=await harness(t),tokens=await Promise.all(Array.from({length:7},()=>h.profile()));
 const main=(await h.api('/rooms')).data.rooms;assert.equal(main[0].id,'public-main');assert.equal(main[0].maxPlayers,10);
 const legacy=await h.open(await h.admission(tokens[6],{roomId:'public-main'}),tokens[6]);
 const [a,b]=await Promise.all([h.create(tokens[0],{name:' <Test>  Room ',maxPlayers:2}),h.create(tokens[1],{privacy:'private',mapId:'industrial-complex',mode:'teams'})]);
 assert.equal(a.room.name,'Test Room');assert.match(b.room.code,/^\d{6}$/);assert.notEqual(a.room.id,b.room.id);
 const list=(await h.api('/rooms')).data.rooms;assert.ok(list.some(r=>r.id===a.room.id));assert.ok(!list.some(r=>r.id===b.room.id));assert.ok(list.every(r=>!('code'in r)));
 assert.equal((await h.api('/rooms/join',tokens[2],{roomId:b.room.id})).status,403);
 const denied=await h.open(b,tokens[2],{roomTicket:undefined});assert.equal(denied.welcome.code,'room_authorization');
 const stolen=await h.open(b,tokens[2]);assert.equal(stolen.welcome.type,'error');assert.equal(legacy.ws.readyState,1,'rejected cross-object claim does not reset canonical room');
 const host=await h.open(a,tokens[0]);assert.equal(host.welcome.type,'welcome');assert.equal(self(host).alive,false,'joining never spawns early');
 const authorizations=await Promise.all([2,3].map(i=>h.admission(tokens[i],{roomId:a.room.id})));
 const race=await Promise.all(authorizations.map((ad,i)=>h.open(ad,tokens[i+2])));assert.equal(race.filter(c=>c.welcome.type==='welcome').length,1);assert.equal(race.find(c=>c.welcome.type==='error').welcome.code,'room_full');
 assert.ok(!(await h.api('/rooms')).data.rooms.some(r=>r.id===a.room.id));assert.equal((await h.api('/rooms/join',tokens[4],{roomId:a.room.id})).status,409);
 const guest=await h.open(await h.admission(tokens[4],{code:b.room.code}),tokens[4]),privateHost=await h.open(b,tokens[1]);
 await until(()=>guest.snapshot.roomInfo.hostId===privateHost.id,'creator is initial host even when a guest connects first');
 assert.equal(privateHost.snapshot.mapId,'industrial-complex');assert.equal(privateHost.snapshot.match.mode,'teams');
 assert.equal(guest.snapshot.room,b.room.id);assert.ok(guest.snapshot.players.every(p=>![host.id,...race.map(c=>c.id)].includes(p.id)));
 const msg='Isolated chat '+crypto.randomUUID();privateHost.send({type:'chat',text:msg});await until(()=>guest.messages.some(m=>m.type==='chat'&&m.text===msg),'room chat');assert.ok(!host.messages.some(m=>m.type==='chat'&&m.text===msg));
 await h.spawn(privateHost);frames(privateHost,{grenade:true,pitch:-1.4});await ack(privateHost);frames(privateHost,{pitch:-1.4});await until(()=>guest.messages.some(m=>m.type==='grenade'&&m.event.kind==='explode'),'isolated real grenade');assert.ok(!host.messages.some(m=>m.type==='grenade'||m.type==='elimination'));
 const old=(await h.room(a.room.id).snapshotForTest()).endsAt;await h.room(b.room.id).setRemainingForTest(10000);assert.equal((await h.room(a.room.id).snapshotForTest()).endsAt,old,'timers independent');
 assert.equal((await h.api('/rooms',tokens[0],{name:'Invalid',privacy:'public',mapId:'invalid',mode:'powerups',maxPlayers:11})).status,400);assert.equal(legacy.ws.readyState,1);
 for(let i=0;i<9;i++){const r=await h.api('/rooms/join',tokens[5],{code:'999999'});assert.equal(r.status,i>=7?429:404);}
 assert.equal((await fetch(new URL('/rooms',h.base),{headers:{Origin:'https://hostile.invalid'}})).status,403);
 const extra=await h.create(tokens[1],{privacy:'private'});assert.notEqual(extra.room.code,b.room.code);assert.equal((await h.api('/rooms',tokens[1],{name:'Over limit',privacy:'public',mapId:'modern-city',mode:'ffa',maxPlayers:6})).status,429);
 await h.leave(privateHost);await until(()=>guest.snapshot.roomInfo.hostId===guest.id,'deterministic host transfer');
 const expires=await h.create(tokens[5],{mapId:'modern-city'});await h.central.expireRoomTicketForTest(expires.ticket);const expired=await h.open(expires,tokens[5]);assert.equal(expired.welcome.type,'error');
 assert.equal(host.ws.readyState,1);assert.equal(legacy.ws.readyState,1);
});

test('rooms: authoritative kills, durable reward retries and statistics across rooms',{timeout:50000},async t=>{
 const h=await harness(t),aToken=await h.profile(),bToken=await h.profile(),cToken=await h.profile();
 const gems=await h.central.prepareRoomChallengesForTest(aToken),ad=await h.create(aToken);let r=h.room(ad.room.id);
 let a=await h.open(ad,aToken),b=await h.open(await h.admission(bToken,{roomId:ad.room.id}),bToken);await h.spawn(a,'sniper');await h.spawn(b);
 async function kill(){const arena=await r.directionalArenaForTest();a.position=arena.sources.front;b.position=arena.center;await r.placeForCombatTest(a.id,a.position);await r.placeForCombatTest(b.id,b.position);const look=await aim(a,b);
  {const mark=a.messages.length;frames(a,{...look,trigger:true});const e=await until(()=>a.messages.slice(mark).find(m=>m.type==='shot'&&m.shot.shooterId===a.id),'confirmed sniper shot');assert.equal(e.shot.hits[0]?.amount,100);await ack(a);}
  await until(()=>self(a).score===100,'kill score');}

 await h.central.loseRewardAckForTest();await kill();
 await until(async()=>((await h.api('/stats',aToken)).data.totals.kills===1),'canonical kill despite lost acknowledgment');
 const oldA=a,oldB=b;await h.restart();r=h.room(ad.room.id);a=await h.open(ad,aToken,{resumeToken:oldA.token,roomTicket:undefined});b=await h.open(ad,bToken,{resumeToken:oldB.token,roomTicket:undefined});assert.equal(a.id,oldA.id);assert.equal(self(a).kills,1);
 await r.flushRoomRewardsForTest();await r.replayRoomRewardsForTest();assert.equal((await h.api('/stats',aToken)).data.totals.kills,1);
 let profile=(await h.api('/profile',aToken)).data.profile;assert.ok(profile.gems>gems);const awardedGems=profile.gems;
 assert.ok(a.messages.some(m=>m.type==='career'&&m.profile.gems===awardedGems),'only canonical reward shown to client');
 const resumed=await h.open(ad,aToken,{resumeToken:a.token,roomTicket:undefined});assert.equal(resumed.id,a.id);a=resumed;assert.equal(self(a).score,100);assert.equal(self(a).kills,1);assert.equal(a.snapshot.players.length,2);
 const other=await h.create(cToken,{mapId:'modern-city'}),otherRoom=h.room(other.room.id),c=await h.open(other,cToken);await h.spawn(c);
 assert.equal((await h.api('/rooms/join',aToken,{roomId:other.room.id})).status,200,'listing/admission is not membership');
 const cannotOverlap=await h.open(await h.admission(aToken,{roomId:other.room.id}),aToken);assert.equal(cannotOverlap.welcome.type,'error');assert.equal(c.ws.readyState,1);
 // Transport loss conservatively abandons that round under the existing rules.
 const fresh=await r.advanceMapForTest();await until(()=>a.snapshot.roundId===fresh.roundId,'fresh post-resume round');await h.spawn(a,'sniper');
 await r.qualifyRoomRoundForTest(a.id);await r.advanceMapForTest();await r.flushRoomRewardsForTest();assert.equal((await h.api('/stats',aToken)).data.totals.games,1);await h.leave(a);await h.leave(b);
 a=await h.open(await h.admission(aToken,{roomId:other.room.id}),aToken);await h.spawn(a,'sniper');assert.equal(self(a).score,0,'per-room score starts independently');
 const firstGlobal=(await h.api('/stats',aToken)).data.totals;
 assert.equal(firstGlobal.kills,1);assert.equal(firstGlobal.points,100);assert.equal((await h.api('/profile',aToken)).data.profile.gems,awardedGems,'wallet survives room switch');
 await otherRoom.qualifyRoomRoundForTest(a.id);await otherRoom.advanceMapForTest();await otherRoom.flushRoomRewardsForTest();assert.equal((await h.api('/stats',aToken)).data.totals.games,2,'round zero in two different rooms both count exactly once');const ranking=(await h.api('/leaderboard?period=all&stat=points',aToken)).data;assert.equal(ranking.own.value,100);
 assert.ok(c.snapshot.players.every(p=>p.id!==b.id));
});

test('rooms: server lifecycle deadlines, AFK validation, no-op resistance and rejoining',{timeout:45000},async t=>{
 const h=await harness(t),p=await h.profile(),q=await h.profile();
 const ad=await h.create(p,{privacy:'private'}),r=h.room(ad.room.id),a=await h.open(ad,p);
 const s=await r.ageRoomForTest(61000);assert.ok(s.warningAt<Date.now());assert.ok(s.closesAt>Date.now());assert.ok(s.closesAt-s.warningAt===30000);
 await r.ageRoomForTest(91000);await r.alarmForTest();await until(()=>a.messages.some(m=>m.type==='room_exit'&&m.reason==='closed'),'solo closure');
 assert.equal((await h.api('/rooms/join',q,{code:ad.room.code})).status,404);
 const live=await h.create(q),rr=h.room(live.room.id),b=await h.open(live,q),aa=await h.open(await h.admission(p,{roomId:live.room.id}),p);
 await rr.ageRoomForTest(200000);assert.equal((await rr.roomStatus()).closesAt,null,'one guest permanently cancels solo timeout');
 await rr.ageActivityForTest(b.id,46000);await rr.alarmForTest();assert.equal(b.ws.readyState,1,'loading/selection exempt from 45s gameplay timer');
 await h.spawn(b);frames(b);await ack(b);await rr.ageActivityForTest(b.id,31000);frames(b,{reload:true});await ack(b);const inactive=await rr.snapshotForTest();assert.ok(inactive.players.find(x=>x.id===b.id).afkDeadline-Date.now()<15000,'full-mag reload and no-op frames cannot reset activity');
 frames(b,{yaw:.3});await ack(b);assert.ok(self(b).afkDeadline-Date.now()>44000,'validated looking resets activity');
 frames(b,{x:1});await ack(b);await rr.ageActivityForTest(b.id,31000);for(let i=0;i<4;i++){frames(b,{x:1});await delay(50);}await ack(b);assert.ok(self(b).afkDeadline-Date.now()<15000,'constant held input cannot keep alive');
 await rr.ageActivityForTest(b.id,46000);await rr.alarmForTest();await until(()=>b.messages.some(m=>m.type==='room_exit'&&m.reason==='afk'),'AFK kick');
 const rejoined=await h.open(await h.admission(q,{roomId:live.room.id}),q);assert.equal(rejoined.welcome.type,'welcome');assert.equal(rejoined.id,b.id,'one verified participant per round survives room re-entry');assert.notEqual(rejoined.token,b.token,'re-entry issues a fresh session credential');assert.equal(rejoined.welcome.resumed,false);assert.equal(rejoined.snapshot.players.length,2);
 await h.leave(aa);await h.leave(rejoined);await rr.ageRoomForTest(200000); // hadGuest remains true: use the actual 15s empty grace.
 const empty=await rr.roomStatus();assert.ok(empty);await rr.ageEmptyRoomForTest(16000);await rr.alarmForTest();assert.equal(await rr.roomStatus(),null);assert.ok(!(await h.api('/rooms')).data.rooms.some(r=>r.id===live.room.id));
});

test('rooms: 2, 6 and 10 real clients, simultaneous rooms and movement acknowledgments',{timeout:45000},async t=>{
 const h=await harness(t),tokens=await Promise.all(Array.from({length:16},()=>h.profile()));
 const six=await h.create(tokens[0],{maxPlayers:6}),peers=[];
 async function add(ad,token){const c=await h.open(ad,token);assert.equal(c.welcome.type,'welcome');await h.spawn(c);peers.push(c);return c;}
 await add(six,tokens[0]);await add(await h.admission(tokens[1],{roomId:six.room.id}),tokens[1]);
 async function exercise(group,ms){const end=Date.now()+ms;while(Date.now()<end){for(const c of group)frames(c,{yaw:Math.sin(Date.now()/1000)*.1,x:Math.floor(Date.now()/500)%2?.3:-.3});await delay(50);}await Promise.all(group.map(c=>ack(c)));for(const c of group)assert.equal(c.ws.readyState,1);}
 await exercise(peers,700);for(let i=2;i<6;i++)await add(await h.admission(tokens[i],{roomId:six.room.id}),tokens[i]);await exercise(peers,1700);
 const ten=await h.create(tokens[6],{name:'Ten players',maxPlayers:10,mapId:'modern-city',mode:'teams'});await add(ten,tokens[6]);for(let i=7;i<16;i++)await add(await h.admission(tokens[i],{roomId:ten.room.id}),tokens[i]);
 await exercise(peers,3500);for(const [ad,count]of [[six,6],[ten,10]]){const state=await h.room(ad.room.id).snapshotForTest();assert.equal(state.players.length,count);assert.equal(new Set(state.players.map(p=>p.id)).size,count);assert.ok(state.players.every(p=>p.alive&&p.ack>0));}
 const observerToken=await h.profile(),observer=await h.open(await h.admission(observerToken,{roomId:'public-main'}),observerToken);assert.equal((await h.api('/presence')).data.online,17,'aggregate home presence includes separate rooms without creating menu players');assert.equal(observer.welcome.type,'welcome');
 const isolated=peers.find(c=>c.ad.room.id===ten.room.id);assert.ok(isolated.snapshot.players.every(p=>peers.slice(0,6).every(c=>c.id!==p.id)));
});
