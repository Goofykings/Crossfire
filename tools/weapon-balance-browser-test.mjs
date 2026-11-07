/** Production Practice UI/graphics with real local authority and no online requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4200/crossfire/',out='test-results/weapon-balance-browser';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--use-angle=d3d11','--disable-background-timer-throttling']});
let page;
try{
 page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(()=>{window.__requests=[];const fetch=window.fetch;window.fetch=(input,init)=>{const u=new URL(String(input),location.href);if(u.origin!==location.origin){window.__requests.push(u.href);return Promise.reject(Error('Offline test'));}return fetch(input,init);};});
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),shown=id=>page.waitForSelector(id+'.visible',{timeout:180000});
 const click=async(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!b)throw Error(text);b.click();},{root,text});
 await page.goto(base+'?quality=low&shadows=off&scale=.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Balance QA');
 const start=async weapon=>{await page.click('#menu .home-actions .primary');await shown('#modes');await click('#modes','PRACTICE');await shown('#practice-setup');await page.$eval('#practice-setup input[type=range]',e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});await click('#practice-setup','START PRACTICE');await shown('#weapons');await page.click(`#weapons [data-weapon="${weapon}"]`);await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});await page.bringToFront();};
 await start('sniper');check(await page.evaluate(()=>window.__crossfire.weapon().ammo===4),'sniper starts with four rounds');
 await page.evaluate(()=>window.__crossfire.hold('aim',true));await page.waitForFunction(()=>window.__crossfire.weapon().ads===1&&window.__crossfire.weapon().scope===1);
 await pause(350);const fov=await page.evaluate(()=>window.__crossfire.live().fovDeg);check(Math.abs(fov-90*.22/.82)<.15,'default scope derives an 18 percent lower magnification from the old zoom');
 await page.mouse.move(640,400);await page.mouse.wheel({deltaY:-100});await page.waitForFunction(old=>window.__crossfire.live().fovDeg<old-.5,{},fov);check(await page.evaluate(()=>window.__crossfire.weapon().id==='sniper'),'real scroll zooms without switching weapons');
 for(let i=0;i<12;i++)await page.mouse.wheel({deltaY:-100});await pause(450);check(Math.abs(await page.evaluate(()=>window.__crossfire.live().fovDeg)-90*.22)<.15,'upper zoom remains the previous maximum');
 await page.screenshot({path:out+'/sniper-max.png'});
 for(let i=0;i<15;i++)await page.mouse.wheel({deltaY:100});await pause(450);check(Math.abs(await page.evaluate(()=>window.__crossfire.live().fovDeg)-90*.22/.65)<.15,'minimum zoom is below the old default');
 check(await page.$eval('#hud .scope-zoom',e=>e.textContent==='3.0x'),'small scope HUD reports current magnification');
 const before=await page.evaluate(()=>({yaw:window.__crossfire.motion().yaw,pitch:window.__crossfire.motion().pitch}));
 await page.evaluate(()=>{window.__recoil=[];const start=performance.now();const sample=()=>{window.__recoil.push(window.__crossfire.weapon().view?.motion.recoil??0);if(performance.now()-start<700)requestAnimationFrame(sample);};sample();window.__crossfire.hold('fire',true);});
 await page.waitForFunction(()=>window.__crossfire.weapon().ammo===3);await page.evaluate(()=>window.__crossfire.hold('fire',false));await pause(800);
 check(await page.evaluate(()=>Math.max(...window.__recoil)>.025),'sniper model has a visible stronger recoil impulse');
 check(await page.evaluate(before=>window.__crossfire.motion().yaw===before.yaw&&window.__crossfire.motion().pitch===before.pitch,before),'sniper firing leaves no permanent aim drift');
 await page.waitForFunction(()=>window.__crossfire.weapon().action==='idle');await page.evaluate(()=>window.__crossfire.hold('aim',false));await page.waitForFunction(()=>window.__crossfire.weapon().ads===0);await pause(450);check(Math.abs(await page.evaluate(()=>window.__crossfire.live().fovDeg)-90)<.15,'scope exits smoothly to the normal FOV');
 await page.evaluate(()=>window.__crossfire.networkLeave());await shown('#menu');
 await start('shotgun');await page.evaluate(()=>window.__crossfire.hold('aim',true));await page.waitForFunction(()=>window.__crossfire.weapon().ads===1);await page.screenshot({path:out+'/shotgun-ads.png'});check(await page.evaluate(()=>window.__crossfire.weapon().magazine===2),'shotgun retains two shells');
 await page.evaluate(()=>window.__crossfire.hold('fire',true));await page.waitForFunction(()=>window.__crossfire.weapon().ammo===1);await page.evaluate(()=>window.__crossfire.hold('fire',false));await page.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).combat.gun.cooldown===0;});
 await page.evaluate(()=>window.__crossfire.hold('fire',true));await page.waitForFunction(()=>window.__crossfire.weapon().ammo===0);await page.evaluate(()=>window.__crossfire.hold('fire',false));check(true,'two local authoritative shotgun shots work back to back');
 await page.evaluate(()=>window.__crossfire.networkLeave());await shown('#menu');await start('smg');check(await page.evaluate(()=>window.__crossfire.weapon().ammo===64&&window.__crossfire.weapon().magazine===64),'SMG and ammo HUD source use 64-round magazine');
 await page.evaluate(()=>window.__crossfire.hold('fire',true));await page.waitForFunction(()=>window.__crossfire.weapon().ammo<64);await page.evaluate(()=>{window.__crossfire.hold('fire',false);window.__crossfire.hold('reload',true);});await pause(80);await page.evaluate(()=>window.__crossfire.hold('reload',false));await page.waitForFunction(()=>window.__crossfire.weapon().ammo===64&&window.__crossfire.weapon().action==='idle');check(true,'SMG reload refills 64 through the real Practice authority');
 check(await page.evaluate(()=>window.__requests.length===0&&window.__crossfire.practice().policy.persistStatistics===false),'Practice remains local and non-persistent');check(errors.length===0,'no browser exceptions or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
