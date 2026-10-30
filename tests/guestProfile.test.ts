import { describe, expect, it } from 'vitest';
import { GuestProfileStore, GUEST_PROFILE_KEY } from '../src/config/guestProfile';
import { normalizeUsername } from '../shared/username';
import { parseClientMessage } from '../shared/protocol';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('local guest profile', () => {
  it('generates a random ID, persists the chosen username, and restores it without changing other settings', () => {
    const disk = storage();
    disk.setItem('crossfire.settings.v1', '{"masterVolume":0.3}');
    const a = new GuestProfileStore(disk);
    const id = a.value.guestId;
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(a.value.username).toBe('');
    expect(a.setUsername('  Alice  ')).toBe(true);
    expect(new GuestProfileStore(disk).value).toEqual({ guestId: id, username: 'Alice' });
    expect(disk.getItem('crossfire.settings.v1')).toBe('{"masterVolume":0.3}');
    a.setUsername('Bob');
    expect(a.value.guestId).toBe(id);
    expect(new GuestProfileStore(disk).value.username).toBe('Bob');
  });
  it('creates a fresh unnamed guest after clearing or corrupting browser data', () => {
    const disk = storage(); const first = new GuestProfileStore(disk);
    first.setUsername('Old name'); disk.values.clear();
    const fresh = new GuestProfileStore(disk);
    expect(fresh.value.guestId).not.toBe(first.value.guestId);
    expect(fresh.value.username).toBe('');
    for (const raw of ['not json', '{}', '{"guestId":"forged","username":"Alice"}']) {
      disk.setItem(GUEST_PROFILE_KEY, raw);
      const p = new GuestProfileStore(disk);
      expect(p.value.username).toBe(''); expect(p.value.guestId).not.toBe('forged');
    }
  });
  it('supports temporary guests when storage is missing or throws during reads/writes', () => {
    for (const disk of [null, { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } },
      { getItem: () => null, setItem: () => { throw new Error('full'); } }]) {
      const p = new GuestProfileStore(disk); const id = p.value.guestId;
      expect(p.setUsername('Temporary')).toBe(true);
      expect(p.value).toEqual({ guestId: id, username: 'Temporary' });
      expect(p.setUsername(' <>\u0000 ')).toBe(false);
      expect(p.value.username).toBe('Temporary');
    }
  });
  it('uses the server name policy without cutting Unicode characters in half', () => {
    expect(normalizeUsername('  <Ａlice>\u0000  ')).toBe('Alice');
    expect(normalizeUsername(' <> ')).toBeNull();
    expect(normalizeUsername('界'.repeat(30))).toBe('界'.repeat(24));
    expect(Array.from(normalizeUsername('😀'.repeat(30))!)).toHaveLength(24);
  });
  it('never accepts local guest IDs or client-selected session IDs in the join protocol', () => {
    const join = { v: 6, type: 'join', name: 'Alice' };
    expect(parseClientMessage(JSON.stringify(join))).toEqual(join);
    for (const fields of [{ guestId: crypto.randomUUID() }, { id: crypto.randomUUID() }, { sessionId: crypto.randomUUID() }]) {
      expect(parseClientMessage(JSON.stringify({ ...join, ...fields }))).toBeNull();
    }
    expect(parseClientMessage(JSON.stringify({ ...join, resumeToken: crypto.randomUUID() }))).toBeNull();
  });
});
