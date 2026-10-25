/**
 * Weapon state machine (no rendering). Driven at the fixed simulation rate so fire rate and reload
 * timing are frame-rate independent and could later run on a server.
 */

export interface WeaponStats {
  name: string;
  magazine: number;
  reserve: number;
  /** Rounds per minute. */
  rpm: number;
  automatic: boolean;
  damage: number;
  /** Damage multiplier for the bullseye / head zone. */
  critMultiplier: number;
  range: number;
  reloadTime: number;
  /** Cone half-angles in degrees. */
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  spreadPerShot: number;
  spreadRecovery: number;
  /** Camera kick per shot in degrees. */
  recoilPitch: number;
  recoilYaw: number;
  adsTime: number;
  adsFovScale: number;
}

export const PULSE_CARBINE: WeaponStats = {
  name: 'VK-7 Pulse Carbine',
  magazine: 30,
  reserve: 150,
  rpm: 600,
  automatic: true,
  damage: 34,
  critMultiplier: 2.5,
  range: 200,
  reloadTime: 1.7,
  spreadHip: 1.1,
  spreadAds: 0.12,
  spreadMove: 1.6,
  spreadPerShot: 0.22,
  spreadRecovery: 4.5,
  recoilPitch: 0.55,
  recoilYaw: 0.18,
  adsTime: 0.16,
  adsFovScale: 0.78,
};

export type WeaponEvent =
  | { type: 'fire'; spread: number }
  | { type: 'empty' }
  | { type: 'reloadStart' }
  | { type: 'reloadEnd' };

export interface WeaponInput {
  trigger: boolean;
  triggerPressed: boolean;
  reloadPressed: boolean;
  aim: boolean;
  /** Horizontal speed relative to sprint speed, 0..1+. */
  moveFactor: number;
  airborne: boolean;
  sprinting: boolean;
}

export class Weapon {
  ammo: number;
  reserve: number;
  /** 0 = hip, 1 = fully aimed. */
  ads = 0;
  reloading = false;
  reloadProgress = 0;
  private cooldown = 0;
  private bloom = 0;
  private reloadTimer = 0;
  private emptyClickCooldown = 0;

  constructor(readonly stats: WeaponStats = PULSE_CARBINE) {
    this.ammo = stats.magazine;
    this.reserve = stats.reserve;
  }

  get fireInterval(): number {
    return 60 / this.stats.rpm;
  }

  /** Current cone half-angle in degrees. */
  spread(input: Pick<WeaponInput, 'moveFactor' | 'airborne'>): number {
    const s = this.stats;
    const base = s.spreadHip + (s.spreadAds - s.spreadHip) * this.ads;
    const move = s.spreadMove * Math.min(1, input.moveFactor) * (1 - this.ads * 0.7);
    return base + move + this.bloom + (input.airborne ? s.spreadMove * 1.5 : 0);
  }

  refill(): void {
    this.ammo = this.stats.magazine;
    this.reserve = this.stats.reserve;
    this.reloading = false;
    this.reloadTimer = 0;
  }

  update(dt: number, input: WeaponInput, events: WeaponEvent[] = []): WeaponEvent[] {
    const s = this.stats;
    // aim-down-sights blend (not while sprinting or reloading)
    const wantAds = input.aim && !input.sprinting && !this.reloading;
    const adsRate = dt / s.adsTime;
    this.ads = Math.max(0, Math.min(1, this.ads + (wantAds ? adsRate : -adsRate)));
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.emptyClickCooldown = Math.max(0, this.emptyClickCooldown - dt);
    this.bloom = Math.max(0, this.bloom - s.spreadRecovery * dt);

    if (this.reloading) {
      this.reloadTimer -= dt;
      this.reloadProgress = 1 - this.reloadTimer / s.reloadTime;
      if (this.reloadTimer <= 0) {
        const take = Math.min(s.magazine - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
        this.reloadProgress = 0;
        events.push({ type: 'reloadEnd' });
      }
      return events;
    }

    if (input.reloadPressed && this.ammo < s.magazine && this.reserve > 0) {
      this.startReload(events);
      return events;
    }

    const wantsFire = s.automatic ? input.trigger : input.triggerPressed;
    if (wantsFire && this.cooldown <= 0 && !input.sprinting) {
      if (this.ammo > 0) {
        const spread = this.spread(input);
        this.ammo--;
        this.cooldown += this.fireInterval;
        this.bloom = Math.min(this.bloom + s.spreadPerShot, 3);
        events.push({ type: 'fire', spread });
        if (this.ammo === 0 && this.reserve > 0) {
          // auto-reload after the last round
          this.startReload(events);
        }
      } else if (input.triggerPressed || this.emptyClickCooldown <= 0) {
        events.push({ type: 'empty' });
        this.emptyClickCooldown = 0.35;
      }
    }
    if (!wantsFire && this.cooldown < 0) this.cooldown = 0;
    return events;
  }

  private startReload(events: WeaponEvent[]): void {
    this.reloading = true;
    this.reloadTimer = this.stats.reloadTime;
    this.reloadProgress = 0;
    events.push({ type: 'reloadStart' });
  }
}

/** Random direction inside a cone of `halfAngleDeg` around `dir` (uniform over the disk). */
export function applySpread(
  dir: { x: number; y: number; z: number },
  halfAngleDeg: number,
  rand: () => number = Math.random,
): { x: number; y: number; z: number } {
  if (halfAngleDeg <= 0) return { ...dir };
  const a = (halfAngleDeg * Math.PI) / 180;
  const r = Math.tan(a) * Math.sqrt(rand());
  const t = rand() * Math.PI * 2;
  // basis perpendicular to dir
  const up = Math.abs(dir.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ux = dir.y * up.z - dir.z * up.y;
  let uy = dir.z * up.x - dir.x * up.z;
  let uz = dir.x * up.y - dir.y * up.x;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = dir.y * uz - dir.z * uy;
  const vy = dir.z * ux - dir.x * uz;
  const vz = dir.x * uy - dir.y * ux;
  const ox = dir.x + (ux * Math.cos(t) + vx * Math.sin(t)) * r;
  const oy = dir.y + (uy * Math.cos(t) + vy * Math.sin(t)) * r;
  const oz = dir.z + (uz * Math.cos(t) + vz * Math.sin(t)) * r;
  const l = Math.hypot(ox, oy, oz);
  return { x: ox / l, y: oy / l, z: oz / l };
}
