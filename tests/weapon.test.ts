import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/config/constants';
import {
  applySpread,
  damageAt,
  Loadout,
  RIFLE,
  SHOTGUN,
  SNIPER,
  Weapon,
  WEAPONS,
  type MagazineReload,
  type ShellReload,
  type WeaponEvent,
  type WeaponInput,
} from '../src/weapons/Weapon';

const idle: WeaponInput = {
  trigger: false,
  triggerPressed: false,
  reloadPressed: false,
  aim: false,
  moveFactor: 0,
  airborne: false,
  sprinting: false,
};

/** Run for `seconds`; `press` makes the first tick a fresh trigger pull (and keeps the trigger held). */
function simulate(w: Weapon | Loadout, seconds: number, input: Partial<WeaponInput> = {}, pressEvery = 0): WeaponEvent[] {
  const all: WeaponEvent[] = [];
  const n = Math.round(seconds / FIXED_DT);
  const every = pressEvery > 0 ? Math.max(1, Math.round(pressEvery / FIXED_DT)) : 0;
  for (let i = 0; i < n; i++) {
    const pressed = !!input.trigger && (i === 0 || (every > 0 && i % every === 0));
    w.update(FIXED_DT, { ...idle, ...input, triggerPressed: pressed || !!input.triggerPressed && i === 0 }, all);
  }
  return all;
}
const count = (ev: WeaponEvent[], type: WeaponEvent['type']) => ev.filter((e) => e.type === type).length;
const cues = (ev: WeaponEvent[]) => ev.filter((e): e is Extract<WeaponEvent, { type: 'cue' }> => e.type === 'cue').map((e) => e.cue);

describe('Assault rifle', () => {
  it('fires automatically at its rate of fire', () => {
    const w = new Weapon(RIFLE);
    const ev = simulate(w, 1.0, { trigger: true });
    const shots = count(ev, 'fire');
    expect(shots).toBeGreaterThanOrEqual(11);
    expect(shots).toBeLessThanOrEqual(12);
    expect(w.ammo).toBe(RIFLE.magazine - shots);
  });

  it('has a limited magazine but infinite reserve: it never runs out after many reloads', () => {
    const w = new Weapon(RIFLE);
    expect(w.reserve).toBe(Infinity);
    for (let k = 0; k < 6; k++) {
      // empty the magazine: the last round starts the reload by itself
      const ev = simulate(w, 3.0, { trigger: true });
      expect(count(ev, 'fire')).toBe(RIFLE.magazine);
      expect(count(ev, 'reloadStart')).toBe(1);
      simulate(w, (RIFLE.reload as MagazineReload).emptyTime + 0.1);
      expect(w.ammo).toBe(RIFLE.magazine);
    }
  });

  it('reloads a part-empty magazine faster than an empty one, with magazine out/in cues and a bolt release from empty', () => {
    const r = RIFLE.reload as MagazineReload;
    const w = new Weapon(RIFLE);
    simulate(w, 0.3, { trigger: true });
    expect(w.ammo).toBeGreaterThan(0);
    const tactical = simulate(w, 0.05, { reloadPressed: true });
    expect(tactical.find((e) => e.type === 'reloadStart')).toMatchObject({ empty: false });
    const ev = simulate(w, r.time + 0.05);
    expect(cues(ev)).toEqual(['mag_out', 'mag_in']);
    expect(w.ammo).toBe(RIFLE.magazine);
    expect(w.reloading).toBe(false);
    // from empty: longer and with the bolt release
    simulate(w, 3, { trigger: true });
    expect(w.action).toBe('reloadEmpty');
    const ev2 = simulate(w, r.emptyTime);
    expect(cues(ev2)).toEqual(['mag_out', 'mag_in', 'bolt_release']);
    expect(w.ammo).toBe(RIFLE.magazine);
  });

  it('fills the magazine only when the new one is seated, and cannot fire while reloading', () => {
    const r = RIFLE.reload as MagazineReload;
    const w = new Weapon(RIFLE);
    simulate(w, 0.5, { trigger: true });
    const before = w.ammo;
    simulate(w, 0.05, { reloadPressed: true });
    simulate(w, r.time * (r.seatAt - 0.1));
    expect(w.ammo).toBe(before);
    expect(count(simulate(w, 0.2, { trigger: true }), 'fire')).toBe(0);
    simulate(w, r.time * 0.2);
    expect(w.ammo).toBe(RIFLE.magazine);
  });

  it('aims down sights smoothly and tightens spread; does not fire while sprinting', () => {
    const w = new Weapon(RIFLE);
    const hip = w.spread({ moveFactor: 0, airborne: false });
    simulate(w, RIFLE.adsTime / 2, { aim: true });
    expect(w.ads).toBeGreaterThan(0.3);
    expect(w.ads).toBeLessThan(0.7);
    simulate(w, RIFLE.adsTime, { aim: true });
    expect(w.ads).toBe(1);
    expect(w.spread({ moveFactor: 0, airborne: false })).toBeLessThan(hip / 4);
    expect(count(simulate(new Weapon(RIFLE), 0.5, { trigger: true, sprinting: true }), 'fire')).toBe(0);
  });

  it('dry-fires into an automatic reload when the trigger is pulled on an empty magazine', () => {
    const w = new Weapon(RIFLE);
    w.ammo = 0;
    const ev = simulate(w, 0.05, { trigger: true });
    expect(count(ev, 'empty')).toBe(1);
    expect(w.action).toBe('reloadEmpty');
  });
});

