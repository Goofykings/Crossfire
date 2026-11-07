/** Inspect the real home and Locker against the local Worker, including production subpaths. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {harness,origin} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';

const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4201/';
const out='test-results/home-locker-'+(new URL(base).pathname==='/'?'dev':'production');
fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];let cleanup=()=>{},browser,page;
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('PASS '+label);};
const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin});
const click=async name=>page.evaluate(name=>{const b=[...document.querySelectorAll('.home-nav button')].find(b=>b.textContent.trim().toUpperCase()===name.toUpperCase());if(!b)throw Error('Missing nav '+name);b.click();},name);
const shown=id=>page.waitForSelector(id+'.visible',{timeout:120000});
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 page=await (await browser.createBrowserContext()).newPage();
 page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
 await page.evaluateOnNewDocument(server=>{const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){const u=new URL(url,location.href);super(u.pathname.startsWith('/ws')?new URL(u.pathname+u.search,server).href.replace('http:','ws:'):url,protocols);}};const real=window.fetch;window.fetch=(input,init)=>{const u=new URL(String(input),location.href);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip','/cosmetics/open'].includes(u.pathname)?new URL(u.pathname+u.search,server):input,init);};},h.base);
 await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:120000});await completeGuestProfile(page,'Visual Tester');await shown('#menu');
 await page.waitForFunction(()=>window.__crossfire.homeCharacter().weapon?.hands.length===2,{timeout:120000});
 await page.mouse.move(2,400);await shot('home');
 const play='#menu .home-actions .primary';
 const idle=await page.$eval(play,e=>({border:getComputedStyle(e).borderWidth,glow:getComputedStyle(e,'::before').backgroundImage,selected:document.querySelector('.home-nav [aria-current="page"]').textContent.trim()}));
 check(parseFloat(idle.border)===0&&idle.glow==='none'&&idle.selected==='Play','main Play remains blue and borderless without an upward glow');
 check(await page.$eval('.home-nav button:first-child',e=>getComputedStyle(e).boxShadow==='none'&&parseFloat(getComputedStyle(e).borderWidth)===0&&getComputedStyle(e,'::after').content==='none'),'selected Play tab has no upward glow or hairline outline');
 const background=await page.$eval('.home-header',e=>getComputedStyle(e,'::before').backgroundImage);
 check(background.includes('linear-gradient')&&background.includes('rgba(17, 25, 35, 0)'),'shared header has a transparent gradient edge');
 const inspectHover=async selector=>{
  await page.mouse.move(2,400);await page.$eval(selector,e=>getComputedStyle(e).scale);await page.hover(selector);
  return page.$eval(selector,e=>{getComputedStyle(e).scale;const a=e.getAnimations().find(x=>x.transitionProperty==='scale');if(!a)return {missing:true,scale:getComputedStyle(e).scale,transition:getComputedStyle(e).transition,hover:e.matches(':hover')};a.pause();let peak=0;for(let t=0;t<=360;t+=10){a.currentTime=t;peak=Math.max(peak,Number(getComputedStyle(e).scale));}a.currentTime=360;const settled=Number(getComputedStyle(e).scale);const size={w:e.offsetWidth,h:e.offsetHeight};a.play();return {peak,settled,size};});
 };
 const hplay=await inspectHover(play);check(hplay&&hplay.peak>1.075&&hplay.peak<1.085&&Math.abs(hplay.settled-1.03)<.002,'main Play overshoots 1.08 then settles to 1.03: '+JSON.stringify(hplay));
 await shot('home-hover');
 await page.mouse.move(2,400);
 const departing=await page.$eval(play,e=>Number(getComputedStyle(e).scale));
 check(departing>1,'Play begins its return from the hovered size');
 await page.waitForFunction(s=>{const v=getComputedStyle(document.querySelector(s)).scale;return v==='none'||Math.abs(Number(v)-1)<.002;},{timeout:2000},play);
 check(true,'Play smoothly returns to its selected size after mouse leave');
 await page.hover(play);
 await page.$eval(play,e=>{getComputedStyle(e).scale;const a=e.getAnimations().find(x=>x.transitionProperty==='scale');if(!a)throw Error('Hover transition missing');a.pause();a.currentTime=120;});
 await page.mouse.move(2,400);
 check(await page.$eval(play,e=>Number(getComputedStyle(e).scale)>1.02),'leaving during the overshoot also starts a smooth return');
 await page.waitForFunction(s=>{const v=getComputedStyle(document.querySelector(s)).scale;return v==='none'||Math.abs(Number(v)-1)<.002;},{timeout:2000},play);
 for(let i=1;i<=5;i++){
  const selector=`.home-nav button:nth-child(${i})`,before=await page.$eval(selector,e=>({w:e.offsetWidth,h:e.offsetHeight})),hover=await inspectHover(selector);
  check(hover&&hover.peak>1.075&&hover.peak<1.085&&Math.abs(hover.settled-1.03)<.002&&hover.size.w===before.w&&hover.size.h===before.h,`nav ${i}: overshoot and settle without layout shifts`);
  if(i===2)check(await page.$eval('.home-nav [aria-current="page"]',e=>e.textContent.trim()==='Play'),'hovering another tab retains the selected Play state');
 }
 await page.mouse.move(2,400);await page.keyboard.press('Tab');
 check(await page.evaluate(()=>{const e=document.activeElement;return e?.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none';}),'keyboard focus remains clearly outlined');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.hover(play);
 check(await page.$eval(play,e=>{const scale=getComputedStyle(e).scale;return (scale==='none'||Number(scale)===1)&&!e.getAnimations().some(a=>a.transitionProperty==='scale');}),'reduced motion removes the overshoot');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await page.mouse.move(2,400);
 for(const [name,id] of [['Shop','#shop'],['Locker','#locker'],['Settings','#settings'],['Leaderboard','#leaderboard'],['Play','#menu']]){
  await click(name);await shown(id);check(await page.$eval('.home-header',(e,b)=>getComputedStyle(e,'::before').backgroundImage===b,background),`${name}: header gradient and navigation remain consistent`);
 }
 await click('Locker');await shown('#locker');
 await page.waitForFunction(()=>document.querySelectorAll('.cosmetic-card').length===5&&[...document.querySelectorAll('.cosmetic-card img')].every(i=>!i.hidden&&i.complete&&i.naturalWidth>0),{timeout:120000});
 for(const [width,height]of [[1280,800],[1000,700],[640,480],[390,700]]){
  await page.setViewport({width,height});
  const info=await page.$$eval('.cosmetic-card',cards=>cards.map(c=>{const r=c.getBoundingClientRect(),img=c.querySelector('img'),ir=img.getBoundingClientRect(),label=c.querySelector('strong').getBoundingClientRect();return {w:r.width,h:r.height,fit:getComputedStyle(img).objectFit,within:ir.left>=r.left&&ir.right<=r.right&&label.bottom<=r.bottom,accent:getComputedStyle(c).boxShadow};}));
  check(info.length===5&&info.every(c=>Math.abs(c.w-c.h)<1&&c.w<=133&&c.fit==='contain'&&c.within&&c.accent!=='none'),`${width}x${height}: five compact square cards, contained images and rarity accents`);
  check(await page.$$eval('.cosmetic-categories button',buttons=>buttons.every(b=>b.scrollWidth<=b.clientWidth)),`${width}x${height}: Locker category labels fit their buttons`);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}x${height}: no horizontal page overflow`);await shot(`locker-${width}`);
 }
 await page.setViewport({width:1280,height:800});await page.click('.cosmetic-card');await shown('#cosmetic-preview');
 await page.waitForFunction(()=>window.__crossfire.cosmetics().page.preview.meshes>0,{timeout:120000});
 check(true,'clicking a compact card still opens the full 3D preview');
 check(errors.length===0,'no browser errors or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
}catch(error){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors},null,2));throw error;}
finally{await browser?.close();await cleanup();}
