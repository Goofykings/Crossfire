import {expect,it,vi} from 'vitest';
import {PerformanceDiagnostics} from '../src/core/PerformanceDiagnostics';
import {sanitizeSettings} from '../src/config/settings';
it('diagnostics are disabled by default and bounded when explicitly enabled',()=>{
 const off=new PerformanceDiagnostics();off.frame(.5);expect(off.inspect()).toEqual({enabled:false});
 const on=new PerformanceDiagnostics(true);for(let i=0;i<1000;i++)on.frame(i%100===0?.2:1/60);
 const report=on.inspect();expect(report.samples).toBe(600);expect(report.p50).toBeCloseTo(1000/60);expect(report.p99).toBe(200);expect(report.longFrames).toBe(10);expect(report.longFrameMs).toBe(2000);on.reset();
 for(let i=0;i<200;i++)on.frame(i===198?.1:i===199?.2:1/60);
 expect(on.inspect().low1Fps).toBeCloseTo(1000/150);on.dispose();
});
it('adaptive resolution opt-out persists without resetting other saved preferences',()=>{
 const settings=sanitizeSettings({adaptiveResolution:false,chromebookMode:true,fov:105,masterVolume:.4});expect(settings.adaptiveResolution).toBe(false);expect(settings.fov).toBe(105);expect(settings.masterVolume).toBe(.4);expect(sanitizeSettings({}).adaptiveResolution).toBe(true);
});
it('counts each stall threshold independently and resets bounded diagnostics',()=>{
 const d=new PerformanceDiagnostics(true);for(const ms of [16,50,51,100,101,250,251])d.frame(ms/1000);
 expect(d.inspect().stalls).toEqual({over50:5,over100:3,over250:1});
 expect(d.inspect().totalFrames).toBe(7);d.reset();expect(d.inspect().stalls).toEqual({over50:0,over100:0,over250:0});d.dispose();
});
it('feature-detects long animation frames, ignores old entries and disconnects observers',()=>{
 const callbacks=new Map<string,(list:{getEntries:()=>unknown[]})=>void>(),disconnected=vi.fn();
 class Observer {
  static supportedEntryTypes=['longtask','long-animation-frame'];
  constructor(private callback:(list:{getEntries:()=>unknown[]})=>void){}
  observe({type}:{type:string}){callbacks.set(type,this.callback);}disconnect(){disconnected();}
 }
 vi.stubGlobal('PerformanceObserver',Observer);
 try{
  const d=new PerformanceDiagnostics(true);d.reset();
  callbacks.get('long-animation-frame')!({getEntries:()=>[{startTime:0,duration:500},{startTime:performance.now()+1,duration:120,blockingDuration:70,scripts:[{forcedStyleAndLayoutDuration:12}]}]});
  expect(d.inspect().animationFrames).toEqual({supported:true,count:1,ms:120,max:120,blockingMs:70,forcedLayoutMs:12});
  d.dispose();expect(disconnected).toHaveBeenCalledTimes(2);
 }finally{vi.unstubAllGlobals();}
});
