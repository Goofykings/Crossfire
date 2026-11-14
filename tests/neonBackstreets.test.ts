import { describe, expect, it, vi } from 'vitest';
import { unsafeMovement } from '../shared/movementSafety';
import { MAP_IDS } from '../shared/maps';
import { WORLDS } from '../server/src/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import type { MapLayout } from '../src/maps/types';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { PracticeNavigation } from '../src/practice/Navigation';

/**
 * Neon Backstreets (2026-11): the compact night map. Every doorway of the playable buildings is walked with the real shared
 * controller, every staircase is climbed both ways, both elevated decks are reached by two independent routes and left
 * through their drop-down gaps, glazed shop windows stop walkers and bullets, spawns are screened from each other and
 * Practice navigation connects everything. Layout source: tools/layout_neon.py, tools/neon_structures.py.
 */
vi.setConfig({ testTimeout: 120_000 });
const { world, layout } = WORLDS['neon-backstreets'];
const farm = layout.farm!;
const UP = 3.55;
type Wall = { t: 'wall'; rect: [number, number, number, number]; y: [number, number]; open: { a: [number, number]; top: number; sill?: number }[]; outside?: string };
const PLAYABLE = ['mart', 'ramen', 'laundromat', 'se_block'];
const glazed = (sid: string, w: Wall, o: Wall['open'][number]) => farm.structures.find((s) => s.id === sid)!.elements.some((e) => {
  if (e.kind !== 'glass') return false;
  const b = e.box as number[];
  const [x0, z0, x1, z1] = w.rect, alongX = x1 - x0 >= z1 - z0;
  const inWall = alongX ? b[2] >= z0 - .01 && b[5] <= z1 + .01 : b[0] >= x0 - .01 && b[3] <= x1 + .01;
  const a0 = alongX ? b[0] : b[2], a1 = alongX ? b[3] : b[5];
  return inWall && Math.abs(a0 - o.a[0]) < .01 && Math.abs(a1 - o.a[1]) < .01;
});
const walls = farm.structures.filter((s) => PLAYABLE.includes(s.id)).flatMap((s) => s.elements.filter((e) => e.t === 'wall').map((e) => ({ id: s.id, ...(e as unknown as Wall) })));
const WEAPONS = [null, 'rifle', 'sniper'] as const;

function walkTo(p: PlayerController, tx: number, tz: number, seconds = 12, label = ''): void {
  for (let tick = 0; tick < Math.ceil(seconds / FIXED_DT); tick++) {
    const dx = tx - p.position.x, dz = tz - p.position.z, dist = Math.hypot(dx, dz);
    if (dist < 0.1) return;
    p.yaw = PlayerController.headingToYaw((Math.atan2(dx, -dz) * 180) / Math.PI);
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1 });
    expect(world.overlapsCylinder(p.position.x, p.position.z, MOVEMENT.radius, p.position.y + MOVEMENT.stepHeight + 0.01, p.position.y + MOVEMENT.standHeight),
      `${label} body in a solid at ${p.position.x.toFixed(2)},${p.position.y.toFixed(2)},${p.position.z.toFixed(2)} going to ${tx},${tz}`).toBe(false);
    expect(unsafeMovement(p.position, layout as MapLayout)).toBeNull();
  }
}

function player(x: number, y: number, z: number, weapon: (typeof WEAPONS)[number] = null, heading = 0) {
  const p = new PlayerController(world);
  p.weaponClearance = weapon;
  p.teleport({ x, y, z }, heading);
  return p;
}

/** Strafe to (tx, tz) while facing `heading` (how a player with a long gun crosses a narrow room). */
function strafeTo(p: PlayerController, tx: number, tz: number, heading: number, label: string): void {
  p.yaw = PlayerController.headingToYaw(heading);
  for (let tick = 0; tick < Math.ceil(12 / FIXED_DT); tick++) {
    const dx = tx - p.position.x, dz = tz - p.position.z, dist = Math.hypot(dx, dz);
    if (dist < 0.1) return;
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw), x = dx / dist, z = dz / dist;
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, x: x * c - z * s, z: -x * s - z * c });
    expect(world.overlapsCylinder(p.position.x, p.position.z, MOVEMENT.radius, p.position.y + MOVEMENT.stepHeight + 0.01, p.position.y + MOVEMENT.standHeight), `${label} body in a solid`).toBe(false);
  }
}

/** Walk a route of [x, z] points (with an optional heading to strafe facing) and return the heights passed through. */
function route(points: ([number, number] | [number, number, number])[], y: number, weapon: (typeof WEAPONS)[number], label: string) {
  const p = player(points[0][0], y, points[0][1], weapon);
  const heights: number[] = [];
  for (const [x, z, face] of points.slice(1)) {
    if (face === undefined) walkTo(p, x, z, 12, label); else strafeTo(p, x, z, face, label);
    expect(Math.hypot(p.position.x - x, p.position.z - z), `${label} stuck before ${x},${z} at ${JSON.stringify(p.position)}`).toBeLessThan(.2);
    heights.push(p.position.y);
  }
  return { p, heights };
}

