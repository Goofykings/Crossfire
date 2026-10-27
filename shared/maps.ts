export const MAP_IDS = ['european-town', 'industrial-complex', 'modern-city'] as const;
export type MapId = typeof MAP_IDS[number];
export const validMap = (value: unknown): value is MapId => MAP_IDS.includes(value as MapId);
export const ROUND_MS = 600_000;
export interface MapSchedule { epoch: number; seed: number }
export interface MapRound { id: number; mapId: MapId; endsAt: number }

/** Each server-seeded shuffle includes all maps; empty rooms catch up in O(1). */
export function mapRound(schedule: MapSchedule, now: number): MapRound {
  const id = Math.max(0, Math.floor((now - schedule.epoch) / ROUND_MS));
  let n = (schedule.seed ^ Math.imul(Math.floor(id / 3) + 1, 0x9e3779b9)) >>> 0;
  const random = () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let x = Math.imul(n ^ (n >>> 15), n | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const bag = [...MAP_IDS];
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  return { id, mapId: bag[id % bag.length], endsAt: schedule.epoch + (id + 1) * ROUND_MS };
}
