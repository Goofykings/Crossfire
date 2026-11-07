/** Real local Worker + Chrome: HUD/menus, cold GLB thumbnails and confirmed match rewards.
 * npm run build; node tools/serve-dist.mjs --port 4200 --base /crossfire/
 * node tools/hud-browser-test.mjs http://127.0.0.1:4200/crossfire/
 * Also accepts the Vite dev URL (adds the offline Practice result check).
 * Fixtures ONLY place real players / advance server time; no fabricated combat replies. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {harness,origin,until,self,aim,frames,ack} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4200/crossfire/';
const menusOnly=process.argv.includes('--menus-only'),out='test-results/hud-browser'+(new URL(base).pathname==='/'?'-dev':'')+(menusOnly?'-menus':'');fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],states={};const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
let cleanup=()=>{},browser,page;const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin,AFK_WARN_MS:'300000',AFK_KICK_MS:'600000'});
const visible=s=>page.waitForSelector(s+'.visible',{timeout:240000});
const click=async(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text.toUpperCase());if(!b)throw Error('Missing '+text);b.click();},{root,text});
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
const net=()=>page.evaluate(()=>window.__crossfire.network());
async function pose(room,id,position){await room.placeForCombatTest(id,position);if((await net()).selfId===id)await page.waitForFunction(p=>{const me=window.__crossfire.player();return me&&Math.hypot(me.x-p[0],me.y-p[1],me.z-p[2])<.3;},{timeout:20000},position);}
async function lookAt(position){await page.evaluate(p=>window.__crossfire.aimAt(p[0],p[1]+1.6,p[2]),position);}
async function showPlayer(id){try{await page.waitForFunction(id=>window.__crossfire.network().rendered.some(p=>p.id===id&&p.source==='glb'&&p.labelVisible),{timeout:30000},id);}catch(error){fs.writeFileSync(out+'/visibility-failure.json',JSON.stringify(await page.evaluate(()=>({network:window.__crossfire.network(),motion:window.__crossfire.motion(),view:window.__crossfire.leanView()})),null,2));throw error;}}
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const context=await browser.createBrowserContext();page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(server=>{
  const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){const u=new URL(url,location.href);super(u.pathname.startsWith('/ws')?new URL(u.pathname,server).href.replace('http:','ws:'):url,protocols);}};
  const real=window.fetch;window.fetch=(input,init)=>{const u=new URL(String(input),location.href);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip','/cosmetics/open'].includes(u.pathname)?new URL(u.pathname+u.search,server):input,init);};
 },h.base);
 await page.goto(base+'?quality=low&shadows=off&scale=0.75',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'HUD Tester');
 await page.waitForFunction(()=>window.__crossfire.homeCharacter().weapon?.hands.length===2,{timeout:120000});
 const samples=[];for(let i=0;i<9;i++){samples.push(await page.evaluate(()=>window.__crossfire.homeCharacter()));await delay(400);}const first=samples[0],second=samples.at(-1);states.idle=samples;
 check(Math.max(...samples.map(s=>s.idleOffset))-Math.min(...samples.map(s=>s.idleOffset))>.012,'home breathing moves the character slowly');
 check(second.weapon.hands.every(h=>h.gap<.025),'home breathing preserves both hand grips');
 check(first.weapon.grips.some((g,i)=>g.some((v,k)=>Math.abs(v-second.weapon.grips[i][k])>.001)),'held weapon and arms animate with the idle rig');await shot('home-idle');
 check(await page.$$eval('.home-nav [aria-current="page"]',n=>n.length===1&&n[0].textContent.trim().toUpperCase()==='PLAY'),'PLAY is initially the only selected tab');
 await page.hover('.home-nav button:nth-child(2)');check(await page.$$eval('.home-nav [aria-current="page"]',n=>n.length===1&&n[0].textContent.trim().toUpperCase()==='PLAY'),'hovering Shop preserves PLAY selection');
 await click('.home-nav','Leaderboard');await visible('#leaderboard');await page.waitForFunction(()=>!document.querySelector('.leaderboard-status').textContent.includes('Loading'));
 for(const [width,height]of [[1280,800],[640,480],[390,700]]){await page.setViewport({width,height});await delay(250);
  check(await page.evaluate(()=>{const header=document.querySelector('.home-header'),content=document.querySelector('#leaderboard'),a=header.getBoundingClientRect(),b=content.getBoundingClientRect();return !header.hidden&&b.top>=a.bottom&&document.documentElement.scrollWidth<=innerWidth;}),`leaderboard stays below visible header at ${width}x${height}`);
  check(await page.$$eval('.leaderboard-tabs',rows=>{const [a,b]=rows.map(r=>r.getBoundingClientRect());return Math.abs(a.left-b.left)<1&&Math.abs(a.right-b.right)<1&&rows[0].children.length===3&&rows[1].children.length===2;}),`leaderboard filter rows align at ${width}x${height}`);await shot(`leaderboard-${width}`);
  await page.click('.stats-button');check(await page.$eval('.personal-stats',n=>{const r=n.getBoundingClientRect();return !n.hidden&&r.bottom<=innerHeight&&r.left>=0;}),`My Stats dropdown fits and can scroll at ${width}x${height}`);await page.click('.stats-button');
 }
 check(await page.$$eval('.leaderboard-tabs [aria-pressed="true"]',n=>n.map(b=>b.textContent).join()==='ALL,KILLS'),'leaderboard defaults ALL/KILLS without Points');
 await page.click('.stats-button');check(await page.$eval('.personal-stats',n=>!n.hidden),'My Stats remains available');await page.setViewport({width:1280,height:800});
 for(const mode of menusOnly?[]:['ffa','teams']){
  await click('.home-nav','Play');await visible('#menu');await page.click('#menu .home-actions .primary');await visible('#modes');await click('#modes','Create Server');await visible('#create-room');
  if(mode==='teams')await click('#create-room','TEAMS');await click('#create-room','CREATE');await visible('#weapons');
  await page.waitForFunction(()=>[...document.querySelectorAll('#weapons [data-weapon] img')].filter(i=>!i.hidden&&i.complete&&i.naturalWidth>0).length===4,{timeout:120000});
  if(mode==='ffa'){
   states.thumbnails=await page.$$eval('#weapons [data-weapon]',cards=>cards.map(card=>{const img=card.querySelector('img'),c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let opaque=0;for(let k=3;k<p.length;k+=4)if(p[k]>20)opaque++;return {id:card.dataset.weapon,opaque,width:c.width,height:c.height};}));
   check(states.thumbnails.length===4&&states.thumbnails.every(t=>t.opaque>5000),'all four real GLB thumbnails, including SMG, have visible pixels on a cold cache');await shot('weapons');
  }
  await page.click('#weapons [data-weapon="sniper"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});const n=await net(),room=h.room(n.snapshot.room);
  const tokens=[await h.profile(),await h.profile()],enemy=await h.open(await h.admission(tokens[0],{roomId:n.snapshot.room}),tokens[0]),friend=await h.open(await h.admission(tokens[1],{roomId:n.snapshot.room}),tokens[1]);
  await h.spawn(enemy,'smg');await h.spawn(friend,'rifle');const arena=await room.directionalArenaForTest();enemy.position=arena.center;friend.position=arena.sources.left;
  for(const [id,p]of [[n.selfId,arena.sources.front],[enemy.id,enemy.position],[friend.id,friend.position]])await pose(room,id,p);
  await lookAt(enemy.position);await showPlayer(enemy.id);
  const look=await aim(friend,enemy);frames(friend,{...look,trigger:true});await ack(friend);await page.waitForFunction(id=>document.querySelector(`.remote-player-label[data-player-id="${id}"]`)?.dataset.health==='75',{timeout:10000},enemy.id);
  await page.waitForFunction(id=>{const n=document.querySelector(`.remote-player-label[data-player-id="${id}"]`);return n&&!n.hidden&&Math.abs(new DOMMatrix(getComputedStyle(n.querySelector('.remote-player-health>span')).transform).a-.75)<.01;},{timeout:10000},enemy.id);check(true,`${mode}: authoritative 75 HP interpolates to 75% bar width`);await shot(mode+'-health');
  await page.evaluate(()=>window.__crossfire.hold('leaderboard',true));await page.waitForSelector('.scoreboard:not([hidden])');
  const colors=await page.$$eval('.scoreboard tbody td:first-child',n=>n.map(e=>getComputedStyle(e).color));check(new Set(colors).size===(mode==='ffa'?1:2),`${mode}: live scoreboard uses ${mode==='ffa'?'uniform gray':'both team colors'}`);await shot(mode+'-scoreboard');await page.evaluate(()=>window.__crossfire.hold('leaderboard',false));
  const wall=await room.wallArenaForTest();await pose(room,n.selfId,wall.pair[0]);await pose(room,enemy.id,wall.pair[1]);await pose(room,friend.id,wall.pair[1]);await lookAt(wall.pair[1]);
  await page.waitForFunction(([enemy,friend,teams])=>{const r=window.__crossfire.network().rendered,a=r.find(p=>p.id===enemy),b=r.find(p=>p.id===friend);return a&&b&&!a.labelVisible&&(teams?b.labelVisible:!b.labelVisible);},{timeout:20000},[enemy.id,friend.id,mode==='teams']);check(true,`${mode}: opponents and health bars hide behind real walls${mode==='teams'?'; teammate marker/bar stays visible':''}`);await shot(mode+'-wall');
  for(const [id,p]of [[n.selfId,arena.sources.front],[enemy.id,enemy.position],[friend.id,friend.position]])await pose(room,id,p);await lookAt(enemy.position);await showPlayer(enemy.id);
  await page.evaluate(()=>window.__crossfire.hold('aim',true));await delay(900);await page.evaluate(()=>window.__crossfire.hold('fire',true));await delay(100);await page.evaluate(()=>{window.__crossfire.hold('fire',false);window.__crossfire.hold('aim',false);});
  await page.waitForFunction(id=>window.__crossfire.network().rendered.find(p=>p.id===id)?.death,{timeout:10000},enemy.id);
  states[mode+'Death']=[];for(const [i,t]of [.05,.3,.4].entries()){await delay(t*1000);states[mode+'Death'].push((await net()).rendered.find(p=>p.id===enemy.id));await shot(`${mode}-death-${i}`);}
  const deaths=states[mode+'Death'].filter(Boolean);check(deaths.length>=2&&Math.hypot(deaths.at(-1).x-deaths[0].x,deaths.at(-1).z-deaths[0].z)>.15,`${mode}: confirmed elimination throws the body backward while falling`);
  await room.qualifyMatchGemsForTest([n.selfId,enemy.id,friend.id]);await room.advanceMapForTest();await room.flushRoomRewardsForTest();await visible('#results');await page.waitForSelector('.result-gems[data-confirmed="true"]',{timeout:20000});
  const result=(await net()).snapshot.result,expected=result.gemRewards.awards[n.selfId];check(expected===(mode==='teams'?12:10)&&await page.$eval('.result-gems',n=>n.textContent)===`+${expected} GEMS EARNED`,`${mode}: result banner shows only the canonical server-confirmed payout`);
  const resultColors=await page.$$eval('.result-board tbody td:first-child',n=>n.map(e=>getComputedStyle(e).color));check(new Set(resultColors).size===(mode==='ffa'?1:2),`${mode}: result rows preserve required gray/team colors`);await shot(mode+'-results');
  await click('#results','RETURN TO LOBBY');await visible('#menu');await h.leave(enemy);await h.leave(friend);
 }
 check(errors.length===0,'no browser exceptions or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,states},null,2));
}catch(error){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors,state:await net().catch(()=>null)},null,2));throw error;}
finally{await browser?.close();await cleanup();}
