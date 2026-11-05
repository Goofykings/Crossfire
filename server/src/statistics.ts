import { advanceStatistics, createStatistics, emptyTotals, METRICS, PERIODS, periodStart, STATISTICS_API_VERSION,
  type StatisticsEvent, type StatisticsRecord, type StatsMetric, type StatsPeriod, type RankingRow } from '../../shared/statistics';
import { careerIdentity, validCareerCredential } from './careers';

/** Authoritative records + immutable projection journal share the room's atomic KV batch.
 * SQLite is only an indexed, replayable projection, not another service/database.
 */
export class Statistics {
  private readonly records = new Map<string,StatisticsRecord>();
  private readonly dirty = new Map<string,number>();
  private generation=0;
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS statistics_rankings (id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL,
      period TEXT NOT NULL, start INTEGER NOT NULL, kills INTEGER NOT NULL, points INTEGER NOT NULL, wins INTEGER NOT NULL, PRIMARY KEY(period,start,id))`);
    storage.sql.exec('CREATE INDEX IF NOT EXISTS statistics_identity ON statistics_rankings(id)');
    for(const metric of METRICS)storage.sql.exec(`CREATE INDEX IF NOT EXISTS statistics_${metric} ON statistics_rankings(period,start,${metric} DESC,id ASC)`);
  }
  async load(identity:string,name?:string,gems=0):Promise<StatisticsRecord|undefined>{
    let p=this.records.get(identity)??await this.storage.get<StatisticsRecord>('statistics:'+identity);
    if(!p&&name!==undefined)p=createStatistics(crypto.randomUUID(),name,Date.now(),gems);
    if(p){if(p.totals.assists===undefined){p.totals.assists=0;p.revision++;this.mark(identity);}this.records.set(identity,p);if(name&&p.name!==name){p.name=name;p.revision++;this.mark(identity);}else if(name!==undefined&&p.revision===0)this.mark(identity);}
    return p;
  }
  nextRound(identity:string):number{return (this.records.get(identity)?.lastRound??-1)+1;}
  accept(identity:string,record:StatisticsRecord):void{this.records.set(identity,record);}
  get hasPending():boolean{return this.dirty.size>0;}
  private mark(id:string):void{this.dirty.set(id,++this.generation);}
  event(identity:string|undefined,event:StatisticsEvent):void{
    const p=identity?this.records.get(identity):undefined;
    if(p&&identity&&advanceStatistics(p,event))this.mark(identity);
  }
  capture(){
    const records:Record<string,StatisticsRecord>={};
    for(const id of this.dirty.keys()){
      const p=structuredClone(this.records.get(id)!);
      records['statistics:'+id]=p;
      records[`statistics-index:${id}:${String(p.revision).padStart(16,'0')}`]=p;
    }
    return {records,versions:new Map(this.dirty)};
  }
  committed(versions:Map<string,number>,active:Set<string>):void{
    for(const [id,version]of versions)if(this.dirty.get(id)===version)this.dirty.delete(id);
    for(const id of this.records.keys())if(this.records.size>128&&!active.has(id)&&!this.dirty.has(id))this.records.delete(id);
  }
  private projection:Promise<void>|null=null;
  project():Promise<void>{
    return this.projection??=this.projectPending().finally(()=>{this.projection=null;});
  }
  private async projectPending():Promise<void>{
    // Immutable journal keys prevent an older flush deleting a newer pending update.
    // Replaying after a crash between SQL commit and journal deletion is idempotent.
    for(;;){
      const pending=await this.storage.list<StatisticsRecord>({prefix:'statistics-index:',limit:128});
      if(!pending.size)break;
      this.storage.transactionSync(()=>{
        for(const p of pending.values()){
          const prior=this.storage.sql.exec<{revision:number}>('SELECT revision FROM statistics_rankings WHERE id=? LIMIT 1',p.id).toArray()[0];
          if(prior&&prior.revision>=p.revision)continue;
          this.storage.sql.exec('DELETE FROM statistics_rankings WHERE id=?',p.id);
          for(const period of PERIODS){const values=period==='all'?{start:0,...p.totals}:p[period];
            this.storage.sql.exec('INSERT INTO statistics_rankings VALUES (?,?,?,?,?,?,?,?)',p.id,p.name,p.revision,period,values.start,values.kills,values.points,values.wins);}
        }
      });
      await this.storage.delete([...pending.keys()]);
    }
  }
  async http(request:Request):Promise<Response>{
    const url=new URL(request.url),now=Date.now();
    const personal=url.pathname==='/stats';
    const period=url.searchParams.get('period') as StatsPeriod,metric=url.searchParams.get('stat') as StatsMetric;
    if(personal?!!url.search:!PERIODS.includes(period)||!METRICS.includes(metric)||[...url.searchParams.keys()].length!==2)
      return Response.json({error:'Use period=daily|weekly|all and stat=kills|points|wins; /stats accepts no query.'},{status:400});
    const header=request.headers.get('Authorization');let owner:StatisticsRecord|undefined;
    if(header||personal){
      const credential=header?.startsWith('Bearer ')?header.slice(7):'';
      if(!validCareerCredential(credential))return Response.json({error:'A valid guest credential is required.'},{status:401});
      const identity=await careerIdentity(credential);
      const career=await this.storage.get<{gems:number}>('career:'+identity);
      if(!career)return Response.json({error:'Guest profile not found.'},{status:401});
      owner=await this.load(identity)??await this.load(identity,'',career.gems);
    }
    if(personal)return Response.json({version:STATISTICS_API_VERSION,serverTime:now,totals:owner?.totals??emptyTotals()});
    await this.project();
    const start=periodStart(period,now);
    // SQL column names come only from the enum validated above. Values use bindings.
    const rows=this.storage.sql.exec<{id:string;name:string;value:number}>(`SELECT id,name,${metric} AS value FROM statistics_rankings
      WHERE period=? AND start=? AND ${metric}>0 ORDER BY ${metric} DESC,id ASC LIMIT 10`,period,start).toArray()
      .map((r,i):RankingRow=>({...r,rank:i+1,local:r.id===owner?.id}));
    let own:RankingRow|null=null;
    if(owner){const values=period==='all'?owner.totals:owner[period].start===start?owner[period]:null,value=values?.[metric]??0;
      if(value>0){const ahead=this.storage.sql.exec<{n:number}>(`SELECT COUNT(*) AS n FROM statistics_rankings WHERE period=? AND start=? AND (${metric}>? OR (${metric}=? AND id<?))`,period,start,value,value,owner.id).toArray()[0].n;
        own={id:owner.id,name:owner.name,value,rank:ahead+1,local:true};}}
    return Response.json({version:STATISTICS_API_VERSION,period,metric,start,serverTime:now,rows,own});
  }
}
