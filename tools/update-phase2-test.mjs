/** Two real Chrome contexts against the local authoritative Worker, plus map screenshots. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';

const base=process.argv[2]??'http://127.0.0.1:4199/';
const out=process.env.CROSSFIRE_TEST_OUTPUT??'test-results/update-phase2';fs.mkdirSync(out,{recursive:true});
const check=(v,label)=>{assert.ok(v,label);console.log(`PASS ${label}`);};
const until=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(60);}throw new Error(`Timeout: ${label}`);};
const fixture=new Miniflare(convertV4MiniflareOptions({name:'update-phase2',
  modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},
    {type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],
  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
  resourcePersistencePath:fs.mkdtempSync('server/.wrangler/update-phase2-'),
  durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:new URL(base).origin},log:new Log(LogLevel.ERROR)}));
let browser;const errors=[],results=[];
try {
  const backend=(await fixture.ready).href,ns=await fixture.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
  let round=await room.advanceMapForTest();while(round.mapId!=='industrial-complex')round=await room.advanceMapForTest();
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
    timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},
    args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  async function open(name) {
    const context=await browser.createBrowserContext(),page=await context.newPage();
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
    await page.evaluateOnNewDocument(backend=>{
      const Socket=window.WebSocket;
      window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);}};
      const fetch=window.fetch;
      window.fetch=(input,init)=>fetch(new URL(String(input),location.href).pathname==='/presence'?new URL('/presence',backend):input,init);
    },backend);
    await page.goto(`${base}?multiplayer&autoplay&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});
    await completeGuestProfile(page,name);
    await page.waitForFunction(()=>window.__crossfire.ready()||document.querySelector('#start.visible .btn.primary:not(:disabled)'),{timeout:240000});
    if(!await page.evaluate(()=>window.__crossfire.ready()))await page.click('#start .btn.primary');
    await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});
    page.id=await page.evaluate(()=>window.__crossfire.network().selfId);return page;
  }
  if(!process.argv.includes('--visuals-only')) {
  const a=await open('Climber'),b=await open('Ladder Observer');
  const state=p=>p.evaluate(()=>window.__crossfire.network());
  const layout=JSON.parse(fs.readFileSync('src/maps/industrial-complex/layout.json','utf8'));
  await room.placeForCombatTest(b.id,[0,0,10.2],0);
  await a.evaluate(()=>{const s=window.__crossfire.settings();window.__crossfire.setSetting({keyBindings:{...s.keyBindings,forward:['KeyI'],back:['KeyK']}});});
  for(const l of layout.ladders) {
    // Drain the previous real key release/friction before a test-only relocation.
    await delay(500);
    const position=[l.wall[0]+l.out[0]*2.6,l.bottom,l.wall[1]+l.out[1]*2.6];
    const heading=Math.atan2(-l.out[0],l.out[1])*180/Math.PI;
    await room.placeForCombatTest(a.id,position,heading);
    await until(async()=>{const p=await a.evaluate(()=>window.__crossfire.player());return Math.hypot(p.x-position[0],p.z-position[2])<.15;},'authoritative starting position');
    // Prediction intentionally preserves local mouse look on corrections; the
    // arena fixture must not be mistaken for a command to turn the browser view.
    await a.evaluate(h=>window.__crossfire.look(h,0),heading);
    await a.bringToFront();await a.keyboard.down('i');
    await until(async()=>(await a.evaluate(()=>window.__crossfire.player())).y>1.2,`${l.id} climbs with rebound forward`);
    await a.keyboard.up('i');await delay(400);
    const held=await a.evaluate(()=>window.__crossfire.motion());await delay(450);
    const paused=await a.evaluate(()=>window.__crossfire.motion());
    check(Math.abs(paused.position.y-held.position.y)<.03,`${l.id}: release holds the climb height`);
    const peer=await until(async()=>{const s=await state(b);const p=s.rendered.find(p=>p.id===a.id);return p&&Math.abs(p.y-paused.position.y)<.12?p:null;},'remote renders vertical motion');
    const net=await state(a),authority=net.snapshot.players.find(p=>p.id===a.id);
    check(Math.abs(authority.motion.position.y-paused.position.y)<.08,`${l.id}: predicted and server height agree`);
    results.push({id:l.id,held:paused,peer,authority});
    if(l.id==='loading_west') {
      await b.evaluate(()=>window.__crossfire.aimAt(.35,2.5,8.4));await delay(300);
      await b.screenshot({path:`${out}/remote-climb.png`});
      await a.screenshot({path:`${out}/first-person-climb.png`});
      const id=a.id,life=authority.life,health=authority.health,opens=net.diagnostics.opens;
      await a.evaluate(()=>window.__crossfire.networkReconnect());
      await until(async()=>{const n=await state(a);return n.state==='connected'&&n.diagnostics.opens>opens;},'real reconnect');
      await delay(500);const resumed=await state(a),self=resumed.snapshot.players.find(p=>p.id===id);
      check(resumed.selfId===id&&self.life===life&&self.health===health&&Math.abs(self.motion.position.y-paused.position.y)<.03,
        'real mid-ladder reconnect preserves identity, life, health and height');
      check((await state(b)).rendered.filter(p=>p.id===id).length===1,'reconnect has exactly one remote avatar');
    }
    await a.keyboard.down('i');
    await until(async()=>{const p=await a.evaluate(()=>window.__crossfire.player());return p.grounded&&Math.abs(p.y-l.top)<.03;},`${l.id} steps onto roof`);
    await a.keyboard.up('i');await delay(250);
    check((await state(a)).state==='connected',`${l.id}: connection stays active on roof`);
    await a.keyboard.down('k');
    await until(async()=>{const p=await a.evaluate(()=>window.__crossfire.player());return p.grounded&&p.y<.03;},`${l.id} descends to ground`);
    await a.keyboard.up('k');
  }
  // Release both live map renderers before high-quality geometry inspection.
  await a.browserContext().close();await b.browserContext().close();
  }
  // Practice camera changes only, after multiplayer assertions; no fake actors/events.
  const context=await browser.createBrowserContext(),page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${base}?practice&autoplay&quality=high&shadows=high`,{waitUntil:'domcontentloaded',timeout:240000});
  await completeGuestProfile(page,'Geometry Inspector');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
  for(const [id,views] of [
    ['industrial-complex',[[10,9,18,350,-22,'roofs'],[-5.5,.85,-16.6,75,-10,'pipe-west'],[-.5,.85,-17.4,255,-10,'pipe-east'],[.35,2.5,11,0,8,'ladder']]],
    ['european-town',[[6.7,1.65,3.5,90,12,'B22-west'],[17.2,1.65,3.5,270,12,'B22-east'],[4,1.65,-13.5,90,0,'room-wall']]],
    ['modern-city',[[-14,1.7,-12,90,0,'interior'],[14,1.7,-10,90,0,'courtyard']]],
  ]) {
    await page.evaluate(id=>window.__crossfire.play(id),id);await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
    check((await page.evaluate(()=>window.__crossfire.stats())).missingMaterials.length===0,`${id}: materials intact`);
    if(id==='european-town') {
      await page.evaluate(()=>window.__crossfire.setSetting({graphicsQuality:'low',shadowQuality:'off',resolutionScale:.6}));
      await delay(300);
      for(const reverse of [false,true]) {
      await page.evaluate(reverse=>window.__crossfire.teleport(reverse?14.8:9.2,0,3.5,reverse?270:90,0),reverse);
      await page.evaluate(()=>window.__crossfire.hold('forward',true));await delay(200);
      await page.evaluate(()=>window.__crossfire.hold('jump',true));
      await until(async()=>{const p=await page.evaluate(()=>window.__crossfire.motion());return !p.grounded&&p.velocity.y>0;},'actual jump takes off',3000);
      await page.evaluate(()=>window.__crossfire.hold('jump',false));
      let peak=0;const end=Date.now()+8000;
      while(Date.now()<end){const p=await page.evaluate(()=>window.__crossfire.player());peak=Math.max(peak,p.y);if(p.grounded&&(reverse?p.x<9.5:p.x>14.5))break;await delay(20);}
      await page.evaluate(()=>window.__crossfire.hold('forward',false));
      const p=await page.evaluate(()=>window.__crossfire.player());
      check(peak>1.02&&(reverse?p.x<9.5:p.x>14.5),`B22 arcade: full-height jump passes ${reverse?'westbound':'eastbound'} (peak ${peak.toFixed(3)}m, x ${p.x.toFixed(2)})`);
      }
      await page.evaluate(()=>window.__crossfire.setSetting({graphicsQuality:'high',shadowQuality:'high',resolutionScale:1}));
    }
    for(const [x,y,z,h,p,label] of views){await page.evaluate((x,y,z,h,p)=>window.__crossfire.freeCam(x,y,z,h,p),x,y,z,h,p);await delay(900);await page.screenshot({path:`${out}/${id}-${label}.png`});}
  }
  check(errors.length===0,`no asset or browser errors (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));
} catch(error) {
  const failures=[];
  for(const [i,page] of (await browser?.pages()??[]).entries()) {
    if(!await page.evaluate(()=>!!window.__crossfire).catch(()=>false))continue;
    failures.push(await page.evaluate(()=>({motion:window.__crossfire.motion(),network:window.__crossfire.network(),state:window.__crossfire.state()})));
    await page.screenshot({path:`${out}/failure-${i}.png`}).catch(()=>{});
  }
  fs.writeFileSync(`${out}/failure.json`,JSON.stringify(failures,null,2));throw error;
} finally {await browser?.close();await fixture.dispose();}
