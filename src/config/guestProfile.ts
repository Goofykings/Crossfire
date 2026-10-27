import { normalizeUsername } from '../../shared/username';

export const GUEST_PROFILE_KEY = 'crossfire.guest.v1';
export interface GuestProfile { guestId: string; username: string }

/** A local preference, never a multiplayer identity or authentication credential. */
export class GuestProfileStore {
  private current: GuestProfile;
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = GuestProfileStore.safeStorage()) {
    this.current = this.load() ?? { guestId: crypto.randomUUID(), username: '' };
    this.save();
  }
  private static safeStorage(): Storage | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
  }
  get value(): Readonly<GuestProfile> { return this.current; }
  setUsername(value: string): boolean {
    const username = normalizeUsername(value);
    if (!username) return false;
    this.current = { ...this.current, username };
    this.save();
    return true;
  }
  private load(): GuestProfile | null {
    try {
      const raw: unknown = JSON.parse(this.storage?.getItem(GUEST_PROFILE_KEY) ?? 'null');
      if (!raw || typeof raw !== 'object') return null;
      const p = raw as Record<string, unknown>;
      if (typeof p.guestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(p.guestId)
        || typeof p.username !== 'string' || p.username.length > 64) return null;
      return { guestId: p.guestId, username: normalizeUsername(p.username) ?? '' };
    } catch { return null; }
  }
  private save(): void {
    try { this.storage?.setItem(GUEST_PROFILE_KEY, JSON.stringify(this.current)); } catch { /* Temporary in-memory guest. */ }
  }
}
