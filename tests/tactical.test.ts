import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/config/constants';
import { TeammateRegistry } from '../src/game/Teammates';
import { classifyPoint, deriveTacticalMap, markerRotation, TacticalProjection, type TacticalMapData } from '../src/maps/tactical';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';

const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')) as PropCatalog;

/** Every map that ships a layout and generated collision data. */
const MAPS = readdirSync('src/maps', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`src/maps/${d.name}/layout.json`))
  .map((d) => d.name)
  .filter((id) => existsSync(`public/assets/models/${id}/collision.json`));

function load(id: string) {
  const layout = JSON.parse(readFileSync(`src/maps/${id}/layout.json`, 'utf8')) as MapLayout;
  const collision = JSON.parse(readFileSync(`public/assets/models/${id}/collision.json`, 'utf8')) as CollisionFile;
  const tactical = deriveTacticalMap(layout, catalog);
  const world = new CollisionWorld();
  world.addMany(collision.boxes);
  // the props the map draws block movement in the game too (MapManager adds the same colliders)
  for (const p of [...layout.props, ...layout.obstacles]) {
    const col = catalog.props[p.type]?.collider;
    if (!col || col[0] * col[2] < 1.0 || col[1] < 0.8) continue;
    const [w, h, d] = col;
    world.add({ c: [p.pos[0], p.pos[1] + h / 2, p.pos[2]], h: [w / 2, h / 2, d / 2], yaw: (-p.heading * Math.PI) / 180, tag: `prop:${p.type}` });
  }
  return { layout, tactical, world };
}

const arrow = (rot: number) => ({ x: Math.sin(rot), y: -Math.cos(rot) });

describe('tactical map projection', () => {
  const proj = new TacticalProjection([-35, -35, 35, 35], 700, 700);

  it('is north-up and not mirrored', () => {
    const c = proj.toMap(0, 0);
    expect(c.x).toBeCloseTo(350);
    expect(c.y).toBeCloseTo(350);
    expect(proj.toMap(0, -10).y).toBeLessThan(c.y); // north is up
    expect(proj.toMap(10, 0).x).toBeGreaterThan(c.x); // east is right
    expect(proj.toMap(-35, -35)).toEqual({ x: 0, y: 0 }); // north-west corner top-left
    expect(proj.toMap(35, 35).x).toBeCloseTo(700);
    const back = proj.toWorld(123, 456);
    const again = proj.toMap(back.x, back.z);
    expect(again.x).toBeCloseTo(123);
    expect(again.y).toBeCloseTo(456);
  });

  it('keeps a uniform scale and centres non-square levels', () => {
    const wide = new TacticalProjection([-50, -20, 50, 20], 600, 600);
    expect(wide.scale).toBeCloseTo(6);
    const a = wide.toMap(-50, -20);
    const b = wide.toMap(50, 20);
    expect(a.x).toBeCloseTo(0);
    expect(b.x).toBeCloseTo(600);
    expect((a.y + b.y) / 2).toBeCloseTo(300);
    expect(b.y - a.y).toBeCloseTo(240);
  });

  it('points the arrow along the compass heading', () => {
    const cases: [number, number, number][] = [
      [0, 0, -1],
      [90, 1, 0],
      [180, 0, 1],
      [270, -1, 0],
    ];
    for (const [heading, x, y] of cases) {
      const a = arrow(markerRotation(PlayerController.headingToYaw(heading)));
      expect(a.x, `heading ${heading}`).toBeCloseTo(x);
      expect(a.y, `heading ${heading}`).toBeCloseTo(y);
    }
  });
});

