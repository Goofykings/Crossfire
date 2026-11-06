import type { WeaponId } from '../src/weapons/Weapon';

export const COSMETICS_API_VERSION = 1;
export const WEAPON_CATEGORIES: readonly WeaponId[] = ['rifle', 'smg', 'sniper', 'shotgun'];
export const CATEGORY_NAMES: Record<WeaponId, string> = { rifle:'AR', smg:'SMG', sniper:'SNIPER', shotgun:'SHOTGUN' };
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
}
export interface CosmeticDefinition {
  id:string; name:string; weapon:WeaponId; rarity:Rarity;
  asset:{ model:string; binding:'shared'|'embedded'; materials?:Record<string,CosmeticMaterial> };
  preview?:string;
  ownership:'starter'|'grant'; compatibleWith:readonly WeaponId[];
}
export const defaultCosmetic = (weapon:WeaponId):string => `default-${weapon}`;
/** Explicit definitions, never inferred from filenames. New SKUs need a trusted grant. */
export const COSMETICS: readonly CosmeticDefinition[] = WEAPON_CATEGORIES.map(weapon=>({
  id:defaultCosmetic(weapon),name:'Default',weapon,rarity:'common',
  asset:{model:`assets/models/shared/weapons/${weapon}.glb`,binding:'shared'},
  ownership:'starter',compatibleWith:[weapon],
}));
export const cosmetic = (id:unknown):CosmeticDefinition|undefined => typeof id==='string'?COSMETICS.find(c=>c.id===id):undefined;
export const compatibleCosmetic = (id:unknown,weapon:unknown):boolean => {
  const item=cosmetic(id);return !!item&&item.weapon===weapon&&item.compatibleWith.includes(weapon as WeaponId);
};
/** Unknown future visual IDs degrade to Default; known cross-category IDs are invalid.
 * Server ownership/equip validation always uses the actual catalog instead. */
export function validCosmeticReference(id:unknown,weapon:unknown):boolean {
  return typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)&&WEAPON_CATEGORIES.includes(weapon as WeaponId)
    &&(!cosmetic(id)||compatibleCosmetic(id,weapon));
}
export type Equipment = Record<WeaponId,string>;
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
    &&!!v.equipped&&Object.keys(v.equipped).length===4&&WEAPON_CATEGORIES.every(w=>v.owned.includes(defaultCosmetic(w))&&v.owned.includes(v.equipped[w])&&compatibleCosmetic(v.equipped[w],w));
}
export const FUTURE_CRATE = {price:300,available:false,distribution:[
  {rarity:'uncommon',percent:50},{rarity:'rare',percent:37},{rarity:'epic',percent:10},{rarity:'legendary',percent:3},
]} as const;
