/** Real production renderer/input checks. Multiplayer uses the separate workerd browser suite. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {setTimeout as delay} from 'node:timers/promises';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const out='test-results/major-quality';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],shots=[];
const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('PASS',label);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
  timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling']});
const page=await browser.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
const hold=(a,v)=>page.evaluate((a,v)=>window.__crossfire.hold(a,v),a,v);
async function capture(name){await page.screenshot({path:`${out}/${name}.png`});shots.push(name);}
async function centerPixels(){
  const png=await page.screenshot({clip:{x:580,y:300,width:120,height:120}});
  return page.evaluate(async data=>{
    const img=new Image();img.src=`data:image/png;base64,${data}`;await img.decode();
    const c=document.createElement('canvas');c.width=c.height=120;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const p=ctx.getImageData(0,0,120,120).data;let usable=0;for(let i=0;i<p.length;i+=4)if(p[i]+p[i+1]+p[i+2]>45)usable++;
    return usable/(120*120);
  },png.toString('base64'));
}
try{
  await page.goto(`${process.argv[2]??'http://127.0.0.1:4200/crossfire/'}?practice&autoplay&quality=medium&shadows=low&scale=.8`,{waitUntil:'domcontentloaded',timeout:240000});
  await completeGuestProfile(page,'Quality Inspector');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
  for(const [slot,id] of ['rifle','shotgun','sniper','smg'].entries()){
    await page.evaluate(slot=>{window.__crossfire.teleport(4,0,4,90,0);window.__crossfire.selectWeapon(slot);},slot);
    await page.waitForFunction(id=>{const w=window.__crossfire.weapon();return w.id===id&&w.action==='idle';},{timeout:15000},id);
    await delay(350);const w=await page.evaluate(()=>window.__crossfire.weapon());
    check(w.viewMeshes.filter(n=>!n.includes('flash')).length>=4,`${id}: component meshes enabled`);await capture(`${id}-hip`);
    await hold('crouch',true);await delay(250);await capture(`${id}-crouch`);await hold('crouch',false);
    await hold('aim',true);await delay(700);await capture(`${id}-ads`);
    if(id==='sniper')for(const quality of ['low','medium','high','ultra']){
      await page.evaluate(quality=>window.__crossfire.setSetting({graphicsQuality:quality}),quality);await delay(700);
      check(await centerPixels()>.7,`sniper: usable nonblack center on ${quality}`);
      await capture(`sniper-${quality}`);
    }
    await hold('aim',false);await delay(500);await hold('fire',true);await delay(100);await hold('fire',false);await capture(`${id}-recoil`);
  }
  await page.evaluate(()=>{window.__crossfire.setSetting({graphicsQuality:'medium'});window.__crossfire.teleport(4,0,4,90,0);});
  await hold('forward',true);await delay(180);await hold('slide',true);await delay(160);
  check(await page.$eval('.slide-lines',e=>e.classList.contains('active')),'slide lines activate');
  const positions=await page.evaluate(()=>{
    const e=document.querySelector('.slide-lines i'),a=e.getAnimations()[0];a.pause();a.currentTime=120;const first=e.getBoundingClientRect();
    a.currentTime=400;const last=e.getBoundingClientRect();a.play();return [Math.hypot(first.x-640,first.y-360),Math.hypot(last.x-640,last.y-360)];
  });check(positions[1]>positions[0]+50,'streaks travel outward from the middle band');await capture('sliding');
  await hold('jump',true);await delay(40);await hold('jump',false);await hold('slide',false);await hold('forward',false);
  await delay(240);check(await page.$eval('.slide-lines',e=>getComputedStyle(e).opacity==='0'),'jump cancellation fades the lines completely');
  check(await page.$$eval('svg [id]',nodes=>{const ids=nodes.map(n=>n.id);return ids.length===new Set(ids).size;}),'scope definitions have unique IDs');
  check(await page.$eval('.damage-arrow',e=>parseFloat(getComputedStyle(e).fontSize)>=68),'direction arrow is larger');
  check(errors.length===0,'no browser or asset errors');fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors,shots},null,2));
}catch(e){await capture('failure').catch(()=>{});fs.writeFileSync(`${out}/failure.json`,JSON.stringify({error:String(e),checks,errors},null,2));throw e;}
finally{await browser.close();}
