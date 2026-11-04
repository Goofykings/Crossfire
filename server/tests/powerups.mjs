/** Real workerd + TCP WebSockets. Test RPC only places real spawned players,
 * creates cubes at validated navigation points and accelerates a duration edge. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'vite';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';
import {PROTOCOL_VERSION} from '../../tools/protocol-version.mjs';

test('Powerups: real collection, Giant, shield, jumps, burn scoring, resume and round cleanup',{timeout:90000},async()=>{
  const origin='http://localhost:5173',clients=[];
  const vite=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},appType:'custom'});
  const protocol=await vite.ssrLoadModule('/shared/protocol.ts');
  const mf=new Miniflare(convertV4MiniflareOptions({name:'powerups',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},{type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
    resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/powerups-',import.meta.url))),
    durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin,MATCH_MODE:'powerups'},log:new Log(LogLevel.ERROR)}));
  const until=async(fn,label)=>{const end=Date.now()+6000;while(Date.now()<end){const v=await fn();if(v)return v;await delay(15);}throw Error(label);};
  const me=c=>c.snapshot?.players.find(p=>p.id===c.id);
  try {
    const base=(await mf.ready).href,ns=await mf.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
    let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
    const arena=await room.powerupArenaForTest();
    async function open(token){
      const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],snapshot:null,seq:0,id:''};clients.push(c);
      c.ws.on('message',raw=>{const text=String(raw),m=JSON.parse(text);assert.ok(protocol.parseServerMessage(text),`Invalid authoritative ${m.type}: ${text.slice(0,300)}`);c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;});
      c.ws.on('error',()=>{});await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
      c.send=m=>c.ws.send(JSON.stringify({v:PROTOCOL_VERSION,...m}));c.send({type:'join',name:`Power peer ${clients.length}`,...(token?{resumeToken:token}:{})});
      const w=await until(()=>c.messages.find(m=>m.type==='welcome'),'welcome');c.id=w.selfId;c.token=w.resumeToken;c.seq=me(c).ack;c.resumed=w.resumed;
      c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);c.ws.once('close',()=>clearInterval(c.timer));return c;
    }
    async function spawn(c){const wait=(me(c).death?.respawnAt??0)-Date.now();if(wait>0)await delay(wait+30);
      c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon:'rifle',requestId:crypto.randomUUID()});await until(()=>me(c).alive,'spawn');await delay(350);}
    async function place(c,pos){await room.placeForCombatTest(c.id,pos);await delay(60);}
    async function give(c,type,pos){await place(c,pos);const pickup=await room.pickupForTest(type,pos);await until(()=>me(c).powerup?.type===type,'collect '+type);
      assert.ok(me(c).powerup.expiresAt>Date.now()+14000);return pickup;}
    function send(c,frames){c.send({type:'input',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,frames});}
    function frame(c,target,trigger=false,jump=false){
      const p=me(c).motion,other=me(target).motion,dx=other.position.x-p.position.x,dz=other.position.z-p.position.z;
      const eye=1.64*(p.scale??1),height=1.05*(other.scale??1);
      return {seq:++c.seq,yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(other.position.y+height-p.position.y-eye,Math.hypot(dx,dz)),
        intent:{x:0,z:0,slide:false,aim:true,jumpPressed:jump},combat:{trigger,reload:false}};
    }
    async function aim(c,target){for(let t=0;t<450;t+=50){send(c,Array.from({length:6},()=>frame(c,target)));await delay(50);}}
    async function shot(c,target){const mark=c.messages.length;send(c,[frame(c,target,true),...Array.from({length:5},()=>frame(c,target))]);
      const result=await until(()=>c.messages.slice(mark).find(m=>m.type==='shot'),'shot');await delay(160);return result.shot;}
    let a=await open();const b=await open(),c=await open();
    await room.duePowerupForTest();await delay(200);assert.equal(a.snapshot.pickups.length,0,'unspawned spectators do not create pickups');
    await spawn(a);
    await until(()=>a.snapshot.pickups.length===1,'first playing session permits spawns');
    await room.duePowerupForTest();await until(()=>a.snapshot.pickups.length===2,'idle room alarm creates a pickup');
    await room.duePowerupForTest();await delay(180);assert.equal(a.snapshot.pickups.length,2,'one active player and two spectators still cap at two');
    assert.ok((await room.powerupClockForTest()).state.nextSpawn>Date.now()+19000,'two-player tier uses twenty seconds');
    await spawn(b);await spawn(c);await room.duePowerupForTest();await until(()=>a.snapshot.pickups.length===3,'three alive peers raise the cap');
    assert.ok((await room.powerupClockForTest()).state.nextSpawn>Date.now()+14000,'three-player tier uses fifteen seconds');
    await room.clearPickupsForTest();
    assert.equal(a.snapshot.match.mode,'powerups');assert.equal(me(a).team,null);assert.ok((await room.powerupClockForTest()).pool>12);
    await place(a,arena.source);await place(c,arena.parking);
    const pickup=await give(b,'shield',arena.target);await until(()=>a.snapshot.players.find(p=>p.id===b.id)?.powerup?.shield===75,'peer shield');
    assert.equal(a.snapshot.pickups.some(p=>p.id===pickup.id),false);
    const pickups=clients.flatMap(c=>c.messages.filter(m=>m.type==='powerup'&&m.event.pickupId===pickup.id));
    assert.equal(new Set(pickups.map(p=>p.event.playerId)).size,1,'one collector, same event across peers');
    await aim(a,b);for(let i=0;i<3;i++){const s=await shot(a,b);assert.ok(s.hits.some(h=>h.id===b.id));}
    await until(()=>me(b).powerup?.shield===0,'three 25-point shots consume shield');assert.equal(me(b).health,100);
    await shot(a,b);assert.equal(me(b).health,75,'overflow proceeds to health');
    const expiry=me(b).powerup.expiresAt,life=me(b).life,id=b.id,token=b.token;b.ws.close();await until(()=>b.ws.readyState===WebSocket.CLOSED,'closed');
    const resumed=await open(token);assert.ok(resumed.resumed);assert.equal(resumed.id,id);assert.equal(me(resumed).life,life);assert.equal(me(resumed).health,75);
    assert.equal(me(resumed).powerup.expiresAt,expiry);assert.equal(me(resumed).powerup.shield,0);
    assert.equal(resumed.snapshot.players.filter(p=>p.id===id).length,1);
    await room.soonExpirePowerupForTest(id);await until(()=>me(resumed).powerup===null,'shield expiry');

    await place(c,arena.parking);await give(a,'giant',arena.source);assert.equal(me(a).health,150);assert.equal(me(a).motion.scale,1.5);
    await aim(a,resumed);const giantShot=await shot(a,resumed);assert.equal(giantShot.hits.find(h=>h.id===id).amount,37.5);assert.equal(me(resumed).health,37.5);
    await aim(resumed,a);await shot(resumed,a);assert.equal(me(a).health,125);
    await room.soonExpirePowerupForTest(a.id);await until(()=>me(a).powerup===null,'giant expiry');assert.ok(Math.abs(me(a).health-125/1.5)<.001);assert.equal(me(a).motion.scale,1);
    await give(a,'doubleJump',arena.source);
    send(a,[frame(a,resumed,false,true)]);await delay(130);send(a,[frame(a,resumed,false,true)]);
    await until(()=>me(a).motion.extraJumpCount===1,'second jump');const jumpLife=me(a).life,extraUsed=me(a).motion.extraJumpUsed;
    send(a,[frame(a,resumed,false,true)]);await delay(80);assert.equal(me(a).motion.extraJumpCount,1);
    const old=a;a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED,'jump disconnect');a=await open(old.token);
    assert.equal(me(a).life,jumpLife);assert.equal(me(a).motion.extraJumpUsed,extraUsed);assert.equal(me(a).motion.extraJumpCount,1);
    assert.equal(resumed.messages.filter(m=>m.type==='powerup'&&m.event.kind==='doubleJump'&&m.event.playerId===a.id).length,1);
    await until(()=>me(a).motion.grounded,'land');
    await give(a,'fire',arena.source);await aim(a,resumed);const empowered=await shot(a,resumed);
    assert.equal(empowered.fire,true);assert.ok(empowered.traces.length);assert.ok(me(resumed).burn);assert.equal(me(resumed).burn.ownerId,a.id);
    const burnEnd=me(resumed).burn.expiresAt,health=me(resumed).health;
    await delay(250);assert.ok(me(resumed).health<health&&me(resumed).health>health-5,'smooth burn ticks, not one-second chunks');
    resumed.ws.close();await until(()=>resumed.ws.readyState===WebSocket.CLOSED,'burn disconnect');const burning=await open(resumed.token);
    assert.equal(me(burning).burn?.expiresAt,burnEnd,'resume does not refresh burn');
    await until(()=>!me(burning).alive,'burn elimination');const death=me(burning).death;
    assert.equal(death.weapon,'burn');assert.equal(death.killerId,a.id);assert.equal(death.head,false);assert.equal(death.award.base,100);assert.equal(death.award.headshot,0);
    assert.equal(me(a).kills,1);assert.equal(me(a).score,100);assert.equal(me(a).grenades,2);
    assert.equal(me(burning).burn,null);assert.equal(me(burning).powerup,null);
    await delay(200);assert.equal(me(a).kills,1,'no repeated lethal burn or reward');
    assert.equal(burning.messages.filter(m=>m.type==='elimination'&&m.elimination.id===death.id).length,1);
    // A second victim burns out inside the normal four-second combo window.
    await place(c,arena.target);await aim(a,c);
    for(let i=0;i<3;i++)await shot(a,c);
    await until(()=>!me(c).alive,'second burn elimination');
    assert.equal(me(c).death.weapon,'burn');assert.equal(me(c).death.award.total,120);
    assert.equal(me(a).score,220);assert.equal(me(a).grenades,3);
    // Burn ownership survives the applier dying; a dead applier must not retain
    // a live combo timer or emit a schema-invalid dead player snapshot.
    await spawn(burning);await place(burning,arena.target);await aim(a,burning);
    for(let i=0;i<3;i++)await shot(a,burning);
    await aim(burning,a);for(let i=0;i<4&&me(a).alive;i++)await shot(burning,a);
    await until(()=>!me(a).alive,'burn owner eliminated first');
    await until(()=>!me(burning).alive,'posthumous burn');
    assert.equal(me(burning).death.weapon,'burn');assert.equal(me(burning).death.killerId,a.id);
    assert.equal(me(a).score,320);assert.equal(me(a).grenades,4);assert.equal(me(a).comboCount,0);
    await spawn(burning);assert.equal(me(burning).health,100);assert.equal(me(burning).powerup,null);assert.equal(me(burning).motion.scale,1);
    const ended=a.snapshot.roundId;await room.advanceMapForTest();await until(()=>a.snapshot.roundId!==ended,'round');
    assert.equal(me(a).powerup,null);assert.equal(me(a).burn,null);assert.equal(me(a).alive,false);assert.deepEqual(a.snapshot.pickups,[]);
    assert.equal(a.snapshot.result.mode,'powerups');assert.equal(a.snapshot.result.winner.id,a.id);assert.equal(a.snapshot.result.mvp.id,a.id);
    assert.equal(a.snapshot.result.players.find(p=>p.id===a.id).score,320);
    for(const peer of clients)assert.equal(peer.messages.filter(m=>m.type==='error').length,0);
  } finally {for(const c of clients){clearInterval(c.timer);c.ws.terminate();}await mf.dispose();await vite.close();}
});
