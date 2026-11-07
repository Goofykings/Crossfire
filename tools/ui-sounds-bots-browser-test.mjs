/** Actual production UI/Web Audio; no successful backend replies are simulated. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(x=>x.startsWith('http'))??'http://127.0.0.1:4200/crossfire/';
const out='test-results/ui-sounds-bots-browser';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,args:['--use-angle=d3d11','--disable-background-timer-throttling'],defaultViewport:{width:1280,height:720}});
const checks=[],errors=[],check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(()=>{
  window.__tones=[];const start=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer&&Math.abs(this.buffer.duration-.045)<.00001||this.buffer&&Math.abs(this.buffer.duration-.055)<.00001)window.__tones.push({duration:this.buffer.duration,rate:this.playbackRate.value,at:performance.now()});return start.apply(this,args);};
  window.fetch=((real)=>(input,init)=>{const url=new URL(String(input),location.href);if(url.origin!==location.origin)return Promise.reject(Error('Offline UI test'));return real(input,init);})(window.fetch.bind(window));
 });
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const clickText=async(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text.toUpperCase());if(!b)throw Error('Missing '+text);b.click();},{root,text});
 const shown=id=>page.waitForSelector(id+'.visible',{timeout:120000});
 await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Audio QA');
 await page.click('.home-nav button');await pause(100);
 const clicks=()=>page.evaluate(()=>window.__tones.filter(t=>t.duration>.05).length);
 const before=await clicks();await page.click('.home-nav button');check(await clicks()===before+1,'one click tone across a menu transition');
 await pause(550);await page.evaluate(()=>window.__tones=[]);
 for(const selector of ['.home-nav button:nth-child(2)','.home-nav button:nth-child(3)','.home-nav button:nth-child(4)']){await page.hover(selector);await pause(60);}
 const tones=await page.evaluate(()=>window.__tones);check(tones.length===3,'one hover tone per newly entered button');check(tones[0].rate<tones[1].rate&&tones[1].rate<tones[2].rate,'rapid hover pitches rise gently');
 await page.mouse.move(1,400);await pause(550);await page.hover('.home-nav button:nth-child(2)');check(await page.evaluate(()=>Math.abs(window.__tones.at(-1).rate-1)<.01),'pitch returns to base after a pause');
 const disabledBefore=await clicks();await page.$eval('.home-nav button:nth-child(2)',b=>b.disabled=true);await page.click('.home-nav button:nth-child(2)');check(await clicks()===disabledBefore,'disabled controls stay quiet');await page.$eval('.home-nav button:nth-child(2)',b=>b.disabled=false);
 await page.click('#menu .home-actions .primary');await shown('#modes');await clickText('#modes','Practice');await shown('#practice-setup');
 check(await page.$$eval('#practice-setup [data-difficulty]',buttons=>buttons.map(b=>b.dataset.difficulty).join(',')==='beginner,intermediate,advanced,absurd'),'four ordered difficulty choices');
 await page.click('#practice-setup [data-difficulty="intermediate"]');
 const slider='#practice-setup .magnetic-slider input';await page.focus(slider);await page.keyboard.press('Home');await pause(100);await page.evaluate(()=>window.__tones=[]);
 for(let i=0;i<5;i++){await page.keyboard.press('ArrowRight');await pause(35);}
 check(await page.$eval(slider,n=>n.value==='5'),'keyboard reaches all five bot stops');
 const ticks=await page.evaluate(()=>window.__tones.length);check(ticks===5,'exactly one audio tick per keyboard integer change');await pause(500);check(await page.evaluate(()=>window.__tones.length)===ticks,'spring oscillation emits no extra ticks');
 await page.keyboard.press('ArrowRight');await pause(60);check(await page.evaluate(()=>window.__tones.length)===ticks,'clamped keyboard input emits no duplicate tick');
 await clickText('#practice-setup','Back');await shown('#modes');await clickText('#modes','Create Server');await shown('#create-room');
 const lobby='#create-room .magnetic-slider input';check(await page.$eval(lobby,n=>n.min==='2'&&n.max==='10'&&n.step==='1'&&n.value==='6'),'Create Server reuses magnetic slider with authoritative 2–10 range and default six');
 await page.focus(lobby);await page.keyboard.press('End');check(await page.$eval(lobby,n=>n.value==='10'),'lobby keyboard reaches ten');await page.keyboard.press('Home');check(await page.$eval(lobby,n=>n.value==='2'),'lobby keyboard reaches two');
 const track=await page.$('#create-room .magnetic-track'),rect=await track.boundingBox();await page.mouse.move(rect.x+rect.width*.5,rect.y+2);await page.mouse.down();await page.mouse.move(rect.x+rect.width,rect.y+2,{steps:8});await page.mouse.up();check(await page.$eval(lobby,n=>n.value==='10'),'lobby pointer drag reaches ten without old five-stop clamp');
 await page.touchscreen.tap(rect.x+rect.width*.25,rect.y+2);check(await page.$eval(lobby,n=>n.value==='4'),'lobby touch uses the same magnetic stops');await page.focus(lobby);await page.keyboard.press('End');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.focus(lobby);await page.keyboard.press('ArrowLeft');check(await page.$eval(lobby,n=>n.value==='9'),'reduced-motion selection stays functional');
 await page.screenshot({path:out+'/lobby.png'});
 await page.reload({waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Audio QA');await page.click('#menu .home-actions .primary');await shown('#modes');await clickText('#modes','Practice');await shown('#practice-setup');
 check(await page.$eval('#practice-setup [data-difficulty="intermediate"]',b=>b.getAttribute('aria-pressed')==='true'),'Intermediate survives a real refresh');
 await page.setViewport({width:640,height:480});await page.screenshot({path:out+'/practice-small.png'});
 check(await page.$eval('#practice-setup',e=>{const buttons=[...e.querySelectorAll('[data-difficulty]')];return buttons.every(b=>b.getBoundingClientRect().width>0);}), 'all difficulty options render on a small screen');
 check(errors.length===0,'no browser exceptions');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
