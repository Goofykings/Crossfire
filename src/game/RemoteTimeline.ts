import type { WeaponAction, WeaponState } from '../weapons/Weapon';

/** Remote players are drawn on a delayed timeline (interpolated snapshots). These helpers put
 * cosmetic events on that same timeline; gameplay, damage and audio are never delayed. */

/** Action and progress at the rendered (interpolated) time. A snapshot reports how long its
 * action has been running, so the start is known even when it began between two samples. */
export function presentedAction(older: { at: number; gun: WeaponState | null }, newer: { at: number; gun: WeaponState | null },
  renderTime: number): { action: WeaponAction; progress: number } | null {
  const a = older.gun, b = newer.gun;
  if (!b) return null;
  const startedAt = newer.at - b.time * 1000;
  const progress = (gun: WeaponState, elapsed: number) => gun.duration > 0 ? Math.max(0, Math.min(1, elapsed / gun.duration)) : 0;
  if (!a || renderTime >= startedAt) return { action: b.action, progress: progress(b, b.time - (newer.at - renderTime) / 1000) };
  // Still inside the older sample's action: continue it by elapsed time.
  return { action: a.action, progress: progress(a, a.time + (renderTime - older.at) / 1000) };
}

interface QueuedShot { at: number; stamped: boolean; received: number }

/** Server-confirmed shots for one remote player, released when the rendered pose reaches
 * them. The Worker publishes a tick's shot events immediately before that tick's snapshot,
 * so unstamped shots take the next snapshot's server time (spaced at the weapon's cadence
 * inside the tick). Until then they carry the estimated arrival time. Late shots play at
 * once but never closer than half the cadence, so a delayed burst keeps its rhythm. */
export class ShotTimeline {
  private readonly queue: QueuedShot[] = [];
  private lastStamp: number | null = null;
  private lastPresented = -Infinity;
  private interval = 100;
  /** Last presented shots (server-clock ms): arrival estimate, timeline stamp, render time. */
  private readonly history: { received: number; at: number; presented: number }[] = [];
  static readonly MAX_QUEUED = 24;
  /** Older shots are dropped instead of replaying a long backlog after a stall. */
  static readonly MAX_LATE_MS = 600;

  /** A shot event arrived; `serverNow` is the estimated current server time. */
  receive(serverNow: number, intervalMs: number): void {
    this.interval = Math.max(16, intervalMs);
    const last = this.queue.at(-1)?.at ?? -Infinity;
    this.queue.push({ at: Math.max(serverNow, last), stamped: false, received: serverNow });
    if (this.queue.length > ShotTimeline.MAX_QUEUED) this.queue.shift();
  }
  /** A snapshot that contains this shooter, stamped with the server tick time. */
  stamp(serverTime: number): void {
    const fresh = this.queue.filter((s) => !s.stamped);
    if (fresh.length) {
      const floor = Math.max(this.lastStamp ?? -Infinity, this.queue.filter((s) => s.stamped).at(-1)?.at ?? -Infinity);
      const room = Number.isFinite(floor) ? Math.max(0, serverTime - floor) : fresh.length * this.interval;
      const spacing = Math.min(this.interval, room / fresh.length);
      fresh.forEach((shot, i) => { shot.at = serverTime - (fresh.length - 1 - i) * spacing; shot.stamped = true; });
    }
    this.lastStamp = Math.max(this.lastStamp ?? -Infinity, serverTime);
  }
  /** Number of recoil impulses to present now. */
  due(renderTime: number): number {
    while (this.queue.length && this.queue[0].at < renderTime - ShotTimeline.MAX_LATE_MS) this.queue.shift();
    if (!this.queue.length || this.queue[0].at > renderTime) return 0;
    if (renderTime - this.lastPresented < this.interval * .5) return 0;
    const shot = this.queue.shift()!;
    this.lastPresented = renderTime;
    this.history.push({ received: shot.received, at: shot.at, presented: renderTime });
    if (this.history.length > 8) this.history.shift();
    return 1;
  }
  get pending(): number { return this.queue.length; }
  inspect() {
    return { pending: this.queue.map((s) => ({ at: s.at, stamped: s.stamped })), lastStamp: this.lastStamp, interval: this.interval,
      history: this.history.map((h) => ({ ...h })) };
  }
}
