const clamp=(value:number,min=0,max=5)=>Math.max(min,Math.min(max,value));

/** Continuous presentation, discrete selection. No frame loop or DOM dependency. */
export class MagneticStops {
  position:number;velocity=0;pointer:number;pointerVelocity=0;target:number;selected:number;
  dragging=false;private destination:number;
  constructor(value=3,readonly maximum=5){this.position=this.pointer=this.target=this.selected=this.destination=Math.round(clamp(value,0,this.maximum));}
  set(value:number){this.selected=this.target=Math.round(clamp(value,0,this.maximum));this.destination=this.target;}
  grab(pointer:number){this.dragging=true;this.pointer=clamp(pointer,0,this.maximum);this.pointerVelocity=0;if(Math.abs(this.pointer-this.position)>.3)this.set(this.pointer);}
  move(pointer:number,dt:number){
    const next=clamp(pointer,0,this.maximum);this.pointerVelocity=.5*this.pointerVelocity+.5*(next-this.pointer)/Math.max(.008,dt);this.pointer=next;
    const speed=Math.abs(this.pointerVelocity),distance=next-this.target;
    if(Math.abs(distance)>.6||speed>5)this.set(next);
    const glide=clamp(speed/12,0,1);
    this.destination=clamp(this.target+(next-this.target)*(.18+.72*glide),0,this.maximum);
  }
  release(){this.dragging=false;this.set(this.pointer);}
  snap(){this.position=this.destination;this.velocity=0;}
  tick(dt:number):boolean {
    // Bounded substeps keep a stalled tab from injecting spring energy.
    let remaining=clamp(dt,0,.05);
    while(remaining>0){const step=Math.min(remaining,1/120);this.velocity+=(220*(this.destination-this.position)-22*this.velocity)*step;this.position+=this.velocity*step;remaining-=step;}
    if(this.position<0||this.position>this.maximum){this.position=clamp(this.position,0,this.maximum);this.velocity=0;}
    if(Math.abs(this.position-this.destination)<.0005&&Math.abs(this.velocity)<.005){this.snap();return false;}return true;
  }
}

/** Native range semantics/keyboard support with a separately animated visual thumb. */
export interface MagneticSliderOptions {min:number;max:number;step:number;value:number;label:string;ariaLabel:string;onChange:(value:number)=>void}
export class MagneticSlider {
  readonly root=document.createElement('div');readonly input=document.createElement('input');
  readonly output=document.createElement('output');readonly model:MagneticStops;
  private readonly track=document.createElement('div');private frame=0;private last=0;private pointerId:number|null=null;private pointerAt=0;
  private readonly reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  private notified:number;
  constructor(private readonly options:MagneticSliderOptions){
    const {min,max,step,value}=options;
    if(!Number.isFinite(min)||!Number.isFinite(max)||!Number.isFinite(step)||!Number.isFinite(value)||step<=0||max<=min||Math.abs((max-min)/step-Math.round((max-min)/step))>1e-8)throw Error('Invalid magnetic slider range');
    this.model=new MagneticStops((value-min)/step,Math.round((max-min)/step));this.notified=this.model.selected;this.root.className='magnetic-slider';this.track.className='magnetic-track';
    const thumb=document.createElement('span');thumb.className='magnetic-thumb';this.track.append(thumb);
    this.input.type='range';this.input.min=String(min);this.input.max=String(max);this.input.step=String(step);this.input.setAttribute('aria-label',options.ariaLabel);
    this.output.className='magnetic-count';const label=document.createElement('span');label.textContent=options.label;label.className='magnetic-label';
    const marks=document.createElement('div');marks.className='magnetic-marks';marks.setAttribute('aria-hidden','true');
    for(let i=0;i<=this.model.maximum;i++){const mark=document.createElement('span');mark.textContent=String(min+i*step);marks.append(mark);}
    marks.style.gridTemplateColumns=`repeat(${this.model.maximum+1},1fr)`;this.root.append(label,this.output,this.track,marks,this.input);
    this.input.addEventListener('input',()=>{this.model.set((Number(this.input.value)-this.options.min)/this.options.step);this.sync();this.animate();});
    this.root.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.pointerId!==null)return;event.preventDefault();this.input.focus({preventScroll:true});
      this.pointerId=event.pointerId;this.pointerAt=event.timeStamp;this.root.setPointerCapture(event.pointerId);
      this.model.grab(this.valueAt(event.clientX));this.sync();this.animate();
    });
    this.root.addEventListener('pointermove',event=>{if(event.pointerId!==this.pointerId)return;
      this.model.move(this.valueAt(event.clientX),(event.timeStamp-this.pointerAt)/1000);this.pointerAt=event.timeStamp;this.sync();this.animate();});
    this.root.addEventListener('pointerup',event=>{if(event.pointerId!==this.pointerId)return;this.model.move(this.valueAt(event.clientX),.016);this.finish();});
    this.root.addEventListener('pointercancel',()=>this.cancel());this.root.addEventListener('lostpointercapture',()=>{if(this.pointerId!==null)this.cancel();});
    this.input.addEventListener('blur',()=>{if(this.pointerId!==null)this.cancel();});
    this.reduced.addEventListener('change',this.motionChanged);window.addEventListener('blur',this.cancelForBlur);this.sync();this.paint();
  }
  private valueAt(x:number){const rect=this.track.getBoundingClientRect();return clamp((x-rect.left)/Math.max(1,rect.width)*this.model.maximum,0,this.model.maximum);}
  setValue(value:number){this.cancel();this.model.set((value-this.options.min)/this.options.step);this.notified=this.model.selected;this.model.snap();this.sync();this.paint();}
  private sync(){
    const index=this.model.selected,value=this.options.min+index*this.options.step;
    this.input.value=String(value);this.output.value=String(value);this.input.setAttribute('aria-valuetext',`${value} ${this.options.label.toLowerCase()}`);
    if(index!==this.notified){this.notified=index;this.options.onChange(value);this.root.dispatchEvent(new CustomEvent('magnetic-snap',{bubbles:true,detail:{index,value}}));}
  }
  private paint(){this.root.style.setProperty('--bot-position',String(this.model.position/this.model.maximum));this.root.dataset.value=this.input.value;}
  private motionChanged=()=>{if(this.reduced.matches){this.model.set(this.model.selected);this.model.snap();this.stop();this.paint();}};
  private cancelForBlur=()=>this.cancel();
  private animate(){
    if(this.reduced.matches){this.model.set(this.model.selected);this.model.snap();this.paint();return;}
    if(this.frame)return;this.last=performance.now();
    const update=(now:number)=>{this.frame=0;const active=this.model.tick((now-this.last)/1000);this.last=now;this.paint();if(active)this.frame=requestAnimationFrame(update);};
    this.frame=requestAnimationFrame(update);
  }
  private finish(){const id=this.pointerId;this.pointerId=null;if(id!==null&&this.root.hasPointerCapture(id))this.root.releasePointerCapture(id);this.model.release();this.sync();this.animate();}
  private stop(){cancelAnimationFrame(this.frame);this.frame=0;}
  cancel(){const id=this.pointerId;this.pointerId=null;if(id!==null&&this.root.hasPointerCapture(id))this.root.releasePointerCapture(id);this.model.dragging=false;this.model.set(this.model.selected);this.model.snap();this.stop();this.paint();}
  dispose(){this.cancel();this.reduced.removeEventListener('change',this.motionChanged);window.removeEventListener('blur',this.cancelForBlur);this.root.remove();}
}
