import { expect, it, vi } from 'vitest';
import { NetworkDiagnostics } from '../src/network/NetworkDiagnostics';
import { simulationSteps, simulationAlpha, elapsedSimulationTime, activeSimulationTime, MAX_SIMULATION_STEPS } from '../src/core/simulationBudget';
import { FIXED_DT } from '../src/config/constants';
import { parseServerMessage, PROTOCOL_VERSION } from '../shared/protocol';
import { MovementHold, MOVEMENT_HOLD_MS } from '../shared/movementHold';
import { NO_INTENT } from '../src/player/PlayerController';

it('numeric diagnostics are opt-in and every metric history is bounded', () => {
  const off=new NetworkDiagnostics();off.rtt(99);off.count('messages');expect(off.report()).toEqual({enabled:false});
  const on=new NetworkDiagnostics(true);
  for(let i=0;i<1000;i++){on.rtt(i);on.count('snapshots');on.count('inputs',6);}
  const report=on.report();if(!report.enabled)throw Error('Diagnostics expected');
  expect(report.metrics.rttMs.count).toBe(128);expect(report.metrics.rttMs.min).toBe(872);
  expect(report.metrics.rttMs.median).toBe(936);expect(report.metrics.rttMs.p95).toBe(993);expect(report.metrics.rttMs.max).toBe(999);
  expect(report.metrics.rttJitterMs.median).toBe(1);expect(report.counters.inputs).toBe(6000);
  expect(report.metrics.rttMs.recent).toHaveLength(128);
});

it('correction traces are opt-in, bounded, copied and omit exact confirmations',()=>{
 const sample={atMs:1,metres:.2,ack:1,replayed:6,snapshotAgeMs:40,groundedBefore:false,groundedAfter:true};
 const off=new NetworkDiagnostics();off.correction(sample);expect(off.report()).toEqual({enabled:false});
 const on=new NetworkDiagnostics(true);on.correction({...sample,metres:0});
 for(let i=0;i<200;i++)on.correction({...sample,ack:i});
 const report=on.report();if(!report.enabled)throw Error('Expected diagnostics');
 expect(report.recentCorrections).toHaveLength(128);expect(report.recentCorrections[0].ack).toBe(72);
 report.recentCorrections[0].metres=999;const next=on.report();if(next.enabled)expect(next.recentCorrections[0].metres).toBe(.2);
});

it('short input gaps retain only validated continuous movement, never jump/attack edges, then expire',()=>{
  const hold=new MovementHold(),input={...NO_INTENT,z:1,jumpPressed:true,slide:true,crouch:true,lean:1 as const};
  expect(hold.sample(input,0)).toBe(input);
  for(const at of [1,100,200,300])expect(hold.sample(undefined,at)).toEqual({...input,jumpPressed:false});
  expect(hold.sample(undefined,MOVEMENT_HOLD_MS).z).toBe(0);
  expect(hold.sample(undefined,5000)).toEqual({...NO_INTENT,slide:true,crouch:true,lean:1});
  hold.sample(input,6000);hold.sample({...NO_INTENT},6001);
  expect(hold.sample(undefined,6002).z).toBe(0);
  hold.sample(input,7000);hold.reset();expect(hold.sample(undefined,7001)).toEqual(NO_INTENT);
  hold.reset({crouch:true,slide:true});expect(hold.sample(undefined,8000)).toEqual({...NO_INTENT,crouch:true,slide:true});
});

it.each([60,40,30,20,'variable'] as const)('bounded %s FPS scheduling preserves elapsed time across 100–300 ms stalls', fps => {
  let debt=0,elapsed=0,ticks=0,max=0;
  for(let frame=0;frame<300;frame++){
    const dt=frame===20?.1:frame===40?.2:frame===60?.3:fps==='variable'?[1/60,1/40,1/20,1/30][frame%4]:1/fps;
    debt+=elapsedSimulationTime(dt);elapsed+=dt;
    const due=simulationSteps(debt);max=Math.max(max,due);
    expect(due).toBeLessThanOrEqual(MAX_SIMULATION_STEPS);
    // Full transport backpressure retains time, rather than silently clearing it.
    if(frame!==80&&frame!==81){debt-=due*FIXED_DT;ticks+=due;}
    expect(simulationAlpha(debt)).toBeGreaterThanOrEqual(0);expect(simulationAlpha(debt)).toBeLessThanOrEqual(1);
  }
  while(simulationSteps(debt)){const due=simulationSteps(debt);debt-=due*FIXED_DT;ticks+=due;}
  expect(ticks*FIXED_DT+debt).toBeCloseTo(elapsed,10);expect(debt).toBeLessThan(FIXED_DT);
  expect(max).toBe(12);
});

it('interpolation cannot extrapolate during retained debt, and invalid frame times add no time',()=>{
  expect(simulationAlpha(.3)).toBe(1);expect(simulationAlpha(-1)).toBe(0);
  expect(elapsedSimulationTime(NaN)).toBe(0);expect(elapsedSimulationTime(Infinity)).toBe(0);
  expect(elapsedSimulationTime(-1)).toBe(0);expect(elapsedSimulationTime(.3)).toBe(.3);
  expect(activeSimulationTime(3,10000,10000)).toBe(0); // Loading time is not input for a newly spawned life.
  expect(activeSimulationTime(3,10020,10000)).toBeCloseTo(.02);
  expect(activeSimulationTime(.3,10000,9000)).toBe(.3); // A real active stall retains all 300 ms.
  expect(activeSimulationTime(60,70000,10000,false)).toBe(0); // Hidden frames are not active input time.
  expect(activeSimulationTime(60,70000,70000,true)).toBe(0); // First visible frame excludes the suspended interval.
  expect(activeSimulationTime(.3,70300,70000,true)).toBe(.3); // Subsequent active stalls still count.
});

it('optional server timing is backwards compatible and strictly validated',()=>{
  const pong={v:PROTOCOL_VERSION,type:'pong',at:1,serverTime:2};
  expect(parseServerMessage(JSON.stringify(pong))).toEqual(pong);
  expect(parseServerMessage(JSON.stringify({...pong,processingMs:.1,tickMs:2,tickDebtMs:3,queuedInputs:4}))).not.toBeNull();
  for(const key of ['processingMs','tickMs','tickDebtMs','queuedInputs'])for(const value of [-1,'2',null]){
    expect(parseServerMessage(JSON.stringify({...pong,[key]:value}))).toBeNull();
  }
});

it('RTT uses bounded numeric samples without formatting/logging in the hot path',()=>{
  const log=vi.spyOn(console,'log');const diagnostics=new NetworkDiagnostics(true);
  diagnostics.snapshot(1200,100);diagnostics.snapshot(1300,150);diagnostics.rtt(80);diagnostics.rtt(120);
  const report=diagnostics.report();if(!report.enabled)throw Error('Expected diagnostics');
  expect(report.metrics.snapshotGapMs.median).toBe(50);expect(report.metrics.rttJitterMs.median).toBe(40);
  expect(log).not.toHaveBeenCalled();log.mockRestore();
});
