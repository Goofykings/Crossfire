import {automaticTouch,physicalKey,syntheticTouchMouse,type TouchSettings} from '../config/touch';
import {isTextInput} from '../config/keybindings';
import type {Action,Input} from '../core/Input';
import {TouchInput} from '../core/TouchInput';

const paths:Record<string,string>={
 fire:'M4 9h15v5h-7l-2 6H6l2-7H4z M16 9V6h3v3',
 aim:'M12 3v4m0 10v4M3 12h4m10 0h4 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
 jump:'M12 4a1.5 1.5 0 1 0 0 .1 M7 10l5-3 5 3M12 7v7m0 0-5 6m5-6 5 6',
};
const labels:Record<string,string>={reload:'Reload',nextWeapon:'Weapon',crouch:'Crouch',slide:'Slide',grenade:'Grenade',melee:'Daggers',leanLeft:'Lean L',leanRight:'Lean R',leaderboard:'Scores',chat:'Chat',zoomIn:'Zoom +',zoomOut:'Zoom −'};
/** One persistent Pointer Events overlay. Menus retain ordinary scrolling/tap behavior. */
export class TouchControls {
 readonly element=document.createElement('div');readonly state:TouchInput;
 active=false;onMethod:(active:boolean)=>void=()=>{};onInterrupt:()=>void=()=>{};
 private abort=new AbortController();private pointers=new Map<number,HTMLElement>();
 private owned=new Set<number>();private blockClick=false;
 private knob=document.createElement('span');private joystick=document.createElement('div');
 private aim:HTMLButtonElement;private extras=document.createElement('div');
 private context=false;private weapon='';private life=-1;private melee=false;private style='';
 private coarse=matchMedia('(pointer: coarse)');
 constructor(private input:Input,private canvas:HTMLCanvasElement,root:HTMLElement,private settings:()=>TouchSettings,private canPlay:()=>boolean){
  this.state=new TouchInput(input,settings);this.element.className='touch-controls';this.element.hidden=true;
  this.element.setAttribute('aria-label','Touch gameplay controls');
  this.element.addEventListener('contextmenu',e=>e.preventDefault());
  this.joystick.className='touch-joystick';this.joystick.dataset.touch='move';this.joystick.setAttribute('aria-label','Movement joystick');this.knob.className='touch-thumb';this.joystick.append(this.knob);this.element.append(this.joystick);
  const fire=this.button('fire','Fire','fire'),jump=this.button('jump','Jump','jump');
  this.aim=this.button('aim','Aim down sights','aim');this.aim.setAttribute('aria-pressed','false');
  const pause=this.button('pause','Pause','Ⅱ'),more=this.button('more','More controls','•••');more.setAttribute('aria-expanded','false');
  this.extras.className='touch-extras';this.extras.hidden=true;
  for(const [a,label,icon]of [['reload','Reload','↻'],['nextWeapon','Next weapon','⇄'],['crouch','Hold crouch','↓'],['slide','Hold slide','⇢'],['grenade','Hold and release grenade','◉'],['melee','Toggle daggers','⚔'],['leanLeft','Lean left','↶'],['leanRight','Lean right','↷'],['leaderboard','Hold scoreboard','≡'],['chat','Chat','…'],['zoomIn','Increase scope zoom','＋'],['zoomOut','Decrease scope zoom','−']])this.extras.append(this.button(a,label,icon));
  this.element.append(fire,this.aim,jump,pause,more,this.extras);root.append(this.element);
  const signal=this.abort.signal;
  const pointerDown=(e:PointerEvent)=>{
   this.blockClick=false;
   if(e.pointerType!=='touch'&&e.pointerType!=='pen')return;
   // A fresh primary pointer begins a new gesture after all previous contacts
   // ended, including a browser interruption that delivered no pointerup.
   if(e.isPrimary)this.owned.clear();
   if(!this.canPlay()||this.settings().mode==='off')return;
   const target=e.target as HTMLElement;
   const hud=target.closest('#hud');
   if(target!==this.canvas&&!this.element.contains(target)&&!(hud&&!target.closest('button,input,textarea,select,.match-chat')))return;
   this.activate();if(!this.input.enabled)return;
   const control=target.closest<HTMLElement>('[data-touch]');
   if(control){
    const action=control.dataset.touch!;
    if(action==='move'){if(!this.state.startMove(e.pointerId))return;this.move(e);}
    else if(action==='aim'){this.state.toggleADS();this.syncAim();}
    else if(action==='more'){this.extras.hidden=!this.extras.hidden;control.setAttribute('aria-expanded',String(!this.extras.hidden));}
    else if(action==='zoomIn'||action==='zoomOut')this.input.onWheel(action==='zoomIn'?-1:1);
    else this.state.press(e.pointerId,action as Action);
    this.pointers.set(e.pointerId,control);control.classList.add('pressed');
   }else if(e.clientX>innerWidth*.36){if(!this.state.startLook(e.pointerId,e.clientX,e.clientY))return;this.pointers.set(e.pointerId,this.canvas);}
   else return;
   this.owned.add(e.pointerId);e.preventDefault();try{(control??this.canvas).setPointerCapture(e.pointerId);}catch{/* cancelled by browser */}
  };
  window.addEventListener('pointerdown',pointerDown,{capture:true,passive:false,signal});
  window.addEventListener('pointermove',e=>{
   if(this.pointers.has(e.pointerId)){
    e.preventDefault();if(this.pointers.get(e.pointerId)===this.joystick)this.move(e);else this.state.lookTo(e.pointerId,e.clientX,e.clientY);
   }else if(e.pointerType==='mouse'&&!this.synthetic(e))this.deactivate();
  },{passive:false,signal});
  for(const type of ['pointerup','pointercancel'] as const)window.addEventListener(type,e=>{
   if(this.owned.delete(e.pointerId)){this.blockClick=true;e.preventDefault();e.stopPropagation();}
   this.end(e.pointerId);
  },{capture:true,passive:false,signal});
  window.addEventListener('lostpointercapture',e=>this.end(e.pointerId),{signal});
  // Browsers may synthesize click even after pointerdown.preventDefault(). Keep
  // ownership through death/pause/resize until finger-up, then consume that click.
  // A new pointerdown resets the gate, so the next intentional menu tap works.
  window.addEventListener('click',e=>{if(this.blockClick&&e.detail!==0){this.blockClick=false;e.preventDefault();e.stopImmediatePropagation();}},{capture:true,signal});
  window.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&!this.synthetic(e))this.deactivate();},{capture:true,signal});
  window.addEventListener('keydown',e=>{if(physicalKey(e)&&!isTextInput(e.target))this.deactivate();},{capture:true,signal});
  const interrupted=()=>{this.clear();if(this.canPlay()&&this.active)this.onInterrupt();};
  window.addEventListener('blur',interrupted,{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupted();},{signal});
  window.addEventListener('orientationchange',()=>this.clear(),{signal});
  screen.orientation?.addEventListener('change',()=>this.clear(),{signal});
  window.addEventListener('resize',()=>this.clear(),{signal});
  this.configure(true);
 }
 private button(action:string,label:string,icon:string){const b=document.createElement('button');b.type='button';b.className=`touch-button touch-${action}`;b.dataset.touch=action;b.setAttribute('aria-label',label);b.title=label;
  if(paths[icon])b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[icon]}"/></svg>`;else b.textContent=icon;
  if(labels[action]){const text=document.createElement('span');text.className='touch-control-label';text.textContent=labels[action];b.append(text);}
  // Actions use pointerdown only: compatibility click must never repeat a toggle.
  b.addEventListener('click',e=>e.preventDefault());return b;}
 private synthetic(e:PointerEvent){return syntheticTouchMouse(e as PointerEvent&{sourceCapabilities?:{firesTouchEvents:boolean}});}
 activate(){if(this.settings().mode==='off'||this.active)return;this.clear();this.active=true;document.body.classList.add('touch-active');this.onMethod(true);this.visibility();}
 deactivate(){if(!this.active)return;this.clear();this.active=false;document.body.classList.remove('touch-active');this.onMethod(false);this.visibility();}
 configure(_initial=false){this.clear();const s=this.settings();if(s.mode==='off')this.deactivate();else if(s.mode==='on'||automaticTouch(navigator.maxTouchPoints??0,this.coarse.matches))this.activate();
  const style=`--touch-stick:${s.joystickSize}px;--touch-button:${s.buttonSize}px;--touch-opacity:${s.opacity}`;
  if(style!==this.style){this.element.style.cssText=style;this.style=style;}}
 update(gameplay:boolean,life:number,weapon:string,melee:boolean){
  gameplay=gameplay&&this.canPlay();
  if(!gameplay&&this.context)this.clear();
  if(life!==this.life){this.clear();this.life=life;}
  if(weapon!==this.weapon||melee!==this.melee){this.state.resetADS();this.syncAim();this.weapon=weapon;this.melee=melee;}
  this.context=gameplay;this.visibility();
 }
 private visibility(){const hidden=!(this.active&&this.canPlay());if(this.element.hidden!==hidden)this.element.hidden=hidden;}
 private move(e:PointerEvent){const r=this.joystick.getBoundingClientRect(),radius=r.width/2,dx=e.clientX-r.left-radius,dy=e.clientY-r.top-radius;
  this.state.moveTo(e.pointerId,dx,dy,radius);const d=Math.hypot(dx,dy),k=d>radius?radius/d:1;
  this.knob.style.transform=`translate(${dx*k}px,${dy*k}px)`;}
 private end(id:number){const target=this.pointers.get(id);if(!target)return;this.pointers.delete(id);this.state.end(id);
  if(![...this.pointers.values()].includes(target))target.classList.remove('pressed');
  if(target===this.joystick)this.knob.style.transform='';
 }
 private syncAim(){this.aim.setAttribute('aria-pressed',String(this.state.ads));}
 clear(){this.state.clear();for(const [id,target]of this.pointers){target.classList.remove('pressed');try{if(target.hasPointerCapture(id))target.releasePointerCapture(id);}catch{}}
  this.pointers.clear();this.knob.style.transform='';this.syncAim();}
 dispose(){this.clear();this.owned.clear();this.abort.abort();this.element.remove();document.body.classList.remove('touch-active');}
}
