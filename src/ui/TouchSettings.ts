import type {SettingsDraft} from '../config/settingsDraft';
import {defaultTouchSettings,type TouchSettings} from '../config/touch';
export class TouchSettingsPanel{
 readonly element=document.createElement('div');private syncs:(()=>void)[]=[];
 constructor(private draft:SettingsDraft,private changed:()=>void){
  this.element.className='touch-settings';
  const row=document.createElement('label');row.className='setting';row.textContent='Touch controls';
  const select=document.createElement('select');select.setAttribute('aria-label','Touch controls');
  for(const [value,text]of [['auto','Automatic'],['on','Enabled'],['off','Disabled']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  select.onchange=()=>this.edit({...this.draft.value.touch,mode:select.value as TouchSettings['mode']});this.syncs.push(()=>select.value=this.draft.value.touch.mode);row.append(select);this.element.append(row);
  const help=document.createElement('p');help.className='controller-help';help.textContent='Touch the game to use touch controls. Physical keys, mouse or a gamepad return to their normal controls. Aim is a toggle; Slide is beside Fire. More reveals reload, grenades, crouch, daggers, lean, scope zoom and chat.';this.element.append(help);
  for(const [key,title,min,max,step]of [['sensitivity','Look sensitivity',.2,3,.05],['ads','ADS sensitivity multiplier',.1,1.5,.05],['joystickSize','Joystick size',80,160,1],['deadzone','Joystick deadzone',0,.4,.01],['buttonSize','Button size',44,84,1],['opacity','Button opacity',.2,1,.05]] as const){
   const label=document.createElement('label');label.className='setting';const text=document.createElement('span');text.textContent=title;
   const input=document.createElement('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.setAttribute('aria-label',title);const output=document.createElement('output');
   input.oninput=()=>this.edit({...this.draft.value.touch,[key]:Number(input.value)});this.syncs.push(()=>{input.value=String(this.draft.value.touch[key]);output.textContent=Number(input.value).toFixed(step<1?2:0);});label.append(text,input,output);this.element.append(label);
  }
  const reset=document.createElement('button');reset.type='button';reset.className='control-bind';reset.textContent='Reset touch defaults';reset.onclick=()=>this.edit(defaultTouchSettings());this.element.append(reset);this.sync();
 }
 private edit(s:TouchSettings){this.draft.set('touch',s);this.changed();this.sync();}
 sync(){for(const f of this.syncs)f();}
}
