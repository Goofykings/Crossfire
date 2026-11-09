import {expect,it} from 'vitest';
import {CHALLENGES,selectChallenges,challengeDefinition,refreshCareer,createCareer,advanceChallenges,careerView,validCareerView} from '../shared/challenges';
import {practiceChallengeDelta,validPracticeChallengeRequest,type PracticeChallengeRun} from '../shared/practiceChallenges';

it('varies all five guns and melee, with exactly one bot-kill and one bot-win objective per rotation',()=>{
 const weapons=new Set<string>(),difficulties=new Set<string>();
 for(const category of ['daily','weekly'] as const)for(let i=0;i<200;i++){
  const cards=selectChallenges('guest-'+i,category,Date.UTC(2026,10,9+i)).challenges.map(c=>challengeDefinition(c.id)!);
  expect(cards).toHaveLength(5);expect(new Set(cards.map(c=>c.metric)).size).toBe(5);
  expect(cards.filter(c=>c.family==='bot-kills')).toHaveLength(1);expect(cards.filter(c=>c.family==='bot-wins')).toHaveLength(1);
  cards.filter(c=>c.family.startsWith('weapon:')).forEach(c=>weapons.add(c.metric));
  cards.filter(c=>c.family==='bot-kills').forEach(c=>difficulties.add(c.metric));
 }
 expect([...weapons].sort()).toEqual(['melee','rifle','semi-sniper','shotgun','smg','sniper']);expect(difficulties.size).toBe(4);
 for(const d of CHALLENGES.filter(d=>d.metric==='bot-kills-absurd'))expect(d.target).toBeLessThanOrEqual(5);
 for(const metric of weapons){
  const daily=CHALLENGES.filter(d=>d.category==='daily'&&d.metric===metric&&d.family.startsWith('weapon:'));
  for(const d of daily)expect(CHALLENGES.some(w=>w.category==='weekly'&&w.metric===metric&&w.target===d.target*4)).toBe(true);
 }
});
it('upgrades active three-card saves once, retaining progress, completions and earned gems',()=>{
 const now=Date.UTC(2026,10,9,12),p=createCareer('legacy',now);p.gems=400;
 for(const category of ['daily','weekly'] as const)p[category].challenges=p[category].challenges.slice(0,3);
 p.daily.challenges[0].progress=1;const original=structuredClone(p.daily.challenges);
 expect(refreshCareer(p,'legacy',now)).toBe(true);expect(p.daily.challenges.slice(0,3)).toEqual(original);expect(p.gems).toBe(400);
 expect(p.daily.challenges).toHaveLength(5);expect(refreshCareer(p,'legacy',now)).toBe(false);expect(validCareerView(careerView(p,now))).toBe(true);
});
it('bot difficulty progress cannot advance human weapon objectives or another difficulty',()=>{
 const at=Date.UTC(2026,10,9),p=createCareer('bot',at);
 p.daily.challenges=['daily:rifle:5','daily:bot-kills-absurd:1','daily:bot-wins-beginner:1','daily:melee:3','daily:bot-kills-intermediate:20'].map(id=>({id,progress:0,completedAt:null}));
 advanceChallenges(p,'bot',{kind:'bot',difficulty:'absurd',kills:1,won:false},at);
 expect(p.daily.challenges.map(c=>c.progress)).toEqual([0,1,0,0,0]);expect(p.gems).toBe(100);
});
it('bounds cumulative local reports and does not count win replays, early wins, expired runs or unknown fields',()=>{
 const run:PracticeChallengeRun={id:'12345678-1234-1234-1234-123456789abc',difficulty:'absurd',bots:1,startedAt:0,kills:0,finished:false};
 const report={version:1,action:'progress',runId:run.id,kills:1,finished:false,won:false} as const;
 expect(validPracticeChallengeRequest(report)).toBe(true);expect(validPracticeChallengeRequest({...report,gems:999})).toBe(false);
 expect(practiceChallengeDelta(run,{...report,kills:2},1)).toBeNull();expect(practiceChallengeDelta(run,{...report,finished:true,won:true},5000)).toBeNull();
 const won=practiceChallengeDelta(run,{...report,finished:true,won:true},600000)!;
 expect(won.event).toMatchObject({kills:1,won:true});expect(practiceChallengeDelta(won.run,{...report,finished:true,won:true},600001)!.event).toMatchObject({kills:0,won:false});
 expect(practiceChallengeDelta(run,report,3600001)).toBeNull();
});
