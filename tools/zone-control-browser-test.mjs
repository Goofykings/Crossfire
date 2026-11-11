/** Production bundle at a Pages-style base path, genuine local Worker/clients.
 * Test RPC places real spawned bodies; capture/score/messages remain production. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {preview,createServer} from 'vite';
import {harness,until,self,origin} from '../server/tests/room-harness.mjs';
import {ZONE_MAPS} from '../shared/zoneControl.ts';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const out='test-results/zone-control',base='http://127.0.0.1:4201/crossfire/';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];let cleanup,browser,server,page;
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('PASS '+label);};
const h=await harness({after:f=>cleanup=f},{ALLOWED_ORIGINS:origin+','+new URL(base).origin,ROOM_SOLO_MS:'300000',AFK_KICK_MS:'180000',AFK_WARN_MS:'120000'});
try{
 const dev=process.argv.includes('--dev');
 server=dev?await createServer({configFile:false,base:'/crossfire/',server:{host:'127.0.0.1',port:4201,strictPort:true,hmr:false,ws:false,watch:null}}):await preview({configFile:false,base:'/crossfire/',preview:{host:'127.0.0.1',port:4201,strictPort:true}});if(dev)await server.listen();
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--use-angle=d3d11','--disable-background-timer-throttling','--autoplay-policy=no-user-gesture-required']});
 const shown=(id)=>page.waitForSelector(id+'.visible',{timeout:180000});
 const view=(pose,target=null)=>page.evaluate(async({p,target})=>{
  window.__crossfire.freeCam(...p);
  const s=window.__crossfire.renderScene();
  if(s&&target){
   const camera=s.activeCamera,goal=camera.position.clone().set(target[0],target[1]+.1,target[2]);
   const clear=(eye,end)=>{const ray=camera.getForwardRay(100),delta=end.subtract(eye);ray.origin.copyFrom(eye);ray.direction.copyFrom(delta.normalizeToNew());ray.length=delta.length()-.12;return !s.pickWithRay(ray,m=>m.isVisible&&!m.name.startsWith('zone:')&&m.renderingGroupId===0)?.hit;};
   let found=false;
   for(const d of [4,3,2.5]){for(let i=0;i<8;i++){
    const a=i*Math.PI/4,eye=goal.clone().set(target[0]+Math.sin(a)*d,target[1]+2.8,target[2]+Math.cos(a)*d);
    if([[0,0],[-1.8,-1.8],[1.8,-1.8],[1.8,1.8],[-1.8,1.8]].every(([x,z])=>clear(eye,goal.clone().addInPlaceFromFloats(x,0,z)))){camera.position.copyFrom(eye);found=true;break;}
   }if(found)break;}
   if(!found)camera.position.set(target[0],target[1]+9,target[2]+.01);
   camera.setTarget(goal);
  }
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 },{p:pose,target});
 const click=(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text);if(!b)throw Error('Missing '+text);b.click();},{root,text});
 for(const [map,zones]of Object.entries(ZONE_MAPS)){
  if(zones.length!==3)continue;
  const context=await browser.createBrowserContext();page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
  await page.evaluateOnNewDocument(server=>{
   const realFetch=window.fetch,WS=window.WebSocket;
   window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);return realFetch(url.origin!==location.origin||['/rooms','/rooms/join','/profile','/presence','/stats','/leaderboard','/cosmetics','/inventory'].some(p=>url.pathname===p||url.pathname.startsWith(p+'/'))?new URL(url.pathname+url.search,server):input,init);};
   window.WebSocket=class extends WS{constructor(url,...args){const original=new URL(url),local=new URL(original.pathname,server);local.protocol='ws:';super(original.pathname==='/ws'||original.pathname.startsWith('/ws/rooms/')?local:url,...args);}};
  },h.base);
  await page.goto(base+'?quality=low&shadows=off&scale=.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Zone Reviewer');
  await page.click('#menu .home-actions .primary');await shown('#modes');await click('#modes','CREATE SERVER');await shown('#create-room');await click('#create-room','ZONE CONTROL');
  const names={'european-town':'EUROPEAN TOWN','industrial-complex':'INDUSTRIAL COMPLEX','modern-city':'MODERN CITY',farmstead:'FARMSTEAD'};
  await click('#create-room',names[map]);
  check(await page.$$eval('#create-room .room-map',nodes=>nodes.filter(n=>getComputedStyle(n).display!=='none').length===3&&nodes.some(n=>n.textContent.includes('European Town')&&getComputedStyle(n).display==='none')),map+': unsuitable Town is excluded from objective map selection');
  check(await page.$eval('.room-mode-description',n=>n.textContent==='Capture and defend three zones to earn points for your team.'),map+': room description and selectable map');
  await page.screenshot({path:`${out}/${map}-setup.png`});await click('#create-room','CREATE');await shown('#weapons');await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:180000});
  const network=await page.evaluate(()=>window.__crossfire.network()),id=network.selfId,roomId=network.snapshot.room,room=h.room(roomId),home=Object.values(network.snapshot.players.find(p=>p.id===id).motion.position);
  if(dev)console.log('RENDERED GROUND',map,JSON.stringify(await page.evaluate(zones=>{const s=window.__crossfire.renderScene();return zones.map(d=>{const ray=s.activeCamera.getForwardRay(100);ray.origin.set(d.position[0],50,d.position[2]);ray.direction.set(0,-1,0);const p=s.pickWithRay(ray,m=>m.isVisible&&!m.name.startsWith('zone:')&&m.renderingGroupId===0);return {id:d.id,mesh:p?.pickedMesh?.name,point:p?.pickedPoint?.asArray()};});},zones)));
  check(network.snapshot.match.mode==='zone-control'&&network.snapshot.mapId===map,map+': actual approved objective match');
  const token=await h.profile(),peer=await h.open(await h.admission(token,{roomId}),token);await h.spawn(peer);
  check(peer.snapshot.zoneControl.zones.length===3,map+': independent real peer sees the same three objectives');
  await page.waitForSelector('.zone-hud .zone-marker');
  check(await page.$$eval('.zone-world .zone-marker',nodes=>nodes.length===3&&nodes.every(n=>!n.hidden&&n.getBoundingClientRect().left>=0)),map+': all world markers stay on screen');
  const overview=map==='farmstead'?[0,110,0,0,-89.9]:[0,80,0,0,-89.9];await view(overview);
  await page.screenshot({path:`${out}/${map}-overview.png`});
  for(const d of zones){const pose=await room.zoneViewForTest(d.position);await view(pose,d.position);await page.screenshot({path:`${out}/${map}-${d.id}-ground.png`});}
  if(map==='industrial-complex'){
   const allyToken=await h.profile(),ally=await h.open(await h.admission(allyToken,{roomId}),allyToken);await h.spawn(ally);const allyHome=Object.values(self(ally).motion.position);
   const p=zones[0].position;await room.placeManyForCombatTest([{id,pos:[p[0]-.5,p[1],p[2]]},{id:ally.id,pos:[p[0]+.5,p[1],p[2]]}]);
   await until(()=>peer.snapshot.zoneControl.zones[0].owner==='blue','browser two-player capture');
   await page.waitForFunction(()=>document.querySelector('.zone-hud [data-zone="A"]')?.dataset.owner==='blue');
   check(await page.$eval('.match-hud',n=>n.textContent.includes('ZONE CONTROL')&&n.textContent.includes('BLUE')&&n.textContent.includes('RED')),'timer displays actual team identities and objective scores');
   await room.placeManyForCombatTest([{id,pos:home},{id:ally.id,pos:allyHome},{id:peer.id,pos:p}]);
   await until(()=>peer.snapshot.zoneControl.zones[0].capturing==='red'&&peer.snapshot.zoneControl.zones[0].progress>=.35,'real red takeover');
   await room.placeForCombatTest(id,[p[0]-.5,p[1],p[2]]);await until(()=>peer.snapshot.zoneControl.zones[0].contested,'real contest');
   await page.waitForFunction(()=>document.querySelector('.zone-hud [data-zone="A"]')?.dataset.contested==='true');
   check(await page.evaluate(()=>{const hud=document.querySelector('.zone-hud [data-zone="A"]'),world=document.querySelector('.zone-world [data-zone="A"]');return hud.dataset.owner==='blue'&&hud.dataset.capturing==='red'&&hud.querySelector('.zone-marker-fill').style.height===world.querySelector('.zone-marker-fill').style.height;}),'HUD and world marker share owner, attacker and identical bottom-up contested fill');
   await view(await room.zoneViewForTest(p),p);await page.screenshot({path:out+'/contested-takeover.png'});
   await page.setViewport({width:640,height:480});await page.screenshot({path:out+'/hud-640.png'});
   check(await page.$$eval('.zone-hud .zone-marker',nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.top>50&&r.bottom<innerHeight&&r.left>=0&&r.right<innerWidth;})),'compact objective HUD remains readable at 640x480');
   await page.setViewport({width:1280,height:800});await h.leave(ally);
  }
  await page.evaluate(()=>window.__crossfire.networkLeave());await shown('#menu');check(await page.$$eval('.zone-marker',n=>n.length===0),map+': leaving clears markers and preview remains separate');
  await h.leave(peer);await context.close();
 }
 check(errors.length===0,'no browser exceptions or missing static assets');fs.writeFileSync(out+'/browser-report.json',JSON.stringify({checks,errors},null,2));
}catch(error){if(page&&!page.isClosed()){console.error('Browser state',await page.evaluate(()=>({state:window.__crossfire?.state(),network:window.__crossfire?.network(),errors:[...document.querySelectorAll('.room-status,#error')].map(n=>n.textContent)})).catch(()=>null));await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}throw error;}
finally{await browser?.close();if(server){if(server.close)await server.close();else await new Promise(resolve=>server.httpServer.close(resolve));}await cleanup?.();}
