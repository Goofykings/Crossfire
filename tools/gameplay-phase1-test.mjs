/** Real production UI and browser transports against the local Worker.
 * npm run build; npm --prefix server run build
 * node tools/serve-dist.mjs --port 4200 --base /crossfire/
 * node tools/gameplay-phase1-test.mjs http://127.0.0.1:4200/crossfire/
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from '../server/node_modules/miniflare/dist/src/index.js';
import { completeGuestProfile } from './guest-profile-helper.mjs';

const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/';
const out='test-results/gameplay-phase1';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log(`PASS ${label}`);};
const until=async(fn,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(70);}throw new Error(`Timeout: ${label}`);};
const fixture=new Miniflare(convertV4MiniflareOptions({name:'gameplay-phase1',
  modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},
    {type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],
  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
  resourcePersistencePath:fs.mkdtempSync('server/.wrangler/gameplay-phase1-'),
  durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:new URL(base).origin},log:new Log(LogLevel.ERROR)}));
let browser;
try {
  const backend=(await fixture.ready).href;
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
    timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},
    args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const open=async name=>{
    const context=await browser.createBrowserContext(),page=await context.newPage();
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
    await page.evaluateOnNewDocument(backend=>{
      const NativeSocket=window.WebSocket;window.__transport={opens:0,spawns:[],sockets:[]};
      window.WebSocket=class extends NativeSocket {
        constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);
          window.__transport.sockets.push(this);this.addEventListener('open',()=>window.__transport.opens++);}
        send(data){const message=JSON.parse(data);if(message.type==='spawn')window.__transport.spawns.push(message);return super.send(data);}
      };
      const nativeFetch=window.fetch;
      window.fetch=(input,init)=>nativeFetch(['/presence','/profile'].includes(new URL(String(input),location.href).pathname) ? new URL(new URL(String(input),location.href).pathname, backend):input,init);
    },backend);
    await page.goto(`${base}?multiplayer&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});
    await completeGuestProfile(page,name);return page;
  };
  const a=await open('Phase One');
  await a.click('.home-nav .nav-button:last-of-type');await a.click('#tab-controls');
  for(const [width,height] of [[1280,720],[640,480],[390,640]]) {
    await a.setViewport({width,height});await delay(220);
    const geometry=()=>a.evaluate(()=>{
      const panel=document.querySelector('#panel-controls'),head=document.querySelector('.settings-head'),foot=document.querySelector('.settings-foot');
      const rect=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
      return {panel:rect(panel),head:rect(head),foot:rect(foot),scroll:panel.scrollTop,height:panel.clientHeight,total:panel.scrollHeight};
    });
    const before=await geometry();check(before.head.top>=0&&before.foot.bottom<=height&&before.height>35,`${width}x${height}: settings heading and footer fit`);
    await a.hover('#panel-controls');await a.mouse.wheel({deltaY:3000});
    await until(async()=> (await geometry()).scroll>before.scroll,'browser applies controls wheel scrolling',10000);
    const after=await geometry();check(after.scroll>before.scroll&&after.foot.top===before.foot.top,`${width}x${height}: controls scroll independently`);
    await a.$eval('.control-reset-all',e=>e.scrollIntoView({block:'center'}));
    const reset=await a.$eval('.control-reset-all',e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
    check(reset.top>=after.panel.top&&reset.bottom<=after.panel.bottom,`${width}x${height}: final control is accessible`);
    await a.screenshot({path:`${out}/controls-${width}x${height}.png`});
    await a.$eval('#panel-controls',e=>{e.scrollTop=0;});
  }
  await a.setViewport({width:1280,height:720});
  await a.$eval('[aria-label="Rebind Reload"]',e=>e.scrollIntoView({block:'center'}));
  await a.click('[aria-label="Rebind Reload"]');await a.keyboard.press('l');await a.click('.settings-foot .primary');
  check((await a.evaluate(()=>window.__crossfire.settings())).keyBindings.reload[0]==='KeyL','custom reload applies');
  await a.click('[aria-label="Reset Reload"]');await a.click('.settings-foot .primary');
  check((await a.evaluate(()=>window.__crossfire.settings())).keyBindings.reload[0]==='KeyR','individual reset restores R reload');
  await a.click('.settings-foot .btn:nth-last-child(2)');
  await a.click('#menu .home-actions .primary');await a.waitForSelector('#weapons.visible',{timeout:240000});
  await a.click('.weapon-back');await until(()=>a.evaluate(()=>window.__crossfire.state()==='menu'),'cancel prepared loadout selection');
  await delay(300);
  check(await a.evaluate(()=>window.__transport.spawns.length===0&&window.__transport.sockets.every(s=>s.readyState>=2)),
    'Back cancels loading and the real connection without spawning');
  const join=async(page,weapon)=>{
    const baseline=await page.evaluate(()=>({opens:window.__transport.opens,spawns:window.__transport.spawns.length}));
    await page.bringToFront();await page.click('#menu .home-actions .primary');
    await page.waitForSelector('#weapons.visible',{timeout:240000});
    const pending=await page.evaluate(()=>({network:window.__crossfire.network(),transport:{opens:window.__transport.opens,spawns:window.__transport.spawns.length}}));
    const self=pending.network.snapshot.players.find(p=>p.id===pending.network.selfId);
    check(!self.alive&&self.weapon===null&&pending.transport.spawns===baseline.spawns,`${weapon}: joining waits for selection without spawning`);
    await page.hover(`.weapon-card[data-weapon="${weapon}"]`);await delay(220);
    const hover=await page.$eval(`.weapon-card[data-weapon="${weapon}"]`,e=>({transform:getComputedStyle(e).transform,border:getComputedStyle(e).borderWidth}));
    check(hover.transform!=='none'&&hover.border==='0px',`${weapon}: borderless card has smooth hover scaling`);
    await page.screenshot({path:`${out}/select-${weapon}.png`});
    await page.click(`.weapon-card[data-weapon="${weapon}"]`);
    await until(()=>page.evaluate(()=>window.__crossfire.state()==='playing'),'selection spawns directly');
    const spawned=await page.evaluate(()=>{const n=window.__crossfire.network();return {self:n.snapshot.players.find(p=>p.id===n.selfId),requests:window.__transport.spawns.length,opens:window.__transport.opens};});
    check(spawned.self.alive&&spawned.self.weapon===weapon&&spawned.self.life===1&&spawned.requests===baseline.spawns+1&&spawned.opens===baseline.opens+1,`${weapon}: one connection and one authoritative spawn`);
  };
  await join(a,'rifle');
  // Real pointer lock and keyboard input; no fabricated ammo or client state.
  await a.click('#game');await a.keyboard.down('j');await delay(300);await a.keyboard.up('j');
  const gun=()=>a.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).combat.gun;});
  await until(async()=>{const g=await gun();return g.ammo>0&&g.ammo<30;},'keyboard fire consumes only part of magazine');
  await a.keyboard.press('r');await until(async()=>(await gun()).action==='reload','R begins authoritative partial reload');
  await until(async()=>(await gun()).ammo===30,'partial reload fills magazine');check(true,'J fires and R reloads a partial magazine on server');
  await a.evaluate(()=>window.__crossfire.pause());await a.click('#pause .menu-buttons .btn:nth-child(2)');await a.click('#tab-controls');
  await a.setViewport({width:640,height:480});await a.hover('#panel-controls');await a.mouse.wheel({deltaY:3000});await delay(250);
  check(await a.evaluate(()=>{const panel=document.querySelector('#panel-controls'),footer=document.querySelector('.settings-foot').getBoundingClientRect();return panel.scrollTop>0&&footer.bottom<=innerHeight;}),
    'pause Controls scrolls at 640x480 with visible footer');
  check((await gun()).ammo===30,'settings wheel does not change gameplay ammo or weapon');
  await a.screenshot({path:`${out}/pause-controls-640x480.png`});
  await a.click('.settings-foot .btn:nth-last-child(2)');await a.setViewport({width:1280,height:720});await a.click('#pause .leave-match');
  // Separate real sessions cover all four selection cards; clean leave between them.
  for(const weapon of ['shotgun','sniper','smg']) {
    const page=await open(`Select ${weapon}`);await join(page,weapon);
    await page.evaluate(()=>window.__crossfire.pause());await page.click('#pause .leave-match');await page.close();
  }
  check(errors.length===0,`no browser exceptions or asset failures: ${errors.join('; ')}`);
  fs.writeFileSync(`${out}/result.json`,JSON.stringify({checks,errors},null,2));
} catch(error) {
  for(const [index,page] of (await browser?.pages()??[]).entries()) {
    await page.screenshot({path:`${out}/failure-${index}.png`}).catch(()=>{});
    console.log(await page.evaluate(()=>{const n=window.__crossfire?.network();return {screen:document.body.dataset.screen,state:window.__crossfire?.state(),pointerLocked:!!document.pointerLockElement,self:n?.snapshot?.players.find(p=>p.id===n.selfId)?.combat};}).catch(()=>null));
  }
  fs.writeFileSync(`${out}/result.json`,JSON.stringify({checks,errors,failure:String(error)},null,2));throw error;
} finally { await browser?.close();await fixture.dispose(); }
