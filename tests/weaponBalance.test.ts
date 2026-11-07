import {afterEach,expect,it,vi} from 'vitest';
import {RIFLE,SMG,SNIPER,SHOTGUN,Weapon,damageAt,pelletSpreadAt,rollDamage,type WeaponInput} from '../src/weapons/Weapon';
import {SniperZoom,SNIPER_ZOOM} from '../src/player/SniperZoom';
import {traceWeaponShot} from '../shared/hitscan';
import {validGun} from '../shared/protocol';
import {zoneDamage} from '../src/game/Damage';
import {PracticeRandom} from '../src/practice/config';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerController} from '../src/player/PlayerController';
import {Input} from '../src/core/Input';
const idle:WeaponInput={trigger:false,triggerPressed:false,reloadPressed:false,aim:false,moveFactor:0,airborne:false,sprinting:false};
afterEach(()=>vi.unstubAllGlobals());
it('centralizes exact rate changes, capacities and unchanged SMG damage/range',()=>{
 expect(RIFLE.rpm).toBe(700*.9);expect(new Weapon(RIFLE).fireInterval).toBeCloseTo((60/700)/.9,12);
 expect(SMG.rpm/1030).toBeCloseTo(1.09);expect(SMG.magazine).toBe(64);expect(SMG.damage).toBe(11);expect(SMG.damageRoll).toBeUndefined();expect(SMG.range).toBe(140);
 expect(SNIPER.magazine).toBe(4);expect(SNIPER.adsTime/.28).toBeCloseTo(.8);expect((1/SNIPER.adsFovScale)/(1/.22)).toBeCloseTo(.82);expect(SNIPER.recoilPitch).toBeGreaterThan(3.2*1.5);expect(SNIPER.viewKick).toBeGreaterThan(16*1.5);
 for(const stats of [SMG,SNIPER]){const w=new Weapon(stats);expect(validGun(w.capture())).toBe(true);w.ammo--;w.update(1/120,{...idle,reloadPressed:true});for(let i=0;i<480;i++)w.update(1/120,idle);expect(w.ammo).toBe(stats.magazine);expect(w.reserve).toBe(Infinity);}
 expect(validGun({...new Weapon(SMG).capture(),ammo:65})).toBe(false);
});
it('fractional cooldown carry delivers configured automatic rates without negative wire state',()=>{
 for(const stats of [RIFLE,SMG]){const w=new Weapon({...stats,magazine:1000});let shots=0;for(let i=0;i<120*10;i++){shots+=w.update(1/120,{...idle,trigger:true}).filter(e=>e.type==='fire').length;expect(w.capture().cooldown).toBeGreaterThanOrEqual(0);}expect(Math.abs(shots-stats.rpm/6)).toBeLessThanOrEqual(1);}
});
it('allows two shotgun shots in about 250 ms, preserving the two-shell/reload limit',()=>{
 const w=new Weapon(SHOTGUN);let count=w.update(1/120,{...idle,trigger:true,triggerPressed:true}).filter(e=>e.type==='fire').length;
 for(let i=0;i<12;i++)w.update(1/120,idle);expect(w.update(1/120,{...idle,trigger:true,triggerPressed:true}).some(e=>e.type==='fire')).toBe(false);
 for(let i=0;i<20;i++)w.update(1/120,idle);count+=w.update(1/120,{...idle,trigger:true,triggerPressed:true}).filter(e=>e.type==='fire').length;
 expect(count).toBe(2);expect(w.ammo).toBe(0);expect(w.reloading).toBe(true);expect(SHOTGUN.cycleTime).toBeLessThanOrEqual(60/SHOTGUN.rpm);expect(60/SHOTGUN.rpm).toBe(.25);expect(SHOTGUN.emptyReloadCycleTime).toBe(.6);
 expect(w.update(1/120,{...idle,trigger:true,triggerPressed:true}).some(e=>e.type==='fire')).toBe(false);
});
it('authoritative AR hits roll independent integer bases, with normal falloff and head multipliers',()=>{
 const world=new CollisionWorld(),p=new PlayerController(world);p.teleport({x:0,y:0,z:-3});
 for(const [random,expected]of [[0,20],[.5,21],[.999,22]]){const roll=vi.fn(()=>random),hits:number[]=[];traceWeaponShot(world,{x:0,y:1,z:0},0,0,RIFLE,0,()=>[{value:p,motion:p.capture()}],(_,h)=>hits.push(h.bodyDamage),undefined,roll);
  expect(hits).toEqual([expected]);expect(roll).toHaveBeenCalledTimes(1);expect(zoneDamage(expected,'head')).toBe(expected*1.5);expect(damageAt(RIFLE,100,expected)).toBe(expected*.75);
 }
 const miss=vi.fn(()=>0);traceWeaponShot(world,{x:5,y:1,z:0},0,0,RIFLE,0,()=>[{value:p,motion:p.capture()}],()=>{throw Error('false hit');},undefined,miss);expect(miss).not.toHaveBeenCalled();
 const rng=new PracticeRandom(43),values=new Set(Array.from({length:100},()=>rollDamage(RIFLE,rng.next)));expect([...values].sort()).toEqual([20,21,22]);
});
it('tightens only the ADS pellet cone and roughly doubles useful aimed shotgun distance',()=>{
 expect(pelletSpreadAt(SHOTGUN,0)).toBe(7);expect(pelletSpreadAt(SHOTGUN,1)/7).toBeCloseTo(.55);expect(pelletSpreadAt(SHOTGUN,.5)).toBeCloseTo((7+3.85)/2);
 const mean=(distance:number,old=false)=>{const world=new CollisionWorld(),p=new PlayerController(world);p.teleport({x:0,y:0,z:-distance});const rng=new PracticeRandom(719),stats=old?{...SHOTGUN,pelletSpreadAds:7,falloff:{start:6,end:22,minScale:.18}}:SHOTGUN;let damage=0;
  for(let i=0;i<200;i++)traceWeaponShot(world,{x:0,y:1.64,z:0},0,Math.atan2(-.74,distance),stats,stats.spreadAds,()=>[{value:p,motion:p.capture()}],(_,h)=>damage+=zoneDamage(h.bodyDamage,h.zone),undefined,rng.next,1);return damage/200;};
 const close=mean(8,true),medium=mean(16),oldMedium=mean(16,true),long=mean(40);expect(medium).toBeGreaterThan(oldMedium*2);expect(medium).toBeGreaterThan(close*.65);expect(long).toBeLessThan(medium*.3);
 expect(SHOTGUN.damage).toBe(14);expect(SHOTGUN.falloff).toEqual({start:12,end:44,minScale:.18});
});
it('bounds smooth scope zoom without changing target immediately or depending on frame rate',()=>{
 const a=new SniperZoom();expect(a.value).toBeCloseTo(1/SNIPER.adsFovScale);a.scroll(1);expect(a.value).toBe(SNIPER_ZOOM.default);expect(a.update(.02)).toBeGreaterThan(SNIPER_ZOOM.default);expect(a.value).toBeLessThan(a.target);
 for(let i=0;i<50;i++)a.scroll(1);expect(a.target).toBe(SNIPER_ZOOM.max);for(let i=0;i<50;i++)a.scroll(-1);expect(a.target).toBe(SNIPER_ZOOM.min);expect(a.target).toBeLessThan(SNIPER_ZOOM.default);
 const run=(fps:number)=>{const z=new SniperZoom();z.scroll(2);for(let i=0;i<fps;i++)z.update(1/fps);return z.value;};expect(run(30)).toBeCloseTo(run(144),12);a.reset();expect(a.value).toBe(SNIPER_ZOOM.default);
});
it('consumes scoped wheel before weapon cycling and leaves menu wheel untouched',()=>{
 vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',new EventTarget());const canvas=new EventTarget(),input=new Input(canvas as HTMLCanvasElement),wheel=()=>{const e=new Event('wheel',{cancelable:true});Object.defineProperty(e,'deltaY',{value:-100});canvas.dispatchEvent(e);return e;};
 try{const zoom=vi.fn(()=>true);input.onWheel=zoom;expect(wheel().defaultPrevented).toBe(false);input.enabled=true;expect(wheel().defaultPrevented).toBe(true);expect(zoom).toHaveBeenCalledWith(-1);expect(input.wasPressed('prevWeapon')).toBe(false);input.onWheel=()=>false;wheel();expect(input.wasPressed('prevWeapon')).toBe(true);}finally{input.dispose();}
});
