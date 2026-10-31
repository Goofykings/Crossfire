import { expect, it } from 'vitest';
import { LastUsedWeapon } from '../src/config/lastUsedWeapon';

it('persists only the weapon actually recorded by gameplay, independently of the pending loadout', () => {
  const values = new Map<string, string>([['crossfire.pending-weapon', 'rifle']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const last = new LastUsedWeapon(storage);
  expect(last.value).toBeNull();
  last.remember('shotgun');
  values.set('crossfire.pending-weapon', 'sniper');
  expect(new LastUsedWeapon(storage).value).toBe('shotgun');
  last.remember('smg');
  expect(new LastUsedWeapon(storage).value).toBe('smg');
});

it('keeps a temporary preference when storage is unavailable or invalid', () => {
  const invalid = new LastUsedWeapon({ getItem: () => 'unknown', setItem: () => { throw new Error('denied'); } });
  expect(invalid.value).toBeNull();
  invalid.remember('sniper');
  expect(invalid.value).toBe('sniper');
});
