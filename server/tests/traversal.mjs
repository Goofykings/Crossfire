/** Real workerd/TCP peers: only the initial arena position uses the test fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';

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
      c.send=m=>c.ws.send(JSON.stringify({v: 12,...m}));c.send({type:'join',name:'Traversal peer',...(token?{resumeToken:token}:{})});
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
