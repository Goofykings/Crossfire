/** Deterministic VFX fixture, not a multiplayer or performance benchmark. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const out='test-results/explosion-renders';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
  timeout:120000,protocolTimeout:180000,defaultViewport:{width:960,height:640},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11']});
try{
  const page=await browser.newPage(),errors=[],samples=[];
  page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE ERROR',String(e));});
  page.on('requestfailed',r=>console.error('REQUEST FAILED',r.url(),r.failure()?.errorText));
  console.log('Opening render fixture');
  await page.goto(process.argv[2]??'http://127.0.0.1:4201/',{waitUntil:'domcontentloaded',timeout:180000});
  console.log('Fixture document loaded');
  await page.waitForFunction(()=>window.lab,{timeout:180000});
  console.log('Fixture assets ready');
  for(const reduced of [false,true])for(const age of [0,40,120,250,450,1500,5500,7000]){
    const sample=await page.evaluate((age,reduced)=>window.lab.frame(age,reduced),age,reduced);
    samples.push({age,reduced,sample});console.log('Rendered',age,reduced);
    assert.ok(sample.particles<=128);assert.ok(sample.ground.rocks<=48);assert.ok(sample.ground.marks<=24);assert.ok(sample.burst.active.length<=4);
    if(age===120){assert.ok(sample.burst.active[0].fire>0);assert.equal(sample.burst.visibleFire,reduced?4:8);assert.equal(sample.burst.visibleGlow,reduced?6:12);}
    if(age===450)assert.equal(sample.burst.active[0].fire,0);
    if(age===1500)assert.equal(sample.clouds[0].opacity,1);
    if(age===7000){assert.equal(sample.clouds.length,0);assert.equal(sample.ground.marks,0,'expired history must not recreate an effect');}
    await page.screenshot({path:`${out}/${reduced?'reduced':'normal'}-${age}.png`});
  }
  const persisted=await page.evaluate(()=>window.lab.persistedMark());
  assert.equal(persisted.ground.marks,1,'a previously created surface mark persists after smoke');
  assert.equal(persisted.clouds.length,0);assert.equal(persisted.particles,0);await page.screenshot({path:`${out}/persistent-mark.png`});
  assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify({samples,errors},null,2));
  console.log('PASS 17 deterministic Babylon renders, bounded pools, fire/smoke timing, normal/reduced modes');
}finally{await browser.close();}
