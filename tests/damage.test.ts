import { describe, expect, it } from 'vitest';
import { DamageSystem, HEADSHOT_MULTIPLIER, zoneDamage, type Damageable, type DamageInfo } from '../src/game/Damage';
import { damageAt, RIFLE, SHOTGUN, SNIPER } from '../src/weapons/Weapon';

class Dummy implements Damageable {
  health = 100;
  readonly hits: DamageInfo[] = [];
  constructor(readonly id = 'dummy') {}
  get alive(): boolean {
    return this.health > 0;
  }
  position() {
    return { x: 0, y: 1, z: 0 };
  }
  applyDamage(amount: number, info: DamageInfo): void {
    this.health -= amount;
    this.hits.push(info);
  }
}

const attacker = { id: 'player', position: () => ({ x: 0, y: 1, z: 10 }) };
const point = { x: 0, y: 1.6, z: 0 };

describe('damage', () => {
  it('deals 1.5x the body damage to the head, for every weapon', () => {
    expect(HEADSHOT_MULTIPLIER).toBe(1.5);
    for (const w of [RIFLE, SHOTGUN, SNIPER]) {
      expect(zoneDamage(w.damage, 'head')).toBeCloseTo(w.damage * 1.5, 9);
      expect(zoneDamage(w.damage, 'body')).toBe(w.damage);
    }
  });

  it('applies the multiplier centrally, whatever the weapon passes in', () => {
    const ds = new DamageSystem();
    const t = new Dummy();
    const head = ds.tryApply(attacker, t, { bodyDamage: 20, point, zone: 'head', weapon: 'rifle' });
    expect(head).toEqual({ applied: true, amount: 30, zone: 'head' });
    const body = ds.tryApply(attacker, t, { bodyDamage: 20, point, zone: 'body', weapon: 'rifle' });
    expect(body).toEqual({ applied: true, amount: 20, zone: 'body' });
    expect(t.health).toBe(50);
    expect(t.hits.map((h) => [h.zone, h.amount, h.attackerId, h.weapon])).toEqual([
      ['head', 30, 'player', 'rifle'],
      ['body', 20, 'player', 'rifle'],
    ]);
  });

  it('kills a 100-health target with one sniper headshot but not with one body shot', () => {
    const ds = new DamageSystem();
    const a = new Dummy('a');
    ds.tryApply(attacker, a, { bodyDamage: damageAt(SNIPER, 60), point, zone: 'head', weapon: 'sniper' });
    expect(a.alive).toBe(false);
    const b = new Dummy('b');
    ds.tryApply(attacker, b, { bodyDamage: damageAt(SNIPER, 60), point, zone: 'body', weapon: 'sniper' });
    expect(b.alive).toBe(true);
  });

  it('needs four rifle body hits or three headshots, and a point-blank shotgun blast kills', () => {
    const shots = (zone: 'head' | 'body') => Math.ceil(100 / zoneDamage(damageAt(RIFLE, 20), zone));
    expect(shots('body')).toBe(4);
    expect(shots('head')).toBe(3);
    expect(SHOTGUN.pellets * damageAt(SHOTGUN, 4)).toBeGreaterThanOrEqual(100);
    expect(SHOTGUN.pellets * damageAt(SHOTGUN, 30)).toBeLessThan(50);
  });

  it('refuses damage to a dead target', () => {
    const ds = new DamageSystem();
    const t = new Dummy();
    t.health = 0;
    expect(ds.tryApply(attacker, t, { bodyDamage: 50, point, zone: 'body', weapon: 'rifle' })).toEqual({ applied: false, reason: 'target-dead' });
  });
});
