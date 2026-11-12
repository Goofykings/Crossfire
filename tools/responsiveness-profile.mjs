/** Repeatable local combat/presentation profile; CPU throttling is not Chromebook hardware validation. */
import fs from 'node:fs';import puppeteer from 'puppeteer-core';import {completeGuestProfile} from './guest-profile-helper.mjs';
const url=process.argv[2]??'http://127.0.0.1:4221/crossfire/',label=process.argv[3]??'baseline',out='test-results/responsiveness';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,defaultViewport:{width:1366,height:768},args:['--use-angle=d3d11','--disable-background-timer-throttling'],protocolTimeout:180000});
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true}));const real=window.fetch;window.fetch=(u,i)=>new URL(String(u),location.href).origin===location.origin?real(u,i):Promise.reject(Error('Offline profile fixture'));});
 await page.goto(url,{waitUntil:'domcontentloaded'});await completeGuestProfile(page,'Profile');
 const click=(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!b)throw Error(text);b.click();},{root,text});
 await page.click('#menu .home-actions .primary');await click('#modes','PRACTICE');await page.waitForSelector('#practice-setup.visible');await page.click('#practice-setup [data-map="european-town"]');await page.$eval('#practice-setup input[type=range]',n=>{n.value='1';n.dispatchEvent(new Event('input',{bubbles:true}));});await click('#practice-setup','START PRACTICE');await page.waitForSelector('#weapons.visible',{timeout:120000});await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:120000});
 const cdp=await page.createCDPSession();await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 const data=await page.evaluate(()=>new Promise(resolve=>{
  const api=window.__crossfire,frames=[],cpu=[],started=performance.now();let last=started,death=false;
  api.resetPerformance?.();api.hold('fire',true);function frame(now){frames.push(now-last);last=now;
   if(!death&&now-started>1800){const t=performance.now();api.eliminateRemote();cpu.push({event:'first-death',ms:performance.now()-t});death=true;}
   if(now-started<6500)return requestAnimationFrame(frame);api.hold('fire',false);frames.sort((a,b)=>a-b);
   const p=f=>frames[Math.min(frames.length-1,Math.floor(frames.length*f))];resolve({frames:frames.length,p50:p(.5),p95:p(.95),p99:p(.99),lowFps:1000/p(.99),longFrames:frames.filter(x=>x>50),cpu,state:api.state(),motion:api.motion(),diagnostics:api.performance?.(),stats:api.stats()});}
  requestAnimationFrame(frame);
 }));const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(`${out}/${label}.cpuprofile`,JSON.stringify(profile));fs.writeFileSync(`${out}/${label}.json`,JSON.stringify({label,cpuSlowdown:4,errors,...data},null,2));console.log(JSON.stringify({label,errors,...data}));if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
