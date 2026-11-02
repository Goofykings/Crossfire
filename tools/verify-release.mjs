import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export function healthProblem(health,protocol,release){
  if(health?.ok!==true||health.service!=='crossfire-multiplayer'||health.room!=='public-main')return 'Not a healthy Crossfire public Worker';
  if(health.protocol!==protocol)return `Worker protocol v${health.protocol} does not match expected v${protocol}`;
  if(health.release!==release)return 'Worker is not serving the expected Git commit yet';
  return null;
}
export async function verifyRelease({url,protocol,release,attempts=12,interval=5000,fetcher=fetch,wait=delay,log=console.log}){
  const endpoint=new URL(url);
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw new Error('Invalid Worker health URL');
  if(endpoint.protocol==='http:'&&!['localhost','127.0.0.1'].includes(endpoint.hostname))throw new Error('Public Worker health checks require HTTPS');
  if(!Number.isSafeInteger(protocol)||protocol<1||!/^[a-f0-9]{40}$/.test(release))throw new Error('Expected protocol and full release SHA are required');
  endpoint.searchParams.set('release',release);
  let problem='No health response';
  for(let n=1;n<=attempts;n++){
    try{
      const response=await fetcher(endpoint,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
      problem=response.ok?healthProblem(await response.json(),protocol,release):`Health endpoint returned HTTP ${response.status}`;
      if(!problem){log(`Verified Worker protocol v${protocol}, release ${release}.`);return;}
    }catch{problem='Health request failed, timed out or returned invalid JSON';}
    log(`Worker verification ${n}/${attempts}: ${problem}.`);
    if(n<attempts)await wait(interval);
  }
  throw new Error(`Backend verification failed: ${problem}. GitHub Pages must not be published. Check docs/DEPLOYMENT.md.`);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  verifyRelease({url:process.env.MULTIPLAYER_HEALTH_URL,protocol:Number(process.env.EXPECTED_PROTOCOL),release:process.env.EXPECTED_RELEASE})
    .catch(e=>{console.error(e.message);process.exitCode=1;});
}
