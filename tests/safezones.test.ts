import { describe, expect, it } from 'vitest';
import { DamageSystem, type Attacker, type Damageable, type DamageInfo } from '../src/game/Damage';
import { SafeZoneSystem, type Point3 } from '../src/game/SafeZones';

const zones = new SafeZoneSystem([
  { id: 'safe_blue', team: 'blue', rect: [-33, -7, -25, 7], height: 6 },
  { id: 'safe_red', team: 'red', rect: [25, -7, 33, 7], height: 6 },
]);

function attacker(p: Point3, r = 0.34): Attacker {
  return { id: 'a', position: () => p, bodyRadius: r };
}

class Dummy implements Damageable {
  readonly id = 'dummy';
  health = 100;
  readonly bodyRadius: number;
  constructor(private readonly p: Point3, r = 0.34) {
    this.bodyRadius = r;
  }
  position() {
    return this.p;
  }
  get alive() {
    return this.health > 0;
  }
  applyDamage(amount: number, _info: DamageInfo) {
    this.health -= amount;
  }
}

const hit = { amount: 34, point: { x: 0, y: 1, z: 0 }, zone: 'body' };

describe('safe zones', () => {
  const dmg = new DamageSystem(zones);

  it('allows damage between two players outside any zone', () => {
    const t = new Dummy({ x: 0, y: 1, z: 0 });
    expect(dmg.tryApply(attacker({ x: -10, y: 1, z: 0 }), t, hit)).toEqual({ applied: true, amount: 34 });
    expect(t.health).toBe(66);
  });

  it('blocks damage when the attacker is inside a safe zone', () => {
    const t = new Dummy({ x: 0, y: 1, z: 0 });
    const r = dmg.tryApply(attacker({ x: -29, y: 1, z: 0 }), t, hit);
    expect(r).toEqual({ applied: false, reason: 'attacker-in-safe-zone' });
    expect(t.health).toBe(100);
  });

  it('blocks damage when the target is inside a safe zone', () => {
    const t = new Dummy({ x: 29, y: 1, z: 0 });
    expect(dmg.tryApply(attacker({ x: 0, y: 1, z: 0 }), t, hit)).toEqual({ applied: false, reason: 'target-in-safe-zone' });
    expect(t.health).toBe(100);
  });

  it('blocks boundary exploits: a body straddling the edge counts as inside', () => {
    // centre 0.2 m outside the blue zone's east edge (x = -25) but the 0.34 m body overlaps it
    const edge = attacker({ x: -24.8, y: 1, z: 0 });
    const t = new Dummy({ x: 0, y: 1, z: 0 });
    expect(dmg.tryApply(edge, t, hit).applied).toBe(false);
    // and a target hugging the red zone edge from outside is protected too
    const hugging = new Dummy({ x: 24.75, y: 1, z: 3 });
    expect(dmg.tryApply(attacker({ x: 0, y: 1, z: 0 }), hugging, hit).applied).toBe(false);
  });

  it('applies damage right after leaving the zone', () => {
    const t = new Dummy({ x: 0, y: 1, z: 0 });
    expect(dmg.tryApply(attacker({ x: -24.5, y: 1, z: 0 }), t, hit).applied).toBe(true);
  });

  it('respects zone height', () => {
    expect(zones.isProtected({ x: -29, y: 7, z: 0 })).toBe(false);
    expect(zones.isProtected({ x: -29, y: 5.9, z: 0 })).toBe(true);
  });

  it('never damages dead targets', () => {
    const t = new Dummy({ x: 0, y: 1, z: 0 });
    t.health = 0;
    expect(dmg.tryApply(attacker({ x: 5, y: 1, z: 0 }), t, hit)).toEqual({ applied: false, reason: 'target-dead' });
  });
});
