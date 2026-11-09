/** Actual maps, settings restoration, real practice bots and effect lifecycle. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:5173/',out='test-results/chromebook-gameplay';fs.mkdirSync(out,{recursive:true});
const executablePath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
const browser=await puppeteer.launch({executablePath,headless:true,pipe:true,timeout:120000,protocolTimeout:180000,defaultViewport:{width:1366,height:768,deviceScaleFactor:2},args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11']});
const errors=[],checks=[],reports=[];let page;
const check=(ok,message)=>{assert.ok(ok,message);checks.push(message);console.log('PASS '+message);};
try{
 page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(()=>{
  localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true,graphicsQuality:'medium',shadowQuality:'low',resolutionScale:.75}));
  const real=window.fetch;window.fetch=(input,init)=>new URL(String(input),location.href).origin!==location.origin?Promise.reject(Error('Offline test')):real(input,init);
 });
 await page.goto(base,{waitUntil:'domcontentloaded'});await completeGuestProfile(page,'Chromebook Test');
 const clickText=(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(n=>n.textContent.trim().toUpperCase()===text);if(!b)throw Error('Missing '+text);b.click();},{root,text});
 for(const map of ['european-town','industrial-complex','modern-city','farmstead']){
  await page.click('#menu .home-actions .primary');await page.waitForSelector('#modes.visible');await clickText('#modes','PRACTICE');await page.waitForSelector('#practice-setup.visible');
  await page.click(`#practice-setup [data-map="${map}"]`);
  await page.$eval('#practice-setup input[type=range]',n=>{n.value='5';n.dispatchEvent(new Event('input',{bubbles:true}));});
  await clickText('#practice-setup','START PRACTICE');await page.waitForSelector('#weapons.visible',{timeout:90000});await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:90000});
  await page.waitForFunction(()=>window.__crossfire.network().rendered.length===5,{timeout:30000});
  const state=await page.evaluate(()=>({stats:window.__crossfire.stats(),graphics:window.__crossfire.graphics(),resources:window.__crossfire.renderResources(),outline:window.__crossfire.silhouetteStats()}));reports.push({map,...state});
  check(state.stats.mapId===map&&state.stats.missingMaterials.length===0,map+': actual map and five bot avatars load');
  check(state.graphics.resolution.width<=1280&&state.graphics.resolution.height<=720,map+': high-DPI render budget is bounded');
  check(state.graphics.reflectionSize===0&&state.graphics.materials.every(m=>!m.normal&&!m.orm),map+': unused reflection/detail maps disabled');
  await page.screenshot({path:`${out}/${map}.png`});
  if(map==='european-town'){
   await page.evaluate(()=>window.__crossfire.pause());
   await page.evaluate(()=>window.__crossfire.setSetting({chromebookMode:false}));
   await page.waitForFunction(()=>{const g=window.__crossfire.graphics();return g.reflectionReady&&g.materials.some(m=>m.normal)&&window.__crossfire.renderResources().unready.length===0;},{timeout:60000});
   check(await page.evaluate(()=>{const s=window.__crossfire.settings();return s.graphicsQuality==='medium'&&s.shadowQuality==='low'&&s.resolutionScale===.75;}),'disabling Chromebook restores saved preferences and full materials');
   await page.evaluate(()=>window.__crossfire.setSetting({chromebookMode:true}));
   await page.waitForFunction(()=>window.__crossfire.graphics().reflectionSize===0&&window.__crossfire.renderResources().unready.length===0,{timeout:60000});
   check(true,'live toggle back to Chromebook settles without missing textures');
  }
  await page.evaluate(()=>window.__crossfire.networkLeave());await page.waitForSelector('#menu.visible');
 }
 check(errors.length===0,'no browser runtime errors');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,reports},null,2));
}catch(error){const state=await page?.evaluate(()=>({text:document.body.innerText,resources:window.__crossfire?.renderResources?.()})).catch(()=>null);fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,state},null,2));console.error(JSON.stringify(state)?.slice(0,4500));throw error;}
finally{await browser.close();}
