import { MOVEMENT } from '../src/config/constants';
import type { ControllerState, Vec3 } from '../src/player/PlayerController';
import type { HitZone } from '../src/game/Damage';

export type MatchMode = 'ffa' | 'teams';
export type PlayerTeam = 'blue' | 'red' | null;
export interface CombatIntent { trigger: boolean; reload: boolean }
export const NO_COMBAT: CombatIntent = { trigger: false, reload: false };

/** Teams are relative to the viewer; an unassigned participant is never a teammate. */
export const teammates = (mode: MatchMode | null, a: PlayerTeam, b: PlayerTeam): boolean =>
  mode === 'teams' && a !== null && a === b;

/** Server-seeded and stable across eviction/restart, with no client mode selection. */
export function roundMode(seed: number, roundId: number): MatchMode {
  let h = (seed ^ Math.imul(roundId + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) & 1 ? 'teams' : 'ffa';
}

export function playerHeight(m: ControllerState): number {
  return MOVEMENT.standHeight + (MOVEMENT.crouchHeight - MOVEMENT.standHeight) * m.crouch;
}

function sphere(origin: Vec3, dir: Vec3, c: Vec3, r: number): number | null {
  const x = origin.x - c.x, y = origin.y - c.y, z = origin.z - c.z;
  const b = x * dir.x + y * dir.y + z * dir.z;
  const d = b * b - (x * x + y * y + z * z - r * r);
  if (d < 0) return null;
  const near = -b - Math.sqrt(d), far = -b + Math.sqrt(d);
  return far < 0 ? null : Math.max(0, near);
}

/** Exact upright torso cylinder and head sphere; the server computes these from its own motion. */
export function rayPlayer(origin: Vec3, dir: Vec3, m: ControllerState): { distance: number; zone: HitZone } | null {
  const h = playerHeight(m), p = m.position;
  const head = sphere(origin, dir, { x: p.x, y: p.y + h - .2, z: p.z }, .2);
  const y0 = p.y + .05, y1 = p.y + h - .4, r = MOVEMENT.radius;
  const x = origin.x - p.x, z = origin.z - p.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  const b = x * dir.x + z * dir.z, c = x * x + z * z - r * r;
  const hits: number[] = [];
  if (a > 1e-10) {
    const d = b * b - a * c;
    if (d >= 0) for (const t of [(-b - Math.sqrt(d)) / a, (-b + Math.sqrt(d)) / a]) {
      const y = origin.y + dir.y * t;
      if (t >= 0 && y >= y0 && y <= y1) hits.push(t);
    }
  }
  if (Math.abs(dir.y) > 1e-10) for (const y of [y0, y1]) {
    const t = (y - origin.y) / dir.y;
    if (t >= 0 && (x + dir.x * t) ** 2 + (z + dir.z * t) ** 2 <= r * r) hits.push(t);
  }
  const body = hits.length ? Math.min(...hits) : Infinity;
  if (head !== null && head <= body) return { distance: head, zone: 'head' };
  return body < Infinity ? { distance: body, zone: 'body' } : null;
}
