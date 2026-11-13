import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { unsafeMovement } from '../shared/movementSafety';
import { WORLDS } from '../server/src/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import type { CollisionFile, MapLayout } from '../src/maps/types';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';
import { PracticeNavigation } from '../src/practice/Navigation';

/**
 * Farmstead (2026-11): every opening of every building is walked with the real shared controller, stairs and
 * balconies are climbed in both directions and the open shacks are crossed. Everything is above ground (the storm shelter and the
 * yard fence were removed 2026-11-12) and Practice navigation connects every spawn.
 */
// Every opening is walked with the real controller at 120 Hz: a few of these take longer than the default 5 s.
vi.setConfig({ testTimeout: 120_000 });
const { world, layout } = WORLDS.farmstead;
const farm = layout.farm!;
type Wall = { t: 'wall'; rect: [number, number, number, number]; y: [number, number]; open: { a: [number, number]; top: number; sill?: number; kind: string }[]; outside?: string };
const walls = farm.structures.flatMap((s) => s.elements.filter((e) => e.t === 'wall').map((e) => ({ id: s.id, ...(e as unknown as Wall) })));
const WEAPONS = [null, 'rifle', 'sniper'] as const;

/** Walk to (tx, tz) facing the travel direction; returns the player. */
function walkTo(p: PlayerController, tx: number, tz: number, seconds = 12): void {
  for (let tick = 0; tick < Math.ceil(seconds / FIXED_DT); tick++) {
    const dx = tx - p.position.x, dz = tz - p.position.z, dist = Math.hypot(dx, dz);
    if (dist < 0.1) return;
    p.yaw = PlayerController.headingToYaw((Math.atan2(dx, -dz) * 180) / Math.PI);
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1 });
    expect(world.overlapsCylinder(p.position.x, p.position.z, MOVEMENT.radius, p.position.y + MOVEMENT.stepHeight + 0.01, p.position.y + MOVEMENT.standHeight), `body in a solid at ${p.position.x.toFixed(2)},${p.position.y.toFixed(2)},${p.position.z.toFixed(2)} going to ${tx},${tz}`).toBe(false);
    expect(unsafeMovement(p.position, layout as MapLayout)).toBeNull();
  }
}

function player(x: number, y: number, z: number, weapon: (typeof WEAPONS)[number], heading = 0) {
  const p = new PlayerController(world);
  p.weaponClearance = weapon;
  p.teleport({ x, y, z }, heading);
  return p;
}

describe('farmstead layout', () => {
  it('is a registered map with the plan buildings, four shacks and 16 spawns, all above ground', () => {
    expect(layout.id).toBe('farmstead');
    expect(farm.structures.map((s) => s.id).sort()).toEqual(['barn', 'cabin', 'garage', 'house', 'shack_1', 'shack_2', 'shack_3', 'shack_4']);
    expect(layout.spawns.length).toBeGreaterThanOrEqual(12);
    expect(layout.underground ?? []).toEqual([]);
    expect(layout.buildings).toEqual([]);
  });

  it('has no doors anywhere', () => {
    // doorways are holes: no element is a door leaf
    for (const s of farm.structures) for (const e of s.elements) expect(JSON.stringify(e)).not.toMatch(/door_leaf|hinge/);
  });

  it('has no yard fence: a walker crosses the old fence lines anywhere and only the stone wall stops them', () => {
    expect((farm as { fences?: unknown }).fences).toBeUndefined();
    expect([...world.all()].filter((c) => c.tag.startsWith('farm:fence'))).toHaveLength(0);
    for (const [from, to, heading] of [[[-30.5, -11], [-36, -11], 270], [[30.5, -3], [36, -3], 90], [[14, -40], [14, -46], 0], [[10, 38], [10, 44], 180]] as const) {
      const p = player(from[0], 0, from[1], null, heading);
      walkTo(p, to[0], to[1], 6);
      expect(Math.hypot(p.position.x - to[0], p.position.z - to[1]), `walker from ${from} to the wall`).toBeLessThan(0.2);
    }
  });
});

