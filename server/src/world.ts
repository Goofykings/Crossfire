import collision from '../../public/assets/models/european-town/collision.json';
import layout from '../../src/maps/european-town/layout.json';
import catalog from '../../public/assets/models/shared/props/props.json';
import type { CollisionFile, MapLayout, PropCatalog } from '../../src/maps/types';
import { createMapWorld, mapVersion } from '../../shared/world';

// Stage 2 has one fixed test scene. Round/map selection belongs to Stage 3.
export const town = layout as unknown as MapLayout;
export const world = createMapWorld(collision as CollisionFile, town, catalog as unknown as PropCatalog);
export const revision = mapVersion(collision as CollisionFile, town, catalog as unknown as PropCatalog);
