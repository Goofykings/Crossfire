import townEnvironment from '../../public/assets/models/european-town/environment.json';
import industrialEnvironment from '../../public/assets/models/industrial-complex/environment.json';
import cityEnvironment from '../../public/assets/models/modern-city/environment.json';
import farmEnvironment from '../../public/assets/models/farmstead/environment.json';
import type { EnvironmentDefinition } from '../../shared/environment';
import townCollision from '../../public/assets/models/european-town/collision.json';
import industrialCollision from '../../public/assets/models/industrial-complex/collision.json';
import cityCollision from '../../public/assets/models/modern-city/collision.json';
import farmCollision from '../../public/assets/models/farmstead/collision.json';
import townLayout from '../../src/maps/european-town/layout.json';
import industrialLayout from '../../src/maps/industrial-complex/layout.json';
import cityLayout from '../../src/maps/modern-city/layout.json';
import farmLayout from '../../src/maps/farmstead/layout.json';
import catalog from '../../public/assets/models/shared/props/props.json';
import bullets from '../../public/assets/models/shared/props/bullet-surfaces.json';
import type {BulletCatalog} from '../../src/physics/BulletMesh';
import type { CollisionFile, MapLayout, PropCatalog } from '../../src/maps/types';
import { createMapWorld, mapVersion } from '../../shared/world';

import type { MapId } from '../../shared/maps';
export { MOVEMENT } from '../../src/config/constants';

function makeWorld(collision: CollisionFile, data: unknown, environment:EnvironmentDefinition) {
  const layout = data as MapLayout;
  return { layout, environment, world: createMapWorld(collision, layout, catalog as unknown as PropCatalog,environment,bullets as BulletCatalog),
    revision: mapVersion(collision, layout, catalog as unknown as PropCatalog,environment,bullets as BulletCatalog) };
}

export const WORLDS = {
  'european-town': makeWorld(townCollision as CollisionFile, townLayout,townEnvironment as EnvironmentDefinition),
  'industrial-complex': makeWorld(industrialCollision as CollisionFile, industrialLayout,industrialEnvironment as EnvironmentDefinition),
  'modern-city': makeWorld(cityCollision as CollisionFile, cityLayout,cityEnvironment as EnvironmentDefinition),
  'farmstead': makeWorld(farmCollision as CollisionFile, farmLayout,farmEnvironment as EnvironmentDefinition),
} satisfies Record<MapId, ReturnType<typeof makeWorld>>;
