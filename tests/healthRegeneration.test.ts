import { expect, it } from 'vitest';
import { regenerate, REGEN_DELAY_MS, type RegeneratingHealth } from '../server/src/health';

const hurt = (health = 40, at = 1000): RegeneratingHealth => ({ alive: true, health, regenAt: at + REGEN_DELAY_MS });
it('waits five full seconds then earns 1 HP per complete 100ms, including batched elapsed time', () => {
  const s = hurt();
  for (const now of [1000, 5999, 6000, 6099]) { regenerate(s, now); expect(s.health).toBe(40); }
  expect(regenerate(s, 6100)).toBe(1); expect(s.health).toBe(41);
  regenerate(s, 9000); expect(s.health).toBe(70);
  regenerate(s, 9099); expect(s.health).toBe(70);
  regenerate(s, 9100); expect(s.health).toBe(71);
});
it('is independent of tick frequency and cannot double-count elapsed time after persistence', () => {
  const frequent = hurt(), sparse = hurt();
  for (let now = 1000; now <= 9250; now += 17) regenerate(frequent, now);
  regenerate(frequent, 9250); regenerate(sparse, 9250);
  expect(frequent).toEqual(sparse);
  const restored = JSON.parse(JSON.stringify(sparse));
  expect(regenerate(restored, 9250)).toBe(0);
  expect(regenerate(restored, 9000)).toBe(0);
  regenerate(restored, 10000); expect(restored.health).toBe(80);
});
it('resets the full delay on every hit and immediately interrupts active regeneration', () => {
  const s = hurt(); s.health -= 10; s.regenAt = 5000 + REGEN_DELAY_MS;
  regenerate(s, 9999); expect(s.health).toBe(30);
  regenerate(s, 11100); expect(s.health).toBe(41);
  s.health -= 20; s.regenAt = 11100 + REGEN_DELAY_MS;
  regenerate(s, 16100); expect(s.health).toBe(21);
  regenerate(s, 16200); expect(s.health).toBe(22);
});
it('caps at 100 with fractional damage and cancels regeneration for dead/unspawned/full lives', () => {
  const s = hurt(99.5); expect(regenerate(s, 1000000)).toBe(.5);
  expect(s.health).toBe(100); expect(s.regenAt).toBeNull();
  const dead = { ...hurt(0), alive: false }; regenerate(dead, 1000000);
  expect(dead.health).toBe(0); expect(dead.regenAt).toBeNull();
  const fresh = { alive: true, health: 100, regenAt: null };
  regenerate(fresh, 1000000); expect(fresh.health).toBe(100);
});
