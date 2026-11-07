import type {AudioManager} from '../audio/AudioManager';

/** One delegated owner, including controls created after navigation. */
export class UISounds {
  private last=-Infinity;private step=0;
  constructor(private root:HTMLElement,private audio:Pick<AudioManager,'unlock'|'playUI'>){
    root.addEventListener('pointerover',this.hover);
    root.addEventListener('click',this.click,true);
    root.addEventListener('keydown',this.unlock,true);
    root.addEventListener('pointerdown',this.unlock,true);
    root.addEventListener('magnetic-snap',this.snap);root.addEventListener('ui-activate',this.activate);
  }
  private button(target:EventTarget|null){
    const b=target instanceof Element?target.closest<HTMLElement>('button,[role="button"],[role="option"],summary'):null;
    return b&&this.root.contains(b)&&!b.matches(':disabled,[aria-disabled="true"]')&&!b.closest('[inert],[hidden]')?b:null;
  }
  private unlock=(e:Event)=>{if(e.isTrusted)this.audio.unlock();};
  private hover=(e:PointerEvent)=>{
    if(e.pointerType==='touch')return;const b=this.button(e.target);
    if(!b||e.relatedTarget instanceof Node&&b.contains(e.relatedTarget))return;
    const now=performance.now();this.step=now-this.last<500?Math.min(4,this.step+1):0;this.last=now;
    this.audio.playUI('hover',Math.pow(2,this.step/24)*(1+(Math.random()-.5)*.012));
  };
  private click=(e:MouseEvent)=>{if(this.button(e.target)){this.unlock(e);this.audio.playUI('click');}};
  private activate=()=>this.audio.playUI('click');
  private snap=(e:Event)=>{const {index}= (e as CustomEvent<{index:number}>).detail;this.audio.playUI('tick',Math.pow(2,Math.min(12,index)/36));};
  dispose(){this.root.removeEventListener('pointerover',this.hover);this.root.removeEventListener('click',this.click,{capture:true});this.root.removeEventListener('keydown',this.unlock,{capture:true});this.root.removeEventListener('pointerdown',this.unlock,{capture:true});this.root.removeEventListener('magnetic-snap',this.snap);this.root.removeEventListener('ui-activate',this.activate);}
}