describe('Pump shotgun', () => {
  it('fires nine pellets per shell and has to be pumped between shots', () => {
    expect(SHOTGUN.pellets).toBe(9);
    const w = new Weapon(SHOTGUN);
    const ev = simulate(w, 0.05, { trigger: true });
    expect(count(ev, 'fire')).toBe(1);
    expect(w.action).toBe('cycle');
    // holding the trigger does not fire again: it needs a fresh pull after the pump stroke
    expect(count(simulate(w, SHOTGUN.cycleTime + 0.2, { trigger: true }), 'fire')).toBe(0);
    expect(w.action).toBe('idle');
    const pumped = simulate(w, 0.05, { trigger: true });
    expect(count(pumped, 'fire')).toBe(1);
    expect(cues(simulate(w, SHOTGUN.cycleTime))).toEqual(['pump_back', 'eject', 'pump_fwd']);
  });

  it('recoils much harder than the rifle and spreads its pellets in a cone', () => {
    expect(SHOTGUN.recoilPitch).toBeGreaterThan(RIFLE.recoilPitch * 5);
    expect(SHOTGUN.pelletSpread).toBeGreaterThan(2);
  });

  it('reloads one shell at a time, and the trigger stops a reload after the current shell', () => {
    const r = SHOTGUN.reload as ShellReload;
    const w = new Weapon(SHOTGUN);
    simulate(w, 0.05, { trigger: true });
    simulate(w, SHOTGUN.cycleTime + 0.05);
    simulate(w, 0.05, { trigger: true });
    simulate(w, SHOTGUN.cycleTime + 0.05);
    expect(w.ammo).toBe(SHOTGUN.magazine - 2);
    simulate(w, 0.02, { reloadPressed: true });
    const ev = simulate(w, r.start + r.perShell * 2 + r.end + 0.1);
    expect(count(ev, 'shellIn')).toBe(2);
    expect(w.ammo).toBe(SHOTGUN.magazine);
    // interrupt: two shells down, reload, fire after the first shell
    simulate(w, 0.05, { trigger: true });
    simulate(w, SHOTGUN.cycleTime + 0.05);
    simulate(w, 0.05, { trigger: true });
    simulate(w, SHOTGUN.cycleTime + 0.05);
    simulate(w, 0.02, { reloadPressed: true });
    simulate(w, r.start + r.perShell * 0.3);
    simulate(w, 0.02, { trigger: true });
    simulate(w, r.perShell + r.end + 0.05);
    expect(w.ammo).toBe(SHOTGUN.magazine - 1);
    expect(w.action).toBe('idle');
  });

  it('works the pump after reloading from empty', () => {
    const w = new Weapon(SHOTGUN);
    w.ammo = 1;
    simulate(w, 0.05, { trigger: true });
    expect(w.action).toBe('shellStart');
    const r = SHOTGUN.reload as ShellReload;
    const ev = simulate(w, r.start + r.perShell * SHOTGUN.magazine + r.end + SHOTGUN.cycleTime + 0.1);
    expect(w.ammo).toBe(SHOTGUN.magazine);
    expect(cues(ev)).toEqual(['pump_back', 'pump_fwd']);
    expect(w.action).toBe('idle');
  });

  it('loses damage with distance', () => {
    expect(damageAt(SHOTGUN, 3)).toBe(SHOTGUN.damage);
    expect(damageAt(SHOTGUN, 40)).toBeCloseTo(SHOTGUN.damage * SHOTGUN.falloff.minScale, 6);
    expect(damageAt(SHOTGUN, 15)).toBeLessThan(SHOTGUN.damage);
  });
});

