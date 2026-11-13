import {compatibleCosmetic,killEffect,type Equipment,type KillEffect} from './cosmetics';
import type {Vec3} from '../src/player/PlayerController';
export interface EliminationEffect {effect:KillEffect;cosmeticId:string;position:Vec3}
/** Called only after an authoritative alive -> dead transition. Equipment comes
 * from the validated inventory, never the attack message or a later snapshot. */
export function eliminationEffect(equipment:Equipment|undefined,weapon:string|null,position:Vec3):EliminationEffect|undefined {
 if(!equipment||!weapon||weapon==='grenade')return;
 const id=equipment[weapon as keyof Equipment];if(!compatibleCosmetic(id,weapon))return;
 const effect=killEffect(id);return effect?{effect,cosmeticId:id,position:{...position}}:undefined;
}
