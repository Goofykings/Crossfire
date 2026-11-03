/** Local Chrome comparison of actual maps/materials, live switching and bounded resources.
 * Build, serve dist under /crossfire/, then pass that URL as the first argument. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { setTimeout as delay } from 'node:timers/promises';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/';
const out='test-results/ultra-graphics';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],comparisons=[];
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log(`PASS ${label}`);};
const until=async(fn,label,ms=120000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(100);}throw new Error(`Timeout: ${label}`);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
  timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},
  args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const page=await browser.newPage();
page.on('dialog',async dialog=>{
  if(dialog.type()==='beforeunload')await dialog.accept();
  else { errors.push(`Unexpected ${dialog.type()}: ${dialog.message()}`);await dialog.dismiss(); }
});
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|framebuffer/i.test(m.text()))errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()}: ${r.url()}`);});
const graphics=()=>page.evaluate(()=>window.__crossfire.graphics());
const setQuality=async quality=>{
  await page.evaluate(quality=>window.__crossfire.setSetting({graphicsQuality:quality}),quality);
  await until(async()=>{const g=await graphics();return g.reflectionReady&&g.reflectionSize===(quality==='ultra'?512:256)
    &&await page.evaluate(()=>window.__crossfire.loadingState().sceneReady);},`${quality} reflection prefilter and shaders`);
  await delay(1300);
};
const performance=async()=>{
  const samples=[];for(let i=0;i<12;i++){samples.push(await page.evaluate(()=>window.__crossfire.stats()));await delay(170);}
  const median=key=>samples.map(x=>x[key]).sort((a,b)=>a-b)[Math.floor(samples.length/2)];
  return {fps:median('fps'),frameMs:median('frameMs'),drawCalls:median('drawCalls'),textures:await page.evaluate(()=>window.__crossfire.sceneTextureIds().length)};
};
try {
  await page.goto(`${base}?practice&autoplay&quality=high&shadows=medium&scale=.8`,{waitUntil:'domcontentloaded',timeout:240000});
  await completeGuestProfile(page,'Ultra Inspector');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
  for(const [map,views] of [
    ['european-town', [{name:'plaza-stone-wood',position:[-2.5,0,2.5,45,-8]}, {name:'interior',position:[6.5,0,-13.5,90,0]}]],
    ['industrial-complex',[{name:'painted-metal-props',position:[0,0,5,0,0]}, {name:'galvanized-equipment',position:[12,0,-10,90,0]}]],
    ['modern-city',[{name:'glass-stone',position:[0,0,4,0,4]}, {name:'street-paint',position:[22,0,12,0,0]}]],
  ]) {
    if((await page.evaluate(()=>window.__crossfire.stats())).mapId!==map)await page.evaluate(map=>window.__crossfire.loadMap(map),map);
    for(const quality of ['high','ultra']) {
      await setQuality(quality);
      for(const view of views) {
        await page.evaluate(position=>window.__crossfire.teleport(...position),view.position);await delay(400);
        await page.screenshot({path:`${out}/${map}-${view.name}-${quality}.png`});
      }
      const g=await graphics(),perf=await performance();comparisons.push({map,quality,perf,graphics:g});
      check(g.reflectionSize===(quality==='ultra'?512:256),`${map} ${quality}: actual cube dimensions`);
      check((await page.evaluate(()=>window.__crossfire.stats())).missingMaterials.length===0,`${map} ${quality}: all material assignments resolve`);
      check(g.materials.filter(m=>m.orm).every(m=>m.roughnessFromAlpha===(quality!=='ultra')),`${map} ${quality}: intended roughness channel`);
    }
    const high=comparisons.at(-2),ultra=comparisons.at(-1);
    check(high.graphics.exposure===ultra.graphics.exposure&&high.graphics.environmentIntensity===ultra.graphics.environmentIntensity,
      `${map}: no exposure or ambient boost`);
    for(const m of high.graphics.materials) {
      const u=ultra.graphics.materials.find(u=>u.name===m.name);assert.ok(u);
      assert.equal(u.albedo,m.albedo);assert.equal(u.normal,m.normal);assert.deepEqual(u.color,m.color);assert.equal(u.alpha,m.alpha);
    }
    check(true,`${map}: base colors, skins, normal maps and alpha preserved`);
    console.log(JSON.stringify({map,high:high.perf,ultra:ultra.perf}));
  }
  // Warm the two existing pipelines, then prove repeated switching stabilizes.
  await setQuality('low');await setQuality('ultra');
  const warmed={graphics:await graphics(),memory:await page.evaluate(()=>window.__crossfire.memory())};
  for(let i=0;i<3;i++){await setQuality('low');await setQuality('ultra');}
  const final={graphics:await graphics(),memory:await page.evaluate(()=>window.__crossfire.memory())};
  check(final.graphics.reflectionId===warmed.graphics.reflectionId,'Ultra cube cached across repeated switches');
  check(final.memory.textures<=warmed.memory.textures+2&&final.memory.materials===warmed.memory.materials
    &&final.memory.meshes===warmed.memory.meshes,'live switching keeps resource counts bounded');
  for(const slot of [0,1,2,3]) {
    await page.evaluate(slot=>window.__crossfire.selectWeapon(slot),slot);await delay(650);
    await page.screenshot({path:`${out}/weapon-${slot}-ultra.png`});
  }
  // Real input/rendering during movement, slide, aim and firing under Ultra.
  await page.keyboard.down('w');await page.keyboard.down('Shift');await page.keyboard.down('j');await page.keyboard.down('k');
  await delay(1300);for(const key of ['w','Shift','j','k'])await page.keyboard.up(key);
  check(await page.evaluate(()=>window.__crossfire.ready()),'Ultra remains playable during slide, ADS and firing');
  // Test the actual Settings dropdown and persisted selection across a refresh.
  await page.evaluate(()=>window.__crossfire.pause());await page.click('#pause .menu-buttons .btn:nth-child(2)');await page.click('#tab-graphics');
  await page.click('#set-graphicsQuality');
  check(await page.$eval('[role="option"][data-value="ultra"]',e=>e.textContent==='Ultra'),'Ultra available in Settings');
  console.log('Selecting Ultra in the Settings dropdown');
  await page.click('[role="option"][data-value="ultra"]');await page.click('.settings-foot .primary');
  console.log('Reloading with saved graphics setting');
  await page.goto(`${base}?practice&autoplay&map=modern-city&shadows=medium&scale=.8`,{waitUntil:'domcontentloaded',timeout:240000});
  await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.graphics().reflectionSize===512,{timeout:240000});
  check((await graphics()).quality==='ultra','Ultra survives browser refresh without query override');
  // Dispose a map with a pending high-resolution prefilter; callbacks must not
  // switch the next map back to a stale texture or crash its render loop.
  await setQuality('high');await page.evaluate(()=>window.__crossfire.loadMap('industrial-complex'));
  await page.evaluate(()=>{window.__crossfire.setSetting({graphicsQuality:'ultra'});return window.__crossfire.loadMap('european-town');});
  await until(async()=>{const g=await graphics();return g.reflectionSize===512&&g.reflectionReady;},'map replacement during prefilter');
  check((await page.evaluate(()=>window.__crossfire.stats())).mapId==='european-town','pending IBL work cannot corrupt map replacement');
  check(errors.length===0,`no shader, asset or browser errors: ${errors.join('; ')}`);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors,comparisons,warmed,final},null,2));
} catch(error) {
  await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  const state=await page.evaluate(()=>({screen:document.body.dataset.screen,settings:window.__crossfire?.settings(),
    loading:window.__crossfire?.loadingState(),graphics:window.__crossfire?.graphics(),error:document.querySelector('#error')?.textContent})).catch(()=>null);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors,comparisons,failure:String(error),state},null,2));throw error;
} finally { await browser.close(); }
