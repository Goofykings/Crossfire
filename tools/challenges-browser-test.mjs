/** Production UI and real local Worker. Seeds near-complete objectives as explicit test preconditions. */

import assert from 'node:assert/strict';

import fs from 'node:fs';

import {fileURLToPath} from 'node:url';

import {setTimeout as delay} from 'node:timers/promises';

import puppeteer from 'puppeteer-core';

import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';

import {completeGuestProfile} from './guest-profile-helper.mjs';

const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/',out='test-results/challenges';fs.mkdirSync(out,{recursive:true});

const checks=[],errors=[];const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log(`PASS ${label}`);};

const until=async(fn,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(70);}throw Error('Timeout: '+label);};

const fixture=new Miniflare(convertV4MiniflareOptions({name:'challenge-browser',

  modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},{type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],

  compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,

  resourcePersistencePath:fs.mkdtempSync('server/.wrangler/challenge-browser-'),durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},

  bindings:{ALLOWED_ORIGINS:new URL(base).origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)}));

let browser,room;

try{

  const backend=(await fixture.ready).href,ns=await fixture.getDurableObjectNamespace('ROOM');room=ns.get(ns.idFromName('public-main'));

  let round=await room.advanceMapForTest();while(round.mapId!=='european-town')round=await room.advanceMapForTest();

  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,

    timeout:120000,protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});

  const open=async name=>{

    const context=await browser.createBrowserContext(),page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));

    page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${new URL(r.url()).pathname}`);});

    await page.evaluateOnNewDocument(backend=>{

      const Socket=window.WebSocket;window.__sockets=[];

      window.WebSocket=class extends Socket{constructor(url,protocols){super(new URL(String(url)).pathname==='/ws'?new URL('/ws',backend).href.replace('http:','ws:'):url,protocols);window.__sockets.push(this);}};

      const realFetch=window.fetch;window.__profileRequests=[];

      window.fetch=(input,init)=>{const path=new URL(String(input),location.href).pathname;if(path==='/profile')window.__profileRequests.push(init?.method??'GET');

        return realFetch(['/presence','/profile'].includes(path)?new URL(path,backend):input,init);};

    },backend);

    await page.goto(`${base}?multiplayer&quality=low&shadows=off&scale=.6`,{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,name);

    await page.waitForSelector('.challenges-panel[data-available="true"]',{timeout:60000});await until(()=>page.$eval('.home-gems span',e=>e.textContent==='0'),'balance paint');return page;

  };

  const a=await open('Challenge Hero');

  check(await a.$$eval('.challenge-card:not([hidden])',cards=>cards.length===3),'exactly three daily cards');

  check(await a.$eval('#challenge-tab-daily',e=>e.getAttribute('aria-selected')==='true'),'Daily selected by default');

  check(await a.$eval('.home-gems span',e=>e.textContent==='0'),'actual new balance is zero');

  check(await a.evaluate(()=>window.__sockets.length===0),'home challenges do not create a multiplayer connection');

  const daily=await a.$$eval('.challenge-card',cards=>cards.map(c=>c.dataset.challengeId));

  await a.click('#challenge-tab-weekly');

  check(await a.$$eval('.challenge-card:not([hidden])',cards=>cards.length===3&&cards.every(c=>c.dataset.challengeId.startsWith('weekly:'))),'weekly tab shows exactly three weekly objectives');

  await a.keyboard.press('ArrowLeft');check(await a.$eval('#challenge-tab-daily',e=>e.getAttribute('aria-selected')==='true'),'tabs support keyboard navigation');

  check(JSON.stringify(await a.$$eval('.challenge-card',cards=>cards.map(c=>c.dataset.challengeId)))===JSON.stringify(daily),'switching back retains the same daily selection');

  for(const [width,height] of [[1280,720],[900,600],[640,480],[390,640],[320,568]]){

    await a.setViewport({width,height});await delay(220);

    const geometry=await a.evaluate(()=>{

      const rect=q=>{const r=document.querySelector(q).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};

      return {panel:rect('.challenges-panel'),play:rect('.home-actions'),account:rect('.home-account'),logo:rect('.logo'),body:rect('.challenge-list'),name:rect('.home-account-name'),gems:rect('.home-gems')};

    });

    check(geometry.panel.x>=0&&geometry.panel.right<=width&&geometry.panel.bottom<=height&&geometry.body.height>15,`${width}x${height}: challenges fit and remain accessible`);

    check(geometry.panel.right<=geometry.play.x||geometry.panel.bottom<=geometry.play.y||geometry.play.right<=geometry.panel.x,`${width}x${height}: panel does not obstruct Play`);

    check(geometry.name.bottom<=geometry.gems.y&&geometry.account.right<=width&&(geometry.account.bottom<=geometry.logo.y||geometry.logo.right<=geometry.account.x),`${width}x${height}: name above gems without covering title`);

    await a.$eval('.challenge-list',e=>{e.scrollTop=e.scrollHeight;});
    check(await a.evaluate(()=>{const list=document.querySelector('.challenge-list').getBoundingClientRect(),last=document.querySelector('.challenge-card:last-child').getBoundingClientRect();return last.bottom<=list.bottom+1;}),`${width}x${height}: last challenge is accessible by scrolling`);
    await a.$eval('.challenge-list',e=>{e.scrollTop=0;});
    await a.screenshot({path:`${out}/home-${width}x${height}.png`});

  }

  await a.setViewport({width:1280,height:720});

  const before=await a.$eval('.challenge-reset',e=>e.textContent);

  await a.evaluate(()=>{window.__realDateNow=Date.now;Date.now=()=>window.__realDateNow()+864000000;});await delay(250);

  const after=await a.$eval('.challenge-reset',e=>e.textContent);await a.evaluate(()=>{Date.now=window.__realDateNow;});

  const seconds=text=>{const m=text.match(/(\d{2}):(\d{2}):(\d{2})/);return Number(m[1])*3600+Number(m[2])*60+Number(m[3]);};
  check(seconds(before)-seconds(after)>=0&&seconds(before)-seconds(after)<=2,'countdown is unaffected by an edited device clock');

  await a.click('.home-nav .nav-button:last-of-type');await a.click('#tab-gameplay');

  await a.$eval('.profile-setting input',e=>{e.value='Renamed Hero';e.dispatchEvent(new Event('input',{bubbles:true}));});await a.click('.settings-foot .primary');

  await a.click('.settings-foot .btn:nth-last-child(2)');await until(()=>a.$eval('.home-account-name',e=>e.textContent==='Renamed Hero'),'updated account name');check(true,'existing settings rename updates account display');

  const b=await open('Challenge Rival');

  const join=async(page,weapon)=>{

    await page.bringToFront();await page.click('#menu .home-actions .primary');await page.waitForSelector('#weapons.visible',{timeout:90000});await page.click(`.weapon-card[data-weapon="${weapon}"]`);

    await until(()=>page.evaluate(()=>window.__crossfire.state()==='playing'),'normal match spawn',180000);

    page.id=await page.evaluate(()=>window.__crossfire.network().selfId);

  };

  await join(a,'sniper');await join(b,'rifle');

  await room.seedCareerForTest(a.id);

  const arena=await room.directionalArenaForTest();await room.placeForCombatTest(a.id,arena.sources.front);await room.placeForCombatTest(b.id,arena.center);await delay(500);

  await a.bringToFront();
  if(await a.$('#pause.visible'))await a.click('#pause .primary');
  await a.click('#game');await delay(200);

  await a.evaluate(p=>window.__crossfire.aimAt(p[0],p[1]+1.6,p[2]),arena.center);await a.keyboard.down('k');await delay(700);await a.keyboard.down('j');await delay(180);await a.keyboard.up('j');await a.keyboard.up('k');

  await until(()=>a.$eval('.home-gems span',e=>e.textContent==='1,050'),'server-confirmed kill completes seeded objectives');

  check(await a.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).kills===1;}),'reward follows one actual authoritative elimination');

  check(await b.$eval('.home-gems span',e=>e.textContent==='0'),'other guest does not receive private wallet rewards');

  await a.evaluate(()=>window.__crossfire.pause());await a.click('#pause .leave-match');

  await until(()=>a.evaluate(()=>document.body.dataset.screen==='menu'),'return home');

  check(await a.$$eval('.challenge-card',cards=>cards.length===3&&cards.every(c=>c.classList.contains('completed')&&c.textContent.includes('RECEIVED')&&c.querySelector('.challenge-track').getAttribute('aria-valuenow')===c.querySelector('.challenge-track').getAttribute('aria-valuemax'))),'completed cards remain with full bars and received indicators');

  await a.click('#challenge-tab-weekly');check(await a.$$eval('.challenge-reward',nodes=>nodes.every(n=>n.textContent==='250')),'weekly rewards show 250 with shared SVG icon');

  await a.click('#challenge-tab-daily');const completed=await a.$$eval('.challenge-card',cards=>cards.map(c=>c.dataset.challengeId));

  await a.screenshot({path:`${out}/completed.png`});

  await a.reload({waitUntil:'domcontentloaded',timeout:240000});await a.waitForSelector('.challenges-panel[data-available="true"]',{timeout:60000});await until(()=>a.$eval('.home-gems span',e=>e.textContent==='1,050'),'balance paint after refresh');

  check(await a.$eval('.home-gems span',e=>e.textContent==='1,050'),'balance persists after full browser refresh');

  check(JSON.stringify(await a.$$eval('.challenge-card',cards=>cards.map(c=>c.dataset.challengeId)))===JSON.stringify(completed),'completed selection and progress persist after refresh');

  check(await a.evaluate(()=>window.__profileRequests.every(method=>method==='GET')),'refresh reuses credential instead of minting a new guest');

  check(errors.length===0,`no browser, HTTP or asset failures: ${errors.join(', ')}`);

  fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors},null,2));

}catch(error){

  const diagnostics=[];
  for(const [index,page] of (await browser?.pages()??[]).entries()){await page.screenshot({path:`${out}/failure-${index}.png`}).catch(()=>{});diagnostics.push(await page.evaluate(()=>({state:window.__crossfire?.state(),lastShot:window.__crossfire?.lastShot(),network:window.__crossfire?.network()})).catch(()=>null));}
  fs.writeFileSync(`${out}/diagnostics.json`,JSON.stringify(diagnostics,null,2));

  fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors,failure:String(error)},null,2));throw error;

}finally{room?.[Symbol.dispose]?.();await browser?.close();await fixture.dispose();}

