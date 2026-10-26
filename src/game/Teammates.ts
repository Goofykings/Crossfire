import type { Team } from '../maps/types';

/** Last known state of another player, as a network layer would report it. */
export interface RemotePlayer {
  id: string;
  name?: string;
  team: Team;
  x: number;
  z: number;
  /** Facing (right-handed yaw, 0 = north), if known. */
  yaw?: number;
  alive?: boolean;
}

interface Entry extends RemotePlayer {
  updatedAt: number;
}

/**
 * Positions of other players for the tactical map. Nothing feeds it yet (there is no multiplayer); a future network
 * client calls `update` whenever a position arrives. Without data the registry is empty, so a solo player only sees
 * themselves. `friendlies` is the only read path the map uses and it never returns the other team, so enemy
 * positions cannot leak onto the map.
 */
export class TeammateRegistry {
  private readonly players = new Map<string, Entry>();
  private readonly staleAfterMs: number;

  constructor(staleAfterMs = 3000) {
    this.staleAfterMs = staleAfterMs;
  }

  update(p: RemotePlayer, now = performance.now()): void {
    this.players.set(p.id, { ...p, updatedAt: now });
  }

  remove(id: string): void {
    this.players.delete(id);
  }

  clear(): void {
    this.players.clear();
  }

  get size(): number {
    return this.players.size;
  }

  /** Living players of `team` other than `selfId` whose position is fresh. Free-for-all (`team` null): nobody. */
  friendlies(team: Team | null, selfId: string, now = performance.now()): RemotePlayer[] {
    const out: RemotePlayer[] = [];
    if (team === null) return out;
    for (const p of this.players.values()) {
      if (p.team !== team || p.id === selfId || p.alive === false) continue;
      if (now - p.updatedAt > this.staleAfterMs) continue;
      out.push(p);
    }
    return out;
  }
}
