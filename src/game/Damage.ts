import type { Point3, SafeZoneSystem } from './SafeZones';

/** Anything that can take damage: players (future), practice targets, destructibles. */
export interface Damageable {
  readonly id: string;
  /** World position used for safe-zone checks (body centre). */
  position(): Point3;
  /** Body radius; a target whose body overlaps a safe zone is protected. */
  readonly bodyRadius: number;
  applyDamage(amount: number, info: DamageInfo): void;
  readonly alive: boolean;
}

export interface Attacker {
  readonly id: string;
  position(): Point3;
  readonly bodyRadius: number;
}

export interface DamageInfo {
  amount: number;
  attackerId: string;
  point: Point3;
  /** e.g. 'body' | 'bullseye' */
  zone: string;
}

export type DamageResult =
  | { applied: true; amount: number }
  | { applied: false; reason: 'attacker-in-safe-zone' | 'target-in-safe-zone' | 'target-dead' };

/**
 * Central authority for damage. All damage must go through `tryApply` so the safe-zone rule cannot
 * be bypassed: damage is blocked whenever EITHER the attacker or the target overlaps a safe zone,
 * which also stops players from firing out of (or into) a zone across its boundary.
 */
export class DamageSystem {
  constructor(private readonly zones: SafeZoneSystem) {}

  check(attacker: Attacker, target: Damageable): DamageResult | null {
    if (!target.alive) return { applied: false, reason: 'target-dead' };
    if (this.zones.isProtected(attacker.position(), attacker.bodyRadius)) {
      return { applied: false, reason: 'attacker-in-safe-zone' };
    }
    if (this.zones.isProtected(target.position(), target.bodyRadius)) {
      return { applied: false, reason: 'target-in-safe-zone' };
    }
    return null;
  }

  tryApply(attacker: Attacker, target: Damageable, info: Omit<DamageInfo, 'attackerId'>): DamageResult {
    const blocked = this.check(attacker, target);
    if (blocked) return blocked;
    const amount = Math.max(0, info.amount);
    target.applyDamage(amount, { ...info, amount, attackerId: attacker.id });
    return { applied: true, amount };
  }
}
