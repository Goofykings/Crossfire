/** Local real WebGL + CDP multi-touch integration and responsive menu audit. */
import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4262/',out='test-results/touch-browser';fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],limitations:['Chrome emulation, no physical Android/iOS/Chromebook or gamepad hardware','Public requests blocked; no live multiplayer, purchase or crate reward verification']};let browser,page;
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,protocolTimeout:180000,defaultViewport:{width:390,height:844,isMobile:true,hasTouch:true},args:['--use-angle=d3d11']});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.setRequestInterception(true);
 page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!['localhost','127.0.0.1'].includes(u.hostname))void r.abort();else void r.continue();});
 await page.evaluateOnNewDocument(()=>{
  if(!localStorage.getItem('crossfire.settings.v1'))localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true,adaptiveResolution:false,resolutionScale:.5,masterVolume:0}));
  window.testPad={index:0,id:'Xbox test standard pad',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
  window.touchEvents=[];for(const type of ['pointerdown','pointerup','pointercancel'])window.addEventListener(type,e=>{window.touchEvents.push({type,pointer:e.pointerType,id:e.pointerId,target:e.target.id||e.target.className});if(window.touchEvents.length>20)window.touchEvents.shift();},true);
 });
 if(process.argv.includes('--hybrid'))await page.evaluateOnNewDocument(()=>{const query=window.matchMedia.bind(window);window.matchMedia=q=>q==='(pointer: coarse)'?new Proxy(query(q),{get:(target,key)=>key==='matches'?false:Reflect.get(target,key,target)}):query(q);Object.defineProperty(navigator,'maxTouchPoints',{get:()=>10});});
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 const cf=(name,...args)=>page.evaluate((n,a)=>window.__crossfire[n](...a),name,args);
 const waitScreen=s=>page.waitForFunction(s=>document.body.dataset.screen===s,{timeout:20000},s);
 const clickText=async(selector,text)=>{const handle=await page.evaluateHandle((selector,text)=>[...document.querySelectorAll(selector)].find(e=>e.textContent.trim().toLowerCase()===text.toLowerCase()),selector,text);assert.ok(await handle.asElement(),selector+' '+text);await handle.asElement().tap();await handle.dispose();};
 const shot=name=>page.screenshot({path:`${out}/${name}.png`});
 const bounds=async selector=>page.$eval(selector,e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};});
 const fit=async selector=>{const r=await bounds(selector),v=page.viewport();assert.ok(r.x>=-1&&r.y>=-1&&r.right<=v.width+1&&r.bottom<=v.height+1,selector+' '+JSON.stringify(r));};
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Touch audit');await page.waitForFunction(()=>!!window.__crossfire,{timeout:180000});
 for(const [width,height]of process.argv.includes('--input-only')?[]:[[390,844],[844,390],[1024,768],[1366,768]]){
  await page.setViewport({width,height,isMobile:true,hasTouch:true});
  await clickText('.home-nav button','Play');await waitScreen('menu');await fit('.home-header');await fit('.home-actions');await shot(`${width}-home`);
  for(const [label,screen]of [['Shop','shop'],['Locker','locker'],['Leaderboard','leaderboard'],['Settings','settings']]){
   await clickText('.home-nav button',label);await waitScreen(screen);await fit('.home-header');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
   if(screen==='settings'){
    await clickText('.settings-tabs button','Touch');await fit('.settings-foot');await fit('.settings-head');
    await page.$eval('.settings-panel:not([hidden])',e=>e.scrollTop=e.scrollHeight);await fit('.settings-foot');
   }
   await shot(`${width}-${screen}`);
  }
  await clickText('.home-nav button','Play');await waitScreen('menu');
  await page.tap('#menu .home-actions .primary');await waitScreen('modes');await fit('.room-shell');await shot(`${width}-modes`);
  await clickText('#modes .room-actions button','Create Server');await waitScreen('create-room');await fit('#create-room .room-shell');await shot(`${width}-create`);
  await clickText('#create-room .room-heading button','Back');await waitScreen('modes');await clickText('#modes .room-actions button','Practice');await waitScreen('practice-setup');await fit('#practice-setup .room-shell');await shot(`${width}-practice`);
  await clickText('#practice-setup .room-heading button','Back');await waitScreen('modes');await clickText('#modes .room-heading button','Back');await waitScreen('menu');
  report.checks.push(`${width}x${height}: home/nav, Shop, Locker, Leaderboard, Touch settings + pinned footer, public mode browser, room creation, Practice layout`);
  console.log('PASS layouts',width,height);
 }
 await page.setViewport({width:844,height:390,isMobile:true,hasTouch:true});
 await page.goto(base+'?practice&autoplay&map=european-town',{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Touch audit');
 await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady,{timeout:300000});
 if(process.argv.includes('--hybrid')){assert.equal((await cf('inputMethods')).touch,false);await page.touchscreen.tap(600,180);await page.waitForFunction(()=>window.__crossfire.inputMethods().touch);report.checks.push('Hybrid capabilities: 10 touch points with primary fine pointer defaults to desktop; touch activates gameplay');}
 await page.waitForSelector('.touch-controls:not([hidden])');assert.equal(await page.evaluate(()=>document.pointerLockElement),null);
 const client=await page.createCDPSession(),points=new Map();
 const dispatch=async(type)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:[...points].map(([id,p])=>({id,...p,radiusX:3,radiusY:3,force:1}))});
 const down=async(id,x,y)=>{points.set(id,{x,y});await dispatch('touchStart');};
 const move=async(id,x,y)=>{points.set(id,{x,y});await dispatch('touchMove');};
 const up=async id=>{points.delete(id);await dispatch('touchEnd');};
 const center=async selector=>{const r=await bounds(selector);return [r.x+r.w/2,r.y+r.h/2];};
 const press=async(selector,id=9)=>{await down(id,...await center(selector));await up(id);};
 const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await cf('teleport',-3,0,2,0,0);const start=await cf('player'),forward=(await cf('leanView')).forward;
 const stick=await center('.touch-joystick');await down(1,...stick);await move(1,stick[0],stick[1]-45);
 await down(2,430,180);await move(2,480,190);await frames();assert.notDeepEqual((await cf('leanView')).forward,forward,'camera drag before firing/recoil');const ammo=(await cf('weapon')).ammo;await down(3,...await center('.touch-fire'));
 await page.waitForFunction(n=>window.__crossfire.weapon().ammo<n,{},ammo);await frames();
 assert.ok((await cf('inputMethods')).z>.5);assert.notDeepEqual((await cf('leanView')).forward,forward);assert.notDeepEqual(await cf('player'),start);
 await up(3);await up(2);await up(1);await frames();assert.equal((await cf('inputMethods')).z,0);assert.equal((await cf('inputMethods')).fire,false);
 report.checks.push('Three simultaneous native touches: analog movement, camera drag, automatic fire; immediate release; no pointer lock');
 await press('.touch-aim');await page.waitForFunction(()=>window.__crossfire.weapon().ads>.9);assert.equal((await cf('inputMethods')).ads,true);
 await press('.touch-aim');await page.waitForFunction(()=>window.__crossfire.weapon().ads<.1);report.checks.push('ADS single-tap toggle and recovery');
 await cf('selectWeapon',4);await page.waitForFunction(()=>{const w=window.__crossfire.weapon();return w.id==='semi-sniper'&&w.action==='idle';});
 const semiAmmo=(await cf('weapon')).ammo;await down(3,...await center('.touch-fire'));await page.waitForFunction(n=>window.__crossfire.weapon().ammo===n-1,{},semiAmmo);
 await page.waitForFunction(()=>window.__crossfire.weapon().action==='idle');
 // Keep held across many game frames: semi-auto may not manufacture a second trigger edge.
 await page.evaluate(()=>new Promise(r=>{let n=0;function tick(){if(++n===40)r();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
 assert.equal((await cf('weapon')).ammo,semiAmmo-1);await up(3);
 await press('.touch-fire',3);await page.waitForFunction(n=>window.__crossfire.weapon().ammo===n-2,{},semiAmmo);report.checks.push('Semi-auto: one shot per distinct press; no repeat while held');
 await cf('teleport',-3,0,2,0,0);const beforeJump=await cf('player');await press('.touch-jump');await page.waitForFunction(y=>window.__crossfire.player().y>y+.15,{},beforeJump.y);report.checks.push('Touch jump uses existing simulation');
 await press('.touch-more');await down(5,...await center('.touch-grenade'));assert.equal((await cf('inputMethods')).grenade,true);await up(5);await page.waitForFunction(()=>!window.__crossfire.inputMethods().grenade);
 await press('.touch-aim');await cf('selectWeapon',0);await page.waitForFunction(()=>window.__crossfire.weapon().id==='rifle'&&!window.__crossfire.inputMethods().ads);report.checks.push('Grenade held/release action; weapon switch clears touch ADS');
 await down(1,...stick);await move(1,stick[0],stick[1]-45);await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});points.clear();await frames();assert.equal((await cf('inputMethods')).z,0);
 await down(3,...await center('.touch-fire'));await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await frames();assert.equal((await cf('inputMethods')).fire,false);await up(3);report.checks.push('Pointer cancellation and orientation/resize release held input');
 await shot('phone-gameplay');await page.keyboard.press('w');await frames();assert.equal((await cf('inputMethods')).touch,false);
 await down(2,300,400);await up(2);await page.waitForFunction(()=>window.__crossfire.inputMethods().touch);
 await page.evaluate(()=>window.dispatchEvent(new MouseEvent('mousemove',{movementX:2})));assert.equal((await cf('inputMethods')).touch,true);report.checks.push('Physical key switches to desktop; touch reactivates; synthetic mouse event does not switch');
 await page.mouse.move(100,400);await page.waitForFunction(()=>!window.__crossfire.inputMethods().touch);await down(2,300,400);await up(2);await page.waitForFunction(()=>window.__crossfire.inputMethods().touch);report.checks.push('Physical mouse switches to desktop and touching gameplay restores touch');
 await page.evaluate(()=>window.testPad.buttons[0]={pressed:true,value:1});await page.waitForFunction(()=>window.__crossfire.inputMethods().controller);assert.equal((await cf('inputMethods')).touch,false);
 await page.evaluate(()=>window.testPad.buttons[0]={pressed:false,value:0});await frames();report.checks.push('Standard Gamepad API input takes over and clears touch');
 await down(2,300,400);await up(2);await page.waitForFunction(()=>window.__crossfire.inputMethods().touch);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await waitScreen('pause');assert.equal((await cf('inputMethods')).fire,false);assert.equal((await cf('inputMethods')).ads,false);assert.equal((await cf('inputMethods')).z,0);report.checks.push('Focus loss pauses gameplay and clears all touch state');
 await clickText('#pause button','Settings');await waitScreen('settings');await clickText('.settings-tabs button','Touch');
 await page.select('.touch-settings select','off');await clickText('.settings-foot button','Apply');assert.equal((await cf('inputMethods')).touch,false);
 await page.select('.touch-settings select','on');await clickText('.settings-foot button','Apply');assert.equal((await cf('inputMethods')).touch,true);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('crossfire.settings.v1')).touch.mode),'on');
 await clickText('.settings-foot button','Back');await waitScreen('pause');await clickText('#pause button','Resume');await page.waitForFunction(()=>window.__crossfire.ready());
 assert.equal(await page.evaluate(()=>document.pointerLockElement),null);report.checks.push('Touch off/on, Apply persistence and pause Resume without pointer lock');
 const savedTouch=(await cf('settings')).touch;
 await cf('setSetting',{touch:{...savedTouch,buttonSize:84,joystickSize:160,opacity:.35}});
 if(await page.$eval('.touch-extras',e=>e.hidden))await press('.touch-more');
 for(const [width,height]of [[390,844],[844,390]]){
  await page.setViewport({width,height,isMobile:true,hasTouch:true});await fit('.touch-joystick');await fit('.touch-fire');await fit('.touch-aim');await fit('.touch-jump');
  await shot(`${width}-maximum-controls`);
  assert.ok(await page.evaluate(()=>{const boxes=[...document.querySelectorAll('.touch-extras .touch-button')].map(b=>b.getBoundingClientRect());return boxes.length===12&&boxes.every(r=>r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight);}),'all expanded actions fit');
 }
 await cf('setSetting',{touch:savedTouch});report.checks.push('Live maximum button/joystick sizes fit portrait/landscape without a restart');
 if(process.argv.includes('--extended')){
  await cf('networkLeave');await waitScreen('menu');await page.goto(base,{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Touch audit');await waitScreen('menu');
  await page.tap('#menu .home-actions .primary');await waitScreen('modes');await clickText('#modes .room-actions button','Practice');await waitScreen('practice-setup');
  await page.tap('#practice-setup [data-difficulty="advanced"]');
  await page.$eval('#practice-setup input[type=range]',e=>{e.value='3';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await clickText('#practice-setup button','START PRACTICE');await waitScreen('weapons');
  await page.waitForFunction(()=>{const e=document.querySelector('#loading');return !e||getComputedStyle(e).display==='none'||getComputedStyle(e).opacity==='0';});
  assert.equal(await page.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId).alive;}),false);
  for(const [width,height]of [[390,844],[844,390],[1024,768],[1366,768]]){
   await page.setViewport({width,height,isMobile:true,hasTouch:true});await shot(`${width}-weapon-selection`);await fit('.weapon-select-head');
  }
  await page.setViewport({width:844,height:390,isMobile:true,hasTouch:true});await page.tap('#weapons [data-weapon="rifle"]');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:120000});report.checks.push('Actual offline bot Practice: touch weapon choice precedes authoritative spawn; weapon cards at all four sizes');
  await press('.touch-aim');await down(6,...await center('.touch-fire'));
  await page.waitForFunction(()=>window.__crossfire.state()==='spectating',{timeout:90000});
  assert.equal((await cf('inputMethods')).ads,false);assert.equal((await cf('inputMethods')).fire,false);await up(6);await frames();assert.equal(await page.evaluate(()=>document.body.dataset.screen),'spectate','releasing held Fire after death must not ghost-click Settings');report.checks.push('Held Fire/ADS interrupted by death; finger release cannot activate a new menu');await shot('touch-spectating');
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await fit('.spectate-controls');await fit('.spectate-bottom');await shot('touch-spectating-portrait');
  await page.waitForFunction(()=>[...document.querySelectorAll('#spectate button')].some(b=>b.textContent.includes('RESPAWN')&&!b.disabled),{timeout:20000});
  await clickText('#spectate button','RESPAWN');await page.waitForFunction(()=>window.__crossfire.ready());assert.equal((await cf('inputMethods')).ads,false);assert.equal((await cf('inputMethods')).fire,false);report.checks.push('Real bot elimination, spectating and touch respawn: virtual actions reset for the new life');
  await cf('practiceFinish');await waitScreen('results');
  for(const [width,height]of [[390,844],[844,390]]){await page.setViewport({width,height,isMobile:true,hasTouch:true});await shot(`${width}-results`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.$eval('.round-results',e=>e.scrollTop=e.scrollHeight);await fit('.result-actions');await shot(`${width}-results-actions`);}
  report.checks.push('Actual local match results responsive in portrait and landscape (DEV finish advances existing simulation)');
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=String(e);if(page)report.diagnostic=await page.evaluate(()=>({events:window.touchEvents,state:window.__crossfire?.state(),input:window.__crossfire?.inputMethods(),target:document.elementFromPoint(300,400)?.outerHTML.slice(0,300)})).catch(()=>null);console.error(e);throw e;}finally{
 fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
 if(browser){let timer;const closed=await Promise.race([browser.close().then(()=>true,()=>false),new Promise(r=>timer=setTimeout(()=>r(false),15000))]);clearTimeout(timer);if(!closed){const owned=browser.process();if(owned){try{execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{stdio:'ignore'});}catch{}for(const s of owned.stdio)s?.destroy();owned.unref();}browser.disconnect();}}
 console.log(JSON.stringify(report,null,2));
}
