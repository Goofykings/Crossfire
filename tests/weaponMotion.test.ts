import { describe, expect, it } from 'vitest';
import { DampedSpring } from '../src/core/DampedSpring';
import { WeaponMotion, type MotionInput } from '../src/weapons/WeaponMotion';
import { RIG_CONFIGS } from '../src/weapons/WeaponView';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { FIXED_DT } from '../src/config/constants';

const idle: MotionInput = { speed: 0, grounded: true, sliding: false, crouch: 0, ads: 0, sprinting: false };
it('peeking emphasizes the gun rather than camera roll, preserves ADS centering, and eases back',()=>{
 const a=new WeaponMotion();advance(a,.4,{...idle,lean:1});expect(a.pose.roll).toBeLessThan(-.17);expect(a.pose.x).toBeGreaterThan(.02);
 advance(a,.4,{...idle,lean:-1});expect(a.pose.roll).toBeGreaterThan(.17);
 advance(a,.6,{...idle,ads:1,lean:1});expect(Math.abs(a.pose.x)).toBeLessThan(.00001);expect(a.pose.roll).toBeCloseTo(-.19,3);
 advance(a,.6,{...idle,ads:1,lean:0});expect(Math.abs(a.pose.roll)).toBeLessThan(.0001);
});
function advance(m: WeaponMotion, seconds: number, input = idle, fps = 120) {
  for (let i = 0; i < Math.round(seconds * fps); i++) m.update(1 / fps, input);
  return { ...m.pose };
}

describe('layered weapon motion', () => {
  it('has slow, bounded idle movement and blends continuously into and out of walking', () => {
    const m = new WeaponMotion(), samples = [];
    for (let i = 0; i < 504; i++) samples.push({ ...m.update(1 / 120, idle) });
    expect(Math.max(...samples.map((s) => s.x)) - Math.min(...samples.map((s) => s.x))).toBeGreaterThan(.006);
    expect(Math.max(...samples.map((s) => Math.abs(s.y)))).toBeLessThan(.003);
    const before = { ...m.pose };
    m.update(1 / 120, { ...idle, speed: 4.7 });
    expect(Math.abs(m.pose.x - before.x)).toBeLessThan(.002);
    advance(m, 1, { ...idle, speed: 4.7 });
    expect(m.debug.walk).toBeGreaterThan(.99);
    advance(m, 1);
    expect(m.debug.walk).toBeLessThan(.001);
  });

  it.each(Object.values(RIG_CONFIGS))('$id recoils as a whole and returns without accumulation', ({ kick }) => {
    const m = new WeaponMotion();
    for (let i = 0; i < 30; i++) { m.fire(kick); advance(m, .06); }
    expect(m.pose.z).toBeGreaterThan(.005);
    expect(m.pose.z).toBeLessThanOrEqual(.075);
    advance(m, 1);
    expect(Math.abs(m.pose.z)).toBeLessThan(.00001);
    expect(Math.abs(m.pose.pitch)).toBeLessThan(.00001);
  });

  it('preserves the exact ADS optical axis through sway, crouch, sliding, landing and firing', () => {
    const m = new WeaponMotion(); m.addSway(100, -80); m.fire(2); m.land(8);
    const pose = advance(m, .05, { ...idle, speed: 7.8, sliding: true, crouch: 1, ads: 1 });
    expect(pose.x).toBe(0); expect(pose.y).toBe(0);
    expect(pose.pitch).toBe(0); expect(pose.yaw).toBe(0); expect(pose.roll).toBe(0);
    expect(pose.z).toBeGreaterThan(0);
    advance(m, 1, { ...idle, ads: 1 }); expect(m.pose.z).toBeLessThan(.00001);
  });

  it('lands downwards, rebounds and settles instead of retriggering on stairs', () => {
    const m = new WeaponMotion(), baseline = new WeaponMotion(); m.land(6.6);
    const heights = Array.from({ length: 180 }, () => m.update(1 / 120, idle).y - baseline.update(1 / 120, idle).y);
    expect(Math.min(...heights)).toBeLessThan(-.01);
    expect(Math.max(...heights.slice(30))).toBeGreaterThan(0);
    expect(Math.abs(m.debug.landing)).toBeLessThan(.00001);
  });

  it('eases upwards during ascent and blends back into the existing landing spring', () => {
    const m = new WeaponMotion(), baseline = new WeaponMotion();
    const rising = { ...idle, grounded: false, verticalSpeed: 6 };
    const first = m.update(1 / 60, rising).y - baseline.update(1 / 60, idle).y;
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(.004);
    advance(m, .4, rising); advance(baseline, .4);
    expect(m.pose.y - baseline.pose.y).toBeGreaterThan(.01);
    advance(m, .5, { ...idle, grounded: false, verticalSpeed: -4 }); advance(baseline, .5);
    m.land(6.6); const heights: number[] = [];
    for (let i = 0; i < 240; i++) heights.push(m.update(1 / 120, idle).y - baseline.update(1 / 120, idle).y);
    expect(Math.min(...heights)).toBeLessThan(-.005);
    expect(Math.abs(m.debug.rise)).toBeLessThan(.00001);
    expect(Math.abs(m.debug.landing)).toBeLessThan(.00001);
    const ads = new WeaponMotion(); advance(ads, .4, { ...rising, ads: 1 }); expect(ads.pose.y).toBe(0);
  });

  it('uses elapsed time for the rise blend at different frame rates', () => {
    const values = [30, 60, 144].map((fps) => {
      const m = new WeaponMotion(); advance(m, .5, { ...idle, grounded: false, verticalSpeed: 4 }, fps); return m.debug.rise;
    });
    expect(values[0]).toBeCloseTo(values[1], 10); expect(values[1]).toBeCloseTo(values[2], 10);
  });

  it('has consistent recoil/landing recovery at 30, 60 and 144 FPS and survives long frames', () => {
    const run = (fps: number) => {
      const m = new WeaponMotion(); m.fire(2); m.land(7);
      advance(m, .5, idle, fps); return { ...m.debug };
    };
    expect(run(30).recoil).toBeCloseTo(run(144).recoil, 10);
    expect(run(60).landing).toBeCloseTo(run(144).landing, 10);
    const m = new WeaponMotion(); m.fire(2); m.land(7); m.update(.25, idle);
    expect(Object.values(m.pose).every(Number.isFinite)).toBe(true);
    advance(m, 1); expect(m.pose.z).toBeLessThan(.00001);
  });

  it('reduces cosmetic motion for the accessibility preference while retaining recoil', () => {
    const normal = new WeaponMotion(), reduced = new WeaponMotion();
    advance(normal, .5); advance(reduced, .5, { ...idle, reducedMotion: true });
    expect(Math.abs(reduced.pose.x)).toBeLessThan(Math.abs(normal.pose.x) * .2);
    reduced.fire(1); advance(reduced, .05, { ...idle, reducedMotion: true });
    expect(reduced.pose.z).toBeGreaterThan(.005);
  });
});