describe('farmstead buildings', () => {
  const doors = walls.flatMap((w) => w.open.filter((o) => (o.sill ?? 0) === 0).map((o) => ({ w, o })));
  const windows = walls.flatMap((w) => w.open.filter((o) => (o.sill ?? 0) > 0 && w.y[0] === 0).map((o) => ({ w, o })));

  it('has real openings in every building', () => {
    expect(doors.length).toBeGreaterThan(30);
    expect(windows.length).toBeGreaterThan(15);
  });

  it.each(WEAPONS.map((w) => [w]))('walks through every open entry of every wall, both ways (weapon %s)', (weapon) => {
    for (const { w, o } of doors) {
      const [x0, z0, x1, z1] = w.rect;
      const alongX = x1 - x0 >= z1 - z0;
      const line = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
      const y = w.y[0];
      // An entry is passable when some lane through it is clear: furniture or a stairwell may stand off to one side.
      const lanes = [(o.a[0] + o.a[1]) / 2, o.a[0] + (o.a[1] - o.a[0]) * 0.3, o.a[0] + (o.a[1] - o.a[0]) * 0.7];
      for (const dir of [1, -1]) {
        const a = line - 1.4 * dir, b = line + 1.4 * dir;
        const results = lanes.map((mid) => {
          if (world.overlapsCylinder(alongX ? mid : a, alongX ? a : mid, MOVEMENT.radius, y + 0.45, y + MOVEMENT.standHeight)) return Infinity;
          const p = alongX ? player(mid, y, a, weapon) : player(a, y, mid, weapon);
          if (alongX) walkTo(p, mid, b); else walkTo(p, b, mid);
          if (Math.abs(p.position.y - y) > 0.2) return Infinity;
          return Math.hypot(p.position.x - (alongX ? mid : b), p.position.z - (alongX ? b : mid));
        });
        expect(Math.min(...results), `${w.id} ${JSON.stringify(o.a)} at ${line} ${weapon} dir ${dir}: lanes ${results.map((r) => r.toFixed(2))}`).toBeLessThan(0.25);
      }
    }
  });

  it('keeps ground-floor windows shut to walkers (a sill and a lintel) but open to the eye', () => {
    for (const { w, o } of windows) {
      const [x0, z0, x1, z1] = w.rect;
      const alongX = x1 - x0 >= z1 - z0;
      const mid = (o.a[0] + o.a[1]) / 2, line = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
      const sgn = w.outside === 'n' || w.outside === 'w' ? -1 : 1;
      const [sx, sz] = alongX ? [mid, line + sgn * 1.2] : [line + sgn * 1.2, mid];
      // (a bush or crate may stand in front of a window: only open ground makes the test meaningful)
      if (world.overlapsCylinder(sx, sz, MOVEMENT.radius, 0.45, MOVEMENT.standHeight)) continue;
      const p = player(sx, 0, sz, null);
      if (alongX) walkTo(p, mid, line - sgn * 1.7, 3); else walkTo(p, line - sgn * 1.7, mid, 3);
      const across = alongX ? p.position.z : p.position.x;
      expect(Math.abs(across - line), `${w.id} window ${o.a} let a walker through`).toBeGreaterThan(0.2);
    }
  });

  it.each(WEAPONS.map((w) => [w]))('climbs every staircase and back down (weapon %s)', (weapon) => {
    for (const s of farm.structures) for (const el of s.elements.filter((e) => e.t === 'stairs')) {
      const [x0, z0, x1, z1] = el.rect as number[];
      const dir = el.dir as string, y0 = el.y0 as number, y1 = el.y1 as number;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      // (the cabin's landing is a one metre strip against its north wall: stop 0.6 m beyond the top step)
      const [bottom, top]: [number[], number[]] = dir === 'n' ? [[cx, z1 + 1.1], [cx, z0 - 0.6]] : dir === 's' ? [[cx, z0 - 0.6], [cx, z1 + 1.1]]
        : dir === 'w' ? [[x1 + 1.1, cz], [x0 - 0.6, cz]] : [[x0 - 0.6, cz], [x1 + 1.1, cz]];
      const up = player(bottom[0], y0, bottom[1], weapon);
      walkTo(up, top[0], top[1]);
      expect(up.position.y, `${s.id} stairs up`).toBeCloseTo(y1, 1);
      const down = player(top[0], y1, top[1], weapon);
      walkTo(down, bottom[0], bottom[1]);
      expect(down.position.y, `${s.id} stairs down`).toBeCloseTo(y0, 1);
    }
  });

  it('wraps the cabin balcony west, south and east, with a gap in the south railing to drop through', () => {
    const cabin = farm.structures.find((s) => s.id === 'cabin')!;
    const rails = cabin.elements.filter((e) => e.t === 'rail');
    const decks = cabin.elements.filter((e) => e.t === 'slab' && e.kind === 'deck');
    expect(decks).toHaveLength(3);
    const south = rails.find((r) => (r.a as number[])[1] === (r.b as number[])[1] && (r.gaps as number[][]).length > 0)!;
    expect(south).toBeDefined();
    const [g0, g1] = (south.gaps as number[][])[0];
    // on the balcony: a walker is stopped by the railing anywhere but the gap
    for (const x of [14.8, 18.5, 26.5, 29.5]) {
      const p = player(x, 3.4, -24, 'rifle', 180);
      walkTo(p, x, -19.5, 4);
      expect(p.position.y, `railing at x=${x}`).toBeGreaterThan(3.3);
    }
    const p = player((g0 + g1) / 2, 3.4, -24, 'rifle', 180);
    walkTo(p, (g0 + g1) / 2, -19.5, 6);
    for (let i = 0; i < 240; i++) p.fixedUpdate(FIXED_DT, NO_INTENT);   // land
    expect(p.position.y, 'dropped through the gap').toBeLessThan(0.3);
    // all three sides are reachable from the upper rooms
    for (const [x, z] of [[14.6, -31], [29.4, -28.7], [22, -24]]) {
      const q = player(x, 3.4, z, null);
      walkTo(q, x, z + 0.5, 1);
      expect(q.position.y).toBeGreaterThan(3.3);
    }
  });

  it('keeps the four shacks open on every side: only posts, a floor and a roof slab are solid', () => {
    const collision = JSON.parse(readFileSync('public/assets/models/farmstead/collision.json', 'utf8')) as CollisionFile;
    for (const s of farm.structures.filter((q) => q.id.startsWith('shack'))) {
      expect(s.elements.filter((e) => e.t === 'wall')).toHaveLength(0);
      const solids = collision.boxes.filter((b) => b.tag.startsWith(`farm:${s.id}:`));
      expect(solids.filter((b) => b.tag.endsWith(':post')), `${s.id} posts`).toHaveLength(4);
      expect(solids.filter((b) => b.tag.endsWith(':floor') || b.tag.endsWith(':ceiling')), `${s.id} slabs`).toHaveLength(2);
      expect(solids.filter(b=>!b.tag.includes(':roof:')), `${s.id} only posts and slabs below the roof`).toHaveLength(6);expect(solids.filter(b=>b.tag.includes(':roof:')).length).toBeGreaterThan(0);
      // each post is a slim column at a corner, so every side is open between them
      for (const post of solids.filter((b) => b.tag.endsWith(':post'))) expect(Math.max(post.h[0], post.h[2])).toBeLessThan(0.2);
      // a walker crosses each side's open middle into the shack's footprint (props off to one side)
      const [x0, z0, x1, z1] = s.rect;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const lateral = [0, 1.2, -1.2, 1.7, -1.7];
        const reached = lateral.some((off) => {
          const start = sx === 0 ? [cx + off, cz + sz * 2.7] : [cx + sx * 2.7, cz + off];
          const stop = sx === 0 ? [cx + off, cz + sz * 1.7] : [cx + sx * 1.7, cz + off];
          if (world.overlapsCylinder(start[0], start[1], MOVEMENT.radius, 0.45, MOVEMENT.standHeight)) return false;
          const p = player(start[0], 0, start[1], null);
          walkTo(p, stop[0], stop[1], 5);
          return Math.hypot(p.position.x - stop[0], p.position.z - stop[1]) < 0.3;
        });
        expect(reached, `${s.id} side ${sx},${sz}`).toBe(true);
      }
    }
  });
});

