/** Ordered-delivery simulation, not a live connection or a hardware benchmark. */
import {afterAll,expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {NetworkTiming} from '../src/network/NetworkTiming';
import {extrapolatedPosition} from '../src/network/remoteMotion';
import {PlayerController} from '../src/player/PlayerController';
import {CollisionWorld} from '../src/physics/CollisionWorld';

const reports:unknown[]=[];
const scenarios=[[20,5],[60,15],[120,30],[200,60],[350,100]] as const;
const percentile=(a:number[],f:number)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*f)]??0;
for(const fps of [60,30,20])for(const [rtt,jitter]of scenarios){
 it(`${fps} FPS, ${rtt} ms RTT / ${jitter} ms jitter: six remote histories and ordered stall recovery`,()=>{
  const timing=new NetworkTiming(),epoch=1000000;timing.reset(epoch,epoch);
  const motion=new PlayerController(new CollisionWorld()).capture();motion.grounded=true;
  const histories=Array.from({length:6},()=>[] as {at:number;motion:typeof motion}[]);
  const wire:{at:number;server:number}[]=[];const previous=Array<number>(6).fill(NaN);
  const gaps=[-.8,.2,1,-.5,.4,-1,.8,0];
  let delivery=0,packet=0,nextFrame=0,frozen=0,frames=0,starved=0,maxHistory=0,largestStep=0;
  const delays:number[]=[],ages:number[]=[];
  const started=performance.now();
  for(let now=0;now<=30000;now++){
   if(now%2000===0)timing.probe(epoch+now-rtt,epoch+now-rtt/2,epoch+now);
   if(now%50===0){
    const latency=Math.max(1,rtt/2+gaps[packet++%gaps.length]*jitter);
    delivery=Math.max(delivery+.01,now+latency);
    // Reliable TCP order: a delivery stall holds subsequent messages too.
    if(now>=12000&&now<12800)delivery=Math.max(delivery,12800+rtt/2);
    wire.push({at:delivery,server:epoch+now});
   }
   while(wire[0]?.at<=now){
    const m=wire.shift()!;timing.snapshot(m.server,epoch+now);
    for(let i=0;i<6;i++){
     const v=4+i*.1;histories[i].push({at:m.server,motion:{...motion,position:{x:(m.server-epoch)/1000*v,y:0,z:i*3},velocity:{x:v,y:0,z:0}}});
     if(histories[i].length>30)histories[i].shift();maxHistory=Math.max(maxHistory,histories[i].length);
    }
   }
   if(now+1e-6<nextFrame)continue;nextFrame+=1000/fps;
   const at=timing.time(epoch+now),measured=now>=4000&&!(now>=12000&&now<14500);
   if(measured)delays.push(timing.delay);
   for(let i=0;i<6;i++){
    const h=histories[i];if(!h.length)continue;
    while(h.length>2&&h[1].at<at)h.shift();
    const older=h[0],newer=h[1]??older,k=Math.max(0,Math.min(1,(at-older.at)/Math.max(1,newer.at-older.at)));
    const x=at>newer.at?extrapolatedPosition(newer.motion,at-newer.at,null).x:older.motion.position.x+(newer.motion.position.x-older.motion.position.x)*k;
    if(measured&&Number.isFinite(previous[i])){
     frames++;if(Math.abs(x-previous[i])<.00001)frozen++;
     if(at-newer.at>100)starved++;
     largestStep=Math.max(largestStep,Math.abs(x-previous[i]));ages.push(epoch+now-h.at(-1)!.at);
    }
    previous[i]=x;
   }
  }
  const report={fps,rtt,jitter,peers:6,frames,frozen,freezePercent:100*frozen/frames,starved,maxHistory,largestStep,
   bufferMedianMs:percentile(delays,.5),bufferP95Ms:percentile(delays,.95),snapshotAgeP95Ms:percentile(ages,.95),simulationCpuMs:performance.now()-started};reports.push(report);
  expect(maxHistory).toBeLessThanOrEqual(30);expect(frames).toBeGreaterThan(1000);
  // Excludes the intentional outage: sustained normal delivery must not exhaust prediction.
  expect(report.freezePercent,JSON.stringify(report)).toBeLessThan(1);
 });
}
afterAll(()=>{mkdirSync('test-results',{recursive:true});writeFileSync(`test-results/poor-network-${process.env.NETWORK_AUDIT_LABEL??'latest'}.json`,JSON.stringify(reports,null,2));});