describe('time-based springs', () => {
  it.each([.58, 1])('matches a single elapsed-time update for damping %s', (damping) => {
    const a = new DampedSpring(20, damping), b = new DampedSpring(20, damping);
    a.velocity = b.velocity = 3;
    for (let i = 0; i < 30; i++) a.update(1 / 120);
    b.update(.25);
    expect(a.value).toBeCloseTo(b.value, 12); expect(a.velocity).toBeCloseTo(b.velocity, 12);
  });
});

describe('ground transitions with equipped weapons', () => {
  it.each(Object.keys(RIG_CONFIGS))('%s walks and slides up and down stairs with one landing per jump', (id) => {
    const world = new CollisionWorld();
    world.add({ c: [0, -.5, 0], h: [20, .5, 30] });
    for (let k = 1; k <= 4; k++) world.add({ c: [0, (.18 * k - 1) / 2, -2 - .32 * (k - .5)], h: [2, (.18 * k + 1) / 2, .16] });
    world.add({ c: [0, (.72 - 1) / 2, -10], h: [2, (.72 + 1) / 2, 6.72] });
    for (const slide of [false, true]) {
      const p = new PlayerController(world); p.weaponClearance = id as keyof typeof RIG_CONFIGS;
      p.teleport({ x: 0, y: 0, z: 0 });
      for (let i = 0; i < 300; i++) { p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, slide }); expect(p.landedSpeed).toBe(0); }
      expect(p.position.y).toBeCloseTo(.72); expect(p.position.z).toBeLessThan(-6);
      for (let i = 0; i < 360; i++) { p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: -1 }); expect(p.landedSpeed).toBe(0); }
      expect(p.position.y).toBeCloseTo(0);
    }
  });
});
