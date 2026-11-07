import { MOVEMENT } from '../src/config/constants';
import type { Collider, CollisionWorld } from '../src/physics/CollisionWorld';
import type { ControllerState, Vec3, PlayerController } from '../src/player/PlayerController';

/** Metres, seconds and HP. One shared balance definition for server and HUD. */
export const GRENADE = Object.freeze({ perLife: 1, radius: .065, fuseMs: 2000, speed: 15.6,
  lift: 1.5, gravity: MOVEMENT.gravity, restitution: .42, friction: .68, damage: 200, damageRadius: 5.2, lethalRadius: .65, falloffPower: 1.15,
  chargeMs: 1100, minSpeed: 3.2, maxSpeed: 24.5,
  knockbackSpeed: 8, knockbackLift: 3, maxKnockbackSpeed: 12 });
/** Presentation/history only; independent of blast damage and physics. */
export const GRENADE_SMOKE_MS = 7000;
export const GRENADE_SMOKE_DENSE_MS = 5000;
/** Cosmetics only: 25% less cloud volume/density, three times the old 18 dirt puffs. */
export const GRENADE_FX=Object.freeze({smokeVolume:.75,smokeDensity:.75,debris:54,reducedDebris:27,chromebookDebris:12,particleBudget:256});

/** Applied only after confirmed damage. Normal controller substeps, wall sliding,
 * floors, ceilings and snapshot reconciliation handle the resulting velocity. */
export function grenadeKnockback(player:PlayerController,origin:Vec3,damage:number):void{
 if(!Number.isFinite(damage)||damage<=0)return;
 const strength=Math.min(1,damage/100),dx=player.position.x-origin.x,dz=player.position.z-origin.z,n=Math.hypot(dx,dz);
 const v=player.velocity;if(n>.001){v.x+=dx/n*GRENADE.knockbackSpeed*strength;v.z+=dz/n*GRENADE.knockbackSpeed*strength;}
 const speed=Math.hypot(v.x,v.z);if(speed>GRENADE.maxKnockbackSpeed){v.x*=GRENADE.maxKnockbackSpeed/speed;v.z*=GRENADE.maxKnockbackSpeed/speed;}
 v.y=Math.min(player.cfg.jumpSpeed,Math.max(0,v.y)+GRENADE.knockbackLift*strength);player.grounded=false;
 if(player.sliding){player.slideRemaining=0;player.slideCooldown=player.cfg.slideCooldown;}
}
export interface GrenadeState {
  id: string; ownerId: string; ownerLife: number; roundId: number;
  at: number; explodeAt: number; updatedAt: number; position: Vec3; velocity: Vec3;
}
export interface BlastHit { id: string; life: number; amount: number; health: number; killed: boolean; direction: Vec3 }
export interface GrenadeExplosion {
  id: string; grenadeId: string; ownerId: string; ownerLife: number; roundId: number; at: number; position: Vec3; hits: BlastHit[];
}
export type GrenadeEvent = { kind: 'throw'; id: string; projectile: GrenadeState }
  | { kind: 'bounce'; id: string; grenadeId: string; roundId: number; at: number; position: Vec3; strength: number }
  | ({ kind: 'explode' } & GrenadeExplosion);

/** Swept sphere against the existing OBB grid. Expanded slabs conservatively
 * round box corners; continuous sweeps cannot tunnel through thin walls. */
export function sweepSphere(world: CollisionWorld, start: Vec3, delta: Vec3, radius: number, halfHeight = radius, accept?: (c:Collider)=>boolean) {
  let best: { fraction: number; normal: Vec3 } | null = null;
  for (const c of world.query(Math.min(start.x,start.x+delta.x)-radius,Math.min(start.y,start.y+delta.y)-halfHeight,
    Math.min(start.z,start.z+delta.z)-radius,Math.max(start.x,start.x+delta.x)+radius,
    Math.max(start.y,start.y+delta.y)+halfHeight,Math.max(start.z,start.z+delta.z)+radius)) {
    if (!c.solid || (accept&&!accept(c))) continue;
    const x=start.x-c.cx,z=start.z-c.cz;
    const o=[x*c.cos-z*c.sin,start.y-c.cy,x*c.sin+z*c.cos];
    const d=[delta.x*c.cos-delta.z*c.sin,delta.y,delta.x*c.sin+delta.z*c.cos];
    const h=[c.hx+radius,c.hy+halfHeight,c.hz+radius];
    let near=-Infinity,far=Infinity,axis=0,sign=0,miss=false;
    for(let i=0;i<3;i++) {
      if(Math.abs(d[i])<1e-12){if(Math.abs(o[i])>h[i])miss=true;continue;}
      let a=(-h[i]-o[i])/d[i],b=(h[i]-o[i])/d[i],s=-1;
      if(a>b){[a,b]=[b,a];s=1;}
      if(a>near){near=a;axis=i;sign=s;}far=Math.min(far,b);
    }
    if(miss||near>far||far<0||near>1||near<-.00001)continue;
    const fraction=Math.max(0,near);
    if(best&&best.fraction<=fraction)continue;
    const nx=axis===0?sign:0,nz=axis===2?sign:0;
    best={fraction,normal:{x:nx*c.cos+nz*c.sin,y:axis===1?sign:0,z:-nx*c.sin+nz*c.cos}};
  }
  return best;
}

