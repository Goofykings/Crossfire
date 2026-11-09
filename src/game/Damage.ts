import { WEAPONS } from '../weapons/Weapon';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where a hit landed. Headshots deal HEADSHOT_MULTIPLIER x the body damage. */
export type HitZone = 'head' | 'body';

/** Default head multiplier; explicit weapon overrides replace it. */
export const HEADSHOT_MULTIPLIER = 1.5;

/** Anything that can take damage: authoritative players or local practice targets. */
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
export function zoneDamage(bodyDamage: number, zone: HitZone, headshotDamage?: number): number {
  return zone === 'head' && headshotDamage !== undefined ? headshotDamage
    : Math.max(0, bodyDamage) * (zone === 'head' ? HEADSHOT_MULTIPLIER : 1);
}

/**
 * Central authority for damage. `tryApply` resolves the shared weapon's head rule;
 * clients never supply overrides. Multiplayer eligibility, world obstruction and friendly-fire checks
 * are enforced by the Worker before this shared damage rule; practice is local FFA.
 */
export class DamageSystem {
  tryApply(attacker: Attacker, target: Damageable, hit: { bodyDamage: number; point: Point3; zone: HitZone; weapon: string }): DamageResult {
    if (!target.alive) return { applied: false, reason: 'target-dead' };
    const amount = zoneDamage(hit.bodyDamage, hit.zone, WEAPONS.find(w=>w.id===hit.weapon)?.headshotDamage);
    target.applyDamage(amount, { amount, attackerId: attacker.id, point: hit.point, zone: hit.zone, weapon: hit.weapon });
    return { applied: true, amount, zone: hit.zone };
  }
}
