/** Real local account/inventory APIs; responsive menus and real pointer/keyboard/touch input. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {harness,origin} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4200/crossfire/';
const out='test-results/menu-header-browser';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];let cleanup=()=>{},browser,page;
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin});
const click=async(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text.toUpperCase());assertButton(b);b.click();function assertButton(b){if(!b)throw Error('Missing '+root+': '+text);}},{root,text});
const nav=name=>click('.home-nav',name),shown=id=>page.waitForSelector(id+'.visible',{timeout:120000});
const shot=name=>page.screenshot({path:out+'/'+name+'.png'});
const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('.screen')].some(e=>e.getAnimations({subtree:true}).some(a=>a.playState==='running'&&Number.isFinite(a.effect.getTiming().iterations))));
async function hoverOverflow(selector,panel){
 await page.mouse.move(1,400);await settled();const before=await page.$eval(panel,e=>[e.scrollWidth,e.scrollHeight]);await page.hover(selector);
 const stable=await page.$eval(selector,(e,{panel,before})=>{getComputedStyle(e).scale;const a=e.getAnimations().find(a=>a.transitionProperty==='scale');if(a){a.pause();a.currentTime=110;}
 const p=document.querySelector(panel),same=p.scrollWidth===before[0]&&p.scrollHeight===before[1];a?.finish();return same;},{panel,before});
 check(stable,'hover cannot create scrollbars: '+selector);
}
try{
 // Isolated local ranking fixtures exercise real scrolling through the real API.
 // These QA profiles/kill records never reach a public service or shipped data.
 for(let i=0;i<10;i++){const token=await h.profile();await h.central.statisticsFixtureForTest(token,`Scroll QA ${i+1}`,[{kind:'kill',id:`scroll-qa:${i}`,at:Date.now(),points:100}]);}
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 page=await (await browser.createBrowserContext()).newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(server=>{const real=window.fetch;window.fetch=(input,init)=>{const u=new URL(String(input),location.href);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip','/cosmetics/open'].includes(u.pathname)?new URL(u.pathname+u.search,server):input,init);};},h.base);
 await page.goto(base+'?quality=low&shadows=off&scale=.5',{waitUntil:'domcontentloaded',timeout:120000});await completeGuestProfile(page,'Header Tester');await shown('#menu');
 await nav('Shop');await shown('#shop');await page.waitForFunction(()=>document.querySelector('.home-gems span').textContent==='0',{timeout:30000});
 await page.evaluate(()=>{window.__originalHeader=document.querySelector('.home-header');window.__originalAccount=document.querySelector('.home-account');});
 const pages=[['Play','#menu'],['Shop','#shop'],['Locker','#locker'],['Settings','#settings'],['Leaderboard','#leaderboard']];
 for(const [width,height]of [[1920,1080],[1366,768],[1280,720],[1024,600],[640,480],[390,700]]){
  await page.setViewport({width,height});let header=null;
  for(const [name,id]of pages){await nav(name);await shown(id);await settled();
   const state=await page.evaluate(id=>{const e=document.querySelector('.home-header'),r=e.getBoundingClientRect(),a=document.querySelector('.home-account'),ar=a.getBoundingClientRect(),style=getComputedStyle(e),content=document.querySelector(id);return{
    same:e===window.__originalHeader&&a===window.__originalAccount,rect:[r.x,r.y,r.width,r.height],gradient:getComputedStyle(e,'::before').backgroundImage,
    account:!a.hidden&&getComputedStyle(a).visibility!=='hidden'&&ar.left>=0&&ar.right<=innerWidth&&ar.top>=0&&ar.bottom<innerHeight,
    balance:a.querySelector('.home-gems span').textContent,name:a.querySelector('.home-account-name').textContent,
    selected:e.querySelector('[aria-current="page"]')?.textContent.trim(),overflow:document.documentElement.scrollWidth>innerWidth,
    borders:[...e.querySelectorAll('.nav-button')].every(b=>parseFloat(getComputedStyle(b).borderWidth)===0&&getComputedStyle(b).boxShadow==='none'),
    back:[...content.querySelectorAll('button')].some(b=>b.textContent.trim()==='Back'),
    contentTop:id==='#menu'?null:(content.querySelector('.settings-card,.cosmetic-heading,.leaderboard-heading')?.getBoundingClientRect().top??0),headerBottom:r.bottom,
    font:getComputedStyle(e.querySelector('.nav-button')).fontSize};},id);
   check(state.same&&state.account&&state.balance==='0'&&state.name==='Header Tester'&&state.selected===name,`${width}x${height} ${name}: same header/account nodes and real balance`);
   if(header)check(JSON.stringify(state.rect)===JSON.stringify(header.rect)&&state.gradient===header.gradient,`${name}: header has identical dimensions and gradient`);else header=state;
   if(width===1920)check(state.rect[3]<150&&state.rect[1]<25,'compact header height and top spacing');
   check(!state.overflow&&state.borders&&parseFloat(state.font)>=15.3,`${name}: no document overflow or ordinary borders; font retained`);
   if(['Shop','Locker','Leaderboard'].includes(name))check(!state.back,`${name}: redundant Back removed`);
   if(state.contentTop!==null)check(state.contentTop>=state.headerBottom-1,`${name}: content clears header`);
   if(width===1280||width===390)await shot(name.toLowerCase()+'-'+width);
  }
 }
 await page.setViewport({width:1280,height:720});await nav('Locker');await shown('#locker');await page.waitForSelector('.cosmetic-card');
 for(let i=1;i<=5;i++)await hoverOverflow(`.home-nav button:nth-child(${i})`,'.home-nav');
 await hoverOverflow('.cosmetic-card','.cosmetic-inventory');
 await hoverOverflow('.cosmetic-categories button','.cosmetic-categories');
 const category='.cosmetic-categories button[data-category="melee"]';await page.mouse.move(2,400);await page.hover(category);
 const overshoot=await page.$eval(category,e=>{getComputedStyle(e).scale;const a=e.getAnimations().find(a=>a.transitionProperty==='scale');if(!a)return null;a.pause();let peak=0;for(let t=0;t<=360;t+=10){a.currentTime=t;peak=Math.max(peak,Number(getComputedStyle(e).scale));}a.currentTime=360;const settle=Number(getComputedStyle(e).scale);a.play();return {peak,settle};});
 check(overshoot?.peak>1.07&&overshoot.peak<1.09&&Math.abs(overshoot.settle-1.03)<.002,'Locker categories share the navigation overshoot/settle interaction');
 await page.mouse.down();check(await page.$eval(category,e=>getComputedStyle(e).transitionDuration.includes('0.09s')),'category press uses distinct compression');await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('.cosmetic-categories [data-category="melee"]').getAttribute('aria-pressed')==='true');
 check(await page.$$eval('.cosmetic-card',cards=>cards.length===1&&cards[0].dataset.cosmetic==='default-melee'),'category filtering remains correct');
 for(const selector of ['.cosmetic-categories','.cosmetic-inventory','.cosmetic-equipped'])check(await page.$eval(selector,e=>getComputedStyle(e).scrollbarWidth==='thin'),'themed scrollbar: '+selector);
 await nav('Leaderboard');await shown('#leaderboard');await page.click('.stats-button');check(await page.$eval('.personal-stats',e=>!e.hidden),'My Stats remains accessible');await page.keyboard.press('Escape');
 await hoverOverflow('.leaderboard-tabs button','.leaderboard-content');
 await page.setViewport({width:640,height:480});await page.waitForFunction(()=>document.querySelectorAll('.global-rankings tbody tr').length===10);
 const top=await page.$eval('.home-header',e=>e.getBoundingClientRect().top);await page.hover('.global-rankings');await page.mouse.wheel({deltaY:400});
 await page.waitForFunction(()=>document.querySelector('.leaderboard-content').scrollTop>0);
 check(await page.$eval('.home-header',(e,top)=>e.getBoundingClientRect().top===top,top),'real ranking panel scrolls independently while the header stays fixed');
 await nav('Settings');await shown('#settings');await page.click('#tab-controls');await page.setViewport({width:640,height:480});
 await hoverOverflow('#settings .settings-tabs button','.settings-tabs');
 check(await page.$eval('.settings-foot',e=>e.getBoundingClientRect().bottom<=innerHeight),'settings footer remains accessible on short screens');
 await page.$eval('#panel-controls',e=>e.scrollTop=e.scrollHeight);check(await page.$eval('#panel-controls',e=>e.scrollTop>0),'Controls still scroll independently');
 await click('#settings','Back');await page.setViewport({width:1280,height:720});await nav('Play');await page.click('#menu .home-actions .primary');await shown('#modes');await click('#modes','Practice');await shown('#practice-setup');
 await hoverOverflow('#practice-setup button[type="submit"]','.practice-setup');
 const slider='.magnetic-slider',range=slider+' input';await page.$eval(slider,e=>e.scrollIntoView({block:'center'}));
 const track=await page.$eval('.magnetic-track',e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y+r.height/2,w:r.width};});
 await page.focus(range);await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');check(await page.$eval(range,e=>e.value==='1'),'keyboard Home and ArrowRight select exactly one bot');await page.keyboard.press('End');check(await page.$eval(range,e=>e.value==='5'),'keyboard End reaches five bots');
 await page.mouse.click(track.x+track.w*.4,track.y);check(await page.$eval(range,e=>e.value==='2'),'clicking a stop selects its integer immediately');
 await page.mouse.move(track.x+track.w*.4,track.y);await page.mouse.down();await page.mouse.move(track.x+track.w,track.y,{steps:3});await page.mouse.up();
 await page.waitForFunction(()=>Math.abs(Number(document.querySelector('.magnetic-slider').style.getPropertyValue('--bot-position'))-1)<.002);
 check(await page.$eval(range,e=>e.value==='5'),'rapid pointer drag glides to five and settles');await shot('practice-slider');
 const cdp=await page.createCDPSession();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:track.x+track.w,y:track.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:track.x,y:track.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 check(await page.$eval(range,e=>e.value==='0'),'real touch drag reaches zero');
 await page.$eval(slider,e=>e.addEventListener('pointerdown',event=>{window.__sliderPointer=event.pointerId;},{once:true}));
 await page.mouse.move(track.x+track.w*.4,track.y);await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 check(await page.$eval(slider,e=>!e.hasPointerCapture(window.__sliderPointer)),'window blur releases pointer capture and cancels the drag');await page.mouse.up();
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.focus(range);await page.keyboard.press('End');
 check(await page.$eval(slider,e=>e.style.getPropertyValue('--bot-position')==='1'),'reduced motion snaps directly');
 check(await page.$eval(range,e=>e.min==='0'&&e.max==='5'&&e.step==='1'&&getComputedStyle(e).opacity==='0'),'native accessible integer range remains behind the custom thumb');
 await page.setViewport({width:390,height:700});await shot('practice-narrow');check(await page.$eval('.practice-setup',e=>e.scrollWidth<=e.clientWidth),'Practice has no horizontal overflow');
 await click('#practice-setup','Back');check(errors.length===0,'no browser exceptions or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,overshoot},null,2));
}catch(error){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors},null,2));throw error;}
finally{await browser?.close();await cleanup();}
