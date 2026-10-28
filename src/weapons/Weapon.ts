/**
 * Weapon state machines (no rendering). Driven at the fixed simulation rate so fire rate, pump/bolt cycling and
 * reload timing are frame-rate independent and could later run on a server.
 *
 * Reserve ammunition is infinite; magazines are not: every weapon has to be reloaded when its magazine (or tube) is
 * empty. Timed cues inside each action (magazine out, bolt back...) drive both the sounds and the hand animation.
 */

export type WeaponId = 'rifle' | 'shotgun' | 'sniper' | 'smg';
export type FireMode = 'auto' | 'semi' | 'pump' | 'bolt';

/** A named moment inside an action, at a fraction (0..1) of its duration. */
export interface Cue {
  at: number;
  cue: string;
}

export interface MagazineReload {
  kind: 'magazine';
  /** Tactical reload (a round still chambered) and reload from empty (adds releasing the bolt / working the action). */
  time: number;
  emptyTime: number;
  cues: Cue[];
  emptyCues: Cue[];
  /** Fraction of the reload at which the new magazine is seated and the ammo counter fills. */
  seatAt: number;
  emptySeatAt: number;
}

export interface ShellReload {
  kind: 'shells';
  /** Bringing the gun up to the loading port, one shell each, and back to the grip. */
  start: number;
  perShell: number;
  end: number;
  /** Fraction of `perShell` at which the shell is pushed into the tube. */
  insertAt: number;
}

export interface WeaponStats {
  id: WeaponId;
  name: string;
  /** Number key that selects it. */
  slot: number;
  magazine: number;
  mode: FireMode;
  /** Highest rate the trigger allows (rounds per minute). */
  rpm: number;
  /** Pump or bolt action after every shot (seconds); 0 for self-loading guns. */
  cycleTime: number;
  cycleCues: Cue[];
  /** Body damage of one bullet (or one pellet) at close range; headshots deal 1.5x (game/Damage.ts). */
  damage: number;
  pellets: number;
  /** Half-angle of the pellet pattern around the aim direction (degrees). */
  pelletSpread: number;
  /** Damage falls off linearly from `start` to `end` metres, down to `minScale` of full damage. */
  falloff: { start: number; end: number; minScale: number };
  range: number;
  reload: MagazineReload | ShellReload;
  /** Aim cone half-angles in degrees. */
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  spreadPerShot: number;
  spreadRecovery: number;
  maxBloom: number;
  /** Camera kick per shot in degrees, and the view-model kick impulse. */
  recoilPitch: number;
  recoilYaw: number;
  viewKick: number;
  adsTime: number;
  adsFovScale: number;
  /** Magnified scope: the view shows a scope overlay instead of the weapon while aiming. */
  scope: boolean;
  equipTime: number;
  holsterTime: number;
}

export const RIFLE: WeaponStats = {
  id: 'rifle',
  name: 'Assault Rifle',
  slot: 1,
  magazine: 30,
  mode: 'auto',
  rpm: 700,
  cycleTime: 0,
  cycleCues: [],
  damage: 25,
  pellets: 1,
  pelletSpread: 0,
  falloff: { start: 35, end: 90, minScale: 0.75 },
  range: 300,
  reload: {
    kind: 'magazine',
    time: 2.1,
    emptyTime: 2.6,
    cues: [{ at: 0.2, cue: 'mag_out' }, { at: 0.66, cue: 'mag_in' }],
    emptyCues: [{ at: 0.16, cue: 'mag_out' }, { at: 0.55, cue: 'mag_in' }, { at: 0.8, cue: 'bolt_release' }],
    seatAt: 0.66,
    emptySeatAt: 0.55,
  },
  spreadHip: 1.4,
  spreadAds: 0.08,
  spreadMove: 1.8,
  spreadPerShot: 0.24,
  spreadRecovery: 4.5,
  maxBloom: 2.5,
  recoilPitch: 0.55,
  recoilYaw: 0.22,
  viewKick: 7,
  adsTime: 0.2,
  adsFovScale: 0.8,
  scope: false,
  equipTime: 0.45,
  holsterTime: 0.25,
};

