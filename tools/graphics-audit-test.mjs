/** Actual local map rendering in all current presets. No multiplayer replies or
 * public requests. Run against a built frontend, e.g. http://127.0.0.1:4236/. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {execFileSync} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4236/',out='test-results/graphics-audit';fs.mkdirSync(out,{recursive:true});
const report={rows:[],errors:[],limitations:['Actual desktop Chrome WebGL; not physical Chromebook hardware','Map/weapon readiness and sampled screenshots do not prove every surface or animation frame correct']};let browser,page;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',userDataDir:path.resolve('.cache/graphics-audit-profile'),headless:true,pipe:true,protocolTimeout:180000,defaultViewport:{width:1366,height:768},args:['--use-angle=d3d11','--disable-background-timer-throttling']});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|framebuffer/i.test(m.text()))report.errors.push(m.text());});
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname))void r.abort();else void r.continue();});
 page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))report.errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(()=>localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true,adaptiveResolution:false,shadowQuality:'off',resolutionScale:.5,masterVolume:0})));
 await page.goto(base+'?practice&autoplay&perf=1&map=european-town',{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Graphics audit');
 await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady,{timeout:240000});
 for(const map of ['european-town','industrial-complex','modern-city','farmstead']){
  await page.evaluate(map=>window.__crossfire.loadMap(map),map);
  const poses={'european-town':[-2.5,0,2.5,45,-8],'industrial-complex':[7,0,-5,90,0],'modern-city':[0,0,4,0,4],farmstead:[0,0,12,0,0]};
  await page.evaluate(pose=>window.__crossfire.teleport(...pose),poses[map]);
  for(const preset of ['chromebook','low','medium','high','ultra']){
   await page.evaluate(p=>window.__crossfire.setSetting({chromebookMode:p==='chromebook',graphicsQuality:p==='chromebook'?'low':p}),preset);
   await page.waitForFunction(p=>{const g=window.__crossfire,q=g.graphics();return g.loadingState().sceneReady&&(p==='chromebook'||q.reflectionReady&&q.reflectionSize===(p==='ultra'?512:256));},{timeout:120000},preset);
   // Exercise the normal ADS path, not a forced visual-only pose.
   await page.evaluate(()=>window.__crossfire.hold('aim',true));await page.waitForFunction(()=>window.__crossfire.weapon().ads>.7,{timeout:10000});
   const ads=await page.evaluate(()=>window.__crossfire.weapon().ads);assert.ok(ads>.7,map+' '+preset+' ADS');
   await page.evaluate(()=>{window.__crossfire.hold('aim',false);window.__crossfire.resetPerformance();});await delay(1200);
   const row=await page.evaluate(()=>{const g=window.__crossfire,q=g.graphics();return{map:g.stats().mapId,graphics:{quality:q.quality,chromebook:q.chromebook,reflectionSize:q.reflectionSize,reflectionReady:q.reflectionReady},stats:g.stats(),performance:g.performance(),weapon:g.weapon(),unready:g.renderResources().unready};});row.adsReached=ads;
   row.weapons=[];
   // Target Practice legitimately allows the five-slot loadout. Exercise actual
   // holster/equip/ADS updates, including both scopes, without bypassing online
   // server-selected loadouts or forcing animation transforms.
   for(const [slot,id]of ['rifle','shotgun','sniper','smg','semi-sniper'].entries()){
    await page.evaluate(slot=>window.__crossfire.selectWeapon(slot),slot);
    await page.waitForFunction(id=>{const w=window.__crossfire.weapon();return w.id===id&&w.action==='idle'&&w.view?.shown===id&&w.viewMeshes.length>0;},{timeout:30000},id);
    await page.evaluate(()=>window.__crossfire.hold('aim',true));await page.waitForFunction(()=>window.__crossfire.weapon().ads>.7,{timeout:10000});
    row.weapons.push(await page.evaluate(()=>{const w=window.__crossfire.weapon();return{id:w.id,ads:w.ads,meshes:w.viewMeshes.length,scope:w.scope};}));
    await page.evaluate(()=>window.__crossfire.hold('aim',false));
   }
   await page.evaluate(()=>window.__crossfire.selectWeapon(0));await page.waitForFunction(()=>{const w=window.__crossfire.weapon();return w.id==='rifle'&&w.action==='idle'&&w.view?.shown==='rifle'&&w.ads<.05;},{timeout:30000});
   // Practice inspect can contain detailed bot paths; this audit is the target
   // range, and only needs the explicit renderer measurements.
   delete row.performance.network;
   assert.equal(row.map,map);assert.deepEqual(row.stats.missingMaterials,[]);assert.ok(row.weapon.viewMeshes.length>0);assert.deepEqual(row.unready,[]);
   report.rows.push({preset,...row});await page.screenshot({path:`${out}/${map}-${preset}.png`});console.log('PASS map/preset',map,preset,row.stats.drawCalls);
  }
 }
 // Warm every map first, then revisit the same map/preset twice. Persistent
 // catalog/template caches are intentional; scene-owned objects must plateau.
 report.mapCycles=[];const warmed=new Map();
 await page.evaluate(()=>window.__crossfire.setSetting({chromebookMode:true,graphicsQuality:'low'}));
 for(let cycle=0;cycle<3;cycle++)for(const map of ['european-town','industrial-complex','modern-city','farmstead']){
  await page.evaluate(map=>window.__crossfire.loadMap(map),map);await page.waitForFunction(()=>window.__crossfire.loadingState().sceneReady,{timeout:120000});await delay(400);
  const memory=await page.evaluate(()=>window.__crossfire.memory());report.mapCycles.push({cycle,map,memory});
  if(cycle===0)warmed.set(map,memory);else for(const key of ['meshes','skeletons','animationGroups','geometries','transformNodes'])assert.equal(memory[key],warmed.get(map)[key],map+' no accumulated '+key);
 }
 assert.deepEqual(report.errors,[]);
}catch(e){report.failure=String(e);report.failureState=await page?.evaluate(()=>({state:window.__crossfire?.state(),weapon:window.__crossfire?.weapon(),loading:window.__crossfire?.loadingState(),graphics:window.__crossfire?.graphics()})).catch(()=>null);throw e;}
finally{
 if(browser){let timer;const closed=await Promise.race([browser.close().then(()=>true,()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),15000);})]);clearTimeout(timer);
  if(!closed){report.cleanupForced=true;const owned=browser.process();if(owned){try{execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{stdio:'ignore'});}catch{}for(const s of owned.stdio)s?.destroy();owned.unref();}browser.disconnect();}}
 fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
}
