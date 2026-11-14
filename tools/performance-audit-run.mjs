/** Serial local validation: avoid benchmarking while a compiler/test worker is
 * consuming the same CPU. Start `npm run preview -- --port 4236 --strictPort`
 * first. No deployments, commits, production requests, or process-wide kills. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
fs.mkdirSync('test-results',{recursive:true});
const jobs=[
 ['frontend','npm.cmd test -- --maxWorkers=1 --reporter=verbose'],
 ['server-typecheck','npm.cmd --prefix server run typecheck'],
 ['backend','npm.cmd --prefix server test'],
 ['protocol','node --test server/tests/protocol.mjs'],
 ['online-final','node tools/frame-online-test.mjs 180 --audit'],
 ['graphics','node tools/graphics-audit-test.mjs http://127.0.0.1:4236/'],
 ['cosmetics','node tools/cosmetic-compatibility-test.mjs'],
 ['cosmetic-animations','node tools/cosmetic-compatibility-test.mjs --reuse --animations'],
 ['cosmetic-contexts','node tools/cosmetic-compatibility-test.mjs --reuse --contexts --diagnose'],
 ['targets','node tools/frame-matrix-run.mjs audit-final 4236 targets 15'],
 ['practice-final','node tools/frame-time-test.mjs http://127.0.0.1:4236/ audit-final-practice farmstead 2 15 bots'],
];
const selected=process.argv.slice(2),results=[];
for(const name of selected)if(!jobs.some(job=>job[0]===name))throw Error('Unknown audit check: '+name);
const prior=fs.existsSync('test-results/audit-checks.json')?JSON.parse(fs.readFileSync('test-results/audit-checks.json','utf8')):[];
for(const [name,command]of jobs){
 if(selected.length&&!selected.includes(name))continue;
 const log=`test-results/audit-${name}.log`,fd=fs.openSync(log,'w'),start=Date.now();console.log('START',name);
 const result=spawnSync(process.platform==='win32'?'cmd.exe':'sh',process.platform==='win32'?['/d','/s','/c',command.replaceAll('npm.cmd',process.platform==='win32'?'npm.cmd':'npm')]:['-c',command.replaceAll('npm.cmd','npm')],
  {env:{...process.env,WRANGLER_LOG_PATH:path.resolve(`test-results/audit-${name}-wrangler.log`)},stdio:['ignore',fd,fd]});
 fs.closeSync(fd);results.push({name,command,log,code:result.status,signal:result.signal,error:result.error?.message,seconds:(Date.now()-start)/1000});
 console.log('FINISH',name,JSON.stringify(results.at(-1)));const latest=new Map(prior.map(row=>[row.name,row]));for(const row of results)latest.set(row.name,row);fs.writeFileSync('test-results/audit-checks.json',JSON.stringify([...latest.values()],null,2));
}
process.exitCode=results.some(r=>r.code!==0)?1:0;
