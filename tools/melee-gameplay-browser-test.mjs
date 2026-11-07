/** Real local Worker + Chrome: inventory, paired crate preview, V input and confirmed melee. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import {harness,origin,until,self,frames,ack} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
import {crateItems} from '../shared/cosmetics.ts';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4201/',out='test-results/melee-gameplay-browser';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],states={};const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
let cleanup=()=>{},browser,page,remoteClient;const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin,AFK_WARN_MS:'300000',AFK_KICK_MS:'600000'});
const click=async(root,text)=>page.evaluate(({root,text})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>b.textContent.trim().toUpperCase()===text.toUpperCase());if(!b)throw Error('Missing '+root+' '+text);b.click();},{root,text});
const nav=text=>click('.home-nav',text),visible=id=>page.waitForSelector(id+'.visible',{timeout:240000}),shot=name=>page.screenshot({path:out+'/'+name+'.png'});
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:800},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 page=await (await browser.createBrowserContext()).newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
 await page.evaluateOnNewDocument(server=>{const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){const u=new URL(url,location.href);super(u.pathname.startsWith('/ws')?new URL(u.pathname+u.search,server).href.replace('http:','ws:'):url,protocols);}};const real=window.fetch;window.fetch=(input,init)=>{const u=new URL(String(input),location.href);if(u.pathname==='/cosmetics/open')window.__crateRequest=JSON.parse(init.body);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip','/cosmetics/open'].includes(u.pathname)?new URL(u.pathname+u.search,server):input,init);};},h.base);
 await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Dagger Player');
 await nav('Settings');await visible('#settings');await page.click('#tab-controls');
 const binding='#settings button[aria-label="Rebind Toggle dual daggers"]';
 await page.click(binding);await page.keyboard.press('b');await click('#settings','Apply');await click('#settings','Back');
 await nav('Settings');await page.click('#tab-controls');check(await page.$eval(binding,b=>b.textContent.trim()==='B'),'melee key can be rebound and survives reopening Settings');
 await page.click('#settings button[aria-label="Reset Toggle dual daggers"]');await click('#settings','Apply');await click('#settings','Back');
 await nav('Locker');await visible('#locker');await page.waitForSelector('[data-category="melee"]');await page.waitForFunction(()=>window.__crossfire.cosmetics().view?.owned.includes('default-melee'),{timeout:120000});
 check(await page.$$eval('.cosmetic-categories button',b=>b.map(e=>e.textContent.trim()).join('|')==='ALL|SMG|AR|SNIPER|SHOTGUN|MELEE'),'six Locker filters include MELEE');
 check(await page.$$eval('.equipped-item',b=>b.length===5),'equipped panel includes the separate melee slot');
 await page.click('[data-category="melee"]');await page.click('.cosmetic-card');await visible('#cosmetic-preview');await page.waitForFunction(()=>window.__crossfire.cosmetics().page.preview.meshes>0&&document.querySelector('#cosmetic-preview>.cosmetic-status').textContent==='',{timeout:120000});await shot('default-pair-preview');
 check(true,'Default Daggers full 3D pair preview loads');await click('#cosmetic-preview','Back');
 const token=await page.evaluate(()=>localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('crossfire.career.v1:'))));assert.match(token,/^[a-f0-9]{64}$/);
 await nav('Shop');await visible('#shop');check(await page.$eval('.shop-open',b=>b.disabled),'crate stays disabled when unaffordable');
 await h.central.inventoryForTest(token,crateItems().filter(c=>c.id!=='rich-melee').map(c=>c.id));await h.central.legacyWalletForStatisticsTest(token,300);
 await nav('Locker');await nav('Shop');await page.waitForFunction(()=>!document.querySelector('.shop-open').disabled,{timeout:30000});await page.click('.shop-open');
 await page.waitForFunction(()=>window.__crossfire.cosmetics().page.reveal.phase==='opening',{timeout:120000});await page.evaluate(()=>window.__crossfire.crateReveal(false,3.3));
 await page.waitForFunction(()=>!document.querySelector('.reveal-controls button').hidden,{timeout:30000});check(await page.evaluate(()=>window.__crossfire.cosmetics().page.reveal.item)==='rich-melee','real crate draw grants the registered matching dagger pair');await shot('rich-pair-reveal');
 const request=await page.evaluate(()=>window.__crateRequest);const repeat=await fetch(new URL('/cosmetics/open',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(request)});const receipt=await repeat.json();check(repeat.status===200&&receipt.item==='rich-melee'&&receipt.gems===0,'repeating the same crate request returns its receipt without another charge or grant');
 await click('.reveal-controls','EQUIP');await page.waitForFunction(()=>window.__crossfire.cosmetics().view.equipped.melee==='rich-melee',{timeout:30000});await click('.reveal-controls','CONTINUE');
 await nav('Play');await visible('#menu');await page.click('#menu .home-actions .primary');await visible('#modes');await click('#modes','Create Server');await visible('#create-room');await click('#create-room','CREATE');await visible('#weapons');await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
 const n=await page.evaluate(()=>window.__crossfire.network()),room=h.room(n.snapshot.room),peerToken=await h.profile(),peer=await h.open(await h.admission(peerToken,{roomId:n.snapshot.room}),peerToken);remoteClient=peer;await h.spawn(peer,'smg');
 const arena=await room.meleeArenaForTest();await room.placeForCombatTest(n.selfId,arena.attacker);await room.placeForCombatTest(peer.id,arena.victim);
 await page.waitForFunction(p=>{const q=window.__crossfire.player();return Math.hypot(q.x-p[0],q.z-p[2])<.2;},{timeout:20000},arena.attacker);await page.evaluate(()=>window.__crossfire.look(0,0));
 await page.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId)?.combat.gun.action==='idle';});
 await page.keyboard.press('v');await page.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId)?.combat.melee?.phase==='ready';},{timeout:10000});
 await page.waitForFunction(()=>window.__crossfire.meleeInspect()?.daggersVisible.every(Boolean));states.equipped=await page.evaluate(()=>window.__crossfire.meleeInspect());
 check(states.equipped.cosmeticId==='rich-melee'&&!states.equipped.gunVisible,'physical V equips both skinned daggers and hides the gun at its authored timing');await shot('first-person-daggers');
 frames(peer,{melee:true});await ack(peer);await until(()=>self(peer).combat.melee.phase==='ready','remote equip');
 await page.waitForFunction(id=>{const p=window.__crossfire.meleeRemoteInspect(id)[id];return p?.daggersVisible?.every(Boolean);},{timeout:30000},peer.id);check(true,'real second client displays both equipped daggers on its remote animated character');await shot('remote-daggers');
 frames(peer,{yaw:Math.PI,trigger:true});await ack(peer);
 await Promise.all([page.waitForFunction(id=>window.__crossfire.meleeRemoteInspect(id)[id]?.clip==='attack_cross',{timeout:10000},peer.id),until(()=>peer.snapshot.players.find(p=>p.id===n.selfId).health===65,'remote player confirmed hit')]);
 check(true,'remote attack clip and server-confirmed damage reach the browser');await shot('remote-attack');
 for(const [i,hp]of [65,30,0].entries()){
  await page.evaluate(()=>window.__crossfire.hold('fire',true));await until(()=>self(peer).health===hp,'browser confirmed hit '+(i+1));await page.evaluate(()=>window.__crossfire.hold('fire',false));
  const authoritative=peer.snapshot.players.find(p=>p.id===n.selfId).combat.melee;check(authoritative.stage===i+1,`attack ${i+1}: authoritative combo stage and opponent health ${hp}`);
  states['attack'+(i+1)]=authoritative;await until(()=>!peer.snapshot.players.find(p=>p.id===n.selfId).combat.melee.triggerHeld,'released attack input');
 }
 await shot('combo-completed');
 await page.waitForFunction(()=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return s.score===100&&s.kills===1;});
 check(await page.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).combat.gun.ammo===30;}),'three melee hits score one elimination without consuming firearm ammunition');
 await page.keyboard.press('v');await page.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).combat.melee.phase==='hidden';});
 check(await page.evaluate(()=>window.__crossfire.weapon().id==='rifle'||window.__crossfire.network().snapshot.players.find(p=>p.id===window.__crossfire.network().selfId).weapon==='rifle'),'V restores the previously selected rifle');
 await until(()=>Date.now()>=self(peer).death.respawnAt,'real victim respawn delay');await h.spawn(peer,'smg');
 await room.placeManyForCombatTest([{id:n.selfId,pos:arena.attacker},{id:peer.id,pos:arena.victim}]);await until(()=>self(peer).combat.gun.action==='idle','respawn weapon ready');
 frames(peer,{melee:true,yaw:Math.PI});await ack(peer);await until(()=>self(peer).combat.melee.phase==='ready','respawned player equips daggers');
 for(let i=0;i<3;i++){const victim=peer.snapshot.players.find(p=>p.id===n.selfId);if(!victim.alive)break;const health=victim.health;frames(peer,{trigger:true,yaw:Math.PI});await ack(peer);await until(()=>peer.snapshot.players.find(p=>p.id===n.selfId).health<health,'confirmed reciprocal melee hit');}
 await visible('#spectate');await page.waitForFunction(()=>{const m=window.__crossfire.meleeInspect(),n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);return m?.daggersVisible.every(Boolean)&&!m.gunVisible&&s.death&&n.snapshot.serverTime>=s.death.at+500;},{timeout:30000});
 check(await page.evaluate(()=>!window.__crossfire.meleeInspect().gunVisible),'spectating a melee killer shows both daggers with the gun hidden');await shot('spectator-daggers');
 await h.leave(peer);await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');
 check(errors.length===0,'no browser exceptions or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,states},null,2));
}catch(error){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({error:String(error),checks,errors,remote:remoteClient?.messages.slice(-100),view:await page?.evaluate(()=>window.__crossfire?.meleeInspect()).catch(()=>null),network:await page?.evaluate(()=>window.__crossfire?.network()).catch(()=>null)},null,2));throw error;}
finally{await browser?.close();await cleanup();}
