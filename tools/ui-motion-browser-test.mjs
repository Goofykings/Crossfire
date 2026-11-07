/** Real DOM/CSS interactions against the local Worker. No mocked gameplay or inventory.
 * node tools/ui-motion-browser-test.mjs http://127.0.0.1:4201/
 * Also accepts the production /crossfire/ subpath. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {harness,origin} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4201/';
const out='test-results/ui-motion-browser'+(new URL(base).pathname==='/'?'-dev':'-production');fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],states={};let cleanup=()=>{},browser,page;
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin,AFK_WARN_MS:'300000',AFK_KICK_MS:'600000'});
const shown=id=>page.waitForSelector(id+'.visible',{timeout:240000});
const click=async(root,text)=>page.evaluate(({root,text})=>{
 const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text.toUpperCase());
 if(!b)throw Error('Missing '+root+': '+text);b.click();
},{root,text});
const nav=text=>click('.home-nav',text);
const shot=name=>page.screenshot({path:out+'/'+name+'.png'});
const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('.screen, dialog')].some(e=>e.getAnimations({subtree:true}).some(a=>a.playState==='running'&&Number.isFinite(a.effect.getTiming().iterations))));
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const context=await browser.createBrowserContext();page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(server=>{
  const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){const u=new URL(url,location.href);super(u.pathname.startsWith('/ws')?new URL(u.pathname+u.search,server).href.replace('http:','ws:'):url,protocols);}};
  const real=window.fetch;window.fetch=(input,init)=>{const u=new URL(String(input),location.href);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip','/cosmetics/open'].includes(u.pathname)?new URL(u.pathname+u.search,server):input,init);};
 },h.base);
 await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Motion Tester');await shown('#menu');await settled();
 const header=await page.$eval('.home-header',e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y}));
 const play='#menu .home-actions .primary';await page.hover(play);
 await page.waitForFunction(s=>Number(getComputedStyle(document.querySelector(s)).scale)>1.018,{},play);
 check(true,'PLAY hover gently enlarges without changing layout');
 await page.mouse.down();await page.waitForFunction(s=>Number(getComputedStyle(document.querySelector(s)).scale)<.985,{},play);
 check(true,'pointer down compresses before click action');await page.mouse.move(4,400);await page.mouse.up();
 check(await page.$eval('#menu',e=>e.classList.contains('visible')),'cancelled pointer press does not navigate');
 states.close=await page.evaluate(()=>{
  const menu=document.querySelector('#menu');[...document.querySelectorAll('.home-nav button')].find(b=>b.textContent.trim().toUpperCase()==='SHOP').click();
  // Sample the real CSS transition at its midpoint without depending on CPU/GLB
  // compilation speed or assuming the compositor renders within two RAFs.
  getComputedStyle(menu).opacity;
  const animation=menu.getAnimations().find(a=>a.transitionProperty==='opacity');
  if(animation){animation.pause();animation.currentTime=90;}
  const s=getComputedStyle(menu),result={display:s.display,opacity:Number(s.opacity),inert:menu.inert,transition:s.transition};
  animation?.play();return result;
 });await shown('#shop');
 check(states.close.display!=='none'&&states.close.opacity>0&&states.close.opacity<1&&states.close.inert,'closing page really fades while its old controls are already inert: '+JSON.stringify(states.close));
 check(await page.$eval('#menu',e=>e.inert&&e.getAttribute('aria-hidden')==='true'),'outgoing home immediately blocks pointer and keyboard interaction');
 await settled();check(await page.$eval('.home-header',(e,h)=>e.getBoundingClientRect().x===h.x&&e.getBoundingClientRect().y===h.y,header),'top navigation stays fixed across pages');await shot('shop');
 await nav('Locker');await shown('#locker');await page.waitForSelector('.cosmetic-card');await settled();
 const layout=await page.$eval('.cosmetic-card',e=>({width:e.offsetWidth,height:e.offsetHeight,next:e.nextElementSibling?.offsetTop}));await page.hover('.cosmetic-card');
 await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.cosmetic-card')).scale)>1.018);
 check(await page.$eval('.cosmetic-card',(e,r)=>e.offsetWidth===r.width&&e.offsetHeight===r.height&&e.nextElementSibling?.offsetTop===r.next,layout),'card hover preserves grid dimensions and neighbors');
 await page.click('.cosmetic-categories [data-category="rifle"]');await settled();await shot('locker');
 check(await page.$eval('.cosmetic-categories [data-category="rifle"]',e=>e.getAttribute('aria-pressed')==='true'),'locker category selection persists');
 await page.click('.cosmetic-card');await shown('#cosmetic-preview');await page.waitForFunction(()=>window.__crossfire.cosmetics().page.preview.meshes>0,{timeout:120000});
 const disabled=await page.$eval('#cosmetic-preview footer button',b=>({disabled:b.disabled,scale:getComputedStyle(b).scale,text:b.textContent}));
 check(disabled.disabled&&(disabled.scale==='none'||Number(disabled.scale)===1),'equipped action stays visibly disabled without hover scaling');await shot('cosmetic-preview');await click('#cosmetic-preview','Back');
 await nav('Settings');await shown('#settings');await settled();
 await click('#settings [role="tablist"]','Graphics');await page.waitForSelector('#panel-graphics:not([hidden])');
 const dropdown='#panel-graphics [role="combobox"]';await page.click(dropdown);await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 check(await page.$eval('.dropdown-list',e=>e.hidden&&e.inert),'keyboard selection closes and inerts dropdown immediately');
 await click('#settings','Apply');await page.waitForFunction(()=>document.querySelector('.settings-status').textContent.startsWith('Applied'));
 check(await page.$eval('.settings-status',e=>e.classList.contains('ok')),'Apply confirms immediately with a soft confirmation effect');
 await page.click('#set-chromebookMode');await click('#settings','Apply');
 check(await page.evaluate(()=>document.body.dataset.uiLight==='true'&&getComputedStyle(document.body).getPropertyValue('--motion-travel').trim()==='0px'),'saved Chromebook Mode enables the lighter motion profile live');
 await page.click('#set-chromebookMode');await click('#settings','Apply');
 await page.click(dropdown);await page.keyboard.press('Escape');
 check(await page.$eval('#settings',e=>e.classList.contains('visible')),'Escape closes combobox without leaving Settings');
 await click('#settings [role="tablist"]','Controls');await page.setViewport({width:640,height:480});await settled();
 check(await page.$eval('.settings-foot',e=>e.getBoundingClientRect().bottom<=innerHeight),'scrolling Controls keeps footer accessible at 640x480');await shot('controls-small');
 await page.$eval('#tab-graphics',e=>e.focus());
 check(await page.$eval('#tab-graphics',e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;}),'settings navigation scrolls its last tab into view for keyboard users on short screens');
 await page.setViewport({width:1280,height:800});await click('#settings','Back');
 await nav('Leaderboard');await shown('#leaderboard');await page.click('.stats-button');
 check(await page.$eval('.personal-stats',e=>!e.hidden&&!e.inert),'My Stats opens without delaying interaction');await settled();await shot('leaderboard-stats');
 await page.keyboard.press('Escape');check(await page.$eval('.stats-button',e=>document.activeElement===e&&e.getAttribute('aria-expanded')==='false'),'My Stats Escape restores focus and collapsed state');
 await page.evaluate(()=>{const names=['SHOP','LOCKER','LEADERBOARD','PLAY'];for(let i=0;i<24;i++){const name=names[i%4];[...document.querySelectorAll('.home-nav button')].find(b=>b.textContent.trim().toUpperCase()===name).click();}});await settled();
 check(await page.evaluate(()=>document.querySelectorAll('.screen.visible:not([inert])').length===1&&document.querySelector('#menu.visible')!==null),'rapid navigation leaves one interactive page and no stale transition callbacks');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.hover(play);
 check(await page.$eval(play,e=>{const s=getComputedStyle(e).scale;return s==='none'||Number(s)===1;}),'reduced motion removes button movement');await nav('Shop');await shown('#shop');await settled();
 check(await page.$eval('#shop',e=>getComputedStyle(e).transitionProperty.includes('opacity')&&getComputedStyle(e).opacity==='1'),'reduced motion retains a useful short opacity transition');await shot('reduced-motion-shop');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await nav('Play');await settled();
 await page.click(play);await shown('#modes');
 const roomOwner=await h.profile();await h.create(roomOwner,{name:'Animation QA room'});
 await click('#modes','Public Servers');await page.waitForSelector('.room-row');await settled();await shot('server-browser');
 check(await page.$$eval('.room-row',rows=>rows.some(e=>e.textContent.includes('Animation QA room'))),'public server browser renders a real authoritative room');
 await click('#modes','Join Private Server');
 await page.waitForSelector('dialog[open]');await settled();await shot('private-dialog');
 check(await page.$eval('dialog[open]',e=>e.contains(document.activeElement)),'native private-room modal owns keyboard focus');
 await page.keyboard.press('Escape');check(await page.$$eval('dialog[open]',e=>e.length===0),'native modal closes on Escape without deferring its state');
 await click('#modes','Create Server');await shown('#create-room');await settled();await shot('create-server');
 await click('#create-room','TEAMS');await page.hover('#create-room .room-map');
 check(await page.$$eval('#create-room .room-options [aria-pressed="true"]',e=>e.some(b=>b.textContent==='TEAMS')),'hovering a map preserves selected server mode');await click('#create-room','Back');
 await click('#modes','Practice');await shown('#practice-setup');await settled();await shot('practice-setup');
 await click('#practice-setup','START PRACTICE');await shown('#weapons');await settled();await shot('weapons');
 check(await page.$$eval('#weapons [data-weapon]',e=>e.length===4),'joining retains all four weapon cards before spawn');
 await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
 check(await page.$eval('#hud',e=>!e.inert&&getComputedStyle(e).opacity==='1'),'combat HUD is immediate, not faded or delayed');
 await page.evaluate(()=>window.__crossfire.hold('leaderboard',true));await page.waitForSelector('.scoreboard:not([hidden])');await shot('scoreboard');
 await page.evaluate(()=>window.__crossfire.hold('leaderboard',false));await page.evaluate(()=>window.__crossfire.pause());await shown('#pause');await settled();await shot('pause');
 check(await page.$eval('#hud',e=>e.inert),'HUD underneath Pause cannot accept menu clicks');
 await click('#pause','Settings');await shown('#settings');await click('#settings','Back');await shown('#pause');
 if(new URL(base).pathname==='/'){
  await page.evaluate(()=>window.__crossfire.practiceFinish());await shown('#results');await settled();await shot('results');
  check(await page.$eval('#results',e=>!e.inert&&e.textContent.includes('RESULTS NOT SAVED')),'real offline match results retain accurate non-rewarding data');
 }
 await page.evaluate(()=>window.__crossfire.networkLeave());await shown('#menu');await settled();
 states.final=await page.evaluate(()=>({screen:document.body.dataset.screen,light:document.body.dataset.uiLight,interactive:[...document.querySelectorAll('.screen:not([inert])')].map(e=>e.id)}));
 check(errors.length===0,'no browser exceptions or missing static assets');
 fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,states},null,2));
}catch(error){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors,text:await page?.evaluate(()=>document.body.innerText).catch(()=>null)},null,2));throw error;}
finally{await browser?.close();await cleanup();}
