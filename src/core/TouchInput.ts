import type {Action,Input} from './Input';
import {touchStick,type TouchSettings} from '../config/touch';

/** Source adapter only: no physics, combat timing or network behavior. */
export class TouchInput {
  private held=new Map<number,Action>();
  private move:number|null=null;private look:number|null=null;
  private lastX=0;private lastY=0;private dx=0;private dy=0;
  ads=false;
  constructor(private input:Input,private settings:()=>TouchSettings){}
  startMove(id:number){if(this.move!==null)return false;this.move=id;return true;}
  moveTo(id:number,dx:number,dy:number,radius:number){if(id!==this.move)return;[this.input.touchX,this.input.touchZ]=touchStick(dx,dy,radius,this.settings().deadzone);}
  startLook(id:number,x:number,y:number){if(this.look!==null)return false;this.look=id;this.lastX=x;this.lastY=y;return true;}
  lookTo(id:number,x:number,y:number){if(id!==this.look)return;this.dx+=x-this.lastX;this.dy+=y-this.lastY;this.lastX=x;this.lastY=y;}
  press(id:number,action:Action){if(this.held.has(id))return;this.held.set(id,action);this.input.setTouch(action,true);}
  toggleADS(){this.ads=!this.ads;this.input.setTouch('aim',this.ads);}
  end(id:number){
    if(this.move===id){this.move=null;this.input.touchX=this.input.touchZ=0;}
    if(this.look===id)this.look=null;
    const action=this.held.get(id);this.held.delete(id);
    if(action&&![...this.held.values()].includes(action))this.input.setTouch(action,false);
  }
  takeLook(ads:number){const s=this.settings(),scale=.0025*s.sensitivity*(1+(s.ads-1)*ads);const result=[this.dx*scale,this.dy*scale] as const;this.dx=this.dy=0;return result;}
  resetADS(){this.ads=false;this.input.setTouch('aim',false);}
  clear(){this.held.clear();this.move=this.look=null;this.dx=this.dy=0;this.ads=false;this.input.clearTouch();}
}
