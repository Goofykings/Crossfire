/** Actual game/WebGL check against a production build: node tools/platform-jump-test.mjs.
 * Local Practice only; screenshots and measured positions go to test-results/platform-jump/. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {preview} from 'vite';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';

const out='test-results/platform-jump';fs.mkdirSync(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:4233,strictPort:true}});
let browser;const report={runs:[],errors:[]};
try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless:true,pipe:true,timeout:120000,protocolTimeout:240000,defaultViewport:{width:1366,height:768},
    args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  for(const chromebook of [false,true]){
    const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
    await page.evaluateOnNewDocument(chromebook=>localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:chromebook,masterVolume:0})),chromebook);
    await page.goto('http://127.0.0.1:4233/?practice&autoplay&nohud&map=industrial-complex',{waitUntil:'domcontentloaded',timeout:180000});
    await completeGuestProfile(page,'Platform test');
    await page.waitForFunction(()=>window.__crossfire.ready()&&window.__crossfire.loadingState().sceneReady,{timeout:240000});
    assert.equal(await page.evaluate(()=>window.__crossfire.settings().chromebookMode),chromebook);
    for(let weapon=0;weapon<5;weapon++){
      await page.evaluate(weapon=>{const g=window.__crossfire;g.hold('forward',false);g.hold('jump',false);g.selectWeapon(weapon);g.teleport(7,0,-5,90,0);},weapon);
      await delay(300);
      // The page schedules real input at render boundaries; physics stays at 120 Hz.
      const samples=await page.evaluate(()=>new Promise(resolve=>{
        const g=window.__crossfire,points=[],start=performance.now();let jumped=false,stopped=false;
        g.hold('forward',true);
        function frame(){
          const p=g.player();points.push({...p,at:performance.now()-start});
          if(!jumped&&p.x>9){g.hold('jump',true);jumped=true;}
          else if(jumped)g.hold('jump',false);
          if(!stopped&&p.x>10.8){g.hold('forward',false);stopped=true;}
          if(performance.now()-start<3500)requestAnimationFrame(frame);
          else{g.hold('forward',false);g.hold('jump',false);resolve(points);}
        }requestAnimationFrame(frame);
      }));
      const final=samples.at(-1);assert.ok(samples.some(p=>p.grounded&&Math.abs(p.y-1)<.001),`weapon ${weapon}: landed`);
      assert.ok(final.grounded&&Math.abs(final.y-1)<.001,`weapon ${weapon}: stayed on deck (${JSON.stringify(final)})`);
      for(let i=1;i<samples.length;i++)assert.ok(samples[i].x>=samples[i-1].x-.0001,'no backward snap');
      report.runs.push({chromebook,weapon,final,samples});
      if(weapon===0)await page.screenshot({path:`${out}/${chromebook?'chromebook':'standard'}-landed.png`});
      console.log('PASS',chromebook?'Chromebook':'standard','weapon',weapon,'landed at',final.y);
    }
    await page.close();
  }
  assert.deepEqual(report.errors,[]);
}finally{
  fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
  await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));
}
