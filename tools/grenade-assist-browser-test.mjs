/** Actual local Worker/Chrome gameplay. No synthesized damage, explosions or hit replies.
 * node tools/grenade-assist-browser-test.mjs http://127.0.0.1:4201/ [--chromebook]
 * Also runs against tools/serve-dist.mjs at /crossfire/. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {harness,origin,until,self,frames,ack} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4201/',chromebook=process.argv.includes('--chromebook'),reducedMotion=process.argv.includes('--reduced-motion');
const out='test-results/grenade-assist-browser'+(chromebook?'-chromebook':'')+(reducedMotion?'-reduced-motion':'')+(new URL(base).pathname==='/'?'-dev':'');fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],metrics={};const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
let cleanup=()=>{},browser,page;const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin,AFK_WARN_MS:'300000',AFK_KICK_MS:'600000'});
const visible=s=>page.waitForSelector(s+'.visible',{timeout:180000});
const click=(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(n=>n.textContent.trim().toUpperCase()===text.toUpperCase());if(!b)throw Error('Missing '+text);b.click();},{root,text});
const net=()=>page.evaluate(()=>window.__crossfire.network());
const fx=()=>page.evaluate(()=>window.__crossfire.grenades());
const shot=name=>page.screenshot({path:out+'/'+name+'.png'});
async function place(room,id,p,heading=0){await room.placeForCombatTest(id,p,heading);if(id===(await net()).selfId)await page.waitForFunction(p=>{const m=window.__crossfire.player();return m&&Math.hypot(m.x-p[0],m.z-p[2])<.25;},{timeout:15000},p);}
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const context=await browser.createBrowserContext();page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 if(reducedMotion)await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.evaluateOnNewDocument((server,chromebook)=>{
  if(chromebook)localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true}));
  window.__grenadeEvents=[];let arm=false,started=null,paused=false;const waiting=[],raf=requestAnimationFrame.bind(window);
  window.__capture={arm:()=>{arm=true;started=null;},resume:()=>{arm=paused=false;started=null;for(const f of waiting.splice(0))raf(f);},paused:()=>paused};
  window.requestAnimationFrame=f=>raf(t=>{if(paused){waiting.push(f);return;}f(t);if(arm&&started!==null&&t-started>=65)paused=true;});
  const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){const u=new URL(url,location.href);super(u.pathname.startsWith('/ws')?new URL(u.pathname,server).href.replace('http:','ws:'):url,protocols);this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='grenade'){window.__grenadeEvents.push({event:m.event,received:Date.now()});if(m.event.kind==='explode'&&arm)started=performance.now();}}catch{}});}};
  const real=window.fetch;window.fetch=(input,init)=>{const u=new URL(String(input),location.href);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip','/cosmetics/open'].includes(u.pathname)?new URL(u.pathname+u.search,server):input,init);};
 },h.base,chromebook);
 await page.goto(base+'?quality=medium&shadows=off&scale=.5',{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Grenade QA');
 check(await page.evaluate(()=>window.__crossfire.settings().aimAssist===false),'mouse aim assist defaults Off');
 await click('.home-nav','Settings');await visible('#settings');await page.click('#set-aimAssist');await click('.settings-foot','Apply');await click('.settings-foot','Back');await visible('#menu');check(await page.evaluate(()=>window.__crossfire.settings().aimAssist===true&&JSON.parse(localStorage.getItem('crossfire.settings.v1')).aimAssist===true),'explicit aim-assist setting applies and persists');
 await page.click('#menu .home-actions .primary');await visible('#modes');await click('#modes','Create Server');await visible('#create-room');await click('#create-room','CREATE');await visible('#weapons');await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});
 const n=await net(),room=h.room(n.snapshot.room),token=await h.profile(),peer=await h.open(await h.admission(token,{roomId:n.snapshot.room}),token);await h.spawn(peer);
 const arena=await room.directionalArenaForTest();await place(room,n.selfId,arena.sources.front);await place(room,peer.id,arena.center);
 await page.evaluate(p=>window.__crossfire.aimAt(p[0],p[1]+1.224,p[2]),arena.center);await page.waitForFunction(id=>window.__crossfire.network().rendered.some(p=>p.id===id&&p.labelVisible&&p.source==='glb'),{timeout:120000},peer.id);
 const aiming=await page.evaluate(()=>window.__crossfire.motion());await page.evaluate(({yaw,pitch})=>window.__crossfire.look(-(yaw-1.5*Math.PI/180)*180/Math.PI,pitch*180/Math.PI),aiming);
 const before=await page.evaluate(()=>window.__crossfire.motion());
 for(let k=0;k<5;k++)await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>{window.__crossfire.mouseInput(-.3,0);r();})));
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const after=await page.evaluate(()=>({motion:window.__crossfire.motion(),assist:window.__crossfire.aimAssist()}));
 check(after.assist.total>0&&after.assist.total<.25*Math.PI/180,'visible near-crosshair opponent receives a small manual correction');
 check(after.motion.yaw-before.yaw>5*.3*.0022,'voluntary mouse input remains dominant while assistance adds a small correction');
 const still=after.motion.yaw;await delay(180);check(Math.abs((await page.evaluate(()=>window.__crossfire.motion())).yaw-still)<.000001,'stationary mouse does not track the opponent');
 const wall=await room.wallArenaForTest();await place(room,n.selfId,wall.pair[0]);await place(room,peer.id,wall.pair[1]);await page.evaluate(p=>window.__crossfire.aimAt(p[0],p[1]+1.224,p[2]),wall.pair[1]);await delay(150);
 await page.evaluate(()=>window.__crossfire.mouseInput(-.3,0));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));check(await page.evaluate(()=>window.__crossfire.aimAssist().total===0),'wall-hidden opponent receives no correction');
 await place(room,n.selfId,arena.center);await place(room,peer.id,await room.smokeObservationForTest({x:arena.center[0],y:arena.center[1],z:arena.center[2]}));await page.evaluate(()=>window.__crossfire.look(0,-80));
 await page.evaluate(()=>{const ring=document.querySelector('.grenade-charge');window.__chargeVisible=null;new MutationObserver(()=>{if(ring.classList.contains('visible')&&!window.__chargeVisible)window.__chargeVisible={progress:Number(ring.style.getPropertyValue('--charge')),at:performance.now()};}).observe(ring,{attributes:true,attributeFilter:['class']});window.__chargeStart=performance.now();window.__crossfire.hold('grenade',true);});
 await page.waitForFunction(()=>window.__chargeVisible,{timeout:5000});check(await page.evaluate(()=>window.__chargeVisible.progress<.065),'charge ring appears before the old delayed threshold');
 await page.waitForFunction(()=>window.__crossfire.grenades().charge>=.999,{timeout:2500});metrics.fullChargeMs=await page.evaluate(()=>performance.now()-window.__chargeStart);check(metrics.fullChargeMs<1600,'full charge reaches maximum near 1.1 seconds');
 check(await page.$eval('.grenade-charge circle:not(.charge-track)',n=>Number.parseFloat(getComputedStyle(n).strokeWidth)===2.2),'compact charge ring has thicker high-contrast stroke');
 await page.evaluate(()=>{window.__releaseAt=Date.now();window.__crossfire.hold('grenade',false);});await page.waitForFunction(()=>window.__grenadeEvents.some(e=>e.event.kind==='throw'),{timeout:5000});
 const thrown=await page.evaluate(()=>window.__grenadeEvents.find(e=>e.event.kind==='throw'));metrics.releaseToThrowMs=thrown.event.projectile.at-await page.evaluate(()=>window.__releaseAt);check(metrics.releaseToThrowMs<200,'release immediately starts the authoritative projectile without an animation delay');
 const observer=await room.smokeObservationForTest(thrown.event.projectile.position);await place(room,n.selfId,observer);await page.evaluate(p=>window.__crossfire.aimAt(p.x,p.y+.5,p.z),thrown.event.projectile.position);
 await page.evaluate(()=>window.__capture.arm());await page.waitForFunction(()=>window.__capture.paused(),{timeout:5000,polling:10});const burst=await fx();metrics.burst=burst;
 check(burst.debris===(chromebook?12:54)&&burst.ground.rocks===(chromebook?5:36),'real explosion uses tripled dirt/rocks with bounded Chromebook counts');check(burst.particleBudget===256&&burst.ground.budget===144,'cosmetic particle pools remain bounded');await shot('explosion');await page.evaluate(()=>window.__capture.resume());
 check((await net()).snapshot.players.find(p=>p.id===n.selfId).health===100&&(await fx()).shake.strength===0,'own grenade causes no confirmed damage or camera shake');
 await page.waitForFunction(()=>window.__crossfire.grenades().clouds.length>0&&window.__crossfire.grenades().clouds[0].age>600,{timeout:4000});check((await fx()).clouds[0].opacity===.75,'smoke density is reduced by 25%');await shot('smoke');
 await page.waitForFunction(()=>window.__crossfire.grenades().clouds.length===0,{timeout:10000});check((await fx()).debris===0&&(await fx()).ground.rocks===0,'brief dirt/debris and smoke clean up');
 await place(room,peer.id,arena.center);await until(()=>self(peer).combat.gun.action==='idle','peer idle');frames(peer,{grenade:true,pitch:-1.4});await ack(peer);frames(peer,{pitch:-1.4});await ack(peer);
 const projectile=await until(()=>peer.snapshot.grenades[0],'peer throw');await until(()=>Date.now()-projectile.at>=1600,'peer fuse approaching');const g=(await room.snapshotForTest()).grenades[0],medium=await room.mediumBlastPositionForTest(g.position);
 await place(room,n.selfId,medium,Math.atan2(g.position.x-medium[0],medium[2]-g.position.z)*180/Math.PI);await page.evaluate(p=>window.__crossfire.aimAt(p.x,p.y+.4,p.z),g.position);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const orientation=await page.evaluate(()=>window.__crossfire.leanView().rotation);await page.evaluate(()=>window.__capture.arm());
 await page.waitForFunction(()=>window.__capture.paused(),{timeout:5000,polling:10});const damageFx=await fx(),damageNet=await net(),me=damageNet.snapshot.players.find(p=>p.id===n.selfId);check(me.health>0&&me.health<100&&damageFx.shake.strength>0,'another player grenade confirms damage and scales camera shake');
 if(reducedMotion){const q=await page.evaluate(()=>window.__crossfire.leanView().rotation);check(Math.abs(q.reduce((sum,v,i)=>sum+v*orientation[i],0))>1-1e-8,'prefers-reduced-motion suppresses camera rotation despite confirmed blast damage');}
 await shot('damaged');await page.evaluate(()=>window.__capture.resume());
 await page.waitForFunction(p=>{const m=window.__crossfire.motion();return Math.hypot(m.position.x-p[0],m.position.z-p[2])>.03;},{timeout:5000},medium);check(true,'client reconciliation follows authoritative blast knockback');
 await delay(800);const aim=await page.evaluate(()=>({m:window.__crossfire.motion(),v:window.__crossfire.leanView(),fx:window.__crossfire.grenades(),stats:window.__crossfire.stats()}));metrics.recovered=aim;check(aim.fx.shake.age>=.5,'camera impulse decays within half a second');
 check(errors.length===0,'no page exceptions or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,metrics},null,2));await h.leave(peer);await page.evaluate(()=>window.__crossfire.networkLeave());
}catch(error){await page?.evaluate(()=>window.__capture?.resume()).catch(()=>{});await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors,metrics,debug:await page?.evaluate(()=>({state:window.__crossfire?.state(),network:window.__crossfire?.network(),fx:window.__crossfire?.grenades(),aim:window.__crossfire?.aimAssist(),motion:window.__crossfire?.motion()})).catch(()=>null)},null,2));throw error;}
finally{await browser?.close();await cleanup();}
