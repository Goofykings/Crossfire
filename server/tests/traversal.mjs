import { PROTOCOL_VERSION } from '../../tools/protocol-version.mjs';
/** Real workerd/TCP peers: only the initial arena position uses the test fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';

test('enclosed interiors: authoritative stair loops synchronize across two real peers on every map', {timeout:120000}, async()=>{
  const origin='http://localhost:5173',clients=[];
  const mf=new Miniflare(convertV4MiniflareOptions({name:'interior-traversal',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
      {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
    durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin},log:new Log(LogLevel.ERROR)}));
  const until=async fn=>{const end=Date.now()+6000;while(Date.now()<end){const v=fn();if(v)return v;await delay(10);}throw Error('Interior peer timeout');};
  const me=c=>c.snapshot?.players.find(p=>p.id===c.id);
  try{
    const base=(await mf.ready).href,ns=await mf.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
    const health=await (await fetch(new URL('/health',base))).json(),v=health.protocol;
    assert.ok(Number.isInteger(v));
    async function open(token){
      const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],seq:0};clients.push(c);
      c.ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;});c.ws.on('error',()=>{});
      await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
      c.send=m=>c.ws.send(JSON.stringify({v,...m}));c.send({type:'join',name:'Interior explorer',...(token?{resumeToken:token}:{})});
      const welcome=await until(()=>c.messages.find(m=>m.type==='welcome'));c.id=welcome.selfId;c.token=welcome.resumeToken;c.resumed=welcome.resumed;c.seq=me(c).ack;
      c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);
      c.ws.once('close',()=>clearInterval(c.timer));return c;
    }
    let a=await open();const b=await open();
    for(const id of ['european-town','industrial-complex','modern-city']){
      let round=await room.snapshotForTest();while(round.mapId!==id)round=await room.advanceMapForTest();
      await until(()=>a.snapshot.mapId===id&&b.snapshot.mapId===id);
      a.send({type:'spawn',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,weapon:'sniper',requestId:crypto.randomUUID()});
      await until(()=>me(a).alive);
      const layout=JSON.parse(fs.readFileSync(new URL(`../../src/maps/${id}/layout.json`,import.meta.url),'utf8'));
      const route=layout.circulationRoutes[0],building=layout.buildings.find(b=>b.id===route.id);
      await room.placeForCombatTest(a.id,route.waypoints[0]);
      await until(()=>Math.hypot(me(a).motion.position.x-route.waypoints[0][0],me(a).motion.position.z-route.waypoints[0][2])<.01);
      const before=me(a);let peak=0;
      for(let i=1;i<route.waypoints.length;i++){
        const to=route.waypoints[i],from=route.waypoints[i-1];
        for(let n=0;n<220;n++){
          const p=me(a).motion.position,dx=to[0]-p.x,dz=to[2]-p.z,dist=Math.hypot(dx,dz);if(dist<.12)break;
          const landing=from[1]===1.62&&to[1]===1.62,groundTurn=p.y<.1&&Math.abs(dx)<.12&&Math.abs(dz)<.5;
          const heading=groundTurn?90:landing?(building.circulation.flipZ?180:0)
            :p.y>3&&(to[1]>3||from[1]>3)?(building.circulation.exit==='w'?270:90):Math.atan2(dx,-dz)*180/Math.PI;
          const rawYaw=-heading*Math.PI/180,yaw=Math.atan2(Math.sin(rawYaw),Math.cos(rawYaw)),s=Math.sin(yaw),c=Math.cos(yaw),x=dx/dist,z=dz/dist;
          const frames=Array.from({length:4},()=>({seq:++a.seq,yaw,pitch:0,
            intent:{x:Math.max(-1,Math.min(1,x*c-z*s)),z:Math.max(-1,Math.min(1,-x*s-z*c)),slide:false,aim:false,jumpPressed:false},combat:{trigger:false,reload:false}}));
          a.send({type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,frames});await until(()=>{
            const error=a.messages.find(m=>m.type==='error');if(error)throw Error(JSON.stringify(error));return me(a).ack>=a.seq;
          });
          peak=Math.max(peak,me(a).motion.position.y);assert.ok(me(a).motion.position.y>=-.02);
        }
        const p=me(a).motion.position;assert.ok(Math.hypot(p.x-to[0],p.z-to[2])<.18,`${id} segment ${i}: ${JSON.stringify(p)}`);
        if(i===route.waypoints.length-2){
          // Stop held movement and let real server friction settle before comparing
          // exact positions: a reconnect must not equal an earlier moving snapshot.
          a.send({type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,frames:[{seq:++a.seq,yaw:me(a).motion.yaw,pitch:0,
            intent:{x:0,z:0,slide:false,aim:false,jumpPressed:false},combat:{trigger:false,reload:false}}]});
          await until(()=>me(a).ack>=a.seq&&Math.hypot(me(a).motion.velocity.x,me(a).motion.velocity.z)===0);
          const saved=me(a),token=a.token,session=a.id;a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED);a=await open(token);
          assert.ok(a.resumed);assert.equal(a.id,session);assert.equal(me(a).life,saved.life);assert.equal(me(a).health,saved.health);
          assert.deepEqual(me(a).motion.position,saved.motion.position);
        }
      }
      assert.ok(Math.abs(peak-route.height)<.03);assert.ok(me(a).motion.position.y<.1);
      assert.equal(me(a).health,before.health);assert.equal(me(a).weapon,'sniper');assert.equal(me(a).kills,before.kills);
      await until(()=>{const p=b.snapshot.players.find(p=>p.id===a.id);return p&&Math.hypot(p.motion.position.x-me(a).motion.position.x,p.motion.position.z-me(a).motion.position.z)<.02;});
      assert.equal(b.snapshot.players.filter(p=>p.id===a.id).length,1);
      assert.deepEqual(a.messages.filter(m=>m.type==='error'),[]);
    }
  }finally{for(const c of clients){clearInterval(c.timer);c.ws.terminate();}await mf.dispose();}
});

test('authoritative ladders: real movement, peer synchronization, release and reconnect', {timeout:60000}, async () => {
  const origin='http://localhost:5173', clients=[];
  const mf=new Miniflare(convertV4MiniflareOptions({name:'traversal',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
      {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
    resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/traversal-',import.meta.url))),
    durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin},log:new Log(LogLevel.ERROR)}));
  const until=async (fn) => {const end=Date.now()+6000;while(Date.now()<end){const v=fn();if(v)return v;await delay(10);}throw new Error('Traversal message timeout');};
  try {
    const base=(await mf.ready).href,ns=await mf.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
    let round=await room.advanceMapForTest();while(round.mapId!=='industrial-complex')round=await room.advanceMapForTest();
    const me=c=>c.snapshot?.players.find(p=>p.id===c.id);
    async function open(token) {
      const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],snapshot:null,seq:0,id:''};clients.push(c);
      c.ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;});c.ws.on('error',()=>{});
      await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
      c.send=m=>c.ws.send(JSON.stringify({v: PROTOCOL_VERSION,...m}));c.send({type:'join',name:'Traversal peer',...(token?{resumeToken:token}:{})});
      const welcome=await until(()=>c.messages.find(m=>m.type==='welcome'));c.id=welcome.selfId;c.token=welcome.resumeToken;
      c.seq=me(c).ack;c.resumed=welcome.resumed;
      c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);
      c.ws.once('close',()=>clearInterval(c.timer));
      if(!me(c).alive){c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon:'sniper',requestId:crypto.randomUUID()});await until(()=>me(c).alive);}
      return c;
    }
    let a=await open();const b=await open();
    const layout=JSON.parse(fs.readFileSync(new URL('../../src/maps/industrial-complex/layout.json',import.meta.url),'utf8'));
    for(const [index,l] of layout.ladders.entries()) {
      const yaw=Math.atan2(l.out[0],l.out[1]);
      const position=[l.wall[0]+l.out[0]*2.6,l.bottom,l.wall[1]+l.out[1]*2.6];
      await room.placeForCombatTest(a.id,position,Math.atan2(-l.out[0],l.out[1])*180/Math.PI);
      const drive=async(z)=> {
        const frames=Array.from({length:6},()=>({seq:++a.seq,yaw,pitch:0,
          intent:{x:0,z,slide:false,aim:false,jumpPressed:false},combat:{trigger:false,reload:false}}));
        a.send({type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,frames});
        await until(()=>me(a)?.ack>=a.seq);
      };
      let n=0;while(me(a).motion.position.y<1&&n++<45)await drive(1);
      assert.ok(me(a).motion.position.y>=1,`${l.id}: climbs from ground`);
      await drive(0);const paused=me(a).motion.position.y;await delay(200);
      assert.ok(Math.abs(me(a).motion.position.y-paused)<.001,'release holds height');
      await until(()=>Math.abs((b.snapshot.players.find(p=>p.id===a.id)?.motion.position.y??-99)-paused)<.01);
      if(index===0) {
        const before=me(a),token=a.token,id=a.id;a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED);a=await open(token);
        assert.ok(a.resumed);assert.equal(a.id,id);assert.equal(me(a).health,before.health);
        assert.equal(me(a).weapon,before.weapon);assert.equal(me(a).life,before.life);
        assert.ok(Math.abs(me(a).motion.position.y-paused)<.001,'mid-ladder resume preserves height');
        await until(()=>b.snapshot.players.filter(p=>p.id===id).length===1);
      }
      n=0;while((me(a).motion.position.y<l.top-.01||!me(a).motion.grounded)&&n++<70)await drive(1);
      assert.ok(me(a).motion.grounded&&Math.abs(me(a).motion.position.y-l.top)<.01,`${l.id}: enters roof`);
      await drive(0);n=0;while(me(a).motion.position.y>.01&&n++<100)await drive(-1);
      assert.ok(me(a).motion.grounded&&me(a).motion.position.y<.01,`${l.id}: descends to ground`);
      assert.ok(!a.messages.some(m=>m.type==='error'),`no input/map errors: ${JSON.stringify(a.messages.filter(m=>m.type==='error'))}`);
    }
  } finally {
    for(const c of clients){clearInterval(c.timer);c.ws.terminate();}
    await mf.dispose();
  }
});
