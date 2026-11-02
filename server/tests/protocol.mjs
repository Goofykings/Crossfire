/** Release gate: the actual browser transport and shared parsers talk to real workerd. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'vite';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import WebSocket from 'ws';
import {verifyRelease} from '../../tools/verify-release.mjs';

test('real frontend transport is compatible with the production Worker messages',{timeout:30000},async()=>{
  const origin='http://localhost:5173',revision='a'.repeat(40),sent=[],received=[],clients=[],sockets=[];
  const original={window:globalThis.window,WebSocket:globalThis.WebSocket};
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},appType:'custom'});
  const mf=new Miniflare(convertV4MiniflareOptions({name:'protocol-compatibility',
    modules:[{type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],
    compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
    durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
    bindings:{ALLOWED_ORIGINS:origin,RELEASE_SHA:revision},log:new Log(LogLevel.ERROR)}));
  const until=async(fn,label)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){const result=fn();if(result)return result;await delay(15);}throw new Error(label);};
  try{
    const {MultiplayerClient}=await vite.ssrLoadModule('/src/network/MultiplayerClient.ts');
    const protocol=await vite.ssrLoadModule('/shared/protocol.ts');
    const {PlayerController,NO_INTENT}=await vite.ssrLoadModule('/src/player/PlayerController.ts');
    const {CollisionWorld}=await vite.ssrLoadModule('/src/physics/CollisionWorld.ts');
    const base=(await mf.ready).href,url=new URL('/ws',base).href.replace('http:','ws:');
    await verifyRelease({url:new URL('/health',base).href,protocol:protocol.PROTOCOL_VERSION,release:revision,attempts:1,log:()=>{}});
    const health=await fetch(new URL('/health',base));assert.equal(health.headers.get('cache-control'),'no-store');
    class BrowserSocket extends WebSocket{
      constructor(url){super(url,{origin});sockets.push(this);this.addEventListener('message',e=>received.push(e.data));}
      send(raw,...args){sent.push(raw);super.send(raw,...args);}
    }
    globalThis.window=globalThis;globalThis.WebSocket=BrowserSocket;
    const a=new MultiplayerClient(url,'Release client A'),b=new MultiplayerClient(url,'Release client B');clients.push(a,b);
    await Promise.all([a.connect(),b.connect()]);assert.notEqual(a.selfId,b.selfId);
    assert.equal(a.latest.room,protocol.PUBLIC_ROOM);assert.ok(a.environment?.full);
    await Promise.all([a.spawn('rifle'),b.spawn('smg')]);
    for(const c of [a,b]){
      const self=c.latest.players.find(p=>p.id===c.selfId);assert.equal(self.alive,true);assert.equal(self.health,100);
      assert.ok(self.combat.gun);assert.ok(Number.isFinite(self.motion.crouch));assert.ok(Number.isFinite(self.motion.lean));
    }
    const player=new PlayerController(new CollisionWorld());player.restore(a.latest.players.find(p=>p.id===a.selfId).motion);
    player.yaw=.3;player.pitch=.1;
    for(let n=0;n<12;n++)a.fixedInput(player,{...NO_INTENT,crouch:true,aim:true});
    await until(()=>b.latest.players.some(p=>p.id===a.selfId&&p.ack>=12&&Math.abs(p.motion.yaw-.3)<.001),'Worker must accept real frontend input and synchronize orientation');
    const chat=[];b.onChat=m=>chat.push(m);assert.equal(a.sendChat('Release compatibility check'),true);
    await until(()=>chat.some(m=>m.id===a.selfId&&m.text==='Release compatibility check'),'Real chat schema must round-trip');
    // Both directions use the same schemas, not just a matching version constant.
    for(const wire of sent)assert.ok(protocol.parseClientMessage(String(wire)),`Invalid frontend packet: ${String(wire).slice(0,100)}`);
    for(const wire of received)assert.ok(protocol.parseServerMessage(String(wire)),'Worker emitted an incompatible message');
    assert.ok(sent.some(raw=>JSON.parse(raw).type==='input'));assert.ok(received.some(raw=>JSON.parse(raw).type==='spawned'));
    const selfId=a.selfId;a.disconnect(false);await a.connect();assert.equal(a.selfId,selfId,'Real frontend resume retains server identity');
    assert.equal(a.latest.players.find(p=>p.id===selfId).weapon,'rifle');
    const invalid=new WebSocket(url,{origin});sockets.push(invalid);const rejected=[];
    invalid.on('message',raw=>rejected.push(JSON.parse(String(raw))));
    await new Promise((resolve,reject)=>{invalid.once('open',resolve);invalid.once('error',reject);});
    invalid.send(JSON.stringify({v:protocol.PROTOCOL_VERSION+1,type:'join',name:'Wrong version'}));
    await until(()=>rejected.some(m=>m.type==='error'&&m.fatal),'Worker must reject incompatible versions');
    assert.ok(!rejected.some(m=>m.type==='welcome'));
    // Current version with an illegal payload must also be rejected, never bypassed.
    const malformed=new WebSocket(url,{origin});sockets.push(malformed);const errors=[];
    malformed.on('message',raw=>errors.push(JSON.parse(String(raw))));
    await new Promise((resolve,reject)=>{malformed.once('open',resolve);malformed.once('error',reject);});
    malformed.send(JSON.stringify({v:protocol.PROTOCOL_VERSION,type:'join',name:'Invalid schema',health:100}));
    await until(()=>errors.some(m=>m.type==='error'&&m.fatal),'Worker must reject incompatible schemas even at the same version');
  }finally{
    for(const c of clients)c.disconnect();for(const s of sockets)s.terminate();
    globalThis.window=original.window;globalThis.WebSocket=original.WebSocket;
    await mf.dispose();await vite.close();
  }
});
