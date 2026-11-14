/** Actual Crossfire UI/WebGL, mocked Gamepad API. No physical controller claim. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:4255/',out='test-results/controller-browser';fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],hardware:'Mock standard Xbox/PlayStation Gamepad API in actual desktop Chrome. No physical wired/Bluetooth or ChromeOS testing.'};let browser,page,diagnosticTimer,loadMonitor;
const record=report.checks.push.bind(report.checks);report.checks.push=(...checks)=>{for(const c of checks)console.log('PASS '+c);return record(...checks);};
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,protocolTimeout:180000,defaultViewport:{width:1366,height:768},args:[...(process.argv.includes('--software')?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--use-angle=d3d11']),'--disable-background-timer-throttling']});
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname))void r.abort();else void r.continue();});
 await page.evaluateOnNewDocument(()=>{
   window.testPad={index:0,connected:true,mapping:'standard',id:'Xbox simulated',buttons:Array.from({length:17},()=>({value:0,pressed:false,touched:false})),axes:[0,0,0,0]};
   Object.defineProperty(navigator,'getGamepads',{value:()=>window.testPad.connected?[window.testPad]:[]});
   localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true,masterVolume:0}));
 });
 await page.goto(base+'?practice&map=industrial-complex',{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Controller test');await page.bringToFront();
 const frames=async(n=3)=>page.evaluate(n=>new Promise(resolve=>{const tick=()=>--n<=0?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}),n);
 const hold=async(n,v)=>{await page.evaluate(({n,v})=>Object.assign(window.testPad.buttons[n],{value:v,pressed:v>.5}),{n,v});await frames();};
 const press=async n=>{await hold(n,1);await hold(n,0);};
 const focus=async selector=>{await page.$eval(selector,e=>e.focus());};
 await frames();await press(13);assert.equal(await page.$eval('body',e=>e.classList.contains('controller-active')),true);
 await focus('#menu .home-actions .primary');await press(12);assert.notEqual(await page.evaluate(()=>document.activeElement?.className),'primary');report.checks.push('D-pad changes actual visible focus');
 await page.evaluate(()=>[...document.querySelectorAll('.home-nav button')].find(b=>b.textContent==='Settings').focus());await press(0);await page.waitForSelector('#settings.visible');
 await focus('#tab-controller');await press(0);assert.equal(await page.$eval('#panel-controller',e=>e.hidden),false);
 await page.waitForFunction(()=>document.querySelector('.controller-settings p').textContent.includes('Connected'));
 await focus('#panel-controller input[type=range]');const initial=await page.$eval('#panel-controller input',e=>Number(e.value));await press(15);assert.equal(await page.$eval('#panel-controller input',e=>Number(e.value)),initial+1);report.checks.push('Controller tab, connection status and precise slider navigation');
 await page.evaluate(()=>document.querySelector('[aria-label="Rebind controller Reload"]').focus());await press(0);await press(0);
 await page.waitForFunction(()=>document.querySelector('.controller-settings').textContent.includes('Swap their bindings'));
 await page.evaluate(()=>[...document.querySelectorAll('.controller-settings button')].find(b=>b.textContent==='Swap bindings').focus());await press(0);
 await page.evaluate(()=>[...document.querySelectorAll('.settings-foot button')].find(b=>b.textContent==='Apply').focus());await press(0);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('crossfire.settings.v1')).controller.bindings.reload),'b0');report.checks.push('Rebind capture, conflict swap and Apply persistence');
 await page.evaluate(()=>document.querySelector('[aria-label="Rebind controller Reload"]').focus());await press(0);await press(9);
 assert.equal(await page.$eval('[aria-label="Rebind controller Reload"]',e=>e.textContent),'A');report.checks.push('Menu cancels binding capture without leaving Settings');
 await page.evaluate(()=>document.querySelector('[aria-label="Rebind controller Reload"]').focus());await press(0);await hold(8,1);await press(9);await hold(8,0);
 assert.equal(await page.$eval('[aria-label="Rebind controller Reload"]',e=>e.textContent),'A');report.checks.push('Menu still cancels capture with View/Share held');
 await focus('#tab-controller');await press(0);
 await page.evaluate(()=>[...document.querySelectorAll('.controller-settings button')].find(b=>b.textContent==='Reset controller defaults').focus());await press(0);
 await page.evaluate(()=>[...document.querySelectorAll('.settings-foot button')].find(b=>b.textContent==='Apply').focus());await press(0);
 await page.setViewport({width:1280,height:720});await focus('[aria-label="Rebind controller FPS counter"]');await press(13);await frames();
 const visible=await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});assert.ok(visible);await page.screenshot({path:out+'/controller-settings-1280.png'});report.checks.push('Scrolled controls reachable at Chromebook-size viewport');
 await press(1);await page.waitForFunction(()=>document.body.dataset.screen==='menu');await frames();await focus('#menu .home-actions .primary');await press(0);
 console.log('Starting actual local map load');
 const loadInfo=()=>page.evaluate(()=>({state:window.__crossfire.state(),screen:document.body.dataset.screen,loading:window.__crossfire.loadingState(),text:document.body.innerText.slice(-700)}));
 const initialLoad=await loadInfo();console.log('LOAD INITIAL',JSON.stringify(initialLoad));assert.notEqual(initialLoad.state,'menu','Play must leave the home/settings state');loadMonitor=setInterval(()=>void loadInfo().then(s=>console.log('LOAD STATE',JSON.stringify(s))).catch(()=>{}),5000);
 const cdp=await page.createCDPSession();if(process.argv.includes('--diagnose')){await cdp.send('Debugger.enable');cdp.on('Debugger.paused',async event=>{report.loadStack=event.callFrames.slice(0,12).map(f=>({function:f.functionName,url:f.url,line:f.location.lineNumber}));console.log('LOAD STACK',JSON.stringify(report.loadStack));await cdp.send('Debugger.resume');});diagnosticTimer=setTimeout(()=>void cdp.send('Debugger.pause').catch(()=>{}),20000);}
 await page.waitForFunction(()=>document.querySelector('#weapons.visible')||document.querySelector('#error.visible'),{timeout:240000,polling:100});
 clearTimeout(diagnosticTimer);clearInterval(loadMonitor);assert.equal(await page.$('#error.visible'),null,await page.$eval('body',e=>e.innerText));await frames();await focus('#weapons [data-weapon="rifle"]');await press(0);
 await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:120000});assert.equal(await page.evaluate(()=>document.pointerLockElement),null);report.checks.push('Controller-only spawn without pointer lock');
 const start=await page.evaluate(()=>window.__crossfire.player());await page.evaluate(()=>window.testPad.axes[1]=-.6);await frames(20);await page.evaluate(()=>window.testPad.axes[1]=0);await frames();
 const end=await page.evaluate(()=>window.__crossfire.player());assert.ok(Math.hypot(start.x-end.x,start.z-end.z)>.05);report.checks.push('Analog movement uses real Practice controller');
 await hold(6,1);await page.waitForFunction(()=>window.__crossfire.weapon().ads>.7);await hold(6,0);report.checks.push('ADS');
 const ammo=await page.evaluate(()=>window.__crossfire.stats().ammo);await hold(7,1);await page.waitForFunction(n=>window.__crossfire.stats().ammo<n,{},ammo);await hold(7,0);await press(2);await page.waitForFunction(()=>window.__crossfire.weapon().action!=='idle');report.checks.push('Trigger firing and partial-magazine reload');
 await hold(9,1);await page.waitForFunction(()=>window.__crossfire.state()==='paused');await frames(20);assert.equal(await page.evaluate(()=>window.__crossfire.state()),'paused');await hold(9,0);report.checks.push('Pause does not immediately resume while held');
 await press(1);await page.waitForFunction(()=>window.__crossfire.state()==='playing');await frames();
 await page.evaluate(()=>window.testPad.connected=false);await page.waitForFunction(()=>window.__crossfire.state()==='paused');report.checks.push('Disconnect releases gameplay and pauses');
 await page.evaluate(()=>{window.testPad.connected=true;window.testPad.id='Sony DualSense simulated';});await frames();await press(1);await page.waitForFunction(()=>window.__crossfire.state()==='playing');await page.waitForFunction(()=>document.querySelector('.controller-prompt').textContent.includes('R2'));report.checks.push('Reconnect without restart, PlayStation labels');
 await page.screenshot({path:out+'/controller-hud.png'});
 await page.keyboard.press('KeyW');await frames();assert.equal(await page.$eval('body',e=>e.classList.contains('controller-active')),false);report.checks.push('Keyboard switches active prompts');
 if(process.argv.includes('--extended')){
  const leave=async()=>{await press(9);await page.waitForFunction(()=>document.body.dataset.screen==='pause');await frames();await focus('#pause .leave-match');await press(0);await page.waitForFunction(()=>document.body.dataset.screen==='menu');await frames();};
  for(const id of ['rifle','smg','shotgun','sniper','semi-sniper']){
   await leave();await focus('#menu .home-actions .primary');await press(0);await page.waitForFunction(()=>document.body.dataset.screen==='weapons',{timeout:120000});await frames();await focus(`#weapons [data-weapon="${id}"]`);await press(0);
   await page.waitForFunction(id=>window.__crossfire.ready()&&window.__crossfire.weapon().id===id&&window.__crossfire.weapon().action==='idle',{},id);
   await hold(6,1);await page.waitForFunction(()=>window.__crossfire.weapon().ads>.9);
   const scoped=await page.evaluate(()=>window.__crossfire.weapon().scope>.7);
   if(scoped){
    const zoom=await page.$eval('.scope-zoom',e=>parseFloat(e.textContent));await press(15);await page.waitForFunction(z=>parseFloat(document.querySelector('.scope-zoom').textContent)>z,{},zoom);await press(14);
   }
   const before=await page.evaluate(()=>window.__crossfire.weapon().ammo);await hold(7,1);await page.waitForFunction(n=>window.__crossfire.weapon().ammo<n,{},before);await frames(45);await hold(7,0);
   const after=await page.evaluate(()=>window.__crossfire.weapon().ammo);if(['shotgun','sniper','semi-sniper'].includes(id))assert.equal(after,before-1,id+' needs distinct presses');else assert.ok(after<before-1,id+' automatic hold');
    await hold(6,0);await page.waitForFunction(()=>window.__crossfire.weapon().action==='idle');await press(2);await page.waitForFunction(()=>{const w=window.__crossfire.weapon();return w.action==='idle'&&w.ammo===w.magazine;},{timeout:15000});
   report.checks.push(`${id}: real selection, ADS, trigger rules and reload${scoped?', scope zoom':''}`);
  }
  await page.evaluate(()=>window.__crossfire.teleport(-3,0,2,0));await frames(15);
  const look=await page.evaluate(()=>window.__crossfire.leanView().forward);await page.evaluate(()=>window.testPad.axes[2]=.4);await frames(15);await page.evaluate(()=>window.testPad.axes[2]=0);await frames();
  const turned=await page.evaluate(()=>window.__crossfire.leanView().forward);assert.ok(Math.hypot(...turned.map((v,i)=>v-look[i]))>.1);report.checks.push('Right-stick camera changes real view direction');
  await hold(4,1);await page.waitForFunction(()=>Math.abs(window.__crossfire.leanView().lean)>.1);await hold(4,0);await page.waitForFunction(()=>Math.abs(window.__crossfire.leanView().lean)<.02);report.checks.push('Lean hold and neutral recovery');
  const thrown=await page.evaluate(()=>window.__crossfire.stats().grenadesThrown);await hold(12,1);await page.waitForFunction(()=>window.__crossfire.grenades().charging);await hold(12,0);await page.waitForFunction(n=>window.__crossfire.stats().grenadesThrown===n+1,{},thrown);report.checks.push('Grenade charge and release use actual gameplay');
  await press(11);await page.waitForFunction(()=>window.__crossfire.meleeInspect()?.shown&&window.__crossfire.meleeInspect()?.clip==='idle');await hold(7,1);await page.waitForFunction(()=>window.__crossfire.meleeInspect()?.clip?.startsWith('attack'));await hold(7,0);report.checks.push('Dagger equip and trigger animation');
  await leave();const position=await page.evaluate(()=>window.__crossfire.player());await page.evaluate(()=>window.testPad.axes[1]=-1);await frames(15);assert.deepEqual(await page.evaluate(()=>window.__crossfire.player()),position);await page.evaluate(()=>window.testPad.axes[1]=0);await frames();report.checks.push('Leaving a match clears gameplay input');
  for(const [label,screen] of [['Shop','shop'],['Locker','locker'],['Leaderboard','leaderboard']]){
   await page.evaluate(label=>[...document.querySelectorAll('.home-nav button')].find(b=>b.textContent===label).focus(),label);await press(0);await page.waitForFunction(s=>document.body.dataset.screen===s,{},screen);await frames();
   if(screen==='locker'){await focus('[data-category="rifle"]');await press(0);assert.equal(await page.$eval('[data-category="rifle"]',e=>e.getAttribute('aria-pressed')),'true');}
   await press(1);await page.waitForFunction(()=>document.body.dataset.screen==='menu');await frames();
   report.checks.push(`${label}: controller entry, navigation and Back (online inventory/rankings unavailable in this offline fixture)`);
  }
 }
 assert.deepEqual(report.errors,[]);await page.screenshot({path:out+'/gameplay.png'});
}catch(e){report.failure=String(e);console.error('FAILED',e);throw e;}finally{
 clearTimeout(diagnosticTimer);
 clearInterval(loadMonitor);
 if(browser){let timer;const closed=await Promise.race([browser.close().then(()=>true,()=>false),new Promise(r=>timer=setTimeout(()=>r(false),15000))]);clearTimeout(timer);
  if(!closed){const owned=browser.process();if(owned){try{execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{stdio:'ignore'});}catch{}for(const s of owned.stdio)s?.destroy();owned.unref();}browser.disconnect();report.cleanupForced=true;}}
 fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
}
