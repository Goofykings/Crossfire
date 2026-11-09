/** Two actual browser clients + real Worker. Delay real packets in TCP order;
 * compare current presentation with the previous fixed-buffer algorithm on the same stream. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {setTimeout as delay} from 'node:timers/promises';
import {harness,until,origin} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:5180/',out='test-results/network-jitter';fs.mkdirSync(out,{recursive:true});
const cleanup=[],h=await harness({after:fn=>cleanup.push(fn)},{ALLOWED_ORIGINS:origin+','+new URL(base).origin,MATCH_MODE:'ffa'}),room=h.room('public-main');
let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
const errors=[],checks=[];const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};let browser;
try{
 browser=await puppeteer.launch({executablePath,headless:true,pipe:true,timeout:120000,protocolTimeout:180000,defaultViewport:{width:1000,height:700},args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const pages=[];
 for(const name of ['Latency Alpha','Latency Bravo']){
  const context=await browser.createBrowserContext(),page=await context.newPage();pages.push(page);
  page.on('pageerror',error=>errors.push(String(error)));
  await page.evaluateOnNewDocument(backend=>{
   localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true}));
   const real=window.fetch;window.fetch=(input,init)=>{const path=new URL(String(input),location.href).pathname;return real(/^\/(profile|presence|stats|cosmetics|rooms|leaderboard|health)(\/|$)/.test(path)?new URL(path,backend):input,init);};
   window.__jitter=false;window.__wire=[];window.__shots=[];window.__inputs=[];
   const Native=window.WebSocket;
   window.WebSocket=class extends Native{
    constructor(url,protocols){
     const game=new URL(String(url),location.href).pathname==='/ws';super(game?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);
     this.game=game;this.incoming=0;this.outgoing=0;this.released=0;this.sent=0;
     if(game)this.addEventListener('message',event=>{
      const message=JSON.parse(event.data);if(message.type==='error')window.__wire.push(message);
      if(message.type==='shot'){window.__shots.push(message);if(window.__shots.length>20)window.__shots.shift();}
      if(!window.__jitter&&!this.released)return;
      event.stopImmediatePropagation();
      const pattern=[55,65,115,55,80,55,175,60],latency=window.__jitter?pattern[this.incoming++%pattern.length]:0;
      const at=Math.max(Date.now()+latency,this.released+1);this.released=at;
      setTimeout(()=>{if(this.readyState===Native.OPEN)this.onmessage?.(event);},at-Date.now());
     });
    }
    send(raw){
     if(this.game){const m=JSON.parse(raw);if(m.type==='input'){window.__inputs.push(m);if(window.__inputs.length>12)window.__inputs.shift();}}
     if(!this.game||!window.__jitter)return super.send(raw);
     const at=Math.max(Date.now()+[35,45,65,35][this.outgoing++%4],this.sent+1);this.sent=at;
     setTimeout(()=>{if(this.readyState===Native.OPEN)super.send(raw);},at-Date.now());
    }
   };
  },h.base);
  await page.goto(base+'?autoplay',{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,name);
  await page.waitForFunction(()=>window.__crossfire?.ready(),{timeout:180000});page.id=await page.evaluate(()=>window.__crossfire.network().selfId);
  console.log(name+' connected');
 }
 const [a,b]=pages,arena=await room.directionalArenaForTest();
 await room.placeManyForCombatTest([{id:a.id,pos:arena.sources.front},{id:b.id,pos:arena.center}]);
 await a.evaluate(p=>window.__crossfire.aimAt(p[0],p[1]+1,p[2]),arena.center);
 await a.evaluate(()=>{window.__jitter=true;});await b.evaluate(()=>{window.__jitter=true;});
 await a.evaluate(id=>{
  const samples=[],stream=[];window.__motionSamples=samples;let stopped=false,lastStamp=0;
  window.__stopMotion=()=>{stopped=true;};
  function frame(){
   if(stopped)return;
   const net=window.__crossfire.network(),p=net.snapshot?.players.find(p=>p.id===id),at=performance.now(),current=window.__crossfire.remoteMotion().find(p=>p.id===id);
   if(p&&net.snapshot.serverTime!==lastStamp){lastStamp=net.snapshot.serverTime;stream.push({at:lastStamp,m:p.motion});if(stream.length>60)stream.shift();}
   const time=Date.now()+net.diagnostics.timing.clockOffset-100;
   let old=stream[0],next=stream[1]??old;
   for(let i=1;i<stream.length;i++){old=stream[i-1];next=stream[i];if(next.at>=time)break;}
   if(current&&old&&next){const k=Math.max(0,Math.min(1,(time-old.at)/Math.max(1,next.at-old.at)));
    samples.push({at,x:current.x,z:current.z,baselineX:old.m.position.x+(next.m.position.x-old.m.position.x)*k,baselineZ:old.m.position.z+(next.m.position.z-old.m.position.z)*k,
     speed:Math.hypot(p.motion.velocity.x,p.motion.velocity.z),extrapolating:current.extrapolating});}
   requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
 },b.id);
 for(let i=0;i<24;i++){
  await b.evaluate(i=>{window.__crossfire.hold('right',i%2===0);window.__crossfire.hold('left',i%2!==0);},i);await delay(250);
 }
 await b.evaluate(()=>{window.__crossfire.hold('right',false);window.__crossfire.hold('left',false);});
 await delay(400);await a.evaluate(()=>window.__stopMotion());
 const samples=await a.evaluate(()=>window.__motionSamples),moving=samples.slice(1).filter((s,i)=>s.speed>1&&samples[i].speed>1&&s.at-samples[i].at<80);
 let freezes=0,baselineFreezes=0;
 for(let i=1;i<samples.length;i++){const p=samples[i-1],s=samples[i];if(s.speed<=1||p.speed<=1||s.at-p.at>=80)continue;
  if(Math.hypot(s.x-p.x,s.z-p.z)<.0001)freezes++;
  if(Math.hypot(s.baselineX-p.baselineX,s.baselineZ-p.baselineZ)<.0001)baselineFreezes++;
 }
 check(moving.length>40,'enough moving frames sampled under ordered Wi-Fi jitter');
 check(freezes<baselineFreezes,'fewer frozen frames than the previous renderer on the identical delayed stream');
 for(const page of pages)check(await page.evaluate(()=>window.__crossfire.network().state==='connected'&&window.__wire.length===0),'connection survives burst delivery without protocol errors');
 // Aim at a real rendered moving body, with all damage still resolved by the Worker.
 await a.evaluate(()=>window.__crossfire.hold('aim',true));await delay(400);
 await b.evaluate(()=>window.__crossfire.hold('right',true));await delay(250);
 const previousHits=await a.evaluate(()=>window.__crossfire.stats().hits);
 await a.evaluate(id=>{const p=window.__crossfire.remoteMotion().find(p=>p.id===id);window.__crossfire.aimAt(p.x,p.y+1,p.z);window.__crossfire.hold('fire',true);},b.id);
 await delay(100);await a.evaluate(()=>window.__crossfire.hold('fire',false));await b.evaluate(()=>window.__crossfire.hold('right',false));
 await until(async()=>await a.evaluate(n=>window.__crossfire.stats().hits>n,previousHits),'shot at rendered moving body confirmed',6000);
 check(true,'shot aimed at a displayed moving player confirms through delayed transport');
 await a.screenshot({path:out+'/jitter.png'});
 const diagnostics=await a.evaluate(()=>window.__crossfire.network().diagnostics);
 check(errors.length===0,'no browser runtime errors');
 fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,frames:moving.length,freezes,baselineFreezes,diagnostics,samples},null,2));
 console.log(JSON.stringify({frames:moving.length,freezes,baselineFreezes,timing:diagnostics.timing}));
}catch(error){
 const state=browser?await Promise.all((await browser.pages()).map(p=>p.evaluate(()=>window.__crossfire?{network:window.__crossfire.network(),motion:window.__crossfire.motion(),camera:window.__crossfire.leanView(),weapon:window.__crossfire.weapon(),shots:window.__shots,inputs:window.__inputs}:null).catch(()=>null))):[];
 fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors,state},null,2));throw error;
}
finally{await browser?.close();for(const dispose of cleanup.reverse())await dispose();}
