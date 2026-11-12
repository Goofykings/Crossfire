import {expect,it} from 'vitest';
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
