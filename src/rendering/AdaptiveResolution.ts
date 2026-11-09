/** A slow, bounded controller for the Chromebook renderer. Simulation and HUD
 * always use full-rate inputs/CSS pixels. Resolution changes only between windows. */
export class AdaptiveResolution {
  scale=.5;
  private elapsed=0;
  private frames=0;
  private goodFor=0;
  reset():void {this.scale=.5;this.elapsed=this.frames=this.goodFor=0;}
  sample(seconds:number):boolean {
    // Loading, a background tab or a debugger pause is not a rendering sample.
    if(!Number.isFinite(seconds)||seconds<=0||seconds>.1){this.elapsed=this.frames=this.goodFor=0;return false;}
    this.elapsed+=seconds;this.frames++;
    if(this.elapsed<1.5)return false;
    const ms=this.elapsed/this.frames*1000,period=this.elapsed;
    this.elapsed=this.frames=0;
    if(ms>19){this.goodFor=0;return this.change(-.1);}
    if(ms<17.5){this.goodFor+=period;if(this.goodFor>=6){this.goodFor=0;return this.change(.05);}}
    else this.goodFor=0;
    return false;
  }
  private change(step:number):boolean {
    const next=Math.round(Math.max(.5,Math.min(.8,this.scale+step))*100)/100;
    if(next===this.scale)return false;this.scale=next;return true;
  }
}

/** Avoid device-pixel-ratio multiplying the GPU workload on high-DPI laptops.
 * Desktop quality retains its selected scale and device-pixel resolution. */
export function renderPixelRatio(width:number,height:number,dpr:number,scale:number,chromebook:boolean):number {
  if(!chromebook)return Math.min(dpr||1,2)*scale;
  const budget=Math.sqrt(1280*720/Math.max(1,width*height));
  return Math.min(scale,budget);
}
