import {expect,it} from 'vitest';
import {matchGems,matchRewardRequests,payMatchGems,teamBonuses,canonicalizeParticipants,type MatchLedger} from '../server/src/matchRewards';
import {createCareer,careerView} from '../shared/challenges';
import {createStatistics,advanceStatistics} from '../shared/statistics';
import {finalizeRound,type RoundStanding} from '../shared/scoring';
import {validResult} from '../shared/protocol';
const at=Date.UTC(2026,10,12,12);
const players:RoundStanding[]=Array.from({length:8},(_,i)=>({id:'player-'+i,name:i<2?'Same name':'Player '+i,team:i<4?'blue':'red',score:[5000,750,1000,0,4500,750,0,0][i],kills:i===3?0:5,deaths:4,assists:0,weapon:'rifle'}));
function fixture(mode:'ffa'|'teams'|'zone-control'='ffa'){
 const ledger:MatchLedger={roundId:12,mapId:'european-town',mode,endsAt:at,players:Object.fromEntries(players.map(p=>[p.id,{...p,team:mode==='ffa'?null:p.team}])),rewardStartedAt:at-600000,rewardParticipants:Object.fromEntries(players.map(p=>[p.id,{identity:'profile-'+p.id,name:p.name,firstSpawn:at-120000,abandoned:false}]))};
 return {ledger,result:finalizeRound(ledger,{blue:5,red:2})};
}
it('new rewards use kills minus deaths, clamp only the final award and have no old multiplier or placements',()=>{
 expect([matchGems(0,3),matchGems(5,4),matchGems(10,5),matchGems(0,1,25),matchGems(5,4,25)]).toEqual([0,38,85,22,63]);
 const {ledger,result}=fixture();const requests=matchRewardRequests('public-main',result,ledger);expect(requests.size).toBe(8);
 for(const r of requests.values()){expect(r.rewardVersion).toBe(3);if(r.rewardVersion===3)expect(r.bonus).toBe(0);}
 expect(requests.has('player-7')).toBe(true);
});
it.each(['teams','zone-control'] as const)('%s awards winning first +25 and exactly one of winning second / losing first +15',mode=>{
 const {ledger,result}=fixture(mode);expect([...teamBonuses(result)]).toEqual([['player-0',25],['player-4',15]]);
 const winnerSecond=result.players!.find(p=>p.id==='player-2')!;winnerSecond.score=4600;
 expect([...teamBonuses(result)]).toEqual([['player-0',25],['player-2',15]]);
 winnerSecond.score=4500;expect([...teamBonuses(result)]).toEqual([['player-0',25]]);
 result.draw=true;result.winningTeam=null;expect(teamBonuses(result).size).toBe(0);expect(matchRewardRequests('room',result,ledger).size).toBe(8);
});
it('equal-score team ranks break by participant ID, missing candidates never manufacture bonuses',()=>{
 const {result}=fixture('teams');for(const p of result.players!)p.score=500;expect([...teamBonuses(result)]).toEqual([['player-0',25]]);
 result.players=result.players!.filter(p=>p.id==='player-4');expect(teamBonuses(result).size).toBe(0);
 result.players=[{...players[0]}];expect([...teamBonuses(result)]).toEqual([['player-0',25]]);
});
it('participation, explicit Leave, competitive duration and solo exclusions are preserved',()=>{
 const {ledger,result}=fixture();ledger.rewardParticipants!['player-0'].abandoned=true;ledger.rewardParticipants!['player-1'].firstSpawn=at-20000;
 expect(matchRewardRequests('public-main',result,ledger).size).toBe(6);
 ledger.rewardStartedAt=at-599999;expect(matchRewardRequests('public-main',result,ledger).size).toBe(0);ledger.rewardStartedAt=at-600000;
 result.players=result.players!.slice(0,1);expect(matchRewardRequests('public-main',result,ledger).size).toBe(0);
 const empty=fixture();for(const p of empty.result.players!)p.kills=0;expect(matchRewardRequests('public-main',empty.result,empty.ledger).size).toBe(0);
});
it('durable per-source receipts preserve balances, lifetime gems, and once-only awards after restoration',()=>{
 const p=createCareer('id',at);p.gems=300;const request={matchId:'public-main:round:12',roundId:12,kills:5,deaths:4,bonus:0 as const,rewardVersion:3 as const};
 const stats=createStatistics('stats','Player',at,300),amount=payMatchGems(p,'public-main',request);expect(amount).toBe(38);advanceStatistics(stats,{kind:'match_reward',id:request.matchId,at,gems:amount});expect(p.gems).toBe(338);expect(stats.totals.gems).toBe(338);p.gems-=250;expect(stats.totals.gems).toBe(338);
 const restored=structuredClone(p);expect(payMatchGems(restored,'public-main',request)).toBe(0);expect(payMatchGems(restored,'public-main',{...request,matchId:'public-main:round:11',roundId:11})).toBe(0);expect(restored.gems).toBe(88);
 expect(payMatchGems(restored,'another',{...request,matchId:'another:round:12'})).toBe(38);expect(careerView(restored,at)).not.toHaveProperty('matchRewards');expect(()=>payMatchGems(p,'evil',request)).toThrow();
});
it('zero rewards create receipts without taking existing gems; paid and pending legacy rewards are not recalculated',()=>{
 const p=createCareer('id',at);p.gems=300;const old={matchId:'room:round:3',roundId:3,rank:1,points:5000,won:false};
 expect(payMatchGems(p,'room',old)).toBe(20);expect(payMatchGems(p,'room',{...old,rewardVersion:2})).toBe(0);
 expect(payMatchGems(p,'room',{...old,roundId:4,matchId:'room:round:4',rewardVersion:2})).toBe(80);
 const request={matchId:'room:round:5',roundId:5,kills:0,deaths:3,bonus:0 as const,rewardVersion:3 as const};expect(payMatchGems(p,'room',request)).toBe(0);expect(p.gems).toBe(400);expect(p.matchRewards!.room.roundId).toBe(5);
 expect(payMatchGems(p,'room',{...request,kills:100})).toBe(0);
});
it('new receipt validation permits higher legitimate awards and rejects unsafe, negative or unrelated records',()=>{
 const {result}=fixture();expect(validResult(result)).toBe(true);const gemRewards={matchId:'public-main:round:12',awards:{'player-0':1000,'player-1':0}};expect(validResult({...result,gemRewards})).toBe(true);
 for(const awards of [{'player-0':-1},{'player-0':Number.MAX_SAFE_INTEGER+1},{'player-0':1.5},{unknown:10}])expect(validResult({...result,gemRewards:{...gemRewards,awards}})).toBe(false);
});
it('retired sessions merge only by verified identity within a round, once; equal usernames stay distinct',()=>{
 const {ledger}=fixture();ledger.rewardParticipants!['player-1'].identity=ledger.rewardParticipants!['player-0'].identity;canonicalizeParticipants(ledger);
 expect(Object.keys(ledger.players)).toHaveLength(7);expect(ledger.players['player-0']).toMatchObject({score:5750,kills:10,deaths:8});expect(ledger.players['player-2']).toBeDefined();const before=structuredClone(ledger);canonicalizeParticipants(ledger);expect(ledger).toEqual(before);
});
