/** Real production sub-path menus and two Chrome players, backed by actual local Durable Objects. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from '../server/node_modules/miniflare/dist/src/index.js';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4200/crossfire/',out='test-results/rooms-browser';fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);};
const mf=new Miniflare(convertV4MiniflareOptions({name:'room-browser',modules:[{type:'ESModule',path:fileURLToPath(new URL('../server/tests/runtime-fixture.mjs',import.meta.url))},{type:'ESModule',path:fileURLToPath(new URL('../server/dist/index.js',import.meta.url))}],compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,resourcePersistencePath:fs.mkdtempSync('server/.wrangler/room-browser-'),durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:new URL(base).origin,MATCH_MODE:'ffa'},log:new Log(LogLevel.ERROR)}));
let browser;const stubs=[];
const until=async(fn,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(50);}throw Error('Timeout '+label);};
async function clickText(page,root,label){await page.evaluate(({root,label})=>{const b=[...document.querySelectorAll(root+' button')].find(n=>n.textContent.trim()===label);if(!b)throw Error('Missing '+label);b.click();},{root,label});}
async function visible(page,selector){await page.waitForSelector(selector+'.visible',{timeout:240000});}
try{
 const server=(await mf.ready).href,ns=await mf.getDurableObjectNamespace('ROOM');
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1000,height:700},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 async function open(name){const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(r.status()+' '+r.url());});page.on('dialog',d=>d.accept());
  await page.evaluateOnNewDocument(server=>{
   window.__roomPackets=[];window.__socketCount=0;window.__openSockets=0;window.__maxSockets=0;window.__mapRequests=[];
   const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){const path=new URL(url,location.href).pathname;super(new URL(path,server).href.replace('http:','ws:'),protocols);window.__socketCount++;window.__openSockets++;window.__maxSockets=Math.max(window.__maxSockets,window.__openSockets);this.addEventListener('close',()=>window.__openSockets--);this.addEventListener('message',e=>{window.__roomPackets.push(JSON.parse(e.data));if(window.__roomPackets.length>1000)window.__roomPackets.shift();});}};
   const real=window.fetch;window.fetch=(input,init)=>{const url=new URL(String(input),location.href);if(/assets\/maps\/.*\.glb/.test(url.pathname))window.__mapRequests.push(url.pathname);return real(['/presence','/profile','/stats','/leaderboard','/rooms','/rooms/join'].includes(url.pathname)?new URL(url.pathname+url.search,server):input,init);};
   const raf=requestAnimationFrame.bind(window),caf=cancelAnimationFrame.bind(window),pending=new Map();let next=0;
   window.requestAnimationFrame=cb=>{const id=++next,p={timer:0,frame:0};p.timer=setTimeout(()=>{p.frame=raf(time=>{pending.delete(id);cb(time);});},1000/30);pending.set(id,p);return id;};window.cancelAnimationFrame=id=>{const p=pending.get(id);if(p){clearTimeout(p.timer);caf(p.frame);pending.delete(id);}};
  },server);
  await page.goto(base+'?quality=low&shadows=off&scale=0.5',{waitUntil:'domcontentloaded',timeout:240000});await completeGuestProfile(page,name);return page;
 }
 const a=await open('Room Host'),b=await open('Room Guest');
 for(const page of [a,b]){await page.click('#menu .home-actions .primary');await visible(page,'#modes');await until(async()=>await page.$$eval('.room-row',n=>n.length>0),'actual room list');}
 check(await a.evaluate(()=>window.__socketCount===0&&window.__mapRequests.length===0&&window.__crossfire.mapInfo()===null),'Play opens real directory without a socket or map load');
 await a.screenshot({path:out+'/mode-select.png'});await clickText(a,'#modes','Refresh');await until(async()=>await a.$$eval('.room-row',n=>n.length>0),'refresh');check(true,'Refresh retrieves actual public-main');
 await clickText(a,'#modes','Join Private Server');await a.type('.room-private input','012345');check(await a.$eval('.room-private input',e=>e.value)==='012345','private input preserves leading zeros');await clickText(a,'.room-private','Cancel');
 await clickText(a,'#modes','Create Server');await visible(a,'#create-room');check(await a.$eval('.room-name',e=>e.value)==="Room Host's Server",'create uses active display name');
 await until(async()=>await a.$$eval('.room-map img',imgs=>imgs.length===3&&imgs.every(i=>i.complete&&i.naturalWidth>0)),'three real thumbnails');
 await a.screenshot({path:out+'/create-1000.png'});await a.setViewport({width:640,height:480});await a.screenshot({path:out+'/create-640.png'});
 check(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'640px menu has no horizontal overflow');await a.setViewport({width:1000,height:700});
 await clickText(a,'#create-room','PRIVATE');await clickText(a,'#create-room','CREATE');await visible(a,'#weapons');
 let n=await a.evaluate(()=>window.__crossfire.network());check(n.snapshot.roomInfo.privacy==='private'&&!n.snapshot.players.find(p=>p.id===n.selfId).alive,'private host joins unspawned and reaches selection after loading');const code=n.snapshot.roomInfo.code,id=n.snapshot.room;check(/^\d{6}$/.test(code),'actual server generated six-digit code');
 const room=ns.get(ns.idFromName('room:'+id));stubs.push(room);
 check(await a.evaluate(()=>window.__socketCount===1),'one gameplay socket for host');
 await clickText(b,'#modes','Refresh');await until(async()=>await b.$$eval('.room-row',n=>n.length>0),'guest refresh');check(!await b.$eval('#modes',e=>e.innerText.includes("Room Host's Server")),'private room absent from browser');
 await clickText(b,'#modes','Join Private Server');await b.type('.room-private input',code);await clickText(b,'.room-private','Join');await visible(b,'#weapons');
 check((await b.evaluate(()=>window.__crossfire.network().snapshot.room))===id,'code routes second actual browser to the same Durable Object');
 for(const [page,gun]of [[a,'rifle'],[b,'smg']]){await page.click('#weapons [data-weapon="'+gun+'"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:60000});}
 await until(async()=>await a.evaluate(()=>window.__crossfire.network().snapshot.players.filter(p=>p.alive).length===2),'two live players');
 await a.bringToFront();
 const before=await a.evaluate(()=>window.__crossfire.network().snapshot.players.find(p=>p.id===window.__crossfire.network().selfId).ack);await a.evaluate(()=>window.__crossfire.hold('right',true));await delay(600);await a.evaluate(()=>window.__crossfire.hold('right',false));
 await until(async()=>await a.evaluate(before=>window.__crossfire.network().snapshot.players.find(p=>p.id===window.__crossfire.network().selfId).ack>before,before),'real browser movement');check(true,'two spawned browser players synchronize real movement');
 await a.evaluate(()=>{document.querySelector('.room-badge').open=true;});await a.screenshot({path:out+'/private-host.png'});check(await a.$eval('.room-badge',e=>e.innerText.includes('HOST')&&e.innerText.includes('Copy Code:')),'host room details show code and ownership');
 await a.evaluate(()=>window.__crossfire.networkLeave());await visible(a,'#menu');await until(async()=>{const s=await room.roomStatus();return s.hostId===(await b.evaluate(()=>window.__crossfire.network().selfId));},'host transfer');check(true,'host leaving preserves guest and transfers ownership');
 await b.evaluate(()=>window.__crossfire.networkLeave());await visible(b,'#menu');await room.ageEmptyRoomForTest(16000);await room.alarmForTest();
 // Validate the second map through the normal UI, then separately cancel loading.
 await a.click('#menu .home-actions .primary');await visible(a,'#modes');await clickText(a,'#modes','Create Server');await clickText(a,'#create-room','Industrial Complex');await clickText(a,'#create-room','TEAMS');await clickText(a,'#create-room','CREATE');await visible(a,'#weapons');check(await a.evaluate(()=>window.__crossfire.mapInfo()?.id==='industrial-complex'&&window.__crossfire.network().snapshot.match.mode==='teams'),'Industrial Complex and Teams finish loading before selection');await a.evaluate(()=>window.__crossfire.networkLeave());await visible(a,'#menu');await a.click('#menu .home-actions .primary');await visible(a,'#modes');await clickText(a,'#modes','Create Server');await clickText(a,'#create-room','CREATE');await visible(a,'#loading');await a.click('#loading .loading-back');await visible(a,'#modes');
 check(await a.evaluate(()=>window.__crossfire.network().state==='idle'),'Back cancels loading and releases connection');
 // Re-enter a public custom room on the third map and verify selected assets/configuration.
 await clickText(b,'#menu','Play');await visible(b,'#modes');await clickText(b,'#modes','Create Server');await clickText(b,'#create-room','Modern City');await clickText(b,'#create-room','TEAMS');await clickText(b,'#create-room','CREATE');await visible(b,'#weapons');
 check(await b.evaluate(()=>window.__crossfire.mapInfo()?.id==='modern-city'&&window.__crossfire.network().snapshot.match.mode==='teams'),'Modern City and Teams load from authoritative room configuration');
 await clickText(a,'#modes','Refresh');await until(async()=>await a.$$eval('.room-row',rows=>rows.some(r=>r.textContent.includes("Room Guest's Server"))),'actual public custom room');await a.evaluate(()=>[...document.querySelectorAll('.room-row')].find(r=>r.textContent.includes("Room Guest's Server")).click());await visible(a,'#weapons');check(await a.evaluate(()=>window.__crossfire.mapInfo()?.id==='modern-city'&&!window.__crossfire.network().snapshot.players.find(p=>p.id===window.__crossfire.network().selfId).alive),'public browser row joins selected custom room without early spawn');
 await b.bringToFront();await b.click('#weapons [data-weapon="shotgun"]');await b.waitForFunction(()=>window.__crossfire.ready());
 // Idle transport coalesces identical frames. Settle a real ADS press/release
 // before aging activity; do not wait for nonexistent idle packets or assume a
 // debug look survives an in-flight authoritative correction.
 const firstAck=await b.evaluate(()=>{window.__crossfire.hold('aim',true);const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).ack;});
 await b.waitForFunction(ack=>{const n=window.__crossfire.network(),p=n.snapshot?.players.find(p=>p.id===n.selfId);return p?.ack>ack&&p.combat.gun.ads>.98;},{},firstAck);
 await b.evaluate(()=>window.__crossfire.hold('aim',false));await b.waitForFunction(()=>{const n=window.__crossfire.network();return n.snapshot?.players.find(p=>p.id===n.selfId)?.combat.gun.ads===0;});
 const latest=await b.evaluate(()=>window.__crossfire.network()),lastRoom=ns.get(ns.idFromName('room:'+latest.snapshot.room));stubs.push(lastRoom);await lastRoom.ageActivityForTest(latest.selfId,31000);await b.waitForFunction(()=>document.querySelector('.room-warning')?.textContent.includes('inactive')&&!document.querySelector('.room-warning').hidden).catch(async error=>{fs.writeFileSync(out+'/warning-failure.json',JSON.stringify(await b.evaluate(()=>({hidden:document.hidden,state:window.__crossfire.state(),network:window.__crossfire.network(),text:document.body.innerText})),null,2));throw error;});check(true,'server AFK deadline produces visible 15-second warning');
 await lastRoom.ageActivityForTest(latest.selfId,46000);await lastRoom.alarmForTest();await visible(b,'#modes');check(await b.$eval('#modes',e=>e.innerText.includes('inactivity')),'AFK returns to Mode Select with explanation');
 check(await a.evaluate(()=>window.__maxSockets===1)&&await b.evaluate(()=>window.__maxSockets===1),'room switching never overlaps browser WebSockets');
 check(errors.length===0,'no page exceptions or missing assets');fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
}finally{await browser?.close();for(const r of stubs)r[Symbol.dispose]?.();await mf.dispose();}
