import type {BotDifficulty,ChallengeEvent} from './challenges';
import {ROUND_MS} from './maps';

export type PracticeChallengeRequest={version:1;action:'start';difficulty:BotDifficulty;bots:number}
  |{version:1;action:'progress';runId:string;kills:number;finished:boolean;won:boolean};
export interface PracticeChallengeRun {id:string;difficulty:BotDifficulty;bots:number;startedAt:number;kills:number;finished:boolean}
export function validPracticeChallengeRequest(value:unknown):value is PracticeChallengeRequest{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as PracticeChallengeRequest;
  if(v.version!==1)return false;
  if(v.action==='start')return Object.keys(v).length===4&&['beginner','intermediate','advanced','absurd'].includes(v.difficulty)&&Number.isInteger(v.bots)&&v.bots>=1&&v.bots<=5;
  return v.action==='progress'&&Object.keys(v).length===6&&typeof v.runId==='string'&&/^[a-f0-9-]{36}$/.test(v.runId)
    &&Number.isSafeInteger(v.kills)&&v.kills>=0&&v.kills<=2000&&typeof v.finished==='boolean'&&typeof v.won==='boolean'&&(!v.won||v.finished);
}
/** Local simulation reports are bounded practice claims, never multiplayer kills.
 * Cumulative totals and a server-issued run make retries exactly-once. */
export function practiceChallengeDelta(run:PracticeChallengeRun,report:Extract<PracticeChallengeRequest,{action:'progress'}>,now:number):{run:PracticeChallengeRun;event:ChallengeEvent}|null{
  const elapsed=now-run.startedAt;
  if(report.runId!==run.id||elapsed<0||elapsed>60*60*1000||report.kills<run.kills
    ||report.kills>run.bots*(1+Math.floor(elapsed/3000))||report.won&&elapsed<ROUND_MS-30000)return null;
  if(run.finished)return report.kills===run.kills?{run,event:{kind:'bot',difficulty:run.difficulty,kills:0,won:false}}:null;
  return {run:{...run,kills:report.kills,finished:report.finished},event:{kind:'bot',difficulty:run.difficulty,kills:report.kills-run.kills,won:report.finished&&report.won}};
}