export const SHOTGUN: WeaponStats = {
  id: 'shotgun',
  name: 'Pump Shotgun',
  slot: 2,
  magazine: 6,
  mode: 'pump',
  rpm: 90,
  cycleTime: 0.6,
  cycleCues: [{ at: 0.18, cue: 'pump_back' }, { at: 0.32, cue: 'eject' }, { at: 0.58, cue: 'pump_fwd' }],
  damage: 12,
  pellets: 9,
  pelletSpread: 3.4,
  falloff: { start: 7, end: 24, minScale: 0.25 },
  range: 60,
  reload: { kind: 'shells', start: 0.45, perShell: 0.5, end: 0.4, insertAt: 0.72 },
  spreadHip: 0.7,
  spreadAds: 0.2,
  spreadMove: 1.0,
  spreadPerShot: 0,
  spreadRecovery: 4,
  maxBloom: 0,
  recoilPitch: 4.2,
  recoilYaw: 1.1,
  viewKick: 22,
  adsTime: 0.22,
  adsFovScale: 0.88,
  scope: false,
  equipTime: 0.5,
  holsterTime: 0.3,
};

export const SNIPER: WeaponStats = {
  id: 'sniper',
  name: 'Sniper Rifle',
  slot: 3,
  magazine: 5,
  mode: 'bolt',
  rpm: 50,
  cycleTime: 1.05,
  cycleCues: [{ at: 0.18, cue: 'bolt_up' }, { at: 0.36, cue: 'bolt_back' }, { at: 0.38, cue: 'eject' }, { at: 0.6, cue: 'bolt_fwd' }, { at: 0.76, cue: 'bolt_down' }],
  // 75 to the body, 112.5 to the head: a headshot kills a 100-health target outright, a body shot does not
  damage: 75,
  pellets: 1,
  pelletSpread: 0,
  falloff: { start: 1000, end: 1001, minScale: 1 },
  range: 800,
  reload: {
    kind: 'magazine',
    time: 2.7,
    emptyTime: 3.6,
    cues: [{ at: 0.22, cue: 'mag_out' }, { at: 0.6, cue: 'mag_in' }],
    emptyCues: [
      { at: 0.17, cue: 'mag_out' },
      { at: 0.46, cue: 'mag_in' },
      { at: 0.68, cue: 'bolt_up' },
      { at: 0.76, cue: 'bolt_back' },
      { at: 0.85, cue: 'bolt_fwd' },
      { at: 0.92, cue: 'bolt_down' },
    ],
    seatAt: 0.6,
    emptySeatAt: 0.46,
  },
  // unscoped shots go wide; scoped and still they go exactly where the crosshair is
  spreadHip: 6,
  spreadAds: 0,
  spreadMove: 6,
  spreadPerShot: 0,
  spreadRecovery: 6,
  maxBloom: 0,
  recoilPitch: 3.2,
  recoilYaw: 0.6,
  viewKick: 16,
  adsTime: 0.28,
  adsFovScale: 0.22,
  scope: true,
  equipTime: 0.6,
  holsterTime: 0.3,
};

export const SMG: WeaponStats = {
  ...RIFLE, id: 'smg', name: 'SMG', slot: 4, magazine: 32, rpm: 960, damage: 11,
  range: 140, falloff: { start: 15, end: 55, minScale: 0.55 },
  reload: { ...(RIFLE.reload as MagazineReload), time: 1.65, emptyTime: 2.05 },
  spreadHip: 1.7, spreadAds: 0.16, recoilPitch: 0.34, recoilYaw: 0.18, viewKick: 5,
};
export const WEAPONS: readonly WeaponStats[] = [RIFLE, SHOTGUN, SNIPER, SMG];

export type WeaponEvent =
  | { type: 'fire'; spread: number }
  | { type: 'empty' }
  | { type: 'reloadStart'; empty: boolean }
  | { type: 'reloadEnd' }
  | { type: 'shellIn' }
  | { type: 'cycleStart' }
  | { type: 'cycleEnd' }
  | { type: 'cue'; cue: string }
  | { type: 'equipStart' }
  | { type: 'equipEnd' }
  | { type: 'holstered' };

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

