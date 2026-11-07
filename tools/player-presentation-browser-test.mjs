/** Real production assets and offline Practice; no synthetic multiplayer connection. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4200/crossfire/';
const out='test-results/player-presentation';fs.mkdirSync(out,{recursive:true});
const errors=[],checks=[],pictures=[];
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
 timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--use-angle=d3d11','--disable-background-timer-throttling']});
let page;
try{
 page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.goto(base+'?quality=low&shadows=off&scale=.5',{waitUntil:'domcontentloaded',timeout:240000});
 await completeGuestProfile(page,'Presentation QA');
 await page.waitForFunction(()=>window.__crossfire.homeCharacter().ready,{timeout:120000});
 const shot=async name=>{const path=`${out}/${name}.png`;await page.screenshot({path});pictures.push({name,path});};
 for(const weapon of ['rifle','shotgun','sniper','smg']){
  const result=await page.evaluate(weapon=>window.__crossfire.characterLab({weapon,advance:.5,camera:{heading:25,pitch:5,distance:2.8,height:1}}),weapon);
  assert.ok(result?.image);const path=`${out}/character-${weapon}.png`;fs.writeFileSync(path,Buffer.from(result.image.split(',')[1],'base64'));pictures.push({name:`character ${weapon}`,path});
 }
 for(const [clip,time] of [['attack_cross',.1],['attack_forward',.1],['attack_finisher',.23]]){
  const result=await page.evaluate(({clip,time})=>window.__crossfire.characterLab({weapon:'rifle',melee:{clip,time},advance:.05,camera:{heading:25,pitch:5,distance:2.8,height:1}}),{clip,time});
  const path=`${out}/character-${clip}.png`;fs.writeFileSync(path,Buffer.from(result.image.split(',')[1],'base64'));pictures.push({name:clip,path});
 }
 await page.evaluate(()=>window.__crossfire.characterLab(null));
 const visible=id=>page.waitForSelector(id+'.visible',{timeout:180000});
 const click=(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!b)throw Error(text);b.click();},{root,text});
 await page.click('#menu .home-actions .primary');await visible('#modes');await click('#modes','PRACTICE');await visible('#practice-setup');
 await page.click('#practice-setup [data-mode="teams"]');
 await page.$eval('#practice-setup input[type=range]',e=>{e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('#practice-setup','START PRACTICE');await visible('#weapons');await page.click('#weapons [data-weapon="rifle"]');
 await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});
 await page.waitForFunction(()=>document.querySelectorAll('.remote-player-label').length===2);
 const bars=await page.$$eval('.remote-player-label',labels=>labels.map(label=>{const bar=label.querySelector('.remote-player-health'),fill=bar.firstElementChild;return {relation:label.dataset.relationship,color:getComputedStyle(label).color,fill:getComputedStyle(fill).backgroundColor,height:parseFloat(getComputedStyle(bar).height),radius:getComputedStyle(bar).borderRadius,health:Number(label.dataset.health),max:Number(label.dataset.maxHealth),transform:getComputedStyle(fill).transform};}));
 check(bars.some(b=>b.relation==='teammate')&&bars.some(b=>b.relation==='opponent'),'real Practice teams supply friendly and enemy nametags');
 check(bars.every(b=>b.fill===b.color&&b.height===4.5&&parseFloat(b.radius)>0),'health bars inherit the correct red/blue label color, are 50 percent taller and rounded');
 await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');
 // Zero bots for repeatable, undisturbed FOV / ADS / action screenshots.
 await page.click('#menu .home-actions .primary');await visible('#modes');await click('#modes','PRACTICE');await visible('#practice-setup');
 await page.$eval('#practice-setup input[type=range]',e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('#practice-setup','START PRACTICE');await visible('#weapons');await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});
 const settle=()=>page.evaluate(()=>new Promise(r=>{let n=0;const step=()=>++n>24?r():requestAnimationFrame(step);step();}));
 const startWeapon=async weapon=>{
  await page.click('#menu .home-actions .primary');await visible('#modes');await click('#modes','PRACTICE');await visible('#practice-setup');
  await click('#practice-setup','START PRACTICE');await visible('#weapons');await page.click(`#weapons [data-weapon="${weapon}"]`);await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});
 };
 for(const weapon of ['rifle','shotgun','sniper','smg']){
  if(weapon!=='rifle')await startWeapon(weapon);
  await page.evaluate(()=>window.__crossfire.viewPose('idle',0,0));
  for(const fov of [70,90,110]){
   await page.evaluate(fov=>window.__crossfire.setSetting({fov}),fov);await settle();
   check(Math.abs(await page.evaluate(()=>window.__crossfire.live().fovDeg)-fov)<.2,`${weapon} world FOV ${fov}`);
   await shot(`${weapon}-fov-${fov}`);
  }
  await page.evaluate(()=>window.__crossfire.viewPose('idle',0,1));await settle();await shot(`${weapon}-ads`);
  await page.evaluate(()=>{window.__crossfire.holdFlash(true);window.__crossfire.viewPose('reload',.5,0);});await settle();await shot(`${weapon}-reload`);
  await page.evaluate(()=>{window.__crossfire.holdFlash(false);window.__crossfire.viewPose(null);});
  await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');
 }
 await startWeapon('sniper');
 await page.evaluate(()=>window.__crossfire.hold('aim',true));await page.waitForFunction(()=>window.__crossfire.weapon().scope===1);
 await page.waitForFunction(()=>Math.abs(window.__crossfire.live().fovDeg-window.__crossfire.settings().fov*.22/.82)<.2);
 check(await page.evaluate(()=>window.__crossfire.live().fovDeg<35),'real sniper scope still magnifies the world');await shot('sniper-scoped');
 await page.evaluate(()=>window.__crossfire.hold('aim',false));await page.waitForFunction(()=>window.__crossfire.weapon().scope===0);
 await page.evaluate(()=>{window.__crossfire.melee('pause');window.__crossfire.melee('equip');for(let i=0;i<40;i++)window.__crossfire.melee('step',1/30);});
 for(const fov of [70,90,110]){await page.evaluate(fov=>window.__crossfire.setSetting({fov}),fov);await settle();await shot(`daggers-fov-${fov}`);}
 check(await page.evaluate(()=>window.__crossfire.meleeInspect().fit.every(h=>h.wristBend<34)),'first-person dagger wrists retain their natural grip');
 check(errors.length===0,'no browser exceptions or missing assets');
 fs.writeFileSync(out+'/report.json',JSON.stringify({checks,bars,errors},null,2));
 const sheet=await browser.newPage();await sheet.setViewport({width:1440,height:Math.ceil(pictures.length/4)*250});
 await sheet.setContent(`<body style="margin:0;background:#20242b;color:white;font:13px sans-serif;display:grid;grid-template-columns:repeat(4,360px)">${pictures.map(p=>`<figure style="margin:0"><img style="display:block;width:360px;height:225px;object-fit:contain" src="data:image/png;base64,${fs.readFileSync(p.path).toString('base64')}"><figcaption>${p.name}</figcaption></figure>`).join('')}</body>`);
 await sheet.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await sheet.screenshot({path:out+'/contact-sheet.png'});
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
