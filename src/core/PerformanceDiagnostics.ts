/** Optional bounded sampling. No sorting/DOM work occurs in the frame loop. */
export class PerformanceDiagnostics {
 private frames=new Float32Array(600);private cursor=0;private count=0;
 private longs=0;private longMs=0;private observer:PerformanceObserver|null=null;
 private blocking={count:0,ms:0,max:0};
 private stalls={over50:0,over100:0,over250:0};
 private animationObserver:PerformanceObserver|null=null;
 private animationFrames={count:0,ms:0,max:0,blockingMs:0,forcedLayoutMs:0};
 private since=performance.now();
 private totalFrameMs=0;
 private sections=new Map<string,{count:number;total:number;max:number}>();
 constructor(readonly enabled=false){
  if(enabled&&typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
   this.observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){if(e.startTime<this.since)continue;this.blocking.count++;this.blocking.ms+=e.duration;this.blocking.max=Math.max(this.blocking.max,e.duration);}});
   this.observer.observe({type:'longtask'});
  }
  if(enabled&&typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')){
   this.animationObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries()){
    if(entry.startTime<this.since)continue;
    const e=entry as PerformanceEntry&{blockingDuration?:number;scripts?:{forcedStyleAndLayoutDuration?:number}[]};
    const a=this.animationFrames;a.count++;a.ms+=e.duration;a.max=Math.max(a.max,e.duration);a.blockingMs+=e.blockingDuration??0;
    for(const script of e.scripts??[])a.forcedLayoutMs+=script.forcedStyleAndLayoutDuration??0;
   }});this.animationObserver.observe({type:'long-animation-frame'});
  }
 }
 reset():void {this.since=performance.now();this.cursor=this.count=this.longs=this.longMs=this.totalFrameMs=0;this.blocking={count:0,ms:0,max:0};this.stalls={over50:0,over100:0,over250:0};this.animationFrames={count:0,ms:0,max:0,blockingMs:0,forcedLayoutMs:0};this.sections.clear();}
 frame(seconds:number):void {if(!this.enabled||!Number.isFinite(seconds)||seconds<=0)return;const ms=seconds*1000;this.frames[this.cursor++%this.frames.length]=ms;this.count++;this.totalFrameMs+=ms;if(ms>50){this.longs++;this.longMs+=ms;this.stalls.over50++;}if(ms>100)this.stalls.over100++;if(ms>250)this.stalls.over250++;}
 start():number{return this.enabled?performance.now():0;}
 end(name:string,start:number):void {if(!this.enabled)return;const ms=performance.now()-start,s=this.sections.get(name)??{count:0,total:0,max:0};s.count++;s.total+=ms;s.max=Math.max(s.max,ms);this.sections.set(name,s);}
 inspect(){
  if(!this.enabled)return {enabled:false};
  const samples=Array.from(this.frames.subarray(0,Math.min(this.count,this.frames.length))).sort((a,b)=>a-b),at=(p:number)=>samples[Math.min(samples.length-1,Math.floor(samples.length*p))]??0;
  const mean=samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:0;
  const tail=samples.slice(Math.floor(samples.length*.99)),slowMean=tail.length?tail.reduce((a,b)=>a+b,0)/tail.length:0;
  return {enabled:true,samples:samples.length,totalFrames:this.count,averageFps:this.totalFrameMs?this.count*1000/this.totalFrameMs:0,elapsedMs:this.totalFrameMs,fps:mean?1000/mean:0,low1Fps:slowMean?1000/slowMean:0,p50:at(.5),p95:at(.95),p99:at(.99),longFrames:this.longs,longFrameMs:this.longMs,stalls:{...this.stalls},animationFrames:{supported:!!this.animationObserver,...this.animationFrames},blocking:{supported:!!this.observer,...this.blocking},
   sections:Object.fromEntries([...this.sections].map(([name,s])=>[name,{count:s.count,mean:s.total/s.count,max:s.max}]))};
 }
 dispose(){this.observer?.disconnect();this.animationObserver?.disconnect();}
}
