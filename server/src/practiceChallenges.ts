import {advanceChallenges,careerView} from '../../shared/challenges';
import {validPracticeChallengeRequest,practiceChallengeDelta,type PracticeChallengeRun} from '../../shared/practiceChallenges';
import {advanceStatistics} from '../../shared/statistics';
import {PROTOCOL_VERSION} from '../../shared/protocol';
import {careerIdentity,validCareerCredential,type Careers} from './careers';
import type {Statistics} from './statistics';

export class PracticeChallenges {
  constructor(private storage:DurableObjectStorage,private careers:Careers,private statistics:Statistics){}
  async http(request:Request):Promise<Response>{
    const credential=request.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
    if(!validCareerCredential(credential))return Response.json({error:'A guest profile is required.'},{status:401});
    const identity=await careerIdentity(credential),original=await this.careers.load(identity);
    if(!original)return Response.json({error:'Guest profile not found.'},{status:401});
    const body:unknown=await request.json();if(!validPracticeChallengeRequest(body))return Response.json({error:'Invalid practice challenge request.'},{status:400});
    const now=Date.now(),key='practice-challenges:'+identity;
    const previous=await this.storage.get<PracticeChallengeRun>(key);
    if(body.action==='start'){
      if(previous&&now-previous.startedAt<5000)return Response.json({error:'Wait before starting another practice challenge run.'},{status:429});
      const run:PracticeChallengeRun={id:crypto.randomUUID(),difficulty:body.difficulty,bots:body.bots,startedAt:now,kills:0,finished:false};
      await this.storage.put(key,run);return Response.json({version:1,runId:run.id});
    }
    const update=previous?practiceChallengeDelta(previous,body,now):null;
    if(!update)return Response.json({error:'Practice challenge session expired or progress is invalid.'},{status:409});
    const profile=structuredClone(original),before=profile.gems;
    advanceChallenges(profile,identity,update.event,now);
    const career=this.careers.capture(),stats=this.statistics.capture(),writes:Record<string,unknown>={...career.records,...stats.records,[key]:update.run,['career:'+identity]:profile};
    let record;
    const existing=profile.gems>before?await this.statistics.load(identity):undefined;
    if(existing){
      record=structuredClone(existing);
      advanceStatistics(record,{kind:'match_reward',id:`practice-challenge:${update.run.id}:${update.run.kills}:${Number(update.run.finished)}`,at:now,gems:profile.gems-before});
      writes['statistics:'+identity]=record;writes[`statistics-index:${identity}:${String(record.revision).padStart(16,'0')}`]=record;
    }
    await this.storage.put(writes);
    this.careers.profiles.set(identity,profile);this.careers.committed(career.versions);
    if(record)this.statistics.accept(identity,record);
    return Response.json({v:PROTOCOL_VERSION,profile:careerView(profile,now)});
  }
}
