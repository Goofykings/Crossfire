/** Production UI directory fixtures (no fake socket/session), real local Practice,
 * and actual exported character/Industrial geometry. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
import {PROTOCOL_VERSION as v} from './protocol-version.mjs';
const out='test-results/discovery-slide-peek';fs.mkdirSync(out,{recursive:true});
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4200/crossfire/';
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,
 defaultViewport:{width:1280,height:800},args:['--use-angle=d3d11','--disable-background-timer-throttling']});
const checks=[],errors=[],images=[];let requests=0,reply='room',page,releaseInitial;
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
try{
 page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.evaluateOnNewDocument(()=>{window.__sockets=0;const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(...args){super(...args);window.__sockets++;}};});
 await page.setRequestInterception(true);
 page.on('request',async req=>{
  const url=new URL(req.url());
  if(url.pathname==='/rooms'&&req.method()==='GET'){
   requests++;const state=reply;
   if(requests===1)await new Promise(resolve=>{releaseInitial=resolve;}); // Explicit gate: never race a slow browser.
   await req.respond({status:state==='offline'?503:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(state==='offline'?{error:'Directory temporarily offline'}:{v,rooms:state==='empty'?[]:[{id:'12345678-1234-4123-8123-123456789abc',name:'Directory UI fixture',privacy:'public',mapId:'industrial-complex',mode:'ffa',maxPlayers:6,players:0,hostId:null,warningAt:null,closesAt:null}]})});
  }else if(url.origin!==new URL(base).origin&&url.protocol.startsWith('http'))await req.respond({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{"error":"Offline QA"}'});
  else await req.continue();
 });
 await page.goto(base+'?quality=low&shadows=off&scale=.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Peek QA');
 const visible=id=>page.waitForSelector(id+'.visible',{timeout:180000});
 const click=(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!b)throw Error(text);b.click();},{root,text});
 await page.click('#menu .home-actions .primary');await visible('#modes');
 check(await page.$eval('#modes .room-status',n=>n.dataset.state==='loading'&&!n.textContent.includes('None')),'opening Mode Select immediately shows loading');
 assert.ok(releaseInitial);releaseInitial();
 await page.waitForSelector('#modes .room-row');check(requests===1,'public rooms appear after one automatic discovery GET');
 reply='empty';await page.click('#modes .room-refresh');await page.waitForFunction(()=>document.querySelector('#modes .room-status').dataset.state==='empty');
 check(await page.$eval('#modes .room-status',n=>n.textContent==='No public servers available'),'manual Refresh reports a successful empty list');
 check(requests===2,'manual refresh performs exactly one additional request');
 reply='offline';await page.click('#modes .room-refresh');await page.waitForFunction(()=>document.querySelector('#modes .room-status').dataset.state==='error');
 check(requests===5,'transient discovery failure stops after three attempts');
 check(await page.$eval('#modes .room-status',n=>n.textContent.includes('Connection error:')),'unreachable directory has a separate error state');
 check(await page.evaluate(()=>window.__sockets===0),'discovery creates no gameplay WebSocket or duplicate join');
 await page.screenshot({path:out+'/directory-error.png'});await click('#modes','BACK');await visible('#menu');
 await page.waitForFunction(()=>window.__crossfire.homeCharacter().ready,{timeout:120000});
 for(const weapon of ['rifle','shotgun','sniper','smg'])for(const lean of [-1,1])for(const ads of [0,1]){
  const result=await page.evaluate(({weapon,lean,ads})=>window.__crossfire.characterLab({weapon,lean,ads,advance:.6,camera:{heading:25,pitch:4,distance:2.8,height:1}}),{weapon,lean,ads});
  const path=`${out}/character-${weapon}-${lean}-${ads}.png`;fs.writeFileSync(path,Buffer.from(result.image.split(',')[1],'base64'));images.push({name:`${weapon} lean ${lean} ADS ${ads}`,path});
 }
 await page.evaluate(()=>window.__crossfire.characterLab(null));
 reply='empty';await page.click('#menu .home-actions .primary');await visible('#modes');await click('#modes','PRACTICE');await visible('#practice-setup');
 await page.click('#practice-setup [data-map="industrial-complex"]');await page.$eval('#practice-setup input[type=range]',n=>{n.value='0';n.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('#practice-setup','START PRACTICE');await visible('#weapons');await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});
 await page.evaluate(()=>{window.__crossfire.teleport(0,0,6,0);window.__crossfire.setSetting({fov:90});});
 for(const side of ['leanLeft','leanRight'])for(const ads of [false,true]){
  await page.evaluate(({side,ads})=>{window.__crossfire.hold('aim',ads);window.__crossfire.hold(side,true);},{side,ads});
  await page.waitForFunction(({side,ads})=>Math.abs(window.__crossfire.motion().lean)>.95&&Math.abs(window.__crossfire.weapon().view.transform.roll)>.17&&(!ads||window.__crossfire.weapon().ads===1),{},{side,ads});
  const state=await page.evaluate(()=>({view:window.__crossfire.leanView(),weapon:window.__crossfire.weapon()}));
  check(Math.abs(2*Math.atan2(state.view.rotation[2],state.view.rotation[3]))<.07,`${side} camera stays below four degrees`);
  check(Math.abs(state.weapon.view.transform.roll)>.17,`${side} weapon cant is prominent (ADS ${ads})`);
  const path=`${out}/fp-${side}-${ads}.png`;await page.screenshot({path});images.push({name:`${side} ADS ${ads}`,path});
  await page.evaluate(side=>{window.__crossfire.hold(side,false);window.__crossfire.hold('aim',false);},side);
  await page.waitForFunction(()=>Math.abs(window.__crossfire.motion().lean)<.01);
 }
 for(const [x,z] of [[2,2],[-18,15]]){
  await page.evaluate(({x,z})=>window.__crossfire.freeCam(x+2,1.5,z+4.5,-25,-5),{x,z});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const path=`${out}/passage-${x}-${z}.png`;await page.screenshot({path});images.push({name:`Industrial passage ${x},${z}`,path});
 }
 check(errors.length===0,'no browser exceptions');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,requests},null,2));
 const sheet=await browser.newPage();await sheet.setViewport({width:1440,height:Math.ceil(images.length/4)*300});
 await sheet.setContent(`<body style="margin:0;background:#20242b;color:white;font:13px sans-serif;display:grid;grid-template-columns:repeat(4,360px)">${images.map(p=>`<figure style="margin:0"><img style="display:block;width:360px;height:275px;object-fit:contain" src="data:image/png;base64,${fs.readFileSync(p.path).toString('base64')}"><figcaption>${p.name}</figcaption></figure>`).join('')}</body>`);
 await sheet.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await sheet.screenshot({path:out+'/contact-sheet.png'});
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
