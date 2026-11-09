import {expect,it} from 'vitest';
import {RIFLE,SMG,SHOTGUN,SNIPER,SEMI_SNIPER,WEAPONS,Weapon,rollDamage,damageAt,weaponAdsFov,type WeaponInput} from '../src/weapons/Weapon';
import {DamageSystem} from '../src/game/Damage';
import {FIXED_DT} from '../src/config/constants';
import {validWeapon,validGun,parseClientMessage,PROTOCOL_VERSION} from '../shared/protocol';
import {normalizeInventory,defaultEquipment,cosmetic,compatibleCosmetic,COLLECTIONS,collectionCosmetic,validInventory} from '../shared/cosmetics';
import {sanitizeBindings,defaultBindings} from '../src/config/keybindings';
import {SETTING_LIMITS,DEFAULT_SETTINGS} from '../src/config/settings';
const idle:WeaponInput={trigger:false,triggerPressed:false,reloadPressed:false,aim:false,moveFactor:0,airborne:false,sprinting:false};
it('adds one separate marksman with exact configured limits and preserves existing weapon definitions',()=>{
 expect(WEAPONS.map(w=>w.id)).toEqual(['rifle','shotgun','sniper','smg','semi-sniper']);
 expect(SEMI_SNIPER).toMatchObject({magazine:15,mode:'semi',damageRoll:[32,35],headshotDamage:50,scope:false,cycleTime:0});
 expect(SEMI_SNIPER.rpm).toBe(RIFLE.rpm*.9);expect(SEMI_SNIPER.recoilPitch).toBeGreaterThan(RIFLE.recoilPitch);expect(SEMI_SNIPER.recoilPitch).toBeLessThan(SNIPER.recoilPitch);
 expect(SEMI_SNIPER.viewKick).toBeGreaterThan(RIFLE.viewKick);expect(SEMI_SNIPER.viewKick).toBeLessThan(SNIPER.viewKick);
 expect([RIFLE.magazine,SMG.magazine,SHOTGUN.magazine,SNIPER.magazine]).toEqual([30,64,2,4]);
});
it('consumes one bullet on a press, never repeats held fire, and requires another press after reload',()=>{
 const w=new Weapon(SEMI_SNIPER);const shots=[];
 for(let i=0;i<240;i++)shots.push(...w.update(FIXED_DT,{...idle,trigger:true,triggerPressed:i===0}));
 expect(shots.filter(e=>e.type==='fire')).toHaveLength(1);expect(w.ammo).toBe(14);
 w.update(FIXED_DT,idle);expect(w.update(FIXED_DT,{...idle,trigger:true,triggerPressed:true}).some(e=>e.type==='fire')).toBe(true);expect(w.ammo).toBe(13);
 w.update(FIXED_DT,{...idle,reloadPressed:true});expect(w.reloading).toBe(true);
 for(let i=0;i<400;i++)expect(w.update(FIXED_DT,{...idle,trigger:true}).some(e=>e.type==='fire')).toBe(false);
 expect(w.ammo).toBe(15);expect(w.reserve).toBe(Infinity);expect(w.action).toBe('idle');
 w.update(FIXED_DT,idle);expect(w.update(FIXED_DT,{...idle,trigger:true,triggerPressed:true}).some(e=>e.type==='fire')).toBe(true);
});
it('strictly caps alternating macro-like presses without fractional cooldown borrowing, preserves restore and empty reload',()=>{
 const w=new Weapon(SEMI_SNIPER),times:number[]=[];let held=false;
 for(let tick=0;tick<120*12;tick++){
  const trigger=tick%2===0,events=w.update(FIXED_DT,{...idle,trigger,triggerPressed:trigger&&!held});held=trigger;
  if(events.some(e=>e.type==='fire'))times.push(tick*FIXED_DT);
  const restored=new Weapon(SEMI_SNIPER);restored.restore(w.capture());expect(restored.capture()).toEqual(w.capture());expect(validGun(w.capture())).toBe(true);
 }
 expect(times.length).toBeGreaterThan(15);
 for(let i=1;i<times.length;i++)expect(times[i]-times[i-1]+1e-9).toBeGreaterThanOrEqual(60/SEMI_SNIPER.rpm);
 const empty=new Weapon(SEMI_SNIPER);empty.ammo=1;empty.update(FIXED_DT,{...idle,trigger:true,triggerPressed:true});expect(empty.ammo).toBe(0);expect(empty.action).toBe('reloadEmpty');
 for(let i=0;i<400;i++)empty.update(FIXED_DT,idle);expect(empty.ammo).toBe(15);
});
it('rolls all four integer body values at every valid range and replaces head damage with exactly 50',()=>{
 const damage=new DamageSystem(),body=new Set<number>(),head=new Set<number>();
 for(const distance of [0,35,100,499])for(const random of [0,.249,.25,.499,.5,.749,.75,.999999])for(const zone of ['body','head'] as const){
  const rolled=rollDamage(SEMI_SNIPER,()=>random),base=damageAt(SEMI_SNIPER,distance,rolled);
  const result=damage.tryApply({id:'shooter',position:()=>({x:0,y:0,z:0})},{id:'target',alive:true,position:()=>({x:0,y:0,z:10}),applyDamage:()=>{}},{weapon:SEMI_SNIPER.id,point:{x:0,y:1,z:10},zone,bodyDamage:base});
  expect(result.applied).toBe(true);if(result.applied)(zone==='head'?head:body).add(result.amount);
 }
 expect([...body].sort()).toEqual([32,33,34,35]);expect([...head]).toEqual([50]);
});
it('uses 1.5x AR optical magnification at minimum, default and maximum FOV without changing other projections',()=>{
 for(const fov of [SETTING_LIMITS.fov[0],DEFAULT_SETTINGS.fov,SETTING_LIMITS.fov[1]]){
  const ar=weaponAdsFov(RIFLE,fov),semi=weaponAdsFov(SEMI_SNIPER,fov),t=(degrees:number)=>Math.tan(degrees*Math.PI/360);
  expect(t(ar)/t(semi)).toBeCloseTo(1.5,12);expect(semi).toBeLessThan(ar);expect(SEMI_SNIPER.scope).toBe(false);
  for(const old of [RIFLE,SMG,SHOTGUN,SNIPER])expect(weaponAdsFov(old,fov)).toBe(fov*old.adsFovScale);
 }
});
it('registers strict selection and restores new defaults without changing old owned skins or revision',()=>{
 expect(validWeapon('semi-sniper')).toBe(true);expect(validWeapon('semi_sniper')).toBe(false);
 const spawn={v:PROTOCOL_VERSION,type:'spawn',weapon:'semi-sniper',roundId:0,mapVersion:'test',requestId:'test'};
 expect(parseClientMessage(JSON.stringify(spawn))).toEqual(spawn);expect(parseClientMessage(JSON.stringify({...spawn,damage:1000}))).toBeNull();
 const old=normalizeInventory({revision:7,owned:['rich-rifle'],equipped:{...defaultEquipment(),rifle:'rich-rifle'}});
 expect(old.revision).toBe(7);expect(old.equipped.rifle).toBe('rich-rifle');expect(old.owned).toContain('default-semi-sniper');expect(old.equipped['semi-sniper']).toBe('default-semi-sniper');expect(validInventory({...old,version:1,serverTime:0})).toBe(true);
 const original=cosmetic('default-semi-sniper')!;expect(original).toMatchObject({rarity:'common',ownership:'starter',asset:{model:'assets/models/shared/weapons/semi_sniper.glb'}});
 for(const family of COLLECTIONS){const skin=cosmetic(collectionCosmetic(family.id,'semi-sniper'))!;expect(compatibleCosmetic(skin.id,'semi-sniper')).toBe(true);expect(skin.asset.materials?.gun_gold).toBeDefined();}
});
it('migrates the fifth key without resetting existing customized bindings or stealing a saved key',()=>{
 const bindings=defaultBindings();delete (bindings as Partial<typeof bindings>).weapon5;bindings.reload=['KeyF'];bindings.weapon1=['Digit5'];
 const result=sanitizeBindings(bindings);expect(result.reload).toEqual(['KeyF']);expect(result.weapon1).toEqual(['Digit5']);expect(result.weapon5).toEqual(['Numpad5']);
});
