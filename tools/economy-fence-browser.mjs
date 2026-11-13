/** Production Farmstead/Pages-path review; actual local Practice, no online socket. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {preview} from 'vite';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const out='test-results/economy-fences-browser';fs.mkdirSync(out,{recursive:true});
let browser,server;
try{
 server=await preview({base:'/crossfire/',preview:{host:'127.0.0.1',port:4224,strictPort:true}});
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,defaultViewport:{width:1000,height:700},args:['--use-angle=d3d11','--disable-background-timer-throttling']});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
 await page.evaluateOnNewDocument(()=>{const original=window.fetch;window.fetch=(url,init)=>new URL(String(url),location.href).origin===location.origin?original(url,init):Promise.reject(Error('Offline review'));window.__sockets=0;window.WebSocket=class{constructor(){window.__sockets++;throw Error('Practice must not create a gameplay socket');}};});
 await page.goto('http://127.0.0.1:4224/crossfire/?perf=1&quality=high',{waitUntil:'domcontentloaded',timeout:120000});await completeGuestProfile(page,'Fence Review');
 const click=(root,text)=>page.evaluate(({root,text})=>{const button=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!button)throw Error(text);button.click();},{root,text});
 await page.click('#menu .home-actions .primary');await click('#modes','PRACTICE');await page.waitForSelector('#practice-setup.visible');await page.click('#practice-setup [data-map="farmstead"]');await page.$eval('#practice-setup input[type=range]',n=>{n.value='0';n.dispatchEvent(new Event('input',{bubbles:true}));});await click('#practice-setup','START PRACTICE');await page.waitForSelector('#weapons.visible',{timeout:120000});await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady,{timeout:120000});
 const views=[['west',-31,6,-30,270,10],['north',-20,5,-41,0,12],['east',31,5,-30,90,10],['south',-10,4,41,180,12],['roof',-20,10,-30,270,-12]];
 for(const mode of ['high','chromebook']){
  if(mode==='chromebook')await page.evaluate(()=>window.__crossfire.setSetting({chromebookMode:true}));
  for(const [name,x,y,z,h,p]of views){await page.evaluate(args=>window.__crossfire.freeCam(...args),[x,y,z,h,p]);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:`${out}/${mode}-${name}.png`});}
 }
 assert.equal(await page.evaluate(()=>window.__sockets),0);assert.deepEqual(errors,[]);fs.writeFileSync(out+'/checks.json',JSON.stringify({views:views.map(v=>v[0]),modes:['high','chromebook'],errors},null,2));console.log('PASS production Farmstead review in High and Chromebook modes; '+out);
}finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));}
