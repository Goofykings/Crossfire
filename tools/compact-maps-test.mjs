/** Production Pages-path map rendering + real controller traversal of both stair ends. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { setTimeout as delay } from 'node:timers/promises';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const at=process.argv.indexOf('--url'), base=at<0?'http://127.0.0.1:4198/crossfire/':process.argv[at+1];
const out='test-results/compact-browser';fs.mkdirSync(out,{recursive:true});
const errors=[], results=[];
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser=await puppeteer.launch({executablePath,headless:true,pipe:true,protocolTimeout:240000,
  defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling']});
const page=await browser.newPage();
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
const check=(ok,msg)=>{assert.ok(ok,msg);console.log(`PASS ${msg}`);};
try {
  await page.goto(`${base}?practice&autoplay&quality=low&shadows=off&scale=.5`,{waitUntil:'domcontentloaded',timeout:240000});
  await completeGuestProfile(page,'Compact Map Tester');
  await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
  await page.evaluate(()=>window.__crossfire.setSetting({fov:101,mouseSensitivity:1.35}));
  for(const id of ['european-town','industrial-complex','modern-city']) {
    const layout=JSON.parse(fs.readFileSync(`src/maps/${id}/layout.json`,'utf8'));
    await page.evaluate(m=>window.__crossfire.play(m),id);
    await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
    const stats=await page.evaluate(()=>window.__crossfire.stats());
    check(stats.mapId===id&&!stats.missingMaterials.length,`${id}: production map loads with all PBR materials`);
    const route=layout.navigation.upperRoutes[0];
    for(const reverse of [false,true]) {
      const points=reverse?[...route.waypoints].reverse():route.waypoints;
      const start=points[0],end=points.at(-1),dx=end[0]-start[0],dz=end[2]-start[2],len=Math.hypot(dx,dz);
      const heading=Math.atan2(dx,-dz)*180/Math.PI;
      await page.evaluate((p,h)=>window.__crossfire.teleport(...p,h,0),start,heading);
      await delay(250);
      await page.evaluate(()=>window.__crossfire.hold('forward',true));
      let high=0,last,progress=0;
      const deadline=Date.now()+16000;
      try {
        while(Date.now()<deadline) {
          await delay(80);last=await page.evaluate(()=>window.__crossfire.player());
          high=Math.max(high,last.y);progress=((last.x-start[0])*dx+(last.z-start[2])*dz)/len;
          if(progress>=len-.2)break;
        }
      } finally {await page.evaluate(()=>window.__crossfire.hold('forward',false));}
      await delay(400);
      const landed=await page.evaluate(()=>window.__crossfire.player());
      check(progress>=len-.3&&Math.abs(high-2.8)<.05&&landed.y<.3&&landed.grounded,
        `${id}: ${reverse?'reverse':'forward'} stairs → upper floor → ground (${progress.toFixed(1)}m, peak ${high.toFixed(2)}m)`);
      results.push({id,reverse,high,progress,landed});
    }
    await page.evaluate(()=>window.__crossfire.setSetting({graphicsQuality:'high',shadowQuality:'high',resolutionScale:1}));
    // Shoot from a verified street/stair approach, rather than placing a
    // generic diagonal camera inside a neighbouring building.
    const r=layout.upperRoutes[0].rect,x=(r[0]+r[2])/2;
    const view=id==='european-town'?[x,1.85,r[3]+4,0,8]:[x,1.85,r[1]-4,180,8];
    await page.evaluate(p=>window.__crossfire.freeCam(...p),view);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
    await delay(1500);await page.screenshot({path:`${out}/${id}-gallery.png`});
    await page.evaluate(()=>window.__crossfire.freeCam(34,40,40,320,-37));
    await delay(1200);await page.screenshot({path:`${out}/${id}-overhead.png`});
    await page.evaluate(()=>window.__crossfire.setSetting({graphicsQuality:'low',shadowQuality:'off',resolutionScale:.5}));
  }
  const settings=await page.evaluate(()=>window.__crossfire.settings());
  check(settings.fov===101&&settings.mouseSensitivity===1.35,'settings survive all three map loads and quality changes');
  check(errors.length===0,`no missing asset responses or browser exceptions (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));
} finally {await browser.close();}
