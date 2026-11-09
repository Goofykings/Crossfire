/** Real GPU captures for weapon framing and Chromebook surface regressions. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:5181/';
const out=process.argv[3]??'test-results/visual-polish';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
 timeout:120000,protocolTimeout:240000,defaultViewport:{width:1366,height:768},args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11']});
const errors=[],reports=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
 page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
 await page.evaluateOnNewDocument(()=>{
  localStorage.setItem('crossfire.settings.v1',JSON.stringify({graphicsQuality:'medium',shadowQuality:'low',resolutionScale:1}));
  const real=window.fetch;window.fetch=(input,init)=>new URL(String(input),location.href).origin!==location.origin?Promise.reject(Error('Offline test')):real(input,init);
 });
 await page.goto(base+'?practice&autoplay',{waitUntil:'domcontentloaded'});await completeGuestProfile(page,'Visual Review');
 await page.waitForFunction(()=>window.__crossfire?.ready(),{timeout:180000});
 assert.equal(await page.$$eval('#weapons .weapon-detail',nodes=>nodes.length),0,'all five selection cards omit descriptions');
 for(const chromebookMode of [false,true]){
  await page.evaluate(mode=>{window.__crossfire.setSetting({chromebookMode:mode});window.__crossfire.teleport(-6,0,-3,110,2);},chromebookMode);
  await page.waitForFunction(()=>window.__crossfire.renderResources().unready.length===0,{timeout:90000});
  await new Promise(r=>setTimeout(r,800));
  const slots=await page.evaluate(()=>window.__crossfire.weapon().slots);
  assert.equal(new Set(slots.map(s=>s.id)).size,5);
  for(let i=0;i<slots.length;i++){
   await page.evaluate(i=>window.__crossfire.selectWeapon(i),i);
   await page.waitForFunction(id=>{const w=window.__crossfire.weapon();return w.id===id&&w.action==='idle';},{timeout:15000},slots[i].id);
   await new Promise(r=>setTimeout(r,400));
   await page.screenshot({path:`${out}/${chromebookMode?'chromebook':'standard'}-${slots[i].id}.png`});
   assert.ok(await page.evaluate(()=>window.__crossfire.weapon().viewMeshes.length>=4),'complete gun components stay enabled');
   await page.evaluate(()=>window.__crossfire.hold('aim',true));
   await page.waitForFunction(()=>window.__crossfire.weapon().ads>.98,{timeout:10000});
   await new Promise(r=>setTimeout(r,150));
   await page.screenshot({path:`${out}/${chromebookMode?'chromebook':'standard'}-${slots[i].id}-ads.png`});
   await page.evaluate(()=>window.__crossfire.hold('aim',false));
   await page.waitForFunction(()=>window.__crossfire.weapon().ads<.02,{timeout:10000});
   await page.evaluate(()=>window.__crossfire.viewPose(window.__crossfire.weapon().id==='shotgun'?'shell':'reload',.35));await new Promise(r=>setTimeout(r,100));
   await page.screenshot({path:`${out}/${chromebookMode?'chromebook':'standard'}-${slots[i].id}-reload.png`});
   await page.evaluate(()=>window.__crossfire.viewPose(null));
   reports.push(await page.evaluate(()=>({weapon:window.__crossfire.weapon(),stats:window.__crossfire.stats(),graphics:window.__crossfire.graphics()})));
   console.log('CAPTURE',chromebookMode?'chromebook':'standard',slots[i].id);
  }
  await page.evaluate(()=>window.__crossfire.look(110,-32));await new Promise(r=>setTimeout(r,300));
  await page.screenshot({path:`${out}/${chromebookMode?'chromebook':'standard'}-floor.png`});
 }
 // Check narrow FOV and the optional SSAO/prepass paths after the quality switch.
 await page.evaluate(()=>{window.__crossfire.setSetting({chromebookMode:false});window.__crossfire.selectWeapon(2);window.__crossfire.look(110,2);});
 await page.waitForFunction(()=>window.__crossfire.weapon().id==='sniper'&&window.__crossfire.weapon().action==='idle');
 await page.evaluate(()=>window.__crossfire.hold('aim',true));
 await page.waitForFunction(()=>window.__crossfire.weapon().ads>.98);
 for(const quality of ['low','high','ultra']){
  await page.evaluate(quality=>window.__crossfire.setSetting({graphicsQuality:quality}),quality);
  await page.waitForFunction(()=>window.__crossfire.renderResources().unready.length===0,{timeout:90000});
  await new Promise(r=>setTimeout(r,500));
  const patch=await page.screenshot({clip:{x:623,y:324,width:120,height:120}});
  const visible=await page.evaluate(async data=>{
   const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),img=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
   const c=document.createElement('canvas');c.width=c.height=120;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);img.close();
   const p=ctx.getImageData(0,0,120,120).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]+p[i+1]+p[i+2]>45)n++;
   return n/14400;
  },patch.toString('base64'));
  assert.ok(visible>.7,'usable scope center on '+quality);
  await page.screenshot({path:`${out}/sniper-scope-${quality}.png`});console.log('PASS scope',quality);
 }
 await page.evaluate(()=>window.__crossfire.hold('aim',false));
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/report.json`,JSON.stringify({errors,reports},null,2));
}finally{await browser.close();}