describe('Sniper rifle', () => {
  it('works the bolt after every shot and takes the eye off the scope while doing it', () => {
    const w = new Weapon(SNIPER);
    simulate(w, SNIPER.adsTime + 0.05, { aim: true });
    expect(w.ads).toBe(1);
    const ev = simulate(w, 0.05, { aim: true, trigger: true });
    expect(count(ev, 'fire')).toBe(1);
    expect(w.action).toBe('cycle');
    const cyc = simulate(w, SNIPER.cycleTime, { aim: true });
    expect(cues(cyc)).toEqual(['bolt_up', 'bolt_back', 'eject', 'bolt_fwd', 'bolt_down']);
    expect(w.ads).toBeLessThan(1);
    simulate(w, SNIPER.adsTime + 0.05, { aim: true });
    expect(w.ads).toBe(1);
  });

  it('is pin-point when scoped and still, wild from the hip', () => {
    const w = new Weapon(SNIPER);
    expect(w.spread({ moveFactor: 0, airborne: false })).toBeGreaterThan(4);
    simulate(w, SNIPER.adsTime + 0.05, { aim: true });
    expect(w.spread({ moveFactor: 0, airborne: false })).toBe(0);
    expect(SNIPER.scope).toBe(true);
    expect(SNIPER.adsFovScale).toBeLessThan(0.3);
  });

  it('reloads its box magazine and works the bolt when it was empty', () => {
    const r = SNIPER.reload as MagazineReload;
    const w = new Weapon(SNIPER);
    w.ammo = 1;
    simulate(w, 0.05, { trigger: true });
    expect(w.action).toBe('reloadEmpty');
    expect(cues(simulate(w, r.emptyTime))).toEqual(['mag_out', 'mag_in', 'bolt_up', 'bolt_back', 'bolt_fwd', 'bolt_down']);
    expect(w.ammo).toBe(SNIPER.magazine);
  });
});

describe('Loadout', () => {
  it('holds a rifle, a shotgun and a sniper rifle in slots 1-3', () => {
    const l = new Loadout();
    expect(l.weapons.map((w) => w.stats.id)).toEqual(['rifle', 'shotgun', 'sniper']);
    expect(WEAPONS.map((w) => w.slot)).toEqual([1, 2, 3]);
    expect(l.current.stats.id).toBe('rifle');
  });

  it('switches by holstering then equipping, keeping each magazine', () => {
    const l = new Loadout();
    simulate(l, 0.3, { trigger: true });
    const rifleAmmo = l.current.ammo;
    expect(rifleAmmo).toBeLessThan(RIFLE.magazine);
    const ev: WeaponEvent[] = [];
    l.select(2, ev);
    expect(l.switchingTo).toBe(2);
    // no shooting while switching
    expect(count(simulate(l, RIFLE.holsterTime + 0.02, { trigger: true }), 'fire')).toBe(0);
    expect(l.current.stats.id).toBe('sniper');
    expect(l.current.action).toBe('equip');
    simulate(l, SNIPER.equipTime + 0.02);
    expect(l.current.action).toBe('idle');
    l.selectPrevious();
    simulate(l, SNIPER.holsterTime + RIFLE.equipTime + 0.05);
    expect(l.current.stats.id).toBe('rifle');
    expect(l.current.ammo).toBe(rifleAmmo);
  });

  it('abandons a reload when switching away', () => {
    const l = new Loadout();
    simulate(l, 0.3, { trigger: true });
    simulate(l, 0.05, { reloadPressed: true });
    expect(l.current.reloading).toBe(true);
    l.select(1);
    simulate(l, RIFLE.holsterTime + 0.02);
    expect(l.weapons[0].reloading).toBe(false);
    expect(l.current.stats.id).toBe('shotgun');
  });

  it('cycles with the mouse wheel and wraps around', () => {
    const l = new Loadout();
    l.cycle(-1);
    simulate(l, 1);
    expect(l.current.stats.id).toBe('sniper');
    l.cycle(1);
    simulate(l, 1);
    expect(l.current.stats.id).toBe('rifle');
  });
});

describe('spread', () => {
  it('keeps directions inside the cone', () => {
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dir = { x: 0, y: 0, z: -1 };
    for (let i = 0; i < 500; i++) {
      const d = applySpread(dir, 2, rand);
      const angle = (Math.acos(-d.z) * 180) / Math.PI;
      expect(angle).toBeLessThanOrEqual(2.0001);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
  });
});
