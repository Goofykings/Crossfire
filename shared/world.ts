import type { EnvironmentDefinition } from './environment';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';
import type {BulletCatalog} from '../src/physics/BulletMesh';

/** Same generated solids in Workers and Babylon; targets are added separately in practice only. */
export function createMapWorld(collision: CollisionFile, layout: MapLayout, catalog: PropCatalog, environment?:EnvironmentDefinition,bullets?:BulletCatalog): CollisionWorld {
  const world = new CollisionWorld();
  world.slidePassages.push(...(layout.slidePassages??[]).map(p=>({x:p.center[0],z:p.center[1],halfWidth:p.width/2,halfDepth:p.depth/2,clearance:p.clearance})));
  world.ladders.push(...(layout.ladders ?? []));
  world.addMany(collision.boxes);
  for (const [index,p] of [...layout.props, ...layout.obstacles].entries()) {
    const replacement=environment?.replaceProps.find(r=>r.index===index);
    if(replacement){
      // Canopy cloth is shootable cover, never a walkable surface.
      const boxes=replacement.boxes.map(box=>world.add(box,{solid:!box.tag?.endsWith('-canopy')}));
      if(bullets){const mesh=bullets.meshes[p.type];if(!mesh)throw Error(`Missing bullet surface: ${p.type}`);world.addBulletSurface(mesh,p.pos,-p.heading*Math.PI/180,`prop:${p.type}`,boxes);}
      continue;
    }
    const size = catalog.props[p.type]?.collider;
    if (!size) continue;
    const [w, h, d] = size;
    const box=world.add({ c: [p.pos[0], p.pos[1] + h / 2, p.pos[2]], h: [w / 2, h / 2, d / 2], yaw: -p.heading * Math.PI / 180, tag: `prop:${p.type}` });
    if(bullets){const mesh=bullets.meshes[p.type];if(!mesh)throw Error(`Missing bullet surface: ${p.type}`);world.addBulletSurface(mesh,p.pos,box.yaw,box.tag,[box]);}
  }
  return world;
}

export function mapVersion(collision: CollisionFile, layout: MapLayout, catalog: PropCatalog, environment?:EnvironmentDefinition,bullets?:BulletCatalog): string {
  const data = JSON.stringify(['swept-cylinder-v2', collision, layout, catalog, ...(environment?[environment]:[]),...(bullets?['bullet-surfaces-v1',bullets]:[])]);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return `town-${(hash >>> 0).toString(16)}`;
}
