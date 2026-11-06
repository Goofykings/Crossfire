/** Real local Worker + production GitHub Pages subpath; no synthetic inventory/game replies. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {harness,origin,self,frames,ack} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/',out='test-results/cosmetics-browser';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
let cleanup=()=>{},browser,page;const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin});
const visible=selector=>page.waitForSelector(selector+'.visible',{timeout:240000});
async function clickText(root,label){await page.evaluate(({root,label})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===label.toUpperCase());if(!b)throw Error('Missing '+label);b.click();},{root,label});}
const nav=label=>clickText('.home-nav',label);
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1000,height:700},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const context=await browser.createBrowserContext();page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(server=>{
  window.__cosmeticRequests=[];window.__mapRequests=[];window.__socketCount=0;
  const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(new URL(url,location.href).pathname,server).href.replace('http:','ws:'),protocols);window.__socketCount++;}};
  const real=window.fetch;window.fetch=(input,init)=>{const url=new URL(String(input),location.href);if(/assets\/maps\/.*\.glb/.test(url.pathname))window.__mapRequests.push(url.pathname);if(url.pathname.startsWith('/cosmetics'))window.__cosmeticRequests.push({path:url.pathname,method:init?.method??'GET'});return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip'].includes(url.pathname)?new URL(url.pathname+url.search,server):input,init);};
 },h.base);
 await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Cosmetic Guest');
 await nav('Locker');await visible('#locker');await page.waitForFunction(()=>window.__crossfire.cosmetics().view?.owned.length===4,{timeout:120000});
 check((await page.$$eval('.home-nav button',nodes=>nodes.map(n=>n.textContent.trim().toUpperCase()))).join('|')==='PLAY|SHOP|LOCKER|SETTINGS|LEADERBOARD','five tabs in requested order');
 const credential=await page.evaluate(()=>localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('crossfire.career.v1:'))));assert.match(credential,/^[a-f0-9]{64}$/);
 await h.central.legacyWalletForStatisticsTest(credential,37);
 await nav('Shop');await visible('#shop');await page.waitForFunction(()=>document.querySelector('.shop-balance')?.textContent==='37 GEMS');
 check(await page.$eval('.shop-crate',n=>n.complete&&n.naturalWidth>0),'original crate asset loads at GitHub Pages subpath');
 check(await page.$eval('.shop-open',n=>n.disabled&&n.textContent.includes('300')),'crate Open disabled');
 check(await page.$eval('.shop-offer',n=>n.textContent.includes('COMING SOON')),'crate clearly Coming Soon');
 check((await page.$$eval('.crate-distribution span',nodes=>nodes.map(n=>n.textContent.match(/\d+%/)[0]))).join(',')==='50%,37%,10%,3%','future distribution displayed correctly');
 const requests=await page.evaluate(()=>window.__cosmeticRequests.length);await page.$eval('.shop-open',b=>b.click());await delay(100);
 check(await page.evaluate(n=>window.__cosmeticRequests.length===n,requests),'disabled crate makes no purchase/equip request');await page.screenshot({path:out+'/shop-1000.png'});
 await nav('Locker');await visible('#locker');await page.waitForFunction(()=>document.querySelectorAll('.cosmetic-card').length===4&&[...document.querySelectorAll('.cosmetic-thumbnail')].every(i=>i.complete&&i.naturalWidth>0),{timeout:240000});
 check(await page.$$eval('.cosmetic-card',cards=>cards.every(c=>c.querySelector('strong').textContent==='Default'&&c.textContent.includes('Common'))),'four actual-model Default Common cards');
 check(await page.$$eval('.equipped-item',n=>n.length===4),'equipped panel includes four categories');await page.screenshot({path:out+'/locker-1000.png'});
 for(const weapon of ['smg','rifle','sniper','shotgun']){
  await page.click('.cosmetic-categories [data-category="'+weapon+'"]');check(await page.$$eval('.cosmetic-card',n=>n.length===1),'category filter '+weapon);
  await page.click('.cosmetic-card');await visible('#cosmetic-preview');await page.waitForFunction(()=>window.__crossfire.cosmetics().page.preview.meshes>0&&document.querySelector('#cosmetic-preview>.cosmetic-status').textContent==='',{timeout:120000});
  check(await page.$eval('#cosmetic-preview footer button',b=>b.disabled&&b.textContent==='EQUIPPED'),'owned '+weapon+' preview rendered and already equipped');
  await page.screenshot({path:out+'/preview-'+weapon+'.png'});await clickText('#cosmetic-preview','Back');await visible('#locker');check(!(await page.evaluate(()=>window.__crossfire.cosmetics().page.preview.active)),'Back disposes '+weapon+' preview');
 }
 await page.click('.cosmetic-categories [data-category="all"]');await page.setViewport({width:640,height:480});await delay(200);await page.screenshot({path:out+'/locker-640.png'});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.equipped-item')].every(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})),'640x480 has no horizontal overflow and all four equipped rows visible');
 await page.setViewport({width:480,height:480});await delay(200);await page.screenshot({path:out+'/locker-480.png'});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.equipped-item')].every(n=>n.getBoundingClientRect().bottom<=innerHeight)),'480x480 stacked equipped panel remains visible');
 await page.setViewport({width:1000,height:700});
 check(await page.evaluate(()=>window.__socketCount===0&&window.__mapRequests.length===0),'Shop/Locker allocate no gameplay socket or full map');
 const request=async(id)=>{const r=await fetch(new URL('/cosmetics/equip',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify({version:1,id})});return r.status;};
 check(await request('default-rifle')===200&&await request('unowned-rifle')===403,'authoritative idempotent equip accepted, unowned rejected');
 check((await h.api('/profile',credential)).data.profile.gems===37,'wallet unchanged by browsing or equip');
 await nav('Settings');await visible('#settings');await clickText('#settings','Back');await nav('Leaderboard');await visible('#leaderboard');await nav('Play');await visible('#menu');
 await page.reload({waitUntil:'domcontentloaded',timeout:240000});await nav('Locker');await visible('#locker');await page.waitForFunction(()=>window.__crossfire?.cosmetics().view?.owned.length===4,{timeout:120000});
 check((await page.evaluate(()=>window.__crossfire.cosmetics().view.equipped)).rifle==='default-rifle','server equipment restored after browser refresh');
 await nav('Play');await visible('#menu');await page.waitForFunction(()=>window.__crossfire.homeCharacter().weapon?.cosmeticId==='default-rifle',{timeout:240000});check(true,'home character keeps actual equipped Default rifle');
 await page.click('#menu .home-actions .primary');await visible('#modes');await clickText('#modes','Create Server');await visible('#create-room');await clickText('#create-room','CREATE');await visible('#weapons');await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:120000});
 const net=await page.evaluate(()=>window.__crossfire.network()),otherToken=await h.profile(),ad=await h.admission(otherToken,{roomId:net.snapshot.room}),peer=await h.open(ad,otherToken);await h.spawn(peer,'sniper');
 await page.waitForFunction(id=>window.__crossfire.network().rendered.some(p=>p.id===id&&p.weapon?.id==='sniper'&&p.weapon?.cosmeticId==='default-sniper'),{timeout:120000},peer.id);
 check(true,'real second client sniper cosmetic renders on remote character');
 const before=self(peer).motion.position;frames(peer,{x:1});await ack(peer);await page.waitForFunction(id=>window.__crossfire.network().snapshot.players.some(p=>p.id===id&&p.cosmeticId==='default-sniper'),{},peer.id);check(JSON.stringify(self(peer).motion.position)!==JSON.stringify(before),'real peer movement remains authoritative');
 await page.bringToFront();await page.evaluate(()=>window.__crossfire.hold('fire',true));await delay(160);await page.evaluate(()=>window.__crossfire.hold('fire',false));await page.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).combat.gun.ammo<30;},{timeout:10000});check(true,'browser rifle firing still consumes server ammunition');
 await h.leave(peer);await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');check(await page.evaluate(()=>window.__crossfire.cosmetics().view.owned.length===4),'leaving match preserves inventory');
 check(errors.length===0,'no browser exceptions or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({message:String(error),checks,errors,text:await page?.evaluate(()=>document.body.innerText).catch(()=>null)},null,2));throw error;}
finally{await browser?.close();await cleanup();}