/** What the weapon is doing; `progress` (0..1) drives the view-model animation. */
export type WeaponAction =
  | 'idle'
  | 'equip'
  | 'holster'
  | 'holstered'
  | 'cycle'
  | 'reload'
  | 'reloadEmpty'
  | 'shellStart'
  | 'shell'
  | 'shellEnd';

/** Linear damage falloff with distance (game/Damage.ts then applies the headshot multiplier). */
export function damageAt(s: WeaponStats, distance: number): number {
  const { start, end, minScale } = s.falloff;
  const t = Math.max(0, Math.min(1, (distance - start) / Math.max(1e-6, end - start)));
  return s.damage * (1 + (minScale - 1) * t);
}

/** Trusted server snapshots only; clients never submit this state. */
export interface WeaponState {
  ammo: number; ads: number; action: WeaponAction; progress: number;
  time: number; duration: number; cues: Cue[]; cooldown: number; bloom: number;
  emptyClickCooldown: number; stopLoading: boolean; fromEmpty: boolean;
}

export class Weapon {
  ammo: number;
  /** Spare ammunition: infinite (the magazine is the limit). */
  readonly reserve = Infinity;
  /** 0 = hip, 1 = fully aimed. */
  ads = 0;
  action: WeaponAction = 'idle';
  /** 0..1 through the current action. */
  progress = 0;
  private time = 0;
  private duration = 0;
  private cues: Cue[] = [];
  private cooldown = 0;
  private bloom = 0;
  private emptyClickCooldown = 0;
  /** Shell reload: stop after the shell being loaded (the trigger was pulled). */
  private stopLoading = false;
  /** The reload began with an empty gun: the action has to be worked at the end. */
  private fromEmpty = false;

  constructor(readonly stats: WeaponStats) {
    this.ammo = stats.magazine;
  }

  capture(): WeaponState {
    return { ammo: this.ammo, ads: this.ads, action: this.action, progress: this.progress,
      time: this.time, duration: this.duration, cues: this.cues.map((c) => ({ ...c })), cooldown: this.cooldown,
      bloom: this.bloom, emptyClickCooldown: this.emptyClickCooldown, stopLoading: this.stopLoading, fromEmpty: this.fromEmpty };
  }

  restore(s: WeaponState): void {
    Object.assign(this, { ...s, cues: s.cues.map((c) => ({ ...c })) });
  }

  get simulating(): boolean {
    return this.action !== 'idle' || this.cooldown > 0 || this.bloom > 0 || this.ads > 0;
  }

  get fireInterval(): number {
    return 60 / this.stats.rpm;
  }

  get reloading(): boolean {
    return this.action === 'reload' || this.action === 'reloadEmpty' || this.action.startsWith('shell');
  }

  /** Overall reload progress for the HUD (shell reloads count shells). */
  get reloadProgress(): number {
    const r = this.stats.reload;
    if (r.kind === 'magazine') return this.action === 'reload' || this.action === 'reloadEmpty' ? this.progress : 0;
    return this.reloading ? this.ammo / this.stats.magazine : 0;
  }

  /** Can shoot right now (ready, not cycling or reloading). */
  get ready(): boolean {
    return this.action === 'idle';
  }

  /** Current cone half-angle in degrees. */
  spread(input: Pick<WeaponInput, 'moveFactor' | 'airborne'>): number {
    const s = this.stats;
    const base = s.spreadHip + (s.spreadAds - s.spreadHip) * this.ads;
    const move = s.spreadMove * Math.min(1, input.moveFactor) * (1 - this.ads * 0.7);
    return base + move + this.bloom + (input.airborne ? s.spreadMove * 1.5 : 0);
  }

  /** Full magazine, ready to fire (spawn). */
  refill(): void {
    this.ammo = this.stats.magazine;
    this.setAction('idle', 0);
    this.ads = 0;
    this.bloom = 0;
    this.cooldown = 0;
  }

