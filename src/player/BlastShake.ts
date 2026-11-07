/** Finite cosmetic motion; never modifies player yaw/pitch or shot aim angles. */
export class BlastShake {
 private age=1;private strength=0;
 hit(damage:number){if(!Number.isFinite(damage)||damage<=0)return;this.strength=Math.max(this.strength*(1-Math.min(1,this.age/.5)),Math.min(1,damage/100));this.age=0;}
 reset(){this.age=1;this.strength=0;}
 update(dt:number,reduced=false){this.age+=Math.max(0,dt);const t=Math.min(1,this.age/.5),envelope=this.strength*(1-t)**3*Math.min(1,this.age/.018),a=reduced?0:envelope;
  if(a===0)return {x:0,y:0,roll:0};return{x:Math.sin(this.age*83)*.045*a,y:Math.sin(this.age*109+.6)*.035*a,roll:Math.sin(this.age*71)*.065*a};
 }
 inspect(){return {age:this.age,strength:this.strength};}
}
