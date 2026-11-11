import type { WeaponId } from '../src/weapons/Weapon';

export const COSMETICS_API_VERSION = 1;
export type CosmeticCategory=WeaponId|'melee';
export const GUN_CATEGORIES:readonly WeaponId[]=['rifle','smg','sniper','shotgun','semi-sniper'];
export const WEAPON_CATEGORIES: readonly CosmeticCategory[] = [...GUN_CATEGORIES,'melee'];
export const CATEGORY_NAMES: Record<CosmeticCategory, string> = { rifle:'AR', smg:'SMG', sniper:'SNIPER', shotgun:'SHOTGUN','semi-sniper':'SEMI-AUTO SNIPER',melee:'MELEE' };
export const RARITIES = {
  common:{name:'Common',color:'#b7bec9',background:'#454a53'},
  uncommon:{name:'Uncommon',color:'#70cb8c',background:'#254c36'},
  rare:{name:'Rare',color:'#78afff',background:'#263f66'},
  epic:{name:'Epic',color:'#ed7b82',background:'#622b34'},
  legendary:{name:'Legendary',color:'#eac567',background:'#61502a'},
} as const;
export type Rarity = keyof typeof RARITIES;
export interface CosmeticMaterial {
  color?:string; metallic?:number; roughness?:number;
  albedo?:string; normal?:string; orm?:string;
  /** Metres per texture repeat (weapon UVs are authored in metres). */
  tile?:number;
  /** Optional emissive map; emissiveColor scales it. scroll moves it in repeats per second. */
  emissive?:string; emissiveColor?:string; scroll?:readonly [number,number];
  /** Optional glossy top coat intensity 0..1 (polished stone, lacquer, gold). */
  clearcoat?:number;
  /** Drop the source material's own maps (albedo, normal, ORM): a flat, featureless surface. */
  plain?:boolean;
  /** GPU effect layered on the PBR material by the shared SkinFx plugin (src/rendering/SkinFx.ts). */
  fx?:SkinFx;
}
/** One shader plugin, three modes; a skin only supplies parameters.
 * flow: animated marbling. `map` is the shared flow field, `ramp` the variant's periodic colour
 *   ramp, `tile` metres per repeat, `bands` ramp cycles across the field, `speed` scales the drift.
 * frost: snow above `line` (metres, gun space, +y up) and on upward faces; `wave` is the amplitude
 *   of the wavy snow edge in metres.
 * shade: near-black silhouette with a faint view-dependent edge sheen of strength `rim`. */
export type SkinFx =
  | {type:'flow';map:string;ramp:string;tile:number;bands:number;speed:number}
  | {type:'frost';map:string;line:number;wave:number}
  | {type:'shade';rim:number};
export interface CosmeticDefinition {
  id:string; name:string; weapon:CosmeticCategory; rarity:Rarity;
  asset:{ model:string; secondaryModel?:string; binding:'shared'|'embedded'; materials?:Record<string,CosmeticMaterial>;
    /** Decorative icicle placements (JSON from blender/cosmetics/icicle_design.py), built by src/rendering/Icicles.ts. */
    icicles?:string };
  preview?:string;
  ownership:'starter'|'grant'; compatibleWith:readonly CosmeticCategory[];
  /** Skin family shared by all four weapon versions; every crate item has one. */
  collection?:string;
}
export type KillEffect = 'money';
/** Cosmetic particles when the weapon fires (src/weapons/SnowBurst.ts). */
export type FireEffect = 'snow';
export interface CosmeticCollection { id:string; name:string; rarity:Rarity; killEffect?:KillEffect; fireEffect?:FireEffect; finish:Record<string,CosmeticMaterial>;
  /** Dagger finish; without it daggers take the gun_black/gun_steel finish on their coat and blades. */
  melee?:Record<string,CosmeticMaterial>;
  /** Categories this family covers (default: every category). */
  weapons?:readonly CosmeticCategory[];
  /** Guns get decorative icicles (asset.icicles). */
  icicles?:boolean }
