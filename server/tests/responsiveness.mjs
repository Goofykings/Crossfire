/** Real browser transport, shared collision and workerd authority, with deterministic link delay/jitter. */
import assert from 'node:assert/strict';import {test} from 'node:test';import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {createServer} from 'vite';import WebSocket from 'ws';import {harness,until,origin} from './room-harness.mjs';
test('responsive prediction: six real peers at 60/40/30/20 FPS, jitter, stalled input, reconciliation and reconnect',{timeout:45000},async t=>{
 const h=await harness(t),vite=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},appType:'custom'});
 const original={window:globalThis.window,WebSocket:globalThis.WebSocket,sessionStorage:globalThis.sessionStorage},timers=new Set(),clients=[];let message=0;
 class DelayedSocket extends WebSocket{
  constructor(url){super(url,{origin});this.delivery=0;}
  addEventListener(type,callback,options){
   if(type!=='message')return super.addEventListener(type,callback,options);
   return super.addEventListener(type,event=>{const now=Date.now(),at=Math.max(this.delivery+1,now+[25,45,30,60][message++%4]);this.delivery=at;
    const timer=setTimeout(()=>{timers.delete(timer);callback.call(this,event);},at-now);timers.add(timer);
   },options);
  }
 }
 try{
  const {MultiplayerClient}=await vite.ssrLoadModule('/src/network/MultiplayerClient.ts'),{PlayerController,NO_INTENT}=await vite.ssrLoadModule('/src/player/PlayerController.ts'),{WORLDS}=await vite.ssrLoadModule('/server/src/world.ts');
  const {simulationSteps}=await vite.ssrLoadModule('/src/core/simulationBudget.ts');
  globalThis.window=globalThis;globalThis.WebSocket=DelayedSocket;const storage=new Map();globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const url=new URL('/ws',h.base).href.replace('http:','ws:');
  for(let i=0;i<6;i++)clients.push(new MultiplayerClient(url,'Renderer '+i,{diagnostics:true,profileScope:()=> 'renderer-'+i}));
  const [a,b]=clients;await Promise.all(clients.map(c=>c.connect()));await Promise.all(clients.map(c=>c.spawn('rifle')));
  const room=h.central,arena=await room.directionalArenaForTest();await room.placeManyForCombatTest([{id:a.selfId,pos:arena.center},{id:b.selfId,pos:arena.sources.front}]);
  await until(()=>Math.abs(a.latest.players.find(p=>p.id===a.selfId).motion.position.x-arena.center[0])<.01,'placed authority');
  const local=new PlayerController(WORLDS[a.latest.mapId].world);local.restore(a.latest.players.find(p=>p.id===a.selfId).motion);
  const others=clients.slice(2).map(c=>{const p=new PlayerController(WORLDS[c.latest.mapId].world);p.restore(c.latest.players.find(p=>p.id===c.selfId).motion);
    c.onSnapshot=s=>c.reconcile(p,s);return{client:c,player:p,debt:0};});
  let reversed=0;const reports=[];a.onSnapshot=s=>{const yaw=local.yaw,pitch=local.pitch;a.reconcile(local,s);if(local.yaw!==yaw||local.pitch!==pitch)reversed++;};
  for(const fps of [60,40,30,20]){
   let accumulator=0,maxTravel=0;const initial={...local.position};
   for(let frame=0;frame<fps;frame++){
    const dt=frame===Math.floor(fps/2)?({60:.1,40:.2,30:.3,20:.25}[fps]):1/fps;local.yaw+=.002;local.pitch=.1;accumulator+=dt;
    const due=simulationSteps(accumulator);
    for(let tick=0;tick<due;tick++){if(!a.canPredict)break;const intent={...NO_INTENT,x:Math.floor(frame/(fps/4))%2?1:-1,crouch:true};local.weaponClearance='rifle';local.fixedUpdate(1/120,intent);a.fixedInput(local,intent);accumulator-=1/120;}
    for(const [index,peer] of others.entries()){
      peer.debt+=dt;const ticks=simulationSteps(peer.debt);
      for(let tick=0;tick<ticks;tick++){if(!peer.client.canPredict)break;const intent={...NO_INTENT,x:index%2?.5:-.5,crouch:true};
        peer.player.weaponClearance='rifle';peer.player.fixedUpdate(1/120,intent);peer.client.fixedInput(peer.player,intent);peer.debt-=1/120;}
    }
    assert.ok(a.inspect().pending<=48);assert.ok(a.inspect().inFlight<=48);maxTravel=Math.max(maxTravel,Math.hypot(local.position.x-initial.x,local.position.z-initial.z));await delay(dt*1000);
   }
   // Explicit release: no renderer means no new key sample, not an immediate key-up.
   local.fixedUpdate(1/120,NO_INTENT);a.fixedInput(local,NO_INTENT);
   for(const peer of others){peer.player.fixedUpdate(1/120,NO_INTENT);peer.client.fixedInput(peer.player,NO_INTENT);}
   await until(()=>a.inspect().pending===0&&Math.hypot(...Object.values(a.latest.players.find(p=>p.id===a.selfId).motion.velocity))<.001,'all admitted ticks acknowledged and release settled');assert.ok(maxTravel>.1,'local movement remains responsive');
   const authoritative=a.latest.players.find(p=>p.id===a.selfId);assert.ok(Math.hypot(local.position.x-authoritative.motion.position.x,local.position.z-authoritative.motion.position.z)<.02,'shared collision/prediction converges');
   assert.equal(a.state,'connected');assert.equal(b.state,'connected');assert.equal(authoritative.health,100);assert.equal(authoritative.life,1);
   reports.push({fps,maxTravel,diagnostics:a.inspect()});
  }
  assert.equal(reversed,0);assert.equal(a.inspect().opens,1);assert.equal(a.latest.players.length,6);
  await until(()=>b.latest.players.some(p=>p.id===a.selfId&&p.ack===a.latest.players.find(q=>q.id===a.selfId).ack),'observer receives final movement');
  console.log(JSON.stringify(reports.map(r=>({fps:r.fps,maxTravel:r.maxTravel,corrections:r.diagnostics.corrections,timing:r.diagnostics.timing}))));
  const saved=a.latest.players.find(p=>p.id===a.selfId),id=a.selfId;a.reconnect();
  await until(()=>a.state==='connected'&&a.inspect().opens===2,'genuine reconnect');
  const resumed=a.latest.players.find(p=>p.id===id);
  for(const key of ['id','life','health','weapon','score','kills','deaths'])assert.equal(resumed[key],saved[key]);
  assert.equal(a.latest.players.length,6);await until(()=>b.latest.players.filter(p=>p.id===id).length===1,'one resumed remote player');
  fs.mkdirSync(fileURLToPath(new URL('../../test-results/',import.meta.url)),{recursive:true});
  fs.writeFileSync(fileURLToPath(new URL('../../test-results/network-real-peers.json',import.meta.url)),JSON.stringify(clients.map(c=>c.diagnosticReport()),null,2));
  await a.leaveRoom();const opens=a.inspect().opens;await delay(500);assert.equal(a.state,'closed');assert.equal(a.inspect().opens,opens);
 }finally{for(const c of clients)c.disconnect();for(const timer of timers)clearTimeout(timer);await vite.close();Object.assign(globalThis,original);}
});
