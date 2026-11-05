/** Real Worker eligibility expiry and storage migration. Test RPC only seeds retired storage or places players. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';
import {PROTOCOL_VERSION as v} from '../../tools/protocol-version.mjs';
test('assist expiry, respawn cleanup and retired session migration in the real Durable Object',{timeout:40000},async()=>{
 const origin='http://localhost:5173',clients=[];
 const options=convertV4MiniflareOptions({name:'assist-lifecycle',modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
 {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
 resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/assists-',import.meta.url))),durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
 bindings:{ALLOWED_ORIGINS:origin,MATCH_MODE:'ffa',ASSIST_WINDOW_MS:'400'},log:new Log(LogLevel.ERROR)});
 let mf=new Miniflare(options),room,base;
 const setup=async()=>{base=(await mf.ready).href;const ns=await mf.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('public-main'));};
 const until=async(fn,label)=>{const end=Date.now()+6000;while(Date.now()<end){const result=await fn();if(result)return result;await delay(10);}throw Error('Assist timeout: '+label);};
 const self=c=>c.snapshot.players.find(p=>p.id===c.id);
 async function open(weapon='rifle',token){
  const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],seq:0};clients.push(c);
  c.ws.on('message',r=>{const m=JSON.parse(String(r));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;});c.ws.on('error',()=>{});
  await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
  c.send=m=>c.ws.send(JSON.stringify({v,...m}));c.send({type:'join',name:'Assist lifecycle',...(token?{resumeToken:token}:{})});
  const w=await until(()=>c.messages.find(m=>m.type==='welcome'),'join');c.id=w.selfId;c.token=w.resumeToken;c.seq=self(c).ack;
  c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);c.ws.once('close',()=>clearInterval(c.timer));
  if(!token)await spawn(c,weapon);return c;
 }
 async function spawn(c,weapon='rifle'){
  const remaining=(self(c).death?.respawnAt??0)-Date.now();if(remaining>0)await delay(remaining);
  const mark=c.messages.length;c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon,requestId:crypto.randomUUID()});
  await until(()=>c.messages.slice(mark).find(m=>m.type==='spawned'),'spawn');
 }
 function frames(c,target,trigger=false){const p=c.position,q=target.position,dx=q[0]-p[0],dz=q[2]-p[2];
  c.send({type:'input',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,frames:Array.from({length:6},(_,k)=>({seq:++c.seq,yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(q[1]+.9-p[1]-1.64,Math.hypot(dx,dz)),
  intent:{x:0,z:0,slide:false,aim:true,jumpPressed:false},combat:{trigger:trigger&&k===0,reload:false}}))});}
 async function aim(c,b){for(let i=0;i<13;i++){frames(c,b);await delay(50);}await until(()=>self(c).ack>=c.seq,'aim');}
 async function shot(c,b){const mark=c.messages.length;frames(c,b,true);return(await until(()=>c.messages.slice(mark).find(m=>m.type==='shot'&&m.shot.shooterId===c.id),'shot')).shot;}
 try{
  await setup();let r=await room.advanceMapForTest();while(r.mapId!=='european-town')r=await room.advanceMapForTest();
  const a=await open(),b=await open(),killer=await open('sniper'),arena=await room.directionalArenaForTest();
  const place=async()=>{for(const[c,p]of [[a,arena.sources.front],[b,arena.center],[killer,arena.sources.left]]){c.position=p;await room.placeForCombatTest(c.id,p);}};
  await place();await aim(a,b);await shot(a,b);
  // Real ADS preparation lasts longer than the configured 400ms test eligibility window.
  await aim(killer,b);await shot(killer,b);
  await until(()=>self(b).death,'death');assert.deepEqual(self(b).death.assists,[]);assert.equal(self(a).score,0);
  await spawn(b);await place();await aim(a,b);await aim(killer,b);
  await shot(a,b);await shot(killer,b);await until(()=>self(a).assists===1,'fresh assist');assert.equal(self(a).score,50);
  await spawn(b);await place();await aim(killer,b);await shot(killer,b);await shot(a,b);
  await until(()=>!self(b).alive,'new life death');assert.equal(self(a).kills,1);assert.equal(self(a).assists,1,'previous-life damage never grants another assist');
  const before=await room.snapshotForTest(),saved=before.players.find(p=>p.id===a.id);
  for(const c of clients){clearInterval(c.timer);if(c.ws.readyState===WebSocket.OPEN){c.ws.close();await new Promise(resolve=>c.ws.once('close',resolve));}}
  await room.seedRetiredStateForTest(a.id);room[Symbol.dispose]?.();await mf.dispose();mf=new Miniflare(options);await setup();
  const resumed=await open('rifle',a.token),normal=self(resumed);
  assert.equal(resumed.id,a.id);assert.equal(normal.life,saved.life);assert.equal(normal.score,saved.score);assert.equal(normal.assists,1);assert.equal(normal.health,80);
  assert.equal(resumed.snapshot.match.mode,'ffa');for(const key of ['scale','eyeScale','doubleJump','extraJumpUsed','extraJumpCount'])assert.equal(key in normal.motion,false);
  assert.equal('powerup' in normal,false);assert.equal('burn' in normal,false);assert.equal((await room.retiredStorageForTest()).pickups,undefined);
 }finally{for(const c of clients){clearInterval(c.timer);c.ws.terminate();}room?.[Symbol.dispose]?.();await mf.dispose();}
});