export const defaultCosmetic = (weapon:CosmeticCategory):string => `default-${weapon}`;
const skin = (family:string,file:string) => `assets/cosmetics/skins/${family}/${file}`;
const camo = (id:string):Record<string,CosmeticMaterial> => {
  const body:CosmeticMaterial = {color:'#ffffff',albedo:skin(id,'albedo.jpg'),orm:skin(id,'orm.png'),tile:.34,metallic:1,roughness:1};
  return {gun_black:body,gun_fde:body,gun_wood:body};
};
/** Six crate families. A finish key applies only where that weapon's GLB has the material;
 * unnamed materials (grips, rubber, glass) keep their original look. Visual only. */
export const COLLECTIONS: readonly CosmeticCollection[] = [
  {id:'green-camo',name:'Green Camo',rarity:'uncommon',finish:camo('green-camo')},
  {id:'blue-camo',name:'Blue Camo',rarity:'uncommon',finish:camo('blue-camo')},
  {id:'red-camo',name:'Red Camo',rarity:'uncommon',finish:camo('red-camo')},
  {id:'marble',name:'Marble',rarity:'rare',finish:(()=>{
    const white:CosmeticMaterial={color:'#ffffff',albedo:skin('marble','white-albedo.jpg'),orm:skin('marble','orm.png'),tile:.3,metallic:1,roughness:1,clearcoat:.6};
    return {gun_black:white,gun_fde:white,gun_wood:white,gun_polymer:{...white,albedo:skin('marble','black-albedo.jpg')},gun_steel:{color:'#e6dfd2',metallic:1,roughness:.24}};
  })()},
  {id:'rainbow-glow',name:'Rainbow Glow',rarity:'rare',finish:(()=>{
    const glow:CosmeticMaterial={color:'#ffffff',albedo:skin('rainbow-glow','albedo.jpg'),orm:skin('rainbow-glow','orm.png'),emissive:skin('rainbow-glow','emissive.jpg'),emissiveColor:'#ffffff',scroll:[.16,0],tile:.5,metallic:1,roughness:1};
    return {gun_black:glow,gun_fde:glow,gun_wood:glow,gun_polymer:{color:'#15131d',metallic:.2,roughness:.3}};
  })()},
  {id:'rich',name:'Rich',rarity:'legendary',killEffect:'money',finish:(()=>{
    const gold:CosmeticMaterial={color:'#ffffff',albedo:skin('rich','gold-albedo.jpg'),normal:skin('rich','gold-normal.png'),orm:skin('rich','gold-orm.png'),tile:.12,metallic:1,roughness:1,clearcoat:.35};
    return {gun_black:gold,gun_fde:gold,gun_wood:gold,gun_polymer:{color:'#ffffff',albedo:skin('rich','lacquer-albedo.jpg'),orm:skin('rich','lacquer-orm.png'),tile:.12,metallic:1,roughness:1,clearcoat:.8},gun_steel:{color:'#f5b040',metallic:1,roughness:.3}};
  })()},
];
const FLOW=skin('fx','flow.png');
const bodyFinish = (m:CosmeticMaterial):Record<string,CosmeticMaterial> => ({gun_black:m,gun_fde:m,gun_wood:m});
const hydro = (variant:string):Record<string,CosmeticMaterial> => {
  // Dipped film over the gun's own surface: the source normal and ORM maps stay, only the colour flows.
  const dip:CosmeticMaterial={color:'#ffffff',metallic:.12,roughness:.52,clearcoat:.45,fx:{type:'flow',map:FLOW,ramp:skin('hydro-dip',`${variant}-ramp.png`),tile:.4,bands:2.4,speed:.55}};
  return {...bodyFinish(dip),gun_steel:dip,gun_polymer:{color:'#0d0d12',metallic:.1,roughness:.5}};
};
/** 2026-11-10 skins. Catalogued and renderable everywhere (first person, characters, Locker,
 * reveal), but NOT in the crate pool: how they are obtained is a separate backend task, so
 * `crateItems`/`drawCrate` and the published odds are unchanged. Hydro Dip variants are three
 * independent families sharing one shader configuration. */
