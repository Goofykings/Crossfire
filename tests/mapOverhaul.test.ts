import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../shared/maps';
import { unsafeMovement } from '../shared/movementSafety';
import { WORLDS } from '../server/src/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import type { CollisionFile, MapLayout } from '../src/maps/types';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';

/** Map overhaul (2026-11) regressions: underground passages traversed by the real shared
 * controller, street openings guarded, legal depth for the server's safety net, and no straight
 * sightline that crosses the whole level once props and structures are counted. */
describe.each(MAP_IDS)('%s overhaul', (id) => {
  const { world, layout } = WORLDS[id];
  const collision = JSON.parse(readFileSync(`public/assets/models/${id}/collision.json`, 'utf8')) as CollisionFile;

  function walk(player: PlayerController, path: number[][], label: string) {
    let low = Infinity;
    for (let i = 1; i < path.length; i++) {
      const to = path[i];
      for (let tick = 0; tick < 120 * 12; tick++) {
        const dx = to[0] - player.position.x, dz = to[2] - player.position.z, dist = Math.hypot(dx, dz);
        if (dist < .09) break;
        // Face along the travel direction (the longest gun points down each flight). Across a
        // turning landing between two flights, face the landing's far wall and strafe, as a
        // player carrying a long gun does: neither the divider nor a side wall meets the barrel.
        const from = path[i - 1], next = path[i + 1];
        const landing = Math.abs(to[1] - from[1]) < .01 && Math.hypot(to[0] - from[0], to[2] - from[2]) < 3.6
          && next !== undefined && Math.abs(next[1] - to[1]) > .3 && i > 1 && Math.abs(from[1] - path[i - 2][1]) > .3;
        const hx = landing ? to[0] - next[0] : dx, hz = landing ? to[2] - next[2] : dz;
        player.yaw = PlayerController.headingToYaw(Math.atan2(hx, -hz) * 180 / Math.PI);
        const s = Math.sin(player.yaw), c = Math.cos(player.yaw), x = dx / dist, z = dz / dist;
        player.fixedUpdate(FIXED_DT, { ...NO_INTENT, x: x * c - z * s, z: -x * s - z * c });
        low = Math.min(low, player.position.y);
        expect(world.overlapsCylinder(player.position.x, player.position.z, MOVEMENT.radius,
          player.position.y + MOVEMENT.stepHeight + .01, player.position.y + MOVEMENT.standHeight), `${label} body in a solid`).toBe(false);
        expect(unsafeMovement(player.position, layout as MapLayout), `${label} flagged unsafe`).toBeNull();
      }
      expect(Math.hypot(player.position.x - to[0], player.position.z - to[2]), `${label} segment ${i} ${JSON.stringify(player.position)} -> ${to}`).toBeLessThan(.15);
    }
    return low;
  }

  it.each([false, true])('walks every underground passage end to end, reverse=%s', (reverse) => {
    for (const passage of layout.underground ?? []) for (const weapon of [null, 'rifle', 'sniper'] as const) {
      const path = reverse ? [...passage.waypoints].reverse() : passage.waypoints;
      const player = new PlayerController(world);
      player.weaponClearance = weapon;
      player.teleport({ x: path[0][0], y: path[0][1], z: path[0][2] }, 0);
      const low = walk(player, path, `${passage.id} ${weapon}`);
      expect(low, `${passage.id} never reached the passage floor`).toBeLessThan(passage.floor + .05);
      for (let i = 0; i < 60; i++) player.fixedUpdate(FIXED_DT, NO_INTENT);
      expect(player.position.y, `${passage.id} did not climb back to the street`).toBeGreaterThan(-.05);
    }
  });

  it('keeps headroom along each passage and closes it with thick walls, floor and slab', () => {
    for (const passage of layout.underground ?? []) {
      for (const p of passage.waypoints) if (p[1] < passage.floor + .05) {
        expect(world.ceilingHeight(p[0], p[2], MOVEMENT.radius, p[1] + .1) - p[1], `${passage.id} headroom at ${p}`).toBeGreaterThan(2.15);
      }
      const walls = collision.boxes.filter((b) => b.tag === `underground:${passage.id}:wall`);
      expect(walls.length).toBeGreaterThan(3);
      // Every wall piece is a 0.3 m slab across its edge (short stubs beside openings included).
      for (const w of walls) expect(Math.abs(w.h[0] * 2 - .3) < .002 || Math.abs(w.h[2] * 2 - .3) < .002, w.tag).toBe(true);
      expect(collision.boxes.some((b) => b.tag === `underground:${passage.id}:floor`)).toBe(true);
      // The street slab above each segment is intact (ground box over the passage centre).
      for (const [x0, z0, x1, z1] of passage.segments) {
        const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
        expect(world.groundHeight(x, z, .05, .01), `${passage.id} street slab over ${[x0, z0, x1, z1]}`).toBeCloseTo(0, 3);
      }
    }
  });

  it('guards every stairwell at street level except its entry', () => {
    for (const passage of layout.underground ?? []) for (const e of passage.entrances) {
      const [x0, z0, x1, z1] = e.rect, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const sides = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] } as const;
      for (const [side, [ox, oz]] of Object.entries(sides)) {
        if (side === e.side) continue;
        // Walk at the stairwell from 1.5 m outside this face: the body must stay on the street.
        const start = { x: cx + ox * ((x1 - x0) / 2 + 1.5), y: 0, z: cz + oz * ((z1 - z0) / 2 + 1.5) };
        if (world.overlapsCylinder(start.x, start.z, MOVEMENT.radius, .05, MOVEMENT.standHeight)) continue;
        const player = new PlayerController(world);
        player.teleport(start, (Math.atan2(-ox, oz) * 180 / Math.PI + 360) % 360);
        for (let i = 0; i < 240; i++) player.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1 });
        expect(player.position.y, `${e.id} unguarded on its ${side} face`).toBeGreaterThan(-.05);
      }
    }
  });

  it('places spawns on the street, never in a passage or stairwell', () => {
    for (const s of layout.spawns) {
      expect(s.pos[1]).toBeGreaterThanOrEqual(0);
      for (const p of layout.underground ?? []) for (const e of p.entrances) {
        const [x0, z0, x1, z1] = e.rect;
        expect(s.pos[0] > x0 - .6 && s.pos[0] < x1 + .6 && s.pos[2] > z0 - .6 && s.pos[2] < z1 + .6, `${s.id} at ${e.id}`).toBe(false);
      }
    }
  });

  it('lets every spawn walk to every other spawn', () => {
    // Flood from one spawn on a 0.25 m grid with the controller's own body test: a cylinder above
    // step height, so treads and curbs are stepped over (the audit's crouched flood starts from
    // every spawn and cannot see an isolated region). Ladders join their bottom and top.
    const G = .25, levels = new Map<string, number[]>();
    const body = (x: number, z: number, from: number, top: number) =>
      world.overlapsCylinder(x, z, MOVEMENT.radius * .95, from + MOVEMENT.stepHeight + .01, top + MOVEMENT.standHeight);
    const surfaces = (ix: number, iz: number) => {
      const key = `${ix},${iz}`;
      let list = levels.get(key);
      if (list) return list;
      list = [];
      for (let k = 0, maxY = 40; k < 8; k++) {
        const y = world.groundHeight(ix * G, iz * G, .05, maxY);
        if (!Number.isFinite(y)) break;
        if (!body(ix * G, iz * G, y, y)) list.push(y);
        maxY = y - .3;
      }
      levels.set(key, list);
      return list;
    };
    const seen = new Set<string>(), queue: [number, number, number][] = [];
    const visit = (ix: number, iz: number, y: number) => {
      const key = `${ix},${iz},${y.toFixed(2)}`;
      if (!seen.has(key)) { seen.add(key); queue.push([ix, iz, y]); }
    };
    const at = (pos: number[]) => {
      const ix = Math.round(pos[0] / G), iz = Math.round(pos[2] / G);
      return [ix, iz, surfaces(ix, iz).find((h) => Math.abs(h - pos[1]) < .3)] as const;
    };
    const [sx, sz, sy] = at(layout.spawns[0].pos);
    expect(sy, 'first spawn on a walkable surface').toBeDefined();
    visit(sx, sz, sy!);
    const [px0, pz0, px1, pz1] = layout.playArea;
    for (let i = 0; i < queue.length; i++) {
      const [ix, iz, y] = queue[i];
      if (ix * G < px0 - 2 || ix * G > px1 + 2 || iz * G < pz0 - 2 || iz * G > pz1 + 2) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const h of surfaces(ix + dx, iz + dz)) {
        if (h - y > MOVEMENT.stepHeight || y - h > MOVEMENT.snapDown + MOVEMENT.stepHeight) continue;
        if (!body((ix + dx / 2) * G, (iz + dz / 2) * G, Math.min(h, y), Math.max(h, y))) visit(ix + dx, iz + dz, h);
      }
      for (const l of world.ladders) {
        const [wx, wz] = l.wall, [ox, oz] = l.out, x = ix * G, z = iz * G;
        const along = (x - wx) * oz - (z - wz) * ox, out = (x - wx) * ox + (z - wz) * oz;
        if (Math.abs(along) > .5 || out < 0 || out > 1.6) continue;
        for (const [from, to] of [[l.bottom, l.top], [l.top, l.bottom]]) if (Math.abs(y - from) < .3) {
          for (let k = -6; k <= 6; k++) {
            const tx = Math.round((wx + ox * k * G) / G), tz = Math.round((wz + oz * k * G) / G);
            for (const h of surfaces(tx, tz)) if (Math.abs(h - to) < .3) visit(tx, tz, h);
          }
        }
      }
    }
    for (const s of layout.spawns) {
      const [ix, iz, y] = at(s.pos);
      expect(y !== undefined && seen.has(`${ix},${iz},${y.toFixed(2)}`), `${s.id} cannot be walked to from ${layout.spawns[0].id}`).toBe(true);
    }
  }, 120_000);

  it('keeps solid props off stair flights', () => {
    const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')) as { props: Record<string, { collider?: number[] | null }> };
    const flights: number[][] = [];
    for (const t of layout.terraces) for (const st of t.stairs ?? []) {
      const [x0, z0, x1, z1] = t.rect, depth = st.steps * st.run;
      flights.push(st.side === 'n' ? [st.from, z0, st.to, z0 + depth] : st.side === 's' ? [st.from, z1 - depth, st.to, z1]
        : st.side === 'w' ? [x0, st.from, x0 + depth, st.to] : [x1 - depth, st.from, x1, st.to]);
    }
    for (const o of layout.navigation?.groundObstacles ?? []) if (/(step|stair)/.test(o.id)) flights.push(o.rect);
    for (const p of layout.props) {
      const c = catalog.props[p.type]?.collider;
      if (!c) continue;
      const r = Math.min(c[0], c[2]) / 2;
      const on = flights.find((f) => p.pos[0] > f[0] - r && p.pos[0] < f[2] + r && p.pos[2] > f[1] - r && p.pos[2] < f[3] + r);
      expect(on, `${p.type} at ${p.pos} stands on a stair flight ${on}`).toBeUndefined();
    }
  });

  it('has no straight sightline across the whole level once structures and props block it', () => {
    // Eye-height rays along the axes from every metre of walkable street; the old compact maps
    // were ring roads with 46-48 m clear lanes along their edges.
    const [x0, z0, x1, z1] = layout.playArea;
    let longest = 0, at = '';
    for (const zone of [...layout.ground.zones, ...layout.ground.covered]) {
      const [rx0, rz0, rx1, rz1] = zone.rect;
      for (let x = Math.ceil(rx0) + .5; x < rx1; x += 1) for (let z = Math.ceil(rz0) + .5; z < rz1; z += 1) {
        const y = world.groundHeight(x, z, .05, 1.4);
        if (!Number.isFinite(y) || world.overlapsCylinder(x, z, .2, y + .5, y + 1.7)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const max = Math.max(x1 - x0, z1 - z0);
          const hit = world.raycast(x, y + MOVEMENT.standEye, z, dx, 0, dz, max);
          const d = hit ? hit.distance : max;
          if (d > longest) { longest = d; at = `${x},${z} dir ${dx},${dz}`; }
        }
      }
    }
    expect(longest, `longest clear axis sightline from ${at}`).toBeLessThan(40);
  });
});
