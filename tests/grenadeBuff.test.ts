import {expect,it} from 'vitest';
import {GRENADE,blastDamage,grenadeKnockback,GRENADE_FX} from '../shared/grenades';
import {CollisionWorld} from '../src/physics/CollisionWorld';
import {PlayerController,NO_INTENT} from '../src/player/PlayerController';
import {BlastShake} from '../src/player/BlastShake';
import {GrenadeCharge} from '../shared/grenadeCharge';
const floor=()=>{const w=new CollisionWorld();w.add({c:[0,-.5,0],h:[30,.5,30]});return w;};
it('at least doubles the previous curve everywhere within the previous radius and tapers smoothly to zero',()=>{
 const w=floor(),m=new PlayerController(w).capture(),origin={x:0,y:.065,z:0};let previous=Infinity;
 for(let x=0;x<=5.2;x+=.01){m.position.x=x;const damage=blastDamage(w,origin,m);expect(damage).toBeLessThanOrEqual(previous+1e-9);previous=damage;
  if(x<4.2){const t=Math.max(0,Math.min(1,(x-.65)/(4.2-.65))),old=100*(1-t*t*(3-2*t))**1.15;expect(damage+1e-8).toBeGreaterThanOrEqual(old*2);}
 }
 m.position.x=GRENADE.damageRadius;expect(blastDamage(w,origin,m)).toBe(0);m.position.x=2;expect(blastDamage(w,origin,m)).toBeGreaterThan(100);m.position.x=5.19;expect(blastDamage(w,origin,m)).toBeLessThan(.01);
});
it.each([30,60,144])('damage-scaled impulse uses ordinary collision, settles and replays at %s FPS',fps=>{
 const w=floor();w.add({c:[2,1.5,0],h:[.04,1.5,10]});const p=new PlayerController(w);p.teleport({x:1,y:0,z:0});grenadeKnockback(p,{x:0,y:.065,z:0},90);
 const peer=new PlayerController(w);peer.restore(p.capture());expect(p.velocity.x).toBeGreaterThan(6);expect(p.velocity.y).toBeGreaterThan(2);
 let acc=0;for(let frame=0;frame<fps*2;frame++){acc+=1/fps;while(acc>=1/120){p.fixedUpdate(1/120,NO_INTENT);peer.fixedUpdate(1/120,NO_INTENT);acc-=1/120;}expect(p.position.x).toBeLessThan(1.63);expect(p.position.y).toBeGreaterThanOrEqual(0);}
 expect(p.capture()).toEqual(peer.capture());expect(p.grounded).toBe(true);expect(p.horizontalSpeed).toBe(0);
 const weak=new PlayerController(floor());weak.teleport({x:1,y:0,z:0});grenadeKnockback(weak,{x:0,y:0,z:0},10);expect(weak.velocity.x).toBeLessThan(1);for(let i=0;i<10;i++)grenadeKnockback(weak,{x:0,y:0,z:0},100);expect(weak.horizontalSpeed).toBeLessThanOrEqual(GRENADE.maxKnockbackSpeed);
});
it('camera shake is damage-scaled, bounded under refresh, reduced-motion safe and ends at exact neutral',()=>{
 const peak=(damage:number)=>{const s=new BlastShake();s.hit(damage);return Math.abs(s.update(.025).roll);};expect(peak(90)).toBeGreaterThan(peak(30)*2.9);
 const s=new BlastShake();for(let i=0;i<50;i++)s.hit(100);expect(s.inspect().strength).toBe(1);expect(s.update(.025,true)).toEqual({x:0,y:0,roll:0});expect(s.update(.5)).toEqual({x:0,y:0,roll:0});
});
it('begins interpolating immediately but authorizes only credited charge and releases exactly once at 1.1s',()=>{
 const c=new GrenadeCharge();c.update(true,1000,1/120,true);expect(c.active).toBe(true);expect(c.presentationProgress(1004)).toBeGreaterThan(0);expect(c.progress(1004)).toBe(0);
 for(let n=1;n<=132;n++)c.update(true,1000+n*1000/120,1/120,true);expect(c.progress(2100)).toBeCloseTo(1);expect(c.update(false,2100,1/120,true)).toBeCloseTo(1);expect(c.update(false,2101,1/120,true)).toBeNull();expect(GRENADE.chargeMs).toBe(1100);expect(GRENADE_FX.debris).toBe(18*3);
});
