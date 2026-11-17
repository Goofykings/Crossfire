/** Clock probes favor a recent low-RTT sample, preventing queued Wi-Fi pongs from
 * moving the world clock by hundreds of milliseconds. Playback never goes backwards. */
export class NetworkTiming {
 offset=0;rtt=0;delay=100;jitter=0;
 quality:'unknown'|'excellent'|'good'|'unstable'|'poor'='unknown';
 private candidate=this.quality;private candidateAt=0;
 private medianRtt=0;
 private probes:{at:number;rtt:number;offset:number}[]=[];
 private arrivals:number[]=[];
 private previous:{server:number;local:number}|null=null;
 private playhead=0;private previousLocal=0;
 reset(server:number,local:number):void {
  this.offset=server-local;this.rtt=0;this.jitter=0;this.delay=100;this.probes=[];this.arrivals=[];this.previous=null;this.playhead=0;this.previousLocal=0;this.quality=this.candidate='unknown';this.candidateAt=0;this.medianRtt=0;
 }
 probe(sent:number,server:number,local:number):boolean {
  const rtt=local-sent;if(rtt<0||rtt>5000)return false;
  this.probes.push({at:local,rtt,offset:server-(sent+local)/2});
  this.probes=this.probes.filter(p=>local-p.at<15000).slice(-16);
  const best=this.probes.reduce((a,b)=>a.rtt<=b.rtt?a:b);
  const sorted=this.probes.map(p=>p.rtt).sort((a,b)=>a-b);this.medianRtt=sorted[Math.floor(sorted.length/2)];
  this.rtt=this.rtt?this.rtt*.8+rtt*.2:rtt;
  this.offset=this.probes.length===1?best.offset:this.offset+Math.max(-5,Math.min(5,(best.offset-this.offset)*.25));
  this.classify(local);
  return true;
 }
 snapshot(server:number,local:number):void {
  if(this.previous&&server>this.previous.server){
   const excess=Math.max(0,(local-this.previous.local)-(server-this.previous.server));
   this.arrivals.push(excess);if(this.arrivals.length>40)this.arrivals.shift();
   const sorted=[...this.arrivals].sort((a,b)=>a-b),jitter=sorted[Math.floor((sorted.length-1)*.9)]??0;
   this.jitter=jitter;
   // A server-clock render target must also cover one-way delivery, not just
   // variation between packets. Keep fast links close to their existing padding.
   const wanted=Math.max(65,Math.min(250,this.rtt/2+50+jitter));
   this.delay+=Math.max(-1,Math.min(15,(wanted-this.delay)*.25));
   this.classify(local);
  }
  if(!this.previous||server>this.previous.server)this.previous={server,local};
 }
 time(local:number):number {
  const target=local+this.offset-this.delay;
  if(!this.playhead||local-this.previousLocal>1000)this.playhead=Math.max(this.playhead,target);
  else{
   const elapsed=Math.max(0,local-this.previousLocal),error=target-(this.playhead+elapsed);
   this.playhead+=Math.max(0,elapsed+Math.max(-elapsed*.1,Math.min(elapsed*.1,error)));
  }
  this.previousLocal=local;return this.playhead;
 }
 private classify(local:number):void {
  if(!this.probes.length)return;
  const median=this.medianRtt;
  const next=median>300||this.jitter>100?'poor':median>180||this.jitter>35?'unstable':median>60||this.jitter>12?'good':'excellent';
  if(this.quality==='unknown'){this.quality=this.candidate=next;this.candidateAt=local;return;}
  if(next!==this.candidate){this.candidate=next;this.candidateAt=local;}
  const ranks={unknown:-1,excellent:0,good:1,unstable:2,poor:3};
  if(next!==this.quality&&local-this.candidateAt>=(ranks[next]>ranks[this.quality]?1000:8000))this.quality=next;
 }
 inspect(){return{rtt:this.rtt,jitter:this.jitter,quality:this.quality,interpolationMs:this.delay,clockOffset:this.offset,playhead:this.playhead};}
}
