/** One actual Chrome renderer + five real scripted TCP/WebSocket players on
 * production workerd. No public connection or fabricated multiplayer snapshots.
 * Run after npm --prefix server run build. Optional duration seconds (default 120). */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';import {execFileSync} from 'node:child_process';
import {build} from 'vite';import puppeteer from 'puppeteer-core';
import {harness,frames,self,origin,until} from '../server/tests/room-harness.mjs';
import {serveFrames} from './frame-time-server.mjs';import {completeGuestProfile} from './guest-profile-helper.mjs';
const cleanup=[],out='test-results/frame-time',seconds=Number(process.argv[2]??120);fs.mkdirSync(out,{recursive:true});
const audit=process.argv.includes('--audit'),label=audit?'audit-six':'online-six';
const report={seconds,samples:[],errors:[],limitations:['Local workerd, one rendered browser and five real scripted WebSocket clients','Desktop hardware; no WAN or physical Chromebook measurements']};
let browser,server,driver,driving=true;const respawns=new Set(),jobs=new Set();
try{
 const h=await harness({after:fn=>cleanup.push(fn)},{ALLOWED_ORIGINS:`${origin},http://127.0.0.1:4240`,AFK_KICK_MS:'600000'});
 let round=await h.central.snapshotForTest();while(round.mapId!=='industrial-complex')round=await h.central.advanceMapForTest();
 const arena=await h.central.directionalArenaForTest(),positions=[arena.center,...Object.values(arena.sources)];
 const peers=[];
 for(let i=0;i<5;i++){
  const c=await h.open({room:{id:'public-main'}},undefined,{name:'Frame peer '+i});assert.equal(c.welcome.type,'welcome');await h.spawn(c);
  await h.central.placeForCombatTest(c.id,positions[i],180);peers.push(c);
 }
 await build({logLevel:'warn',define:{'import.meta.env.VITE_MULTIPLAYER_PROVIDER':JSON.stringify('cloudflare'),'import.meta.env.VITE_MULTIPLAYER_URL':JSON.stringify(new URL('/ws',h.base).href.replace('http:','ws:'))},build:{outDir:'.cache/frame-online',copyPublicDir:false}});
 server=serveFrames('online',4240);if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',userDataDir:path.resolve('.cache/frame-online-profile'),headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1366,height:768},args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 const socketEvents=[];const wire=await page.createCDPSession();await wire.send('Network.enable');
 wire.on('Network.webSocketCreated',e=>socketEvents.push({type:'open',id:e.requestId,at:Date.now()}));
 wire.on('Network.webSocketClosed',e=>socketEvents.push({type:'close',id:e.requestId,at:Date.now()}));
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname))void r.abort();else void r.continue();});
 await page.evaluateOnNewDocument(()=>localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true,adaptiveResolution:false,masterVolume:0})));
 const enter=async()=>{
  await page.click('#menu .home-actions .primary');await page.waitForSelector('#modes.visible');
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#modes button')].find(n=>n.textContent.trim()==='Public Servers');if(!b)throw Error('Public Servers missing');b.click();});
  await page.waitForSelector('#modes .room-row',{timeout:60000});await page.click('#modes .room-row');
  await page.waitForSelector('#weapons.visible',{timeout:240000});
  assert.equal(await page.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).alive;}),false,'selection precedes spawn');
  await page.click('#weapons [data-weapon="rifle"]');
 };
 await page.goto('http://127.0.0.1:4240/?'+(audit?'':'autoplay&')+'perf=1&netDiagnostics=1',{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Online frame test');
 if(audit)await enter();
 await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady&&window.__crossfire.network().rendered.length===5,{timeout:240000});
 const id=await page.evaluate(()=>window.__crossfire.network().selfId);await h.central.placeForCombatTest(id,arena.observer,0);
 if(audit){
  await page.evaluate(()=>window.__crossfire.resetPerformance());
  await page.waitForFunction(p=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return Math.hypot(s.motion.position.x-p[0],s.motion.position.z-p[2])<.02;},{timeout:30000},arena.observer);
  await page.evaluate(({target,from})=>{const dx=target[0]-from[0],dz=target[2]-from[2],g=window.__crossfire;g.look(-Math.atan2(-dx,-dz)*180/Math.PI,Math.atan2(target[1]+1.05-from[1]-1.64,Math.hypot(dx,dz))*180/Math.PI);g.hold('aim',true);},{target:arena.center,from:arena.observer});
  await delay(700);await page.evaluate(()=>window.__crossfire.hold('fire',true));
  await page.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).kills>=1;},{timeout:15000});
  report.elimination=await page.evaluate(()=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);window.__crossfire.hold('fire',false);window.__crossfire.hold('aim',false);return{kills:s.kills,score:s.score,frames:window.__crossfire.performance().frames};});assert.ok(report.elimination.score>=100);
  // Guarantee the victim-side lifecycle too. Natural random combat need not
  // kill the browser during a short run. Use ordinary validated rifle input
  // from a real peer in the already collision-checked arena, never a kill RPC.
  const c=peers[0];await until(()=>self(c).death&&Date.now()>=self(c).death.respawnAt,'confirmed peer respawn eligibility');await h.spawn(c);
  await h.central.placeForCombatTest(c.id,arena.center,0);
  const previous=await page.evaluate(()=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return{life:s.life,deaths:s.deaths};});
  const dx=arena.observer[0]-arena.center[0],dz=arena.observer[2]-arena.center[2];
  const incoming=setInterval(()=>{const p=self(c);if(p?.alive&&c.seq-p.ack+6<=48)frames(c,{yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(.9-1.64,Math.hypot(dx,dz)),aim:true,trigger:true});},50);
  try{await page.waitForFunction(()=>window.__crossfire.state()==='spectating',{timeout:30000});}finally{clearInterval(incoming);}
  await page.waitForFunction(previous=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return !s.alive&&s.deaths===previous+1;},{timeout:10000},previous.deaths);
  report.death=await page.evaluate(()=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return{alive:s.alive,health:s.health,life:s.life,deaths:s.deaths,weapon:s.death.weapon,frames:window.__crossfire.performance().frames};});assert.equal(report.death.alive,false);assert.equal(report.death.weapon,'rifle');
  await page.waitForSelector('#spectate.visible .respawn-button:not(:disabled)',{timeout:30000});await page.click('#spectate.visible .respawn-button');
  // Current gameplay respawns the selected gun directly. Also support an actual
  // selection screen if that flow is presented; never require an obsolete one.
  await page.waitForFunction(()=>window.__crossfire.ready()||!!document.querySelector('#weapons.visible'),{timeout:60000});
  if(await page.$('#weapons.visible'))await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});
  report.respawn=await page.evaluate(()=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return{life:s.life,deaths:s.deaths,health:s.health,players:n.snapshot.players.length};});assert.equal(report.respawn.life,previous.life+1);assert.equal(report.respawn.deaths,previous.deaths+1);assert.equal(report.respawn.health,100);assert.equal(report.respawn.players,6);
 }
 console.log('Six real players connected');let elapsed=0;
 driver=setInterval(()=>{
  if(!driving)return;
  elapsed+=.05;
  for(const [i,c]of peers.entries())if(c.ws.readyState===1){
   // The general integration harness retains history for assertions. Keep this
   // multi-minute profiler bounded so test collection does not become a leak.
   if(c.messages.length>512)c.messages=c.messages.filter(m=>m.type!=='snapshot').slice(-256);
   const p=self(c);
   if(!p?.alive){
    if(p?.death&&Date.now()>=p.death.respawnAt&&!respawns.has(c.id)){
     respawns.add(c.id);const job=h.spawn(c).catch(e=>report.errors.push(String(e))).finally(()=>{respawns.delete(c.id);jobs.delete(job);});jobs.add(job);
    }continue;
   }
   if(c.seq-p.ack+6>48)continue;
   const dx=arena.observer[0]-p.motion.position.x,dz=arena.observer[2]-p.motion.position.z;
   frames(c,{x:Math.sin(elapsed*.7+i)>.1?1:-1,z:0,yaw:i===0?Math.atan2(-dx,-dz):Math.PI,pitch:i===0?Math.atan2(arena.observer[1]+.9-p.motion.position.y-1.64,Math.hypot(dx,dz)):0,trigger:true,reload:p.combat.gun.ammo===0});
  }
 },50);
 const cdp=await page.createCDPSession();await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 await page.evaluate(()=>{
  window.__crossfire.resetPerformance();
  const timing=window.__frameTiming={values:new Float32Array(18000),count:0,last:performance.now(),elapsed:0,over50:0,over100:0,over250:0,active:true};
  const frame=t=>{if(!timing.active)return;const ms=t-timing.last;timing.last=t;timing.values[timing.count++%timing.values.length]=ms;timing.elapsed+=ms;if(ms>50)timing.over50++;if(ms>100)timing.over100++;if(ms>250)timing.over250++;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });const started=Date.now();let reconnected=false;
 while(Date.now()-started<seconds*1000){
  await delay(5000);
  const sample=await page.evaluate(audit=>{const g=window.__crossfire,n=g.network();
   const respawn=document.querySelector('#spectate.visible .respawn-button:not(:disabled)');respawn?.click();
   document.querySelector('#weapons.visible [data-weapon="rifle"]')?.click();
   if(g.ready()){g.look((performance.now()*.008)%360,0);g.hold('fire',true);
    if(audit){const phase=Math.floor(performance.now()/5000)%4;g.hold('right',phase===0);g.hold('forward',phase===1);g.hold('aim',phase===2);g.hold('jump',phase===0);g.hold('slide',phase===1);}}
   const p=g.performance(),own=n.snapshot.players.find(p=>p.id===n.selfId);
   return {state:g.state(),frames:p.frames,gpuFrameMs:p.gpuFrameMs,renderCpuMs:p.renderCpuMs,resources:p.resources,shaders:p.shaders,stats:g.stats(),network:g.networkReport().network,
    health:own.health,life:own.life,damage:g.damageFeedback(),grading:g.silhouetteStats(),players:n.snapshot.players.length,rendered:n.rendered.length,heap:performance.memory?.usedJSHeapSize??null,
    positions:n.snapshot.players.map(p=>({id:p.id,x:p.motion.position.x,z:p.motion.position.z,ack:p.ack}))};
  },audit);
  report.samples.push({at:Date.now()-started,...sample});assert.equal(sample.players,6);
  console.log('Sample',Math.round((Date.now()-started)/1000),sample.state,sample.frames.p95,sample.stats.drawCalls);
  if(audit&&!reconnected&&Date.now()-started>seconds*500){
   driving=false;
   await page.evaluate(()=>{for(const action of ['fire','forward','right','aim','jump','slide'])window.__crossfire.hold(action,false);});
   await page.waitForFunction(()=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return n.diagnostics.pending===0&&!s.combat.triggerHeld;},{timeout:30000});
   const before=await page.evaluate(()=>{const g=window.__crossfire,n=g.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);g.hold('fire',false);g.hold('forward',false);g.hold('right',false);return{id:n.selfId,life:s.life,score:s.score,weapon:s.weapon,opens:n.diagnostics.opens};});
   await page.evaluate(()=>window.__crossfire.networkReconnect());
   await page.waitForFunction(opens=>{const n=window.__crossfire.network();return n.state==='connected'&&n.diagnostics.opens===opens+1;},{timeout:60000},before.opens);
   const after=await page.evaluate(()=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return{id:n.selfId,life:s.life,score:s.score,weapon:s.weapon,count:n.snapshot.players.length};});
   for(const key of ['id','life','score','weapon'])assert.equal(after[key],before[key],'resume '+key);assert.equal(after.count,6);
   report.reconnection={before,after};reconnected=true;driving=true;
  }
 }
 assert.ok(peers.every(c=>self(c).ack>100),'all five authoritative movement streams advanced');
 report.frames=await page.evaluate(()=>{
  const t=window.__frameTiming;t.active=false;const a=Array.from(t.values.subarray(0,Math.min(t.count,t.values.length))).sort((a,b)=>a-b),at=p=>a[Math.min(a.length-1,Math.floor(a.length*p))]??0,tail=a.slice(Math.floor(a.length*.99));
  return{count:t.count,elapsed:t.elapsed,fps:t.count*1000/t.elapsed,p50:at(.5),p95:at(.95),p99:at(.99),low1Fps:1000/(tail.reduce((n,v)=>n+v,0)/tail.length),over50:t.over50,over100:t.over100,over250:t.over250};
 });
 const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(`${out}/${label}.cpuprofile`,JSON.stringify(profile));
 if(audit){
  driving=false;clearInterval(driver);
  await page.screenshot({path:`${out}/audit-playing.png`});
  await page.evaluate(()=>{for(const action of ['fire','forward','right','aim','jump','slide'])window.__crossfire.hold(action,false);});
  await h.central.setRemainingForTest(1800);await page.waitForSelector('#results.visible',{timeout:60000});
  report.results=await page.$eval('#results',n=>({visible:n.classList.contains('visible'),rows:n.querySelectorAll('tbody tr').length}));assert.ok(report.results.rows>=6);
  await page.screenshot({path:`${out}/audit-results.png`});await page.evaluate(()=>window.__crossfire.networkLeave());await page.waitForSelector('#menu.visible');
  await delay(600);report.menu=await page.evaluate(()=>({state:window.__crossfire.state(),network:window.__crossfire.network().state,rendered:window.__crossfire.network().rendered.length,resources:window.__crossfire.performance().resources}));assert.equal(report.menu.rendered,0);
  for(const c of peers)await h.leave(c);
  let next=await h.central.snapshotForTest();while(next.mapId!=='farmstead')next=await h.central.advanceMapForTest();
  await enter();await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
  report.rejoin=await page.evaluate(()=>({map:window.__crossfire.mapInfo().id,players:window.__crossfire.network().snapshot.players.length,resources:window.__crossfire.performance().resources}));assert.equal(report.rejoin.map,'farmstead');assert.equal(report.rejoin.players,1);
  await page.evaluate(()=>window.__crossfire.networkLeave());await page.waitForSelector('#menu.visible');await delay(600);
  const active=new Set();let peak=0;for(const e of socketEvents){if(e.type==='open')active.add(e.id);else active.delete(e.id);peak=Math.max(peak,active.size);}
  report.socketLifecycle={created:socketEvents.filter(e=>e.type==='open').length,closed:socketEvents.filter(e=>e.type==='close').length,peak,remaining:active.size};assert.equal(peak,1);assert.equal(active.size,0);
 }
 assert.deepEqual(report.errors,[]);await page.screenshot({path:`${out}/${label}.png`});
 console.log('PASS six-player local online frame workload');
}catch(e){report.failure=String(e);throw e;}
finally{
 clearInterval(driver);
 await Promise.allSettled([...jobs]);
 if(browser){let timer;const closed=await Promise.race([browser.close().then(()=>true,()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),15000);})]);clearTimeout(timer);
  if(!closed){report.cleanupForced=true;const owned=browser.process();if(owned){try{execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{stdio:'ignore'});}catch{}for(const stream of owned.stdio)stream?.destroy();owned.unref();}browser.disconnect();}}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}for(const fn of cleanup)await fn();
 fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,2));
}
