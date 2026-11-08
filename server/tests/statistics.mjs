import { testRoom } from './test-rpc.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';

test('persistent indexed rankings: all nine combinations, top ten, ties, auth, UTC periods and restart',{timeout:40000},async()=>{
 const origin='http://localhost:5173';
 const options=convertV4MiniflareOptions({name:'statistics-test',modules:[{type:'ESModule',path:fileURLToPath(new URL('runtime-fixture.mjs',import.meta.url))},
  {type:'ESModule',path:fileURLToPath(new URL('../dist/index.js',import.meta.url))}],compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
  resourcePersistencePath:fs.mkdtempSync(fileURLToPath(new URL('../.wrangler/statistics-',import.meta.url))),
  durableObjects:{ROOM:{className:'PublicRoom',useSQLite:true}},bindings:{ALLOWED_ORIGINS:origin},log:new Log(LogLevel.ERROR)});
 let mf=new Miniflare(options),room,base;
 const request=(path,credential,method='GET')=>fetch(new URL(path,base),{method,headers:{Origin:origin,...(credential?{Authorization:`Bearer ${credential}`}:{})}});
 const board=async(period,stat,credential)=>{const r=await request(`/leaderboard?period=${period}&stat=${stat}`,credential);assert.equal(r.status,200);return r.json();};
 try{
  base=(await mf.ready).href;room=testRoom(mf, 'public-main');
  assert.equal((await request('/stats')).status,401);assert.equal((await request('/stats','f'.repeat(64))).status,401);
  assert.equal((await request('/leaderboard?period=all&stat=kills&extra=1')).status,400);
  assert.equal((await request('/leaderboard?period=all&stat=DROP_TABLE')).status,400);
  assert.equal((await request('/leaderboard?period=all&period=daily&stat=kills')).status,400);
  assert.equal((await request('/stats',null,'POST')).status,405);
  assert.equal((await fetch(new URL('/leaderboard?period=all&stat=kills',base),{headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.deepEqual((await board('all','kills')).rows,[]);
  const credentials=[];const now=Date.now();
  // Controlled persistence/ranking fixtures; live gameplay awards are separately
  // exercised in challenges.mjs with real authenticated combat and round results.
  for(let i=0;i<14;i++){
   const r=await request('/profile',null,'POST');assert.equal(r.status,201);const {credential}=await r.json();credentials.push(credential);
   const events=[];
   for(let k=0;k<i+1;k++)events.push({kind:'kill',id:`kill:${i}:${k}`,at:now,points:100});
   events.push({kind:'death',id:`death:${i}`,at:now},{kind:'round',id:`round:${i}`,round:1,at:now,complete:true,won:true,gems:100});
   await room.statisticsFixtureForTest(credential,`Player ${i}`,events);
  }
  for(const period of ['daily','weekly','all'])for(const stat of ['kills','points','wins']){
   const b=await board(period,stat,credentials[0]);assert.equal(b.rows.length,10);assert.equal(b.period,period);assert.equal(b.metric,stat);
   for(let i=0;i<b.rows.length;i++){
    const row=b.rows[i];assert.equal(row.rank,i+1);assert.equal(typeof row.name,'string');
    if(i){const prev=b.rows[i-1];assert.ok(prev.value>row.value||(prev.value===row.value&&prev.id<row.id));}
   }
   if(stat!=='wins'){assert.equal(b.rows[0].name,'Player 13');assert.equal(b.own.rank,14);assert.equal(b.own.local,true);}
   assert.ok(!JSON.stringify(b).includes(credentials[0]),'no credential disclosure');
  }
  const oldProfile=await (await request('/profile',null,'POST')).json();
  await room.statisticsFixtureForTest(oldProfile.credential,'Historical only',[{kind:'kill',id:'old-only',at:now-14*86400000,points:100}]);
  assert.equal((await board('daily','kills',oldProfile.credential)).own,null);
  assert.equal((await board('weekly','kills',oldProfile.credential)).own,null);
  assert.equal((await board('all','kills',oldProfile.credential)).own.value,1,'old buckets disappear automatically, lifetime remains');
  const before=await board('all','kills',credentials[0]);
  await room.statisticsFixtureForTest(credentials[0],'Renamed <script>',[{kind:'kill',id:'kill:0:0',at:now,points:100}]);
  const renamed=await board('all','kills',credentials[0]);assert.equal(renamed.own.value,before.own.value);assert.equal(renamed.own.name,'Renamed <script>');
  // A historical event belongs to its old server UTC bucket, never current daily/week.
  const old=now-14*86400000;
  await room.statisticsFixtureForTest(credentials[0],'Renamed <script>',[{kind:'kill',id:'historical',at:old,points:100}]);
  assert.equal((await board('daily','kills',credentials[0])).own.value,1);
  assert.equal((await board('weekly','kills',credentials[0])).own.value,1);
  assert.equal((await board('all','kills',credentials[0])).own.value,2);
  const stats=await (await request('/stats',credentials[0])).json();assert.equal(stats.totals.gems,100);
  const legacy=await (await request('/profile',null,'POST')).json();
  await room.legacyWalletForStatisticsTest(legacy.credential,500);
  assert.equal((await (await request('/stats',legacy.credential)).json()).totals.gems,500,'legacy known wallet earnings migrate without a match or fake name');
  await room.legacyWalletForStatisticsTest(legacy.credential,250); // Explicit fixture for possible future spending.
  assert.equal((await (await request('/stats',legacy.credential)).json()).totals.gems,500,'a wallet debit does not subtract historical earned gems');
  await room.statisticsProjectionRecoveryForTest(credentials[0],false);
  assert.equal((await board('all','kills',credentials[0])).own.value,2,'replaying an already-committed SQL journal does not increment totals');
  await room.statisticsProjectionRecoveryForTest(credentials[0]);
  await room.legacyStatisticsSchemaForTest(credentials[0]);
  room[Symbol.dispose]?.();room=null;await mf.dispose();mf=new Miniflare(options);base=(await mf.ready).href;
  const restored=await board('all','kills',credentials[0]);assert.equal(restored.own.value,2);assert.equal(restored.rows.length,10);
  const migrated=await (await request('/stats',credentials[0])).json();
  assert.equal(migrated.version,stats.version);assert.equal(migrated.totals.assists,0,'legacy statistics gain an honest zero assist count');
  assert.deepEqual(migrated.totals,stats.totals,'schema migration preserves all prior kills/points/wins/gems');
  assert.equal((await (await request('/stats',legacy.credential)).json()).totals.gems,500,'migrated earned gems persist independently after restart');
 }finally{room?.[Symbol.dispose]?.();await mf.dispose();}
});
