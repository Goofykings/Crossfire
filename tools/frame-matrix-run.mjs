import {spawn} from 'node:child_process';
const [label='current',port='4237',mode='targets',seconds='15']=process.argv.slice(2);
for(const map of ['farmstead','industrial-complex'])await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['tools/frame-time-test.mjs',`http://127.0.0.1:${port}/`,label,map,'2',seconds,mode],{stdio:'inherit'});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Frame run ${map} exited ${code}`)));
});
