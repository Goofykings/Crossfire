import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as httpServer} from 'node:http';
import {checkCredentials,releaseConfig} from '../prepare-release.mjs';
import {healthProblem,verifyRelease} from '../verify-release.mjs';

const revision='a'.repeat(40),health={ok:true,service:'crossfire-multiplayer',room:'public-main',protocol:12,release:revision};
test('missing credential errors identify names without exposing values',()=>{
  assert.throws(()=>checkCredentials({}),/CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID/);
  assert.throws(()=>checkCredentials({CLOUDFLARE_API_TOKEN:'private-token'}),e=>e.message.includes('CLOUDFLARE_ACCOUNT_ID')&&!e.message.includes('private-token'));
  assert.doesNotThrow(()=>checkCredentials({CLOUDFLARE_API_TOKEN:'private-token',CLOUDFLARE_ACCOUNT_ID:'private-account'}));
});
test('release configuration derives the health URL and protocol without a second version source',()=>{
  const resolve=()=>({ok:true,provider:'cloudflare',url:'wss://existing.example/ws'});
  assert.deepEqual(releaseConfig({},resolve,37,'public-main',revision,'4.152.0'),
    {protocol:37,room:'public-main',release:revision,healthUrl:'https://existing.example/health',wranglerVersion:'4.152.0'});
  assert.throws(()=>releaseConfig({},()=>({ok:false,error:'Invalid VITE_MULTIPLAYER_URL'}),12,'public-main',revision,'4.152.0'),/VITE_MULTIPLAYER_URL/);
  assert.throws(()=>releaseConfig({},()=>({ok:true,provider:'custom',url:'wss://custom.example/ws'}),12,'public-main',revision,'4.152.0'),/Custom hosting/);
  assert.throws(()=>releaseConfig({},()=>({ok:true,provider:'cloudflare',url:'ws://localhost:8787/ws'}),12,'public-main',revision,'4.152.0'),/public wss/);
});
test('health gate rejects stale commits, versions, wrong services and unhealthy responses',()=>{
  assert.equal(healthProblem(health,12,revision),null);
  for(const patch of [{protocol:11},{release:'b'.repeat(40)},{ok:false},{service:'other'},{room:'other'}])assert.ok(healthProblem({...health,...patch},12,revision));
});
test('verification retries propagation/network failures then accepts the exact release',async()=>{
  const replies=[new Error('offline'),{...health,release:'b'.repeat(40)},health],waits=[];
  await verifyRelease({url:'https://existing.example/health',protocol:12,release:revision,attempts:3,interval:5,log:()=>{},
    fetcher:async(url,options)=>{assert.equal(url.searchParams.get('release'),revision);assert.equal(options.cache,'no-store');
      const reply=replies.shift();if(reply instanceof Error)throw reply;return {ok:true,json:async()=>reply};},wait:async ms=>waits.push(ms)});
  assert.deepEqual(waits,[5,5]);
});
test('wrong versions, invalid JSON and HTTP errors block Pages after bounded attempts',async()=>{
  for(const response of [{ok:false,status:503},{ok:true,json:async()=>({...health,protocol:10})},{ok:true,json:async()=>{throw Error('invalid JSON');}}]){
    let requests=0;await assert.rejects(verifyRelease({url:'https://existing.example/health',protocol:12,release:revision,attempts:2,
      fetcher:async()=>{requests++;return response;},wait:async()=>{},log:()=>{}}),/GitHub Pages must not be published/);
    assert.equal(requests,2);
  }
});
test('health gate accepts a real HTTP endpoint and rejects a real stale release',async()=>{
  let current=health;const server=httpServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(current));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const options={url:`http://127.0.0.1:${server.address().port}/health`,protocol:12,release:revision,attempts:1,log:()=>{}};
    await verifyRelease(options);current={...health,protocol:10};await assert.rejects(verifyRelease(options),/protocol v10/);
    current={...health,release:'b'.repeat(40)};await assert.rejects(verifyRelease(options),/expected Git commit/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
