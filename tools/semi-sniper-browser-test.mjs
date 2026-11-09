import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4200/crossfire/',out='test-results/semi-sniper/game';fs.mkdirSync(out,{recursive:true});
const size=fs.statSync('public/assets/audio/semi_sniper_shot.wav').size,checks=[],errors=[],poses=[];
const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--use-angle=d3d11','--disable-background-timer-throttling','--autoplay-policy=no-user-gesture-required']});
let a,b;
try{
 const page=async name=>{const context=await browser.createBrowserContext(),p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
  await p.evaluateOnNewDocument(size=>{window.__shots=[];window.__semiStarts=0;const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(...args){super(...args);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='shot')window.__shots.push(m.shot);});}};
   const known=new WeakSet(),decode=AudioContext.prototype.decodeAudioData,start=AudioBufferSourceNode.prototype.start;
   AudioContext.prototype.decodeAudioData=function(data,...args){const matches=data.byteLength===size;const result=decode.call(this,data,...args);if(matches&&result?.then)result.then(buffer=>known.add(buffer));return result;};
   AudioBufferSourceNode.prototype.start=function(...args){if(known.has(this.buffer))window.__semiStarts++;return start.apply(this,args);};
  },size);
  await p.goto(base+'?quality=low&shadows=off&scale=.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(p,name);return p;};
 const shown=(p,id)=>p.waitForSelector(id+'.visible',{timeout:180000}),click=(p,root,text)=>p.evaluate(({root,text})=>{const button=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!button)throw Error(text);button.click();},{root,text});
 const roomName='Semi QA '+Date.now();
 a=await page('Marksman QA');await a.click('#menu .home-actions .primary');await shown(a,'#modes');
 await click(a,'#modes','CREATE SERVER');await shown(a,'#create-room');await a.$eval('#create-room .room-name',(n,name)=>{n.value=name;},roomName);await click(a,'#create-room','CREATE');await shown(a,'#weapons');
 check(await a.$$eval('#weapons .weapon-card',n=>n.length===5),'real loadout offers five firearms');
 await a.waitForFunction(()=>{const i=document.querySelector('#weapons [data-weapon="semi-sniper"] img');return i?.complete&&i.naturalWidth>0;},{timeout:180000});
 check(await a.$eval('#weapons [data-weapon="semi-sniper"]',n=>n.textContent.includes('15 rounds')&&n.textContent.includes('Medium–Long')),'new card has its real thumbnail, capacity and range');await a.screenshot({path:out+'/selection.png'});
 await a.click('#weapons [data-weapon="semi-sniper"]');await a.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});check(await a.evaluate(()=>window.__crossfire.weapon().ammo===15),'authoritative spawn starts with 15 rounds');
 b=await page('Remote QA');await b.click('#menu .home-actions .primary');await shown(b,'#modes');await b.waitForSelector('#modes .room-row');await b.evaluate(name=>[...document.querySelectorAll('#modes .room-row')].find(n=>n.firstElementChild.textContent===name).click(),roomName);await shown(b,'#weapons');await b.click('#weapons [data-weapon="rifle"]');await b.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});
 const id=await a.evaluate(()=>window.__crossfire.network().selfId);
 await b.waitForFunction(id=>window.__crossfire.network().rendered.some(p=>p.id===id&&p.weapon?.id==='semi-sniper'),{timeout:180000},id);
 check(true,'second browser loads the actual fifth remote weapon');
 for(const fov of [70,90,110]){
  const target=2*Math.atan(Math.tan(fov*.8*Math.PI/360)/1.5)*180/Math.PI;
  await a.evaluate(fov=>{window.__crossfire.setSetting({fov});window.__crossfire.hold('aim',true);},fov);
  await a.waitForFunction(target=>window.__crossfire.weapon().ads===1&&Math.abs(window.__crossfire.live().fovDeg-target)<.12,{},target);
  check(await a.evaluate(()=>window.__crossfire.weapon().scope===0&&window.__crossfire.weapon().view.shown==='semi-sniper'&&window.__crossfire.weapon().viewMeshes.some(n=>n.includes('semi_sniper'))),`FOV ${fov}: correct optical zoom, visible weapon and no sniper overlay`);
  await a.screenshot({path:`${out}/ads-${fov}.png`});
 }
 await a.evaluate(()=>{window.__crossfire.hold('aim',false);window.__peak=0;const until=performance.now()+2000;const sample=()=>{window.__peak=Math.max(window.__peak,window.__crossfire.weapon().view?.motion.recoil??0);if(performance.now()<until)requestAnimationFrame(sample);};sample();window.__crossfire.hold('fire',true);});
 await a.waitForFunction(()=>window.__crossfire.weapon().ammo===14);
 const start=await a.evaluate(()=>window.__crossfire.network().snapshot.serverTime);
 await a.waitForFunction(start=>window.__crossfire.network().snapshot.serverTime>=start+650,{},start);
 check(await a.evaluate(()=>window.__crossfire.weapon().ammo===14&&window.__peak>.01),'held input fires once with visible recoil');
 await b.waitForFunction(id=>window.__shots.some(s=>s.shooterId===id&&s.weapon==='semi-sniper'),{},id);
 await b.waitForFunction(()=>window.__semiStarts>0);check(true,'remote browser receives the shot and starts the distinct spatial WAV');
 await a.evaluate(()=>window.__crossfire.hold('fire',false));await a.waitForFunction(()=>window.__crossfire.network().snapshot.players.find(p=>p.id===window.__crossfire.network().selfId).combat.triggerHeld===false);
 await a.evaluate(()=>window.__crossfire.hold('fire',true));await a.waitForFunction(()=>window.__crossfire.weapon().ammo===13);await a.evaluate(()=>{window.__crossfire.hold('fire',false);window.__crossfire.hold('reload',true);});
 await a.waitForFunction(()=>window.__crossfire.weapon().action==='reload');await a.screenshot({path:out+'/reload.png'});await a.evaluate(()=>window.__crossfire.hold('reload',false));
 await a.waitForFunction(()=>window.__crossfire.weapon().ammo===15&&window.__crossfire.weapon().action==='idle');check(true,'partial reload returns to a full 15-round magazine');
 await a.evaluate(()=>window.__crossfire.networkLeave());await shown(a,'#menu');await a.waitForFunction(()=>window.__crossfire.homeCharacter().weapon?.id==='semi-sniper',{timeout:180000});check(true,'home character remembers the actual last-used gun');
 for(const ads of [0,1])for(const lean of [-1,0,1]){
  const result=await a.evaluate(({ads,lean})=>window.__crossfire.characterLab({weapon:'semi-sniper',ads,lean,advance:.7,camera:{heading:25,pitch:4,distance:2.8,height:1}}),{ads,lean});
  for(const hand of result.state.weapon.hands)check(hand.gap<.015,`real grip contact: ADS ${ads}, lean ${lean}`);
  const path=`${out}/pose-${ads}-${lean}.png`;fs.writeFileSync(path,Buffer.from(result.image.split(',')[1],'base64'));poses.push({name:`ADS ${ads}, lean ${lean}`,path});
 }
 await a.evaluate(()=>window.__crossfire.characterLab(null));
 await click(a,'.home-nav','LOCKER');
 await shown(a,'#locker');await a.waitForFunction(()=>window.__crossfire.cosmetics().view?.owned.includes('default-semi-sniper'),{timeout:180000});await a.click('#locker [data-category="sniper"]');
 await a.waitForSelector('#locker [data-cosmetic="default-semi-sniper"]');check(await a.$$eval('#locker .cosmetic-card',n=>n.length===2),'real server-owned default appears with the original Sniper in its Locker filter');await a.screenshot({path:out+'/locker.png'});
 await a.click('#locker .cosmetic-card[data-cosmetic="default-semi-sniper"]');await shown(a,'#cosmetic-preview');await a.waitForFunction(()=>window.__crossfire.cosmetics().page.preview.active,{timeout:180000});await a.screenshot({path:out+'/locker-model.png'});
 check(errors.length===0,'no browser exceptions or missing static assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,poses},null,2));
}catch(error){if(a)await a.screenshot({path:out+'/failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
