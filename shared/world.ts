import { CollisionWorld } from '../src/physics/CollisionWorld';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';

/** Same generated solids in Workers and Babylon; targets are added separately in practice only. */
export function createMapWorld(collision: CollisionFile, layout: MapLayout, catalog: PropCatalog): CollisionWorld {
  const world = new CollisionWorld();
  world.addMany(collision.boxes);
  for (const p of [...layout.props, ...layout.obstacles]) {
    const size = catalog.props[p.type]?.collider;
    if (!size) continue;
    const [w, h, d] = size;
    world.add({ c: [p.pos[0], p.pos[1] + h / 2, p.pos[2]], h: [w / 2, h / 2, d / 2], yaw: -p.heading * Math.PI / 180, tag: `prop:${p.type}` });
  }
  return world;
}

export function mapVersion(collision: CollisionFile, layout: MapLayout, catalog: PropCatalog): string {
  const data = JSON.stringify([collision, layout, catalog]);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return `town-${(hash >>> 0).toString(16)}`;
}
