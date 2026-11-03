/** Two real Chrome contexts against the local authoritative Worker, plus map screenshots. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';

const base=process.argv[2]??'http://127.0.0.1:4199/';
const out=process.env.CROSSFIRE_TEST_OUTPUT??'test-results/update-phase3';fs.mkdirSync(out,{recursive:true});
const check=(v,label)=>{assert.ok(v,label);console.log(`PASS ${label}`);};
const until=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(60);}throw new Error(`Timeout: ${label}`);};
const fixture=new Miniflare(convertV4MiniflareOptions({name:'update-phase3',
  modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},
    {type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],
  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
  resourcePersistencePath:fs.mkdtempSync('server/.wrangler/update-phase3-'),
  durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:new URL(base).origin},log:new Log(LogLevel.ERROR)}));
let browser;const errors=[],results=[];
try {
  const backend=(await fixture.ready).href,ns=await fixture.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
  let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
    timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},
    args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  async function open(name) {
    const context=await browser.createBrowserContext(),page=await context.newPage();
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
    await page.evaluateOnNewDocument((backend,capture)=>{
      // Optional screenshot gate: pause only presentation RAF after the first real explosion frame.
      const nativeRAF=window.requestAnimationFrame.bind(window),waiting=[];
      let armed=false,paused=false,exploded=false;
      window.__grenadeCapture={arm:()=>{armed=capture;},resume:()=>{
        armed=paused=exploded=false;for(const callback of waiting.splice(0))nativeRAF(callback);
      }};
      window.requestAnimationFrame=callback=>nativeRAF(t=>{
        if(paused){waiting.push(callback);return;}callback(t);
        if(armed&&exploded)paused=true;
      });
      const Socket=window.WebSocket;
      window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(armed&&m.type==='grenade'&&m.event.kind==='explode')exploded=true;}catch{}});}};
      const fetch=window.fetch;
      window.fetch=(input,init)=>fetch(new URL(String(input),location.href).pathname==='/presence'?new URL('/presence',backend):input,init);
    },backend,process.argv.includes('--capture-fx'));
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});
    await completeGuestProfile(page,name);
    await page.waitForFunction(()=>window.__crossfire.ready()||document.querySelector('#weapons.visible .weapon-card:not(:disabled)'),{timeout:240000});
    if(!await page.evaluate(()=>window.__crossfire.ready()))await page.click('#weapons .weapon-card[data-weapon="rifle"]');
    await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});
    page.id=await page.evaluate(()=>window.__crossfire.network().selfId);return page;
  }
  const a=await open('Grenadier'),b=await open('Crouch Observer');
  const net=p=>p.evaluate(()=>window.__crossfire.network());
  const me=async p=>{const n=await net(p);return n.snapshot.players.find(q=>q.id===p.id);};
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
  check(blastVisual.particles<=128&&(!process.argv.includes('--capture-fx')||blastVisual.samples.some(p=>p.flash&&p.size>=.75*Math.sqrt(10))),
    'tenfold flash area uses the existing bounded particle batch');
  if(process.argv.includes('--capture-fx'))check(blastVisual.samples.some(p=>p.flash&&p.color[3]>.5),'new flash survives a slow preceding frame');
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
  await delay(7200);const clean=await a.evaluate(()=>window.__crossfire.grenades());
  check(clean.projectiles===0&&clean.particles===0&&clean.clouds.length===0,'projectile, flash and seven-second smoke fully clean up');
  const before=await net(a);await a.evaluate(()=>window.__crossfire.networkReconnect());
  await until(async()=>{const n=await net(a);return n.state==='connected'&&n.diagnostics.opens>before.diagnostics.opens;},'actual reconnect after throw');
  check((await me(a)).grenades===1,'reconnect preserves exactly one earned grenade');
  check((await net(a)).rendered.filter(p=>p.id===b.id).length<=1,'no duplicate remote avatar');
  await until(async()=>await b.$eval('.respawn-button',e=>!e.disabled),'respawn becomes available');
  await b.click('.respawn-button');await until(async()=>(await b.evaluate(()=>window.__crossfire.state()))==='playing','mouse respawn');
  check((await me(b)).grenades===1,'respawn restores the grenade HUD');
  await delay(300);await b.click('.grenade-count');
  await until(async()=>(await me(b)).grenades===0,'HUD mouse throw reaches server');
  check((await b.evaluate(()=>window.__crossfire.grenades())).projectiles===1,'mouse-accessible HUD throw');
  await b.evaluate(()=>window.__crossfire.networkLeave());
  const left=await b.evaluate(()=>window.__crossfire.grenades());
  check(left.projectiles===0&&left.particles===0,'intentional leave clears grenade visuals');
  await until(async()=>(await net(a)).snapshot.grenades.length===0,'released grenade finishes after owner leaves');
  check(errors.length===0,`no browser or asset errors (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({lowered,peer,throwing,dead,clean,blastVisual,errors},null,2));
} catch(error) {
  const failures=[];
  for(const [i,page] of (await browser?.pages()??[]).entries()) {
    if(!await page.evaluate(()=>!!window.__crossfire).catch(()=>false))continue;
    failures.push(await page.evaluate(()=>({motion:window.__crossfire.motion(),network:window.__crossfire.network(),state:window.__crossfire.state(),grenades:window.__crossfire.grenades()})));
    await page.screenshot({path:`${out}/failure-${i}.png`}).catch(()=>{});
  }
  fs.writeFileSync(`${out}/failure.json`,JSON.stringify(failures,null,2));throw error;
} finally {await browser?.close();await fixture.dispose();}
