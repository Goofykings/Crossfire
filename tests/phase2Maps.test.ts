import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../shared/maps';
import { createMapWorld } from '../shared/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import { roomOpenings } from '../src/maps/tactical';
import type { CollisionFile, MapLayout, PropCatalog, Rect } from '../src/maps/types';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';

const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')) as PropCatalog;
type Door = { side: 'n' | 's' | 'w' | 'e'; rect: Rect };
type InteriorBuilding = MapLayout['buildings'][number] & { interiors?: { doors: Door[] }[] };
const additions: Record<string, string> = {
  'european-town': 'market_room', 'industrial-complex': 'goods_office', 'modern-city': 'diner_service',
};

describe.each(MAP_IDS)('%s Phase 2 physical passages', (id) => {
  const layout = JSON.parse(readFileSync(`src/maps/${id}/layout.json`, 'utf8')) as MapLayout;
  const collision = JSON.parse(readFileSync(`public/assets/models/${id}/collision.json`, 'utf8')) as CollisionFile;
  const world = createMapWorld(collision, layout, catalog);

  // Exercise the actual movement solver through the exported wall gaps. A
  // rectangle touching another rectangle does not prove its doorway is open.
  function cross(start: number[], end: number[], mode: 'walk' | 'slide' | 'jump') {
    const player = new PlayerController(world);
    const dx = end[0] - start[0], dz = end[1] - start[1], distance = Math.hypot(dx, dz);
    player.teleport({ x: start[0], y: 0, z: start[1] }, Math.atan2(dx, -dz) * 180 / Math.PI);
    let progress = 0, jumped = false, slid = false, peak = 0;
    for (let tick = 0; tick < 120 * (distance / MOVEMENT.crouchSpeed + 2); tick++) {
      player.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1,
        slide: mode === 'slide' && tick >= 12, jumpPressed: mode === 'jump' && tick === 12 });
      progress = ((player.position.x - start[0]) * dx + (player.position.z - start[1]) * dz) / distance;
      jumped ||= !player.grounded;
      slid ||= player.sliding;
      peak = Math.max(peak, player.position.y);
      expect(player.position.y, `fell below floor (${mode})`).toBeGreaterThanOrEqual(-.01);
      expect(world.overlapsCylinder(player.position.x, player.position.z, MOVEMENT.radius,
        player.position.y + MOVEMENT.stepHeight + .01,
        player.position.y + player.height), `body intersects a solid (${mode})`).toBe(false);
      if (progress >= distance - .12) break;
    }
    expect(progress, `blocked ${mode}: ${start} -> ${end}`).toBeGreaterThan(distance - .2);
    if (mode === 'jump') expect(jumped).toBe(true);
    if (mode === 'slide') expect(slid).toBe(true);
    for (let tick=0;tick<30;tick++) player.fixedUpdate(FIXED_DT,NO_INTENT);
    return { player, peak };
  }

  it('walks, slides and jumps through the new flank interior in both directions', () => {
    const route = layout.ground.covered.find((r) => r.id === additions[id]);
    expect(route, 'missing authored through-route').toBeDefined();
    const [x0, z0, x1, z1] = route!.rect, z = (z0 + z1) / 2;
    for (const mode of ['walk', 'slide', 'jump'] as const) {
      cross([x0 - .8, z], [x1 + .8, z], mode);
      cross([x1 + .8, z], [x0 - .8, z], mode);
    }
  });

  it('has standing clearance and walkable approaches at every real interior door', () => {
    for (const building of layout.buildings as InteriorBuilding[]) {
      const doors: Door[] = building.interiors?.flatMap((i) => i.doors) ?? [];
      for (const room of building.rooms ?? []) {
        const [cavity, ...openings] = roomOpenings(building, room.rect, room.doorSides);
        for (const r of openings) {
          const x = (r[0] + r[2]) / 2, z = (r[1] + r[3]) / 2;
          doors.push({ rect: r, side: x < cavity[0] ? 'w' : x > cavity[2] ? 'e' : z < cavity[1] ? 'n' : 's' });
        }
      }
      for (const door of doors) {
        const [x0, z0, x1, z1] = door.rect, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
        const horizontal = door.side === 'w' || door.side === 'e';
        const a = horizontal ? [x0 - .5, z] : [x, z0 - .5];
        const b = horizontal ? [x1 + .5, z] : [x, z1 + .5];
        cross(a, b, 'walk');
        cross(b, a, 'walk');
      }
    }
  });

  it('walks through both ends of the covered street arcades', () => {
    for (const building of layout.buildings) for (const passage of building.passages ?? []) {
      const [x0,z0,x1,z1]=passage.rect, [bx0,bz0,bx1,bz1]=building.rect;
      const throughX=x0<=bx0+.001&&x1>=bx1-.001;
      const throughZ=z0<=bz0+.001&&z1>=bz1-.001;
      const alongX=throughX!==throughZ?throughX:x1-x0>=z1-z0;
      const a=alongX?[x0-.6,(z0+z1)/2]:[(x0+x1)/2,z0-.6];
      const b=alongX?[x1+.6,(z0+z1)/2]:[(x0+x1)/2,z1+.6];
      cross(a,b,'walk');cross(b,a,'walk');
    }
  });

  it('supports jumping and sliding onto either stair approach and returning to ground', () => {
    for (const route of layout.navigation!.upperRoutes) for (const reverse of [false,true]) {
      const path=reverse?[...route.waypoints].reverse():route.waypoints;
      const a=path[0],b=path.at(-1)!;
      for (const mode of ['slide','jump'] as const) {
        const { player,peak }=cross([a[0],a[2]],[b[0],b[2]],mode);
        const height=layout.upperRoutes!.find(r=>r.id===route.id)!.height;
        expect(peak,`${route.id} ${mode} never reached upper floor`).toBeGreaterThanOrEqual(height-.01);
        expect(player.grounded).toBe(true);
        expect(player.position.y).toBeLessThan(.25);
      }
    }
  });
});
