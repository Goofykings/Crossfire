import fs from 'node:fs';import assert from 'node:assert/strict';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {build} from 'vite';import puppeteer from 'puppeteer-core';import {serveFrames} from './frame-time-server.mjs';
await build({configFile:false,base:'/',logLevel:'warn',build:{outDir:'.cache/frame-mask',copyPublicDir:false,rolldownOptions:{input:'tools/frame-mask-lab.html'}}});
const server=serveFrames('mask',4242);let browser;const report={errors:[]};
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',userDataDir:path.resolve('.cache/frame-mask-profile'),headless:true,pipe:true,protocolTimeout:120000,args:['--use-angle=d3d11']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.goto('http://127.0.0.1:4242/tools/frame-mask-lab.html');await page.waitForFunction(()=>window.maskAudit);
 report.rows=await page.evaluate(()=>window.maskAudit());assert.deepEqual(report.errors,[]);assert.ok(report.rows.some(r=>r.visiblePlayerPixels>0));assert.ok(report.rows.some(r=>r.afterDraws<r.beforeDraws));console.log('PASS byte-identical GPU masks at five viewpoints',JSON.stringify(report.rows));
}finally{
 if(browser){let timer;const closed=await Promise.race([browser.close().then(()=>true,()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),15000);})]);clearTimeout(timer);if(!closed){report.cleanupForced=true;const owned=browser.process();if(owned){try{execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{stdio:'ignore'});}catch{}for(const stream of owned.stdio)stream?.destroy();owned.unref();}browser.disconnect();}}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.writeFileSync('test-results/frame-time/mask-compatibility.json',JSON.stringify(report,null,2));
}
