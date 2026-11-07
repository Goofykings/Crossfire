/** Real throws, authoritative blast/impulse, no injected damage or explosion replies. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,frames,ack} from './room-harness.mjs';
for(const mode of ['ffa','teams'])test(`grenade buff: owner immunity, lethal/medium hits, team rules and impulse (${mode})`,{timeout:30000},async t=>{
 const h=await harness(t,{MATCH_MODE:mode}),tokens=await Promise.all(Array.from({length:4},()=>h.profile()));
 let state=await h.central.snapshotForTest();while(state.mapId!=='european-town')state=await h.central.advanceMapForTest();
 const peers=[];for(const token of tokens)peers.push(await h.open(await h.admission(token,{roomId:'public-main'}),token));const [a,b,c,d]=peers;
 for(const p of peers)await h.spawn(p);await until(()=>peers.every(p=>self(p).combat.gun.action==='idle'),'weapons ready');
 const arena=await h.central.directionalArenaForTest();await h.central.placeForCombatTest(a.id,arena.center);
 frames(a,{grenade:true,pitch:-1.4});await ack(a);frames(a,{pitch:-1.4});await ack(a);
 const thrown=await until(()=>a.messages.find(m=>m.type==='grenade'&&m.event.kind==='throw'),'real throw');await until(()=>Date.now()-thrown.event.projectile.at>=1600,'fuse approaching');
 const g=(await h.central.snapshotForTest()).grenades[0];assert.ok(g);const medium=await h.central.mediumBlastPositionForTest(g.position),center=[g.position.x,medium[1],g.position.z];
 // One authoritative placement transaction: separate persisted RPC calls could let
 // the fuse expire between b and c under a busy CI/browser test workload.
 await h.central.placeManyForCombatTest([... [a,b,c].map(p=>({id:p.id,pos:center})),{id:d.id,pos:medium,heading:Math.atan2(g.position.x-medium[0],medium[2]-g.position.z)*180/Math.PI}]);
 const blast=(await until(()=>a.messages.find(m=>m.type==='grenade'&&m.event.kind==='explode'),'confirmed blast')).event;
 assert.equal(blast.hits.some(hit=>hit.id===a.id),false,'owner receives no hit event');
 await until(()=>a.snapshot.players.find(p=>p.id===b.id)?.death,'authoritative lethal state');
 const snapshot=await h.central.snapshotForTest(),owner=snapshot.players.find(p=>p.id===a.id);assert.equal(owner.health,100);assert.equal(owner.alive,true);assert.ok(Math.hypot(owner.motion.velocity.x,owner.motion.velocity.y,owner.motion.velocity.z)<.01,'owner has no knockback');
 assert.equal(blast.hits.find(hit=>hit.id===b.id)?.amount,100);assert.equal(blast.hits.find(hit=>hit.id===b.id)?.killed,true);
 if(mode==='teams'){assert.equal(snapshot.players.find(p=>p.id===c.id).health,100);assert.equal(blast.hits.some(hit=>hit.id===c.id),false);}else assert.equal(blast.hits.find(hit=>hit.id===c.id)?.killed,true);
 const hit=blast.hits.find(hit=>hit.id===d.id);assert.ok(hit&&hit.amount>20&&hit.amount<100);assert.equal(hit.killed,false);
 let last;const moved=await until(async()=>{const s=(await h.central.snapshotForTest()).players.find(p=>p.id===d.id);last=s;return Math.hypot(s.motion.position.x-medium[0],s.motion.position.z-medium[2])>.03?s:null;},'authoritative impulse moves surviving victim').catch(error=>{throw Error(error.message+' '+JSON.stringify({origin:g.position,medium,hit,first:snapshot.players.find(p=>p.id===d.id)?.motion,last:last?.motion}));});
 const dx=moved.motion.position.x-medium[0],dz=moved.motion.position.z-medium[2];assert.ok(dx*(medium[0]-g.position.x)+dz*(medium[2]-g.position.z)>0,'pushes away from blast');
 assert.ok(Math.hypot(moved.motion.velocity.x,moved.motion.velocity.z)<=12.01);assert.equal(moved.health,hit.health);
 await until(()=>!self(b).alive&&self(a).score===(mode==='ffa'?220:100),'exactly-once scoring');
 const hp=hit.health,id=d.id,token=d.token;await h.restart();const resumed=await h.open(await h.admission(tokens[3],{roomId:'public-main'}),tokens[3],{resumeToken:token});assert.equal(resumed.id,id);assert.equal(self(resumed).health,hp);assert.equal(resumed.snapshot.explosions.filter(e=>e.id===blast.id).length,1);
});
