import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Controller } from '../src/core/Controller';
import { Input } from '../src/core/Input';
import { controllerConflict,controllerFamily,controllerLook,controllerName,defaultControllerSettings,radialStick,sanitizeController } from '../src/config/controller';
import { SettingsStore } from '../src/config/settings';
import { SettingsDraft } from '../src/config/settingsDraft';
import { Weapon, WEAPONS, type WeaponEvent } from '../src/weapons/Weapon';
import { ControllerMenu } from '../src/ui/ControllerMenu';

let input:Input,controller:Controller,win:EventTarget,doc:EventTarget;
const options=()=>defaultControllerSettings();
function pad(index=0){return {index,connected:true,mapping:'standard',id:'Xbox test',buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0})),axes:[0,0,0,0]} as unknown as Gamepad & {axes:number[]};}
function button(p:Gamepad,n:number,value:number){Object.assign(p.buttons[n],{pressed:value>.5,value});}
const poll=(p:Gamepad|null,playing=true,dt=1/60)=>controller.poll(dt,playing,[p],true);
beforeEach(()=>{
  win=new EventTarget();doc=new EventTarget();vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
  input=new Input(new EventTarget() as HTMLCanvasElement);input.enabled=true;controller=new Controller(input,options);
});
afterEach(()=>{controller.dispose();input.dispose();vi.unstubAllGlobals();});

