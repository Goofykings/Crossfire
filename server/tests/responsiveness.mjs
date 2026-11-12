/** Real browser transport, shared collision and workerd authority, with deterministic link delay/jitter. */
import assert from 'node:assert/strict';import {test} from 'node:test';import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';import WebSocket from 'ws';import {harness,until,origin} from './room-harness.mjs';
test('responsive prediction: real peers at 60/30/20 FPS, jitter, stalled input, reconciliation and live mouse ownership',{timeout:45000},async t=>{
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
  globalThis.window=globalThis;globalThis.WebSocket=DelayedSocket;const storage=new Map();globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const url=new URL('/ws',h.base).href.replace('http:','ws:'),a=new MultiplayerClient(url,'Slow renderer',{profileScope:()=> 'slow'}),b=new MultiplayerClient(url,'Observer',{profileScope:()=> 'observer'});clients.push(a,b);
  await Promise.all([a.connect(),b.connect()]);await Promise.all([a.spawn('rifle'),b.spawn('rifle')]);
  const room=h.central,arena=await room.directionalArenaForTest();await room.placeManyForCombatTest([{id:a.selfId,pos:arena.center},{id:b.selfId,pos:arena.sources.front}]);
  await until(()=>Math.abs(a.latest.players.find(p=>p.id===a.selfId).motion.position.x-arena.center[0])<.01,'placed authority');
  const local=new PlayerController(WORLDS[a.latest.mapId].world);local.restore(a.latest.players.find(p=>p.id===a.selfId).motion);
  let reversed=0;const reports=[];a.onSnapshot=s=>{const yaw=local.yaw,pitch=local.pitch;a.reconcile(local,s);if(local.yaw!==yaw||local.pitch!==pitch)reversed++;};
  for(const fps of [60,30,20]){
   let accumulator=0,maxTravel=0;const initial={...local.position};
   for(let frame=0;frame<fps;frame++){
    const dt=frame===Math.floor(fps/2)?.25:1/fps;local.yaw+=.002;local.pitch=.1;accumulator+=dt;
    while(accumulator>=1/120){if(!a.canPredict){accumulator=0;break;}const intent={...NO_INTENT,x:Math.floor(frame/(fps/4))%2?1:-1,crouch:true};local.weaponClearance='rifle';local.fixedUpdate(1/120,intent);a.fixedInput(local,intent);accumulator-=1/120;}
    assert.ok(a.inspect().pending<=48);assert.ok(a.inspect().inFlight<=48);maxTravel=Math.max(maxTravel,Math.hypot(local.position.x-initial.x,local.position.z-initial.z));await delay(dt*1000);
   }
   await until(()=>a.inspect().pending===0,'all admitted ticks acknowledged');assert.ok(maxTravel>.1,'local movement remains responsive');
   const authoritative=a.latest.players.find(p=>p.id===a.selfId);assert.ok(Math.hypot(local.position.x-authoritative.motion.position.x,local.position.z-authoritative.motion.position.z)<.02,'shared collision/prediction converges');
   assert.equal(a.state,'connected');assert.equal(b.state,'connected');assert.equal(authoritative.health,100);assert.equal(authoritative.life,1);
   reports.push({fps,maxTravel,diagnostics:a.inspect()});
  }
  assert.equal(reversed,0);assert.equal(a.inspect().opens,1);assert.equal(a.latest.players.length,2);
  await until(()=>b.latest.players.some(p=>p.id===a.selfId&&p.ack===a.latest.players.find(q=>q.id===a.selfId).ack),'observer receives final movement');
  console.log(JSON.stringify(reports.map(r=>({fps:r.fps,maxTravel:r.maxTravel,corrections:r.diagnostics.corrections,timing:r.diagnostics.timing}))));
 }finally{for(const c of clients)c.disconnect();for(const timer of timers)clearTimeout(timer);await vite.close();Object.assign(globalThis,original);}
});
