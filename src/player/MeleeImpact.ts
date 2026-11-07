import type {MeleeStage} from '../../shared/melee';
export const MELEE_CAMERA={duration:[.1,.1,.18],roll:[-.045,.045,.075]} as const;
/** Finite optical roll only: aim and mouse/controller yaw/pitch are untouched. */
export class MeleeImpact {
 private age=1;private stage:MeleeStage=1;
 hit(stage:MeleeStage){this.stage=stage;this.age=0;}
 reset(){this.age=1;}
 update(dt:number,reduced=false):number{
  this.age+=Math.max(0,dt);const t=this.age/MELEE_CAMERA.duration[this.stage-1];
  if(t>=1||reduced)return 0;
  return MELEE_CAMERA.roll[this.stage-1]*Math.sin(Math.PI*t*(this.stage===3?2:1))*(1-t)**2*3;
 }
}
