import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,until,self,ack} from './room-harness.mjs';
import layout from '../../src/maps/industrial-complex/layout.json' with {type:'json'};

test('Industrial slide-only passages: authoritative shape, peer replication, blocked crouch and recovery',{timeout:40000},async t=>{
 const h=await harness(t),owner=await h.profile(),peer=await h.profile();
 const ad=await h.create(owner,{mapId:'industrial-complex'}),guest=await h.admission(peer,{roomId:ad.room.id});
 const a=await h.open(ad,owner),b=await h.open(guest,peer);await h.spawn(a,'sniper');await h.spawn(b,'rifle');
 const room=h.room(ad.room.id);
 for(const passage of layout.slidePassages)for(const direction of [1,-1])for(const mode of ['stand','crouch','slide']){
  const [x,z]=passage.center;
  await room.placeForCombatTest(a.id,[x,0,z+direction*2.3],direction===1?0:180);
  const yaw=direction===1?0:-Math.PI;
  for(let i=0;i<24;i++){
   a.send({type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,frames:Array.from({length:6},()=>({seq:++a.seq,yaw,pitch:0,intent:{x:0,z:1,slide:mode==='slide',crouch:mode==='crouch',aim:false,jumpPressed:false},combat:{trigger:false,reload:false}}))});
   await ack(a);
  }
  const state=self(a);assert.equal(state.alive,true);
  if(mode==='slide')assert.ok(direction*(state.motion.position.z-z)<-.8,'real slide clears the plinth');
  else assert.ok(direction*(state.motion.position.z-z)>.4,mode+' cannot enter');
  await until(()=>{const p=b.snapshot.players.find(p=>p.id===a.id);return p&&p.ack===state.ack&&Math.abs(p.motion.position.z-state.motion.position.z)<.01;},'peer observes the same authoritative passage position');
  assert.equal(b.snapshot.players.filter(p=>p.id===a.id).length,1);
 }
 assert.ok(a.messages.some(m=>m.snapshot?.players.some(p=>p.id===a.id&&p.motion.lowClearance)),'real snapshots synchronize the slide stance');
 assert.deepEqual(a.messages.filter(m=>m.type==='error'),[]);
});