export const EXTRA_COLLECTIONS: readonly CosmeticCollection[] = [
  {id:'blossom',name:'Blossom',rarity:'uncommon',weapons:GUN_CATEGORIES,
    finish:bodyFinish({color:'#ffffff',albedo:skin('blossom','albedo.jpg'),orm:skin('blossom','orm.png'),tile:.3,metallic:1,roughness:1,clearcoat:.3})},
  {id:'carbon-fiber',name:'Carbon Fiber',rarity:'rare',weapons:GUN_CATEGORIES,finish:{
    ...bodyFinish({color:'#ffffff',albedo:skin('carbon-fiber','albedo.jpg'),normal:skin('carbon-fiber','normal.png'),orm:skin('carbon-fiber','orm.png'),tile:.115,metallic:1,roughness:1,clearcoat:.7}),
    gun_polymer:{color:'#0b0c0e',metallic:.1,roughness:.55},gun_steel:{color:'#3a3d44',metallic:1,roughness:.34}}},
  {id:'hydro-nebula',name:'Hydro Dip — Nebula',rarity:'epic',weapons:GUN_CATEGORIES,finish:hydro('nebula')},
  {id:'hydro-inferno',name:'Hydro Dip — Inferno',rarity:'epic',weapons:GUN_CATEGORIES,finish:hydro('inferno')},
  {id:'hydro-abyss',name:'Hydro Dip — Abyss',rarity:'epic',weapons:GUN_CATEGORIES,finish:hydro('abyss')},
  {id:'darkness',name:'Darkness',rarity:'epic',finish:(()=>{
    // A shadow in the weapon's shape: no maps, almost no reflection; the edge sheen keeps it
    // readable on dark backgrounds. Not emissive.
    const shadow:CosmeticMaterial={color:'#010101',metallic:0,roughness:1,plain:true,fx:{type:'shade',rim:.04}};
    return {...bodyFinish(shadow),gun_steel:shadow,gun_polymer:shadow,gun_rubber:shadow};
  })(),melee:(()=>{
    const shadow:CosmeticMaterial={color:'#010101',metallic:0,roughness:1,plain:true,fx:{type:'shade',rim:.04}};
    return {dagger_coat:shadow,dagger_steel:shadow,dagger_metal:shadow,dagger_grip:shadow,dagger_accent:shadow};
  })()},
  {id:'frosted',name:'Frosted',rarity:'legendary',fireEffect:'snow',icicles:true,weapons:GUN_CATEGORIES,finish:(()=>{
    const map=(set:string):CosmeticMaterial=>({color:'#ffffff',albedo:skin('frosted',`${set}-albedo.jpg`),normal:skin('frosted',`${set}-normal.png`),orm:skin('frosted',`${set}-orm.png`),tile:.2,metallic:1,roughness:1});
    // `line` is filled in per weapon from FROST_LINE.
    const ice:CosmeticMaterial={...map('ice'),clearcoat:.25,fx:{type:'frost',map:FLOW,line:0,wave:.011}};
    return {...bodyFinish(ice),gun_steel:map('snow'),gun_polymer:map('snow')};
  })()},
];
export const ALL_COLLECTIONS: readonly CosmeticCollection[] = [...COLLECTIONS,...EXTRA_COLLECTIONS];
/** Height (metres, gun space) where Frosted's snow cap begins: just under each gun's top edge. */
export const FROST_LINE:Record<WeaponId,number> = {rifle:.068,smg:.086,sniper:.039,shotgun:.063,'semi-sniper':.07};
/** Material names each original GLB actually uses (tools/verify-cosmetics.mjs checks them). */
export const WEAPON_MATERIALS:Record<CosmeticCategory,readonly string[]> = {
  melee:['dagger_coat','dagger_steel','dagger_metal','dagger_grip','dagger_accent'], rifle:['gun_fde','gun_polymer','gun_black','gun_steel','gun_rubber'], smg:['gun_white','gun_steel','gun_polymer','gun_black','gun_rubber'],
  sniper:['gun_green','gun_steel','gun_black','gun_polymer','gun_rubber'], 'semi-sniper':['gun_gold','gun_black','gun_polymer','gun_steel','gun_rubber'], shotgun:['gun_wood','gun_polymer','gun_steel','gun_black','gun_rubber'],
};
/** Default-only body colours take a family's body finish: a skin never shows a default paint
 * underneath (the semi-sniper's gold, the SMG's white receiver, the sniper's olive chassis). */
