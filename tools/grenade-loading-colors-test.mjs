/** Two real Chrome contexts against the local authoritative Worker, plus map screenshots. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';

const base=process.argv[2]??'http://127.0.0.1:4199/';
const out=process.env.CROSSFIRE_TEST_OUTPUT??'test-results/grenade-loading-colors';fs.mkdirSync(out,{recursive:true});
const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log(`PASS ${label}`);};
const until=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(60);}throw new Error(`Timeout: ${label}`);};
const fixture=new Miniflare(convertV4MiniflareOptions({name:'update-phase3',
  modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},
    {type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],
  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
  resourcePersistencePath:fs.mkdtempSync('server/.wrangler/update-phase3-'),
  durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:new URL(base).origin,MATCH_MODE:process.argv.includes('--teams')?'teams':'ffa'},log:new Log(LogLevel.ERROR)}));
let browser;const errors=[],checks=[];
try {
  const backend=(await fixture.ready).href,ns=await fixture.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
  let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
    timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},
    args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  async function open(name) {
    const context=await browser.createBrowserContext(),page=await context.newPage();
    page.on('pageerror',e=>errors.push(String(e))); page.on('dialog',d=>d.accept());
    const held={weapons:[],map:[],textures:[]}; let blockWeapons=name==='Grenadier'&&!process.argv.includes('--asset-failure'),blockMap=blockWeapons;
    let blockTextures=blockWeapons;
    let failTexture=process.argv.includes('--asset-failure')&&name==='Grenadier';
    await page.setRequestInterception(true);
    page.on('request',r=>{
      if(failTexture && r.url().includes('/textures/weapons/gun_metal_orm.png'))void r.respond({status:503,body:'Intentional local QA texture failure'});
      else if(blockTextures && r.url().includes('/textures/weapons/gun_metal_orm.png'))held.textures.push(r);
      else if(blockWeapons && r.url().includes('/shared/weapons/rifle.glb'))held.weapons.push(r);
      else if(blockMap && r.url().includes('/models/european-town/') && r.url().endsWith('.glb'))held.map.push(r);
      else void r.continue();
    });
    page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
    await page.evaluateOnNewDocument((backend,capture)=>{
      // Optional screenshot gate: pause only presentation RAF after the first real explosion frame.
      const nativeRAF=window.requestAnimationFrame.bind(window),waiting=[];
      let armed=false,paused=false,exploded=false,lastSmokeSample=0;
      window.__smokeSamples=[];
      window.__grenadeCapture={arm:()=>{armed=capture;},resume:()=>{
        armed=paused=exploded=false;for(const callback of waiting.splice(0))nativeRAF(callback);
      }};
      window.requestAnimationFrame=callback=>nativeRAF(t=>{
        if(paused){waiting.push(callback);return;}callback(t);
        if(t-lastSmokeSample>=100&&window.__crossfire?.grenades){
          lastSmokeSample=t;const fx=window.__crossfire.grenades();
          for(const cloud of fx.clouds??[])window.__smokeSamples.push({...cloud,inside:fx.inside});
          if(window.__smokeSamples.length>256)window.__smokeSamples.splice(0,window.__smokeSamples.length-256);
        }
        if(armed&&exploded)paused=true;
      });
      window.__awardEvents=[];window.__spawnRequests=[];window.__joinEvents=[];window.__grenadeEvents=[];window.__screens=[];window.__selectionReady=[];
      new MutationObserver(()=>{
        const screen=document.body?.dataset.screen;
        if(screen&&window.__screens.at(-1)!==screen)window.__screens.push(screen);
        if(screen==='weapons')window.__selectionReady.push({ready:window.__crossfire?.loadingState().networkReady,
          previews:[...document.querySelectorAll('#weapons .weapon-art img')].filter(i=>i.complete&&i.naturalWidth>0).length});
      }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-screen']});
      new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.classList.contains('grenade-reward'))window.__awardEvents.push({at:Date.now(),text:node.textContent,animation:getComputedStyle(node).animationDuration,left:parseFloat(node.style.left)});}).observe(document,{subtree:true,childList:true});
      const Socket=window.WebSocket;
      window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='system')window.__joinEvents.push(m);if(m.type==='pong')window.__lastClockOffset=m.serverTime-(m.at+Date.now())/2;if(m.type==='grenade')window.__grenadeEvents.push({receivedAt:Date.now(),presentationAge:m.event.at===undefined?null:Date.now()+(window.__lastClockOffset??0)-m.event.at,event:m.event});if(armed&&m.type==='grenade'&&m.event.kind==='explode')exploded=true;}catch{}});}send(data){const m=JSON.parse(data);if(m.type==='spawn')window.__spawnRequests.push(m);return super.send(data);}};
      const fetch=window.fetch;
      window.fetch=(input,init)=>fetch(['/presence','/profile'].includes(new URL(String(input),location.href).pathname) ? new URL(new URL(String(input),location.href).pathname, backend):input,init);
    },backend,process.argv.includes('--capture-fx'));
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});
    await completeGuestProfile(page,name);
    if(failTexture){
      await page.waitForSelector('#error.visible',{timeout:90000});
      check(await page.$eval('#error',e=>e.textContent.includes('Required texture failed to load')&&e.textContent.includes('gun_metal_orm.png')),'texture failure identifies asset and blocks the partial world');
      check(await page.evaluate(()=>window.__spawnRequests.length===0),'texture failure cannot spawn a player');
      await page.screenshot({path:`${out}/texture-error.png`});
      failTexture=false;errors.length=0;await page.click('#error .primary');
    }
    if(blockWeapons){
      await until(()=>held.weapons.length>0,'delayed required gun request',90000);
      await delay(300);
      check(await page.evaluate(()=>document.body.dataset.screen==='loading'&&!document.querySelector('#weapons.visible')&&window.__spawnRequests.length===0&&!window.__crossfire.loadingState().networkReady),'delayed gun keeps selection hidden and prevents spawn');
      const before=await page.evaluate(()=>window.__crossfire.network());
      await room.dropSocketForTest(before.selfId);
      await until(()=>page.evaluate(opens=>{const n=window.__crossfire.network();return n.state==='connected'&&n.diagnostics.opens>opens;},before.diagnostics.opens),'genuine transport drop resumes while required asset is delayed',60000);
      check(await page.evaluate(id=>document.body.dataset.screen==='loading'&&window.__spawnRequests.length===0&&window.__crossfire.network().selfId===id,before.selfId),'loading reconnect preserves identity and never exposes incomplete world');
      blockWeapons=false;for(const r of held.weapons)await r.continue();
      await until(()=>held.textures.length>0,'delayed weapon texture',90000);await delay(250);
      check(await page.evaluate(()=>document.body.dataset.screen==='loading'&&window.__spawnRequests.length===0),'weapon texture readiness blocks authoritative spawn');
      blockTextures=false;for(const r of held.textures)await r.continue();
      await until(()=>held.map.length>0,'delayed map geometry',90000);await delay(250);
      check(await page.evaluate(()=>document.body.dataset.screen==='loading'&&window.__spawnRequests.length===0),'map geometry also blocks authoritative spawn');
      await page.screenshot({path:`${out}/loading.png`});
      blockMap=false;for(const r of held.map)await r.continue();
    }
    await page.waitForFunction(()=>window.__crossfire.ready()||document.querySelector('#weapons.visible .weapon-card:not(:disabled)'),{timeout:240000});
    if(!await page.evaluate(()=>window.__crossfire.ready()))await page.click('#weapons .weapon-card[data-weapon="rifle"]');
    await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});
    check(await page.evaluate(()=>window.__selectionReady.length>0&&window.__selectionReady.every(s=>s.ready&&s.previews===4)),'selection only opens with authoritative map and all four decoded previews ready');
    check(await page.evaluate(()=>{const screens=window.__screens;return !screens.slice(screens.lastIndexOf('weapons')+1).includes('loading');}),'selection-to-spawn never returns to loading');
    page.id=await page.evaluate(()=>window.__crossfire.network().selfId);return page;
  }
  const a=await open('Grenadier'),b=await open('Crouch Observer');
  await until(()=>a.evaluate(ids=>ids.every(id=>window.__joinEvents.some(e=>e.id===`join:${id}`)),[a.id,b.id]),'both genuine server joins');
  check(await a.evaluate(()=>new Set(window.__joinEvents.map(e=>e.id)).size===window.__joinEvents.length),'each session entry has one unique announcement');
  check(await a.evaluate(()=>[...document.querySelectorAll('.chat-log .chat-system')].some(e=>e.textContent==='Server: Crouch Observer joined.')),'sanitized server join appears in normal chat');
  const gray=await a.$eval('.chat-log .chat-system',e=>({body:getComputedStyle(e).color,label:getComputedStyle(e.querySelector('strong')).color}));
  check(gray.body==='rgb(169, 173, 179)'&&gray.label==='rgb(197, 200, 204)','server message uses neutral gray with brighter Server label');
  const joinsBefore=await a.evaluate(()=>window.__joinEvents.length);
  const net=p=>p.evaluate(()=>window.__crossfire.network());
  const me=async p=>{const n=await net(p);return n.snapshot.players.find(q=>q.id===p.id);};
  await a.evaluate(()=>window.__crossfire.setSetting({graphicsQuality:'medium',reducedEffects:false}));
  await delay(350);
  check(!(await a.evaluate(()=>window.__crossfire.grenades())).reduced&&(await b.evaluate(()=>window.__crossfire.grenades())).reduced,'normal and reduced-effects clients coexist');
  if(process.argv.includes('--loading-only')) {
    const before=await net(b),old=before.snapshot.players.find(p=>p.id===b.id);
    await b.reload({waitUntil:'domcontentloaded',timeout:240000});
    await b.waitForFunction(()=>window.__crossfire?.ready(),{timeout:240000});
    const after=await net(b),current=after.snapshot.players.find(p=>p.id===b.id);
    check(after.selfId===b.id&&current.life===old.life&&current.weapon===old.weapon&&current.health===old.health,'real browser refresh resumes the existing authoritative life');
    check(await b.evaluate(()=>window.__spawnRequests.length===0),'refresh of a living session sends no duplicate spawn');
    await delay(300);
    check(await a.evaluate(n=>window.__joinEvents.length===n,joinsBefore),'other browser receives no duplicate join after actual refresh');
    check(new Set(after.snapshot.players.map(p=>p.id)).size===after.snapshot.players.length&&after.snapshot.players.length===2,'refresh keeps exactly two unique players');
    await a.bringToFront();await a.keyboard.down('Enter');await delay(150);await a.keyboard.up('Enter');
    await a.waitForSelector('.match-chat:not([hidden])');await a.type('.chat-form input','Public chat after refresh');await a.keyboard.press('Enter');
    await until(()=>b.$$eval('.chat-log .chat-player',rows=>rows.some(e=>e.textContent==='Grenadier: Public chat after refresh')),'normal chat survives trusted system messages and refresh');
    check(true,'normal public chat still reaches the other real client');
    check(errors.length===0,`no browser or asset errors (${errors.length})`);
    fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors},null,2));
  } else {
  const arena=await room.directionalArenaForTest();
  await room.placeForCombatTest(a.id,arena.center);await room.placeForCombatTest(b.id,arena.observer);
  await delay(500);await a.bringToFront();await a.keyboard.down('Control');await delay(550);
  const lowered=await me(a),peer=await until(async()=>{const p=(await net(b)).rendered.find(p=>p.id===a.id);return p?.animation?.clip==='CROUCH'?p:null;},'actual crouch animation');
  check(lowered.motion.crouch===1&&peer.height<1.17,'Ctrl lowers both authoritative collider and remote body');
  await b.evaluate(([x,y,z])=>window.__crossfire.aimAt(x,y+.7,z),arena.center);await delay(300);
  await b.screenshot({path:`${out}/remote-crouch.png`});
  await a.keyboard.up('Control');await until(async()=>(await me(a)).motion.crouch===0,'authoritative crouch release');check((await me(a)).motion.crouch===0,'release stands up');
  // Actual key binding persists across settings updates, with mouse throw also exposed in the HUD.
  check((await a.evaluate(()=>window.__crossfire.settings())).keyBindings.grenade[0]==='KeyG','G grenade default');
  check((await a.evaluate(()=>window.__crossfire.settings())).keyBindings.reload[0]==='KeyR','R reload default');
  await a.keyboard.down('g');await delay(350);
  check(await a.$eval('.grenade-charge',e=>e.classList.contains('visible')),'held grenade shows a clockwise charge ring');
  check((await me(a)).grenades===1,'charging does not consume inventory');
  await a.screenshot({path:`${out}/charge-meter.png`});
  await a.evaluate(()=>window.dispatchEvent(new Event('blur')));await a.keyboard.up('g');await delay(250);
  check((await me(a)).grenades===1&&(await net(a)).snapshot.grenades.length===0,'focus-loss cancellation never releases a throw');
  check(await a.$eval('.grenade-charge',e=>!e.classList.contains('visible')),'cancel hides the meter');
  await a.evaluate(()=>window.__grenadeCapture.arm());
  await a.evaluate(()=>window.__crossfire.look(0,-80));await delay(150);
  await a.keyboard.press('g');await until(async()=>(await a.evaluate(()=>window.__crossfire.grenades())).count===0,'authoritative inventory consumption');
  const throwing=await a.evaluate(()=>window.__crossfire.grenades());
  check(throwing.count===0&&throwing.projectiles===1,'real key consumes inventory and renders projectile');
  check(throwing.lower>.02,'short throw lowers and returns the existing weapon');
  let g;await until(async()=>{g=(await room.snapshotForTest()).grenades[0];return g&&Date.now()-g.at>1300;},'projectile settles');
  await room.placeForCombatTest(b.id,[g.position.x,arena.center[1],g.position.z]);
  await room.placeForCombatTest(a.id,arena.sources.right);
  const dx=g.position.x-arena.sources.right[0],dz=g.position.z-arena.sources.right[2];
  await a.evaluate((heading,pitch)=>window.__crossfire.look(heading,pitch),Math.atan2(dx,-dz)*180/Math.PI,
    Math.atan2(g.position.y-arena.sources.right[1]-1.64,Math.hypot(dx,dz))*180/Math.PI);
  await until(async()=>!(await me(b)).alive,'actual radial elimination');
  await until(async()=>(await a.evaluate(()=>window.__crossfire.grenades())).particles>0,'brief explosion particles',2000);
  const blastVisual=await a.evaluate(()=>window.__crossfire.grenades());
  check(blastVisual.particles<=128&&blastVisual.burst.budget===4&&blastVisual.burst.additiveParticles===48,'smoke and layered burst use bounded pools');
  await a.screenshot({path:`${out}/explosion.png`});
  await a.evaluate(()=>window.__grenadeCapture.resume());
  await until(async()=>(await b.evaluate(()=>window.__crossfire.state()))==='spectating','grenade enters spectating');
  const attackStats=await until(async()=>{const stats=await a.evaluate(()=>window.__crossfire.stats());
    return stats.grenadesThrown===1&&stats.grenadeHits===1?stats:null;},'attacker receives the grenade statistics');
  check(attackStats.grenadesThrown===1&&attackStats.grenadeHits===1&&attackStats.hits===0,'grenade stats preserve firearm accuracy');
  const dead=await me(b);check(dead.death.weapon==='grenade'&&dead.death.award.total===100&&!dead.death.head,'grenade death, feed and normal score');
  const feed=await until(async()=>{const rows=await a.$$eval('.kill-feed-entry',rows=>rows.map(row=>({text:row.textContent,weapon:row.querySelector('[data-weapon]')?.getAttribute('data-weapon')})));
    return rows.some(row=>row.weapon==='grenade'&&row.text.includes('Crouch Observer'))?rows:null;},'attacker receives the grenade kill feed');
  check(feed.filter(row=>row.weapon==='grenade'&&row.text.includes('Grenadier')&&row.text.includes('Crouch Observer')).length===1,
    'the actual grenade elimination appears once in the kill feed');
  await a.bringToFront();await a.keyboard.down('Tab');
  await until(()=>a.$eval('.scoreboard',e=>!e.hidden).catch(()=>false),'leaderboard is visible');
  const standing=await until(async()=>{const row=await a.$eval(`.scoreboard tr[data-player-id="${a.id}"]`,row=>({score:row.cells[2].dataset.score,kills:row.cells[3].textContent,deaths:row.cells[4].textContent})).catch(()=>null);
    return row?.score==='100'&&row.kills==='1'?row:null;},'leaderboard receives the authoritative score');
  check(standing.score==='100'&&standing.kills==='1'&&standing.deaths==='0','leaderboard shows the actual grenade score and elimination');
  await a.keyboard.up('Tab');
  for(const p of [a,b]) {
    const audio=await p.evaluate(()=>window.__crossfire.spatialAudio());
    check(audio.recent.filter(s=>s.name==='grenade_explosion').length===1,'one positional explosion for player or spectator');
  }
  const cloud=await until(async()=>{const fx=await a.evaluate(()=>window.__crossfire.grenades());return fx.clouds?.[0];},'persistent cloud');
  const rewardAnimation=(await a.evaluate(()=>window.__awardEvents));
  check(rewardAnimation.length===1&&rewardAnimation[0].text==='+1'&&rewardAnimation[0].animation==='0.8s','one live +1 HUD animation for confirmed grenade kill');
  await until(async()=>(await me(a)).grenades===1,'earned grenade inventory');
  const peerCloud=await b.evaluate(()=>window.__crossfire.grenades().clouds[0]);
  check(peerCloud?.id===cloud.id&&Math.abs(peerCloud.age-cloud.age)<350,'both browsers share authoritative cloud origin and age');
  // Move the real surviving player into already-detonated smoke; no fabricated damage or particles.
  await room.placeForCombatTest(a.id,[cloud.position.x,arena.center[1],cloud.position.z]);
  await until(async()=>(await a.evaluate(()=>window.__crossfire.grenades())).inside>.8,'spatial inside-smoke density');
  await a.screenshot({path:`${out}/inside-smoke.png`});
  const outside=await room.smokeObservationForTest(cloud.position);
  await room.placeForCombatTest(a.id,outside);
  await until(async()=>(await a.evaluate(()=>window.__crossfire.grenades())).inside<.01,'outside smoke restores visibility');
  await a.evaluate(p=>window.__crossfire.aimAt(p.x,p.y+1,p.z),cloud.position);
  await delay(80);
  await a.screenshot({path:`${out}/outside-smoke.png`});
  if(process.argv.includes('--teams')){
    const own=await me(b);check(own.team==='red','second real player has actual server red team');
    const scores=await b.$$eval('.match-team',nodes=>nodes.map(n=>({class:n.className,text:n.textContent})));
    check(scores[0].text==='0'&&scores[1].text==='1','red player sees own score in blue and opponent score in red');
    const names=await b.$$eval('.kill-feed-entry span',nodes=>nodes.map(n=>({text:n.textContent,class:n.className})));
    check(names.some(n=>n.text==='Grenadier'&&n.class.includes('opponent'))&&names.some(n=>n.text==='Crouch Observer'&&n.class.includes('friendly')),'red player sees relative feed colors');
  }
  const beforeResume=await net(a);await a.evaluate(()=>window.__crossfire.networkReconnect());
  await until(async()=>{const n=await net(a);return n.state==='connected'&&n.diagnostics.opens>beforeResume.diagnostics.opens;},'resume with existing cloud');
  check((await a.evaluate(()=>window.__awardEvents)).length===1,'ordinary snapshots and resume do not replay +1');
  check(await a.evaluate(n=>window.__joinEvents.length===n,joinsBefore),'resume does not repeat join announcements');
  // Observe real rendered frames: sequential screenshots/IPC may finish after
  // the seven-second effect, so never expect an expired current cloud to exist.
  const samples=()=>a.evaluate(id=>window.__smokeSamples.filter(c=>c.id===id),cloud.id);
  await until(async()=>(await samples()).some(c=>c.age>=4000&&c.age<=5000&&c.opacity===1),'dense smoke rendered through five seconds');
  check(true,'smoke remains dense before five seconds');
  await until(async()=>(await samples()).some(c=>c.age>=5400&&c.age<7000&&c.opacity>0&&c.opacity<1),'rendered smoke fade');
  check(true,'smoke fades gradually after five seconds');
  if((await a.evaluate(()=>window.__crossfire.grenades())).clouds.length)await a.screenshot({path:`${out}/fading-smoke.png`});
  await until(async()=>(await a.evaluate(()=>window.__crossfire.grenades())).clouds.length===0,'smoke expires after seven seconds');
  const clean=await a.evaluate(()=>window.__crossfire.grenades());
  check(clean.projectiles===0&&clean.particles===0&&clean.clouds.length===0,'projectile, flash and seven-second smoke fully clean up');
  const before=await net(a);await a.evaluate(()=>window.__crossfire.networkReconnect());
  await until(async()=>{const n=await net(a);return n.state==='connected'&&n.diagnostics.opens>before.diagnostics.opens;},'actual reconnect after throw');
  check((await me(a)).grenades===1,'reconnect preserves exactly one earned grenade');
  check((await net(a)).rendered.filter(p=>p.id===b.id).length<=1,'no duplicate remote avatar');
  await until(async()=>await b.$eval('.respawn-button',e=>!e.disabled),'respawn becomes available');
  await b.click('.respawn-button');await until(async()=>(await b.evaluate(()=>window.__crossfire.state()))==='playing','mouse respawn');
  check((await me(b)).grenades===1,'respawn restores the grenade HUD');
  const extra=process.argv.includes('--multikill')?await open('Second actual target'):null;
  if(extra){await room.placeForCombatTest(b.id,arena.center);await b.evaluate(()=>window.__crossfire.look(0,-80));await delay(250);}
  await b.bringToFront();await delay(300);
  const button=await b.$('.grenade-count'),bounds=await button.boundingBox();
  await b.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await b.mouse.down();await delay(1800);
  check((await me(b)).grenades===1,'mouse held for full charge still waits for release');
  check(await b.$eval('.grenade-charge',e=>Number(e.style.getPropertyValue('--charge'))>.95),'full charge caps the ring');
  await b.mouse.up();
  await until(async()=>(await me(b)).grenades===0,'HUD mouse throw reaches server');
  check((await b.evaluate(()=>window.__crossfire.grenades())).projectiles===1,'mouse-accessible HUD throw');
  if(extra){
    const second=await until(async()=>{const g=(await room.snapshotForTest()).grenades[0];return g&&Date.now()-g.at>1350?g:null;},'second real projectile');
    const blastAt=[second.position.x,arena.center[1],second.position.z];
    await room.placeForCombatTest(a.id,blastAt);await room.placeForCombatTest(extra.id,blastAt);
    await room.placeForCombatTest(b.id,await room.smokeObservationForTest(second.position));
    await until(async()=>(await me(b)).kills===2,'real two-opponent grenade elimination');
    const awards=await b.evaluate(()=>window.__awardEvents);
    check(awards.length===2&&Math.abs(awards[0].left-awards[1].left)>=26,'simultaneous live rewards use separated HUD lanes');
    check((await me(b)).grenades===2&&(await me(b)).score===220,'real browser accepts inventory above one and correct combo score');
    await b.screenshot({path:`${out}/multi-kill-rewards.png`});
  }
  if(process.argv.includes('--teams')){
    await room.advanceMapForTest();
    await until(()=>b.$eval('#results.visible',()=>true).catch(()=>false),'actual end-of-round results');
    const result=await b.evaluate(()=>({outcome:document.querySelector('.result-title').textContent,winner:document.querySelector('.result-winner').textContent,
      boards:[...document.querySelectorAll('.result-board')].map(e=>({team:e.dataset.team,text:e.textContent})),mvp:document.querySelector('.result-mvp').className}));
    check(result.outcome==='DEFEAT'&&result.winner==='RED TEAM WINS','red player defeat and winner labels preserve authoritative outcome');
    check(result.boards[0].team==='blue'&&result.boards[0].text.includes('Crouch Observer')&&result.mvp.includes('opponent'),'results and MVP use relative colors');
    await delay(800);
    await b.screenshot({path:`${out}/red-player-results.png`});
  }
  await b.evaluate(()=>window.__crossfire.networkLeave());
  const left=await b.evaluate(()=>window.__crossfire.grenades());
  check(left.projectiles===0&&left.particles===0,'intentional leave clears grenade visuals');
  await until(async()=>(await net(a)).snapshot.grenades.length===0,'released grenade finishes after owner leaves');
  check(errors.length===0,`no browser or asset errors (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,smokeSamples:await samples(),lowered,peer,throwing,dead,clean,blastVisual,errors},null,2));
  }
} catch(error) {
  const failures=[];
  for(const [i,page] of (await browser?.pages()??[]).entries()) {
    if(!await page.evaluate(()=>!!window.__crossfire).catch(()=>false))continue;
    failures.push(await page.evaluate(()=>({stats:window.__crossfire.stats(),events:window.__grenadeEvents,motion:window.__crossfire.motion(),network:window.__crossfire.network(),state:window.__crossfire.state(),grenades:window.__crossfire.grenades()})));
    await page.screenshot({path:`${out}/failure-${i}.png`}).catch(()=>{});
  }
  fs.writeFileSync(`${out}/failure.json`,JSON.stringify(failures,null,2));throw error;
} finally {await browser?.close();await fixture.dispose();}
