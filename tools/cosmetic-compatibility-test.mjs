/** Actual WebGL cosmetic audit, with a local Vite server owned/closed by this script. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {build,preview} from 'vite';import puppeteer from 'puppeteer-core';
const out='test-results/cosmetic-compatibility',diagnose=process.argv.includes('--diagnose'),contexts=process.argv.includes('--contexts'),animations=process.argv.includes('--animations');fs.mkdirSync(out,{recursive:true});let vite,browser;
try{
 if(!process.argv.includes('--reuse')){console.log('Building isolated audit');await build({configFile:false,base:'/',logLevel:'warn',build:{outDir:'.cache/cosmetic-compatibility-dist',rolldownOptions:{input:'tools/cosmetic-compatibility-lab.html'}}});}
 vite=await preview({configFile:false,base:'/',build:{outDir:'.cache/cosmetic-compatibility-dist'},preview:{host:'127.0.0.1',port:4226,strictPort:true}});console.log('Audit preview ready');
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/google-chrome'),headless:true,pipe:true,protocolTimeout:180000,defaultViewport:{width:640,height:400},args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),'--disable-background-timer-throttling']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e));});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('BROWSER ERROR',m.text());}});page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
 await page.goto('http://127.0.0.1:4226/tools/cosmetic-compatibility-lab.html',{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>!!window.__cosmeticAudit,{timeout:120000});
 const items=await page.evaluate(()=>window.__cosmeticAudit.items),report=[],defaults=new Map();
 const verify=(data,item)=>{
   assert.ok(data.pixels>200,'Visible geometry '+item.id+' '+data.preset);
   for(const m of data.materials){assert.ok(m.textures.every(t=>t.ready),`Ready textures ${m.name}`);if(data.preset==='chromebook'&&m.name.startsWith('cosmetic:')){assert.equal(m.metallic,0,m.name);assert.equal(m.normal,false,m.name);assert.equal(m.orm,false,m.name);assert.equal(m.coat,false,m.name);}}
   const key=item.weapon+':'+data.preset;if(item.id.startsWith('default-'))defaults.set(key,data.signature);else assert.notEqual(data.signature,defaults.get(key),'Distinct skin '+item.id+' '+data.preset);
 };
 for(const item of items.filter(i=>!diagnose||['rich-rifle','rich-melee','green-camo-rifle','frosted-rifle'].includes(i.id))){
  if(animations){
   if(!/^(hydro-|rainbow-glow-)/.test(item.id))continue;
   for(const mode of ['chromebook','high']){const before=await page.evaluate(({id,mode})=>window.__cosmeticAudit.load(id,mode),{id:item.id,mode}),after=await page.evaluate(()=>window.__cosmeticAudit.animate());assert.notEqual(after.signature,before.signature,'Animated pattern '+item.id+' '+mode);assert.deepEqual(after.meshes,before.meshes);report.push({id:item.id,mode,before:before.signature,after:after.signature});console.log('PASS animation',item.id,mode);}
   continue;
  }
  if(contexts){
   for(const mode of ['chromebook','high']){
    const data=await page.evaluate(({id,mode})=>window.__cosmeticAudit.contexts(id,mode),{id:item.id,mode});
    for(const frame of data.frames){assert.ok(frame.meshes.length>0,item.id+' '+frame.context);if(mode==='chromebook')for(const m of frame.materials){assert.equal(m.metallic,0,m.name);assert.equal(m.normal,false,m.name);assert.equal(m.orm,false,m.name);}fs.writeFileSync(`${out}/${item.id}-${mode}-${frame.context}.png`,Buffer.from(frame.image.split(',')[1],'base64'));delete frame.image;}
    report.push(data);console.log('PASS contexts',item.id,mode,data.frames.length);
   }continue;
  }
  const modes=diagnose?['high','chromebook']:await page.evaluate(()=>window.__cosmeticAudit.presets);
  for(const mode of modes){const data=await page.evaluate(({id,mode})=>window.__cosmeticAudit.load(id,mode),{id:item.id,mode});report.push(data);fs.writeFileSync(`${out}/latest.json`,JSON.stringify(data,null,2));
   if(diagnose||mode==='chromebook'){const image=await page.evaluate(()=>window.__cosmeticAudit.capture());fs.writeFileSync(`${out}/${item.id}-${mode}.png`,Buffer.from(image.split(',')[1],'base64'));}
   verify(data,item);
   console.log(item.id,mode,'luminance',data.luminance.toFixed(3),'dark',data.dark.toFixed(3));
  }
  if(!diagnose){
   const meshes=report.at(-1).meshes;
   for(const mode of ['chromebook','high','chromebook']){const data=await page.evaluate(mode=>window.__cosmeticAudit.switch(mode),mode);verify(data,item);assert.deepEqual(data.meshes,meshes,'Attachments preserved '+item.id);report.push({...data,hot:true});}
  }
 }
 fs.writeFileSync(`${out}/${animations?'animations':contexts?'contexts':diagnose?'baseline':'audit'}.json`,JSON.stringify({items:items.length,report,errors},null,2));assert.deepEqual(errors,[]);console.log('PASS asset/shader audit, samples '+report.length);
}finally{await browser?.close();if(vite)await new Promise(resolve=>vite.httpServer.close(resolve));}
