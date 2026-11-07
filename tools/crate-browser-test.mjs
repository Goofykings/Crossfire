/** Crate reveal, crate skins and the Rich kill effect against a REAL local Worker and the
 * production GitHub Pages subpath build. Only test fixtures choose which items remain unowned
 * (to force each rarity); the draw, gem spend, grant and equip are the real server endpoints.
 *   npm run build; node tools/serve-dist.mjs --port 4200 --base /crossfire/
 *   node tools/crate-browser-test.mjs [http://127.0.0.1:4200/crossfire/] [--only reveal]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {harness,origin,self,frames,ack,until} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
import {COLLECTIONS,WEAPON_CATEGORIES,collectionCosmetic,crateItems} from '../shared/cosmetics.ts';
const base=process.argv.find(a=>a.startsWith('http'))??'http://127.0.0.1:4200/crossfire/',only=process.argv.includes('--only')?process.argv[process.argv.indexOf('--only')+1]:'all';
const out='test-results/crate-browser';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],metrics={};const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
let cleanup=()=>{},browser,page;const h=await harness({after:fn=>cleanup=fn},{ALLOWED_ORIGINS:origin+','+new URL(base).origin});
const visible=selector=>page.waitForSelector(selector+'.visible',{timeout:240000});
async function clickText(root,label){await page.evaluate(({root,label})=>{const b=[...document.querySelectorAll(root+' button')].find(b=>!b.hidden&&b.textContent.trim().toUpperCase()===label.toUpperCase());if(!b)throw Error('Missing '+label);b.click();},{root,label});}
const nav=label=>clickText('.home-nav',label);
// The Locker re-renders its grid when inventory arrives; resolve the element at click time.
const tap=selector=>page.waitForFunction(s=>{const n=document.querySelector(s);if(!n)return false;n.click();return true;},{timeout:30000},selector);
const reveal=()=>page.evaluate(()=>window.__crossfire.cosmetics().page.reveal);
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
let credential;
const everythingBut=keep=>crateItems().map(c=>c.id).filter(id=>!keep(id));
async function openForced(keep,label){
  await h.central.inventoryForTest(credential,everythingBut(keep));
  await page.evaluate(()=>window.__crossfire.cosmetics().page);await nav('Locker');await visible('#locker');await nav('Shop');await visible('#shop');
  await page.waitForFunction(()=>!document.querySelector('.shop-open').disabled,{timeout:60000});
  await page.click('.shop-open');await page.waitForSelector('.crate-reveal.visible',{timeout:10000});
  await page.waitForFunction(()=>window.__crossfire.cosmetics().page.reveal.phase==='opening',{timeout:120000});
  const started=Date.now();await page.evaluate(()=>window.__crossfire.crateReveal(true,0));
  const r=await reveal();check(r.item&&keep(r.item),`${label}: server granted a ${r.rarity} item (${r.item})`);
  const frames=[['closed',0],['shake',.32],['pop',.56],['charge',1.25],['burst',1.47],['rise',1.95],['hero',2.9]];
  const states={};
  for(const [name,t] of frames){await page.evaluate(t=>window.__crossfire.crateReveal(true,t),t);await delay(name==='burst'?60:220);states[name]=await reveal();await shot(`${label}-${name}`);}
  check(states.closed.lids.every(l=>l.visible&&Math.abs(l.dx)<.001),`${label}: closed crate with four lid pieces in place`);
  check(states.pop.lids.every(l=>l.y>states.closed.lids[0].y+.05)&&states.pop.seam!=='#000000',`${label}: lid pops up and seams glow ${states.pop.seam}`);
  check(states.rise.lids.every(l=>Math.abs(l.dx)>.3),`${label}: lid quarters burst outward`);
  check(states.hero.lids.every(l=>!l.visible||l.y<-1),`${label}: lid quarters fall away`);
  check(states.hero.camera.beta>Math.PI/2&&states.closed.camera.beta<Math.PI/2,`${label}: camera tilts up with the reward`);
  check(states.hero.hero.enabled&&Math.abs(states.hero.hero.scale-1)<.01&&states.hero.meshes>0,`${label}: reward floats at full scale`);
  await page.evaluate(()=>window.__crossfire.crateReveal(false));
  await page.waitForFunction(()=>!document.querySelector('.reveal-controls .btn').hidden,{timeout:20000});
  check(await page.$eval('#reveal-name',n=>n.textContent.length>0&&getComputedStyle(n.closest('.reveal-title')).opacity==='1'),`${label}: item name shown at the top`);
  metrics[label]={seconds:(Date.now()-started)/1000,rarity:states.hero.rarity,background:states.hero.background,money:states.rise.money,fps:(await reveal()).fps};
  return states.hero;
}
try{
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const context=await browser.createBrowserContext();page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
  page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});
  await page.evaluateOnNewDocument(server=>{
    window.__socketCount=0;const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(new URL(url,location.href).pathname,server).href.replace('http:','ws:'),protocols);window.__socketCount++;}};
    const real=window.fetch;window.fetch=(input,init)=>{const url=new URL(String(input),location.href);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join','/cosmetics','/cosmetics/equip','/cosmetics/open'].includes(url.pathname)?new URL(url.pathname+url.search,server):input,init);};
  },h.base);
  await page.goto(base+'?quality=high&scale=1',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,'Crate Tester');
  await nav('Shop');await visible('#shop');
  credential=await page.waitForFunction(()=>localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('crossfire.career.v1:'))??''),{timeout:60000}).then(v=>v.jsonValue());assert.match(credential,/^[a-f0-9]{64}$/);
  await page.waitForFunction(()=>document.querySelector('.home-gems span')?.textContent==='0',{timeout:60000});
  check(await page.$eval('.shop-crate',n=>n.complete&&n.naturalWidth>0&&n.src.includes('/crossfire/assets/cosmetics/crate/reward-crate/')),'new crate thumbnail loads at the GitHub Pages subpath');
  check(await page.$eval('.shop-open',n=>n.disabled),'Open disabled with 0 gems');
  check((await page.$$eval('.crate-collection',n=>n.map(r=>r.dataset.collection))).join()==='green-camo,blue-camo,red-camo,marble,rainbow-glow,rich','all six collections listed as crate contents');
  check((await page.$$eval('.crate-distribution span',n=>n.map(s=>s.textContent))).join('|')==='UNCOMMON — 55%|RARE — 40%|LEGENDARY — 5%','odds shown');
  await shot('shop-0-gems');
  await h.central.legacyWalletForStatisticsTest(credential,900);await nav('Locker');await visible('#locker');await nav('Shop');await visible('#shop');
  await page.waitForFunction(()=>document.querySelector('.home-gems span')?.textContent==='900'&&!document.querySelector('.shop-open').disabled,{timeout:60000});
  check(true,'Open enabled with 900 gems');await shot('shop-900-gems');
  // --- Uncommon reveal with drag/spring and equip ----------------------------------------
  const hero=await openForced(id=>id.startsWith('green-camo-'),'uncommon');
  check(hero.background.toLowerCase()==='#39e57a','uncommon reveal background is green');
  await page.$eval('.crate-reveal',e=>e.querySelector('button:not(:disabled):not([hidden])').focus());
  await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  check(await page.$eval('.crate-reveal',e=>{const b=[...e.querySelectorAll('button:not(:disabled):not([hidden])')];return document.activeElement===b.at(-1);}), 'reveal Shift+Tab wraps to its last enabled control');
  await page.keyboard.press('Tab');
  check(await page.$eval('.crate-reveal',e=>document.activeElement===e.querySelector('button:not(:disabled):not([hidden])')), 'reveal Tab wraps forward without reaching background menus');
  const box=await page.$eval('.crate-reveal canvas',c=>{const r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.move(box.x,box.y);await page.mouse.down();for(let i=1;i<=12;i++){await page.mouse.move(box.x+i*22,box.y+i*4);await delay(16);}
  const dragged=(await reveal()).hero;check(Math.abs(dragged.offset)>1.5,`drag rotates the weapon (offset ${dragged.offset} rad)`);await shot('uncommon-dragged');
  await page.mouse.up();const samples=[];for(let i=0;i<16;i++){samples.push((await reveal()).hero.offset);await delay(100);}
  check(Math.abs(samples.at(-1))<.03&&samples.some(v=>Math.sign(v)!==Math.sign(samples[0])&&Math.abs(v)>.005),`released rotation springs back past and settles at the hero angle (${samples.map(v=>v.toFixed(2)).join(' ')})`);
  for(const [w,hgt] of [[480,800],[640,480]]){await page.setViewport({width:w,height:hgt});await delay(400);await shot(`uncommon-hero-${w}x${hgt}`);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.reveal-controls .btn:not([hidden])'),document.querySelector('#reveal-name')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})),`reveal title and buttons fit at ${w}x${hgt}`);}
  await page.setViewport({width:1280,height:720});await delay(300);
  await clickText('.reveal-controls','EQUIP');await page.waitForFunction(()=>[...document.querySelectorAll('.reveal-controls .btn')].some(b=>b.textContent==='EQUIPPED'),{timeout:30000});
  const item=(await reveal()).item,weapon=item.split('-').pop();
  check((await page.evaluate(()=>window.__crossfire.cosmetics().view.equipped))[weapon]===item,`equip from the reveal persists ${item} on the server`);
  check((await h.api('/profile',credential)).data.profile.gems===600,'server spent exactly 300 gems');
  await clickText('.reveal-controls','CONTINUE');await page.waitForFunction(()=>document.querySelector('.crate-reveal').hidden);check(true,'Continue closes the reveal and returns to the Shop');
  check(await page.$eval('.crate-reveal',e=>e.inert)&&await page.$eval('.shop-open',e=>document.activeElement===e),'closing reveal inerts old controls and restores Shop focus');
  if(only==='all'){
    const rare=await openForced(id=>id.startsWith('marble-')||id.startsWith('rainbow-glow-'),'rare');check(rare.background.toLowerCase()==='#4d8dff','rare reveal background is blue');
    await clickText('.reveal-controls','CONTINUE');await page.waitForFunction(()=>document.querySelector('.crate-reveal').hidden);
    const legendary=await openForced(id=>id.startsWith('rich-'),'legendary');check(legendary.background.toLowerCase()==='#ffc22e','legendary reveal background is gold');
    check(metrics.legendary.money>0,`legendary reveal plays the Rich money shower (${metrics.legendary.money} pieces)`);
    await clickText('.reveal-controls','CONTINUE');await page.waitForFunction(()=>document.querySelector('.crate-reveal').hidden);
    check((await h.api('/profile',credential)).data.profile.gems===0,'three crates cost 900 gems');
    check(await page.$eval('.shop-open',n=>n.disabled),'Open disabled again when gems run out');
  }
  if(only==='all'||only==='locker'||only==='match'){
    // --- Locker: every collection on every weapon, real thumbnails and previews -----------
    await h.central.inventoryForTest(credential,crateItems().map(c=>c.id));
    await nav('Shop');await visible('#shop');await nav('Locker');await visible('#locker');
    await page.waitForFunction(()=>document.querySelectorAll('.cosmetic-card').length===28&&[...document.querySelectorAll('.cosmetic-grid .cosmetic-thumbnail')].every(i=>i.complete&&i.naturalWidth>0&&!i.hidden),{timeout:400000});
    const cards=await page.$$eval('.cosmetic-card',n=>n.map(c=>({id:c.dataset.cosmetic,name:c.querySelector('strong').textContent,rarity:c.querySelector('small').textContent,color:getComputedStyle(c.querySelector('strong')).color})));
    for(const c of COLLECTIONS){const mine=cards.filter(k=>k.id.startsWith(c.id+'-'));check(mine.length===4&&mine.every(k=>k.name===c.name&&k.rarity.toLowerCase()===c.rarity),`Locker shows ${c.name} for all four weapons with the ${c.rarity} label`);}
    const colours=Object.fromEntries(cards.map(c=>[c.rarity,c.color]));check(new Set(Object.values(colours)).size===4,`rarity colours are distinct: ${JSON.stringify(colours)}`);
    await shot('locker-all');
    for(const w of WEAPON_CATEGORIES){await tap(`.cosmetic-categories [data-category="${w}"]`);check((await page.$$eval('.cosmetic-card',n=>n.length))===7,`${w} filter lists Default plus six collections`);await shot('locker-'+w);}
    await page.click('.cosmetic-categories [data-category="all"]');
    const previews=only==='match'?[]:[['green-camo','rifle'],['blue-camo','smg'],['red-camo','shotgun'],['marble','sniper'],['rainbow-glow','rifle'],['rich','sniper'],['rich','smg'],['rainbow-glow','shotgun']];
    for(const [family,w] of previews){
      const id=collectionCosmetic(family,w);await tap(`.cosmetic-card[data-cosmetic="${id}"]`);await visible('#cosmetic-preview');
      await page.waitForFunction(()=>window.__crossfire.cosmetics().page.preview.meshes>0&&document.querySelector('#cosmetic-preview>.cosmetic-status').textContent==='',{timeout:120000});await delay(400);
      await shot('preview-'+id);check(true,`Locker 3D preview renders ${id}`);await clickText('#cosmetic-preview','Back');await visible('#locker');
    }
    // Equip one finish per weapon through the real Locker flow.
    for(const id of ['rich-rifle','rainbow-glow-smg','marble-sniper','red-camo-shotgun']){
      await tap(`.cosmetic-card[data-cosmetic="${id}"]`);await visible('#cosmetic-preview');await page.waitForFunction(()=>window.__crossfire.cosmetics().page.preview.meshes>0,{timeout:120000});
      await clickText('#cosmetic-preview','EQUIP');await page.waitForFunction(()=>document.querySelector('#cosmetic-preview footer button').textContent==='EQUIPPED',{timeout:30000});await clickText('#cosmetic-preview','Back');await visible('#locker');
    }
    const equipped=await page.evaluate(()=>window.__crossfire.cosmetics().view.equipped);
    check(JSON.stringify(equipped)===JSON.stringify({rifle:'rich-rifle',smg:'rainbow-glow-smg',sniper:'marble-sniper',shotgun:'red-camo-shotgun'}),'Locker equips a crate finish on each of the four weapons');
    await shot('locker-equipped');
  }
  if(only==='all'||only==='match'){
    // --- First person, third person and the Rich kill effect in a real custom room ------
    const peerToken=await h.profile();await h.central.inventoryForTest(peerToken,['rich-sniper','marble-rifle']);
    for(const id of ['rich-sniper','marble-rifle'])assert.equal((await fetch(new URL('/cosmetics/equip',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+peerToken,'Content-Type':'application/json'},body:JSON.stringify({version:1,id})})).status,200);
    await nav('Play');await visible('#menu');await page.click('#menu .home-actions .primary');await visible('#modes');await clickText('#modes','Create Server');await visible('#create-room');await clickText('#create-room','CREATE');await visible('#weapons');
    await page.click('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});await delay(1500);
    const net=await page.evaluate(()=>window.__crossfire.network());check(net.snapshot.players.find(p=>p.id===net.selfId).cosmeticId==='rich-rifle','server snapshot carries the equipped Rich rifle');
    const room=h.room(net.snapshot.room),peer=await h.open(await h.admission(peerToken,{roomId:net.snapshot.room}),peerToken);await h.spawn(peer,'sniper');
    const arena=await room.directionalArenaForTest();const me=arena.sources.front,them=arena.center;
    await room.placeForCombatTest(net.selfId,me);await room.placeForCombatTest(peer.id,them);peer.position=them;
    // Wait for the loaded GLB character itself, not only the snapshot's cosmetic ID.
    await page.waitForFunction(id=>window.__crossfire.network().rendered.some(p=>p.id===id&&p.weapon?.cosmeticId==='rich-sniper'&&p.source==='glb'),{timeout:120000},peer.id);
    const placed=()=>page.waitForFunction(([x,z])=>{const n=window.__crossfire.network(),s=n.snapshot.players.find(p=>p.id===n.selfId);const q=s?.motion?.position;const v=Array.isArray(q)?q:q?[q.x,q.y,q.z]:null;return v&&Math.hypot(v[0]-x,v[2]-z)<.3;},{timeout:20000},[me[0],me[2]]);
    await placed();await delay(800);
    check(true,'remote character renders the peer Rich sniper (third person)');
    await page.evaluate(([x,y,z])=>window.__crossfire.aimAt(x,y+1.25,z),them);await delay(1200);
    await page.waitForFunction(id=>window.__crossfire.network().rendered.some(p=>p.id===id&&p.visible),{timeout:30000},peer.id);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await shot('third-person-rich-sniper');
    await page.evaluate(([x,y,z])=>window.__crossfire.aimAt(x+2.5,y+1.4,z),them);await delay(500);await shot('first-person-rich-rifle');
    await page.evaluate(()=>window.__crossfire.hold('aim',true));await delay(700);await shot('first-person-rich-rifle-ads');await page.evaluate(()=>window.__crossfire.hold('aim',false));
    // Page (Rich rifle) eliminates the peer: the killer sees coins/bills around the gun.
    const alive=()=>page.evaluate(id=>window.__crossfire.network().snapshot.players.find(p=>p.id===id)?.alive,peer.id);
    for(let i=0;i<60&&await alive();i++){await page.evaluate(([x,y,z])=>window.__crossfire.aimAt(x,y+1.1,z),them);await page.evaluate(()=>window.__crossfire.hold('fire',true));await delay(100);}
    await page.evaluate(()=>window.__crossfire.hold('fire',false));
    const fp=await page.waitForFunction(()=>window.__crossfire.moneyInfo().view>0&&window.__crossfire.moneyInfo(),{timeout:4000}).then(v=>v.jsonValue());
    await delay(250);await shot('kill-effect-first-person');check(fp.view>0,`Rich kill shows ${fp.view} coins/bills around the killer gun`);
    const frameTimes=effect=>page.evaluate(async effect=>{if(effect)window.__crossfire.moneyBurst();const f=[];let last=performance.now();for(let i=0;i<40;i++){await new Promise(r=>requestAnimationFrame(r));const n=performance.now();f.push(n-last);last=n;}f.sort((a,b)=>a-b);return {median:f[20],p90:f[36],max:f.at(-1)};},effect);
    await delay(1600);const baseline=await frameTimes(false);await delay(200);const perf=await frameTimes(true);
    metrics.killEffectFrameMs={baseline,effect:perf};await page.waitForFunction(()=>window.__crossfire.moneyInfo().view===0,{timeout:5000});check(perf.median<baseline.median*1.5+4,`kill effect is brief and cleans up (frames during effect median/p90 ${perf.median.toFixed(1)}/${perf.p90.toFixed(1)} ms vs ${baseline.median.toFixed(1)}/${baseline.p90.toFixed(1)} ms without)`);
    for(const [i,wait] of [[1,0],[2,180],[3,180]].entries()){if(!i)await page.evaluate(()=>window.__crossfire.moneyBurst());await delay(wait[1]);await shot('kill-effect-sequence-'+wait[0]);}
    // Peer (Rich sniper) eliminates the page: another player sees the world-space version.
    await until(()=>self(peer)?.alive,'peer respawn',6000).catch(()=>{});if(!self(peer)?.alive)await h.spawn(peer,'sniper');
    await room.placeForCombatTest(net.selfId,me);await room.placeForCombatTest(peer.id,them);peer.position=them;await delay(300);
    const dx=me[0]-them[0],dz=me[2]-them[2],l={yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(me[1]+.9-them[1]-1.64,Math.hypot(dx,dz)),aim:true};
    for(let i=0;i<13;i++){frames(peer,l);await delay(50);}await ack(peer);
    const pageAlive=()=>page.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId)?.alive;});
    for(let i=0;i<6&&await pageAlive();i++){frames(peer,{...l,trigger:true});await ack(peer);await until(()=>self(peer).combat.gun.cooldown===0,'sniper cooldown',5000);}
    const world=await page.waitForFunction(()=>window.__crossfire.moneyInfo().world>0&&window.__crossfire.moneyInfo(),{timeout:5000}).then(v=>v.jsonValue());
    await shot('kill-effect-observer');check(world.world>0,`other players see the Rich effect at the killer gun (${world.world} pieces)`);
    await h.leave(peer);await page.evaluate(()=>window.__crossfire.networkLeave());await visible('#menu');
  }
  check(errors.length===0,'no browser exceptions, console errors or missing assets');
  fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,metrics},null,2));
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});fs.writeFileSync(out+'/failure.json',JSON.stringify({message:String(error),stack:error?.stack,checks,errors,metrics,status:await page?.evaluate(()=>[...document.querySelectorAll('.cosmetic-status')].map(n=>n.textContent)).catch(()=>null)},null,2));throw error;}
finally{await browser?.close();await cleanup();}
