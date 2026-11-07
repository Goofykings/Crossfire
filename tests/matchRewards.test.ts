import {expect,it} from 'vitest';
import {MATCH_GEM_RULES,matchGems,matchRewardRequests,payMatchGems,type MatchLedger} from '../server/src/matchRewards';
import {createCareer,careerView} from '../shared/challenges';
import {createStatistics,advanceStatistics} from '../shared/statistics';
import {finalizeRound,type RoundStanding} from '../shared/scoring';
import {validResult} from '../shared/protocol';
const at=Date.UTC(2026,10,6,12);
const players:RoundStanding[]=Array.from({length:8},(_,i)=>({id:'player-'+i,name:'Player '+i,team:i<4?'blue':'red',score:[5000,750,1000,0,4500,750,0,0][i],kills:1,deaths:1,assists:0,weapon:'rifle'}));
function fixture(mode:'ffa'|'teams'='ffa'){
 const ledger:MatchLedger={roundId:12,mapId:'european-town',mode,endsAt:at,players:Object.fromEntries(players.map(p=>[p.id,{...p,team:mode==='ffa'?null:p.team}])),rewardStartedAt:at-600000,rewardParticipants:Object.fromEntries(players.map(p=>[p.id,{identity:'profile-'+p.id,name:p.name,firstSpawn:at-120000,abandoned:false}]))};
 return {ledger,result:finalizeRound(ledger,{blue:5,red:2})};
}
it('centralized placement/performance/win formula has the specified examples and cap',()=>{
 expect([matchGems(1,5000),matchGems(2,750),matchGems(3,1000),matchGems(1,5000,true),matchGems(2,750,false)]).toEqual([20,7,5,22,7]);
 expect(matchGems(4,100000,true)).toBe(0);expect(matchGems(1,100000,true)).toBe(32);expect(MATCH_GEM_RULES.placement).toEqual([10,6,3]);
});
it('FFA rewards only the actual top three using final authoritative points',()=>{
 const {ledger,result}=fixture(),requests=matchRewardRequests('public-main',result,ledger);
 expect([...requests.keys()]).toEqual(['player-0','player-4','player-2']);expect([...requests.values()].map(r=>matchGems(r.rank,r.points,r.won))).toEqual([20,15,5]);expect([...requests.values()].every(r=>!r.won)).toBe(true);
});
it('Teams ranks the top three independently on each team and only winners get +2',()=>{
 const {ledger,result}=fixture('teams'),requests=matchRewardRequests('room',result,ledger);expect(requests.size).toBe(6);expect(requests.has('player-3')).toBe(false);expect(requests.has('player-7')).toBe(false);expect(requests.get('player-0')?.won).toBe(true);expect(requests.get('player-4')?.won).toBe(false);
 result.draw=true;result.winningTeam=null;expect([...matchRewardRequests('room',result,ledger).values()].every(r=>!r.won)).toBe(true);
});
it('deterministic tied points, short rosters, abandoned and noncompetitive matches',()=>{
 const {ledger,result}=fixture();for(const p of result.players!)p.score=500;const first=[...matchRewardRequests('public-main',result,ledger).keys()];expect(first).toEqual(['player-0','player-1','player-2']);
 ledger.rewardParticipants!['player-0'].abandoned=true;expect(matchRewardRequests('public-main',result,ledger).has('player-0')).toBe(false);
 ledger.rewardParticipants!['player-1'].firstSpawn=at-20000;expect(matchRewardRequests('public-main',result,ledger).has('player-1')).toBe(false);
 ledger.rewardStartedAt=at-599999;expect(matchRewardRequests('public-main',result,ledger).size).toBe(0);ledger.rewardStartedAt=at-600000;
 result.players=result.players!.slice(0,2);expect([...matchRewardRequests('public-main',result,ledger).keys()]).toEqual(['player-4']);delete ledger.rewardParticipants;expect(matchRewardRequests('public-main',result,ledger).size).toBe(0);
 const solo=fixture();solo.result.players=solo.result.players!.slice(0,1);expect(matchRewardRequests('public-main',solo.result,solo.ledger).size).toBe(0);
 const empty=fixture();for(const p of empty.result.players!)p.kills=0;expect(matchRewardRequests('public-main',empty.result,empty.ledger).size).toBe(0);
});
it('durable source-qualified receipts prevent duplicate/older awards and preserve spendable vs lifetime gems',()=>{
 const p=createCareer('id',at);p.gems=300;const request={matchId:'public-main:round:12',roundId:12,rank:1,points:5000,won:false};
 const stats=createStatistics('stats','Player',at,300),amount=payMatchGems(p,'public-main',request);advanceStatistics(stats,{kind:'match_reward',id:request.matchId,at,gems:amount});expect(p.gems).toBe(320);expect(stats.totals.gems).toBe(320);p.gems-=300;expect(stats.totals.gems).toBe(320);
 const restored=structuredClone(p);expect(payMatchGems(restored,'public-main',request)).toBe(0);expect(payMatchGems(restored,'public-main',{...request,matchId:'public-main:round:11',roundId:11})).toBe(0);expect(restored.gems).toBe(20);
 expect(payMatchGems(restored,'another',{...request,matchId:'another:round:12'})).toBe(20);expect(careerView(restored,at)).not.toHaveProperty('matchRewards');expect(()=>payMatchGems(p,'evil',request)).toThrow();
});
it('additive result receipts preserve older results and reject forged or malformed awards',()=>{
 const {result}=fixture();expect(validResult(result)).toBe(true);
 const gems={matchId:'public-main:round:12',awards:{'player-0':20,'player-1':0}};
 expect(validResult({...result,gemRewards:gems})).toBe(true);
 for(const awards of [{'player-0':-1},{'player-0':33},{'player-0':1.5},{unknown:10}])expect(validResult({...result,gemRewards:{...gems,awards}})).toBe(false);
 expect(validResult({...result,gemRewards:{...gems,matchId:''}})).toBe(false);
});
