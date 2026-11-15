import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self} from './room-harness.mjs';
import {zoneEligible} from '../../shared/zoneControl.ts';
const teamMode=m=>m==='teams'||m==='zone-control';

// Real Worker, real public-main room, real clients: the lobby rotates mode and map by itself, a custom room never does.
test('main public lobby rotates mode and map; players, teams, scores and Zone Control state follow every transition',{timeout:120000},async t=>{
 const h=await harness(t,{MATCH_MODE:''}),tokens=await Promise.all(Array.from({length:4},()=>h.profile()));
 const clients=[];for(const token of tokens)clients.push(await h.open(await h.admission(token,{roomId:'public-main'}),token));
 const ids=clients.map(c=>c.id),central=h.central;
 // A custom room fixed to FFA on Town must keep both through the same number of rounds.
 const custom=await h.create(await h.profile(),{mode:'ffa',mapId:'european-town',privacy:'public'}),customRoom=h.room(custom.room.id);
 let state=await central.snapshotForTest(),previous=null;
 const seenModes=new Set(),seenMaps=new Set(),edges=new Set();
 for(let i=0;i<40;i++){
  if(i){state=await central.advanceMapForTest();await until(()=>clients.every(c=>c.snapshot.roundId===state.roundId),'every client reaches the new round');}
  const mode=state.match.mode,mapId=state.mapId;
  seenModes.add(mode);seenMaps.add(mapId);
  if(previous){assert.notEqual(mode,previous.mode,'mode never repeats');assert.notEqual(mapId,previous.mapId,'map never repeats');edges.add(previous.mode+'>'+mode);}
  // Every client sees the server's choice.
  for(const c of clients){assert.equal(c.snapshot.match.mode,mode);assert.equal(c.snapshot.mapId,mapId);}
  // One entry per connected player, nobody duplicated by the transition.
  assert.deepEqual([...c0(clients).players.map(p=>p.id)].sort(),[...ids].sort());
  // Zone Control only on a map with its squares; markers exist only in that mode and reset every round.
  if(mode==='zone-control'){
   assert.ok(zoneEligible(mapId));
   const z=clients[0].snapshot.zoneControl;assert.ok(z);assert.equal(z.roundId,state.roundId);assert.equal(z.mapId,mapId);
   assert.ok(z.zones.every(x=>x.owner===null&&x.progress===0&&!x.contested));assert.deepEqual(clients[0].snapshot.match.teamScores,{blue:0,red:0});
  }else for(const c of clients)assert.equal(c.snapshot.zoneControl,undefined,'no leftover Zone Control markers');
  // Team assignment follows the mode and stays balanced.
  const teams=clients[0].snapshot.players.map(p=>p.team);
  if(teamMode(mode)){assert.equal(teams.filter(x=>x==='blue').length,2);assert.equal(teams.filter(x=>x==='red').length,2);}
  else assert.ok(teams.every(x=>x===null));
  // Fresh round: everyone unspawned with zeroed combat stats, then a normal spawn works.
  assert.ok(clients[0].snapshot.players.every(p=>!p.alive&&p.kills===0&&p.deaths===0&&p.score===0));
  if(i%8===0){await h.spawn(clients[0],'smg');assert.equal(self(clients[0]).alive,true);assert.equal(self(clients[0]).weapon,'smg');}
  previous={mode,mapId};
 }
 assert.deepEqual(seenModes,new Set(['ffa','teams','zone-control']));
 assert.equal(seenMaps.size,5,'every registered map, Neon Backstreets included, was played');
 for(const e of ['ffa>teams','teams>zone-control','zone-control>ffa'])assert.ok(edges.has(e),'transition '+e+' occurred');
 // The custom room was never touched by the lobby rotation.
 const customState=await customRoom.snapshotForTest();assert.equal(customState.match.mode,'ffa');assert.equal(customState.mapId,'european-town');
 for(let i=0;i<3;i++)await customRoom.advanceMapForTest();
 const later=await customRoom.snapshotForTest();assert.equal(later.match.mode,'ffa');assert.equal(later.mapId,'european-town');assert.equal(later.zoneControl,undefined);
 // Late join and reconnection land in the current round with the current mode, once.
 const lateToken=await h.profile(),late=await h.open(await h.admission(lateToken,{roomId:'public-main'}),lateToken);
 const now=await central.snapshotForTest();assert.equal(late.snapshot.match.mode,now.match.mode);assert.equal(late.snapshot.mapId,now.mapId);
 assert.equal(late.snapshot.players.filter(p=>p.id===late.id).length,1);
 const old=clients[1];old.ws.close();await until(()=>!clients[0].snapshot.players.some(p=>p.id===old.id),'disconnect');
 const back=await h.open(await h.admission(tokens[1],{roomId:'public-main'}),tokens[1],{resumeToken:old.token,roomTicket:undefined});
 assert.equal(back.id,old.id);assert.equal(back.snapshot.players.filter(p=>p.id===back.id).length,1);assert.equal(back.snapshot.match.mode,now.match.mode);
});
function c0(clients){return clients[0].snapshot;}
