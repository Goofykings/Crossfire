import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/config/constants';
import { applySpread, PULSE_CARBINE, Weapon, type WeaponEvent, type WeaponInput } from '../src/weapons/Weapon';

const idle: WeaponInput = {
  trigger: false,
  triggerPressed: false,
  reloadPressed: false,
  aim: false,
  moveFactor: 0,
  airborne: false,
  sprinting: false,
};

function simulate(w: Weapon, seconds: number, input: Partial<WeaponInput>): WeaponEvent[] {
  const all: WeaponEvent[] = [];
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) w.update(FIXED_DT, { ...idle, ...input, triggerPressed: i === 0 && !!input.trigger }, all);
  return all;
}

describe('Weapon', () => {
  it('fires at the configured rate', () => {
    const w = new Weapon();
    const ev = simulate(w, 1.0, { trigger: true });
    const shots = ev.filter((e) => e.type === 'fire').length;
    expect(shots).toBeGreaterThanOrEqual(10);
    expect(shots).toBeLessThanOrEqual(11);
    expect(w.ammo).toBe(PULSE_CARBINE.magazine - shots);
  });

  it('reloads from reserve and keeps the totals consistent', () => {
    const w = new Weapon();
    simulate(w, 0.5, { trigger: true });
    const before = w.ammo + w.reserve;
    simulate(w, 0.05, { reloadPressed: true });
    expect(w.reloading).toBe(true);
    // cannot fire while reloading
    const during = simulate(w, 0.5, { trigger: true });
    expect(during.some((e) => e.type === 'fire')).toBe(false);
    simulate(w, PULSE_CARBINE.reloadTime, {});
    expect(w.reloading).toBe(false);
    expect(w.ammo).toBe(PULSE_CARBINE.magazine);
    expect(w.ammo + w.reserve).toBe(before);
  });

  it('auto-reloads after the magazine runs dry and clicks when everything is empty', () => {
    const w = new Weapon();
    w.reserve = 0;
    const ev = simulate(w, 4, { trigger: true });
    expect(ev.filter((e) => e.type === 'fire').length).toBe(PULSE_CARBINE.magazine);
    expect(ev.some((e) => e.type === 'empty')).toBe(true);
    expect(ev.some((e) => e.type === 'reloadStart')).toBe(false);
  });

  it('aims down sights smoothly and tightens spread', () => {
    const w = new Weapon();
    const hip = w.spread({ moveFactor: 0, airborne: false });
    simulate(w, PULSE_CARBINE.adsTime / 2, { aim: true });
    expect(w.ads).toBeGreaterThan(0.3);
    expect(w.ads).toBeLessThan(0.7);
    simulate(w, PULSE_CARBINE.adsTime, { aim: true });
    expect(w.ads).toBe(1);
    expect(w.spread({ moveFactor: 0, airborne: false })).toBeLessThan(hip / 4);
  });

  it('does not fire while sprinting', () => {
    const w = new Weapon();
    const ev = simulate(w, 0.5, { trigger: true, sprinting: true });
    expect(ev.some((e) => e.type === 'fire')).toBe(false);
  });

  it('keeps spread directions inside the cone', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const dir = { x: 0, y: 0, z: -1 };
    for (let i = 0; i < 500; i++) {
      const d = applySpread(dir, 2, rand);
      const angle = (Math.acos(-d.z) * 180) / Math.PI;
      expect(angle).toBeLessThanOrEqual(2.0001);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
  });
});
