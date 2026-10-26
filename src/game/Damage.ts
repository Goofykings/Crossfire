export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where a hit landed. Headshots deal HEADSHOT_MULTIPLIER x the body damage. */
export type HitZone = 'head' | 'body';

/** Every weapon's headshot damage is this multiple of its body damage at the same range. */
export const HEADSHOT_MULTIPLIER = 1.5;

/** Anything that can take damage: players (future), practice targets, destructibles. */
export interface Damageable {
  readonly id: string;
  /** Body centre. */
  position(): Point3;
  applyDamage(amount: number, info: DamageInfo): void;
  readonly alive: boolean;
}

export interface Attacker {
  readonly id: string;
  position(): Point3;
}

export interface DamageInfo {
  /** Damage actually dealt (after the headshot multiplier). */
  amount: number;
  attackerId: string;
  point: Point3;
  zone: HitZone;
  /** Weapon id, for kill feeds and stats. */
  weapon: string;
}

export type DamageResult = { applied: true; amount: number; zone: HitZone } | { applied: false; reason: 'target-dead' };

/** Damage dealt by a hit with the given body damage in the given zone. */
export function zoneDamage(bodyDamage: number, zone: HitZone): number {
  return Math.max(0, bodyDamage) * (zone === 'head' ? HEADSHOT_MULTIPLIER : 1);
}

/**
 * Central authority for damage. All damage goes through `tryApply`, which applies the headshot rule, so no weapon can
 * bypass it. The maps are free-for-all: there are no safe zones and anyone can damage anyone.
 */
export class DamageSystem {
  tryApply(attacker: Attacker, target: Damageable, hit: { bodyDamage: number; point: Point3; zone: HitZone; weapon: string }): DamageResult {
    if (!target.alive) return { applied: false, reason: 'target-dead' };
    const amount = zoneDamage(hit.bodyDamage, hit.zone);
    target.applyDamage(amount, { amount, attackerId: attacker.id, point: hit.point, zone: hit.zone, weapon: hit.weapon });
    return { applied: true, amount, zone: hit.zone };
  }
}
