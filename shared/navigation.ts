import type { MapLayout } from '../src/maps/types';
import type { CollisionWorld } from '../src/physics/CollisionWorld';
import type { Vec3 } from '../src/player/PlayerController';
import { MOVEMENT } from '../src/config/constants';
/** Validated wide, reachable ground positions for map diagnostics and test arenas. */
export function groundLocations(layout: MapLayout, world: CollisionWorld): Vec3[] {
  const [x0,z0,x1,z1] = layout.playArea, grid = 1, nodes = new Map<string, Vec3>();
  const routes = layout.navigation?.groundRoutes ?? layout.ground.zones;
  for (let x = Math.ceil(x0+1); x <= x1-1; x += grid) for (let z = Math.ceil(z0+1); z <= z1-1; z += grid) {
    if (!routes.some(r => x>=r.rect[0] && x<=r.rect[2] && z>=r.rect[1] && z<=r.rect[3])) continue;
    const y = world.groundHeight(x,z,.2,layout.ground.baseHeight+.4);
    if (!Number.isFinite(y) || world.overlapsCylinder(x,z,MOVEMENT.radius,y+.03,y+MOVEMENT.standHeight)) continue;
    nodes.set(`${x},${z}`,{x,y,z});
  }
  const visited = new Set<string>(), queue: Vec3[] = [];
  for (const s of layout.spawns) {
    const nearby = [...nodes.entries()].filter(([,p]) => Math.hypot(p.x-s.pos[0],p.z-s.pos[2])<1.5
      && !world.raycast(s.pos[0],s.pos[1]+1,s.pos[2],(p.x-s.pos[0])/(Math.hypot(p.x-s.pos[0],p.z-s.pos[2])||1),0,
        (p.z-s.pos[2])/(Math.hypot(p.x-s.pos[0],p.z-s.pos[2])||1),Math.hypot(p.x-s.pos[0],p.z-s.pos[2])));
    for (const [key,p] of nearby) if (!visited.has(key)) {visited.add(key);queue.push(p);}
  }
  for (let i=0;i<queue.length;i++) {
    const p=queue[i];
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const key=`${p.x+dx},${p.z+dz}`, n=nodes.get(key);
      if (!n || visited.has(key) || Math.abs(n.y-p.y)>.2) continue;
      let clear=true;
      for(let f=.25;f<=1;f+=.25) if(world.overlapsCylinder(p.x+dx*f,p.z+dz*f,MOVEMENT.radius,Math.max(p.y,n.y)+.03,Math.max(p.y,n.y)+MOVEMENT.standHeight)) {clear=false;break;}
      if(clear){visited.add(key);queue.push(n);}
    }
  }
  return queue.filter(p => Number.isInteger(p.x/2) && Number.isInteger(p.z/2)
    && !world.overlapsCylinder(p.x,p.z,1,p.y+.03,p.y+2.8)
    && [[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dz])=>Math.abs(world.groundHeight(p.x+dx,p.z+dz,.1,p.y+.2)-p.y)<.05));
}
