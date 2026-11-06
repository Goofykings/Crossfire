import {validMap,type MapId} from '../../shared/maps';
import type {MatchMode} from '../../shared/combat';
export type BotDifficulty='beginner'|'advanced'|'absurd';
export interface PracticeSetup {mapId:MapId;mode:MatchMode;bots:number;difficulty:BotDifficulty}
export const DEFAULT_PRACTICE:PracticeSetup={mapId:'european-town',mode:'ffa',bots:3,difficulty:'advanced'};
export const PRACTICE_NOTICE='Practice is offline. Kills, points, wins, challenges, and gems earned here will not count toward your account or global leaderboards.';
export function validPractice(value:unknown):value is PracticeSetup {
 if(!value||typeof value!=='object')return false;const v=value as PracticeSetup;
 return validMap(v.mapId)&&['ffa','teams'].includes(v.mode)&&Number.isInteger(v.bots)&&v.bots>=0&&v.bots<=5&&['beginner','advanced','absurd'].includes(v.difficulty);
}
/** No reward adapter/profile identity/token is accepted by the local simulation. */
export const PRACTICE_POLICY=Object.freeze({kind:'practice',rewards:false,persistStatistics:false,uploadResults:false} as const);
export const DIFFICULTY={
 beginner:{reaction:.95,error:5,speed:.62,decision:.22,turn:3.5,slide:8,retreat:18,cover:.02},
 advanced:{reaction:.32,error:1.3,speed:1,decision:.12,turn:7,slide:3.5,retreat:35,cover:.18},
 absurd:{reaction:.065,error:0,speed:1,decision:.09,turn:18,slide:.15,retreat:50,cover:.7},
} as const;
export class PracticeRandom {
 constructor(private value:number){}
 next=()=>{this.value=(this.value+0x6d2b79f5)>>>0;let x=Math.imul(this.value^(this.value>>>15),this.value|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};
 pick<T>(items:readonly T[]):T{return items[Math.floor(this.next()*items.length)];}
}
