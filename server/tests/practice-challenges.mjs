import assert from 'node:assert/strict';
import {test} from 'node:test';
import {harness,origin} from './room-harness.mjs';

test('bot challenges: bounded sessions, difficulty, idempotent rewards, restart and no multiplayer stats',{timeout:60000},async t=>{
 const h=await harness(t),token=await h.profile(),other=await h.profile();
 const request=async(body,credential=token)=>{
  const r=await fetch(new URL('/practice-challenges',h.base),{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 };
 await h.central.practiceChallengesForTest(token,'absurd');await h.api('/stats',token);
 assert.equal((await request({version:1,action:'start',difficulty:'absurd',bots:0})).status,400);
 assert.equal((await request({version:1,action:'start',difficulty:'absurd',bots:1},'f'.repeat(64))).status,401);
 const start={version:1,action:'start',difficulty:'absurd',bots:1},s=await request(start);assert.equal(s.status,200);
 assert.equal((await request(start)).status,429);
 const report={version:1,action:'progress',runId:s.data.runId,kills:1,finished:false,won:false};
 assert.equal((await request({...report,difficulty:'beginner'})).status,400);
 assert.equal((await request(report,other)).status,409);
 const first=await request(report);assert.equal(first.status,200);assert.equal(first.data.profile.gems,100);
 assert.equal((await request(report)).data.profile.gems,100,'retry cannot pay again');
 assert.equal((await request({...report,kills:2000})).status,409,'impossible kill rate rejected');
 assert.equal((await request({...report,finished:true,won:true})).status,409,'early match win rejected');
 await h.central.practiceChallengesForTest(token,null,6500);
 assert.equal((await request({...report,kills:3})).data.profile.gems,350,'weekly Absurd objective completes at three kills');
 for(let i=0;i<3;i++){
  const run=await request({version:1,action:'start',difficulty:'beginner',bots:2});assert.equal(run.status,200);
  await h.central.practiceChallengesForTest(token,null,600000);
  const win={version:1,action:'progress',runId:run.data.runId,kills:0,finished:true,won:true};
  const result=await request(win);assert.equal(result.status,200);assert.equal(result.data.profile.gems,i===2?700:450);
  assert.equal((await request(win)).data.profile.gems,result.data.profile.gems,'won match receipt pays once');
 }
 const stats=(await h.api('/stats',token)).data.totals;
 assert.deepEqual(stats,{kills:0,assists:0,deaths:0,points:0,wins:0,games:0,gems:700});
 const saved=(await h.api('/profile',token)).data.profile;
 assert.ok(saved.daily.challenges.slice(0,3).every(c=>c.progress===0),'bot reports never advance gun or melee goals');
 await h.restart();assert.deepEqual((await h.api('/profile',token)).data.profile.daily,saved.daily);
 assert.equal((await h.api('/profile',token)).data.profile.gems,700);
});
