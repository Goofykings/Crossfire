import type { Action } from '../core/Input';

export const CONTROLLER_LABELS = {
  forward:'Move forward', back:'Move backward', left:'Move left', right:'Move right',
  lookLeft:'Look left',lookRight:'Look right',lookUp:'Look up',lookDown:'Look down',
  fire:'Fire / dagger attack',aim:'Aim down sights',jump:'Jump',crouchSlide:'Crouch / moving slide',
  crouch:'Hold crouch',slide:'Slide',reload:'Reload',melee:'Toggle daggers',grenade:'Charge / throw grenade',
  leanLeft:'Lean left',leanRight:'Lean right',nextWeapon:'Next weapon',prevWeapon:'Previous weapon',lastWeapon:'Last weapon',
  weapon1:'Weapon 1',weapon2:'Weapon 2',weapon3:'Weapon 3',weapon4:'Weapon 4',weapon5:'Weapon 5',
  zoomIn:'Scope zoom in',zoomOut:'Scope zoom out',leaderboard:'Leaderboard',chat:'Chat',pause:'Pause',toggleFps:'FPS counter',
} as const;
export type ControllerAction = keyof typeof CONTROLLER_LABELS;
export const CONTROLLER_ACTIONS = Object.keys(CONTROLLER_LABELS) as ControllerAction[];
export type ControllerBindings = Record<ControllerAction,string>;
export const defaultControllerBindings = ():ControllerBindings => ({
  forward:'a1-',back:'a1+',left:'a0-',right:'a0+',lookLeft:'a2-',lookRight:'a2+',lookUp:'a3-',lookDown:'a3+',
  fire:'b7',aim:'b6',jump:'b0',crouchSlide:'b1',reload:'b2',nextWeapon:'b3',prevWeapon:'b10',melee:'b11',
  leanLeft:'b4',leanRight:'b5',grenade:'b12',leaderboard:'b13',zoomOut:'b14',zoomIn:'b15',pause:'b9',
  weapon1:'b8+b0',weapon2:'b8+b1',weapon3:'b8+b2',weapon4:'b8+b3',weapon5:'b8+b5',lastWeapon:'b8+b4',
  chat:'b8+b12',toggleFps:'b8+b13',slide:'b8+b14',crouch:'b8+b15',
});
export interface ControllerSettings {
  bindings:ControllerBindings; horizontal:number; vertical:number; leftDeadzone:number; rightDeadzone:number;
  ads:number; invertY:boolean; acceleration:number; vibration:boolean;
}
export const defaultControllerSettings = ():ControllerSettings => ({bindings:defaultControllerBindings(),horizontal:180,vertical:140,
  leftDeadzone:.15,rightDeadzone:.12,ads:.5,invertY:false,acceleration:0,vibration:false});
export const validControllerControl=(s:unknown):s is string => typeof s==='string' && /^(b8\+)?(b([0-9]|1[0-6])|a[0-3][+-])$/.test(s) && s!=='b8' && !s.endsWith('+b8');
export function sanitizeController(raw:unknown):ControllerSettings {
  const s=defaultControllerSettings();if(!raw||typeof raw!=='object')return s;
  const r=raw as Record<string,unknown>;
  for(const [key,lo,hi] of [['horizontal',15,540],['vertical',15,540],['leftDeadzone',0,.4],['rightDeadzone',0,.4],['ads',.1,1.5],['acceleration',0,2]] as const){
    const v=r[key];if(typeof v==='number'&&Number.isFinite(v))s[key]=Math.max(lo,Math.min(hi,v));
  }
  for(const k of ['invertY','vibration'] as const)if(typeof r[k]==='boolean')s[k]=r[k];
  if(r.bindings&&typeof r.bindings==='object'){
    const b=r.bindings as Record<string,unknown>,seen=new Set<string>();
    // Keep unbound actions explicit. Invalid/conflicting stored layouts recover as a unit.
    const bindings={...s.bindings};
    for(const a of CONTROLLER_ACTIONS){const v=b[a]??bindings[a];if(v!==''&&(!validControllerControl(v)||seen.has(v)))return s;bindings[a]=v as string;if(v)seen.add(v as string);}
    s.bindings=bindings;
  }
  return s;
}
export function controllerConflict(b:ControllerBindings,a:ControllerAction,control:string){return control?CONTROLLER_ACTIONS.find(k=>k!==a&&b[k]===control):undefined;}
export type ControllerFamily='xbox'|'playstation'|'generic';
export function controllerFamily(id:string):ControllerFamily{return /playstation|dualshock|dualsense|054c|sony/i.test(id)?'playstation':/xbox|xinput|045e|microsoft/i.test(id)?'xbox':'generic';}
export function controllerName(control:string,family:ControllerFamily='generic'):string{
  if(!control)return 'Unbound';if(control.startsWith('b8+'))return `${family==='playstation'?'Share':family==='xbox'?'View':'Button 8'} + ${controllerName(control.slice(3),family)}`;
  if(control[0]==='a')return ['Left stick','Left stick','Right stick','Right stick'][Number(control[1])]+' '+(Number(control[1])%2===0?(control[2]==='+'?'right':'left'):(control[2]==='+'?'down':'up'));
  const n=Number(control.slice(1));
  return (family==='playstation'?['Cross','Circle','Square','Triangle','L1','R1','L2','R2','Share','Options','L3','R3']:family==='xbox'?['A','B','X','Y','LB','RB','LT','RT','View','Menu','LS','RS']:[])[n]??(n>=12&&n<=15?['D-pad up','D-pad down','D-pad left','D-pad right'][n-12]:`Button ${n}`);
}
/** Radial deadzone: continuous at the boundary, unit circle preserved diagonally. */
export function radialStick(x:number,y:number,deadzone:number):readonly[number,number]{
  if(!Number.isFinite(x)||!Number.isFinite(y))return [0,0];const m=Math.hypot(x,y);if(m<=deadzone)return [0,0];
  const k=Math.min(1,(m-deadzone)/(1-deadzone))/m;return [x*k,y*k];
}
export function controllerLook(x:number,y:number,dt:number,s:ControllerSettings,ads:number):readonly[number,number]{
  const gain=1+s.acceleration*Math.max(Math.abs(x),Math.abs(y))**2,scale=Math.min(.1,Math.max(0,dt))*Math.PI/180*(1+(s.ads-1)*ads)*gain;
  return [-x*s.horizontal*scale,-y*s.vertical*scale*(s.invertY?-1:1)];
}
export const gameplayControllerAction=(a:ControllerAction):a is ControllerAction & Action => !['lookLeft','lookRight','lookUp','lookDown','crouchSlide','zoomIn','zoomOut'].includes(a);