it('detects a standard controller and releases actions on disconnection/reconnect, requiring neutral',()=>{
  const p=pad();poll(p);button(p,7,1);poll(p);expect(input.isDown('fire')).toBe(true);
  controller.onLost=()=>input.clearState();poll(null);expect(input.isDown('fire')).toBe(false);
  poll(p);expect(input.isDown('fire')).toBe(false);button(p,7,0);poll(p);button(p,7,1);poll(p);expect(input.wasPressed('fire')).toBe(true);
});
it('does not guess nonstandard mappings and ignores additional controllers',()=>{
  const p=pad(),q=pad(1);poll(p);button(q,7,1);controller.poll(.016,true,[p,q],true);expect(input.isDown('fire')).toBe(false);
  controller.release();const weird={...pad(),mapping:''} as Gamepad;controller.selected=null;controller.poll(.016,true,[weird],true);expect(controller.status).toContain('no standard mapping');
});
it('handles disconnect/reconnect between polls and changed devices reusing the same index',()=>{
  const p=pad();poll(p);button(p,7,1);poll(p);const lost=vi.fn(()=>input.clearState());controller.onLost=lost;
  win.dispatchEvent(Object.assign(new Event('gamepaddisconnected'),{gamepad:p}));expect(input.isDown('fire')).toBe(false);expect(lost).toHaveBeenCalledOnce();
  poll(p);expect(input.isDown('fire')).toBe(false);button(p,7,0);poll(p);button(p,7,1);poll(p);
  const replacement={...pad(),id:'Sony DualSense',buttons:p.buttons};poll(replacement);expect(input.isDown('fire')).toBe(false);expect(lost).toHaveBeenCalledTimes(2);
});
it('tolerates browsers that deny Gamepad API access',()=>{
  Object.assign(doc,{hasFocus:()=>true,hidden:false});vi.stubGlobal('navigator',{getGamepads:()=>{throw new Error('Permission denied');}});
  expect(()=>controller.poll(.016,false)).not.toThrow();expect(input.controllerX).toBe(0);
});
it('uses analog radial movement, suppresses drift and caps diagonal input',()=>{
  const p=pad();poll(p);p.axes[0]=.1;p.axes[1]=-.1;poll(p);expect(input.controllerX).toBe(0);
  p.axes[0]=.5;p.axes[1]=-.5;poll(p);expect(input.controllerX).toBeGreaterThan(.3);expect(input.controllerX).toBeLessThan(.5);expect(input.controllerZ).toBe(input.controllerX);
  expect(Math.hypot(...radialStick(1,1,.15))).toBeCloseTo(1);expect(radialStick(.15,0,.15)).toEqual([0,0]);expect(radialStick(NaN,0,.15)).toEqual([0,0]);
});
it('preserves grenade charge/release, combined crouch/slide and distinct zoom steps',()=>{
  const p=pad();poll(p);button(p,12,1);poll(p);expect(input.isDown('grenade')).toBe(true);input.endFrame();poll(p);expect(input.wasPressed('grenade')).toBe(false);
  button(p,12,0);poll(p);expect(input.isDown('grenade')).toBe(false);
  button(p,1,1);poll(p);expect(input.isDown('crouch')).toBe(true);button(p,1,0);poll(p);expect(input.isDown('crouch')).toBe(false);
  p.axes[1]=-1;button(p,1,1);poll(p);expect(input.isDown('slide')).toBe(true);input.endFrame();poll(p);expect(input.wasPressed('slide')).toBe(false);button(p,1,0);poll(p);expect(input.isDown('slide')).toBe(false);
  const zoom=vi.fn(()=>true);input.onWheel=zoom;button(p,15,1);poll(p);poll(p);expect(zoom).toHaveBeenCalledExactlyOnceWith(-1);
});
it('separates controller release from keyboard holds',()=>{
  const p=pad();poll(p);input.simulate('fire',true);button(p,7,1);poll(p);button(p,7,0);poll(p);expect(input.isDown('fire')).toBe(true);
  input.clearState();expect(input.isDown('fire')).toBe(false);
});
it('does not manufacture another logical trigger press when switching devices while held',()=>{
  const p=pad();poll(p);button(p,7,1);poll(p);input.endFrame();input.simulate('fire',true);
  expect(input.wasPressed('fire')).toBe(false);button(p,7,0);poll(p);expect(input.isDown('fire')).toBe(true);
});
it('has trigger hysteresis and exactly one edge per press for semi-automatic weapons',()=>{
  const p=pad();poll(p);button(p,7,.5);poll(p);expect(input.isDown('fire')).toBe(false);
  const gun=new Weapon(WEAPONS.find(w=>w.id==='semi-sniper')!);let shots=0;
  for(let i=0;i<120;i++){button(p,7,i===0?.6:i%2?.45:.6);poll(p);const events:WeaponEvent[]=[];
    // The same press edge/held pair used by the normal combat simulation.
    gun.update(1/60,{trigger:input.isDown('fire'),triggerPressed:input.wasPressed('fire'),reloadPressed:false,aim:false,moveFactor:0,airborne:false,sprinting:false},events);shots+=events.filter(e=>e.type==='fire').length;
    if(i>0)expect(input.wasPressed('fire')).toBe(false);input.endFrame();
  }
  expect(shots).toBe(1);button(p,7,.2);poll(p);input.endFrame();button(p,7,.6);poll(p);expect(input.wasPressed('fire')).toBe(true);
});
it('requires another physical trigger press after a utility modifier cancels firing',()=>{
  const p=pad();poll(p);button(p,7,1);poll(p);expect(input.isDown('fire')).toBe(true);input.endFrame();
  button(p,8,1);poll(p);expect(input.isDown('fire')).toBe(false);button(p,8,0);poll(p);
  expect(input.isDown('fire')).toBe(false);expect(input.wasPressed('fire')).toBe(false);
  button(p,7,0);poll(p);button(p,7,1);poll(p);expect(input.wasPressed('fire')).toBe(true);
});
it('keeps automatic fire under the existing weapon cooldown rules',()=>{
  const p=pad(),gun=new Weapon(WEAPONS.find(w=>w.id==='rifle')!);poll(p);button(p,7,1);let shots=0;
  for(let i=0;i<120;i++){poll(p);const events:WeaponEvent[]=[];gun.update(1/60,{trigger:input.isDown('fire'),triggerPressed:input.wasPressed('fire'),reloadPressed:false,aim:false,moveFactor:0,airborne:false,sprinting:false},events);shots+=events.filter(e=>e.type==='fire').length;input.endFrame();}
  expect(shots).toBeGreaterThan(1);expect(shots).toBeLessThanOrEqual(Math.ceil(gun.stats.rpm*2/60)+1);
});
it('returns neutral after losing focus and never resumes a held trigger without release',()=>{
  const p=pad();poll(p);button(p,7,1);poll(p);controller.poll(.016,true,[p],false);expect(input.isDown('fire')).toBe(false);
  poll(p);expect(input.isDown('fire')).toBe(false);button(p,7,0);poll(p);button(p,7,1);poll(p);expect(input.isDown('fire')).toBe(true);
});
it('cleans inputs and prevents menu selection becoming a jump/fire on entering gameplay',()=>{
  const p=pad();poll(p,false);button(p,0,1);poll(p,false);poll(p,true);expect(input.isDown('jump')).toBe(false);
  button(p,0,0);poll(p);button(p,0,1);poll(p);expect(input.isDown('jump')).toBe(true);poll(p,false);expect(input.isDown('jump')).toBe(false);
});
it('requires a neutral frame on entering menus so a held pause button cannot immediately resume',()=>{
  const p=pad(),menu=vi.fn();controller.onMenu=menu;poll(p);button(p,9,1);poll(p);expect(input.wasPressed('pause')).toBe(true);
  poll(p,false);expect(menu).not.toHaveBeenCalled();button(p,9,0);poll(p,false);expect(menu).toHaveBeenCalledOnce();
});
it('Menu remains a fixed escape route even if the custom Pause binding is cleared',()=>{
  const s=options();s.bindings.pause='';controller.dispose();controller=new Controller(input,()=>s);
  const p=pad();poll(p);button(p,9,1);poll(p);expect(input.wasPressed('pause')).toBe(true);
});
it('Back leaves Settings instead of activating the inline Cancel binding control',()=>{
  const clicked:string[]=[];
  const make=(text:string)=>({textContent:text,matches:()=>false,focus(){Object.assign(doc,{activeElement:this});},click:()=>clicked.push(text)}) as unknown as HTMLElement;
  const cancel=make('Cancel binding'),back=make('Back'),apply=make('Apply');
  Object.assign(doc,{body:{dataset:{screen:'settings'}},getElementById:()=>({contains:()=>true})});
  const menu=new ControllerMenu();vi.spyOn(menu as unknown as {candidates:()=>HTMLElement[]},'candidates').mockReturnValue([cancel,back,apply]);
  const p=pad();menu.update(p,.016);button(p,1,1);menu.update(p,.016);menu.update(p,.016);expect(clicked).toEqual(['Back']);
});
it.each(['shop','locker','leaderboard','results'])('Back navigates home from %s using existing page actions',screen=>{
  const click=vi.fn();const home={textContent:screen==='results'?'RETURN TO LOBBY':'Play',matches:(selector:string)=>selector==='.home-nav .nav-button',focus(){Object.assign(doc,{activeElement:this});},click} as unknown as HTMLElement;
  Object.assign(doc,{body:{dataset:{screen}},getElementById:()=>({contains:()=>screen==='results'})});
  const menu=new ControllerMenu();vi.spyOn(menu as unknown as {candidates:()=>HTMLElement[]},'candidates').mockReturnValue([home]);
  const p=pad();menu.update(p,.016);button(p,1,1);menu.update(p,.016);expect(click).toHaveBeenCalledOnce();
});
it('captures one input, suppresses normal menu actions, and supports modifier chords',()=>{
  const p=pad();let captured='';const menu=vi.fn();controller.onMenu=menu;poll(p,false);menu.mockClear();controller.onCapture=c=>captured=c;
  button(p,8,1);button(p,2,1);poll(p,false);poll(p,false);expect(captured).toBe('b8+b2');expect(menu).not.toHaveBeenCalled();
});
it('uses custom bindings without stealing keyboard controls and resolves duplicate layouts safely',()=>{
  const s=options();s.bindings.fire='b2';s.bindings.reload='b7';controller.dispose();controller=new Controller(input,()=>s);
  const p=pad();poll(p);button(p,2,1);poll(p);expect(input.isDown('fire')).toBe(true);expect(input.isDown('reload')).toBe(false);
  expect(controllerConflict(s.bindings,'jump','b2')).toBe('fire');expect(sanitizeController(s).bindings).toEqual(s.bindings);
  expect(sanitizeController({...s,bindings:{...s.bindings,jump:'b2'}}).bindings).toEqual(options().bindings);
});
it('persists controller draft settings, resets defaults and preserves independent settings',()=>{
  let saved='';const storage={getItem:()=>saved,setItem:(_k:string,v:string)=>{saved=v;}} as unknown as Storage;
  const store=new SettingsStore(storage),draft=new SettingsDraft(store);store.update({fov:104,masterVolume:.2});
  const s=options();s.horizontal=277;s.bindings.reload='b0';s.bindings.jump='b2';draft.set('controller',s);expect(store.value.controller.horizontal).toBe(180);
  expect(draft.dirtyKeys).toEqual(['controller']);draft.apply();const loaded=new SettingsStore(storage);expect(loaded.value.controller).toEqual(s);expect(loaded.value.fov).toBe(104);
  draft.set('controller',options());draft.apply();expect(store.value.controller).toEqual(options());expect(store.value.masterVolume).toBe(.2);draft.dispose();
});
it('has time-correct camera rates, independent axes, ADS, inversion and optional acceleration',()=>{
  const s=options();const totals=[20,30,60,144].map(fps=>{let yaw=0,pitch=0;for(let i=0;i<fps;i++){const d=controllerLook(.5,.25,1/fps,s,0);yaw+=d[0];pitch+=d[1];}return [yaw,pitch];});
  for(const t of totals){expect(t[0]).toBeCloseTo(-Math.PI/2);expect(t[1]).toBeCloseTo(-35*Math.PI/180);}
  expect(controllerLook(1,1,.02,s,1)[0]).toBeCloseTo(controllerLook(1,1,.02,s,0)[0]*s.ads);
  expect(controllerLook(0,1,.02,{...s,invertY:true},0)[1]).toBeGreaterThan(0);
  expect(Math.abs(controllerLook(1,0,.02,{...s,acceleration:1},0)[0])).toBeGreaterThan(Math.abs(controllerLook(1,0,.02,s,0)[0]));
});
it('updates input method on activity rather than continuously stealing it from the mouse',()=>{
  const p=pad();poll(p);button(p,7,1);poll(p);expect(controller.active).toBe(true);win.dispatchEvent(new Event('pointerdown'));expect(controller.active).toBe(false);
  poll(p);expect(controller.active).toBe(false);button(p,7,0);poll(p);button(p,7,1);poll(p);expect(controller.active).toBe(true);
});
it('uses identifiable labels, sensible defaults and validates saved values',()=>{
  expect(controllerFamily('Sony DualSense')).toBe('playstation');expect(controllerName('b7','playstation')).toBe('R2');expect(controllerName('b2','xbox')).toBe('X');
  expect(controllerFamily('Unknown')).toBe('generic');expect(controllerName('b0')).toBe('Button 0');
  const s=sanitizeController({horizontal:Infinity,leftDeadzone:9,ads:-5});expect(s.horizontal).toBe(180);expect(s.leftDeadzone).toBe(.4);expect(s.ads).toBe(.1);
  const b=options().bindings;expect(new Set(Object.values(b)).size).toBe(Object.keys(b).length);expect(b.grenade).toBe('b12');
});
