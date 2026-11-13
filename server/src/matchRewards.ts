import {teamMode} from '../../shared/combat';
import type {CareerProfile} from '../../shared/challenges';
import {pointsOrder,type RoundLedger,type RoundResult} from '../../shared/scoring';
import {MATCH_GEM_RULES} from '../../shared/matchRewards';
export {MATCH_GEM_RULES} from '../../shared/matchRewards';
export interface RewardParticipant {identity:string;name:string;firstSpawn:number;abandoned:boolean;life?:number}
export interface MatchLedger extends RoundLedger {rewardStartedAt?:number;rewardParticipants?:Record<string,RewardParticipant>}
export type MatchRewardRequest={matchId:string;roundId:number}&(
 {rewardVersion:3;kills:number;deaths:number;bonus:0|15|25|40}|
 {rewardVersion?:2;rank:number;points:number;won:boolean});
export const matchIdentity=(source:string,round:number)=>`${source}:round:${round}`;
export function matchGems(kills:number,deaths:number,bonus=0):number{return Math.max(0,kills*MATCH_GEM_RULES.kill-deaths*MATCH_GEM_RULES.death+bonus);}
/** Rank by points then immutable match participant ID, never username. */
export function teamBonuses(result:RoundResult):Map<string,0|15|25|40>{
 const bonuses=new Map<string,0|15|25|40>();if(!teamMode(result.mode)||result.draw||!result.winningTeam)return bonuses;
 const winners=(result.players??[]).filter(p=>p.team===result.winningTeam).sort(pointsOrder),losers=(result.players??[]).filter(p=>p.team!==null&&p.team!==result.winningTeam).sort(pointsOrder);
 if(!winners[0])return bonuses;bonuses.set(winners[0].id,25);
 const a=winners[1],b=losers[0];const runner=a&&b?(a.score===b.score?undefined:a.score>b.score?a:b):undefined;
 if(runner)bonuses.set(runner.id,15);return bonuses;
}
/** Preserve competitive-round, participation and deliberate Leave exclusions. */
export function matchRewardRequests(source:string,result:RoundResult,ledger:MatchLedger):Map<string,MatchRewardRequest>{
 const requests=new Map<string,MatchRewardRequest>(),players=result.players,participants=ledger.rewardParticipants;
 if(!players?.length||!participants||ledger.roundId!==result.roundId||!Number.isFinite(ledger.rewardStartedAt)||result.endedAt-ledger.rewardStartedAt!<MATCH_GEM_RULES.minDurationMs)return requests;
 const identities=new Set(players.flatMap(p=>participants[p.id]?[participants[p.id].identity]:[]));
 if(identities.size<2||!players.some(p=>p.kills>0)||teamMode(result.mode)&&!['blue','red'].every(team=>players.some(p=>p.team===team&&participants[p.id])))return requests;
 const bonuses=teamBonuses(result),seen=new Set<string>();
 for(const p of [...players].sort(pointsOrder)){
  const participant=participants[p.id];if(!participant||seen.has(participant.identity)||participant.abandoned||participant.firstSpawn>result.endedAt-MATCH_GEM_RULES.minParticipationMs||p.kills+p.deaths+(p.assists??0)===0)continue;
  seen.add(participant.identity);requests.set(p.id,{matchId:matchIdentity(source,result.roundId),roundId:result.roundId,rewardVersion:3,kills:p.kills,deaths:p.deaths,bonus:bonuses.get(p.id)??0});
 }return requests;
}
/** Retired session records belong to one verified account within one round.
 * Merge disjoint historical sessions once, preserving a canonical participant ID. */
export function canonicalizeParticipants(ledger:MatchLedger):void{
 const groups=new Map<string,string[]>();for(const [id,p]of Object.entries(ledger.rewardParticipants??{})){if(!ledger.players[id])continue;const ids=groups.get(p.identity)??[];ids.push(id);groups.set(p.identity,ids);}
 for(const ids of groups.values()){
  ids.sort((a,b)=>ledger.rewardParticipants![a].firstSpawn-ledger.rewardParticipants![b].firstSpawn||a.localeCompare(b));const first=ids[0],p=ledger.rewardParticipants![first];
  for(const id of ids.slice(1)){const row=ledger.players[id],other=ledger.rewardParticipants![id];for(const k of ['score','kills','deaths','assists'] as const)ledger.players[first][k]=(ledger.players[first][k]??0)+(row[k]??0);p.abandoned ||= other.abandoned;p.life=Math.max(p.life??0,other.life??0);delete ledger.players[id];delete ledger.rewardParticipants![id];}
 }
}
/** Durable per-room receipt, wallet and lifetime statistics commit together.
 * Old unpaid outbox commands keep their original formula; paid receipts never change. */
export function payMatchGems(profile:CareerProfile,source:string,request:MatchRewardRequest):number{
 const natural=(n:number)=>Number.isSafeInteger(n)&&n>=0;
 if(request.matchId!==matchIdentity(source,request.roundId)||!natural(request.roundId))throw Error('Invalid authoritative match reward');
 let gems:number;
 if(request.rewardVersion===3){if(!natural(request.kills)||!natural(request.deaths)||![0,15,25,40].includes(request.bonus))throw Error('Invalid authoritative match reward');gems=matchGems(request.kills,request.deaths,request.bonus);}
 else {if(!Number.isInteger(request.rank)||request.rank<1||request.rank>3||!natural(request.points)||typeof request.won!=='boolean'||request.rewardVersion!==undefined&&request.rewardVersion!==2)throw Error('Invalid authoritative match reward');gems=([10,6,3][request.rank-1]+Math.min(20,Math.floor(request.points/500))+(request.won?2:0))*(request.rewardVersion===2?4:1);}
 if(!natural(gems)||!natural(profile.gems+gems))throw Error('Invalid authoritative match reward');
 const receipts=profile.matchRewards??={},prior=receipts[source];if(prior&&prior.roundId>=request.roundId)return 0;
 receipts[source]={matchId:request.matchId,roundId:request.roundId,gems};profile.matchRewards=receipts;profile.gems+=gems;profile.revision++;return gems;
}
