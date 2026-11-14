import {expect,it} from 'vitest';
import {AdaptiveResolution,renderPixelRatio} from '../src/rendering/AdaptiveResolution';

it('raises sharpness slowly at 60 FPS and backs off under sustained load',()=>{
 const r=new AdaptiveResolution();
 const run=(seconds:number,fps:number)=>{for(let i=0;i<seconds*fps;i++)r.sample(1/fps);};
 run(5,60);expect(r.scale).toBe(.5);run(2,60);expect(r.scale).toBe(.55);
 run(60,60);expect(r.scale).toBe(.8);run(2,40);expect(r.scale).toBe(.7);
 run(30,25);expect(r.scale).toBe(.5);
 r.reset();expect(r.scale).toBe(.5);
});
it('ignores suspended frames and does not oscillate around a slightly missed refresh',()=>{
 const r=new AdaptiveResolution();for(let i=0;i<1000;i++)r.sample(1/55);
 expect(r.scale).toBe(.5);expect(r.sample(2)).toBe(false);expect(r.sample(NaN)).toBe(false);
});
it('bounds Chromebook fill rate independently of screen density while leaving desktop preferences intact',()=>{
 expect(renderPixelRatio(1366,768,2,.5,true)).toBe(.5);
 const ratio=renderPixelRatio(3840,2160,2,.8,true);
 expect(3840*ratio*2160*ratio).toBeCloseTo(1280*720);
 expect(renderPixelRatio(1366,768,2,.85,false)).toBe(1.7);
});
it('sustained slow active frames still lower quality instead of resetting every window',()=>{
 const r=new AdaptiveResolution();for(let i=0;i<60*60;i++)r.sample(1/60);expect(r.scale).toBe(.8);
 for(let i=0;i<60;i++)r.sample(.15);expect(r.scale).toBe(.5);
 expect(r.sample(2)).toBe(false);expect(r.scale).toBe(.5);
});
