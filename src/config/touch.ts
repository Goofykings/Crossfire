export interface TouchSettings {
  mode: 'auto'|'on'|'off';
  sensitivity: number;
  ads: number;
  joystickSize: number;
  deadzone: number;
  buttonSize: number;
  opacity: number;
}
export const defaultTouchSettings=():TouchSettings=>({mode:'auto',sensitivity:1,ads:.55,joystickSize:116,deadzone:.12,buttonSize:62,opacity:.6});
export function sanitizeTouch(raw:unknown):TouchSettings{
  const s=defaultTouchSettings();if(!raw||typeof raw!=='object')return s;
  const r=raw as Record<string,unknown>;
  if(r.mode==='auto'||r.mode==='on'||r.mode==='off')s.mode=r.mode;
  for(const [k,min,max]of [['sensitivity',.2,3],['ads',.1,1.5],['joystickSize',80,160],['deadzone',0,.4],['buttonSize',44,84],['opacity',.2,1]] as const){
    if(typeof r[k]==='number'&&Number.isFinite(r[k]))s[k]=Math.max(min,Math.min(max,r[k]));
  }
  return s;
}
/** Primary coarse pointer distinguishes phones/tablets from a touchscreen laptop with a mouse. */
export function automaticTouch(points:number,primaryCoarse:boolean):boolean{return points>0&&primaryCoarse;}
export function touchStick(dx:number,dy:number,radius:number,deadzone:number):[number,number]{
  const d=Math.hypot(dx,dy);if(!Number.isFinite(d)||radius<=0||d<=radius*deadzone)return [0,0];
  const amount=(Math.min(1,d/radius)-deadzone)/(1-deadzone);
  return [dx/d*amount,-dy/d*amount];
}
/** Cosmetic rubber band only; gameplay axes remain clamped by touchStick. */
export function touchStickVisual(dx:number,dy:number,radius:number){
  const d=Math.hypot(dx,dy);
  if(!Number.isFinite(d)||radius<=0||d===0)return {x:0,y:0,stretch:0,angle:0};
  const stretch=1-Math.exp(-Math.max(0,d-radius)/radius);
  // Leave room for the thumb itself and the viewport's safe edge margin.
  const reach=Math.min(d,radius)*.65+radius*.15*stretch;
  return {x:dx/d*reach,y:dy/d*reach,stretch,angle:Math.atan2(dy,dx)};
}
export function physicalKey(e:Pick<KeyboardEvent,'code'|'altKey'|'ctrlKey'|'metaKey'>):boolean{
  return !e.altKey&&!e.ctrlKey&&!e.metaKey&&!/^(Shift|Alt|Control|Meta|CapsLock|NumLock|ScrollLock)/.test(e.code);
}
/** Compatibility mouse events from touch must not select a different input method. */
export function syntheticTouchMouse(e:{isTrusted:boolean;sourceCapabilities?:{firesTouchEvents:boolean}|null}):boolean{
  return !e.isTrusted||e.sourceCapabilities?.firesTouchEvents===true;
}
