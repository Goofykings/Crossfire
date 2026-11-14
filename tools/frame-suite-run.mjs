/** Sequential runs: never benchmark against a concurrent build/test suite. */
import {spawn} from 'node:child_process';
for(const [label,port] of [['cycle0',4237],['cycle1',4238],['cycle2',4239]])await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['tools/frame-matrix-run.mjs',label,String(port)],{stdio:'inherit'});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${label} failed (${code})`)));
});
