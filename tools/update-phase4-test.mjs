/** Actual Chrome clients + local authoritative workerd, including production base paths. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';

const base=process.argv[2]??'http://127.0.0.1:4199/';
const out=process.env.CROSSFIRE_TEST_OUTPUT??'test-results/update-phase4';fs.mkdirSync(out,{recursive:true});
const check=(v,label)=>{assert.ok(v,label);console.log(`PASS ${label}`);};
const until=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(50);}throw new Error(`Timeout: ${label}`);};
const fixture=new Miniflare(convertV4MiniflareOptions({name:'update-phase4',
  modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},
    {type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],
  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
  resourcePersistencePath:fs.mkdtempSync('server/.wrangler/update-phase4-'),
  durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:new URL(base).origin},log:new Log(LogLevel.ERROR)}));
let browser;const errors=[],results=[];
try{
  const backend=(await fixture.ready).href,ns=await fixture.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
  let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
    timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},
    args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  async function open(name,practice=false){
    const context=await browser.createBrowserContext(),page=await context.newPage();
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('dialog',d=>d.accept());
    page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
    await page.evaluateOnNewDocument(backend=>{
      const Socket=window.WebSocket;
      window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);}};
      const fetch=window.fetch;
      window.fetch=(input,init)=>fetch(['/presence','/profile'].includes(new URL(String(input),location.href).pathname) ? new URL(new URL(String(input),location.href).pathname, backend):input,init);
    },backend);
    await page.goto(`${base}?${practice?'practice':'multiplayer'}&autoplay&map=european-town&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});
    await completeGuestProfile(page,name);
    await page.waitForFunction(()=>window.__crossfire.ready()||document.querySelector('#weapons.visible .weapon-card:not(:disabled)'),{timeout:240000});
    if(!await page.evaluate(()=>window.__crossfire.ready()))await page.click('#weapons .weapon-card[data-weapon="rifle"]');
    await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});
    if(!practice)page.id=await page.evaluate(()=>window.__crossfire.network().selfId);return page;
  }
  const a=await open('Fruit Tester'),b=await open('Physics Observer');
  const props=p=>p.evaluate(()=>window.__crossfire.environmentProps());
  const state=p=>p.evaluate(()=>window.__crossfire.environmentState());
  const network=p=>p.evaluate(()=>window.__crossfire.network());
  check((await props(a)).count===14&&(await props(b)).count===14,'nine apples/pears, two loose props, two signs and one hanging light on both clients');
  const before=await props(a);await delay(500);
  check((await props(a)).seq===before.seq,'resting props produce no extra transform messages');
  const definition=(await room.environmentForTest()).definition;
  const apple=definition.bodies[0],sign=definition.signs[0];
  async function target(page,id,oblique=false){const aim=await room.environmentTargetForTest(id,oblique);await room.placeForCombatTest(page.id,aim.position);
    await until(async()=>{const p=(await network(page)).snapshot.players.find(p=>p.id===page.id).motion.position;
      return Math.hypot(p.x-aim.position[0],p.z-aim.position[2])<.1;},'actual placement');
    await page.evaluate(t=>window.__crossfire.aimAt(...t),aim.target);await delay(350);return aim;}
  const aim=await target(a,apple.id);
  await room.placeForCombatTest(b.id,[aim.position[0]+.6,aim.position[1],aim.position[2]+.6]);
  await b.evaluate(t=>window.__crossfire.aimAt(...t),aim.target);await delay(250);
  await a.screenshot({path:`${out}/fruit-stand.png`});
  const close=aim.position.map((v,i)=>i===1?v:v+(aim.target[i]-v)*.45);
  await room.placeForCombatTest(a.id,close);await delay(250);await a.evaluate(t=>window.__crossfire.aimAt(...t),aim.target);await delay(200);
  await a.screenshot({path:`${out}/fruit-pile-close.png`});
  await room.placeForCombatTest(a.id,aim.position);await delay(250);await a.evaluate(t=>window.__crossfire.aimAt(...t),aim.target);await delay(200);
  const initial=(await state(b)).states.find(s=>s.id===apple.id);
  await a.evaluate(()=>window.__crossfire.hold('fire',true));
  await until(async()=>(await state(b)).states.some(s=>s.id===apple.id&&!s.asleep),'confirmed shot wakes apple');
  await a.evaluate(()=>window.__crossfire.hold('fire',false));
  await a.screenshot({path:`${out}/apple-shot.png`});
  await until(async()=>!(await room.environmentForTest()).active,'props settle');await delay(300);
  const aa=await state(a),bb=await state(b);
  check(JSON.stringify(aa.states)===JSON.stringify(bb.states),'both browser clients receive identical settled authoritative poses');
  check(JSON.stringify(bb.states.find(s=>s.id===apple.id).position)!==JSON.stringify(initial.position),'shot changes the actual apple position');
  const displayed=await props(b),settled=bb.states.find(s=>s.id===apple.id),visible=displayed.states.find(s=>s.id===apple.id).position;
  check(Math.hypot(visible[0]-settled.position.x,visible[1]-settled.position.y,visible[2]-settled.position.z)<.01,'rendered instance converges to the server pose');
  const beforeReconnect=await network(a);await a.evaluate(()=>window.__crossfire.networkReconnect());
  await until(async()=>{const n=await network(a);return n.state==='connected'&&n.diagnostics.opens>beforeReconnect.diagnostics.opens;},'real transport reconnect');
  check((await state(a)).states.length===14,'resume restores exactly one copy of every prop');
  check(JSON.stringify((await state(a)).states.find(s=>s.id===apple.id).position)===JSON.stringify(settled.position),'resume preserves the moved apple');
  await delay(5100); // Existing short reconnect toast expires before visual inspection.
  const signAim=await target(a,sign.id,true);await a.screenshot({path:`${out}/sign-rest.png`});
  await a.evaluate(()=>window.__crossfire.hold('fire',true));
  await until(async()=>Math.abs((await state(b)).states.find(s=>s.id===sign.id).angle)>.16,'selected original sign panel visibly swings');
  await a.evaluate(()=>window.__crossfire.hold('fire',false));await a.screenshot({path:`${out}/sign-shot.png`});
  await until(async()=>!(await room.environmentForTest()).active,'sign returns to rest');await delay(250);
  check((await state(b)).states.find(s=>s.id===sign.id).angle===0,'hinge returns fully to rest without detaching');
  const light=definition.lights[0],lightAim=await target(a,light.id);
  await a.screenshot({path:`${out}/light-rest.png`});
  const lightBefore=(await props(a)).lights[0].position;
  await a.evaluate(()=>window.__crossfire.hold('fire',true));
  await until(async()=>Math.abs((await state(b)).states.find(s=>s.id===light.id).angle)>.08,'confirmed light hit swings on the observer');
  await a.evaluate(()=>window.__crossfire.hold('fire',false));await delay(110);
  const lightMoving=(await props(a)).lights[0];
  check(!lightMoving.shadow,'swinging light uses no dynamic shadows');
  check(Math.hypot(...lightMoving.position.map((v,i)=>v-lightBefore[i]))>.02,'actual light source follows the moving fixture');
  await a.screenshot({path:`${out}/light-shot.png`});
  await until(async()=>!(await room.environmentForTest()).active,'light settles');
  results.push({map:round.mapId,before,displayed,stats:await a.evaluate(()=>window.__crossfire.stats()),signAim});
  const visited=new Set([round.mapId]);
  while(visited.size<3){
    round=await room.advanceMapForTest();if(visited.has(round.mapId))continue;visited.add(round.mapId);
    for(const p of [a,b]){
      await p.waitForFunction(()=>document.querySelector('#results.visible'),{timeout:120000});
      await p.click('#results .btn.primary');
      await p.waitForFunction(()=>window.__crossfire.ready()||document.querySelector('#weapons.visible .weapon-card:not(:disabled)'),{timeout:120000});
      if(!await p.evaluate(()=>window.__crossfire.ready()))await p.click('#weapons .weapon-card[data-weapon="rifle"]');
      await p.waitForFunction(()=>window.__crossfire.ready(),{timeout:120000});
    }
    const env=await room.environmentForTest(),loose=env.definition.bodies[0],looseAim=await target(a,loose.id);
    check((await props(a)).count===3,`${round.mapId}: two small movable props and one light; no old map objects`);
    await a.screenshot({path:`${out}/${round.mapId}.png`});
    await a.evaluate(()=>window.__crossfire.hold('fire',true));
    await until(async()=>(await state(b)).states.some(s=>s.id===loose.id&&!s.asleep),'loose prop receives shot');
    await a.evaluate(()=>window.__crossfire.hold('fire',false));
    await until(async()=>!(await room.environmentForTest()).active,'loose prop settles');
    results.push({map:round.mapId,props:await props(a),stats:await a.evaluate(()=>window.__crossfire.stats()),looseAim});
  }
  check((await network(a)).diagnostics.opens===beforeReconnect.diagnostics.opens+1,'only the requested reconnection during the test');
  await a.browserContext().close();await b.browserContext().close();
  const practice=await open('Practice Physics',true);
  await practice.evaluate(p=>window.__crossfire.teleport(...p),aim.position);await delay(200);
  await practice.evaluate(t=>window.__crossfire.aimAt(...t),aim.target);await delay(250);
  const original=(await props(practice)).states.find(s=>s.id===apple.id).position;
  await practice.evaluate(()=>window.__crossfire.hold('fire',true));
  await until(async()=>(await props(practice)).active>0,'practice shot runs the same shared physics');
  await practice.evaluate(()=>window.__crossfire.hold('fire',false));
  await until(async()=>(await props(practice)).active===0,'practice props sleep');
  check(JSON.stringify((await props(practice)).states.find(s=>s.id===apple.id).position)!==JSON.stringify(original),'practice apple moves and settles without a server');
  await practice.screenshot({path:`${out}/practice.png`});
  results.push({map:'practice',props:await props(practice),stats:await practice.evaluate(()=>window.__crossfire.stats())});
  check(errors.length===0,`no browser/asset errors (${errors.length})`);
  fs.writeFileSync(`${out}/results.json`,JSON.stringify({base,results,errors},null,2));
}catch(error){
  for(const [i,page] of (await browser?.pages()??[]).entries()){
    await page.screenshot({path:`${out}/failure-${i}.png`}).catch(()=>{});
    const data=await page.evaluate(()=>({state:window.__crossfire?.state(),network:window.__crossfire?.network(),props:window.__crossfire?.environmentProps(),env:window.__crossfire?.environmentState()})).catch(()=>null);
    fs.writeFileSync(`${out}/failure-${i}.json`,JSON.stringify(data,null,2));
  }throw error;
}finally{await browser?.close();await fixture.dispose();}
