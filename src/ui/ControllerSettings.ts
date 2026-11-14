import { CONTROLLER_ACTIONS, CONTROLLER_LABELS, controllerConflict, controllerName, defaultControllerSettings, type ControllerAction, type ControllerFamily, type ControllerSettings as Options } from '../config/controller';
import type { SettingsDraft } from '../config/settingsDraft';

/** Uses the same draft/Apply/Back persistence semantics as keyboard controls. */
export class ControllerSettingsPanel {
  readonly element=document.createElement('div');
  capture:((control:string)=>void)|null=null;
  private status=document.createElement('p');private note=document.createElement('p');
  private buttons=new Map<ControllerAction,HTMLButtonElement>();private syncs:(()=>void)[]=[];
  private family:ControllerFamily='generic';private awaiting:ControllerAction|null=null;
  private conflictButtons=document.createElement('div');
  constructor(private draft:SettingsDraft,private changed:()=>void){
    this.element.className='controller-settings control-settings';this.status.setAttribute('role','status');this.note.setAttribute('role','status');
    this.element.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.capture){e.preventDefault();e.stopPropagation();this.cancel();}});
    this.element.append(this.status,this.note,this.conflictButtons);
    const help=document.createElement('p');help.className='controller-help';help.textContent='D-pad / left stick: navigate · bottom face button: select · right face button: back · bumpers: tabs. View / Share + button: extra actions. Right stick rotates Locker previews. No sprint action exists; movement uses the normal game speed.';this.element.append(help);
    const limits=[['horizontal','Horizontal look (degrees/s)',15,540,1],['vertical','Vertical look (degrees/s)',15,540,1],['leftDeadzone','Left-stick deadzone',0,.4,.01],['rightDeadzone','Right-stick deadzone',0,.4,.01],['ads','ADS sensitivity multiplier',.1,1.5,.01],['acceleration','Look acceleration (0 = off)',0,2,.05]] as const;
    for(const [key,title,min,max,step]of limits){
      const row=document.createElement('label');row.className='setting';const text=document.createElement('span');text.textContent=title;
      const input=document.createElement('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.setAttribute('aria-label',title);
      const out=document.createElement('output');input.oninput=()=>this.edit({...this.draft.value.controller,[key]:Number(input.value)});
      this.syncs.push(()=>{input.value=String(this.draft.value.controller[key]);out.textContent=Number(input.value).toFixed(step<1?2:0);});row.append(text,input,out);this.element.append(row);
    }
    for(const [key,title]of [['invertY','Invert vertical look'],['vibration','Controller vibration (if supported)']] as const){
      const row=document.createElement('label');row.className='setting';row.textContent=title;const input=document.createElement('input');input.type='checkbox';input.onchange=()=>this.edit({...this.draft.value.controller,[key]:input.checked});this.syncs.push(()=>input.checked=this.draft.value.controller[key]);row.append(input);this.element.append(row);
    }
    for(const a of CONTROLLER_ACTIONS){const row=document.createElement('div');row.className='control-row';const label=document.createElement('span');label.textContent=CONTROLLER_LABELS[a];
      const b=this.button('',()=>{this.awaiting=a;this.conflictButtons.replaceChildren();this.note.textContent='Release controls, then press a button or stick direction. Hold View / Share for a chord. Menu / Options cancels.';this.capture=c=>this.assign(a,c);this.sync();});
      this.buttons.set(a,b);b.setAttribute('aria-label',`Rebind controller ${CONTROLLER_LABELS[a]}`);
      row.append(label,b,this.button('Clear',()=>{this.cancel();this.edit({...this.draft.value.controller,bindings:{...this.draft.value.controller.bindings,[a]:''}});}));this.element.append(row);
    }
    this.element.append(this.button('Cancel binding',()=>this.cancel()),this.button('Reset controller defaults',()=>{this.cancel();this.edit(defaultControllerSettings());}));this.sync();
  }
  private button(text:string,fn:()=>void){const b=document.createElement('button');b.type='button';b.className='control-bind';b.textContent=text;b.onclick=fn;return b;}
  private edit(s:Options){this.draft.set('controller',s);this.changed();this.sync();}
  private assign(a:ControllerAction,c:string){
    this.capture=null;this.awaiting=null;
    if(c==='b9'||c==='b8+b9'){this.cancel();return;}
    const b=this.draft.value.controller.bindings,conflict=controllerConflict(b,a,c);
    if(conflict){this.note.textContent=`${controllerName(c,this.family)} is used by ${CONTROLLER_LABELS[conflict]}. Swap their bindings or cancel.`;
      this.conflictButtons.replaceChildren(this.button('Swap bindings',()=>{this.edit({...this.draft.value.controller,bindings:{...b,[a]:c,[conflict]:b[a]}});this.cancel();}),this.button('Cancel',()=>this.cancel()));
    }else{this.edit({...this.draft.value.controller,bindings:{...b,[a]:c}});this.note.textContent='Binding changed. Apply to save.';}
    this.sync();
  }
  cancel(){this.capture=null;this.awaiting=null;this.note.textContent='';this.conflictButtons.replaceChildren();this.sync();}
  connection(status:string,family:ControllerFamily){if(this.status.textContent!==status)this.status.textContent=status;if(this.family!==family){this.family=family;this.sync();}}
  sync(){for(const f of this.syncs)f();for(const [a,b]of this.buttons)b.textContent=this.awaiting===a?'Waiting for input…':controllerName(this.draft.value.controller.bindings[a],this.family);}
}
