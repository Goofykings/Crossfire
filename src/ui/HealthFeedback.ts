/** Snapshot-only health observation. Spawn, size changes and out-of-order frames are not healing. */
export interface ConfirmedHealth { id: string; life: number; round: number; at: number; health: number; max: number; alive: boolean }
export class HealthFeedback {
  private previous: ConfirmedHealth | null = null;
  observe(next: ConfirmedHealth): { damage: number; healed: boolean; full: boolean } {
    const old = this.previous;
    if (old && next.round === old.round && next.id === old.id && next.life === old.life && next.at <= old.at)
      return { damage: 0, healed: false, full: false };
    this.previous = { ...next };
    const continuous = old && old.id === next.id && old.life === next.life && old.round === next.round
      && old.alive && next.alive && old.max === next.max;
    return { damage: continuous ? Math.max(0, old.health - next.health) : 0,
      healed: !!continuous && next.health > old.health, full: next.health >= next.max || !next.alive };
  }
  clear(): void { this.previous = null; }
}
