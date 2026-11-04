import { MOVEMENT, PLAYER_MAX_HEALTH } from '../src/config/constants';
import type { Vec3 } from '../src/player/PlayerController';
import type { CollisionWorld } from '../src/physics/CollisionWorld';
import type { MapLayout } from '../src/maps/types';

export const POWERUP_TYPES = ['giant', 'doubleJump', 'fire', 'shield'] as const;
export type PowerupType = typeof POWERUP_TYPES[number];
export const POWERUPS = { duration: 15000, scale: 1.5, shield: 75, burnDuration: 5000, burnRate: 10,
  pickupRadius: .8, tiers: [{ players: 2, cap: 2, interval: 20000 }, { players: 4, cap: 3, interval: 15000 },
    { players: 6, cap: 4, interval: 10000 }, { players: 16, cap: 5, interval: 10000 }] } as const;
export const POWERUP_STYLE: Record<PowerupType, { name: string; icon: string; color: string }> = {
  giant: { name: 'GIANT', icon: '▲', color: '#b996ff' }, doubleJump: { name: 'DOUBLE JUMP', icon: '⇈', color: '#72f4bd' },
  fire: { name: 'FIRE', icon: '♨', color: '#ff794b' }, shield: { name: 'SHIELD', icon: '◇', color: '#63bdff' },
};
export interface ActivePowerup { type: PowerupType; expiresAt: number; shield: number }
export interface BurnState { ownerId: string; expiresAt: number; updatedAt: number }
export interface PowerupPlayer { alive: boolean; health: number; regenAt: number | null; powerup?: ActivePowerup | null; burn?: BurnState | null }
export interface Pickup { id: string; type: PowerupType; position: Vec3 }
export type PowerupEvent = { id: string; roundId: number; at: number; playerId: string; life: number; position: Vec3 }
  & ({ kind: 'pickup'; pickupId: string; ability: PowerupType } | { kind: 'doubleJump' });
export const validPowerupType = (x: unknown): x is PowerupType => POWERUP_TYPES.includes(x as PowerupType);
export const powerupScale = (s: Pick<PowerupPlayer, 'powerup'>): number => s.powerup?.type === 'giant' ? POWERUPS.scale : 1;
export const maxHealth = (s: Pick<PowerupPlayer, 'powerup'>): number => PLAYER_MAX_HEALTH * powerupScale(s);
export function spawnBalance(players: number) { return POWERUPS.tiers.find(t => players <= t.players) ?? POWERUPS.tiers[3]; }

/** Called only after geometry eligibility has been checked by the authority. */
export function activatePowerup(s: PowerupPlayer, type: PowerupType, now: number): void {
  const ratio = s.health / maxHealth(s);
  s.powerup = { type, expiresAt: now + POWERUPS.duration, shield: type === 'shield' ? POWERUPS.shield : 0 };
  s.health = Math.min(maxHealth(s), maxHealth(s) * ratio);
}
export function expirePowerup(s: PowerupPlayer, now: number): boolean {
  if (!s.powerup || (s.alive && now < s.powerup.expiresAt)) return false;
  const ratio = s.health / maxHealth(s); s.powerup = null;
  s.health = s.alive ? PLAYER_MAX_HEALTH * ratio : 0;
  return true;
}
/** One transaction for every source, including burn and grenades. Damage counts
 * shield absorption as a real hit; regeneration waits even if HP was protected. */
export function absorbDamage(s: PowerupPlayer, amount: number, at: number): number {
  if (!s.alive || !Number.isFinite(amount) || amount <= 0) return 0;
  expirePowerup(s, at);
  const shield = s.powerup?.type === 'shield' ? Math.min(s.powerup.shield, amount) : 0;
  if (s.powerup) s.powerup.shield = Math.max(0, s.powerup.shield - shield);
  const taken = Math.min(s.health, amount - shield);
  s.health = Math.max(0, s.health - taken); s.regenAt = at + 5000;
  return taken + shield;
}
export function applyBurn(s: PowerupPlayer, ownerId: string, now: number): void {
  if (s.alive) s.burn = { ownerId, updatedAt: now, expiresAt: now + POWERUPS.burnDuration };
}
/** Elapsed wall time with a persisted cursor, never a timer per player. The
 * caller first consumes the previous burn before a refresh changes ownership. */
export function advanceBurn(s: PowerupPlayer, now: number): { ownerId: string; damage: number } | null {
  const b = s.burn; if (!b) return null;
  if (!s.alive) { s.burn = null; return null; }
  const until = Math.min(now, b.expiresAt), start=b.updatedAt;
  const ownerId = b.ownerId;
  let damage=0;
  // Sparse ticks / reconstruction may cross a shield or Giant deadline. Consume
  // each side in order rather than applying the whole interval to the new size.
  if(s.powerup && start<s.powerup.expiresAt && until>=s.powerup.expiresAt) {
    const boundary=s.powerup.expiresAt;
    damage+=absorbDamage(s,(boundary-start)*POWERUPS.burnRate/1000,boundary-.001);
    expirePowerup(s,boundary);
    if(until>boundary)damage+=absorbDamage(s,(until-boundary)*POWERUPS.burnRate/1000,until);
    s.regenAt=until+5000;
  } else if(until>start) damage=absorbDamage(s,(until-start)*POWERUPS.burnRate/1000,until);
  b.updatedAt = Math.max(b.updatedAt, until);
  if (now >= b.expiresAt) s.burn = null;
  return { ownerId, damage };
}

/** No positional correction is allowed on growth: leave the collectible for a
 * later attempt if a full standing giant, or its current held gun, cannot fit. */
