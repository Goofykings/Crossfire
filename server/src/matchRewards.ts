import {teamMode} from '../../shared/combat';
import type {CareerProfile} from '../../shared/challenges';
import {pointsOrder,type RoundLedger,type RoundResult} from '../../shared/scoring';
import {MATCH_GEM_RULES} from '../../shared/matchRewards';
export {MATCH_GEM_RULES} from '../../shared/matchRewards';
export interface RewardParticipant {identity:string;name:string;firstSpawn:number;abandoned:boolean}
export interface MatchLedger extends RoundLedger {rewardStartedAt?:number;rewardParticipants?:Record<string,RewardParticipant>}
export interface MatchRewardRequest {matchId:string;roundId:number;rank:number;points:number;won:boolean;rewardVersion?:2}
export const matchIdentity=(source:string,round:number)=>`${source}:round:${round}`;
export function matchGems(rank:number,points:number,won=false):number{
 const base=MATCH_GEM_RULES.placement[rank-1];return base===undefined?0:(base+Math.min(MATCH_GEM_RULES.performanceCap,Math.floor(Math.max(0,points)/MATCH_GEM_RULES.pointsPerGem))+(won?MATCH_GEM_RULES.winningTeam:0))*MATCH_GEM_RULES.multiplier;
}
/** Final standings decide placement. Only a completed competitive round and real,
 * non-abandoned participation qualify; zero-score opponents can still qualify. */
export function matchRewardRequests(source:string,result:RoundResult,ledger:MatchLedger):Map<string,MatchRewardRequest>{
 const requests=new Map<string,MatchRewardRequest>(),players=result.players,participants=ledger.rewardParticipants;
 if(!players?.length||!participants||ledger.roundId!==result.roundId||!Number.isFinite(ledger.rewardStartedAt)||result.endedAt-ledger.rewardStartedAt!<MATCH_GEM_RULES.minDurationMs)return requests;
 const identities=new Set(players.flatMap(p=>participants[p.id]?[participants[p.id].identity]:[]));
 if(identities.size<2||!players.some(p=>p.kills>0)||teamMode(result.mode)&&!['blue','red'].every(team=>players.some(p=>p.team===team&&participants[p.id])))return requests;
 const groups=teamMode(result.mode)?['blue','red'].map(team=>players.filter(p=>p.team===team)):[players];
 for(const group of groups)for(const [index,p]of [...group].sort(pointsOrder).slice(0,3).entries()){
  const participant=participants[p.id];if(!participant||participant.abandoned||participant.firstSpawn>result.endedAt-MATCH_GEM_RULES.minParticipationMs||p.kills+p.deaths+(p.assists??0)===0)continue;
  requests.set(p.id,{matchId:matchIdentity(source,result.roundId),roundId:result.roundId,rank:index+1,points:p.score,rewardVersion:2,won:teamMode(result.mode)&&!result.draw&&p.team===result.winningTeam});
 }
 return requests;
}
/** Private, durable per-source high-water receipt. The outbox orders each room's
 * rounds. Receipt, spendable wallet and lifetime-earned statistics commit together. */
export function payMatchGems(profile:CareerProfile,source:string,request:MatchRewardRequest):number{
 if(request.matchId!==matchIdentity(source,request.roundId)||!Number.isSafeInteger(request.roundId)||request.roundId<0||!Number.isSafeInteger(request.rank)||request.rank<1||request.rank>3||!Number.isSafeInteger(request.points)||request.points<0||typeof request.won!=='boolean'||request.rewardVersion!==undefined&&request.rewardVersion!==2)throw Error('Invalid authoritative match reward');
 const receipts=profile.matchRewards??={},prior=receipts[source];if(prior&&prior.roundId>=request.roundId)return 0;
 // Pre-update durable outbox commands did not carry a reward version. Pay their original amount.
 const gems=matchGems(request.rank,request.points,request.won)/(request.rewardVersion===undefined?MATCH_GEM_RULES.multiplier:1);receipts[source]={matchId:request.matchId,roundId:request.roundId,gems};profile.gems+=gems;profile.revision++;return gems;
}
