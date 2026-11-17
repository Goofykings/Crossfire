import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {automaticTouch,defaultTouchSettings,physicalKey,sanitizeTouch,syntheticTouchMouse,touchStick} from '../src/config/touch';
import {Input} from '../src/core/Input';
import {TouchInput} from '../src/core/TouchInput';
import {Weapon,WEAPONS} from '../src/weapons/Weapon';
import {SettingsStore} from '../src/config/settings';
import {SettingsDraft} from '../src/config/settingsDraft';
let input:Input,touch:TouchInput;
beforeEach(()=>{vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',new EventTarget());input=new Input(new EventTarget() as HTMLCanvasElement);input.enabled=true;touch=new TouchInput(input,defaultTouchSettings);});
afterEach(()=>{input.dispose();vi.unstubAllGlobals();});
it('defaults only primary coarse touch devices to touch; hybrids can activate on use',()=>{
 expect(automaticTouch(5,true)).toBe(true);expect(automaticTouch(0,true)).toBe(false);expect(automaticTouch(10,false)).toBe(false);
 expect(physicalKey({code:'KeyW',altKey:false,ctrlKey:false,metaKey:false})).toBe(true);
 for(const code of ['ShiftLeft','ControlRight','AltLeft','MetaLeft'])expect(physicalKey({code,altKey:false,ctrlKey:false,metaKey:false})).toBe(false);
 expect(physicalKey({code:'KeyR',altKey:false,ctrlKey:true,metaKey:false})).toBe(false);
});
it('clamps settings and persists touch edits without changing other settings',()=>{
 expect(sanitizeTouch({mode:'invalid',sensitivity:Infinity,deadzone:2,opacity:-2})).toMatchObject({mode:'auto',sensitivity:1,deadzone:.4,opacity:.2});
 let saved='';const storage={getItem:()=>saved||null,setItem:(_k:string,v:string)=>{saved=v;}} as unknown as Storage;
 const s=new SettingsStore(storage);s.update({masterVolume:.3,fov:110});const draft=new SettingsDraft(s);
 draft.set('touch',{...draft.value.touch,mode:'on',sensitivity:1.5});expect(s.value.touch.mode).toBe('auto');expect(draft.dirtyKeys).toEqual(['touch']);draft.apply();
 expect(new SettingsStore(storage).value).toMatchObject({masterVolume:.3,fov:110,touch:{mode:'on',sensitivity:1.5}});
 draft.set('touch',{...draft.value.touch,mode:'off'});draft.discard();expect(draft.value.touch.mode).toBe('on');draft.dispose();
});
it('ignores synthetic and touch-compatibility mouse events but allows immediate physical mouse use',()=>{
 expect(syntheticTouchMouse({isTrusted:false})).toBe(true);expect(syntheticTouchMouse({isTrusted:true,sourceCapabilities:{firesTouchEvents:true}})).toBe(true);
 expect(syntheticTouchMouse({isTrusted:true,sourceCapabilities:{firesTouchEvents:false}})).toBe(false);expect(syntheticTouchMouse({isTrusted:true})).toBe(false);
});
it('provides radial analog joystick input with deadzone, diagonal cap and immediate release',()=>{
 expect(touchStick(1,1,50,.12)).toEqual([0,0]);expect(touchStick(NaN,0,50,.12)).toEqual([0,0]);
 touch.startMove(1);expect(touch.startMove(2)).toBe(false);touch.moveTo(1,50,-50,50);
 expect(Math.hypot(input.touchX,input.touchZ)).toBeCloseTo(1);expect(input.touchX).toBe(input.touchZ);
 touch.end(2);expect(input.touchZ).toBeGreaterThan(0);touch.end(1);expect(input.touchX).toBe(0);expect(input.touchZ).toBe(0);
});
it('independently tracks movement, camera, held fire and jump pointers',()=>{
 touch.startMove(1);touch.moveTo(1,0,-50,50);touch.startLook(2,10,10);expect(touch.startLook(3,0,0)).toBe(false);
 touch.press(3,'fire');touch.press(4,'jump');touch.lookTo(3,999,999);touch.lookTo(2,30,18);
 expect(input.touchZ).toBe(1);expect(input.isDown('fire')).toBe(true);expect(input.wasPressed('jump')).toBe(true);
 expect(touch.takeLook(0)).toEqual([.05,.02]);expect(touch.takeLook(0)).toEqual([0,0]);
 touch.end(2);touch.lookTo(2,999,999);expect(touch.takeLook(0)).toEqual([0,0]);expect(input.isDown('fire')).toBe(true);
 touch.end(3);expect(input.isDown('fire')).toBe(false);expect(input.touchZ).toBe(1);
});
it('accumulates frame-independent camera drag and applies separate ADS sensitivity',()=>{
 touch.startLook(1,0,0);for(let i=1;i<=10;i++)touch.lookTo(1,i*2,i);expect(touch.takeLook(1)).toEqual([.027500000000000004,.013750000000000002]);
 touch.end(1);touch.startLook(2,500,500);expect(touch.takeLook(0)).toEqual([0,0]);
});
it('toggles ADS once per command and resets without touching physical aim',()=>{
 touch.toggleADS();expect(input.isDown('aim')).toBe(true);touch.toggleADS();expect(input.isDown('aim')).toBe(false);
 touch.toggleADS();input.simulate('aim',true);touch.resetADS();expect(touch.ads).toBe(false);expect(input.isDown('aim')).toBe(true);
});
it('keeps fire edges distinct for semi-auto and holds automatic fire through existing weapon rules',()=>{
 for(const id of ['rifle','semi-sniper']as const){
  const gun=new Weapon(WEAPONS.find(w=>w.id===id)!);let shots=0;
  touch.press(1,'fire');for(let i=0;i<90;i++){shots+=gun.update(1/60,{trigger:input.isDown('fire'),triggerPressed:input.consume('fire'),reloadPressed:false,aim:false,moveFactor:0,airborne:false,sprinting:false}).filter(e=>e.type==='fire').length;input.endFrame();}
  if(id==='rifle')expect(shots).toBeGreaterThan(1);else expect(shots).toBe(1);
  touch.end(1);gun.update(.5,{trigger:false,triggerPressed:false,reloadPressed:false,aim:false,moveFactor:0,airborne:false,sprinting:false});touch.press(2,'fire');expect(input.wasPressed('fire')).toBe(true);touch.end(2);input.endFrame();
 }
});
it('cleans all virtual state after cancellation, focus loss, orientation, death or leave; physical sources survive',()=>{
 touch.startMove(1);touch.moveTo(1,0,-50,50);touch.startLook(2,0,0);touch.lookTo(2,40,40);touch.press(3,'fire');touch.press(4,'grenade');touch.toggleADS();input.setController('reload',true);input.simulate('crouch',true);
 touch.clear();expect(input.touchZ).toBe(0);expect(input.isDown('fire')).toBe(false);expect(input.wasPressed('fire')).toBe(false);expect(input.isDown('grenade')).toBe(false);expect(input.isDown('aim')).toBe(false);expect(touch.takeLook(0)).toEqual([0,0]);expect(input.isDown('reload')).toBe(true);expect(input.isDown('crouch')).toBe(true);
 input.clearState();expect(input.isDown('reload')).toBe(false);
});
it('multiple fingers holding the same action cannot release each other',()=>{
 touch.press(1,'fire');input.endFrame();touch.press(2,'fire');expect(input.wasPressed('fire')).toBe(false);touch.end(1);expect(input.isDown('fire')).toBe(true);touch.end(2);expect(input.isDown('fire')).toBe(false);
});
it('intentional mouse unlock does not erase a new pointer-free touch, while ordinary unlock still clears input',()=>{
 input.pointerFree=true;touch.press(1,'fire');document.dispatchEvent(new Event('pointerlockchange'));expect(input.isDown('fire')).toBe(true);
 input.pointerFree=false;document.dispatchEvent(new Event('pointerlockchange'));expect(input.isDown('fire')).toBe(false);
});
it('cancels queued touch taps between frames without erasing a physical press',()=>{
 touch.press(1,'fire');touch.end(1);expect(input.wasPressed('fire')).toBe(true);touch.clear();expect(input.wasPressed('fire')).toBe(false);
 touch.press(2,'jump');touch.end(2);input.simulate('jump',true);touch.clear();expect(input.wasPressed('jump')).toBe(true);expect(input.isDown('jump')).toBe(true);
});
