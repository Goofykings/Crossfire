import { PROTOCOL_VERSION } from '../../tools/protocol-version.mjs';
/** Actual workerd, sockets, inventory, trajectories and damage; RPC only places real players. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';

for (const mode of ['ffa','teams']) test(`grenades and held crouch: inventory, resume, damage, score and respawn (${mode})`, {timeout:60000}, async () => {
  const origin='http://localhost:5173',clients=[];
  const options=convertV4MiniflareOptions({name:'grenades',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
      {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
    resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/grenades-',import.meta.url))),
    durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin,MATCH_MODE:mode},log:new Log(LogLevel.ERROR)});
  const mf=new Miniflare(options);
  const until=async(fn)=>{const end=Date.now()+6000;while(Date.now()<end){const v=await fn();if(v)return v;await delay(10);}throw new Error('Grenade state timeout');};
  const self=c=>c.snapshot.players.find(p=>p.id===c.id);
  try {
    const base=(await mf.ready).href,ns=await mf.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
    let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
    async function open(token) {
      const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],snapshot:null,seq:0,id:''};clients.push(c);
      c.ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot){
        // Model a slower peer without inventing state: hold its actual death snapshots.
        if(c.holdDeathSnapshots&&m.snapshot.players.some(p=>p.id===c.id&&p.death?.weapon==='grenade'))c.heldSnapshot=m.snapshot;
        else c.snapshot=m.snapshot;
      }});c.ws.on('error',()=>{});
      await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
      c.send=m=>c.ws.send(JSON.stringify({v: PROTOCOL_VERSION,...m}));c.send({type:'join',name:'Grenade peer',...(token?{resumeToken:token}:{})});
      const w=await until(()=>c.messages.find(m=>m.type==='welcome'));c.id=w.selfId;c.token=w.resumeToken;c.resumed=w.resumed;c.seq=self(c).ack;
      c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);
      c.ws.once('close',()=>clearInterval(c.timer));return c;
    }
    async function spawn(c) {
      const wait=(self(c).death?.respawnAt??0)-Date.now();if(wait>0)await delay(wait+30);
      c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon:'rifle',requestId:crypto.randomUUID()});
      await until(()=>self(c).alive);await delay(350);
    }
    async function input(c,{grenade=false,crouch=false,pitch=-1.4,release=true,grenadeCancel=false}={}) {
      const seq=++c.seq;c.send({type:'input',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,
        frames:[{seq,yaw:0,pitch,intent:{x:0,z:0,slide:false,aim:false,jumpPressed:false,crouch},combat:{trigger:false,reload:false,grenade,grenadeCancel}}]});
      await until(()=>self(c).ack>=seq);
      if(grenade&&release)await input(c,{grenade:false,crouch,pitch});
    }
    let a=await open();const b=await open(),c=await open();assert.equal(self(a).grenades,0);
    await spawn(a);await spawn(b);await spawn(c);assert.equal(self(a).grenades,1);
    const arena=await room.directionalArenaForTest();await room.placeForCombatTest(a.id,arena.center);await room.placeForCombatTest(b.id,arena.observer);
    await input(a,{crouch:true});await delay(300);
    assert.equal(self(a).motion.crouch,1,'server retains held crouch between sparse frames');
    assert.equal(b.snapshot.players.find(p=>p.id===a.id).motion.crouch,1,'peer receives the same lowered collider');
    await input(a);await delay(250);assert.equal(self(a).motion.crouch,0);
    // Real transport cancellation never consumes inventory or releases a charge.
    await input(a,{grenade:true,release:false});await input(a,{grenadeCancel:true});await input(a);
    assert.equal(self(a).grenades,1);assert.equal(a.snapshot.grenades.length,0);
    c.holdDeathSnapshots=mode==='ffa';
    const mark=b.messages.length;await input(a,{grenade:true});
    const thrown=await until(()=>b.messages.slice(mark).find(m=>m.type==='grenade'&&m.event.kind==='throw'));
    assert.equal(self(a).grenades,0);assert.equal(thrown.event.projectile.explodeAt-thrown.event.projectile.at,2000);
    const id=a.id,life=self(a).life,token=a.token;a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED);
    a=await open(token);assert.ok(a.resumed);assert.equal(a.id,id);assert.equal(self(a).life,life);assert.equal(self(a).grenades,0);
    assert.equal(a.snapshot.grenades.length,1,'reconnect preserves a live projectile');
    await input(a,{grenade:true});assert.equal(a.snapshot.grenades.length,1,'cannot restock or throw twice by reconnecting');
    await until(()=>Date.now()-thrown.event.projectile.at>1400);
    const g=(await room.snapshotForTest()).grenades[0];assert.ok(g,'has not exploded before fuse');
    await room.placeForCombatTest(b.id,[g.position.x,arena.center[1],g.position.z]);
    await room.placeForCombatTest(c.id,[g.position.x,arena.center[1],g.position.z]);
    await room.placeForCombatTest(a.id,arena.sources.right);
    const blast=await until(()=>b.messages.slice(mark).find(m=>m.type==='grenade'&&m.event.kind==='explode'));
    assert.ok(blast.event.at>=thrown.event.projectile.explodeAt,'never early detonation');
    assert.ok(blast.event.at-thrown.event.projectile.explodeAt<500,'detonates on the server tick');
    assert.equal(blast.event.hits.find(h=>h.id===b.id)?.health,0,'blast uses the actual explosion-time position');
    const kills=mode==='ffa'?2:1;
    // One authoritative snapshot contains the whole transaction. Different TCP
    // clients can receive that same snapshot at different times.
    const confirmed=await until(()=>{
      const players=b.snapshot.players,shooter=players.find(p=>p.id===a.id),victim=players.find(p=>p.id===b.id),other=players.find(p=>p.id===c.id);
      return shooter?.kills===kills&&!victim?.alive&&victim?.death&&(mode!=='ffa'||(!other?.alive&&other?.death))
        ? {shooter,victim,other} : null;
    });
    const deaths=mode==='ffa'?[confirmed.victim.death,confirmed.other.death]:[confirmed.victim.death];
    assert.deepEqual(deaths.map(d=>d.award?.total).sort((x,y)=>x-y),mode==='ffa'?[100,120]:[100]);
    for(const death of deaths){
      assert.equal(death.weapon,'grenade');assert.equal(death.head,false);assert.equal(death.killerId,a.id);
      assert.equal(death.award.base,100);assert.equal(death.award.headshot,0);
      assert.equal(death.award.combo,death.award.total-100);
    }
    assert.equal(confirmed.shooter.grenades,kills,'each confirmed elimination replenishes once, including multi-kills');
    assert.equal(confirmed.shooter.score,mode==='ffa'?220:100);assert.equal(confirmed.victim.deaths,1);
    const killFeed=()=>b.messages.slice(mark).filter(m=>m.type==='elimination'&&m.elimination.weapon==='grenade'
      &&deaths.some(d=>d.victimId===m.elimination.victimId&&d.victimLife===m.elimination.victimLife));
    const eliminationEvents=killFeed();
    assert.equal(eliminationEvents.length,kills,'one kill-feed elimination per victim');
    for(const death of deaths)assert.deepEqual(eliminationEvents.find(m=>m.elimination.id===death.id)?.elimination.award,death.award);
    if(mode==='ffa'){
      assert.equal(confirmed.shooter.comboCount,2);
      assert.equal(self(c).death,null,'a peer can still have its previous snapshot');
      c.holdDeathSnapshots=false;if(c.heldSnapshot)c.snapshot=c.heldSnapshot;
      await until(()=>self(c).death?.id===confirmed.other.death.id);
      assert.deepEqual(self(c).death.award,confirmed.other.death.award,'the delayed peer receives the same actual award');
    } else {assert.equal(confirmed.other.health,100);assert.equal(confirmed.other.alive,true);assert.equal(blast.event.hits.some(h=>h.id===c.id),false);}
    await until(()=>self(a).kills===kills&&self(a).score===confirmed.shooter.score);
    await delay(500);assert.equal(b.messages.slice(mark).filter(m=>m.type==='grenade'&&m.event.kind==='explode').length,1);
    assert.equal(self(a).grenades,kills,'later ticks cannot duplicate grenade rewards');
    assert.equal(self(a).kills,kills,'no repeated damage or scoring on later ticks');
    assert.equal(self(a).score,mode==='ffa'?220:100,'no duplicate awards on later ticks');
    assert.equal(killFeed().length,kills,'no duplicate kill-feed events, even with a new event ID');
    assert.equal(self(b).health,0);assert.equal(self(b).deaths,1);
    if(mode==='ffa'){assert.equal(self(c).health,0);assert.equal(self(c).deaths,1);}
    if(self(c).alive)await room.placeForCombatTest(c.id,arena.sources.behind);
    await spawn(b);assert.equal(self(b).grenades,1,'respawn resets inventory');
    assert.ok(!a.messages.some(m=>m.type==='error'),JSON.stringify(a.messages.filter(m=>m.type==='error')));
    // A real fall after release tests posthumous credit without injecting health or scores.
    await room.placeForCombatTest(b.id,arena.center);
    const target=self(a).motion.position,dx=target.x-arena.center[0],dz=target.z-arena.center[2];
    b.send({type:'input',roundId:b.snapshot.roundId,mapVersion:b.snapshot.mapVersion,frames:[{seq:++b.seq,
      yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(target.y+.9-arena.center[1]-1.64,Math.hypot(dx,dz)),
      intent:{x:0,z:0,slide:false,aim:false,jumpPressed:false},combat:{trigger:true,reload:false}}]});
    await until(()=>self(a).health<100);await input(b);await input(b,{grenade:true});
    const second=await until(()=>b.snapshot.grenades[0]);await room.fallForTest(b.id);
    await until(()=>!self(b).alive);await until(()=>Date.now()-second.at>1400);
    const settled=(await room.snapshotForTest()).grenades[0];
    await room.placeForCombatTest(a.id,[settled.position.x,arena.center[1],settled.position.z]);
    await until(()=>!self(a).alive&&self(b).kills===1);
    assert.equal(self(b).grenades,1,'posthumous kill rewards exactly once');
    assert.equal(self(b).score,100,'posthumous elimination retains credit');assert.equal(self(b).comboCount,0,'dead owner retains no live combo');
    assert.equal(self(a).death.weapon,'grenade');
    await spawn(b);await room.placeForCombatTest(b.id,arena.center);
    const start=Date.now();
    // Feed actual 120 Hz held frames in 20 Hz batches; elapsed server time caps charge.
    while(Date.now()-start<1750){
      const frames=Array.from({length:6},()=>({seq:++b.seq,yaw:0,pitch:-1.4,intent:{x:0,z:0,slide:false,aim:false,jumpPressed:false},combat:{trigger:false,reload:false,grenade:true}}));
      b.send({type:'input',roundId:b.snapshot.roundId,mapVersion:b.snapshot.mapVersion,frames});await delay(50);
    }
    assert.equal(self(b).grenades,1,'holding never throws or consumes inventory');
    const chargeMark=b.messages.length;await input(b);
    const charged=await until(()=>b.messages.slice(chargeMark).find(m=>m.type==='grenade'&&m.event.kind==='throw'));
    assert.ok(Math.abs(charged.event.projectile.velocity.z)>4,'server credits a real full hold, not only the release tick');
    assert.ok(Math.abs(charged.event.projectile.velocity.z)<=24.5*Math.cos(1.4)+.01,'authoritative charge speed is bounded');
    assert.equal((await room.snapshotForTest()).grenades.length,1);
    const next=await room.advanceMapForTest();assert.equal(next.grenades.length,0);
    assert.ok(next.players.every(p=>p.grenades===0),'new round removes old-life inventory');
    await delay(2100);assert.equal((await room.snapshotForTest()).explosions.length,0,'no old-round detonation');
    room[Symbol.dispose]?.();
  } finally {for(const c of clients){clearInterval(c.timer);c.ws.terminate();}await mf.dispose();}
});
