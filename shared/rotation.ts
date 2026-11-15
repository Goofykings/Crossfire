import { MAP_IDS, ROUND_MS, type MapId, type MapRound, type MapSchedule } from './maps';
import { zoneEligible } from './zoneControl';
import type { MatchMode } from './combat';

/** Every mode the main public lobby cycles through, in the order used to index a random value. */
export const ROTATION_MODES: readonly MatchMode[] = ['ffa', 'teams', 'zone-control'];
export interface RotationPick { mode: MatchMode; mapId: MapId }
export type Random = () => number;

const pickFrom = <T>(list: readonly T[], random: Random): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

/** Maps a mode may be played on: Zone Control needs authored A, B and C squares, the other modes take every map. */
export const modeMaps = (mode: MatchMode): readonly MapId[] => mode === 'zone-control' ? MAP_IDS.filter(zoneEligible) : MAP_IDS;

/**
 * Pure choice of the next public match. `random` supplies uniform values in [0, 1), so tests can drive it exactly.
 * - Mode: equal probability among the modes that have at least one playable map, never the previous mode while another
 *   candidate exists (Zone Control is dropped when no map supports it, rather than starting a broken match).
 * - Map: equal probability among the maps eligible for that mode, never the previous map while another one exists.
 * Two random values are consumed per call (mode, then map), always in that order.
 */
export function pickRotation(previous: RotationPick | null, random: Random): RotationPick {
  const playable = ROTATION_MODES.filter((m) => modeMaps(m).length > 0);
  const fresh = playable.filter((m) => m !== previous?.mode);
  const mode = pickFrom(fresh.length ? fresh : playable, random);
  const maps = modeMaps(mode);
  const others = maps.filter((m) => m !== previous?.mapId);
  return { mode, mapId: pickFrom(others.length ? others : maps, random) };
}

function seeded(seed: number, id: number): Random {
  let n = (seed ^ Math.imul(id + 1, 0x9e3779b9)) >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let x = Math.imul(n ^ (n >>> 15), n | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotation picks are a chain (each avoids its predecessor), so remember the walk instead of redoing it for every call. */
const chains = new Map<number, RotationPick[]>();

/**
 * The pick for one round id of a schedule seed. Round ids only ever grow, the chain is extended on demand (a few hundred
 * thousand cheap steps cover years of ten-minute rounds), and the same seed always yields the same sequence, so a restarted
 * or evicted room agrees with every other consumer without storing anything.
 */
export function rotationAt(seed: number, roundId: number): RotationPick {
  let chain = chains.get(seed);
  if (!chain) { if (chains.size > 16) chains.clear(); chain = []; chains.set(seed, chain); }
  while (chain.length <= roundId) chain.push(pickRotation(chain[chain.length - 1] ?? null, seeded(seed, chain.length)));
  return chain[roundId];
}

/**
 * The main public lobby's schedule: one ten-minute round per id, with the mode and map of each round chosen by the seeded
 * rotation in shared/rotation.ts (random, no immediate repeats, Zone Control only on maps with A/B/C squares). Empty rooms
 * catch up from the persisted epoch and seed alone.
 */
export function mapRound(schedule: MapSchedule, now: number): MapRound {
  const id = Math.max(0, Math.floor((now - schedule.epoch) / ROUND_MS));
  const pick = rotationAt(schedule.seed, id);
  return { id, mapId: pick.mapId, mode: pick.mode, endsAt: schedule.epoch + (id + 1) * ROUND_MS };
}
