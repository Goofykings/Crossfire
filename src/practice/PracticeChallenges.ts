import {resultOutcome} from '../../shared/scoring';
import type {CareerClient} from '../network/CareerClient';
import type {PracticeSimulation} from './PracticeSimulation';

/** Optional account sync beside the offline simulation. Only bot objectives are
 * reported; practice combat statistics never enter multiplayer leaderboards. */
export class PracticeChallenges {
  private runId:string|undefined;
  private work=false;
  private stopped=false;
  private sentKills=0;
  private sentFinished=false;
  private nextAttempt=0;
  private starting=false;
  private nextStart=0;
  private baseKills=0;
  constructor(private career:CareerClient,private simulation:PracticeSimulation){}
  async start():Promise<void>{
    if(this.simulation.setup.bots===0||this.stopped||this.starting||this.runId)return;
    this.starting=true;this.baseKills=this.simulation.actors[0].state.kills;this.sentKills=this.baseKills;
    try{this.runId=await this.career.practiceChallenge({version:1,action:'start',difficulty:this.simulation.setup.difficulty,bots:this.simulation.setup.bots});}
    catch{this.nextStart=Date.now()+15000;/* Practice remains playable offline. */}
    finally{this.starting=false;}
  }
  update(force=false):void{
    const self=this.simulation.actors[0].state,result=this.simulation.result,finished=!!result;
    if(!this.runId&&!this.stopped&&Date.now()>=this.nextStart){void this.start();return;}
    if(this.work||!this.runId||this.sentFinished||this.stopped&&!force||!force&&Date.now()<this.nextAttempt||self.kills===this.sentKills&&!finished)return;
    const kills=self.kills;this.work=true;this.nextAttempt=Date.now()+5000;
    const won=!!result&&resultOutcome(result,self.id,self.lastPlayedTeam)==='VICTORY';
    void this.career.practiceChallenge({version:1,action:'progress',runId:this.runId,kills:kills-this.baseKills,finished,won}).then(()=>{
      this.sentKills=kills;this.sentFinished=finished;
    }).catch(()=>{/* Retry the same cumulative totals without double credit. */}).finally(()=>{this.work=false;if(this.stopped&&(this.simulation.result||this.simulation.actors[0].state.kills>this.sentKills)&&!this.sentFinished&&!force)this.update(true);});
  }
  stop():void{this.update(true);this.stopped=true;}
}
