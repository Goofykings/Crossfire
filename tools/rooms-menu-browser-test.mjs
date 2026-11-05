/** Small-screen navigation and an actual full-public-room -> empty-browser -> refresh transition. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {harness,until,origin} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base='http://127.0.0.1:4200/crossfire/',out='test-results/rooms-browser',checks=[];let cleanup,browser;
const h=await harness({after:f=>cleanup=f},{ALLOWED_ORIGINS:origin+','+new URL(base).origin});
try{
 const peers=[];for(let i=0;i<10;i++){const c=await h.open({room:{id:'public-main'},ticket:'a'.repeat(64)},undefined);assert.equal(c.welcome.type,'welcome');peers.push(c);}
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:640,height:480},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(server=>{const real=window.fetch;window.fetch=(input,init)=>{const url=new URL(String(input),location.href);return real(['/rooms','/profile','/presence','/stats','/leaderboard'].includes(url.pathname)?new URL(url.pathname+url.search,server):input,init);};},h.base);
 await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Menu Inspector');await page.click('#menu .home-actions .primary');
 await page.waitForFunction(()=>document.querySelector('#modes .room-status')?.textContent==='None');checks.push('full canonical room produces actual None discovery state');await page.screenshot({path:out+'/none-640.png'});
 assert.equal(await page.evaluate(()=>window.__crossfire.network().state),'idle');checks.push('empty directory opens no gameplay socket');
 await h.leave(peers[0]);await page.evaluate(()=>document.querySelector('.room-refresh').click());await page.waitForFunction(()=>document.querySelector('.room-row')?.textContent.includes('9/10'));
 checks.push('Refresh immediately discovers the actual freed public slot');
 assert.ok(await page.$eval('.room-refresh',b=>b.getBoundingClientRect().width<110));checks.push('Refresh remains a small button at laptop/mobile widths');
 await page.evaluate(()=>[...document.querySelectorAll('#modes button')].find(b=>b.textContent==='Create Server').click());await page.waitForSelector('#create-room.visible');
 await page.$eval('.room-setup',e=>{e.scrollTop=e.scrollHeight;});
 assert.ok(await page.$eval('.room-setup button[type=submit]',b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));checks.push('640x480 setup scroll reaches capacity and Create controls');
 await page.screenshot({path:out+'/create-640-bottom.png'});assert.deepEqual(errors,[]);checks.push('no browser page exceptions');
 fs.writeFileSync(out+'/menu-report.json',JSON.stringify({checks,errors},null,2));for(const c of checks)console.log('PASS '+c);
}finally{await browser?.close();await cleanup?.();}
