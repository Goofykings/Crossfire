/** Two actual Chromium clients + local workerd. Never connects to production.
 * Run after `npm --prefix server run build`: node tools/network-browser-test.mjs
 * Isolated production-mode frontend goes in .cache; reports contain no credentials. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {build,preview} from 'vite';
import puppeteer from 'puppeteer-core';import {harness,until} from '../server/tests/room-harness.mjs';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const cleanup=[],out='test-results/network-browser';fs.mkdirSync(out,{recursive:true});
// Small independent check when WebGL scene readiness blocks the full review.
// Uses the real panel component and saved real-peer telemetry; no game connection is fabricated.
if(process.argv.includes('--download-only')){
  await build({configFile:false,logLevel:'warn',build:{outDir:'.cache/network-download-check',copyPublicDir:false,
    lib:{entry:'src/ui/NetworkDiagnosticsOverlay.ts',formats:['es'],fileName:()=> 'overlay.js'}}});
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true});
  try{
    const context=await browser.createBrowserContext();await context.setDownloadBehavior({policy:'allow',downloadPath:path.resolve(out)});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    const data={format:'crossfire-network-v1',network:JSON.parse(fs.readFileSync('test-results/network-real-peers.json','utf8'))[0]};
    await page.setContent('<!doctype html><title>Network report component check</title>');
    const moduleUrl='data:text/javascript;base64,'+fs.readFileSync('.cache/network-download-check/overlay.js').toString('base64');
    await page.addScriptTag({type:'module',content:`import {NetworkDiagnosticsOverlay} from '${moduleUrl}';
      new NetworkDiagnosticsOverlay(true,()=>(${JSON.stringify(data)})).update(performance.now());`});
    await page.waitForSelector('.network-diagnostics button');
    const file=path.join(out,'crossfire-network-report.json');if(fs.existsSync(file))fs.unlinkSync(file);
    await page.click('.network-diagnostics button');await until(()=>fs.existsSync(file),'isolated real panel download');
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),data);assert.deepEqual(errors,[]);
    console.log('PASS actual panel click downloads the exact credential-free saved real-peer report');
  }finally{await browser.close();}
  process.exit(0);
}
const h=await harness({after:fn=>cleanup.push(fn)},{ALLOWED_ORIGINS:'http://127.0.0.1:4235',AFK_KICK_MS:'600000'});
let browser,server;const report={runs:[],errors:[]};
try{
  let round=await h.central.snapshotForTest();while(round.mapId!=='industrial-complex')round=await h.central.advanceMapForTest();
  const endpoint=new URL('/ws',h.base).href.replace('http:','ws:');
  await build({configFile:false,base:'/',logLevel:'warn',define:{
    'import.meta.env.VITE_MULTIPLAYER_PROVIDER':JSON.stringify('cloudflare'),
    'import.meta.env.VITE_MULTIPLAYER_URL':JSON.stringify(endpoint)},
    build:{outDir:'.cache/network-browser-dist',chunkSizeWarningLimit:7000}});
  server=await preview({configFile:false,base:'/',build:{outDir:'.cache/network-browser-dist'},preview:{host:'127.0.0.1',port:4235,strictPort:true}});
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:960,height:540},
    args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const pages=[];
  for(const chromebook of [false,true]){
    const context=await browser.createBrowserContext(),page=await context.newPage();pages.push(page);
    page.on('pageerror',e=>report.errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request',r=>{
      const url=new URL(r.url());
      if(['http:','https:'].includes(url.protocol)&&!['127.0.0.1','localhost'].includes(url.hostname)){
        report.errors.push('Unexpected non-local request');r.abort();
      }else r.continue();
    });
    await page.evaluateOnNewDocument(chromebook=>localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:chromebook,masterVolume:0})),chromebook);
    await page.goto('http://127.0.0.1:4235/?autoplay&netDiagnostics=1&quality=low&map=industrial-complex',{waitUntil:'domcontentloaded',timeout:180000});
    await completeGuestProfile(page,chromebook?'Chromebook review':'Standard review');
    try{await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady,{timeout:240000});}
    catch(error){report.loadingFailure=await page.evaluate(()=>{const g=window.__crossfire;return{loading:g.loadingState(),state:g.state(),connection:g.network().state};});throw error;}
    assert.equal(await page.evaluate(()=>window.__crossfire.settings().chromebookMode),chromebook);
    console.log('PASS real browser connected',chromebook?'Chromebook':'standard');
  }
  for(const [index,page] of pages.entries()){
    await page.bringToFront();const cdp=await page.createCDPSession();
    if(index===1)await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const id=await page.evaluate(()=>window.__crossfire.network().selfId);
    const otherId=await pages[1-index].evaluate(()=>window.__crossfire.network().selfId);
    assert.notEqual(id,otherId);
    await h.central.placeForCombatTest(id,[7,0,-5],90);
    await page.waitForFunction(()=>Math.abs(window.__crossfire.player().x-7)<.02);
    await page.evaluate(()=>window.__crossfire.look(90,0));
    const samples=await page.evaluate(()=>new Promise(resolve=>{
      const g=window.__crossfire,points=[],start=performance.now();let jumped=false,stalled=false,stopped=false;
      g.hold('forward',true);
      const frame=()=>{
        const p=g.player(),m=g.motion();points.push({at:performance.now()-start,...p,yaw:m.yaw});
        if(!jumped&&p.x>9){g.hold('jump',true);jumped=true;}else if(jumped)g.hold('jump',false);
        if(!stalled&&jumped&&p.y>.3){stalled=true;const end=performance.now()+250;while(performance.now()<end){/* controlled local main-thread stall */}}
        if(!stopped&&p.x>10.8){g.hold('forward',false);stopped=true;}
        if(performance.now()-start<5000)requestAnimationFrame(frame);
        else{g.hold('forward',false);g.hold('jump',false);resolve(points);}
      };requestAnimationFrame(frame);
    }));
    await page.waitForFunction(()=>{const n=window.__crossfire.network(),p=n.snapshot.players.find(p=>p.id===n.selfId);return p.motion.grounded&&Math.abs(p.motion.position.y-1)<.001;},{timeout:10000});
    const state=await page.evaluate(()=>{const g=window.__crossfire,n=g.network();return{self:n.snapshot.players.find(p=>p.id===n.selfId),count:n.snapshot.players.length,diagnostics:g.networkReport()};});
    assert.equal(state.count,2);assert.equal(state.self.health,100);assert.ok(samples.some(p=>p.grounded&&Math.abs(p.y-1)<.001));
    assert.ok(samples.every(p=>Math.abs(p.yaw+Math.PI/2)<.000001),'camera aim is preserved');
    await page.screenshot({path:`${out}/${index?'chromebook':'standard'}-diagnostics.png`});
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    const before={id:state.self.id,life:state.self.life,health:state.self.health,weapon:state.self.weapon,score:state.self.score};
    await page.evaluate(()=>window.__crossfire.networkReconnect());
    await page.waitForFunction(()=>window.__crossfire.network().state==='connected'&&window.__crossfire.network().diagnostics.opens>=2,{timeout:15000});
    const resumed=await page.evaluate(()=>{const n=window.__crossfire.network();return n.snapshot.players.find(p=>p.id===n.selfId);});
    for(const key of Object.keys(before))assert.equal(resumed[key],before[key]);
    console.log('PASS actual landing and stable session after reconnect',index);
    await pages[1-index].waitForFunction(id=>window.__crossfire.network().rendered.filter(p=>p.id===id).length===1,{},id);
    assert.equal(await page.$eval('.network-diagnostics',e=>getComputedStyle(e).display!=='none'),true);
    const json=JSON.stringify(await page.evaluate(()=>window.__crossfire.networkReport()));
    const secrets=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).match(/[a-f0-9]{64}/g)??[]);
    for(const secret of secrets)assert.ok(!json.includes(secret),'report excludes credentials');
    await page.browserContext().setDownloadBehavior({policy:'allow',downloadPath:path.resolve(out)});
    const file=path.join(out,'crossfire-network-report.json');if(fs.existsSync(file))fs.unlinkSync(file);
    await page.evaluate(()=>document.exitPointerLock());
    await page.waitForFunction(()=>document.pointerLockElement===null);
    await page.click('.network-diagnostics button');await until(()=>fs.existsSync(file),'downloaded diagnostic report');
    const exported=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(exported.format,'crossfire-network-v1');
    for(const secret of secrets)assert.ok(!JSON.stringify(exported).includes(secret));
    report.runs.push({chromebook:index===1,cpuThrottle:index===1?4:1,samples,diagnostics:exported,
      note:'Lifetime correction statistics include the intentional test-only starting teleport, not just the jump.'});
    console.log('PASS real jump, 250 ms stall, reconnect, one remote avatar and private report',index);
  }
  const departing=await pages[0].evaluate(()=>window.__crossfire.network().selfId);
  await pages[0].evaluate(()=>window.__crossfire.networkLeave());
  await pages[1].waitForFunction(id=>!window.__crossfire.network().snapshot.players.some(p=>p.id===id),{},departing);
  assert.equal(await pages[0].evaluate(()=>window.__crossfire.state()),'menu');
  assert.deepEqual(report.errors,[]);console.log('PASS intentional Leave and no page errors');
}catch(error){console.error(error);report.failure=String(error);throw error;}finally{
  fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();
  if(server){server.httpServer.closeAllConnections();await new Promise(resolve=>server.httpServer.close(resolve));}for(const fn of cleanup)await fn();
}
