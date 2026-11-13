import { challengePeriod } from './challenges';
export const STATISTICS_API_VERSION = 2;
export const PERIODS = ['daily', 'weekly', 'all'] as const;
export const METRICS = ['kills', 'points', 'wins'] as const;
export type StatsPeriod = typeof PERIODS[number];
export type StatsMetric = typeof METRICS[number];
export interface Totals { kills: number; assists: number; deaths: number; points: number; wins: number; games: number; gems: number }
export interface PeriodTotals { start: number; kills: number; points: number; wins: number }
export interface StatisticsRecord { id: string; name: string; revision: number; totals: Totals; daily: PeriodTotals; weekly: PeriodTotals; recent: string[]; lastRound: number }
export interface RankingRow { developer?:boolean; id: string; name: string; rank: number; value: number; local: boolean }
export interface LeaderboardView { version: number; period: StatsPeriod; metric: StatsMetric; start: number; serverTime: number; rows: RankingRow[]; own: RankingRow | null }
export interface PersonalStats { version: number; serverTime: number; totals: Totals }
export const emptyTotals = (): Totals => ({ kills:0, assists:0, deaths:0, points:0, wins:0, games:0, gems:0 });
export const periodStart = (period: StatsPeriod, at: number): number => period === 'all' ? 0 : challengePeriod(period, at).start;
export function createStatistics(id: string, name: string, at: number, existingGems = 0): StatisticsRecord {
  return { id, name, revision:0, totals:{...emptyTotals(),gems:existingGems}, daily:{start:periodStart('daily',at),kills:0,points:0,wins:0},
    weekly:{start:periodStart('weekly',at),kills:0,points:0,wins:0}, recent:[], lastRound:-1 };
}
export type StatisticsEvent = { id: string; at: number; gems?: number } & (
  { kind:'kill'; points:number } | {kind:'assist'; points:50} | {kind:'death'} | {kind:'match_reward'} | {kind:'round'; round:number; complete:boolean; won:boolean});
/** No client claims. Called with authoritative elimination IDs / finalized round IDs. */
export function advanceStatistics(p: StatisticsRecord, event: StatisticsEvent): boolean {
  if (p.recent.includes(event.id) || (event.kind==='round' && event.round<=p.lastRound)) return false;
  p.recent.push(event.id); if(p.recent.length>64)p.recent.shift();
  if(event.kind==='round')p.lastRound=event.round;
  const kills=Number(event.kind==='kill'), points=event.kind==='kill'||event.kind==='assist'?event.points:0;
  const wins=Number(event.kind==='round'&&event.complete&&event.won);
  p.totals.assists+=Number(event.kind==='assist');p.totals.kills+=kills; p.totals.points+=points; p.totals.wins+=wins;
  p.totals.deaths+=Number(event.kind==='death');p.totals.games+=Number(event.kind==='round'&&event.complete);
  p.totals.gems+=event.gems??0;
  for(const period of ['daily','weekly'] as const){
    const start=periodStart(period,event.at);
    // Never attribute a late historical event to the current period.
    if(start>p[period].start)p[period]={start,kills:0,points:0,wins:0};
    if(start===p[period].start){p[period].kills+=kills;p[period].points+=points;p[period].wins+=wins;}
  }
  p.revision++;return true;
}
export function statRatios(t: Totals): { win: string; kd: string } {
  return {win:`${(t.games?t.wins/t.games*100:0).toFixed(1)}%`,kd:t.deaths?(t.kills/t.deaths).toFixed(2):t.kills?'\u2014':'0.00'};
}
const natural=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
export function validTotals(v: unknown): v is Totals {
  if(!v||typeof v!=='object')return false;
  const keys=Object.keys(emptyTotals());return Object.keys(v).length===keys.length&&keys.every(k=>natural((v as Record<string,unknown>)[k]));
}
export function validPersonalStats(v:unknown):v is PersonalStats {
  const p=v as PersonalStats;return !!p&&p.version===STATISTICS_API_VERSION&&natural(p.serverTime)&&validTotals(p.totals);
}
export function validLeaderboard(v:unknown):v is LeaderboardView {
  const p=v as LeaderboardView;
  const row=(r:RankingRow)=>!!r&&typeof r.id==='string'&&/^[a-f0-9-]{36}$/.test(r.id)&&typeof r.name==='string'&&r.name.length<=48
    &&(r.developer===undefined||typeof r.developer==='boolean')&&natural(r.value)&&r.value>0&&natural(r.rank)&&r.rank>0&&typeof r.local==='boolean';
  if(!p||p.version!==STATISTICS_API_VERSION||!PERIODS.includes(p.period)||!METRICS.includes(p.metric)||!natural(p.serverTime)
    ||p.start!==periodStart(p.period,p.serverTime)||!Array.isArray(p.rows)||p.rows.length>10||!p.rows.every(row)||!(p.own===null||row(p.own)))return false;
  const ids=new Set<string>();
  return p.rows.every((r,i)=>{if(ids.has(r.id)||r.rank!==i+1)return false;ids.add(r.id);const old=p.rows[i-1];return !old||old.value>r.value||(old.value===r.value&&old.id<r.id);});
}