describe('farmstead is entirely above ground', () => {
  it('has no underground passage, stair, tunnel or hole in the ground', () => {
    expect(layout.underground ?? []).toEqual([]);
    expect([...world.all()].filter((c) => c.tag.startsWith('underground:'))).toHaveLength(0);
    expect(farm.solids.filter((s) => s.id.startsWith('underground'))).toHaveLength(0);
    expect((farm as { entranceWalks?: unknown }).entranceWalks).toBeUndefined();
    // every metre of the yard has solid ground at street level: nothing drops away where an entrance used to be
    const [x0, z0, x1, z1] = layout.playArea;
    let holes = 0;
    for (let x = x0 + .5; x < x1; x += 1) for (let z = z0 + .5; z < z1; z += 1) {
      if (world.groundHeight(x, z, MOVEMENT.radius, 1.2) < -0.05) holes++;
    }
    expect(holes, 'points without street-level ground').toBe(0);
  });

  it('is connected for Practice bots from every spawn', () => {
    const nav = new PracticeNavigation(world, layout as MapLayout);
    const street = nav.nearest({ x: layout.spawns[0].pos[0], y: 0, z: layout.spawns[0].pos[2] })!;
    for (const s of layout.spawns) {
      const n = nav.nearest({ x: s.pos[0], y: 0, z: s.pos[2] })!;
      expect(n.component, `spawn ${s.id}`).toBe(street.component);
    }
  }, 120_000);
});
