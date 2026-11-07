/** Actual browser gameplay with every backend request/socket forbidden. No mock combat replies. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const chromebook=process.argv.includes('--chromebook'),production=process.argv.includes('--production'),base=process.argv.find(a=>/^https?:/.test(a))??'http://127.0.0.1:4201/',out='test-results/practice-browser'+(production?'-production':'')+(chromebook?'-chromebook':'');fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],performanceSamples=[],check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1000,height:700},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
let page;
try{
 const context=await browser.createBrowserContext();page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(chromebook=>{
  if(chromebook)localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true}));
  window.__backendAttempts=[];window.__socketAttempts=0;const real=window.fetch;
  window.fetch=(input,init)=>{const url=new URL(String(input),location.href);if(url.origin!==location.origin){window.__backendAttempts.push(url.pathname);return Promise.reject(Error('Backend deliberately unreachable'));}return real(input,init);};
  const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){const u=new URL(url,location.href);if(u.host!==location.host||u.pathname.startsWith('/ws')){window.__socketAttempts++;throw Error('Practice must not construct a gameplay socket');}super(url,protocols);}};
 },chromebook);
 await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Offline Player');if(chromebook)check(await page.evaluate(()=>window.__crossfire.settings().chromebookMode&&document.body.dataset.uiLight==='true'),'actual Chromebook mode is enabled');
 const visible=selector=>page.waitForSelector(selector+'.visible',{timeout:240000});
 const clickText=async(root,label)=>page.evaluate(({root,label})=>{const b=[...document.querySelectorAll(root+' button')].find(n=>n.textContent.trim().toUpperCase()===label.toUpperCase());if(!b)throw Error('Missing '+label);b.click();},{root,label});
 const openSetup=async()=>{await page.click('#menu .home-actions .primary');await visible('#modes');await clickText('#modes','Practice');await visible('#practice-setup');};
 await openSetup();check(await page.evaluate(()=>window.__backendAttempts.length===0&&window.__socketAttempts===0),'cold startup and Practice setup make zero backend requests/sockets');
 check(await page.$eval('.practice-notice',n=>n.textContent.includes('will not count')),'setup explains no online rewards');
 await page.screenshot({path:out+'/setup-1000.png'});await page.setViewport({width:640,height:480});await page.screenshot({path:out+'/setup-640.png'});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'small setup no horizontal overflow');await page.setViewport({width:1000,height:700});
 const saved=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/career|stat|gem|challenge/.test(k))));
 for(const [index,map]of ['european-town','industrial-complex','modern-city'].entries()){
  if(index)await openSetup();await page.click(`#practice-setup [data-map="${map}"]`);
  await page.$eval('#practice-setup input[type=range]',(n,bots)=>{n.value=String(bots);n.dispatchEvent(new Event('input',{bubbles:true}));},index===0?3:0);
  if(index===0)await page.click('#practice-setup [data-difficulty="advanced"]');
  await clickText('#practice-setup','START PRACTICE');await visible('#weapons');
  check(await page.evaluate(()=>!window.__crossfire.network().snapshot.players[0].alive),'Practice weapon selection precedes spawn '+map);
  await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:120000});await page.bringToFront();
  check(await page.evaluate(map=>window.__crossfire.mapInfo().id===map&&window.__crossfire.practice().policy.rewards===false,map),'actual local map and explicit no-reward policy '+map);
  if(index===0){
   await page.waitForFunction(()=>window.__crossfire.network().rendered.filter(p=>p.source==='glb').length===3,{timeout:120000});
   const start=await page.evaluate(()=>window.__crossfire.practice().bots.map(b=>b.position));await delay(2500);const now=await page.evaluate(()=>window.__crossfire.practice().bots.map(b=>b.position));
   check(JSON.stringify(start)!==JSON.stringify(now),'actual rendered bots move in the real map');
   const ammo=await page.evaluate(()=>window.__crossfire.weapon().ammo);await page.evaluate(()=>window.__crossfire.hold('fire',true));await delay(150);await page.evaluate(()=>window.__crossfire.hold('fire',false));
   await page.waitForFunction(ammo=>window.__crossfire.weapon().ammo<ammo,{},ammo);check(true,'human fire consumes local authoritative ammo');
   await page.evaluate(()=>window.__crossfire.hold('reload',true));await delay(100);await page.evaluate(()=>window.__crossfire.hold('reload',false));await page.waitForFunction(()=>window.__crossfire.weapon().ammo===30&&window.__crossfire.weapon().action==='idle',{timeout:10000});check(true,'partial magazine reload works offline');
   await page.evaluate(()=>window.__crossfire.hold('grenade',true));await delay(150);await page.evaluate(()=>window.__crossfire.hold('grenade',false));
   await page.waitForFunction(()=>window.__crossfire.network().snapshot.grenades.length>0,{timeout:6000});check(true,'actual local grenade launch synchronized to presentation');
   await page.evaluate(()=>window.__crossfire.hold('leaderboard',true));await page.screenshot({path:out+'/local-scoreboard.png'});await page.evaluate(()=>window.__crossfire.hold('leaderboard',false));
   const limit=Date.now()+30000;while(Date.now()<limit&&!await page.evaluate(()=>window.__crossfire.network().snapshot.players.some(p=>p.kills>0)))await delay(500);
   check(await page.evaluate(()=>window.__crossfire.network().snapshot.players.some(p=>p.kills>0)),'real bots generate local eliminations and scores');
   await page.screenshot({path:out+'/playing.png'});
   if(!production){
    await page.keyboard.press('F4');await page.waitForSelector('.practice-debug');await page.screenshot({path:out+'/navigation.png'});await page.keyboard.press('F4');check(await page.$('.practice-debug')===null,'development navigation overlay toggles and cleans up');
    await page.evaluate(()=>window.__crossfire.practiceFinish());await visible('#results');await delay(850);check(await page.$eval('#results',n=>n.textContent.includes('PRACTICE')&&n.textContent.includes('RESULTS NOT SAVED')&&n.querySelectorAll('tbody tr').length===4),'local results explicitly not saved with full standings');
    check(await page.$eval('.result-gems',n=>n.textContent==='PRACTICE — NO GEMS EARNED'&&n.dataset.confirmed==='false'),'Practice results never claim a server gem award');await page.screenshot({path:out+'/results.png'});
    await clickText('#results','RESTART');await visible('#weapons');await page.click('#weapons [data-weapon="smg"]');await page.waitForFunction(()=>window.__crossfire.ready());check(await page.evaluate(()=>window.__crossfire.practice().setup.bots===3&&window.__crossfire.network().snapshot.players.every(p=>p.score===0)),'restart preserves setup and resets local scores');
    await page.evaluate(()=>window.__crossfire.practiceFinish());await visible('#results');await clickText('#results','PRACTICE SETTINGS');await visible('#practice-setup');await clickText('#practice-setup','Back');await visible('#modes');await clickText('#modes','Back');await visible('#menu');
   }else{await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');}
  }else{
   check(await page.evaluate(()=>window.__crossfire.network().snapshot.players.length===1),'zero bots is genuinely alone '+map);await page.screenshot({path:out+'/'+map+'.png'});await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');
  }
 }
 // Five real rendered bots, team-relative presentation and the hardest difficulty.
 await openSetup();await page.click('#practice-setup [data-mode="teams"]');await page.click('#practice-setup [data-difficulty="absurd"]');
 await page.$eval('#practice-setup input[type=range]',n=>{n.value='5';n.dispatchEvent(new Event('input',{bubbles:true}));});await clickText('#practice-setup','START PRACTICE');await visible('#weapons');await page.click('#weapons [data-weapon="shotgun"]');await page.waitForFunction(()=>window.__crossfire.ready());
 await page.waitForFunction(()=>window.__crossfire.network().rendered.length===5,{timeout:120000});
 check(await page.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.filter(p=>p.team==='blue').length===3&&n.rendered.filter(p=>p.friendly).length===2&&window.__crossfire.practice().setup.difficulty==='absurd';}),'Teams balances six participants and renders two friendly bots');
 await delay(4000);for(let i=0;i<5;i++){performanceSamples.push(await page.evaluate(()=>({fps:window.__crossfire.stats().fps,frameMs:window.__crossfire.stats().frameMs})));await delay(500);}await page.evaluate(()=>window.__crossfire.hold('leaderboard',true));await page.screenshot({path:out+'/teams-five-bots.png'});await page.evaluate(()=>window.__crossfire.hold('leaderboard',false));await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');
 check(await page.evaluate(()=>window.__backendAttempts.length===0&&window.__socketAttempts===0),'all Practice gameplay/leave/results paths made zero backend requests/sockets');
 check(JSON.stringify(saved)===JSON.stringify(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/career|stat|gem|challenge/.test(k))))),'account-related browser data unchanged');check(errors.length===0,'no page errors or missing assets');
 await page.click('#menu .home-actions .primary');await visible('#modes');await clickText('#modes','Public Servers');await page.waitForFunction(()=>window.__backendAttempts.length>0);await delay(300);await clickText('#modes','Practice');await visible('#practice-setup');const afterFailure=await page.evaluate(()=>window.__backendAttempts.length);
 await page.click('#practice-setup [data-difficulty="beginner"]');await clickText('#practice-setup','START PRACTICE');await visible('#weapons');await page.click('#weapons [data-weapon="sniper"]');await page.waitForFunction(()=>window.__crossfire.ready());await delay(1500);
 check(await page.evaluate(n=>window.__backendAttempts.length===n&&window.__socketAttempts===0&&window.__crossfire.practice().setup.difficulty==='beginner',afterFailure),'Practice remains usable after an actual failed online request, without further backend traffic');await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');
 fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,performanceSamples},null,2));
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors,state:await page?.evaluate(()=>({attempts:window.__backendAttempts,sockets:window.__socketAttempts,text:document.body.innerText,practice:window.__crossfire?.practice(),network:window.__crossfire?.network()})).catch(()=>null)},null,2));throw error;}
finally{await browser.close();}
