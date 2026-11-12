import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import path from 'node:path';
import {build} from 'vite';
await build({configFile:false,publicDir:false,base:'/',build:{outDir:'test-results/health-skin-lab-build',emptyOutDir:true,rolldownOptions:{input:'tools/health-skin-lab.html'}}});
const server=createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;for(const root of ['test-results/health-skin-lab-build','public']){const base=path.resolve(root),file=path.resolve(base,'.'+pathname);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())continue;res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'application/octet-stream');fs.createReadStream(file).pipe(res);return;}res.writeHead(404);res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const out='test-results/health-skins-browser';fs.mkdirSync(out,{recursive:true});const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:45000,defaultViewport:{width:1200,height:800},args:['--use-angle=d3d11']});const errors=[],reports=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(`http://127.0.0.1:${server.address().port}/tools/health-skin-lab.html`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__healthSkinReview,{timeout:120000});
 assert.equal(await page.evaluate(()=>window.__healthSkinReview.resultReward(128)),'+128 GEMS EARNED');
 assert.match(await page.evaluate(()=>window.__healthSkinReview.resultReward(128,true)),/NO MATCH GEMS/);
 for(const quality of ['low','medium','high','ultra','chromebook']){
  await page.evaluate(q=>window.__healthSkinReview.quality(q),quality);
  await page.evaluate(()=>window.__healthSkinReview.health(100));const full=await page.evaluate(()=>window.__healthSkinReview.pixels());
  const stats=await page.evaluate(()=>window.__healthSkinReview.health(1)),low=await page.evaluate(()=>window.__healthSkinReview.pixels());
  for(let i=0;i<3;i++){const chroma=p=>Math.max(...p.slice(0,3))-Math.min(...p.slice(0,3));assert.ok(chroma(full[i])>80,JSON.stringify({quality,full}));assert.ok(chroma(low[i])<25,JSON.stringify({quality,low}));}
  assert.equal(stats.passes,1);assert.ok(stats.saturation<.051);
  assert.deepEqual(await page.evaluate(()=>['hud','zone'].map(id=>getComputedStyle(document.getElementById(id)).color)),['rgb(22, 137, 255)','rgb(255, 48, 48)']);
  await page.screenshot({path:out+'/'+quality+'-1hp.png'});
  await page.evaluate(()=>window.__healthSkinReview.outlines(false));
  const colorOnly=await page.evaluate(()=>window.__healthSkinReview.health(1));assert.equal(colorOnly.enabled,false);assert.equal(colorOnly.passes,1);
  assert.deepEqual(await page.evaluate(()=>window.__healthSkinReview.pixels()),low);
  await page.evaluate(()=>window.__healthSkinReview.outlines(true));
  await page.evaluate(()=>window.__healthSkinReview.health(100));const healed=await page.evaluate(()=>window.__healthSkinReview.pixels());assert.deepEqual(healed,full);
  const reset=await page.evaluate(()=>window.__healthSkinReview.health(100,false));assert.equal(reset.saturation,1);reports.push({quality,full,low,healed,stats});
 }
 await page.evaluate(()=>window.__healthSkinReview.quality('low'));
 for(const [weapon,id]of [['rifle','hydro-nebula-rifle'],['smg','frosted-smg'],['sniper','darkness-sniper'],['shotgun','blossom-shotgun'],['semi-sniper','carbon-fiber-semi-sniper']]){
  const first=await page.evaluate(([w,id])=>window.__healthSkinReview.skin(id,w),[weapon,id]);
  for(let life=0;life<3;life++){
   await page.evaluate(w=>window.__healthSkinReview.skin('default-'+w,w),weapon);
   const restored=await page.evaluate(([w,id])=>window.__healthSkinReview.skin(id,w),[weapon,id]);assert.deepEqual(restored,first);
  }
  await page.screenshot({path:out+'/'+weapon+'-restored.png'});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({reports,errors},null,2));console.log('PASS scene desaturation and HUD colors in all 5 presets; 5 actual weapon variants survive 3 cached restore cycles each; zero browser errors.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
