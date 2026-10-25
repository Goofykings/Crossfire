import { EUROPEAN_TOWN } from './european-town';
import type { MapDefinition } from './types';

/**
 * Every playable map. To add a map: create src/maps/<id>/ with layout.json + index.ts exporting a
 * MapDefinition, generate its assets under public/assets/models/<id>/, and append it here.
 */
export const MAPS: readonly MapDefinition[] = [EUROPEAN_TOWN];

/** Maps shown in the menu as "coming soon" (no assets yet). */
export const UPCOMING_MAPS: readonly { id: string; name: string; description: string }[] = [
  { id: 'industrial', name: 'Foundry', description: 'Warehouses, gantries and rail yards.' },
  { id: 'modern-city', name: 'Downtown', description: 'Office blocks, plazas and parking decks.' },
];

export const DEFAULT_MAP_ID = EUROPEAN_TOWN.id;

export function getMap(id: string): MapDefinition {
  const map = MAPS.find((m) => m.id === id);
  if (!map) throw new Error(`Unknown map "${id}"`);
  return map;
}
