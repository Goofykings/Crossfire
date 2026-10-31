import { validWeapon } from '../../shared/protocol';
import type { WeaponId } from '../weapons/Weapon';

const KEY = 'crossfire.last-used-weapon';

/** A presentation preference, updated only when a weapon becomes active in play. */
export class LastUsedWeapon {
  private current: WeaponId | null = null;
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = LastUsedWeapon.safeStorage()) {
    try { const value = storage?.getItem(KEY); if (validWeapon(value)) this.current = value; } catch { /* In-memory preference. */ }
  }
  private static safeStorage(): Storage | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
  }
  get value(): WeaponId | null { return this.current; }
  remember(weapon: WeaponId): void {
    if (this.current === weapon) return;
    this.current = weapon;
    try { this.storage?.setItem(KEY, weapon); } catch { /* In-memory preference. */ }
  }
}
