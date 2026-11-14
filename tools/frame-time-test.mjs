/** Local actual WebGL workload. CPU throttling is not Chromebook hardware emulation.
 * node tools/frame-time-test.mjs [url] [label] [map] [cpu-rate] [scenario seconds]
 * Output and profiles are ignored. Uses no public multiplayer connection. */
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const [base='http://127.0.0.1:5173/',label='baseline',map='farmstead',rate='2',seconds='15',mode='targets']=process.argv.slice(2);
const out='test-results/frame-time';fs.mkdirSync(out,{recursive:true});
const report={label,map,rate:Number(rate),seconds:Number(seconds),scenarios:[],errors:[],limitations:['Desktop Chrome, not physical Chromebook hardware','Offline target Practice; six-player workload is a separate run']};
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',userDataDir:path.resolve('.cache/frame-browser-profile'),headless:true,pipe:true,timeout:120000,protocolTimeout:240000,
 defaultViewport:{width:1366,height:768},args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
let page;
try{
 console.log('Browser launched',label);
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('error',e=>report.errors.push('Renderer: '+String(e)));
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(u.protocol==='http:'&&u.hostname!=='127.0.0.1'&&u.hostname!=='localhost')void r.abort();else if(u.protocol==='https:')void r.abort();else void r.continue();});
 await page.evaluateOnNewDocument(chromebook=>localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:chromebook,graphicsQuality:'low',shadowQuality:'off',resolutionScale:.5,adaptiveResolution:false,masterVolume:0})),mode!=='low');
 await page.goto(mode==='bots'?`${base}?perf=1`:`${base}?practice&autoplay&perf=1&map=${map}`,{waitUntil:'domcontentloaded',timeout:180000});
 console.log('Document loaded',label);
 await completeGuestProfile(page,'Frame Test');console.log('Profile ready',label,map);
 if(mode==='bots'){
  const click=async(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!b)throw Error('Missing '+text);b.click();},{root,text});
  await page.click('#menu .home-actions .primary');await page.waitForSelector('#modes.visible');await click('#modes','PRACTICE');await page.waitForSelector('#practice-setup.visible');
  await page.click(`#practice-setup [data-map="${map}"]`);await page.click('#practice-setup [data-difficulty="beginner"]');
  await page.$eval('#practice-setup input[type=range]',n=>{n.value='5';n.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('#practice-setup','START PRACTICE');await page.waitForSelector('#weapons.visible',{timeout:120000});await page.click('#weapons [data-weapon="rifle"]');
  report.limitations=['Desktop Chrome, not physical Chromebook hardware','Six-player local Practice: five real AI bots, not six online browser clients'];
 }
 await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady,{timeout:240000});
 if(process.argv.includes('--probe'))await page.evaluate(()=>{
  const scene=window.__crossfire.renderScene();if(!scene)throw Error('Probe needs isolated --scene build');
  const probe=window.__materialProbe={counts:{},stacks:[]};
  const wrap=(object,key,label)=>{const original=object[key];if(typeof original!=='function')return;object[key]=function(...args){const name=label+':'+key;probe.counts[name]=(probe.counts[name]??0)+1;if(probe.stacks.length<10)probe.stacks.push({name,stack:new Error().stack});return original.apply(this,args);};};
  wrap(scene,'markAllMaterialsAsDirty','scene');
  for(const m of scene.meshes)for(const key of ['_markSubMeshesAsLightDirty','_markSubMeshesAsAttributesDirty','_resyncLightSources'])wrap(m,key,m.name);
  for(const m of scene.materials)for(const key of ['markAsDirty','_markAllSubMeshesAsLightsDirty','_markAllSubMeshesAsTexturesDirty','_markAllSubMeshesAsMiscDirty'])wrap(m,key,m.name);
 });
 const cdp=await page.createCDPSession();await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(rate)});
 await delay(3000);
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 for(const scenario of ['idle','rotation','movement','combat']){
  if(mode!=='bots')await page.evaluate(({map,mode})=>{const g=window.__crossfire;g.hold('fire',false);g.hold('forward',false);g.teleport(...(mode==='foliage'?[-31,0,-30,110,0]:map==='farmstead'?[0,0,12,0,0]:[7,0,-5,90,0]));},{map,mode});
  await delay(1000);
  await page.evaluate(()=>window.__crossfire.resetPerformance());
  const sample=await page.evaluate(({scenario,seconds,mode})=>new Promise(resolve=>{
   const g=window.__crossfire,start=performance.now(),heaps=[],renders=[],timings=[];let next=0,last=start,nextRespawn=0,over50=0,over100=0,over250=0;
   g.hold('forward',scenario==='movement');g.hold('fire',scenario==='combat');
   function frame(now){const elapsed=now-start;
    const ms=now-last;last=now;timings.push(ms);if(ms>50)over50++;if(ms>100)over100++;if(ms>250)over250++;
    // Actual deaths reset the game's per-life sampler. Keep an independent RAF
    // interval and use the real respawn UI so later phases still exercise play.
    if(mode==='bots'&&elapsed>=nextRespawn){nextRespawn=elapsed+250;document.querySelector('#spectate.visible .respawn-button:not(:disabled)')?.click();document.querySelector('#weapons.visible [data-weapon="rifle"]')?.click();}
    if(g.ready()){g.hold('forward',scenario==='movement');g.hold('fire',scenario==='combat');}
    if(scenario==='rotation'||scenario==='combat')g.look(elapsed*.04,Math.sin(elapsed*.001)*8);
    if(elapsed>=next){next+=1000;renders.push(g.performance());heaps.push(performance.memory?.usedJSHeapSize??null);}
    if(elapsed<seconds*1000){requestAnimationFrame(frame);return;}
    g.hold('fire',false);g.hold('forward',false);
    const sorted=[...timings].sort((a,b)=>a-b),at=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0,tail=sorted.slice(Math.floor(sorted.length*.99));
    resolve({timing:{count:timings.length,elapsed,fps:timings.length*1000/elapsed,p50:at(.5),p95:at(.95),p99:at(.99),low1Fps:1000/(tail.reduce((n,v)=>n+v,0)/tail.length),over50,over100,over250},frames:g.performance(),stats:g.stats(),state:g.state(),players:g.network().rendered.length,graphics:g.graphics().resolution,heaps,renders});
   }requestAnimationFrame(frame);
  }),{scenario,seconds:Number(seconds),mode});
  report.scenarios.push({scenario,...sample});console.log(scenario,JSON.stringify(sample.frames));
 }
 const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync(`${out}/${label}-${map}.cpuprofile`,JSON.stringify(profile));
 if(process.argv.includes('--probe'))report.materialProbe=await page.evaluate(()=>window.__materialProbe);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 await page.screenshot({path:`${out}/${label}-${map}.png`});
 if(report.errors.length)throw Error(report.errors.join('\n'));
}catch(e){report.failure=String(e);report.loading=await page?.evaluate(()=>window.__crossfire?.loadingState()).catch(()=>null);throw e;}
finally{
 // Bound cleanup of this script's own browser; preserve every workload error.
 // Some Windows drivers leave Chrome alive after Browser.close was requested.
 const closing=browser.close().then(()=>true,()=>false);
 let timer;const closed=await Promise.race([closing,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),15000);})]);clearTimeout(timer);
 if(!closed){
  report.cleanupForced=true;const owned=browser.process();
  if(owned){try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{stdio:'ignore'});else owned.kill('SIGKILL');}catch{}
   for(const stream of owned.stdio)stream?.destroy();owned.unref();}
  browser.disconnect();console.warn('Closed only the owned benchmark browser after cleanup timeout');
 }
 fs.writeFileSync(`${out}/${label}-${map}.json`,JSON.stringify(report,null,2));
}
