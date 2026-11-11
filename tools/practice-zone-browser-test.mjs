import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const out='test-results/practice-zone-browser';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:45000,defaultViewport:{width:1000,height:700},args:['--use-angle=d3d11','--disable-background-timer-throttling']});
const checks=[],errors=[];let page;const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
try{
 page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(()=>{
  window.__gameSockets=0;const WS=WebSocket;window.WebSocket=class extends WS{constructor(url,...args){if(!String(url).includes('4217')){window.__gameSockets++;throw Error('No gameplay socket in Practice');}super(url,...args);}};
  const fetch=window.fetch;window.fetch=(input,init)=>new URL(String(input),location.href).origin===location.origin?fetch(input,init):Promise.reject(Error('Offline account backend'));
 });
 await page.goto('http://127.0.0.1:4217/?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:120000});await completeGuestProfile(page,'Zone Practice');
 const click=async(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(n=>n.textContent.trim().toUpperCase()===text);if(!b)throw Error(text);b.click();},{root,text});
 await page.click('#menu .home-actions .primary');await click('#modes','PRACTICE');await page.waitForSelector('#practice-setup.visible');
 await page.click('#practice-setup [data-mode="zone-control"]');
 check(await page.$eval('#practice-setup [data-map="european-town"]',b=>b.hidden&&b.disabled),'Town unavailable in Zone Control');
 check(await page.$eval('#practice-setup [data-map="industrial-complex"]',b=>b.classList.contains('selected')),'eligible map selected automatically');
 await page.setViewport({width:640,height:480});await page.screenshot({path:out+'/setup-640.png'});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'small setup has no horizontal overflow');await page.setViewport({width:1000,height:700});
 await page.$eval('#practice-setup input[type=range]',n=>{n.value='3';n.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('#practice-setup','START PRACTICE');await page.waitForSelector('#weapons.visible',{timeout:120000});await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:120000});
 await page.waitForFunction(()=>window.__crossfire.network().snapshot.zoneControl?.zones.length===3);
 check(await page.evaluate(()=>{const n=window.__crossfire.network().snapshot;return n.match.mode==='zone-control'&&n.players.length===4&&n.players.every(p=>p.team); }),'real local session has objectives and balanced teams');
 await page.waitForFunction(()=>window.__crossfire.practice().bots.every(b=>b.objective),{timeout:30000});check(true,'all three bots choose objectives');
 await page.waitForFunction(()=>window.__crossfire.network().snapshot.zoneControl.zones.some(z=>z.owner),{timeout:90000});check(true,'real browser bot captures an objective');
 await page.screenshot({path:out+'/objectives.png'});check(await page.evaluate(()=>window.__gameSockets===0),'no gameplay backend connection');
 await page.evaluate(()=>window.__crossfire.practiceFinish());await page.waitForSelector('#results.visible',{timeout:10000});check(true,'local objective match results render');
 await page.evaluate(()=>window.__crossfire.networkLeave());await page.waitForSelector('#menu.visible');check(errors.length===0,'no browser exceptions');
 fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
}catch(e){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(e),checks,errors},null,2));throw e;}finally{await browser.close();}
