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
  const original={window:globalThis.window,WebSocket:globalThis.WebSocket,sessionStorage:globalThis.sessionStorage};
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
    const stored=new Map();globalThis.sessionStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
    const a=new MultiplayerClient(url,' <Release client A> ',{profileScope:()=> 'a'}),b=new MultiplayerClient(url,'Release client B',{profileScope:()=> 'b'});clients.push(a,b);
    const joins=[];a.onSystem=m=>joins.push(m);
    await a.connect();await b.connect();assert.notEqual(a.selfId,b.selfId);
    await until(()=>joins.length===2,'Every genuine entry must announce to connected browsers');
    assert.deepEqual(joins.map(m=>m.name),['Release client A','Release client B']);
    assert.equal(joins[1].id,`join:${b.selfId}`);
    assert.equal(a.latest.players.find(p=>p.id===a.selfId).alive,false,'Joining must not spawn before selection');
    assert.equal(a.latest.room,protocol.PUBLIC_ROOM);assert.ok(a.environment?.full);
    await Promise.all([a.spawn('semi-sniper'),b.spawn('smg')]);
    for(const c of [a,b]){
      const self=c.latest.players.find(p=>p.id===c.selfId);assert.equal(self.alive,true);assert.equal(self.health,100);
      assert.ok(self.combat.gun);if(self.weapon==='smg')assert.equal(self.combat.gun.ammo,64,'real frontend accepts the shared expanded magazine limit');assert.ok(Number.isFinite(self.motion.crouch));assert.ok(Number.isFinite(self.motion.lean));
      assert.equal(self.cosmeticId,`default-${self.weapon}`,'Optional visual metadata carries canonical compatible equipment');
      if(self.weapon==='semi-sniper')assert.equal(self.combat.gun.ammo,15,'real frontend accepts the fifth weapon and its magazine');
    }
    const player=new PlayerController(new CollisionWorld());player.restore(a.latest.players.find(p=>p.id===a.selfId).motion);
    player.yaw=.3;player.pitch=.1;
    for(let n=0;n<12;n++)a.fixedInput(player,{...NO_INTENT,crouch:true,aim:true});
    await until(()=>b.latest.players.some(p=>p.id===a.selfId&&p.ack>=12&&Math.abs(p.motion.yaw-.3)<.001),'Worker must accept real frontend input and synchronize orientation');
    a.fixedInput(player,{...NO_INTENT},{trigger:false,reload:false,grenade:true});
    a.fixedInput(player,{...NO_INTENT},{trigger:false,reload:false,grenadeCancel:true});
    await until(()=>a.latest.players.find(p=>p.id===a.selfId)?.ack>=14,'Worker accepts real frontend grenade hold/cancellation frames');
    assert.equal(a.latest.players.find(p=>p.id===a.selfId).grenades,1,'Cancellation must leave inventory intact');
    assert.equal(a.latest.grenades.length,0,'Cancellation must never become a release');
    const chat=[];b.onChat=m=>chat.push(m);assert.equal(a.sendChat('Release compatibility check'),true);
    await until(()=>chat.some(m=>m.id===a.selfId&&m.text==='Release compatibility check'),'Real chat schema must round-trip');
    // Both directions use the same schemas, not just a matching version constant.
    for(const wire of sent)assert.ok(protocol.parseClientMessage(String(wire)),`Invalid frontend packet: ${String(wire).slice(0,100)}`);
    for(const wire of received)assert.ok(protocol.parseServerMessage(String(wire)),'Worker emitted an incompatible message');
    const visual=received.map(w=>JSON.parse(String(w))).find(m=>m.snapshot?.players.some(p=>p.weapon));
    assert.ok(visual,'A real armed snapshot is required for metadata compatibility');
    const old=structuredClone(visual);for(const p of old.snapshot.players)delete p.cosmeticId;
    assert.ok(protocol.parseServerMessage(JSON.stringify(old)),'Existing snapshots without visual metadata remain valid');
    const future=structuredClone(visual),armed=future.snapshot.players.find(p=>p.weapon);armed.cosmeticId='future-visual';
    assert.ok(protocol.parseServerMessage(JSON.stringify(future)),'Unknown well-formed visual IDs must not disconnect old clients');
    armed.cosmeticId=armed.weapon==='sniper'?'default-rifle':'default-sniper';
    assert.equal(protocol.parseServerMessage(JSON.stringify(future)),null,'Known cross-category metadata remains invalid');
    assert.ok(sent.some(raw=>JSON.parse(raw).type==='input'));assert.ok(received.some(raw=>JSON.parse(raw).type==='spawned'));
    const selfId=a.selfId;a.disconnect(false);await a.connect();assert.equal(a.selfId,selfId,'Real frontend resume retains server identity');
    assert.equal(a.latest.players.find(p=>p.id===selfId).weapon,'semi-sniper');
    await delay(150);assert.equal(joins.length,2,'Resuming/refreshing the same session must not announce twice');
    const observer=[];b.onSystem=m=>observer.push(m);
    a.disconnect(false);await a.connect();await delay(150);
    assert.equal(observer.length,0,'Other peers must not see a join on repeated resume');
    a.disconnect(false);
    const refreshed=new MultiplayerClient(url,'Release client A',{profileScope:()=> 'a'});clients.push(refreshed);
    await refreshed.connect();assert.equal(refreshed.selfId,selfId,'A new browser transport restores the persisted resume token');
    await delay(150);assert.equal(observer.length,0,'Rapid refresh must not reannounce a session');
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
    const forged=new WebSocket(url,{origin});sockets.push(forged);const denied=[];
    forged.on('message',raw=>denied.push(JSON.parse(String(raw))));
    await new Promise((resolve,reject)=>{forged.once('open',resolve);forged.once('error',reject);});
    forged.send(JSON.stringify({v:protocol.PROTOCOL_VERSION,type:'system',kind:'player_joined',id:joins[0].id,name:'Server'}));
    await until(()=>denied.some(m=>m.type==='error'&&m.fatal),'Worker rejects client-forged system messages');
    assert.equal(observer.length,0);
  }finally{
    for(const c of clients)c.disconnect();for(const s of sockets)s.terminate();
    globalThis.window=original.window;globalThis.WebSocket=original.WebSocket;globalThis.sessionStorage=original.sessionStorage;
    await mf.dispose();await vite.close();
  }
});