export function throwGrenade(world: CollisionWorld, eye: Vec3, bodyEye: Vec3, direction: Vec3,
  inherited: Vec3, data: Pick<GrenadeState,'id'|'ownerId'|'ownerLife'|'roundId'|'at'>, charge?: number): GrenadeState | null {
  if(world.pointInside(eye.x,eye.y,eye.z)||world.pointInside(bodyEye.x,bodyEye.y,bodyEye.z))return null;
  const toEye={x:eye.x-bodyEye.x,y:eye.y-bodyEye.y,z:eye.z-bodyEye.z};
  if(sweepSphere(world,bodyEye,toEye,GRENADE.radius))return null;
  const offset={x:direction.x*.38,y:direction.y*.38-.10,z:direction.z*.38};
  const hit=sweepSphere(world,eye,offset,GRENADE.radius);
  const fraction=hit?Math.max(0,hit.fraction-.025):1;
  if(fraction<.25)return null;
  const position={x:eye.x+offset.x*fraction,y:eye.y+offset.y*fraction,z:eye.z+offset.z*fraction};
  if(world.overlapsCylinder(position.x,position.z,GRENADE.radius,position.y-GRENADE.radius,position.y+GRENADE.radius))return null;
  const speed = charge === undefined ? GRENADE.speed : GRENADE.minSpeed + (GRENADE.maxSpeed - GRENADE.minSpeed) * Math.max(0, Math.min(1, charge));
  return {...data,position,velocity:{x:direction.x*speed+inherited.x*.35,
    y:direction.y*speed+GRENADE.lift+Math.max(0,inherited.y)*.35,z:direction.z*speed+inherited.z*.35},
    updatedAt:data.at,explodeAt:data.at+GRENADE.fuseMs};
}

/** Catch up by elapsed server time, including eviction. At most one fuse (240 steps). */
export function advanceGrenade(g: GrenadeState, now: number, world: CollisionWorld, onBounce?: (position: Vec3, speed: number) => void): void {
  const end=Math.min(now,g.explodeAt);
  let remaining=Math.max(0,(end-g.updatedAt)/1000);
  while(remaining>1e-9) {
    const dt=Math.min(1/120,remaining);remaining-=dt;
    g.velocity.y-=GRENADE.gravity*dt;
    let left=dt;
    for(let pass=0;pass<4&&left>1e-6;pass++) {
      const delta={x:g.velocity.x*left,y:g.velocity.y*left,z:g.velocity.z*left};
      const hit=sweepSphere(world,g.position,delta,GRENADE.radius);
      const t=hit?.fraction??1;
      g.position.x+=delta.x*t;g.position.y+=delta.y*t;g.position.z+=delta.z*t;
      if(!hit)break;
      const n=hit.normal;
      g.position.x+=n.x*.0001;g.position.y+=n.y*.0001;g.position.z+=n.z*.0001;
      const into=g.velocity.x*n.x+g.velocity.y*n.y+g.velocity.z*n.z;
      if(into<0) {
        if (-into > 1.2) onBounce?.({ ...g.position }, -into);
        const bounce=Math.abs(into)<.65?0:GRENADE.restitution;
        const tangent= n.y>.5 ? GRENADE.friction : .88;
        g.velocity.x=(g.velocity.x-n.x*into)*tangent-n.x*into*bounce;
        g.velocity.y=(g.velocity.y-n.y*into)*tangent-n.y*into*bounce;
        g.velocity.z=(g.velocity.z-n.z*into)*tangent-n.z*into*bounce;
        if (n.y > .5 && Math.hypot(g.velocity.x, g.velocity.z) < .02) g.velocity.x = g.velocity.z = 0;
      }
      left*=1-t;
    }
  }
  g.updatedAt=Math.max(g.updatedAt,end);
}

export function blastDamage(world: CollisionWorld, origin: Vec3, motion: ControllerState): number {
  const p=motion.position,height=(MOVEMENT.standHeight+(MOVEMENT.crouchHeight-MOVEMENT.standHeight)*motion.crouch);
  const dy=Math.max(p.y-origin.y,origin.y-(p.y+height),0);
  const distance=Math.hypot(p.x-origin.x,dy,p.z-origin.z);
  if(distance>=GRENADE.damageRadius)return 0;
  const target={x:p.x,y:Math.max(p.y+.25,Math.min(p.y+height-.2,origin.y)),z:p.z};
  const d={x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z},length=Math.hypot(d.x,d.y,d.z);
  if(length>.0001&&world.raycast(origin.x,origin.y,origin.z,d.x/length,d.y/length,d.z/length,length-.001,c=>c.solid))return 0;
  // A lethal center, then a smooth, configurable curve with zero slope at both ends.
  const t = Math.max(0, Math.min(1, (distance - GRENADE.lethalRadius) / (GRENADE.damageRadius - GRENADE.lethalRadius)));
  return GRENADE.damage * (1 - t * t * (3 - 2 * t)) ** GRENADE.falloffPower;
}
