/** Scene-only grading. HUD and team contour colors are composited afterwards. */
const anchors=[ [0,.05],[.01,.05],[.1,.1],[.25,.3],[.5,.65],[.75,.9],[1,1] ];
export function healthSaturation(health:number,max=100):number {
 if(!Number.isFinite(health)||!Number.isFinite(max)||max<=0)return 1;
 const h=Math.max(0,Math.min(1,health/max));
 for(let i=1;i<anchors.length;i++)if(h<=anchors[i][0]){
  const [a,x]=anchors[i-1],[b,y]=anchors[i],t=(h-a)/(b-a),smooth=t*t*(3-2*t);
  return x+(y-x)*smooth;
 }
 return 1;
}
export class HealthSaturation {
 value=1;private life='';
 reset():number {this.life='';return this.value=1;}
 update(dt:number,health:number,max:number,active:boolean,life:string):number {
  if(!active)return this.reset();
  if(life!==this.life){this.life=life;return this.value=1;}
  const target=healthSaturation(health,max);
  this.value+=(target-this.value)*(1-Math.exp(-8*Math.max(0,dt)));
  if(Math.abs(this.value-target)<.0001)this.value=target;
  return this.value;
 }
}