describe('neon backstreets layout', () => {
  it('is registered, compact and above ground', () => {
    expect(MAP_IDS).toContain('neon-backstreets');
    expect(layout.underground ?? []).toEqual([]);
    expect(layout.buildings).toEqual([]);
    const [x0, z0, x1, z1] = layout.playArea;
    const area = (x1 - x0) * (z1 - z0);
    for (const id of MAP_IDS.filter((m) => m !== 'neon-backstreets')) {
      const [a0, b0, a1, b1] = WORLDS[id].layout.playArea;
      expect(area, `smaller than ${id}`).toBeLessThan((a1 - a0) * (b1 - b0));
    }
    expect(layout.spawns.length).toBeGreaterThanOrEqual(12);
    expect(farm.structures.map((s) => s.id)).toEqual(expect.arrayContaining([...PLAYABLE, 'kiosk', 'ad_pillar', 'sidewalks', 'gates']));
  });

  it('screens spawns from each other: no spawn sees more than two others, none closer than 12 m in plain view', () => {
    const eye = MOVEMENT.standEye;
    for (const a of layout.spawns) {
      let seen = 0;
      for (const b of layout.spawns) {
        if (a === b) continue;
        const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1], dz = b.pos[2] - a.pos[2], d = Math.hypot(dx, dy, dz);
        const hit = world.raycast(a.pos[0], a.pos[1] + eye, a.pos[2], dx / d, dy / d, dz / d, d);
        if (hit) continue;
        seen++;
        expect(d, `${a.id} sees ${b.id}`).toBeGreaterThan(12);
      }
      expect(seen, `${a.id} sees ${seen} spawns`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps a few longer lanes for rifles (over 25 m) while no axis line crosses the block', () => {
    const lanes = [[[-19.3, -16.3], [1, 0]], [[16.2, -18.0], [0, 1]], [[-17.5, -12.0], [0, 1]]] as const;
    const lengths = lanes.map(([[x, z], [dx, dz]]) => world.raycast(x, MOVEMENT.standEye, z, dx, 0, dz, 60)?.distance ?? 60);
    expect(lengths.filter((d) => d > 25).length, `lane lengths ${lengths.map((d) => d.toFixed(1))}`).toBeGreaterThanOrEqual(2);
    for (const d of lengths) expect(d).toBeLessThan(40);
  });
});

describe('neon backstreets buildings', () => {
  const doors = walls.flatMap((w) => w.open.filter((o) => (o.sill ?? 0) === 0 && !glazed(w.id, w, o)).map((o) => ({ w, o })));

  it('opens real doorways in every playable building, including the upper-room and terrace doors', () => {
    for (const id of PLAYABLE) expect(doors.filter((d) => d.w.id === id).length, id).toBeGreaterThanOrEqual(1);
    expect(doors.filter((d) => d.w.y[0] > 3).length).toBeGreaterThanOrEqual(2);
    expect(doors.length).toBeGreaterThanOrEqual(9);
  });

  it.each(WEAPONS.map((w) => [w]))('walks through every doorway both ways (weapon %s)', (weapon) => {
    for (const { w, o } of doors) {
      const [x0, z0, x1, z1] = w.rect;
      const alongX = x1 - x0 >= z1 - z0;
      const line = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
      const y = w.y[0];
      const lanes = [(o.a[0] + o.a[1]) / 2, o.a[0] + (o.a[1] - o.a[0]) * 0.35, o.a[0] + (o.a[1] - o.a[0]) * 0.65];
      for (const dir of [1, -1]) {
        const a = line - 1.3 * dir, b = line + 1.3 * dir;
        const results = lanes.map((mid) => {
          const sx = alongX ? mid : a, sz = alongX ? a : mid;
          const ground = world.groundHeight(sx, sz, MOVEMENT.radius * .9, y + .5);
          if (!Number.isFinite(ground) || world.overlapsCylinder(sx, sz, MOVEMENT.radius, ground + 0.45, ground + MOVEMENT.standHeight)) return Infinity;
          const p = player(sx, ground, sz, weapon);
          if (alongX) walkTo(p, mid, b); else walkTo(p, b, mid);
          // (beyond the terrace door the stairwell's landing is short: the far point may be on the first step down)
          const far = world.groundHeight(alongX ? mid : b, alongX ? b : mid, MOVEMENT.radius * .9, y + .5);
          if (Math.abs(p.position.y - far) > 0.3) return Infinity;
          return Math.hypot(p.position.x - (alongX ? mid : b), p.position.z - (alongX ? b : mid));
        });
        expect(Math.min(...results), `${w.id} ${JSON.stringify(o.a)} at ${line} y ${y} ${weapon} dir ${dir}: ${results.map((r) => r.toFixed(2))}`).toBeLessThan(0.25);
      }
    }
  });

  it('stops walkers and bullets at the glazed shop windows (but not at the open ramen hatch)', () => {
    const panes = farm.structures.filter((s) => PLAYABLE.includes(s.id)).flatMap((s) => s.elements.filter((e) => e.kind === 'glass').map((e) => e.box as number[]));
    expect(panes.length).toBeGreaterThanOrEqual(8);
    for (const b of panes) {
      const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, thinX = b[3] - b[0] < b[5] - b[2];
      const y = (b[1] + b[4]) / 2;
      const hit = thinX ? world.raycast(cx - 1, y, cz, 1, 0, 0, 2) : world.raycast(cx, y, cz - 1, 0, 0, 1, 2);
      expect(hit?.collider.tag, `pane at ${cx},${cz}`).toMatch(/:glass$/);
    }
    // the take-away hatch on the noodle alley is open: a shot goes through into the dining room
    expect(world.raycast(-1, 1.6, -9.4, 1, 0, 0, 3)).toBeNull();
  });

  it.each(WEAPONS.map((w) => [w]))('climbs every staircase and back down (weapon %s)', (weapon) => {
    let count = 0;
    for (const s of farm.structures) for (const el of s.elements.filter((e) => e.t === 'stairs')) {
      count++;
      const [x0, z0, x1, z1] = el.rect as number[];
      const dir = el.dir as string, y0 = el.y0 as number, y1 = el.y1 as number;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const [bottom, top]: [number[], number[]] = dir === 'n' ? [[cx, z1 + .9], [cx, z0 - .7]] : dir === 's' ? [[cx, z0 - .5], [cx, z1 + .9]]
        : dir === 'w' ? [[x1 + .9, cz], [x0 - .7, cz]] : [[x0 - .7, cz], [x1 + .9, cz]];
      const up = player(bottom[0], y0, bottom[1], weapon);
      walkTo(up, top[0], top[1], 12, `${s.id} up`);
      expect(up.position.y, `${s.id} stairs up`).toBeCloseTo(y1, 1);
      const down = player(top[0], y1, top[1], weapon);
      walkTo(down, bottom[0], bottom[1], 12, `${s.id} down`);
      expect(down.position.y, `${s.id} stairs down`).toBeCloseTo(y0, 1);
    }
    expect(count).toBe(4);
  });
});

describe('neon backstreets elevated decks', () => {
  it.each(WEAPONS.map((w) => [w]))('loops the ramen balcony: exterior stair up, upper room, interior stair down, out the kitchen door (weapon %s)', (weapon) => {
    const { heights } = route([[11.3, 3.2], [11.3, -3.1], [1.7, -3.3], [1.7, -5.5], [9.0, -5.45], [10.9, -5.45], [11.5, -11.0], [9.4, -11.3], [9.4, -5.45, 90], [13.4, -5.45]], 0, weapon, 'ramen loop');
    expect(heights[1]).toBeCloseTo(UP, 1);       // on the balcony
    expect(heights[3]).toBeCloseTo(UP, 1);       // in the upper room
    expect(heights[heights.length - 1]).toBeLessThan(.2);
  });

  it.each(WEAPONS.map((w) => [w]))('loops the roof terrace: court stair up, terrace, stairwell down, out through the underpass (weapon %s)', (weapon) => {
    const { heights } = route([[2.3, 14.3], [2.3, 7.8], [4.4, 7.7], [11.0, 7.4], [11.0, 9.0], [11.0, 13.3], [9.0, 13.95], [8.0, 13.95], [8.0, 16.5]], 0, weapon, 'terrace loop');
    expect(heights[1]).toBeCloseTo(UP, 1);
    expect(heights[3]).toBeCloseTo(UP, 1);
    expect(heights[heights.length - 1]).toBeLessThan(.2);
  });

  it('lets players drop from both decks through their railing gaps, and holds them at the railing elsewhere', () => {
    for (const [from, to, gap] of [[[3.55, -3.5], [3.55, -1.2], true], [[7.0, -3.5], [7.0, -1.2], false],
      [[4.75, 6.0], [4.75, 3.2], true], [[8.5, 6.0], [8.5, 3.2], false]] as const) {
      const p = player(from[0], UP, from[1]);
      walkTo(p, to[0], to[1], 4);
      for (let i = 0; i < 240; i++) p.fixedUpdate(FIXED_DT, NO_INTENT);
      if (gap) expect(p.position.y, `drop at ${from}`).toBeLessThan(.2);
      else expect(p.position.y, `railing at ${from}`).toBeCloseTo(UP, 1);
    }
  });

  it('connects every spawn and both decks in the Practice navigation graph', () => {
    const nav = new PracticeNavigation(world, layout as MapLayout);
    const street = nav.nearest({ x: layout.spawns[0].pos[0], y: layout.spawns[0].pos[1], z: layout.spawns[0].pos[2] })!;
    for (const s of layout.spawns) expect(nav.nearest({ x: s.pos[0], y: s.pos[1], z: s.pos[2] })!.component, s.id).toBe(street.component);
    for (const [x, z] of [[6, -3.6], [7, 6.5], [5, -8]]) {
      const n = nav.nearest({ x, y: UP, z })!;
      expect(Math.abs(n.y - UP), `deck node near ${x},${z}`).toBeLessThan(.3);
      expect(n.component, `deck ${x},${z}`).toBe(street.component);
    }
  });
});
