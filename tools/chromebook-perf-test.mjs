/** Repeatable local comparison; CPU throttling is diagnostic, not Chromebook hardware emulation.
 * node tools/chromebook-perf-test.mjs [url] [label] [cpu slowdown]
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { completeGuestProfile } from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:5173/',label=process.argv[3]??'current',slowdown=Number(process.argv[4]??1);
const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
const out='test-results/chromebook-performance';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath,headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1366,height:768,deviceScaleFactor:1},args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--disable-background-timer-throttling']});
console.log('Chrome launched; measuring '+label);
let page;
try{
 page=await browser.newPage();const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')console.error(m.text().slice(0,500));});
 page.on('response',r=>{if(r.url().includes('/assets/'))requests.push({url:new URL(r.url()).pathname,bytes:Number(r.headers()['content-length']??0),status:r.status()});});
 await page.evaluateOnNewDocument(()=>localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true})));
 await page.goto(base+'?practice&autoplay',{waitUntil:'domcontentloaded',timeout:180000});
 await completeGuestProfile(page);
 console.log('Guest profile ready; loading map');
 const diagnostic=setInterval(()=>{void page.evaluate(()=>({ready:window.__crossfire?.ready(),text:document.body.innerText.slice(-300),resources:window.__crossfire?.renderResources?.()})).then(value=>{
  fs.writeFileSync(`${out}/${label}-loading.json`,JSON.stringify(value,null,2));
 }).catch(()=>{});},15000);
 try{await page.waitForFunction(()=>window.__crossfire?.ready(),{timeout:90000});}finally{clearInterval(diagnostic);}
 const cdp=await page.createCDPSession();await cdp.send('Emulation.setCPUThrottlingRate',{rate:slowdown});
 const samples=[];
 for(const [view,pose]of [['plaza',[-6,0,-3,110,0]],['lane',[-16,.72,-25,90,0]],['long',[-31,0,-29,90,0]]]){
  await page.evaluate(p=>window.__crossfire.teleport(...p),pose);
  await new Promise(r=>setTimeout(r,2500));
  const sample=await page.evaluate(()=>new Promise(resolve=>{
   const times=[];let last=performance.now();
   function frame(now){times.push(now-last);last=now;if(times.length<180)return requestAnimationFrame(frame);
    times.sort((a,b)=>a-b);resolve({stats:window.__crossfire.stats(),p50:times[90],p95:times[171],heapMb:performance.memory?.usedJSHeapSize/1048576,graphics:window.__crossfire.graphics()});}
   requestAnimationFrame(frame);
  }));
  samples.push({view,...sample});console.log(JSON.stringify({label,view,fps:sample.stats.fps,frameMs:sample.stats.frameMs,drawCalls:sample.stats.drawCalls,p95:sample.p95,heapMb:sample.heapMb}));
  await page.screenshot({path:`${out}/${label}-${view}.png`});
 }
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await new Promise(r=>setTimeout(r,5000));
 const {profile}=await cdp.send('Profiler.stop');
 fs.writeFileSync(`${out}/${label}.cpuprofile`,JSON.stringify(profile));
 const report={label,slowdown,samples,requests,errors};fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(report,null,2));
 if(errors.length)throw Error(errors.join('\n'));
}catch(error){
 await page?.screenshot({path:`${out}/${label}-failure.png`}).catch(()=>{});
 console.error(await page?.evaluate(()=>({text:document.body.innerText,resources:window.__crossfire?.renderResources?.()})).catch(()=>''));throw error;
}finally{await browser.close();}
