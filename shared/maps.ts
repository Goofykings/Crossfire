import type { MatchMode } from './combat';
export const MAP_IDS = ['european-town', 'industrial-complex', 'modern-city', 'farmstead', 'neon-backstreets'] as const;
export type MapId = typeof MAP_IDS[number];
export const validMap = (value: unknown): value is MapId => MAP_IDS.includes(value as MapId);
export const ROUND_MS = 600_000;
export interface MapSchedule { epoch: number; seed: number }
export interface MapRound { id: number; mapId: MapId; mode: MatchMode; endsAt: number }
