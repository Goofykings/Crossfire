import townCollision from '../../public/assets/models/european-town/collision.json';
import industrialCollision from '../../public/assets/models/industrial-complex/collision.json';
import cityCollision from '../../public/assets/models/modern-city/collision.json';
import townLayout from '../../src/maps/european-town/layout.json';
import industrialLayout from '../../src/maps/industrial-complex/layout.json';
import cityLayout from '../../src/maps/modern-city/layout.json';
import catalog from '../../public/assets/models/shared/props/props.json';
import type { CollisionFile, MapLayout, PropCatalog } from '../../src/maps/types';
import { createMapWorld, mapVersion } from '../../shared/world';

import type { MapId } from '../../shared/maps';
export { MOVEMENT } from '../../src/config/constants';

function makeWorld(collision: CollisionFile, data: unknown) {
  const layout = data as MapLayout;
  return { layout, world: createMapWorld(collision, layout, catalog as unknown as PropCatalog),
    revision: mapVersion(collision, layout, catalog as unknown as PropCatalog) };
}

export const WORLDS = {
  'european-town': makeWorld(townCollision as CollisionFile, townLayout),
  'industrial-complex': makeWorld(industrialCollision as CollisionFile, industrialLayout),
  'modern-city': makeWorld(cityCollision as CollisionFile, cityLayout),
} satisfies Record<MapId, ReturnType<typeof makeWorld>>;
