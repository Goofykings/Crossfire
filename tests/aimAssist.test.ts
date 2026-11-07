import {expect,it} from 'vitest';
import {AIM_ASSIST,AimAssist,type AimTarget} from '../src/player/AimAssist';
import {sanitizeSettings,DEFAULT_SETTINGS,SettingsStore} from '../src/config/settings';
const DEG=Math.PI/180;
const target:AimTarget={id:'opponent',point:{x:-Math.tan(1.5*DEG)*10,y:1.2,z:-10},velocity:{x:0,y:0,z:0},grounded:true,sliding:false};
const input=(patch={})=>({enabled:true,now:1000,dt:1/60,yaw:0,pitch:0,inputYaw:.15*DEG,inputPitch:0,eye:{x:0,y:1.2,z:0},targets:[structuredClone(target)],canSee:()=>true,firing:false,recoiling:false,...patch});
it('makes only small voluntary corrections inside the cone, with no snap',()=>{
 const a=new AimAssist(),out=a.step(input());expect(out.yaw).toBeGreaterThan(0);expect(out.yaw).toBeLessThan(.02*DEG);expect(out.pitch).toBe(0);
 for(let now=1016;now<1300;now+=16)a.step(input({now}));expect(a.step(input({now:1300}))).toEqual({yaw:0,pitch:0});
});
it.each(['off','no input','away','outside cone','far','wall','jump','slide','moving','recoil','firing'])('does not assist: %s',reason=>{
 const args=input();if(reason==='off')args.enabled=false;if(reason==='no input')args.inputYaw=0;if(reason==='away')args.inputYaw=-.15*DEG;
 if(reason==='outside cone')args.yaw=-3*DEG;if(reason==='far')args.targets[0].point.z=-100;
 if(reason==='wall')args.canSee=()=>false;if(reason==='jump')args.targets[0].grounded=false;if(reason==='slide')args.targets[0].sliding=true;
 if(reason==='moving')args.targets[0].velocity.x=4;if(reason==='recoil')args.recoiling=true;if(reason==='firing')args.firing=true;
 expect(new AimAssist().step(args)).toEqual({yaw:0,pitch:0});
});
it('requires real matching manual input to follow a moving target and rejects a direction reversal',()=>{
 const a=new AimAssist(),args=input();args.targets[0].velocity.x=-.5;args.inputYaw=.12*DEG;
 expect(a.step(args).yaw).toBeGreaterThan(0);
 args.now+=16;args.targets[0].velocity.x=.5;args.inputYaw=-.12*DEG;args.yaw=2*DEG;
 expect(a.step(args)).toEqual({yaw:0,pitch:0});
});
it('never switches targets mid gesture, and stops immediately for stationary mouse or lost LOS',()=>{
 const a=new AimAssist();a.step(input());
 expect(a.step(input({now:1016,targets:[{...target,id:'other'}]}))).toEqual({yaw:0,pitch:0});
 expect(a.step(input({now:1032,inputYaw:0}))).toEqual({yaw:0,pitch:0});
 expect(a.step(input({now:1048,canSee:()=>false}))).toEqual({yaw:0,pitch:0});
 expect(a.step(input({now:1200,targets:[{...target,id:'other'}]})).yaw).toBeGreaterThan(0);
});
it('bounds correction per gesture and remains consistent at 30/60/144 FPS',()=>{
 const totals=[30,60,144].map(fps=>{const a=new AimAssist();let sum=0;for(let n=0;n<fps;n++)sum+=a.step(input({now:1000+n*1000/fps,dt:1/fps,inputYaw:10*DEG/fps})).yaw;return sum;});
 expect(totals.every(n=>n>0&&n<=AIM_ASSIST.maxCorrection)).toBe(true);expect(Math.max(...totals)-Math.min(...totals)).toBeLessThan(.035*DEG);
});
it('does not resume correction during or just after a shot',()=>{
 const a=new AimAssist();a.step(input({firing:true}));expect(a.step(input({now:1250}))).toEqual({yaw:0,pitch:0});expect(a.step(input({now:1400,recoiling:true}))).toEqual({yaw:0,pitch:0});
});
it('defaults Off, sanitizes and persists the explicit setting without losing other preferences',()=>{
 expect(DEFAULT_SETTINGS.aimAssist).toBe(false);expect(sanitizeSettings({aimAssist:'yes'}).aimAssist).toBe(false);
 const store=new SettingsStore(null);store.update({aimAssist:true,masterVolume:.3});expect(store.value.aimAssist).toBe(true);expect(store.value.masterVolume).toBe(.3);store.update({aimAssist:false});expect(store.value.masterVolume).toBe(.3);
});
