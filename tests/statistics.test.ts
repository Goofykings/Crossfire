import { expect, it } from 'vitest';
import { advanceStatistics, createStatistics, statRatios, periodStart, validLeaderboard, validPersonalStats, emptyTotals, STATISTICS_API_VERSION } from '../shared/statistics';
const at=Date.UTC(2026,10,1,23,59,59); // Sunday, one second before daily AND Monday weekly boundary.
it('records authoritative events immediately and deduplicates replayed elimination/round identities',()=>{
 const p=createStatistics('id','Player',at,125);
 const event={kind:'kill' as const,id:'kill-1',at,points:150,gems:100};
 expect(advanceStatistics(p,event)).toBe(true);expect(advanceStatistics(p,event)).toBe(false);
 advanceStatistics(p,{kind:'death',id:'death-1',at});
 advanceStatistics(p,{kind:'round',id:'round-1',round:1,at,complete:true,won:true,gems:250});
 expect(advanceStatistics(p,{kind:'round',id:'another-id',round:1,at,complete:true,won:true,gems:250})).toBe(false);
 expect(p.totals).toEqual({kills:1,assists:0,deaths:1,points:150,wins:1,games:1,gems:475});
 expect(p.daily.kills).toBe(1);expect(p.weekly.points).toBe(150);
 // Spending the separate wallet never changes cumulative earned gems.
 const wallet={gems:475};wallet.gems-=200;expect(p.totals.gems).toBe(475);
});
it('rolls UTC daily and Monday weekly events while preserving lifetime totals',()=>{
 const p=createStatistics('id','Player',at);
 advanceStatistics(p,{kind:'kill',id:'before',at,points:100});
 const next=at+1000;advanceStatistics(p,{kind:'kill',id:'after',at:next,points:150});
 expect(p.daily).toEqual({start:next,kills:1,points:150,wins:0});expect(p.weekly.start).toBe(next);
 expect(p.totals.kills).toBe(2);expect(p.totals.points).toBe(250);
 advanceStatistics(p,{kind:'kill',id:'late-history',at,points:100});
 expect(p.daily.kills).toBe(1);expect(p.weekly.kills).toBe(1);expect(p.totals.kills).toBe(3);
 expect(periodStart('all',next)).toBe(0);
});
it('does not award completed games or wins to incomplete/abandoned participation',()=>{
 const p=createStatistics('id','Player',at);
 advanceStatistics(p,{kind:'round',round:1,id:'round:1',at,complete:false,won:true,gems:100});
 expect(p.totals.games).toBe(0);expect(p.totals.wins).toBe(0);expect(p.totals.gems).toBe(100);
});
it('formats ratios consistently including empty and zero-death careers',()=>{
 expect(statRatios(emptyTotals())).toEqual({win:'0.0%',kd:'0.00'});
 expect(statRatios({...emptyTotals(),kills:3})).toEqual({win:'0.0%',kd:'\u2014'});
 expect(statRatios({...emptyTotals(),kills:3,deaths:2,wins:1,games:3})).toEqual({win:'33.3%',kd:'1.50'});
});
it('validates API version, ordering, duplicate IDs, selection and personal payloads',()=>{
 const row={id:'11111111-1111-4111-8111-111111111111',name:'Guest',rank:1,value:10,local:false};
 const board={version:STATISTICS_API_VERSION,serverTime:at,start:0,period:'all',metric:'kills',rows:[row],own:null};
 expect(validLeaderboard(board)).toBe(true);expect(validLeaderboard({...board,version:STATISTICS_API_VERSION+1})).toBe(false);
 expect(validLeaderboard({...board,rows:[row,{...row,rank:2}]})).toBe(false);
 expect(validLeaderboard({...board,rows:[{...row,value:-1}]})).toBe(false);
 expect(validPersonalStats({version:STATISTICS_API_VERSION,serverTime:at,totals:emptyTotals()})).toBe(true);
 expect(validPersonalStats({version:STATISTICS_API_VERSION,serverTime:at,totals:{...emptyTotals(),gems:-1}})).toBe(false);
});

it('assist points persist without incrementing kills, wins or combo statistics',()=>{
 const p=createStatistics('id','Player',at),e={kind:'assist' as const,id:'assist:one',at,points:50 as const};
 expect(advanceStatistics(p,e)).toBe(true);expect(advanceStatistics(p,e)).toBe(false);
 expect(p.totals).toEqual({...emptyTotals(),assists:1,points:50});expect(p.daily.points).toBe(50);expect(p.weekly.kills).toBe(0);
});