describe.each(MAPS)('tactical map of %s', (id) => {
  const { layout, tactical, world } = load(id);
  const proj = new TacticalProjection(tactical.bounds, 800, 800);

  it('moves the marker the way the player walks (forward, back, left, right)', () => {
    // Direction checks need room to finish a 40-tick stride in every direction.
    // Safe gameplay spawns promise body clearance, not an empty circular arena.
    const spawn = layout.spawns.find((s) => !world.overlapsCylinder(s.pos[0],s.pos[2],1.8,s.pos[1]+.45,s.pos[1]+1.8))!;
    expect(spawn).toBeDefined();
    for (const heading of [0, 37, 90, 180, 245, 300]) {
      for (const [ix, iz, turn] of [
        [0, 1, 0],
        [0, -1, Math.PI],
        [1, 0, Math.PI / 2],
        [-1, 0, -Math.PI / 2],
      ] as const) {
        const p = new PlayerController(world);
        p.teleport({ x: spawn.pos[0], y: spawn.pos[1] + 0.3, z: spawn.pos[2] }, heading);
        const a = proj.toMap(p.position.x, p.position.z);
        for (let i = 0; i < 40; i++) p.fixedUpdate(1 / 120, { ...NO_INTENT, x: ix, z: iz });
        const b = proj.toMap(p.position.x, p.position.z);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        expect(len, `${id} heading ${heading} intent ${ix},${iz}`).toBeGreaterThan(1);
        const want = arrow(markerRotation(p.yaw) + turn);
        expect((dx * want.x + dy * want.y) / len, `${id} heading ${heading} intent ${ix},${iz}`).toBeGreaterThan(0.999);
      }
    }
  });

  it('matches the collision world: open where players can walk, solid where they cannot', () => {
    const [x0, z0, x1, z1] = layout.playArea;
    const step = 0.25;
    // the walking surface: whatever can be stepped onto from the layout's ground level (terraces, stairs), not the top
    // of a crate stack, which blocks a walking player
    const zoneHeight = (x: number, z: number) =>
      Math.max(0, ...layout.ground.zones.filter((g) => x >= g.rect[0] && x <= g.rect[2] && z >= g.rect[1] && z <= g.rect[3]).map((g) => g.height));
    const blockedInWorld = (x: number, z: number) => {
      const g = world.groundHeight(x, z, 0.01, zoneHeight(x, z) + MOVEMENT.stepHeight);
      return world.overlapsCylinder(x, z, 0.01, g + MOVEMENT.stepHeight + 0.05, g + 1.7);
    };
    const blockedOnMap = (x: number, z: number) => classifyPoint(tactical, x, z) === 'blocked';
    let samples = 0;
    const wrong: string[] = [];
    for (let x = x0 + step / 2; x < x1; x += step) {
      for (let z = z0 + step / 2; z < z1; z += step) {
        samples++;
        const truth = blockedInWorld(x, z);
        if (blockedOnMap(x, z) === truth) continue;
        // within a few centimetres of an outline the two may disagree by rounding: only count clear mismatches
        const near = [
          [0.3, 0],
          [-0.3, 0],
          [0, 0.3],
          [0, -0.3],
        ].some(([dx, dz]) => blockedOnMap(x + dx, z + dz) === truth);
        if (!near) wrong.push(`(${x.toFixed(2)}, ${z.toFixed(2)}) world ${truth ? 'blocked' : 'open'}`);
      }
    }
    expect(samples).toBeGreaterThan(10000);
    expect(wrong.slice(0, 12), `${wrong.length} mismatching points`).toEqual([]);
  }, 60_000);

  it('draws no safe zones (free-for-all)', () => {
    expect((tactical as unknown as Record<string, unknown>).zones).toBeUndefined();
  });

  it('shows the play area and every spawn on walkable ground', () => {
    const [bx0, bz0, bx1, bz1] = tactical.bounds;
    const [px0, pz0, px1, pz1] = layout.playArea;
    expect(bx0 <= px0 && bz0 <= pz0 && bx1 >= px1 && bz1 >= pz1).toBe(true);
    for (const s of layout.spawns) expect(classifyPoint(tactical, s.pos[0], s.pos[2]), `spawn ${s.pos}`).toBe('open');
  });

  it('marks roofed routes as walkable (passages, rooms, interiors)', () => {
    for (const c of layout.ground.covered) {
      const cx = (c.rect[0] + c.rect[2]) / 2;
      const cz = (c.rect[1] + c.rect[3]) / 2;
      expect(classifyPoint(tactical, cx, cz), c.id).toBe('covered');
    }
  });

  it('is plain JSON (can be exported and loaded instead of derived)', () => {
    const copy = JSON.parse(JSON.stringify(tactical)) as TacticalMapData;
    expect(copy).toEqual(tactical);
  });
});

describe('teammate markers', () => {
  it('shows nobody until a data source reports players', () => {
    const reg = new TeammateRegistry();
    expect(reg.friendlies('blue', 'me', 0)).toEqual([]);
  });

  it('returns fresh, living players of the same team only (never enemies, never yourself)', () => {
    const reg = new TeammateRegistry(1000);
    reg.update({ id: 'me', team: 'blue', x: 0, z: 0 }, 0);
    reg.update({ id: 'ally', team: 'blue', x: 3, z: 4, name: 'Ally' }, 0);
    reg.update({ id: 'enemy', team: 'red', x: 5, z: 5 }, 0);
    reg.update({ id: 'down', team: 'blue', x: 1, z: 1, alive: false }, 0);
    expect(reg.friendlies('blue', 'me', 500).map((p) => p.id)).toEqual(['ally']);
    expect(reg.friendlies('red', 'enemy', 500)).toEqual([]);
    // positions update in place
    reg.update({ id: 'ally', team: 'blue', x: 7, z: 8 }, 600);
    expect(reg.friendlies('blue', 'me', 700)[0]).toMatchObject({ x: 7, z: 8 });
    // stale data disappears instead of showing a frozen marker
    expect(reg.friendlies('blue', 'me', 1700)).toEqual([]);
    reg.clear();
    expect(reg.size).toBe(0);
  });
});
