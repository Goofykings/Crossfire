/** Production Pages-path map rendering + real controller traversal of both stair ends. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { setTimeout as delay } from 'node:timers/promises';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const at=process.argv.indexOf('--url'), base=at<0?'http://127.0.0.1:4198/crossfire/':process.argv[at+1];
const out='test-results/compact-browser';fs.mkdirSync(out,{recursive:true});
const selected=process.argv.indexOf('--map');
const maps=selected<0?['european-town','industrial-complex','modern-city']:[process.argv[selected+1]];
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
  for(const id of maps) {
    const layout=JSON.parse(fs.readFileSync(`src/maps/${id}/layout.json`,'utf8'));
    await page.evaluate(m=>window.__crossfire.play(m),id);
    await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
    const stats=await page.evaluate(()=>window.__crossfire.stats());
    check(stats.mapId===id&&!stats.missingMaterials.length,`${id}: map loads with all PBR materials`);
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
    const flank=layout.ground.covered.find(r=>r.id===({
      'european-town':'market_room','industrial-complex':'goods_office','modern-city':'diner_service'
    })[id]);
    assert.ok(flank,`${id}: flank interior exists`);
    for(const reverse of [false,true]) for(const mode of ['walk','slide','jump']) {
      const [x0,z0,x1,z1]=flank.rect,z=(z0+z1)/2;
      const start=reverse?x1+.8:x0-.8,end=reverse?x0-.8:x1+.8;
      await page.evaluate((x,z,h)=>window.__crossfire.teleport(x,0,z,h,0),start,z,reverse?270:90);
      await delay(120);
      await page.evaluate(()=>window.__crossfire.hold('forward',true));
      await delay(120);
      if(mode!=='walk')await page.evaluate(a=>window.__crossfire.hold(a,true),mode);
      await delay(80);
      if(mode==='jump')await page.evaluate(()=>window.__crossfire.hold('jump',false));
      let last,progress=0;const deadline=Date.now()+12000;
      try {
        while(Date.now()<deadline) {
          await delay(50);last=await page.evaluate(()=>window.__crossfire.player());
          progress=(last.x-start)*(reverse?-1:1);
          if(progress>=Math.abs(end-start)-.15)break;
        }
      } finally {await page.evaluate(()=>{window.__crossfire.hold('forward',false);window.__crossfire.hold('slide',false);window.__crossfire.hold('jump',false);});}
      check(progress>=Math.abs(end-start)-.25&&last.y>=-.01,
        `${id}: ${mode} through flank interior ${reverse?'westbound':'eastbound'}`);
      results.push({id,mode,reverse,progress,last});
    }
    await page.evaluate(()=>window.__crossfire.setSetting({graphicsQuality:'high',shadowQuality:'high',resolutionScale:1}));
    // Shoot from a verified street/stair approach, rather than placing a
    // generic diagonal camera inside a neighbouring building.
    const r=layout.upperRoutes[0].rect,x=(r[0]+r[2])/2;
    const view=id==='european-town'?[x,1.85,r[3]+4,0,8]:[x,1.85,r[1]-4,180,8];
    await page.evaluate(p=>window.__crossfire.freeCam(...p),view);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
    await delay(1500);await page.screenshot({path:`${out}/${id}-gallery.png`});
    const [fx0,fz0,fx1,fz1]=flank.rect;
    await page.evaluate((x,z)=>window.__crossfire.freeCam(x,1.7,z,90,2),fx0-.6,(fz0+fz1)/2);
    await delay(1000);await page.screenshot({path:`${out}/${id}-flank.png`});
    const propView={
      'european-town':[[16.2,1.7,-12.4],[16.5,.65,-15]],
      'industrial-complex':[[12,1.65,-11],[14,.8,-12.5]],
      'modern-city':[[14.3,1.7,-10.3],[14.4,.55,-7.8]],
    }[id];
    const [from,to]=propView,dx=to[0]-from[0],dz=to[2]-from[2];
    await page.evaluate((p,h,v)=>window.__crossfire.freeCam(...p,h,v),from,
      Math.atan2(dx,-dz)*180/Math.PI,Math.atan2(to[1]-from[1],Math.hypot(dx,dz))*180/Math.PI);
    await delay(1000);await page.screenshot({path:`${out}/${id}-prop.png`});
    await page.evaluate(()=>window.__crossfire.freeCam(34,40,40,320,-37));
    await delay(1200);await page.screenshot({path:`${out}/${id}-overhead.png`});
    await page.evaluate(()=>window.__crossfire.setSetting({graphicsQuality:'low',shadowQuality:'off',resolutionScale:.5}));
  }
  const settings=await page.evaluate(()=>window.__crossfire.settings());
  check(settings.fov===101&&settings.mouseSensitivity===1.35,`settings survive ${maps.length} map loads and quality changes`);
  check(errors.length===0,`no missing asset responses or browser exceptions (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));
} finally {await browser.close();}