  /** Start putting the weapon away; reloads and pump/bolt actions are abandoned. */
  holster(events: WeaponEvent[] = []): void {
    void events;
    this.ads = 0;
    this.setAction('holster', this.stats.holsterTime);
  }

  /** Start bringing the weapon up. */
  equip(events: WeaponEvent[] = []): void {
    this.ads = 0;
    this.setAction('equip', this.stats.equipTime);
    events.push({ type: 'equipStart' });
  }

  update(dt: number, input: WeaponInput, events: WeaponEvent[] = []): WeaponEvent[] {
    const s = this.stats;
    // aim-down-sights blend: not while sprinting, reloading or switching; a bolt action takes the eye off the scope
    const canAim = this.action === 'idle' || (this.action === 'cycle' && s.mode !== 'bolt');
    const wantAds = input.aim && !input.sprinting && canAim;
    const adsRate = dt / s.adsTime;
    this.ads = Math.max(0, Math.min(1, this.ads + (wantAds ? adsRate : -adsRate)));
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.emptyClickCooldown = Math.max(0, this.emptyClickCooldown - dt);
    this.bloom = Math.max(0, this.bloom - s.spreadRecovery * dt);

    if (this.action !== 'idle') {
      this.advance(dt, input, events);
      return events;
    }

    if (input.reloadPressed && this.ammo < s.magazine) {
      this.startReload(events);
      return events;
    }

    const wantsFire = s.mode === 'auto' ? input.trigger : input.triggerPressed;
    if (wantsFire && this.cooldown <= 0 && !input.sprinting) {
      if (this.ammo > 0) {
        const spread = this.spread(input);
        this.ammo--;
        this.cooldown += this.fireInterval;
        this.bloom = Math.min(this.bloom + s.spreadPerShot, s.maxBloom);
        events.push({ type: 'fire', spread });
        if (this.ammo === 0) {
          // last round: straight into the reload (which works the action at its end)
          this.startReload(events);
        } else if (s.cycleTime > 0) {
          this.setAction('cycle', s.cycleTime, s.cycleCues);
          events.push({ type: 'cycleStart' });
        }
      } else if (input.triggerPressed || this.emptyClickCooldown <= 0) {
        events.push({ type: 'empty' });
        this.emptyClickCooldown = 0.35;
        this.startReload(events);
      }
    }
    if (!wantsFire && this.cooldown < 0) this.cooldown = 0;
    return events;
  }

  private advance(dt: number, input: WeaponInput, events: WeaponEvent[]): void {
    const s = this.stats;
    if (this.action === 'holstered') return;
    const before = this.time;
    this.time += dt;
    this.progress = this.duration > 0 ? Math.min(1, this.time / this.duration) : 1;
    const p0 = this.duration > 0 ? before / this.duration : 1;
    for (const c of this.cues) if (c.at > p0 && c.at <= this.progress) events.push({ type: 'cue', cue: c.cue });
    const r = s.reload;

    if (this.action === 'reload' || this.action === 'reloadEmpty') {
      const mr = r as MagazineReload;
      const seat = this.action === 'reload' ? mr.seatAt : mr.emptySeatAt;
      if (p0 < seat && this.progress >= seat) this.ammo = s.magazine;
    }
    if (this.action === 'shell') {
      const sr = r as ShellReload;
      if (input.triggerPressed && this.ammo > 0) this.stopLoading = true;
      if (p0 < sr.insertAt && this.progress >= sr.insertAt) {
        this.ammo = Math.min(s.magazine, this.ammo + 1);
        events.push({ type: 'shellIn' });
      }
    }
    if (this.action === 'shellStart' && input.triggerPressed && this.ammo > 0) this.stopLoading = true;
    if (this.time < this.duration) return;

    // action finished
    switch (this.action) {
      case 'equip':
        this.setAction('idle', 0);
        events.push({ type: 'equipEnd' });
        break;
      case 'holster':
        this.setAction('holstered', 0);
        events.push({ type: 'holstered' });
        break;
      case 'cycle':
        this.setAction('idle', 0);
        events.push({ type: 'cycleEnd' });
        break;
      case 'reload':
      case 'reloadEmpty':
        this.setAction('idle', 0);
        events.push({ type: 'reloadEnd' });
        break;
      case 'shellStart':
      case 'shell': {
        const sr = r as ShellReload;
        if (this.ammo < s.magazine && !this.stopLoading) this.setAction('shell', sr.perShell);
        else this.setAction('shellEnd', sr.end);
        break;
      }
      case 'shellEnd':
        events.push({ type: 'reloadEnd' });
        if (this.fromEmpty) {
          // chamber a shell: work the pump
          this.setAction('cycle', s.cycleTime, s.cycleCues.filter((c) => c.cue !== 'eject'));
          events.push({ type: 'cycleStart' });
        } else {
          this.setAction('idle', 0);
        }
        break;
      default:
        this.setAction('idle', 0);
    }
  }

