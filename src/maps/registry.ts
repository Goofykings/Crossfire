import { EUROPEAN_TOWN } from './european-town';
import { INDUSTRIAL_COMPLEX } from './industrial-complex';
import { MODERN_CITY } from './modern-city';
import type { MapDefinition } from './types';

/**
 * Every playable map. To add a map: create src/maps/<id>/ with layout.json + index.ts exporting a
 * MapDefinition, generate its assets under public/assets/models/<id>/, and append it here.
 */
export const MAPS: readonly MapDefinition[] = [EUROPEAN_TOWN, INDUSTRIAL_COMPLEX, MODERN_CITY];

/** Maps shown in the menu as "coming soon" (none at the moment; the menu supports them). */
export const UPCOMING_MAPS: readonly { id: string; name: string; description: string }[] = [];

export const DEFAULT_MAP_ID = EUROPEAN_TOWN.id;

export function getMap(id: string): MapDefinition {
  const map = MAPS.find((m) => m.id === id);
  if (!map) throw new Error(`Unknown map "${id}"`);
  return map;
}
