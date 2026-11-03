/** Real Worker HTTP, private WebSockets and confirmed combat; RPC seeds explicit test preconditions only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';
import {PROTOCOL_VERSION as v} from '../../tools/protocol-version.mjs';

for(const mode of ['kills','eligible','late','abandoned'])test(`durable guest challenges: ${mode}`,{timeout:60000},async()=>{
  const origin='http://localhost:5173',clients=[];
  const options=convertV4MiniflareOptions({name:'careers',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
      {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
    resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/careers-',import.meta.url))),
    durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)});
  let mf=new Miniflare(options),room,base;
  const until=async(fn,label)=>{const end=Date.now()+7000;while(Date.now()<end){const value=await fn();if(value)return value;await delay(15);}throw Error('Challenge timeout: '+label);};
  const me=c=>c.snapshot?.players.find(p=>p.id===c.id);
  const http=(method='GET',credential,body)=>fetch(new URL('/profile',base),{method,headers:{Origin:origin,...(credential?{Authorization:`Bearer ${credential}`}:{})},...(body?{body}:{} )});
  const profile=async credential=>{const r=await http('GET',credential);assert.equal(r.status,200);return (await r.json()).profile;};
  async function open(credential,resume){
    const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],seq:0,profile:null};clients.push(c);
    c.ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;if(m.type==='career')c.profile=m.profile;});c.ws.on('error',()=>{});
    await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
    c.send=m=>c.ws.send(JSON.stringify({v,...m}));c.send({type:'join',name:'Challenge peer',profileToken:credential,...(resume?{resumeToken:resume}:{})});
    const w=await until(()=>c.messages.find(m=>m.type==='welcome'),'welcome');c.id=w.selfId;c.token=w.resumeToken;c.seq=me(c).ack;
    c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);c.ws.once('close',()=>clearInterval(c.timer));return c;
  }
  async function spawn(c,weapon='rifle'){
    c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon,requestId:crypto.randomUUID()});
    await until(()=>me(c)?.alive,'spawn');await delay(250);
  }
  async function aimAndFire(a,b,height,fire=true){
    const arena=await room.directionalArenaForTest();
    await room.placeForCombatTest(a.id,arena.sources.front);await room.placeForCombatTest(b.id,arena.center);
    const dx=arena.center[0]-arena.sources.front[0],dz=arena.center[2]-arena.sources.front[2];
    const yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(height-1.64,Math.hypot(dx,dz));
    const frame=trigger=>({seq:++a.seq,yaw,pitch,intent:{x:0,z:0,slide:false,aim:true,jumpPressed:false},combat:{trigger,reload:false}});
    for(let i=0;i<13;i++){a.send({type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,frames:[frame(false)]});await delay(50);}
    if(fire)a.send({type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,frames:[frame(true),frame(false)]});
  }
  try{
    base=(await mf.ready).href;const ns=await mf.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('public-main'));
    let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
    assert.equal((await fetch(new URL('/profile',base),{method:'POST',headers:{Origin:'https://bad.example'}})).status,403);
    assert.equal((await http('GET','f'.repeat(64))).status,401);
    assert.equal((await http('POST',undefined,'{"gems":9999}')).status,400);
    const preflight=await fetch(new URL('/profile',base),{method:'OPTIONS',headers:{Origin:origin}});assert.equal(preflight.status,204);assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Authorization/);
    const created=await(await http('POST')).json(),other=await(await http('POST')).json();
    assert.equal(created.v,v);assert.match(created.credential,/^[a-f0-9]{64}$/);assert.equal(created.profile.gems,0);
    assert.equal(created.profile.daily.challenges.length,3);assert.equal(created.profile.weekly.challenges.length,3);
    assert.deepEqual((await profile(created.credential)).daily,created.profile.daily,'refresh is stable');
    let a=await open(created.credential),b=await open(other.credential);
    await spawn(a,'sniper');await spawn(b);
    if(mode==='kills'){
      async function rejected(message,code){
        const ws=new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages=[];clients.push({ws});
        ws.on('message',raw=>messages.push(JSON.parse(String(raw))));ws.on('error',()=>{});
        await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.send(JSON.stringify({v,...message}));
        const failure=await until(()=>messages.find(m=>m.type==='error'),'rejected claim');assert.equal(failure.code,code);ws.terminate();
      }
      await rejected({type:'join',name:'Forged',profileToken:'f'.repeat(64)},'profile_invalid');
      await rejected({type:'join',name:'Duplicate',profileToken:created.credential},'profile_in_use');
      await rejected({type:'join',name:'Wrong owner',profileToken:other.credential,resumeToken:a.token},'profile_mismatch');
      await rejected({type:'join',name:'Forged gems',profileToken:created.credential,gems:9999},'invalid_message');
    }
    if(mode==='kills'){
      await room.seedCareerForTest(a.id);
      await aimAndFire(a,b,.9);await until(()=>me(b).health===25,'nonlethal shot');
      assert.equal((await profile(created.credential)).gems,0,'damage without elimination cannot progress challenges');
      await delay(1000);
    }else await room.seedCareerForTest(a.id,'round',mode);
    await aimAndFire(a,b,1.6);await until(()=>!me(b).alive,'confirmed headshot elimination');
    if(mode==='kills'){
      await until(()=>a.profile?.gems===1050,'all six rewards');
      assert.equal(me(a).kills,1);assert.equal(a.profile.gems,1050);
      assert.ok(a.profile.daily.challenges.every(c=>c.completedAt!==null));
      assert.ok(a.profile.weekly.challenges.every(c=>c.completedAt!==null));
      await room.replayDeadTransitionForTest(b.id,a.id);
      assert.equal((await profile(created.credential)).gems,1050,'duplicate death cannot re-award');
      assert.equal(b.profile.gems,0,'currency frames are private');
      await room.ageCareerForTest(a.id);
      const reset=await profile(created.credential);
      assert.equal(reset.gems,1050,'period reset retains wallet');assert.ok([...reset.daily.challenges,...reset.weekly.challenges].every(c=>c.progress===0&&c.completedAt===null));
      await room.saveEnvironmentForTest();
      await until(()=>a.profile?.daily.challenges.every(c=>c.progress===0),'reset private sync');
      const saved=a.profile,session=a.id,token=a.token;a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED,'close');a=await open(created.credential,token);
      assert.equal(a.id,session);await until(()=>a.profile?.gems===1050,'resume');assert.deepEqual(a.profile.daily,saved.daily);
      for(const p of await Promise.all(Array.from({length:4},()=>profile(created.credential))))assert.equal(p.gems,1050);
    }else{
      if(mode==='abandoned'){
        const token=a.token;a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED,'abandon');a=await open(created.credential,token);
      }
      await room.advanceMapForTest();
      const expected=mode==='eligible'?1050:mode==='late'?700:0;
      await until(async()=>(await profile(created.credential)).gems===expected,'round rewards');
      assert.equal((await profile(created.credential)).gems,expected);
      await room.alarmForTest();assert.equal((await profile(created.credential)).gems,expected,'repeated round wakeup cannot award twice');
    }
    const saved=await profile(created.credential);
    for(const c of clients){clearInterval(c.timer);c.ws.terminate();}await delay(100);
    room[Symbol.dispose]?.();room=null;await mf.dispose();mf=new Miniflare(options);base=(await mf.ready).href;
    assert.equal((await profile(created.credential)).gems,saved.gems,'wallet survives runtime restart without a room session');
    assert.deepEqual((await profile(created.credential)).daily,saved.daily);
  }finally{for(const c of clients){clearInterval(c.timer);c.ws.terminate();}room?.[Symbol.dispose]?.();await mf.dispose();}
});
