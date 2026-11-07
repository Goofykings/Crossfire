import {SNIPER} from '../weapons/Weapon';
/** Magnification ratios derived from the previous .22 FOV scale. No accuracy effect. */
export const SNIPER_ZOOM={min:1/.22*.65,max:1/.22,default:1/SNIPER.adsFovScale,step:.25,response:16};
export class SniperZoom {
 target=SNIPER_ZOOM.default;value=this.target;
 scroll(direction:number){this.target=Math.max(SNIPER_ZOOM.min,Math.min(SNIPER_ZOOM.max,this.target+direction*SNIPER_ZOOM.step));}
 update(dt:number){this.value=this.target+(this.value-this.target)*Math.exp(-Math.max(0,dt)*SNIPER_ZOOM.response);return this.value;}
 reset(){this.value=this.target=SNIPER_ZOOM.default;}
}
