/** Two real Chrome clients and local workerd; no fabricated combat or players. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/',out='test-results/selection-background';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('PASS',label);};
const until=async(fn,label)=>{const end=Date.now()+60000;while(Date.now()<end){const v=await fn();if(v)return v;await delay(80);}throw Error(label);};
const mf=new Miniflare(convertV4MiniflareOptions({name:'selection-background',modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},{type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],
  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,resourcePersistencePath:fs.mkdtempSync('server/.wrangler/selection-'),durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:new URL(base).origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)}));
let browser;
try{
  const backend=(await mf.ready).href,ns=await mf.getDurableObjectNamespace('ROOM'),room=ns.get(ns.idFromName('public-main'));
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  async function open(name,autoplay){
    const context=await browser.createBrowserContext(),p=await context.newPage();p.on('dialog',d=>d.accept());p.on('pageerror',e=>errors.push(String(e)));
    await p.evaluateOnNewDocument(backend=>{
      const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);}};
      const fetch=window.fetch;window.fetch=(input,init)=>fetch(['/presence','/profile'].includes(new URL(String(input),location.href).pathname)?new URL(new URL(String(input),location.href).pathname,backend):input,init);
    },backend);
    await p.goto(`${base}?multiplayer${autoplay?'&autoplay':''}&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});
    await completeGuestProfile(p,name);if(!autoplay)await p.click('#menu .home-actions .primary');
    await p.waitForFunction(()=>window.__crossfire.ready()||document.querySelector('#weapons.visible .weapon-card:not(:disabled)'),{timeout:240000});return p;
  }
  const selector=await open('Choosing Player',false);
  const net=p=>p.evaluate(()=>window.__crossfire.network());
  check((await net(selector)).snapshot.players.every(p=>!p.alive),'selection does not pre-spawn any player');
  check(await selector.evaluate(()=>window.__crossfire.loadingState().networkReady&&window.__crossfire.loadingState().sceneReady),'selection waits for the actual loaded scene');
  const empty1=await selector.evaluate(()=>window.__crossfire.selectionView());await delay(1000);
  const empty2=await selector.evaluate(()=>window.__crossfire.selectionView());
  check(empty2.target===null&&Math.hypot(...empty2.camera.map((v,i)=>v-empty1.camera[i]))>.1,'empty match has a moving cinematic camera');
  const style=await selector.$eval('#weapons',e=>({background:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}));
  check(style.background.startsWith('rgba')&&style.blur.includes('14px'),'selection backdrop is translucent and strongly blurred');
  await selector.screenshot({path:`${out}/empty.png`});
  const active=await open('Actual Active Player',true);await active.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});
  const activeId=(await net(active)).selfId;
  await until(()=>selector.evaluate(id=>window.__crossfire.selectionView().target===id,activeId),'selection tracks actual active session');
  const before=await selector.evaluate(()=>window.__crossfire.selectionView());
  await active.evaluate(()=>window.__crossfire.hold('forward',true));await delay(650);await active.evaluate(()=>window.__crossfire.hold('forward',false));await delay(400);
  const after=await selector.evaluate(()=>window.__crossfire.selectionView());
  check(Math.hypot(...after.camera.map((v,i)=>v-before.camera[i]))>.05,'third-person camera follows synchronized movement');
  await active.evaluate(()=>window.__crossfire.hold('fire',true));await delay(130);await active.evaluate(()=>window.__crossfire.hold('fire',false));
  await until(()=>selector.evaluate(id=>window.__crossfire.network().rendered.find(p=>p.id===id)?.shots.history.length>0,activeId),'real firing reaches the selection character animation');
  check(await selector.evaluate(()=>window.__crossfire.network().rendered.every(p=>!p.labelVisible&&!p.outline)),'selection reveals no labels or through-wall outlines');
  await selector.screenshot({path:`${out}/active-player.png`});
  await active.evaluate(()=>window.__crossfire.networkLeave());
  await until(()=>selector.evaluate(()=>window.__crossfire.selectionView().target===null),'unavailable target returns to cinematic camera');
  const selfId=(await net(selector)).selfId;
  check((await net(selector)).snapshot.players.find(p=>p.id===selfId).life===0,'watching never creates a player life');
  await selector.click('#weapons .weapon-card[data-weapon="shotgun"]');
  await until(async()=>{const n=await net(selector);return n.snapshot.players.find(p=>p.id===n.selfId)?.alive;},'one card click requests a real spawn');
  check((await net(selector)).snapshot.players.find(p=>p.id===selfId).weapon==='shotgun','chosen gun is server approved');
  check(errors.length===0,'no browser errors');fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors},null,2));room[Symbol.dispose]?.();
}finally{await browser?.close();await mf.dispose();}