const MATERIAL_ALIAS:Record<string,readonly string[]> = {gun_gold:['gun_fde','gun_black'],gun_white:['gun_black'],gun_green:['gun_black']};
function finishFor(c:CosmeticCollection,weapon:CosmeticCategory):Record<string,CosmeticMaterial> {
  if(weapon==='melee')return c.melee??{'dagger_coat':c.finish.gun_black,'dagger_steel':c.finish.gun_steel??c.finish.gun_black};
  return Object.fromEntries(WEAPON_MATERIALS[weapon].flatMap((name):[string,CosmeticMaterial][]=>{
    const m=c.finish[name]??MATERIAL_ALIAS[name]?.map(alias=>c.finish[alias]).find(Boolean);if(!m)return [];
    return [[name,m.fx?.type==='frost'?{...m,fx:{...m.fx,line:FROST_LINE[weapon]}}:m]];
  }));
}
export const collectionCosmetic = (family:string,weapon:CosmeticCategory):string => `${family}-${weapon}`;
const modelFile = (weapon:CosmeticCategory) => weapon==='semi-sniper'?'semi_sniper':weapon;
/** Explicit definitions, never inferred from filenames. Crate items are granted only by the server draw. */
export const COSMETICS: readonly CosmeticDefinition[] = [
  ...WEAPON_CATEGORIES.map((weapon):CosmeticDefinition=>({
    id:defaultCosmetic(weapon),name:weapon==='melee'?'Default Daggers':'Default',weapon,rarity:'common',
    asset:weapon==='melee'?{model:'assets/models/shared/melee/dagger_r.glb',secondaryModel:'assets/models/shared/melee/dagger_l.glb',binding:'embedded'}:{model:`assets/models/shared/weapons/${modelFile(weapon)}.glb`,binding:'shared'},
    ...(weapon==='melee'?{preview:'assets/models/shared/melee/daggers-thumbnail.png'}:weapon==='semi-sniper'?{preview:'assets/models/shared/weapons/semi_sniper-thumbnail.png'}:{}),
    ownership:'starter',compatibleWith:[weapon],
  })),
  ...ALL_COLLECTIONS.flatMap(c=>(c.weapons??WEAPON_CATEGORIES).map((weapon):CosmeticDefinition=>({
    id:collectionCosmetic(c.id,weapon),name:c.name,weapon,rarity:c.rarity,
    asset:{...(weapon==='melee'?{model:'assets/models/shared/melee/dagger_r.glb',secondaryModel:'assets/models/shared/melee/dagger_l.glb',binding:'embedded' as const}:{model:`assets/models/shared/weapons/${modelFile(weapon)}.glb`,binding:'shared' as const}),
      materials:finishFor(c,weapon),
      ...(c.icicles&&weapon!=='melee'?{icicles:skin(c.id,`icicles-${modelFile(weapon)}.json`)}:{})},
    ownership:'grant',compatibleWith:[weapon],collection:c.id,
  }))),
];
export const collection = (id:unknown):CosmeticCollection|undefined => ALL_COLLECTIONS.find(c=>c.id===id);
export const cosmetic = (id:unknown):CosmeticDefinition|undefined => typeof id==='string'?COSMETICS.find(c=>c.id===id):undefined;
export const compatibleCosmetic = (id:unknown,weapon:unknown):boolean => {
  const item=cosmetic(id);return !!item&&item.weapon===weapon&&item.compatibleWith.includes(weapon as CosmeticCategory);
};
/** Unknown future visual IDs degrade to Default; known cross-category IDs are invalid.
 * Server ownership/equip validation always uses the actual catalog instead. */
