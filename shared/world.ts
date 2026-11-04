import type { EnvironmentDefinition } from './environment';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';

/** Same generated solids in Workers and Babylon; targets are added separately in practice only. */
export function createMapWorld(collision: CollisionFile, layout: MapLayout, catalog: PropCatalog, environment?:EnvironmentDefinition): CollisionWorld {
  const world = new CollisionWorld();
  world.ladders.push(...(layout.ladders ?? []));
  world.addMany(collision.boxes);
  for (const [index,p] of [...layout.props, ...layout.obstacles].entries()) {
    const replacement=environment?.replaceProps.find(r=>r.index===index);
    if(replacement){world.addMany(replacement.boxes);continue;}
    const size = catalog.props[p.type]?.collider;
    if (!size) continue;
    const [w, h, d] = size;
    world.add({ c: [p.pos[0], p.pos[1] + h / 2, p.pos[2]], h: [w / 2, h / 2, d / 2], yaw: -p.heading * Math.PI / 180, tag: `prop:${p.type}` });
  }
  return world;
}

export function mapVersion(collision: CollisionFile, layout: MapLayout, catalog: PropCatalog, environment?:EnvironmentDefinition): string {
  const data = JSON.stringify(['swept-cylinder-v2', collision, layout, catalog, ...(environment?[environment]:[])]);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return `town-${(hash >>> 0).toString(16)}`;
}
