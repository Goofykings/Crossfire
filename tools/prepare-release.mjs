import {appendFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function checkCredentials(env){
  const missing=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'].filter(k=>!env[k]?.trim());
  if(missing.length)throw new Error(`Missing GitHub Actions secrets: ${missing.join(', ')}. Add repository secrets in Settings > Secrets and variables > Actions. See docs/DEPLOYMENT.md.`);
}
export function releaseConfig(env,resolve,protocol,room,revision,wrangler){
  const backend=resolve(env);
  if(!backend.ok)throw new Error(backend.error);
  if(backend.provider!=='cloudflare')throw new Error('This automatic release deploys Cloudflare. Custom hosting requires its own deploy/verification job; do not publish Pages independently. See docs/DEPLOYMENT.md.');
  const url=new URL(backend.url);
  if(url.protocol!=='wss:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Production VITE_MULTIPLAYER_URL must use a public wss:// endpoint for the existing Worker.');
  url.protocol='https:';url.pathname='/health';
  if(!/^[a-f0-9]{40}$/.test(revision))throw new Error('Release must identify a full Git commit SHA.');
  if(!/^\d+\.\d+\.\d+$/.test(wrangler))throw new Error('Pin server Wrangler to an exact version for reproducible releases.');
  return {protocol,room,release:revision,healthUrl:url.href,wranglerVersion:wrangler};
}
async function main(){
  const command=process.argv[2];
  if(command==='credentials'){checkCredentials(process.env);console.log('Required Cloudflare secrets are configured.');return;}
  if(command==='manifest'){
    const expected=JSON.parse(readFileSync('.release/expected.json','utf8'));
    writeFileSync('dist/release.json',JSON.stringify(expected,null,2)+'\n');return;
  }
  const {createServer,loadEnv}=await import('vite');
  const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false,watch:null},optimizeDeps:{noDiscovery:true},appType:'custom'});
  try{
    const {resolveMultiplayerBackend,PROTOCOL_VERSION,PUBLIC_ROOM}=await vite.ssrLoadModule('/tools/release-config.ts');
    const revision=process.env.GITHUB_SHA??process.env.RELEASE_SHA??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const server=JSON.parse(readFileSync('server/package.json','utf8'));
    // Match Vite's production .env loading and process overrides exactly.
    const expected=releaseConfig(loadEnv('production',process.cwd(),'VITE_'),resolveMultiplayerBackend,PROTOCOL_VERSION,PUBLIC_ROOM,revision,server.devDependencies.wrangler);
    mkdirSync('.release',{recursive:true});writeFileSync('.release/expected.json',JSON.stringify(expected,null,2)+'\n');
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,
      `protocol=${expected.protocol}\nhealth-url=${expected.healthUrl}\nwrangler-version=${expected.wranglerVersion}\n`);
    console.log(`Prepared protocol v${expected.protocol}, release ${expected.release}.`);
  }finally{await vite.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(e=>{
  const message=String(e.message);
  // Make configuration failures visible on the Actions summary, not just inside logs.
  console.error(process.env.GITHUB_ACTIONS==='true'
    ? `::error::${message.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')}`
    : message);
  process.exitCode=1;
});
