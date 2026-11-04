/** Two actual Chrome contexts, production Pages build, local authoritative Worker. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/',out='test-results/powerups-browser';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],shots=[];const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('PASS',label);};
const until=async(fn,label,timeout=15000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await delay(60);}throw Error(label);};
const mf=new Miniflare(convertV4MiniflareOptions({name:'powerups-browser',modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},{type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],
  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,resourcePersistencePath:fs.mkdtempSync('server/.wrangler/powerups-browser-'),durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:new URL(base).origin,MATCH_MODE:'powerups'},log:new Log(LogLevel.ERROR)}));
let browser,room,a,b;
const net=p=>p.evaluate(()=>window.__crossfire.network());
const me=async p=>{const n=await net(p);return n.snapshot.players.find(s=>s.id===n.selfId);};
const hold=(p,action,value)=>p.evaluate((action,value)=>window.__crossfire.hold(action,value),action,value);
async function capture(p,name){await p.screenshot({path:`${out}/${name}.png`});shots.push(name);}
try{
  const backend=(await mf.ready).href,ns=await mf.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('public-main'));
  let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();const arena=await room.powerupArenaForTest();
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  async function open(name){const context=await browser.createBrowserContext(),p=await context.newPage();p.on('dialog',d=>d.accept());p.on('pageerror',e=>errors.push(String(e)));
    p.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
    await p.evaluateOnNewDocument(backend=>{const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);}};
      const fetch=window.fetch;window.fetch=(input,init)=>fetch(['/presence','/profile'].includes(new URL(String(input),location.href).pathname)?new URL(new URL(String(input),location.href).pathname,backend):input,init);
    },backend);
    await p.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});
    await completeGuestProfile(p,name);await p.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});return p;}
  a=await open('Powerup Collector');b=await open('Powerup Observer');const started=Date.now();
  const aId=(await net(a)).selfId,bId=(await net(b)).selfId;
  check(aId!==bId,'two real authoritative player sessions');check((await net(a)).snapshot.match.mode==='powerups','Powerups is the synchronized mode');
  check(await a.$eval('.match-clock small',e=>e.textContent==='POWERUPS'),'HUD shows POWERUPS');
  async function place(p,pos,heading){const id=(await net(p)).selfId;await room.placeForCombatTest(id,pos,heading);await delay(180);if(heading!==undefined)await p.evaluate(h=>window.__crossfire.look(h,0),heading);}
  const heading=-arena.yaw*180/Math.PI;
  await place(a,arena.source,heading);await place(b,arena.parking);
  const cube=await room.pickupForTest('giant',arena.target);await until(()=>a.evaluate(()=>window.__crossfire.powerups().pickups>0),'visible cube');
  const t1=await a.evaluate(()=>window.__crossfire.powerups().cubes);await delay(280);const t2=await a.evaluate(()=>window.__crossfire.powerups().cubes);
  check(t1[0].rotation!==t2[0].rotation&&t1[0].position[1]!==t2[0].position[1],'cube rotates and bobs');await capture(a,'giant-cube');
  await place(a,arena.target,heading+180);await place(b,arena.source,heading);
  await until(async()=>(await me(a)).powerup?.type==='giant','collect Giant');
  await until(()=>b.evaluate(id=>window.__crossfire.network().rendered.find(p=>p.id===id)?.scale>=1.49,aId),'remote Giant');
  check(!(await net(b)).snapshot.pickups.some(p=>p.id===cube.id),'collected cube disappears for peer');
  check((await me(a)).health===150,'Giant maximum/current health');
  check(await a.evaluate(()=>Math.abs(window.__crossfire.motion().eyeHeight-2.46)<.01),'camera uses synchronized growing eye height');
  check(await a.$eval('.powerup-hud',e=>e.classList.contains('active')&&e.textContent.includes('GIANT')),'Giant duration HUD');
  await hold(b,'leaderboard',true);await delay(150);check(await b.$eval('.scoreboard',e=>e.textContent.includes('GIANT')),'compact ability in leaderboard');await capture(b,'giant-scoreboard');await hold(b,'leaderboard',false);
  await capture(b,'giant-remote');await capture(a,'giant-first-person');
  const before=(await me(a)).motion.position;await hold(a,'forward',true);await delay(250);await hold(a,'forward',false);await delay(200);
  const moved=(await me(a)).motion.position;check(Math.hypot(moved.x-before.x,moved.z-before.z)>.5,'Giant movement is synchronized');
  await until(async()=>(await me(a)).powerup===null,'real 15-second Giant expiry',20000);await delay(400);
  check((await me(a)).health===100,'Giant expiration preserves health percentage');check(await a.$eval('.powerup-hud',e=>getComputedStyle(e).opacity==='0'),'HUD fades out on expiry');
  async function give(p,type,pos,h){await place(p,pos,h);const pickup=await room.pickupForTest(type,pos);await until(async()=>(await me(p)).powerup?.type===type,`collect ${type}`);return pickup;}
  await give(a,'doubleJump',arena.target,heading+180);
  await hold(a,'jump',true);await delay(50);await hold(a,'jump',false);await delay(170);await hold(a,'jump',true);await delay(50);await hold(a,'jump',false);
  await until(async()=>(await me(a)).motion.extraJumpCount===1,'confirmed second jump');
  check((await net(b)).snapshot.players.find(p=>p.id===aId).motion.extraJumpCount===1,'peer receives second jump');await capture(b,'double-jump-remote');
  await hold(a,'jump',true);await delay(40);await hold(a,'jump',false);check((await me(a)).motion.extraJumpCount===1,'third jump rejected');await until(async()=>(await me(a)).motion.grounded,'lands');
  await give(a,'shield',arena.target,heading+180);await place(b,arena.source,heading);
  await hold(b,'aim',true);await delay(650);
  const dx=arena.target[0]-arena.source[0],dz=arena.target[2]-arena.source[2],pitch=Math.atan2(1.05-1.64,Math.hypot(dx,dz))*180/Math.PI;
  await b.evaluate((h,p)=>window.__crossfire.look(h,p),heading,pitch);
  await hold(b,'fire',true);await delay(35);await hold(b,'fire',false);
  await until(async()=>(await me(a)).powerup.shield<75,'shield hit');
  check((await me(a)).health===100,'shield protects health');await capture(b,'shield-remote');await capture(a,'shield-hud');
  check(await b.evaluate(id=>window.__crossfire.powerups().effects.some(e=>e.id===id&&e.shield),aId),'subtle shield mesh is enabled');
  await a.setViewport({width:960,height:540});await delay(150);
  check(await a.evaluate(()=>{const ability=document.querySelector('.powerup-hud').getBoundingClientRect(),health=document.querySelector('.health').getBoundingClientRect(),chat=document.querySelector('.chat-hint').getBoundingClientRect();return ability.bottom<health.top&&ability.top>chat.bottom&&health.bottom<=innerHeight;}),'ability, health and chat do not overlap at 960x540');
  await capture(a,'shield-small-viewport');await a.setViewport({width:1280,height:720});
  await until(async()=>(await me(a)).powerup===null,'real shield expiry',20000);
  await give(b,'fire',arena.source,heading);await b.evaluate((h,p)=>window.__crossfire.look(h,p),heading,pitch);
  await hold(b,'fire',true);await delay(35);await hold(b,'fire',false);
  await until(async()=>!!(await me(a)).burn,'confirmed burning');
  check(await b.evaluate(id=>window.__crossfire.powerups().effects.some(e=>e.id===id&&e.flames===5),aId),'bounded flames on real burning opponent');await capture(b,'fire-burning-opponent');await capture(a,'burn-health');
  const expiry=(await me(b)).powerup.expiresAt,life=(await me(b)).life;await b.evaluate(()=>window.__crossfire.networkReconnect());
  await until(async()=>(await net(b)).state==='connected','reconnect');
  check((await net(b)).selfId===bId&&(await me(b)).life===life,'reconnect retains actual identity and life');check((await me(b)).powerup.expiresAt===expiry,'reconnect never extends ability');
  await until(async()=>(await me(a)).burn===null,'burn ends',7000);check((await me(a)).alive,'finite burn does not repeat forever');
  while(Date.now()-started<60000){check((await net(a)).state==='connected'&&(await net(b)).state==='connected','stable real sockets');await delay(2000);}
  check((await net(a)).snapshot.players.length===2&&(await net(b)).snapshot.players.length===2,'no duplicate peers after reconnection');
  check(errors.length===0,'no browser or asset errors');await capture(a,'final-hud');
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors,shots,connectedMs:Date.now()-started},null,2));
}catch(error){await capture(a??b,'failure').catch(()=>{});const diagnostics={};
  for(const [name,page]of [['a',a],['b',b]])if(page)diagnostics[name]=await net(page).catch(()=>null);
  diagnostics.authority=await room?.snapshotForTest().catch(()=>null);
  fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(error),checks,errors,shots,diagnostics},null,2));throw error;}
finally{room?.[Symbol.dispose]?.();await browser?.close();await mf.dispose();}
