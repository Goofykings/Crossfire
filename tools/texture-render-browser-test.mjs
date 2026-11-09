import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const base=process.argv[2]??'http://127.0.0.1:5181/',out=process.argv[3]??'test-results/texture-render';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,timeout:120000,protocolTimeout:240000,
 defaultViewport:{width:1366,height:768},args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11']});
const errors=[],report=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
 await page.evaluateOnNewDocument(()=>{
  localStorage.setItem('crossfire.settings.v1',JSON.stringify({chromebookMode:true}));
  const real=window.fetch;window.fetch=(input,init)=>new URL(String(input),location.href).origin!==location.origin?Promise.reject(Error('Offline test')):real(input,init);
 });
 for(const [map,view]of Object.entries({'european-town':[-16,2.4,-25,90,-18],'industrial-complex':[-27,1.7,-28.5,90,-18],'modern-city':[-25,1.85,-24,90,-18],farmstead:[-4,1.7,36,0,-18]})){
  if(process.argv[4]&&map!==process.argv[4])continue;
  await page.goto(`${base}?practice&autoplay&map=${map}`,{waitUntil:'domcontentloaded',timeout:180000});await completeGuestProfile(page,'Texture Review');
  await page.waitForFunction(()=>window.__crossfire?.ready(),{timeout:180000});
  await page.evaluate(view=>window.__crossfire.freeCam(...view),view);await new Promise(r=>setTimeout(r,400));
  await page.screenshot({path:`${out}/${map}.png`});
  const data=await page.evaluate(()=>{const s=window.__crossfire.renderScene();return s.materials.filter(m=>m.albedoTexture).map(m=>{const t=m.albedoTexture;return {name:m.name,tex:t.name,wrap:[t.wrapU,t.wrapV],scale:[t.uScale,t.vScale],matrix:Array.from(t.getTextureMatrix().m),size:t.getSize(),mode:t.coordinatesMode,renderTarget:t.isRenderTarget,mipmaps:t.getInternalTexture()?.generateMipMaps};});});
  const compact=data.filter(t=>t.tex.startsWith('compact:'));
  assert.ok(compact.length>=8,map+': compact color textures actually loaded');
  for(const t of compact){
   assert.equal(t.renderTarget,false,t.name+': surface is an ordinary texture');
   assert.equal(t.mode,0,t.name+': authored UV mapping');assert.deepEqual(t.wrap,[1,1],t.name+': repeats across both axes');
   assert.equal(t.mipmaps,true,t.name+': mipmaps remain available');assert.ok(t.size.width<=256&&t.size.height<=256);
  }
  let groundDetail=null;
  if(map==='european-town'){
   // Known paving patch: the previous cold GPU resize left it flat gray while
   // adjacent patches showed texture. Measure detail away from object edges.
   const patch=await page.screenshot({clip:{x:80,y:250,width:350,height:100}});
   groundDetail=await page.evaluate(async data=>{
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    const img=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);img.close();
    const p=ctx.getImageData(0,0,c.width,c.height).data;let delta=0,count=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width-8;x++){
     const a=(y*c.width+x)*4,b=a+32;delta+=(Math.abs(p[a]-p[b])+Math.abs(p[a+1]-p[b+1])+Math.abs(p[a+2]-p[b+2]))/3;count++;
    }return delta/count;
   },patch.toString('base64'));
   assert.ok(groundDetail>3,'cold-start paving retains visible repeated detail');
  }
  report.push({map,groundDetail,data});fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log('PASS',map,'UV repeat, mipmaps, texture budget',groundDetail??'');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
}finally{await browser.close();}
