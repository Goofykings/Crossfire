/** Six real TCP/workerd peers. Link delays preserve reliable ordering; not UDP loss or WAN testing. */
import assert from 'node:assert/strict';import {test} from 'node:test';import {setTimeout as delay} from 'node:timers/promises';
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import {createServer} from 'vite';import WebSocket from 'ws';
import {harness,until,origin} from './room-harness.mjs';
const out=fileURLToPath(new URL('../../test-results/',import.meta.url));

test('six real peers survive all five requested network profiles, combat, reconnect and map changes',{timeout:180000},async t=>{
 const h=await harness(t),vite=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},appType:'custom'});
 const original={window:globalThis.window,WebSocket:globalThis.WebSocket,sessionStorage:globalThis.sessionStorage};
 const timers=new Set(),clients=[],peers=[],reports=[];let profile={rtt:0,jitter:0,stallStart:Infinity,stallEnd:Infinity};
 class Link extends WebSocket{
  constructor(url){super(url,{origin});this.inAt=0;this.outAt=0;this.packet=0;}
  schedule(direction,run){
   const now=performance.now(),variation=[-.8,.2,1,-.5,.4,-1,.8,0][this.packet++%8]*profile.jitter;
   let at=Math.max(this[direction]+.01,now+Math.max(0,profile.rtt/2+variation));
   if(now>=profile.stallStart&&now<profile.stallEnd)at=Math.max(at,profile.stallEnd+profile.rtt/2);
   this[direction]=at;const timer=setTimeout(()=>{timers.delete(timer);if(this.readyState===WebSocket.OPEN)run();},Math.max(0,at-now));timers.add(timer);
  }
  send(raw){this.schedule('outAt',()=>super.send(raw));}
  addEventListener(type,callback,options){
   if(type!=='message')return super.addEventListener(type,callback,options);
   return super.addEventListener(type,event=>this.schedule('inAt',()=>callback.call(this,event)),options);
  }
 }
 try{
  const {MultiplayerClient}=await vite.ssrLoadModule('/src/network/MultiplayerClient.ts'),{PlayerController,NO_INTENT}=await vite.ssrLoadModule('/src/player/PlayerController.ts'),{WORLDS}=await vite.ssrLoadModule('/server/src/world.ts'),{simulationSteps}=await vite.ssrLoadModule('/src/core/simulationBudget.ts');
  globalThis.window=globalThis;globalThis.WebSocket=Link;const storage=new Map();globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const url=new URL('/ws',h.base).href.replace('http:','ws:');
  for(let i=0;i<6;i++)clients.push(new MultiplayerClient(url,'Link audit '+i,{diagnostics:true,profileScope:()=> 'link-audit-'+i}));
  await Promise.all(clients.map(c=>c.connect()));await Promise.all(clients.map(c=>c.spawn('rifle')));
  for(const [i,client]of clients.entries()){
   const player=new PlayerController(WORLDS[client.latest.mapId].world);player.weaponClearance='rifle';player.restore(client.latest.players.find(p=>p.id===client.selfId).motion);
   const peer={client,player,fps:[60,30,20][i%3],pending:null,debt:0,last:performance.now(),next:0,previousJump:false,rotationErrors:0,maxPending:0,maxCorrection:0,lastCorrectionCount:0,frameCosts:[],snapshotAges:[]};
   client.onSnapshot=s=>peer.pending=s;peers.push(peer);
  }
  function frame(peer,now,moving){
   if(now<peer.next)return;peer.next=now+1000/peer.fps;
   const started=performance.now(),{player,client}=peer;
   if(peer.pending){const yaw=player.yaw,pitch=player.pitch;client.reconcile(player,peer.pending);client.appliedSnapshot(peer.pending);peer.pending=null;if(player.yaw!==yaw||player.pitch!==pitch)peer.rotationErrors++;}
   peer.debt+=(now-peer.last)/1000;peer.last=now;if(moving)player.yaw=Math.atan2(Math.sin(player.yaw+.0005),Math.cos(player.yaw+.0005));player.pitch=.05;
   const jump=moving&&Math.floor(now/1200)%2===0;
   for(let n=simulationSteps(peer.debt);n>0&&client.canPredict;n--){
    const intent={...NO_INTENT,x:moving?(Math.floor(now/1000)%2?.5:-.5):0,jumpPressed:jump&&!peer.previousJump,slide:moving&&Math.floor(now/3500)%2===0};
    player.fixedUpdate(1/120,intent);client.fixedInput(player,intent);peer.debt-=1/120;peer.previousJump=jump;
   }
   const d=client.inspect();peer.maxPending=Math.max(peer.maxPending,d.pending);
   if(d.corrections.count!==peer.lastCorrectionCount){peer.maxCorrection=Math.max(peer.maxCorrection,d.corrections.last);peer.lastCorrectionCount=d.corrections.count;}
   assert.ok(d.pending<=48&&d.inFlight<=48);assert.equal(client.state,'connected');
   peer.frameCosts.push(performance.now()-started);if(peer.frameCosts.length>1024)peer.frameCosts.shift();
   if(d.snapshotAge!==null){peer.snapshotAges.push(d.snapshotAge);if(peer.snapshotAges.length>1024)peer.snapshotAges.shift();}
  }
  const startedAt=performance.now();
  for(const [rtt,jitter]of [[20,5],[60,15],[120,30],[200,60],[350,100]]){
   const start=performance.now(),before=clients.map(c=>c.diagnosticReport());
   for(const p of peers){p.maxPending=0;p.maxCorrection=0;p.lastCorrectionCount=p.client.inspect().corrections.count;p.frameCosts=[];p.snapshotAges=[];}
   profile={rtt,jitter,stallStart:rtt===350?start+4500:Infinity,stallEnd:rtt===350?start+5300:Infinity};
   while(performance.now()-start<12000){const now=performance.now();for(const p of peers)frame(p,now,true);await delay(2);}
   await until(()=>{const now=performance.now();for(const p of peers)frame(p,now,false);return clients.every(c=>c.inspect().pending===0&&Math.hypot(...Object.values(c.latest.players.find(p=>p.id===c.selfId).motion.velocity))<.001);},'neutral inputs acknowledged and motion settled');
   const seconds=(performance.now()-start)/1000;
   reports.push({rtt,jitter,seconds,peers:peers.map((p,i)=>{
    const state=p.client.latest.players.find(q=>q.id===p.client.selfId),d=p.client.diagnosticReport(),prev=before[i].telemetry.counters;
    assert.equal(state.health,100);assert.equal(state.life,1);assert.equal(state.score,0);assert.equal(p.client.latest.players.length,6);assert.equal(p.rotationErrors,0);
    if(p.pending){p.client.reconcile(p.player,p.pending);p.pending=null;}
    assert.ok(Math.hypot(p.player.position.x-state.motion.position.x,p.player.position.y-state.motion.position.y,p.player.position.z-state.motion.position.z)<.02,'prediction converges');
    const counters=d.telemetry.counters,sorted=[...p.frameCosts].sort((a,b)=>a-b),ages=[...p.snapshotAges].sort((a,b)=>a-b);
    return {fps:p.fps,maxPending:p.maxPending,maxCorrection:p.maxCorrection,correctionCount:d.corrections.nonzero-before[i].corrections.nonzero,rotationErrors:p.rotationErrors,frameCpuP95Ms:sorted[Math.floor(sorted.length*.95)],snapshotAgeP95Ms:ages[Math.floor(ages.length*.95)],
     receivedBytesPerSecond:((counters.incomingBytes??0)-(prev.incomingBytes??0))/seconds,sentBytesPerSecond:((counters.outgoingBytes??0)-(prev.outgoingBytes??0))/seconds,diagnostics:d};
   })});
   console.log('PASS real link',rtt,jitter);
  }
  assert.ok(performance.now()-startedAt>=60000);for(const c of clients)assert.equal(c.inspect().opens,1);
  const a=clients[0],b=clients[1],shooter=peers[0],arena=await h.central.directionalArenaForTest();
  await h.central.placeManyForCombatTest([{id:a.selfId,pos:arena.sources.front},{id:b.selfId,pos:arena.center}]);
  await until(()=>Math.abs(a.latest.players.find(p=>p.id===a.selfId).motion.position.x-arena.sources.front[0])<.01&&Math.abs(b.latest.players.find(p=>p.id===b.selfId).motion.position.z-arena.center[2])<.01,'real firing positions received');
  shooter.player.restore(a.latest.players.find(p=>p.id===a.selfId).motion);const shots=[],eliminations=[];
  a.onShot=s=>shots.push(s);a.onElimination=e=>eliminations.push(e);let combatDebt=0,lastCombatAt=performance.now();
  await until(()=>{
   const now=performance.now();combatDebt+=(now-lastCombatAt)/1000;lastCombatAt=now;
   if(shooter.pending){a.reconcile(shooter.player,shooter.pending);shooter.pending=null;}
   const p=shooter.player,target=b.latest.players.find(q=>q.id===b.selfId),own=a.latest.players.find(q=>q.id===a.selfId);
   const dx=target.motion.position.x-p.position.x,dz=target.motion.position.z-p.position.z;
   p.yaw=Math.atan2(-dx,-dz);p.pitch=Math.atan2(target.motion.position.y+1-p.position.y-1.64,Math.hypot(dx,dz));
   for(let n=simulationSteps(combatDebt);n>0&&a.canPredict;n--){const intent={...NO_INTENT,aim:true};p.fixedUpdate(1/120,intent);a.fixedInput(p,intent,{trigger:own.combat.gun.ads>.95,reload:false});combatDebt-=1/120;}
   return !target.alive&&own.kills===1&&own.score===100;
  },'authoritative rifle elimination and score through poor link');
  assert.ok(shots.some(s=>s.hits.some(hit=>hit.id===b.selfId&&hit.amount>0)),'confirmed actual damage');
  assert.equal(new Set(shots.map(s=>s.id)).size,shots.length,'no duplicate shot callbacks');
  assert.equal(eliminations.filter(e=>e.victimId===b.selfId).length,1);assert.equal(eliminations.find(e=>e.victimId===b.selfId).award.total,100);
  let released=false;await until(()=>{if(!released&&a.canPredict){shooter.player.fixedUpdate(1/120,NO_INTENT);a.fixedInput(shooter.player,NO_INTENT);released=true;}return released&&a.inspect().pending===0;},'fire release acknowledged');
  await until(()=>Date.now()+b.clockOffset>=b.latest.players.find(p=>p.id===b.selfId).death.respawnAt,'authoritative respawn deadline');
  await b.spawn('shotgun');const newLife=b.latest.players.find(p=>p.id===b.selfId);assert.equal(newLife.life,2);assert.equal(newLife.health,100);assert.equal(newLife.weapon,'shotgun');
  const saved=structuredClone(a.latest.players.find(p=>p.id===a.selfId)),id=a.selfId;
  a.reconnect();await until(()=>a.state==='connected'&&a.inspect().opens===2,'real authenticated reconnect');
  const resumed=a.latest.players.find(p=>p.id===id);for(const k of ['id','life','health','weapon','score','kills','deaths'])assert.equal(resumed[k],saved[k]);
  await until(()=>b.latest.players.filter(p=>p.id===id).length===1,'no duplicate resumed player');assert.equal(a.inspect().pending,0);
  let chats=0;b.onChat=m=>{if(m.text==='Ordered link audit')chats++;};assert.ok(a.sendChat('Ordered link audit'));await until(()=>chats===1,'reliable chat after reconnect');
  for(let i=0;i<2;i++){const next=await h.central.advanceMapForTest();await until(()=>clients.every(c=>c.latest.roundId===next.roundId),'all six receive round/map barrier');for(const c of clients){assert.equal(c.inspect().pending,0);assert.equal(c.latest.players.find(p=>p.id===c.selfId).alive,false);}}
  await a.leaveRoom();const opens=a.inspect().opens;assert.equal(a.state,'closed');assert.equal(a.inspect().opens,opens);
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/poor-network-real-peers.json',JSON.stringify({seconds:(performance.now()-startedAt)/1000,reports,checks:['six peers >60 seconds','five latency/jitter profiles','20/30/60 FPS','800ms ordered stall','jump and slide','camera unchanged by reconciliation','authoritative convergence','real damage/elimination and 100-point award','no duplicate shot/elimination callbacks','authoritative respawn','identity/state resume','exactly one resumed identity','ordered chat','two map transitions','intentional Leave']},null,2));
 }catch(error){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/poor-network-real-failure.json',JSON.stringify({error:String(error),reports,peers:clients.map(c=>c.diagnosticReport())},null,2));throw error;}
 finally{for(const c of clients)c.disconnect();for(const timer of timers)clearTimeout(timer);await vite.close();Object.assign(globalThis,original);}
});
