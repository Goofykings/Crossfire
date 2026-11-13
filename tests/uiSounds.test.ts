import {afterEach,expect,it,vi} from 'vitest';
import {UISounds} from '../src/ui/UISounds';
import {AudioManager} from '../src/audio/AudioManager';

class Control extends EventTarget {
 disabled=false;inert=false;child:Control|null=null;
 closest(selector:string):Control|null{return selector.startsWith('button')?this:selector.includes('inert')&&this.inert?this:null;}
 matches(){return this.disabled;}
 contains(n:unknown){return n===this||n===this.child;}
}
afterEach(()=>vi.unstubAllGlobals());
it('delegates once per entry, progresses then resets pitch, ignores disabled controls and disposes',()=>{
 vi.stubGlobal('Element',Control);vi.stubGlobal('Node',Control);
 const root=new Control(),a=new Control(),child=new Control();a.child=child;root.contains=()=>true;
 const audio={unlock:vi.fn(),playUI:vi.fn()},manager=new UISounds(root as unknown as HTMLElement,audio);
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
 const send=(type:string,target=a,related:Control|null=null)=>{const e=new Event(type);Object.defineProperties(e,{target:{value:target},relatedTarget:{value:related},pointerType:{value:'mouse'}});root.dispatchEvent(e);};
 send('pointerover');const first=audio.playUI.mock.calls[0][1]!;now=100;send('pointerover');expect(audio.playUI.mock.calls[1][1]).toBeGreaterThan(first);
 send('pointerover',a,child);expect(audio.playUI).toHaveBeenCalledTimes(2);
 now=1000;send('pointerover');expect(audio.playUI.mock.calls[2][1]).toBeCloseTo(1,1);
 a.disabled=true;send('click');send('pointerover');expect(audio.playUI).toHaveBeenCalledTimes(3);
 a.disabled=false;send('click');expect(audio.playUI).toHaveBeenLastCalledWith('click');
 manager.dispose();send('click');expect(audio.playUI).toHaveBeenCalledTimes(4);vi.restoreAllMocks();
});
it('UI tones unlock lazily, remain short, use master/SFX gains and bound rapid voices',()=>{
 const gains:{gain:{value:number};connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}[]=[],sources:{buffer:AudioBuffer|null;playbackRate:{value:number};start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;connect:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;onended:(()=>void)|null}[]=[];
 const ctx={state:'running',currentTime:0,sampleRate:48000,destination:{},
  createGain:()=>{const g={gain:{value:0},connect:vi.fn(),disconnect:vi.fn()};gains.push(g);return g;},
  createDynamicsCompressor:()=>({threshold:{},knee:{},ratio:{},attack:{},release:{},connect:vi.fn()}),
  createBuffer:(_channels:number,length:number,rate:number)=>({duration:length/rate,getChannelData:()=>new Float32Array(length)}),
  createBufferSource:()=>{const s={buffer:null as AudioBuffer|null,playbackRate:{value:1},start:vi.fn(),stop:vi.fn(),connect:vi.fn(),disconnect:vi.fn(),onended:null as (()=>void)|null};sources.push(s);return s;}
 };
 vi.stubGlobal('AudioContext',class{constructor(){return ctx;}});vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));
 const audio=new AudioManager();audio.playUI('hover');expect(sources).toHaveLength(0);
 audio.setVolume(.4);audio.setSfxVolume(.3);audio.unlock();audio.playUI('click');
 expect(gains[0].gain.value).toBe(.4);expect(gains[1].gain.value).toBe(.3);expect(sources[0].buffer!.duration).toBeCloseTo(.055);
 const clickGain=gains[2].gain.value;ctx.currentTime=.03;audio.playUI('hover',1.1);expect(sources[1].buffer!.duration).toBeCloseTo(.045);expect(gains[3].gain.value).toBeLessThan(clickGain);expect(sources[1].playbackRate.value).toBe(1.1);
 audio.playUI('hover');expect(sources).toHaveLength(2);
 for(let i=0;i<10;i++){ctx.currentTime+=.03;audio.playUI('tick');}
 expect(sources.filter(s=>!s.stop.mock.calls.length)).toHaveLength(3);
 sources.at(-1)!.onended!();expect(sources.at(-1)!.disconnect).toHaveBeenCalled();
 audio.setVolume(0);audio.setSfxVolume(0);expect(gains[0].gain.value).toBe(0);expect(gains[1].gain.value).toBe(0);
 // The first logo click needs neither a decoded rifle WAV nor a running clock.
 // It can queue while unlock resumes the context, and still uses the muted bus.
 ctx.state='suspended';const count=sources.length,requests=vi.mocked(fetch).mock.calls.length;
 audio.playUI('logo');expect(sources).toHaveLength(count+1);const logo=sources.at(-1)!;
 expect(logo.buffer!.duration).toBeCloseTo(.075);expect(logo.start).toHaveBeenCalledOnce();expect(gains.at(-1)!.gain.value).toBe(.1);
 expect(gains.at(-1)!.connect).toHaveBeenCalledWith(gains[1]);expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
 audio.playUI('logo');expect(sources.at(-1)!.buffer).toBe(logo.buffer);
});
