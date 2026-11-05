/** Production Pages sub-path build, two real browser players and a real Worker victim. No injected combat results. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';
import {PROTOCOL_VERSION as v} from './protocol-version.mjs';
const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/',out='test-results/gameplay-polish';fs.mkdirSync(out,{recursive:true});
const errors=[],checks=[],reports={};const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const until=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const r=await fn();if(r)return r;await delay(20);}throw Error('Timeout: '+label);};
const fixture=new Miniflare(convertV4MiniflareOptions({name:'gameplay-polish-browser',modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},
 {type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
 resourcePersistencePath:fs.mkdtempSync('server/.wrangler/polish-browser-'),durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:new URL(base).origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)}));
let browser,ws,timer,room;
try{
 const backend=(await fixture.ready).href,ns=await fixture.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('public-main'));
 let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,
 defaultViewport:{width:1000,height:700},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 async function open(name,weapon){
  const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
  page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
  await page.evaluateOnNewDocument((server,weapon)=>{
   localStorage.setItem('crossfire.pending-weapon',weapon);window.__packets=[];window.__samples=[];
   const raf=requestAnimationFrame.bind(window),caf=cancelAnimationFrame.bind(window),pending=new Map();let next=0;
   window.requestAnimationFrame=cb=>{const id=++next,p={timer:0,frame:0};p.timer=setTimeout(()=>{p.frame=raf(time=>{pending.delete(id);cb(time);});},1000/30);pending.set(id,p);return id;};
   window.cancelAnimationFrame=id=>{const p=pending.get(id);if(p){clearTimeout(p.timer);caf(p.frame);pending.delete(id);}};
   const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL('/ws',server).href.replace('http:','ws:'),protocols);
    this.addEventListener('message',e=>{const m=JSON.parse(e.data);window.__packets.push(m);if(window.__packets.length>2000)window.__packets.shift();});}};
   const real=window.fetch;window.fetch=(input,init)=>{const url=new URL(String(input),location.href);return real(['/presence','/profile','/stats','/leaderboard'].includes(url.pathname)?new URL(url.pathname+url.search,server):input,init);};
   setInterval(()=>{const game=window.__crossfire;if(!game)return;const a=game.trails(),n=game.network();const flashes=n.rendered.filter(p=>p.weapon?.flash?.active);
    if(a.active||flashes.length||game.damageFeedback().arrow>.05)window.__samples.push({at:performance.now(),trails:a,flashes:flashes.map(p=>({id:p.id,position:p.weapon.flash.position,muzzle:p.weapon.muzzle})),damage:game.damageFeedback(),arrow:document.querySelector('.damage-arrow')?.style.transform});
    if(window.__samples.length>1000)window.__samples.shift();},10);
  },backend,weapon);
  await page.goto(base+'?autoplay&quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,name);
  await page.waitForFunction(()=>window.__crossfire.ready()||document.querySelector('#error.visible')||document.querySelector('#start.visible .btn.primary:not(:disabled)'),{timeout:240000});
  const error=await page.$eval('#error',e=>e.classList.contains('visible')?e.innerText:'');check(!error,name+' loads without asset errors');
  if(!await page.evaluate(()=>window.__crossfire.ready()))await page.click('#start .btn.primary');
  await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});page.id=await page.evaluate(()=>window.__crossfire.network().selfId);
  await page.keyboard.press('F3');await until(async()=> (await page.evaluate(()=>window.__crossfire.spatialAudio())).loaded===31,'decoded audio');return page;
 }
 const a=await open('Assist browser','rifle'),b=await open('Killer browser','sniper');
 check(a.id!==b.id,'two browser clients have unique authoritative IDs');
 const messages=[];let snapshot;ws=new WebSocket(new URL('/ws',backend).href.replace('http:','ws:'),{origin:new URL(base).origin});
 ws.on('message',raw=>{const m=JSON.parse(String(raw));messages.push(m);if(m.snapshot)snapshot=m.snapshot;});ws.on('error',()=>{});
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});const send=m=>ws.send(JSON.stringify({v,...m}));send({type:'join',name:'Real victim'});
 const welcome=await until(()=>messages.find(m=>m.type==='welcome'),'victim join'),victim=welcome.selfId;
 timer=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)send({type:'ping',at:Date.now()});},500);
 send({type:'spawn',requestId:crypto.randomUUID(),weapon:'smg',roundId:snapshot.roundId,mapVersion:snapshot.mapVersion});await until(()=>messages.find(m=>m.type==='spawned'),'victim spawn');
 const arena=await room.directionalArenaForTest();for(const[id,p]of [[a.id,arena.sources.front],[b.id,arena.sources.left],[victim,arena.center]])await room.placeForCombatTest(id,p);
 await until(async()=>{const n=await a.evaluate(()=>window.__crossfire.network());return n.rendered.length>=2;},'actual remote avatars');
 await until(async()=>await a.evaluate(p=>{const c=window.__crossfire.leanView().camera;return Math.hypot(c[0]-p[0],c[2]-p[2])<.05;},arena.sources.front),'A authoritative camera position');
 await until(async()=>await b.evaluate(p=>{const c=window.__crossfire.leanView().camera;return Math.hypot(c[0]-p[0],c[2]-p[2])<.05;},arena.sources.left),'B authoritative camera position');
 await a.evaluate(p=>{window.__crossfire.aimAt(p[0],p[1]+.9,p[2]);window.__crossfire.hold('aim',true);},arena.center);
 await b.evaluate(p=>{window.__crossfire.aimAt(p[0],p[1]+1.65,p[2]);window.__crossfire.hold('aim',true);},arena.center);
 await until(async()=>{const n=await a.evaluate(()=>window.__crossfire.network());return n.snapshot.players.find(p=>p.id===n.selfId).combat.gun.ads>.98;},'ADS');
 const before=await b.evaluate(()=>window.__crossfire.spatialAudio().started),mark=messages.length;
 await a.evaluate(()=>window.__crossfire.hold('fire',true));await until(()=>messages.slice(mark).some(m=>m.type==='shot'&&m.shot.shooterId===a.id),'actual rifle shot');await a.evaluate(()=>window.__crossfire.hold('fire',false));

 await until(async()=>await b.evaluate(()=>window.__crossfire.spatialAudio().started)>before,'remote rifle audio');
 await until(async()=>await b.evaluate(()=>window.__samples.some(s=>s.trails.active&&s.flashes.length)),'pooled trails and interpolated flash');
 check(true,'remote rifle audio, trail and muzzle flash observed from authoritative shot');
 const flash=await b.evaluate(()=>window.__samples.find(s=>s.flashes.length).flashes[0]);
 check(Math.hypot(...flash.position.map((n,i)=>n-flash.muzzle[i]))<.01,'flash follows actual model muzzle');
 const scoreMark=messages.length;await b.evaluate(()=>window.__crossfire.hold('fire',true));await until(()=>messages.slice(scoreMark).some(m=>m.type==='elimination'&&m.elimination.victimId===victim),'confirmed sniper kill');await b.evaluate(()=>window.__crossfire.hold('fire',false));
 await until(async()=>await a.evaluate(()=>document.body.innerText.includes('+50 ASSIST')),'assist HUD notice');
 const own=await a.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId);});check(own.assists===1&&own.kills===0&&own.score===50,'real assist count, score and HUD notice');
 await a.keyboard.down('Tab');await until(async()=>await a.evaluate(()=>window.__crossfire.scoreboard().text.includes('ASSISTS')),'assists column');await a.screenshot({path:out+'/assists.png'});await a.keyboard.up('Tab');
 await until(async()=>await b.evaluate(()=>window.__crossfire.trails().active===0),'trail expiry');
 check(true,'trails expire and leaderboard distinguishes assists from kills');
 // Genuine grenade physics: world-space bounce/explosion cues are received once.
 await b.evaluate(()=>{window.__crossfire.look(180,-20);window.__crossfire.hold('grenade',true);});await delay(300);await b.evaluate(()=>window.__crossfire.hold('grenade',false));
 await until(async()=>await a.evaluate(()=>window.__crossfire.spatialSounds().some(s=>s.name==='grenade_explosion')),'spatial explosion');
 check(await a.evaluate(()=>window.__crossfire.spatialSounds().some(s=>s.name==='shell_drop')),'authoritative bounce audio');
 reports.audio=await a.evaluate(()=>window.__crossfire.spatialAudio());
 const bAlive=await b.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).alive;});
 if(!bAlive){await b.waitForFunction(()=>!document.querySelector('.respawn-button').disabled,{timeout:15000});await b.click('.respawn-button');await b.waitForFunction(()=>window.__crossfire.ready());}
 // Four genuine directional damage events; capture the arrow before its normal fade.
 const victimSelf=()=>snapshot.players.find(p=>p.id===victim);
 await until(()=>Date.now()>=victimSelf().death.respawnAt,'victim respawn eligibility');
 send({type:'spawn',requestId:crypto.randomUUID(),weapon:'smg',roundId:snapshot.roundId,mapVersion:snapshot.mapVersion});await until(()=>victimSelf().alive,'victim respawn');
 await room.placeForCombatTest(a.id,arena.center);await room.placeForCombatTest(b.id,arena.observer);await a.evaluate(()=>window.__crossfire.look(0,0));
 let seq=victimSelf().ack;
 for(const side of ['front','behind','left','right']){
  const p=arena.sources[side],q=arena.center;await room.placeForCombatTest(victim,p);
  const batch=trigger=>send({type:'input',roundId:snapshot.roundId,mapVersion:snapshot.mapVersion,frames:Array.from({length:6},(_,k)=>({seq:++seq,yaw:Math.atan2(-(q[0]-p[0]),-(q[2]-p[2])),pitch:Math.atan2(q[1]+.9-p[1]-1.64,Math.hypot(q[0]-p[0],q[2]-p[2])),intent:{x:0,z:0,slide:false,aim:true,jumpPressed:false},combat:{trigger:trigger&&k===0,reload:false}}))});
  for(let i=0;i<13;i++){batch(false);await delay(50);}
  await a.evaluate(()=>window.__samples=[]);const mark=messages.length;batch(true);
  await until(()=>messages.slice(mark).some(m=>m.type==='shot'&&m.shot.shooterId===victim&&m.shot.hits.some(h=>h.id===a.id)),'actual directional hit');
  await until(async()=>await a.evaluate(side=>window.__samples.some(s=>s.damage.direction===side&&s.damage.arrow>.05),side),'arrow '+side);
  check(true,'confirmed '+side+' damage arrow orientation');
  if(side==='right'){await a.evaluate(()=>window.__crossfire.look(90,0));await until(async()=>await a.evaluate(()=>window.__samples.some(s=>s.damage.direction==='front'&&s.damage.arrow>.01)),'arrow follows camera yaw');}
 }
 check(await a.$eval('.damage-arrow',e=>parseFloat(getComputedStyle(e).fontSize)>=180),'damage chevron is approximately three times larger');
 await until(async()=>await a.evaluate(()=>window.__crossfire.damageFeedback().arrow===0),'damage fade');

 // Same camera/rendering workload; this is desktop diagnostic timing, not a Chromebook FPS claim.
 await a.evaluate(()=>{window.__crossfire.hold('aim',false);window.__crossfire.setSetting({graphicsQuality:'medium',shadowQuality:'low',resolutionScale:.75,chromebookMode:false});});
 await until(async()=>await a.evaluate(()=>window.__crossfire.network().state==='connected'&&!document.querySelector('.toast.visible')?.textContent.includes('reconnecting')),'baseline connected and settled');
 await delay(1500);reports.before=await a.evaluate(()=>({stats:window.__crossfire.stats(),live:window.__crossfire.live(),graphics:window.__crossfire.graphics()}));
 await a.evaluate(()=>window.__crossfire.pause());await a.click('#pause .btn:nth-of-type(2)');await a.waitForSelector('#settings.visible');await a.click('#tab-graphics');
 await a.click('#set-chromebookMode');check(await a.evaluate(()=>!window.__crossfire.settings().chromebookMode),'Chromebook changes remain a draft');
 check(await a.$eval('#set-graphicsQuality',e=>e.disabled||e.closest('.setting').inert),'overridden expensive controls are disabled');
 await a.evaluate(()=>[...document.querySelectorAll('.settings-foot .btn')].find(b=>b.textContent.trim()==='Apply').click());
 await until(async()=>{const g=await a.evaluate(()=>window.__crossfire.graphics());return g.chromebook&&g.materials.filter(m=>m.textureSize>256&&!m.name.includes('sign')&&!m.name.includes('atlas')).length<5;},'compact textures');
 await a.evaluate(()=>[...document.querySelectorAll('.settings-foot .btn')].find(b=>b.textContent.trim()==='Back').click());await a.click('#pause .btn.primary');
 await until(async()=>await a.evaluate(()=>window.__crossfire.network().state==='connected'&&!document.querySelector('.toast.visible')?.textContent.includes('reconnecting')),'Chromebook connected and settled');
 await delay(1500);reports.after=await a.evaluate(()=>({stats:window.__crossfire.stats(),live:window.__crossfire.live(),graphics:window.__crossfire.graphics()}));
 check(reports.after.graphics.viewLights.includes('chromebook-ambient'),'weapon receives low-cost ambient lighting within the light cap');
 check(reports.after.live.resolutionScale===.5&&reports.after.graphics.reflectionSize===0&&reports.after.graphics.preset.fxaa===false&&reports.after.graphics.materials.every(m=>!m.normal&&!m.orm&&!m.coat),'Chromebook reduces resolution, materials and antialiasing costs');
 check(await a.evaluate(()=>window.__crossfire.network().rendered.some(p=>p.visible)),'essential remote players remain visible in low-cost mode');await a.screenshot({path:out+'/chromebook.png'});
 await a.evaluate(()=>window.__crossfire.setSetting({chromebookMode:false}));check((await a.evaluate(()=>window.__crossfire.live())).resolutionScale===.75,'disabling restores selected resolution');
 check((await a.evaluate(()=>window.__crossfire.settings())).graphicsQuality==='medium','original graphics preference preserved');
 await a.evaluate(()=>window.__crossfire.networkLeave());await a.waitForSelector('#menu.visible');
 const color=await a.$eval('#menu .btn.primary',e=>getComputedStyle(e).backgroundColor);reports.playColor=color;check(color.includes('76, 120, 174'),'Play is translucent muted blue');
 await a.hover('#menu .btn.primary');await delay(200);reports.playHover=await a.$eval('#menu .btn.primary',e=>getComputedStyle(e).backgroundColor);await a.screenshot({path:out+'/home.png'});
 await a.click('#menu .btn.primary');await a.waitForFunction(()=>window.__crossfire.state()==='start'||window.__crossfire.ready(),{timeout:60000});check(true,'Play keeps real join flow without a Phase 2 dead end');
 check(errors.length===0,'no browser runtime or asset errors');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,reports},null,2));
}finally{if(browser&&process.env.CROSSFIRE_BROWSER_DEBUG)for(const p of await browser.pages()){try{if(await p.evaluate(()=>!!window.__crossfire))console.log('FINAL DIAGNOSTIC '+JSON.stringify(await p.evaluate(()=>({state:window.__crossfire.state(),audio:window.__crossfire.spatialAudio(),trails:window.__crossfire.trails(),samples:window.__samples?.slice(-4),network:window.__crossfire.network().diagnostics}))));}catch{}}clearInterval(timer);ws?.terminate();room?.[Symbol.dispose]?.();await browser?.close();await fixture.dispose();fs.writeFileSync(out+'/checks.json',JSON.stringify({checks,errors},null,2));}
