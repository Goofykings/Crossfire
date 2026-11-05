export const ASSIST_POINTS = 50;
export const ASSIST_WINDOW_MS = 10000;
export interface Contribution { victim: string; life: number; round: number; sources: {id:string;life:number;at:number}[] }
/** Server-owned damage history. Never accepts client damage/score claims. */
export class DamageContributions {
  private readonly victims = new Map<string,Contribution>();
  private revision=0;private saved=0;
  constructor(private readonly windowMs=ASSIST_WINDOW_MS, stored:Contribution[]=[], now=Date.now()) {
    for(const v of stored.slice(0,16))if(v&&typeof v.victim==='string'&&Number.isSafeInteger(v.life)&&Number.isSafeInteger(v.round)&&Array.isArray(v.sources)){
      const sources=v.sources.filter(s=>s&&typeof s.id==='string'&&Number.isSafeInteger(s.life)&&Number.isFinite(s.at)&&s.at<=now&&now-s.at<=windowMs).slice(0,16);
      if(sources.length)this.victims.set(v.victim,{...v,sources});
    }
  }
  damage(victim:string,life:number,round:number,id:string,sourceLife:number,amount:number,at:number):void {
    if(amount<=0||!Number.isFinite(amount)||victim===id)return;
    let v=this.victims.get(victim);
    if(!v||v.life!==life||v.round!==round){v={victim,life,round,sources:[]};this.victims.set(victim,v);}
    v.sources=v.sources.filter(s=>s.id!==id&&at-s.at<=this.windowMs);
    v.sources.push({id,life:sourceLife,at});this.revision++;
  }
  take(victim:string,life:number,round:number,now:number):Contribution['sources'] {
    const v=this.victims.get(victim);this.victims.delete(victim);this.revision++;
    return v?.life===life&&v.round===round?v.sources.filter(s=>now>=s.at&&now-s.at<=this.windowMs):[];
  }
  clear(id?:string):void {
    if(id===undefined)this.victims.clear();
    else{this.victims.delete(id);for(const v of this.victims.values())v.sources=v.sources.filter(s=>s.id!==id);}
    this.revision++;
  }
  capture(){return {data:structuredClone([...this.victims.values()]),revision:this.revision};}
  committed(revision:number):void{this.saved=Math.max(this.saved,revision);}
  get dirty():boolean{return this.revision>this.saved;}
}
