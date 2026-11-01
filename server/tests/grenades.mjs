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
      c.ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;});c.ws.on('error',()=>{});
      await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
      c.send=m=>c.ws.send(JSON.stringify({v: 12,...m}));c.send({type:'join',name:'Grenade peer',...(token?{resumeToken:token}:{})});
      const w=await until(()=>c.messages.find(m=>m.type==='welcome'));c.id=w.selfId;c.token=w.resumeToken;c.resumed=w.resumed;c.seq=self(c).ack;
      c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);
      c.ws.once('close',()=>clearInterval(c.timer));return c;
    }
    async function spawn(c) {
      const wait=(self(c).death?.respawnAt??0)-Date.now();if(wait>0)await delay(wait+30);
      c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon:'rifle',requestId:crypto.randomUUID()});
      await until(()=>self(c).alive);await delay(350);
    }
    async function input(c,{grenade=false,crouch=false,pitch=-1.4}={}) {
      const seq=++c.seq;c.send({type:'input',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,
        frames:[{seq,yaw:0,pitch,intent:{x:0,z:0,slide:false,aim:false,jumpPressed:false,crouch},combat:{trigger:false,reload:false,grenade}}]});
      await until(()=>self(c).ack>=seq);
    }
    let a=await open();const b=await open(),c=await open();assert.equal(self(a).grenades,0);
    await spawn(a);await spawn(b);await spawn(c);assert.equal(self(a).grenades,1);
    const arena=await room.directionalArenaForTest();await room.placeForCombatTest(a.id,arena.center);await room.placeForCombatTest(b.id,arena.observer);
    await input(a,{crouch:true});await delay(300);
    assert.equal(self(a).motion.crouch,1,'server retains held crouch between sparse frames');
    assert.equal(b.snapshot.players.find(p=>p.id===a.id).motion.crouch,1,'peer receives the same lowered collider');
    await input(a);await delay(250);assert.equal(self(a).motion.crouch,0);
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
    const kills=mode==='ffa'?2:1;await until(()=>!self(b).alive&&self(a).kills===kills);
    const death=self(b).death;assert.equal(death.weapon,'grenade');assert.equal(death.head,false);assert.equal(death.award.total,100);
    assert.equal(self(a).score,mode==='ffa'?220:100);assert.equal(self(b).deaths,1);
    if(mode==='ffa'){assert.equal(self(c).death.award.combo,20);assert.equal(self(a).comboCount,2);}
    else {assert.equal(self(c).health,100);assert.equal(self(c).alive,true);assert.equal(blast.event.hits.some(h=>h.id===c.id),false);}
    await delay(500);assert.equal(b.messages.slice(mark).filter(m=>m.type==='grenade'&&m.event.kind==='explode').length,1);
    assert.equal(self(a).kills,kills,'no repeated damage or scoring on later ticks');
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
    assert.equal(self(b).score,100,'posthumous elimination retains credit');assert.equal(self(b).comboCount,0,'dead owner retains no live combo');
    assert.equal(self(a).death.weapon,'grenade');
    await spawn(b);await room.placeForCombatTest(b.id,arena.center);await input(b,{grenade:true});
    assert.equal((await room.snapshotForTest()).grenades.length,1);
    const next=await room.advanceMapForTest();assert.equal(next.grenades.length,0);
    assert.ok(next.players.every(p=>p.grenades===0),'new round removes old-life inventory');
    await delay(2100);assert.equal((await room.snapshotForTest()).explosions.length,0,'no old-round detonation');
    room[Symbol.dispose]?.();
  } finally {for(const c of clients){clearInterval(c.timer);c.ws.terminate();}await mf.dispose();}
});
