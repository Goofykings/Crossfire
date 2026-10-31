import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../shared/maps';
import { createMapWorld, mapVersion } from '../shared/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { WORLDS } from '../server/src/world';
import { selectSpawn, spawnVisible, type SpawnOccupant } from '../shared/spawns';

const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json','utf8')) as PropCatalog;
describe.each(MAP_IDS)('%s compact routes', (id) => {
  const layout = JSON.parse(readFileSync(`src/maps/${id}/layout.json`,'utf8')) as MapLayout;
  const collision = JSON.parse(readFileSync(`public/assets/models/${id}/collision.json`,'utf8')) as CollisionFile;
  const world = createMapWorld(collision, layout, catalog);
  it('reduces each playable dimension by 15–25%, with matching backend revisions', () => {
    const old = id === 'european-town' ? 66 : 68;
    for (const size of [layout.playArea[2]-layout.playArea[0],layout.playArea[3]-layout.playArea[1]]) {
      expect(size / old).toBeGreaterThanOrEqual(.75);
      expect(size / old).toBeLessThanOrEqual(.85);
    }
    expect(WORLDS[id].revision).toBe(mapVersion(collision,layout,catalog));
    expect(layout.navigation?.groundRoutes.length).toBeGreaterThan(15);
  });
  it('walks upstairs, across a real upper floor and downstairs in both directions', () => {
    expect(layout.upperRoutes?.length).toBeGreaterThan(0);
    for (const route of layout.upperRoutes!) {
      const path = layout.navigation!.upperRoutes.find((r)=>r.id===route.id)!.waypoints;
      for (const reverse of [false,true]) {
        const points = reverse ? [...path].reverse() : path;
        const start=points[0], end=points.at(-1)!;
        const heading=Math.atan2(end[0]-start[0],-(end[2]-start[2]))*180/Math.PI;
        const p=new PlayerController(world);
        p.teleport({x:start[0],y:start[1],z:start[2]},heading);
        let highest=0;
        const distance=Math.hypot(end[0]-start[0],end[2]-start[2]);
        for(let tick=0;tick<Math.ceil((distance/MOVEMENT.walkSpeed+1)*240);tick++) {
          if(Math.hypot(p.position.x-end[0],p.position.z-end[2])<.12)break;
          p.fixedUpdate(FIXED_DT,{...NO_INTENT,z:1});
          highest=Math.max(highest,p.position.y);
          expect(p.position.y,`${route.id} fell through`).toBeGreaterThanOrEqual(-.05);
          expect(world.overlapsCylinder(p.position.x,p.position.z,MOVEMENT.radius,
            p.position.y+MOVEMENT.stepHeight+.01,p.position.y+MOVEMENT.standHeight),`${route.id} headroom`).toBe(false);
        }
        expect(highest,route.id).toBeCloseTo(route.height,2);
        expect(Math.hypot(p.position.x-end[0],p.position.z-end[2]),`${route.id} exit ${reverse}: ${JSON.stringify(p.position)} -> ${end}`).toBeLessThan(.25);
        expect(p.position.y).toBeLessThan(.25);
      }
    }
  });
  it('keeps standing-height underpasses and spawn/stair entrances clear of props',()=>{
    for(const route of layout.upperRoutes ?? []) {
      const [x0,z0,x1,z1]=route.rect, x=(x0+x1)/2,z=(z0+z1)/2;
      expect(world.overlapsCylinder(x,z,MOVEMENT.radius,.4,MOVEMENT.standHeight)).toBe(false);
      expect(world.groundHeight(x,z,.1,.1)).toBeCloseTo(0,4);
      for(const spawn of layout.spawns) expect(spawn.pos[0]<x0-.5||spawn.pos[0]>x1+.5||spawn.pos[2]<z0-.5||spawn.pos[2]>z1+.5).toBe(true);
    }
  });
  it('puts every major ground route on a loop with at least two continuations',()=>{
    const routes=[...layout.navigation!.groundRoutes,...layout.navigation!.coveredRoutes];
    const adjacent=routes.map((a,i)=>routes.flatMap((b,j)=>{
      if(i===j)return [];
      const dx=Math.min(a.rect[2],b.rect[2])-Math.max(a.rect[0],b.rect[0]);
      const dz=Math.min(a.rect[3],b.rect[3])-Math.max(a.rect[1],b.rect[1]);
      return dx>=-.01&&dz>=-.01&&Math.max(dx,dz)>=.8?[j]:[];
    }));
    const connected=new Set<number>(), pending=[0];
    while(pending.length){const i=pending.pop()!;if(connected.has(i))continue;connected.add(i);pending.push(...adjacent[i]);}
    expect(connected.size,'isolated route regions').toBe(routes.length);
    for(let i=0;i<routes.length;i++) {
      const a=routes[i], size=Math.max(a.rect[2]-a.rect[0],a.rect[3]-a.rect[1]);
      if(size<2)continue;
      // An arcade entirely inside one street is a covered section of that
      // street, not a separate branch. Its two ends share the same node.
      if(routes.some((b,j)=>j!==i&&b.rect[0]<=a.rect[0]&&b.rect[1]<=a.rect[1]&&b.rect[2]>=a.rect[2]&&b.rect[3]>=a.rect[3]))continue;
      const exits=adjacent[i];
      expect(exits.length,`dead end ${a.id}`).toBeGreaterThanOrEqual(2);
      const seen=new Set<number>([i]), queue=[exits[0]];
      while(queue.length){const j=queue.pop()!;if(seen.has(j))continue;seen.add(j);queue.push(...adjacent[j].filter(k=>!seen.has(k)));}
      expect(exits.slice(1).some(j=>seen.has(j)),`${a.id} has no alternate return route`).toBe(true);
    }
  });
  it('offers screened spawn choices against 1–5 opponents around the actual map',()=>{
    for(let start=0;start<layout.spawns.length;start++) for(let count=1;count<=5;count++) {
      const players:SpawnOccupant[]=Array.from({length:count},(_,i)=>{
        const s=layout.spawns[(start+i*3)%layout.spawns.length];
        return {x:s.pos[0],y:s.pos[1],z:s.pos[2],eyeHeight:MOVEMENT.standEye,opponent:true};
      });
      const selected=selectSpawn(layout,world,players);
      expect(selected).toBeDefined();
      expect(players.every(p=>Math.hypot(p.x-selected!.pos[0],p.z-selected!.pos[2])>=8)).toBe(true);
      const screened=layout.spawns.filter(s=>players.every(p=>Math.hypot(p.x-s.pos[0],p.z-s.pos[2])>=8&&!spawnVisible(world,s,p)));
      if(screened.length) expect(players.some(p=>spawnVisible(world,selected!,p)),`ignored screened spawn ${start}/${count}`).toBe(false);
    }
  });
  it('uses thin yard dividers with clear space on both sides, rather than redundant fences',()=>{
    for(const fence of layout.walls.filter(w=>w.style==='fence')) {
      const [x0,z0,x1,z1]=fence.rect;
      expect(Math.min(x1-x0,z1-z0)).toBeLessThan(.3);
      const x=(x0+x1)/2,z=(z0+z1)/2;
      for(const side of [-1,1]) {
        const px=x+(x1-x0<z1-z0?side*.85:0),pz=z+(x1-x0<z1-z0?0:side*.85);
        expect(world.overlapsCylinder(px,pz,.34,.45,1.8),fence.id).toBe(false);
      }
    }
  });
});
