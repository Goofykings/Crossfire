/** Real UI/SVG/Web Audio review; local fixture only, no account or multiplayer requests. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {build,preview} from 'vite';import puppeteer from 'puppeteer-core';
const out='test-results/logo-easter-egg';fs.mkdirSync(out,{recursive:true});fs.mkdirSync('.cache',{recursive:true});let server,browser;
fs.writeFileSync('.cache/logo-review.html',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="ui"></div><script type="module">
import '/src/styles.css';import '/src/ui/motion.css';import {UI} from '/src/ui/UI.ts';import {SettingsStore} from '/src/config/settings.ts';import {AudioManager} from '/src/audio/AudioManager.ts';import {GuestProfileStore} from '/src/config/guestProfile.ts';
const sources=[],original=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const s=original.call(this),start=s.start.bind(s);s.start=(...args)=>{sources.push({duration:s.buffer?.duration,peak:s.buffer?Math.max(...s.buffer.getChannelData(0).map(Math.abs)):0});return start(...args);};return s;};
const audio=new AudioManager(),guest=new GuestProfileStore();guest.setUsername('Logo Review');const ui=new UI(document.querySelector('#ui'),new SettingsStore(),audio,guest);ui.show('menu');let shots=0,last=-Infinity;const play=audio.playUI.bind(audio);audio.playUI=(kind,...args)=>{if(kind==='logo'){shots++;last=performance.now();}return play(kind,...args);};
window.review={audio,ui,sources,get shots(){return shots;},get last(){return last;}};
</script></body></html>`);
const report={checks:[],errors:[]};const check=(value,label)=>{assert.ok(value,label);report.checks.push(label);console.log('PASS',label);};
try{
 if(!process.argv.includes('--reuse'))await build({configFile:false,base:'/',logLevel:'warn',build:{outDir:'.cache/logo-review-dist',rolldownOptions:{input:'.cache/logo-review.html'}}});
 server=await preview({configFile:false,base:'/',build:{outDir:'.cache/logo-review-dist'},preview:{host:'127.0.0.1',port:4232,strictPort:true}});
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,defaultViewport:{width:1920,height:1080}});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto('http://127.0.0.1:4232/.cache/logo-review.html',{waitUntil:'networkidle0',timeout:120000});await page.waitForFunction(()=>window.review);
 const ready=()=>page.waitForFunction(()=>performance.now()-window.review.last>=310);
 const point=index=>page.evaluate(index=>{const path=document.querySelectorAll('.logo-symbol > g:first-child > path')[index],p=new DOMPoint(22,-1).matrixTransform(path.getScreenCTM());return {x:p.x,y:p.y};},index);
 const finish=()=>page.$eval('.logo-trigger',async b=>{const a=b.getAnimations({subtree:true});for(const animation of a)if(animation.playState==='paused')animation.play();await Promise.all(a.map(a=>a.finished.catch(()=>{})));});
 for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:800,height:600}]){
  await page.setViewport(size);await page.mouse.move(2,size.height-2);await finish();
  const baseline=await page.$eval('.logo',n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));
  check(await page.$eval('.logo-trigger',b=>getComputedStyle(b).pointerEvents==='auto'),`${size.width}: visible logo accepts pointer input through header`);
  for(const index of [0,1]){
   await ready();const p=await point(index);await page.mouse.move(p.x,p.y);
   await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('.logo-trigger')).transform).a>=1.08);
   await finish();
   const scale=await page.$eval('.logo-trigger',b=>new DOMMatrix(getComputedStyle(b).transform).a);
   check(scale>=1.08&&scale<=1.12,`${size.width}: gun ${index+1} visibly enlarges 8–12%`);
   check(await page.$eval('.logo-trigger',b=>getComputedStyle(b).transitionProperty.includes('transform')&&getComputedStyle(b).transitionTimingFunction.includes('1.6')),`${size.width}: spring transition survives shared button CSS`);
   const before=await page.evaluate(()=>window.review.shots),target=await point(index);await page.mouse.click(target.x,target.y);
   const effects=await page.$eval('.logo-trigger',b=>{
    const animations=b.getAnimations({subtree:true});for(const a of animations){a.pause();a.currentTime=45;}
    const paths=[...b.querySelectorAll('.logo-flash,.logo-trail')],guns=[...b.querySelectorAll('svg > g:first-child > path')];
    return {count:animations.length,visible:paths.map(p=>+getComputedStyle(p).opacity),up:paths.filter(p=>p.classList.contains('logo-trail')).map(p=>new DOMMatrix(getComputedStyle(p).transform).m42),anchors:[...b.querySelectorAll('.logo-flash')].map((p,i)=>{const origin=new DOMPoint(0,0).matrixTransform(p.parentNode.getScreenCTM()),muzzle=new DOMPoint(30,-1).matrixTransform(guns[i===0?1:0].getScreenCTM());return Math.hypot(origin.x-muzzle.x,origin.y-muzzle.y);})};
   });
   check(effects.count===5&&effects.visible.every(x=>x>0)&&effects.up.every(y=>y<0),`${size.width}: gun ${index+1} fires both flashes, upward trails and recoil`);
   check(effects.anchors.every(gap=>gap<.01),`${size.width}: flashes are anchored to the actual SVG muzzles`);
   await page.evaluate(()=>{for(let i=0;i<20;i++)document.querySelector('.logo-trigger').click();});
   check(await page.evaluate(n=>window.review.shots===n+1,before),`${size.width}: rapid clicks produce one logo audio cue`);
   check(await page.$eval('.logo-trigger',b=>b.querySelectorAll('.logo-flash,.logo-trail').length===4&&b.getAnimations({subtree:true}).length<=5),`${size.width}: fixed effect nodes and bounded animations`);
   await page.screenshot({path:`${out}/${size.width}-gun-${index+1}-fire.png`});await finish();
  }
  await page.mouse.move(2,size.height-2);await finish();
  const rest=await page.$eval('.logo',n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));
  check(JSON.stringify(rest)===JSON.stringify(baseline),`${size.width}: title returns without layout shift`);
 }
 check(await page.evaluate(()=>window.review.sources.some(s=>Math.abs(s.duration-.075)<.0001&&s.peak>0)), 'real Web Audio starts the cached 75 ms arcade shot');
 await ready();const textPoint=await page.$eval('.logo > span',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}),textShots=await page.evaluate(()=>window.review.shots);await page.mouse.click(textPoint.x,textPoint.y);check(await page.evaluate(n=>window.review.shots===n,textShots),'title lettering is not an invisible firing target');
 await ready();await page.focus('.logo-trigger');const before=await page.evaluate(()=>window.review.shots);await page.keyboard.press('Enter');check(await page.evaluate(n=>window.review.shots===n+1,before),'keyboard Enter fires once');await finish();await ready();await page.keyboard.press('Space');check(await page.evaluate(n=>window.review.shots===n+2,before),'keyboard Space fires once');await finish();
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await ready();const reducedPoint=await point(0);await page.mouse.click(reducedPoint.x,reducedPoint.y);
 const reduced=await page.$eval('.logo-trigger',b=>b.getAnimations({subtree:true}).map(a=>({name:a.effect.target.getAttribute('class'),duration:a.effect.getTiming().duration})));
 check(reduced.length===2&&reduced.every(a=>a.name.includes('logo-flash')&&a.duration===90),'reduced motion uses brief flashes without recoil, trails or hover scaling');await finish();
 check(await page.$eval('.logo-trigger',b=>getComputedStyle(b).transform==='none'&&getComputedStyle(b).scale==='1'),'reduced motion keeps the visible logo stationary');
 await page.evaluate(()=>{window.review.audio.setVolume(0);window.review.audio.setSfxVolume(0);});await ready();await page.keyboard.press('Enter');
 check(await page.evaluate(()=>window.review.audio.masterVolume===0&&window.review.audio.sfx.gain.value===0),'master and SFX mute remain authoritative');
 await page.evaluate(()=>[...document.querySelectorAll('.home-nav button')].find(b=>b.textContent.trim()==='Settings').click());check(await page.$eval('#settings',e=>e.classList.contains('visible')),'normal Settings navigation still works');
 assert.deepEqual(report.errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log('PASS',report.checks.length,'logo browser checks; no page errors');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));}
