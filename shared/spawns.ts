import { MOVEMENT } from '../src/config/constants';
import type { MapLayout, SpawnPoint } from '../src/maps/types';
import type { CollisionWorld } from '../src/physics/CollisionWorld';

export interface SpawnOccupant {
  x: number; y: number; z: number;
  eyeHeight: number;
  opponent: boolean;
}

/** Geometry occlusion, independent of where an opponent happens to be looking. */
export function spawnVisible(world: CollisionWorld, spawn: SpawnPoint, player: SpawnOccupant): boolean {
  return [1, MOVEMENT.standEye].some((height) => {
    const dx=spawn.pos[0]-player.x, dy=spawn.pos[1]+height-player.y-player.eyeHeight, dz=spawn.pos[2]-player.z;
    const length=Math.hypot(dx,dy,dz);
    return length < .01 || !world.raycast(player.x,player.y+player.eyeHeight,player.z,dx/length,dy/length,dz/length,length);
  });
}

/** Prefer screened, distant spawns; always enforce body clearance, even for teammates. */
export function selectSpawn(layout: MapLayout, world: CollisionWorld, players: SpawnOccupant[]): SpawnPoint | undefined {
  const candidates=layout.spawns.map((s)=>({s,
    gap:players.reduce((d,p)=>Math.min(d,Math.hypot(p.x-s.pos[0],p.z-s.pos[2])),Infinity),
    visible:players.filter((p)=>p.opponent && spawnVisible(world,s,p)).length,
  })).filter(({s,gap})=>gap>=MOVEMENT.radius*2+.1 &&
    !world.overlapsCylinder(s.pos[0],s.pos[2],MOVEMENT.radius,s.pos[1]+MOVEMENT.stepHeight,s.pos[1]+MOVEMENT.standHeight));
  // If all spawns are exposed, fewer sightlines and greater separation are still useful.
  candidates.sort((a,b)=>Number(b.gap>=8)-Number(a.gap>=8) || a.visible-b.visible || b.gap-a.gap);
  return candidates[0]?.s;
}
