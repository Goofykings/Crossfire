/** Five-card layout and live Worker account schema; no gameplay or reward mocks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:5181/',out='test-results/challenge-rotations';fs.mkdirSync(out,{recursive:true});
const fixture=new Miniflare(convertV4MiniflareOptions({name:'challenge-rotation-browser',modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:new URL(base).origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)}));
let browser;
try{
 const backend=(await fixture.ready).href;
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11']});
 const page=await browser.newPage(),errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(backend=>{
  const real=window.fetch;window.fetch=(input,init)=>{const url=new URL(String(input),location.href);return real(['/profile','/presence','/stats','/leaderboard','/cosmetics','/practice-challenges'].some(p=>url.pathname===p||url.pathname.startsWith(p+'/'))?new URL(url.pathname+url.search,backend):input,init);};
 },backend);
 await page.setViewport({width:1280,height:720});await page.goto(base+'?quality=low&shadows=off&scale=.6',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Five Challenges');
 await page.click('.challenge-retry');await page.waitForSelector('.challenges-panel[data-available="true"]',{timeout:60000});
 for(const period of ['daily','weekly']){
  await page.click('#challenge-tab-'+period);
  const cards=await page.$$eval('.challenge-card:not([hidden])',nodes=>nodes.map(n=>({id:n.dataset.challengeId,text:n.textContent})));
  assert.equal(cards.length,5);assert.equal(cards.filter(c=>c.id.includes(':bot-')).length,2);
  assert.equal(new Set(cards.filter(c=>!c.id.includes(':bot-')).map(c=>c.id.split(':')[1])).size,3);
  console.log(`PASS ${period}: five cards, two bot goals, three distinct combat goals`);
 }
 for(const [width,height] of [[1280,720],[900,600],[640,480],[390,640],[320,568]]){
  await page.setViewport({width,height});await delay(250);
  const fits=await page.evaluate(()=>{
   const list=document.querySelector('.challenge-list');list.scrollTop=list.scrollHeight;
   const last=list.lastElementChild.getBoundingClientRect(),box=list.getBoundingClientRect(),panel=document.querySelector('.challenges-panel').getBoundingClientRect();
   return panel.x>=0&&panel.right<=innerWidth+1&&panel.bottom<=innerHeight+1&&last.bottom<=box.bottom+2&&last.top>=box.top-2;
  });assert.ok(fits,`${width}x${height}: fifth card accessible`);await page.screenshot({path:`${out}/${width}x${height}.png`});console.log(`PASS ${width}x${height}: fifth card accessible`);
 }
 await page.setViewport({width:1280,height:720});await page.evaluate(()=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim().toUpperCase()==='SHOP').click());
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(n=>n.textContent.includes('250 GEMS')),{timeout:60000});
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS crate price displays 250 gems; no browser errors');
}finally{await browser?.close();await fixture.dispose();}
