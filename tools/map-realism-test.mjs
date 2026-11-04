/** Production /crossfire/ visual inspection; physical traversal is tested with
 * the shared controller and real workerd peers in the automated suites. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {setTimeout as delay} from 'node:timers/promises';
import {completeGuestProfile} from './guest-profile-helper.mjs';
const out=process.env.CROSSFIRE_TEST_OUTPUT??'test-results/map-realism-major';fs.mkdirSync(out,{recursive:true});
const workOnly=process.argv.includes('--work-area-only');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,
  protocolTimeout:240000,defaultViewport:{width:1280,height:720},args:['--ignore-gpu-blocklist','--enable-gpu','--use-angle=d3d11','--disable-background-timer-throttling']});
const page=await browser.newPage(),errors=[],results=[];
page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400&&r.url().includes('/assets/'))errors.push(`${r.status()} ${r.url()}`);});
page.on('console',m=>{if(m.type()==='error'&&/shader|WebGL|framebuffer/i.test(m.text()))errors.push(m.text());});
try{
  await page.goto(`${process.argv[2]??'http://127.0.0.1:4200/crossfire/'}?practice&autoplay&quality=ultra&shadows=medium&scale=.8`,{waitUntil:'domcontentloaded',timeout:240000});
  await completeGuestProfile(page,'Map Inspector');await page.waitForFunction(()=>window.__crossfire.ready(),{timeout:240000});
  for(const id of (process.argv.includes('--industrial-details')?['industrial-complex']:['european-town','industrial-complex','modern-city'])){
    if((await page.evaluate(()=>window.__crossfire.stats())).mapId!==id)await page.evaluate(id=>window.__crossfire.loadMap(id),id);
    await page.waitForFunction(()=>window.__crossfire.loadingState().sceneReady&&window.__crossfire.graphics().reflectionReady,{timeout:240000});
    const layout=JSON.parse(fs.readFileSync(`src/maps/${id}/layout.json`,'utf8'));
    const b=layout.buildings.find(b=>b.circulation),[x0,z0,x1,z1]=b.rect,c=b.circulation;
    const point=(u,y,v)=>[x0+u,y,c.flipZ?z1-v:z0+v];
    const heading=c.flipZ?0:180;
    const views=[['work-area',...point((x1-x0)/2,3.22,(z1-z0)-2),heading,0],...(workOnly?[]:[
      ['entry',...point((x1-x0)-1.5,.02,c.doorV),270,0],
      ['stairwell',...point(c.stairWidth-1.65,.02,c.doorV),c.flipZ?180:0,12],
      ['turn',...point(2.1,1.62,2.5),heading,0],
      ['upper',...point(2.1,3.22,c.doorV),c.exit==='w'?270:90,-4],
      ['stair-close',...point(c.stairWidth-1.65,.42,4.8),c.flipZ?180:0,20],
      ['ceiling-mounts',...point((x1-x0)/2,3.22,(z1-z0)-2.6),heading,17],
      ['railing-return',...point((c.stairWidth)/2,3.22,6.6),c.flipZ?180:0,-15],
      ['street',...point(c.exit==='w'?-7.2:(x1-x0)+7.2,0,c.doorV),c.exit==='w'?90:270,12],
    ])];
    const outdoor = {
      'european-town': [['market',-3.8,0,1,0,0],['roof-junction',5,12,11,320,-22],['plaza-junction',0,0,6,0,0]],
      'industrial-complex': [['service-props',12,0,-10.5,68,0],['roof-junction',-11,12,5,115,-22],['utility-fence',13.5,0,-12.5,90,0]],
      'modern-city': [['street-furniture',4,0,7,13,0],['roof-junction',-1,12,5,135,-22],['railing-gate',12,0,-11,0,0]],
    }[id];
    if(process.argv.includes('--industrial-details')){views.length=0;outdoor.splice(0,outdoor.length,['transformer-bushings',16.7,.25,-8.3,56,6],['service-props',12,0,-10.5,68,0],['utility-fence',13.5,0,-12.5,90,0]);}
    views.push(['hanging-light',...point((x1-x0)-2.45,.02,(z1-z0)-3.4),c.flipZ?47:133,27]);
    for(const [name,...pose] of [...views,...outdoor]){
      await page.evaluate(p=>window.__crossfire.freeCam(...p),pose.map((v,i)=>i===1?v+1.64:v));await delay(800);
      await page.screenshot({path:`${out}/${id}-${name}.png`});
      const stats=await page.evaluate(()=>window.__crossfire.stats());assert.deepEqual(stats.missingMaterials,[]);
      results.push({id,name,pose,stats});console.log(`Captured ${id} ${name}`);
    }
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(`${out}/${workOnly?'work-area-results':'results'}.json`,JSON.stringify({errors,results},null,2));
}finally{await browser.close();}