export function validCosmeticReference(id:unknown,weapon:unknown):boolean {
  return typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)&&WEAPON_CATEGORIES.includes(weapon as CosmeticCategory)
    &&(!cosmetic(id)||compatibleCosmetic(id,weapon));
}
export type Equipment = Record<CosmeticCategory,string>;
export const defaultEquipment = ():Equipment => Object.fromEntries(WEAPON_CATEGORIES.map(w=>[w,defaultCosmetic(w)])) as Equipment;
export interface CosmeticInventory { revision:number; owned:string[]; equipped:Equipment }
export interface InventoryView extends CosmeticInventory { version:number; serverTime:number }
/** Server-only migration rules: restore starters; never read client ownership claims. */
export function normalizeInventory(saved?:Partial<CosmeticInventory>):CosmeticInventory {
  const owned=[...new Set([...WEAPON_CATEGORIES.map(defaultCosmetic),...(Array.isArray(saved?.owned)?saved.owned.filter(id=>!!cosmetic(id)):[])])];
  const equipped=defaultEquipment();
  for(const w of WEAPON_CATEGORIES){const id=saved?.equipped?.[w];if(owned.includes(id??'')&&compatibleCosmetic(id,w))equipped[w]=id!;}
  return {revision:Number.isSafeInteger(saved?.revision)&&saved!.revision!>=0?saved!.revision!:0,owned,equipped};
}
export function validInventory(x:unknown):x is InventoryView {
  if(!x||typeof x!=='object'||Array.isArray(x))return false;const v=x as InventoryView;
  return Object.keys(v).every(k=>['version','serverTime','revision','owned','equipped'].includes(k))&&v.version===COSMETICS_API_VERSION
    &&Number.isSafeInteger(v.serverTime)&&v.serverTime>=0&&Number.isSafeInteger(v.revision)&&v.revision>=0
    &&Array.isArray(v.owned)&&v.owned.length<=1000&&v.owned.every(id=>!!cosmetic(id))&&new Set(v.owned).size===v.owned.length
    &&!!v.equipped&&Object.keys(v.equipped).length===WEAPON_CATEGORIES.length&&WEAPON_CATEGORIES.every(w=>v.owned.includes(defaultCosmetic(w))&&v.owned.includes(v.equipped[w])&&compatibleCosmetic(v.equipped[w],w));
}
export const killEffect = (id:unknown):KillEffect|undefined => collection(cosmetic(id)?.collection)?.killEffect;
export const fireEffect = (id:unknown):FireEffect|undefined => collection(cosmetic(id)?.collection)?.fireEffect;
/** Server-authoritative crate. No Epic family exists yet; its share went to the others. */
export const CRATE = {price:250,available:true,distribution:[
  {rarity:'uncommon',percent:55},{rarity:'rare',percent:40},{rarity:'legendary',percent:5},
]} as const;
export const crateItems = ():CosmeticDefinition[] => COSMETICS.filter(c=>c.ownership==='grant'&&COLLECTIONS.some(f=>f.id===c.collection));
/** Never repeats an owned item: weights renormalize over rarities that still have unowned
 * items. `random` returns [0,1) (crypto on the server). Undefined once everything is owned. */
export function drawCrate(owned:readonly string[],random:()=>number):CosmeticDefinition|undefined {
  const pool=crateItems().filter(c=>!owned.includes(c.id));
  const tiers=CRATE.distribution.filter(d=>pool.some(c=>c.rarity===d.rarity));if(!tiers.length)return undefined;
  let roll=random()*tiers.reduce((n,d)=>n+d.percent,0),tier:typeof tiers[number]=tiers[tiers.length-1];
  for(const d of tiers){if(roll<d.percent){tier=d;break;}roll-=d.percent;}
  const items=pool.filter(c=>c.rarity===tier.rarity);return items[Math.min(items.length-1,Math.floor(random()*items.length))];
}
export interface CrateResult { version:number; item:string; gems:number; inventory:InventoryView }
export function validCrateResult(x:unknown):x is CrateResult {
  if(!x||typeof x!=='object'||Array.isArray(x))return false;const v=x as CrateResult;
  return Object.keys(v).every(k=>['version','item','gems','inventory'].includes(k))&&v.version===COSMETICS_API_VERSION
    &&crateItems().some(c=>c.id===v.item)&&Number.isSafeInteger(v.gems)&&v.gems>=0&&validInventory(v.inventory)&&v.inventory.owned.includes(v.item);
}