  private startReload(events: WeaponEvent[]): void {
    const r = this.stats.reload;
    this.fromEmpty = this.ammo === 0;
    this.stopLoading = false;
    if (r.kind === 'magazine') {
      if (this.fromEmpty) this.setAction('reloadEmpty', r.emptyTime, r.emptyCues);
      else this.setAction('reload', r.time, r.cues);
    } else {
      this.setAction('shellStart', r.start);
    }
    events.push({ type: 'reloadStart', empty: this.fromEmpty });
  }

  private setAction(action: WeaponAction, duration: number, cues: Cue[] = []): void {
    this.action = action;
    this.duration = duration;
    this.time = 0;
    this.progress = 0;
    this.cues = cues;
  }
}

/**
 * The player's weapons and switching between them. Selecting another weapon holsters the current one (abandoning a
 * reload or a pump/bolt action), then equips the new one; each weapon keeps its own magazine.
 */
export class Loadout {
  readonly weapons: Weapon[];
  private index = 0;
  private previous = 0;
  private pending: number | null = null;
  private locked = false;

  constructor(stats: readonly WeaponStats[] = WEAPONS) {
    this.weapons = stats.map((s) => new Weapon(s));
    for (const w of this.weapons.slice(1)) w.action = 'holstered';
  }

  get current(): Weapon {
    return this.weapons[this.index];
  }

  get currentIndex(): number {
    return this.index;
  }

  /** Index being switched to, if a switch is under way. */
  get switchingTo(): number | null {
    return this.pending;
  }

  /** Ask for weapon `i` (0-based); ignored if it is already in hand or on its way. */
  select(i: number, events: WeaponEvent[] = []): void {
    if (this.locked || !Number.isInteger(i) || i < 0 || i >= this.weapons.length) return;
    if (this.pending === null ? i === this.index : i === this.pending) return;
    if (this.pending === null) this.current.holster(events);
    this.pending = i;
  }

  /** Next/previous weapon in slot order (mouse wheel). */
  cycle(step: number, events: WeaponEvent[] = []): void {
    const n = this.weapons.length;
    const from = this.pending ?? this.index;
    this.select((((from + step) % n) + n) % n, events);
  }

  /** Back to the weapon held before this one (Q). */
  selectPrevious(events: WeaponEvent[] = []): void {
    this.select(this.previous, events);
  }

  update(dt: number, input: WeaponInput, events: WeaponEvent[] = []): WeaponEvent[] {
    const w = this.current;
    w.update(dt, this.pending === null ? input : { ...input, trigger: false, triggerPressed: false, reloadPressed: false, aim: false }, events);
    if (w.action === 'holstered' && this.pending !== null) {
      this.previous = this.index;
      this.index = this.pending;
      this.pending = null;
      this.current.equip(events);
    }
    return events;
  }

  /** Spawn: every magazine full, the first weapon in hand and ready. */
  reset(index = 0, locked = false): void {
    this.locked = locked;
    for (const w of this.weapons) w.refill();
    for (const [i, w] of this.weapons.entries()) if (i !== index) w.action = 'holstered';
    this.previous = this.index === 0 ? 1 : this.index;
    this.index = index;
    this.pending = null;
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
