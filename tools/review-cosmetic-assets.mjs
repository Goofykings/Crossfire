/** Real Babylon game rigs in an isolated development page. Never grants/equips a live account. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const base=process.argv.find(a=>/^https?:/.test(a))??'http://127.0.0.1:4201/';
const out='test-results/cosmetic-collection/browser';fs.mkdirSync(out,{recursive:true});const results=[],errors=[];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1000,height:700},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11']});
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto(new URL('tools/cosmetic-asset-lab.html',base).href,{waitUntil:'domcontentloaded',timeout:240000});await page.waitForFunction(()=>window.__cosmeticLab,{timeout:240000});
 const items=await page.evaluate(()=>window.__cosmeticLab.items);
 for(const id of [...items,'foundry-crate']){
  const contexts=id==='foundry-crate'?['locker','front']:['locker','side','front','fp','ads','reload','recoil','walk','third','third-side','third-ads'];
  for(const context of contexts){
   const {image,...data}=await page.evaluate(async({id,context})=>window.__cosmeticLab.capture(id,context),{id,context});
   assert.equal(data.engineCount,1,'Only one isolated review renderer');
   if(context.startsWith('third')){assert.equal(data.inspect.cosmeticId,id);for(const hand of data.inspect.hands)assert.ok(hand.gap<.01,id+' '+context+' actual hand contact');}
   fs.writeFileSync(`${out}/${id}-${context}.png`,Buffer.from(image.split(',')[1],'base64'));results.push({id,context,...data});console.log('PASS '+id+' '+context);
  }
  if(id!=='foundry-crate'){
   const {image,...data}=await page.evaluate(id=>window.__cosmeticLab.capture(id,'locker',true),id);fs.writeFileSync(`${out}/${id}-low.png`,Buffer.from(image.split(',')[1],'base64'));results.push({id,context:'low',...data});console.log('PASS '+id+' low reflections off');
  }
 }
 // Baseline views distinguish existing view-model framing from cosmetic regressions.
 for(const weapon of ['rifle','smg','shotgun','sniper'])for(const context of ['fp','ads']){
  const id='default-'+weapon,{image,...data}=await page.evaluate(({id,context})=>window.__cosmeticLab.capture(id,context),{id,context});
  fs.writeFileSync(`${out}/${id}-${context}.png`,Buffer.from(image.split(',')[1],'base64'));results.push({id,context,...data});console.log('PASS baseline '+id+' '+context);
 }
 assert.deepEqual(errors,[],'No missing assets, shaders or page errors');
 fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors},null,2));console.log('COMPLETE '+results.length+' actual asset/rig renders');
}catch(error){fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),errors,results},null,2));throw error;}
finally{await browser.close();}
