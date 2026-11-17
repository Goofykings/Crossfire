/** Actual local shotgun inspection: node tools/shotgun-ads-shots.mjs http://127.0.0.1:4260/ */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4260/',out='test-results/shotgun-ads';
fs.mkdirSync(out,{recursive:true});
const report={frames:[],errors:[],limitations:['Desktop Chrome WebGL; not physical Chromebook hardware or live multiplayer.']};
let browser;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,protocolTimeout:180000,defaultViewport:{width:1280,height:720},args:['--use-angle=d3d11']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL/i.test(m.text()))report.errors.push(m.text());});
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname))void r.abort();else void r.continue();});
 await page.evaluateOnNewDocument(()=>localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true,adaptiveResolution:false,resolutionScale:1,masterVolume:0})));
 await page.goto(base+'?practice&autoplay&map=european-town',{waitUntil:'domcontentloaded',timeout:180000});
 await completeGuestProfile(page,'Shotgun audit');
 await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady,{timeout:300000});
 const cf=(fn,...args)=>page.evaluate((fn,args)=>window.__crossfire[fn](...args),fn,args);
 await cf('selectWeapon',1);
 await page.waitForFunction(()=>{const w=window.__crossfire.weapon();return w.id==='shotgun'&&w.action==='idle'&&w.view?.shown==='shotgun';},{timeout:30000});
 await cf('teleport',-2.5,0,2.5,45,0);
 const shot=async name=>{await page.screenshot({path:`${out}/${name}.png`});const w=await cf('weapon');report.frames.push({name,id:w.id,ads:w.ads,ammo:w.ammo,action:w.action,view:w.view});console.log('FRAME',name,w.action,w.ads);};
 await shot('hip');await cf('hold','aim',true);
 await page.waitForFunction(()=>window.__crossfire.weapon().ads>.999,{timeout:10000});
 for(const [width,height]of [[1280,720],[1024,768],[1680,720]]){
  await page.setViewport({width,height});
  for(const fov of [70,90,110]){
   await cf('setSetting',{fov});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await shot(`chromebook-${width}x${height}-fov${fov}`);
  }
 }
 await page.setViewport({width:1280,height:720});await cf('setSetting',{fov:90,chromebookMode:false,graphicsQuality:'high'});
 await page.waitForFunction(()=>window.__crossfire.graphics().reflectionReady,{timeout:120000});await shot('high-ads');
 const ammo=(await cf('weapon')).ammo;await cf('hold','fire',true);
 await page.waitForFunction(n=>window.__crossfire.weapon().ammo===n-1,{},ammo);
 await cf('hold','fire',false);await shot('ads-fire');
 await page.waitForFunction(()=>window.__crossfire.weapon().action==='idle',{timeout:10000});
 await cf('hold','aim',false);await page.waitForFunction(()=>window.__crossfire.weapon().ads<.001);
 await cf('hold','reload',true);await page.waitForFunction(()=>window.__crossfire.weapon().action.startsWith('shell'),{timeout:10000});
 await cf('hold','reload',false);await shot('reload');
 await page.waitForFunction(()=>{const w=window.__crossfire.weapon();return w.ammo===w.magazine&&w.action==='idle';},{timeout:15000});
 await shot('hip-after-reload');await cf('hold','aim',true);
 await page.waitForFunction(()=>window.__crossfire.weapon().ads>.999);await shot('ads-after-reload');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=String(e);throw e;}finally{
 fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
 if(browser){let timer;const closed=await Promise.race([browser.close().then(()=>true,()=>false),new Promise(r=>timer=setTimeout(()=>r(false),15000))]);clearTimeout(timer);
  if(!closed){const owned=browser.process();if(owned){try{execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{stdio:'ignore'});}catch{}for(const s of owned.stdio)s?.destroy();owned.unref();}browser.disconnect();}}
}