export function canGrow(world: CollisionWorld, p: Vec3, scale = POWERUPS.scale): boolean {
  return !world.overlapsCylinder(p.x, p.z, MOVEMENT.radius * scale, p.y + .025, p.y + MOVEMENT.standHeight * scale);
}

/** Build a bounded, static pool on authored ground navigation. Flood fill at
 * normal-player clearance from approved spawns excludes sealed rooms; swept
 * edges cannot cross walls. Candidates need a flat, wide 2m patch, so stairs,
 * props and narrow passages are never pickup locations. No per-tick nav work. */
export function pickupLocations(layout: MapLayout, world: CollisionWorld): Vec3[] {
  const [x0,z0,x1,z1] = layout.playArea, grid = 1, nodes = new Map<string, Vec3>();
  const routes = layout.navigation?.groundRoutes ?? layout.ground.zones;
  for (let x = Math.ceil(x0+1); x <= x1-1; x += grid) for (let z = Math.ceil(z0+1); z <= z1-1; z += grid) {
    if (!routes.some(r => x>=r.rect[0] && x<=r.rect[2] && z>=r.rect[1] && z<=r.rect[3])) continue;
    const y = world.groundHeight(x,z,.2,layout.ground.baseHeight+.4);
    if (!Number.isFinite(y) || world.overlapsCylinder(x,z,MOVEMENT.radius,y+.03,y+MOVEMENT.standHeight)) continue;
    nodes.set(`${x},${z}`,{x,y,z});
  }
  const visited = new Set<string>(), queue: Vec3[] = [];
  for (const s of layout.spawns) {
    const nearby = [...nodes.entries()].filter(([,p]) => Math.hypot(p.x-s.pos[0],p.z-s.pos[2])<1.5
      && !world.raycast(s.pos[0],s.pos[1]+1,s.pos[2],(p.x-s.pos[0])/(Math.hypot(p.x-s.pos[0],p.z-s.pos[2])||1),0,
        (p.z-s.pos[2])/(Math.hypot(p.x-s.pos[0],p.z-s.pos[2])||1),Math.hypot(p.x-s.pos[0],p.z-s.pos[2])));
    for (const [key,p] of nearby) if (!visited.has(key)) {visited.add(key);queue.push(p);}
  }
  for (let i=0;i<queue.length;i++) {
    const p=queue[i];
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const key=`${p.x+dx},${p.z+dz}`, n=nodes.get(key);
      if (!n || visited.has(key) || Math.abs(n.y-p.y)>.2) continue;
      let clear=true;
      for(let f=.25;f<=1;f+=.25) if(world.overlapsCylinder(p.x+dx*f,p.z+dz*f,MOVEMENT.radius,Math.max(p.y,n.y)+.03,Math.max(p.y,n.y)+MOVEMENT.standHeight)) {clear=false;break;}
      if(clear){visited.add(key);queue.push(n);}
    }
  }
  return queue.filter(p => Number.isInteger(p.x/2) && Number.isInteger(p.z/2)
    && !world.overlapsCylinder(p.x,p.z,1,p.y+.03,p.y+2.8)
    && [[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dz])=>Math.abs(world.groundHeight(p.x+dx,p.z+dz,.1,p.y+.2)-p.y)<.05));
}

/** Prefer a different region from existing cubes; never share a pool position. */
export function choosePickup(pool: readonly Vec3[], existing: readonly Pickup[], random = Math.random): Vec3 | undefined {
  const candidates = pool.map(position=>({position,gap:existing.reduce((n,p)=>Math.min(n,Math.hypot(p.position.x-position.x,p.position.z-position.z)),Infinity)}))
    .filter(p=>p.gap>=5).sort((a,b)=>b.gap-a.gap);
  const distributed=candidates.slice(0,Math.max(1,Math.ceil(candidates.length/3)));
  return distributed[Math.min(distributed.length-1,Math.floor(random()*distributed.length))]?.position;
}

export interface PowerupFieldState { roundId: number; nextSpawn: number; pickups: Pickup[] }
/** Hosting-independent room state. Callbacks award only after server eligibility;
 * removing before the next claimant makes a pickup an exactly-once operation. */
export class PowerupField {
  readonly state: PowerupFieldState;
  constructor(readonly pool: readonly Vec3[], roundId: number, now: number, stored?: PowerupFieldState) {
    this.state = stored?.roundId === roundId ? { ...stored, pickups: stored.pickups.filter(p => validPowerupType(p.type)
      && pool.some(v => v.x===p.position.x && v.y===p.position.y && v.z===p.position.z)).slice(0,5) }
      : { roundId, nextSpawn: now + spawnBalance(1).interval, pickups: [] };
  }
  spawn(now: number, activePlayers: number, id: () => string, random = Math.random): void {
    const balance = spawnBalance(activePlayers);
    this.state.pickups.splice(balance.cap);
    if (!activePlayers) { this.state.nextSpawn = now + balance.interval; return; }
    this.state.nextSpawn = Math.min(this.state.nextSpawn, now + balance.interval);
    if (now < this.state.nextSpawn) return;
    this.state.nextSpawn = now + balance.interval;
    if (this.state.pickups.length >= balance.cap) return;
    const position = choosePickup(this.pool,this.state.pickups,random);
    if (position) this.state.pickups.push({id:id(), type:POWERUP_TYPES[Math.min(3,Math.floor(random()*4))],position:{...position}});
  }
  collect(position: Vec3, accept: (pickup: Pickup) => boolean): Pickup | undefined {
    const index=this.state.pickups.findIndex(p => Math.abs(p.position.y-position.y)<.65
      && Math.hypot(p.position.x-position.x,p.position.z-position.z)<=POWERUPS.pickupRadius && accept(p));
    return index<0 ? undefined : this.state.pickups.splice(index,1)[0];
  }
}
