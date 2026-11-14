import type { Input } from './Input';
import { CONTROLLER_ACTIONS, controllerFamily, controllerLook, gameplayControllerAction, radialStick, type ControllerFamily, type ControllerSettings } from '../config/controller';

function availableGamepads():readonly(Gamepad|null)[]{try{return navigator.getGamepads?.()??[];}catch{return [];}}

/** Gamepad adapter only. Simulation, combat and network inputs remain owned by Game/Input. */
export class Controller {
  family:ControllerFamily='generic';status='Press a controller button to connect';active=false;
  selected:number|null=null;
  onCapture:((control:string)=>void)|null=null;
  onMenu:(pad:Gamepad,dt:number)=>void=()=>{};
  onLost:()=>void=()=>{};
  onMethod:(controller:boolean)=>void=()=>{};
  private previous=new Float32Array(25);
  private values=new Float32Array(25);
  private armed=false;private wasGameplay=false;private wasFocused=true;
  private captured=false;private method=false;private crouchSlide:'slide'|'crouch'|null=null;
  private fireHeld=false;
  private lookX=0;private lookY=0;private pad:Gamepad|null=null;
  private abort=new AbortController();
  constructor(private readonly input:Input,private readonly settings:()=>ControllerSettings){
    const mouse=()=>this.setMethod(false);
    window.addEventListener('keydown',mouse,{signal:this.abort.signal});
    window.addEventListener('pointerdown',mouse,{signal:this.abort.signal});
    window.addEventListener('mousemove',e=>{if(e.movementX||e.movementY)mouse();},{signal:this.abort.signal});
    window.addEventListener('blur',()=>this.release(),{signal:this.abort.signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release();},{signal:this.abort.signal});
    window.addEventListener('gamepaddisconnected',e=>{
      if(e.gamepad.index!==this.selected)return;
      this.selected=null;this.pad=null;this.previous.fill(0);this.release();this.onLost();
    },{signal:this.abort.signal});
  }
  private setMethod(controller:boolean){if(this.method===controller)return;this.method=controller;this.active=controller;this.onMethod(controller);}
  release(){this.input.clearController();this.lookX=this.lookY=0;this.armed=false;this.crouchSlide=null;this.fireHeld=false;}
  private raw(p:Gamepad,index:number){const b=p.buttons[index];return b?(index===6||index===7?b.value:Math.max(b.value,b.pressed?1:0)):0;}
  poll(dt:number,gameplay:boolean,pads:readonly(Gamepad|null)[]=availableGamepads(),focused=!document.hidden&&document.hasFocus()):void{
    let pad=this.selected===null?null:pads.find(p=>p?.index===this.selected&&p.connected&&p.mapping==='standard')??null;
    if(pad&&this.pad&&pad.id!==this.pad.id){this.release();this.onLost();this.previous.fill(0);}
    if(!pad){
      if(this.pad){this.release();this.onLost();this.previous.fill(0);}
      pad=pads.find(p=>p?.connected&&p.mapping==='standard'&&p.buttons.some(b=>b.pressed||b.value>.55))??pads.find(p=>p?.connected&&p.mapping==='standard')??null;
      this.selected=pad?.index??null;
    }
    this.pad=pad;
    this.status=pad?`Connected: ${pad.id}`:pads.some(p=>p?.connected)?'Controller has no standard mapping. Use browser standard mapping or keyboard/mouse.':'Press a controller button to connect';
    if(!pad||!focused){if(this.wasFocused&&!focused)this.onLost();this.wasFocused=focused;this.release();return;}
    this.wasFocused=true;this.family=controllerFamily(pad.id);
    const settings=this.settings();
    const left=radialStick(pad.axes[0]??0,pad.axes[1]??0,settings.leftDeadzone),right=radialStick(pad.axes[2]??0,pad.axes[3]??0,settings.rightDeadzone);
    for(let i=0;i<17;i++){
      const value=this.raw(pad,i);
      // Hysteresis prevents noisy analog triggers from synthesizing repeated semi-auto presses.
      this.values[i]=i===6||i===7?(value>=(this.previous[i]>.5?.35:.55)?1:0):value>.5?1:0;
    }
    for(let i=0;i<4;i++){const v=i<2?left[i]:right[i-2];this.values[17+i*2]=Math.max(0,-v);this.values[18+i*2]=Math.max(0,v);}
    let any=false;for(let i=0;i<25;i++)if(this.values[i]>.15)any=true;
    let activity=false;for(let i=0;i<25;i++)if(this.values[i]>.15&&Math.abs(this.values[i]-this.previous[i])>.02)activity=true;
    if(activity)this.setMethod(true);
    if(gameplay!==this.wasGameplay){this.release();this.wasGameplay=gameplay;}
    if(!any){this.armed=true;this.captured=false;}
    if(this.onCapture){
      this.input.clearController();this.lookX=this.lookY=0;
      if(this.armed&&!this.captured){for(let i=0;i<25;i++)if(this.values[i]>.65&&this.previous[i]<=.65&&i!==8){
        const control=i<17?`b${i}`:`a${Math.floor((i-17)/2)}${(i-17)%2?'+':'-'}`;
        this.captured=true;this.onCapture((this.values[8]>.5?'b8+':'')+control);break;
      }}
    }else if(!gameplay){this.input.clearController();this.lookX=this.lookY=0;if(this.armed&&!this.captured)this.onMenu(pad,dt);}
    else if(this.armed){
      const modifier=this.values[8]>.5;
      const value=(control:string)=>{
        if(!control)return 0;const chord=control.startsWith('b8+');if(chord!==modifier)return 0;
        const c=chord?control.slice(3):control;
        return c[0]==='b'?this.values[Number(c.slice(1))]??0:this.values[17+Number(c[1])*2+(c[2]==='+'?1:0)]??0;
      };
      const b=settings.bindings;
      this.input.controllerX=value(b.right)-value(b.left);this.input.controllerZ=value(b.forward)-value(b.back);
      this.lookX=value(b.lookRight)-value(b.lookLeft);this.lookY=value(b.lookDown)-value(b.lookUp);
      const combined=value(b.crouchSlide)>.5;
      if(combined&&!this.crouchSlide)this.crouchSlide=Math.hypot(this.input.controllerX,this.input.controllerZ)>.25||this.input.isDown('forward')||this.input.isDown('back')?'slide':'crouch';
      if(!combined)this.crouchSlide=null;
      // Merge aliases before setting state: clearing then restoring slide each poll
      // would manufacture fresh press edges while the same button stays held.
      for(const a of CONTROLLER_ACTIONS){if(!gameplayControllerAction(a)||['forward','back','left','right'].includes(a))continue;
        let held=value(b[a])>.5||this.crouchSlide===a;
        if(a==='pause')held ||= this.values[9]>.5; // Fixed escape route survives rebinding/clearing Pause.
        if(a==='fire'){
          const c=b.fire.startsWith('b8+')?b.fire.slice(3):b.fire;
          const index=c[0]==='a'?17+Number(c[1])*2+(c[2]==='+'?1:0):Number(c.slice(1));
          // Changing a utility chord while RT stays held is not another trigger pull.
          held=held&&(this.fireHeld||this.previous[index]<=.5);this.fireHeld=held;
        }
        this.input.setController(a,held);
      }
      for(const a of ['zoomIn','zoomOut'] as const){const c=b[a],base=c.startsWith('b8+')?c.slice(3):c;
        const index=base[0]==='a'?17+Number(base[1])*2+(base[2]==='+'?1:0):Number(base.slice(1));
        if(value(c)>.5&&this.previous[index]<=.5)this.input.onWheel(a==='zoomIn'?-1:1);
      }
    }
    this.previous.set(this.values);
  }
  takeLook(dt:number,ads:number){return controllerLook(this.lookX,this.lookY,dt,this.settings(),ads);}
  vibrate(){if(!this.settings().vibration||!this.active)return;const actuator=this.pad?.vibrationActuator;void actuator?.playEffect('dual-rumble',{duration:45,weakMagnitude:.15,strongMagnitude:.08}).catch(()=>{});}
  dispose(){this.release();this.abort.abort();void this.pad?.vibrationActuator?.reset().catch(()=>{});}
}
