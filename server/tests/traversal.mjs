import { testRoom } from './test-rpc.mjs';
import { PROTOCOL_VERSION } from '../../tools/protocol-version.mjs';
/** Real workerd/TCP peers: only the initial arena position uses the test fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';
import { harness, until as roomUntil, self as roomSelf } from './room-harness.mjs';

test('Industrial loading dock: normal jumps land with all weapons and synchronize to a second real peer', {timeout:60000}, async t => {
  const h=await harness(t),token=await h.profile(),other=await h.profile();
  const ad=await h.create(token,{mapId:'industrial-complex'}),room=h.room(ad.room.id);
  const b=await h.open(await h.admission(other,{roomId:ad.room.id}),other);
  for(const weapon of ['rifle','smg','shotgun','sniper','semi-sniper']) {
    const a=await h.open(await h.admission(token,{roomId:ad.room.id}),token);
    await h.spawn(a,weapon);const life=roomSelf(a).life;
    await room.placeForCombatTest(a.id,[7,0,-5],90);
    await roomUntil(()=>Math.abs(roomSelf(a).motion.position.x-7)<.001,'approach position');
    let jumped=false,landed=false;
    for(let tick=0;tick<180;tick+=6){
      const p=roomSelf(a).motion.position,distance=10-p.x;
      const jump=!jumped&&distance<1.1;jumped ||= jump;
      a.send({type:'input',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,
        frames:Array.from({length:6},(_,i)=>({seq:++a.seq,yaw:-Math.PI/2,pitch:0,
          intent:{x:0,z:distance>-.8?1:0,slide:false,aim:false,jumpPressed:jump&&i===0},combat:{trigger:false,reload:false}}))});
      await roomUntil(()=>roomSelf(a).ack>=a.seq,'jump input acknowledgment');
      const state=roomSelf(a);landed ||= state.motion.grounded&&Math.abs(state.motion.position.y-1)<.001;
      assert.ok(state.motion.position.y>=0);assert.equal(state.health,100);assert.equal(state.life,life);
      if(landed&&state.motion.velocity.x===0)break;
    }
    assert.ok(landed,`${weapon} reached the loading dock`);
    const end=roomSelf(a),peer=await roomUntil(()=>b.snapshot.players.find(p=>p.id===a.id&&p.ack>=end.ack),'peer landing snapshot');
    assert.equal(peer.motion.position.y,1);assert.equal(peer.motion.grounded,true);
    assert.equal(peer.life,life);assert.equal(peer.health,100);
    assert.deepEqual(a.messages.filter(m=>m.type==='error'),[]);
    await h.leave(a);
  }
});

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
    const base=(await mf.ready).href,room=testRoom(mf, 'public-main');
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
    const base=(await mf.ready).href,room=testRoom(mf, 'public-main');
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


test('swept wall movement and secondary recovery synchronize across real peers on all maps', {timeout:90000}, async()=>{
  const origin='http://localhost:5173',clients=[];
  const mf=new Miniflare(convertV4MiniflareOptions({name:'collision-safety',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
      {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
    bindings:{ALLOWED_ORIGINS:origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)}));
  const until=async fn=>{const end=Date.now()+6000;while(Date.now()<end){const v=fn();if(v)return v;await delay(10);}throw Error('Collision peer timeout');};
  const me=c=>c.snapshot?.players.find(p=>p.id===c.id);
  try{
    const base=(await mf.ready).href,room=testRoom(mf, 'public-main');
    const {protocol:v}=await (await fetch(new URL('/health',base))).json();
    async function open(token){
      const c={ws:new WebSocket(new URL('/ws',base).href.replace('http:','ws:'),{origin}),messages:[],seq:0};clients.push(c);
      c.ws.on('message',raw=>{const m=JSON.parse(String(raw));c.messages.push(m);if(m.snapshot)c.snapshot=m.snapshot;});c.ws.on('error',()=>{});
      await new Promise((resolve,reject)=>{c.ws.once('open',resolve);c.ws.once('error',reject);});
      c.send=m=>c.ws.send(JSON.stringify({v,...m}));c.send({type:'join',name:'Wall regression',...(token?{resumeToken:token}:{})});
      const welcome=await until(()=>c.messages.find(m=>m.type==='welcome'));c.id=welcome.selfId;c.token=welcome.resumeToken;c.seq=me(c).ack;
      c.timer=setInterval(()=>{if(c.ws.readyState===WebSocket.OPEN)c.send({type:'ping',at:Date.now()});},500);
      c.ws.once('close',()=>clearInterval(c.timer));return c;
    }
    let a=await open();const b=await open();let mapIndex=0;
    for(const id of ['european-town','industrial-complex','modern-city']){
      let round=await room.snapshotForTest();while(round.mapId!==id)round=await room.advanceMapForTest();
      await until(()=>a.snapshot.mapId===id&&b.snapshot.mapId===id);
      const weapons=[['rifle','sniper'],['smg','shotgun'],['shotgun','rifle']][mapIndex++];
      for(const [i,c]of [a,b].entries())c.send({type:'spawn',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,weapon:weapons[i],requestId:crypto.randomUUID()});
      await until(()=>me(a).alive&&me(b).alive);
      const arena=await room.wallArenaForTest(),[start,end]=arena.pair;
      const dx=end[0]-start[0],dz=end[2]-start[2],distance=Math.hypot(dx,dz),nx=dx/distance,nz=dz/distance;
      const center=[(start[0]+end[0])/2,(start[2]+end[2])/2],half=distance/2-1.2;
      for(const [i,c]of [a,b].entries()){
        const sign=i===0?1:-1,heading=Math.atan2(nx*sign,-nz*sign)*180/Math.PI;
        await room.placeForCombatTest(c.id,arena.pair[i],heading);c.yaw=-heading*Math.PI/180;
      }
      for(let n=0;n<240;n+=6){
        for(const c of [a,b]){
          const frames=Array.from({length:6},(_,i)=>({seq:++c.seq,yaw:c.yaw,pitch:0,
            intent:{...{x:0,z:1,aim:n%40<20,slide:n%160<100,jumpPressed:false}},combat:{trigger:false,reload:false}}));
          c.send({type:'input',roundId:c.snapshot.roundId,mapVersion:c.snapshot.mapVersion,frames});
        }
        await until(()=>[a,b].every(c=>me(c).ack>=c.seq));
        for(const [i,c]of [a,b].entries()){
          const p=me(c).motion.position,signed=(p.x-center[0])*nx+(p.z-center[1])*nz;
          assert.ok(i===0?signed<=-half-.339:signed>=half+.339,`${id} crossed ${arena.wall}: ${JSON.stringify(p)}`);
          assert.ok(p.y>=-.001);assert.equal(me(c).health,100);assert.equal(me(c).alive,true);
          assert.equal(c.messages.filter(m=>m.type==='error').length,0);
        }
      }
      const final=me(a),other=await until(()=>b.snapshot.players.find(p=>p.id===a.id&&p.ack===final.ack));
      assert.deepEqual(other.motion.position,final.motion.position,'both peers see identical authoritative wall stop');
    }
    const before=me(a),id=a.id,token=a.token;
    a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED);a=await open(token);
    assert.equal(a.id,id);assert.equal(me(a).life,before.life);assert.equal(me(a).health,before.health);
    assert.deepEqual(me(a).motion.position,before.motion.position);assert.equal(a.snapshot.players.length,2);
    await room.outsideForTest(a.id);await until(()=>!me(a).alive&&me(a).death);
    const recovered=me(a);assert.equal(recovered.deaths,before.deaths+1);
    assert.equal(recovered.score,before.score);assert.equal(recovered.death.killerId,null);
    // Repeated real ticks cannot kill or award the already-dead session twice.
    b.send({type:'input',roundId:b.snapshot.roundId,mapVersion:b.snapshot.mapVersion,
      frames:Array.from({length:6},()=>({seq:++b.seq,yaw:b.yaw,pitch:0,
        intent:{x:0,z:0,aim:false,slide:false,jumpPressed:false},combat:{trigger:false,reload:false}}))});
    await until(()=>me(b).ack>=b.seq&&a.snapshot.serverTime>=b.snapshot.serverTime);
    assert.equal(me(a).deaths,recovered.deaths);assert.equal(me(a).score,recovered.score);
    await until(()=>Date.now()>=me(a).death.respawnAt);
    a.send({type:'spawn',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,weapon:'smg',requestId:crypto.randomUUID()});
    await until(()=>me(a).alive);assert.equal(me(a).life,before.life+1);
    const p=me(a).motion.position;assert.ok(Math.abs(p.x)<28&&Math.abs(p.z)<28&&p.y>=0,'normal validated respawn recovers inside map');
    await room.fallForTest(a.id);await until(()=>!me(a).alive);assert.equal(me(a).deaths,recovered.deaths+1);
    await until(()=>Date.now()>=me(a).death.respawnAt);
    a.send({type:'spawn',roundId:a.snapshot.roundId,mapVersion:a.snapshot.mapVersion,weapon:'rifle',requestId:crypto.randomUUID()});
    await until(()=>me(a).alive);await room.outsideForTest(a.id,true);await until(()=>!me(a).alive);
    assert.equal(me(a).deaths,recovered.deaths+2);
    const clean=me(a).motion;assert.ok([clean.position.x,clean.position.y,clean.position.z,clean.velocity.x,clean.velocity.y,clean.velocity.z].every(Number.isFinite),'recovery preserves valid motion even in dead snapshots');
  }finally{for(const c of clients){clearInterval(c.timer);c.ws.terminate();}await mf.dispose();}
});
