import { describe, expect, it } from 'vitest';
import { advanceChallenges, CHALLENGES, challengeDefinition, challengePeriod, createCareer, refreshCareer, careerView, selectChallenges, validCareerView, type ChallengeMetric, type ChallengeEvent } from '../shared/challenges';
import { parseClientMessage, parseServerMessage, PROTOCOL_VERSION } from '../shared/protocol';
import { resetCountdown } from '../src/ui/ChallengesPanel';

const now = Date.UTC(2026,10,3,12), id='server-issued-identity';
const eventFor = (metric: ChallengeMetric): ChallengeEvent => ['wins','mvp','matches'].includes(metric)
  ? {kind:'round',won:true,mvp:true,complete:true}
  : {kind:'kill',weapon:['rifle','smg','shotgun','sniper'].includes(metric)?metric as 'rifle':'grenade',head:true,points:1000};

describe('periods and stable, varied challenge assignments',()=>{
  it('uses UTC midnight and Monday, including month/year boundaries',()=>{
    expect(challengePeriod('daily',Date.UTC(2027,0,1,23,59,59))).toEqual({start:Date.UTC(2027,0,1),endsAt:Date.UTC(2027,0,2)});
    expect(challengePeriod('weekly',Date.UTC(2027,0,1))).toEqual({start:Date.UTC(2026,11,28),endsAt:Date.UTC(2027,0,4)});
    expect(challengePeriod('weekly',Date.UTC(2027,0,4))).toEqual({start:Date.UTC(2027,0,4),endsAt:Date.UTC(2027,0,11)});
  });
  it.each(['daily','weekly'] as const)('assigns exactly three distinct families, stable across refresh for %s',category=>{
    const a=selectChallenges(id,category,now),b=selectChallenges(id,category,now+10000);
    expect(a).toEqual(b);expect(a.challenges).toHaveLength(3);
    expect(new Set(a.challenges.map(c=>challengeDefinition(c.id)!.family)).size).toBe(3);
    expect(new Set(Array.from({length:20},(_,i)=>JSON.stringify(selectChallenges(String(i),category,now).challenges))).size).toBeGreaterThan(10);
  });
  it('rotates only expired periods and keeps previously earned gems',()=>{
    const p=createCareer(id,now);p.gems=350;const week=structuredClone(p.weekly);
    refreshCareer(p,id,Date.UTC(2026,10,4));expect(p.daily.start).toBe(Date.UTC(2026,10,4));expect(p.weekly).toEqual(week);expect(p.gems).toBe(350);
    refreshCareer(p,id,Date.UTC(2026,10,9));expect(p.weekly.start).toBe(Date.UTC(2026,10,9));expect(p.gems).toBe(350);
  });
});
describe('authoritative challenge rules and automatic rewards',()=>{
  it.each(CHALLENGES)('tracks $id and grants its reward exactly once',definition=>{
    const p=createCareer(id,now),card={id:definition.id,progress:0,completedAt:null as number|null};
    p.daily.challenges=[];p.weekly.challenges=[];p[definition.category].challenges=[card];
    for(let n=0;n<definition.target;n++)advanceChallenges(p,id,eventFor(definition.metric),now);
    expect(card.progress).toBe(definition.target);expect(card.completedAt).toBe(now);expect(p.gems).toBe(definition.reward);
    for(let n=0;n<10;n++)advanceChallenges(p,id,eventFor(definition.metric),now+1);
    expect(p.gems).toBe(definition.reward);expect(card.progress).toBe(definition.target);
  });
  it('distinguishes weapon/headshot kills, grenades and points',()=>{
    const p=createCareer(id,now);p.daily.challenges=['daily:sniper:5','daily:headshots:3','daily:points:1000'].map(id=>({id,progress:0,completedAt:null}));
    advanceChallenges(p,id,{kind:'kill',weapon:'rifle',head:false,points:100},now);
    expect(p.daily.challenges.map(c=>c.progress)).toEqual([0,0,100]);
    advanceChallenges(p,id,{kind:'kill',weapon:'grenade',head:false,points:120},now);
    expect(p.daily.challenges.map(c=>c.progress)).toEqual([0,0,220]);
    advanceChallenges(p,id,{kind:'kill',weapon:'sniper',head:true,points:150},now);
    expect(p.daily.challenges.map(c=>c.progress)).toEqual([1,1,370]);
  });
  it('awards all six completions to a maximum 1050 per active pair of periods',()=>{
    const p=createCareer(id,now);
    for(const category of ['daily','weekly'] as const)for(const c of p[category].challenges)c.progress=challengeDefinition(c.id)!.target-1;
    for(const category of ['daily','weekly'] as const)for(const c of p[category].challenges)advanceChallenges(p,id,eventFor(challengeDefinition(c.id)!.metric),now);
    expect(p.gems).toBe(1050);expect(validCareerView(careerView(p,now))).toBe(true);
    for(let i=0;i<10;i++)for(const metric of ['sniper','rifle','smg','shotgun','points','wins'] as const)advanceChallenges(p,id,eventFor(metric),now);
    expect(p.gems).toBe(1050);
  });
  it('does not roll new challenges backwards for a late previous-day result',()=>{
    const p=createCareer(id,now),next=Date.UTC(2026,10,4);refreshCareer(p,id,next);
    const daily=structuredClone(p.daily);advanceChallenges(p,id,{kind:'round',won:true,mvp:true,complete:true},now);
    expect(p.daily).toEqual(daily);
  });
  it('does not count a draw/loss, non-MVP or incomplete match',()=>{
    const p=createCareer(id,now);p.daily.challenges=['daily:wins:1','daily:mvp:1','daily:matches:2'].map(id=>({id,progress:0,completedAt:null}));
    advanceChallenges(p,id,{kind:'round',won:false,mvp:false,complete:false},now);expect(p.daily.challenges.map(c=>c.progress)).toEqual([0,0,0]);
  });
});
describe('strict shared protocol and display timing',()=>{
  it('permits only a credential on join, never balances, profile IDs or progress claims',()=>{
    const join={v:PROTOCOL_VERSION,type:'join',name:'Guest',profileToken:'a'.repeat(64)};
    expect(parseClientMessage(JSON.stringify(join))).not.toBeNull();
    for(const extra of [{gems:1000},{profileId:'mine'},{progress:99},{profileToken:'bad'}])expect(parseClientMessage(JSON.stringify({...join,...extra}))).toBeNull();
    expect(parseClientMessage(JSON.stringify({v:PROTOCOL_VERSION,type:'career',profile:careerView(createCareer(id,now),now)}))).toBeNull();
  });
  it('validates periods, three cards, bounds and completion/reward status on private frames',()=>{
    const view=careerView(createCareer(id,now),now),wire={v:PROTOCOL_VERSION,type:'career',profile:view};
    expect(parseServerMessage(JSON.stringify(wire))).not.toBeNull();
    for(const patch of [{gems:-1},{gems:1.5},{daily:{...view.daily,endsAt:view.daily.endsAt+1}},{weekly:{...view.weekly,challenges:[]}},{credential:'secret'}])
      expect(parseServerMessage(JSON.stringify({...wire,profile:{...view,...patch}}))).toBeNull();
    const bad=structuredClone(view);bad.daily.challenges[0].progress=999999;
    expect(validCareerView(bad)).toBe(false);
  });
  it('formats countdowns from a supplied server clock, including no negative values',()=>{
    expect(resetCountdown(100000,39000)).toBe('00:01:01');expect(resetCountdown(100000,200000)).toBe('00:00:00');
    expect(resetCountdown(86400000,0)).toBe('1d 00:00:00');
  });
});

it('assist points advance only point objectives and grant completion gems once',()=>{
 const p=createCareer(id,now);p.daily.challenges=['daily:points:1000','daily:eliminations:10','daily:headshots:3'].map(id=>({id,progress:id.includes(':points:')?950:0,completedAt:null}));
 advanceChallenges(p,id,{kind:'points',points:50},now);expect(p.daily.challenges.map(c=>c.progress)).toEqual([1000,0,0]);expect(p.gems).toBe(100);
 advanceChallenges(p,id,{kind:'points',points:50},now+1);expect(p.gems).toBe(100);
});
