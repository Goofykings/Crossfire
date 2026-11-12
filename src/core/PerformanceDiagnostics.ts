/** Optional bounded sampling. No sorting/DOM work occurs in the frame loop. */
export class PerformanceDiagnostics {
 private frames=new Float32Array(600);private cursor=0;private count=0;
 private longs=0;private longMs=0;private observer:PerformanceObserver|null=null;
 private blocking={count:0,ms:0,max:0};
 private since=performance.now();
 private sections=new Map<string,{count:number;total:number;max:number}>();
 constructor(readonly enabled=false){
  if(enabled&&typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
   this.observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){if(e.startTime<this.since)continue;this.blocking.count++;this.blocking.ms+=e.duration;this.blocking.max=Math.max(this.blocking.max,e.duration);}});
   this.observer.observe({type:'longtask'});
  }
 }
 reset():void {this.since=performance.now();this.cursor=this.count=this.longs=this.longMs=0;this.blocking={count:0,ms:0,max:0};this.sections.clear();}
 frame(seconds:number):void {if(!this.enabled||!Number.isFinite(seconds)||seconds<=0)return;const ms=seconds*1000;this.frames[this.cursor++%this.frames.length]=ms;this.count++;if(ms>50){this.longs++;this.longMs+=ms;}}
 start():number{return this.enabled?performance.now():0;}
 end(name:string,start:number):void {if(!this.enabled)return;const ms=performance.now()-start,s=this.sections.get(name)??{count:0,total:0,max:0};s.count++;s.total+=ms;s.max=Math.max(s.max,ms);this.sections.set(name,s);}
 inspect(){
  if(!this.enabled)return {enabled:false};
  const samples=Array.from(this.frames.subarray(0,Math.min(this.count,this.frames.length))).sort((a,b)=>a-b),at=(p:number)=>samples[Math.min(samples.length-1,Math.floor(samples.length*p))]??0;
  const mean=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:0;
  const tail=samples.slice(Math.floor(samples.length*.99)),slowMean=tail.length?tail.reduce((a,b)=>a+b,0)/tail.length:0;
  return {enabled:true,samples:samples.length,fps:mean?1000/mean:0,low1Fps:slowMean?1000/slowMean:0,p50:at(.5),p95:at(.95),p99:at(.99),longFrames:this.longs,longFrameMs:this.longMs,blocking:{supported:!!this.observer,...this.blocking},
   sections:Object.fromEntries([...this.sections].map(([name,s])=>[name,{count:s.count,mean:s.total/s.count,max:s.max}]))};
 }
 dispose(){this.observer?.disconnect();}
}
