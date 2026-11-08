import { testRoom } from './test-rpc.mjs';
import { PROTOCOL_VERSION } from '../../tools/protocol-version.mjs';
/** Real workerd and TCP clients; test RPC places players only, never prop impulses. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';

test('authoritative environmental hits, bounded deltas, sleep, resume and round cleanup',{timeout:45000},async()=>{
  const origin='http://localhost:5173',clients=[];
  const options=convertV4MiniflareOptions({name:'environment',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
      {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
    resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/environment-',import.meta.url))),
    durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)});
  let mf=new Miniflare(options);
  const until=async(fn,label,ms=9000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(15);}throw new Error(label);};
  try{
    let base=(await mf.ready).href,room=testRoom(mf, 'public-main');
    let round=JSON.parse(JSON.stringify(await room.advanceMapForTest()));while(round.mapId!=='european-town')round=JSON.parse(JSON.stringify(await room.advanceMapForTest()));
    const self=c=>c.snapshot.players.find(p=>p.id===c.id);
    async function open(token){
      const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],snapshot:null,seq:0,states:new Map()};clients.push(c);
      c.ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;
        const frame=m.frame??m.snapshot?.environment;if(frame){if(frame.full)c.states.clear();for(const s of frame.states)c.states.set(s.id,s);}});
      c.ws.on('error',()=>{});await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
      c.send=m=>c.ws.send(JSON.stringify({v: PROTOCOL_VERSION,...m}));c.send({type:'join',name:'Environment peer',...(token?{resumeToken:token}:{})});
      const w=await until(()=>c.messages.find(m=>m.type==='welcome'),'welcome');c.id=w.selfId;c.token=w.resumeToken;c.resumed=w.resumed;c.seq=self(c).ack;
      c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);
      c.ws.once('close',()=>clearInterval(c.timer));return c;
    }
    async function input(c,aim,trigger,aimHeld=true){const seq=++c.seq;c.send({type:'input',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,
      frames:[{seq,yaw:aim.yaw,pitch:aim.pitch,intent:{x:0,z:0,slide:false,aim:aimHeld,jumpPressed:false},combat:{trigger,reload:false}}]});
      await until(()=>self(c).ack>=seq,'input acknowledgement');}
    let a=await open();const b=await open();assert.equal(a.states.size,14);assert.deepEqual([...a.states.values()],[...b.states.values()]);
    assert.ok([...a.states.values()].every(s=>s.asleep));await delay(450);
    assert.equal(b.messages.filter(m=>m.type==='environment').length,0,'no decorative traffic while asleep');
    a.send({type:'spawn',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,weapon:'rifle',requestId:crypto.randomUUID()});
    await until(()=>self(a).alive,'spawn');await delay(350);
    const def=JSON.parse(JSON.stringify((await room.environmentForTest()).definition)),apple=def.bodies[0],before=structuredClone(b.states.get(apple.id));
    const aim=await room.environmentTargetForTest(apple.id);await room.placeForCombatTest(a.id,aim.position);
    // Tiny fruit must be targeted with a settled sight. Setting aim and firing
    // in the same first frame used random hip spread, so this assertion flaked.
    await input(a,aim,false);await until(()=>self(a).combat.gun.ads===1,'settled ADS before tiny prop');
    const mark=b.messages.length;await input(a,aim,true);await input(a,aim,false);
    await until(()=>b.messages.slice(mark).some(m=>m.type==='environment'&&m.frame.states.some(s=>s.id===apple.id&&!s.asleep)),'shot moves apple');
    await until(()=>b.states.get(apple.id).asleep,'apple settles');
    assert.notDeepEqual(b.states.get(apple.id).position,before.position);
    await delay(120);assert.deepEqual(a.states.get(apple.id),b.states.get(apple.id),'same authoritative final pose on both sockets');
    const frames=b.messages.slice(mark).filter(m=>m.type==='environment');assert.ok(frames.length<100);
    for(const m of frames){assert.equal(m.frame.full,false);assert.ok(m.frame.states.length<=14);
      for(const s of m.frame.states)assert.ok(Math.hypot(s.velocity.x,s.velocity.y,s.velocity.z)<=8.00001);}
    const quiet=b.messages.length;await delay(400);assert.equal(b.messages.slice(quiet).filter(m=>m.type==='environment').length,0);
    const saved=[...a.states.values()],id=a.id,life=self(a).life;a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED,'close');
    a=await open(a.token);assert.ok(a.resumed);assert.equal(a.id,id);assert.equal(self(a).life,life);
    assert.deepEqual([...a.states.values()].sort((a,b)=>a.id.localeCompare(b.id)),saved.sort((a,b)=>a.id.localeCompare(b.id)),'resume restores props, not spawn defaults');
    const pear=def.bodies.find(b=>b.asset==='pear'),pearAim=await room.environmentTargetForTest(pear.id);
    await room.placeForCombatTest(a.id,pearAim.position);await input(a,pearAim,true);await input(a,pearAim,false);
    await until(()=>!b.states.get(pear.id).asleep,'confirmed hit moves an individual pear');
    await until(()=>b.states.get(pear.id).asleep,'pear settles');
    const sign=def.signs[0],signAim=await room.environmentTargetForTest(sign.id);await room.placeForCombatTest(a.id,signAim.position);
    await input(a,signAim,true);await input(a,signAim,false);
    await until(()=>Math.abs(b.states.get(sign.id).angle)>.01,'real sign board swings');
    await until(()=>b.states.get(sign.id).asleep,'sign rests');assert.equal(b.states.get(sign.id).angle,0);
    const light=def.lights[0],lightAim=await room.environmentTargetForTest(light.id);await room.placeForCombatTest(a.id,lightAim.position);
    const hingeBefore=b.states.get(light.id).position;
    await input(a,lightAim,true);await input(a,lightAim,false);
    await until(()=>Math.abs(b.states.get(light.id).angle)>.08,'real hanging light visibly swings');
    assert.deepEqual(b.states.get(light.id).position,hingeBefore,'suspension stays attached');
    await until(()=>b.states.get(light.id).asleep,'light rests');
    await until(()=>a.states.get(light.id).angle===0,'both clients converge to light rest');
    await input(a,lightAim,false,false);await until(()=>self(a).combat.gun.ads===0,'release ADS before hibernation');await delay(200);
    const savedEnvironment=JSON.parse(JSON.stringify((await room.environmentForTest()).states)),playerBefore=self(a);
    const resumeToken=a.token;a.ws.close();b.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED&&b.ws.readyState===WebSocket.CLOSED,'close before runtime reconstruction');
    await room.saveEnvironmentForTest();
    room[Symbol.dispose]?.();
    await mf.dispose();mf=new Miniflare(options);base=(await mf.ready).href;
    room=testRoom(mf, 'public-main');
    assert.deepEqual((await room.environmentForTest()).states,savedEnvironment,'matching map revision restores moved props after reconstruction');
    await room.saveEnvironmentForTest(true);
    room[Symbol.dispose]?.();
    await mf.dispose();mf=new Miniflare(options);base=(await mf.ready).href;
    room=testRoom(mf, 'public-main');
    const revised=await room.environmentForTest();
    for(const state of revised.states){const d=[...revised.definition.bodies,...revised.definition.signs,...revised.definition.lights].find(d=>d.id===state.id);
      assert.deepEqual(state.position,{x:d.position[0],y:d.position[1],z:d.position[2]},'obsolete map poses cannot float in revised baskets');}
    a=await open(resumeToken);assert.ok(a.resumed);const playerAfter=self(a);
    for(const field of ['health','life','weapon','kills','score'])assert.equal(playerAfter[field],playerBefore[field],'prop migration preserves '+field);
    const forged=await open();forged.send({type:'environment',frame:{states:[{id:apple.id,position:{x:500,y:500,z:500}}]}});
    await until(()=>forged.messages.some(m=>m.type==='error'),'forged prop claim rejected');
    assert.ok((await room.environmentForTest()).states.every(s=>Math.abs(s.position.x)<30));
    const next=await room.advanceMapForTest();assert.notEqual(next.roundId,round.roundId);
    assert.ok((await room.environmentForTest()).states.every(s=>s.asleep&&s.angle===0));
    assert.equal(self(a).kills,0);assert.equal(self(a).score,0,'decorative shots never award combat points');
    room[Symbol.dispose]?.();
  }finally{for(const c of clients){clearInterval(c.timer);c.ws.terminate();}await mf.dispose();}
});
