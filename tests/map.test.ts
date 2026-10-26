import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/config/constants';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerController } from '../src/player/PlayerController';

/** Every map with a layout and generated collision data gets the same gameplay checks. */
const MAP_IDS = readdirSync('src/maps', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`src/maps/${d.name}/layout.json`))
  .map((d) => d.name)
  .filter((id) => existsSync(`public/assets/models/${id}/collision.json`));

function loadMap(id: string) {
  const layout = JSON.parse(readFileSync(`src/maps/${id}/layout.json`, 'utf8')) as MapLayout;
  const collision = JSON.parse(readFileSync(`public/assets/models/${id}/collision.json`, 'utf8')) as CollisionFile;
  return { layout, collision };
}

const { layout } = loadMap('european-town');

describe('European Town layout data', () => {
  it('has the expected structure', () => {
    expect(layout.id).toBe('european-town');
    expect(layout.buildings.length).toBeGreaterThanOrEqual(8);
    const types = new Set(layout.buildings.map((b) => b.type));
    for (const t of ['stone2', 'plaster3', 'shop', 'corner', 'narrow_passage', 'archway', 'balcony', 'room']) {
      expect(types.has(t), `building type ${t}`).toBe(true);
    }
    expect(layout.targets.length).toBeGreaterThanOrEqual(8);
  });
});

const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')) as PropCatalog;

describe.each(MAP_IDS)('map %s: free-for-all layout', (id) => {
  const { layout } = loadMap(id);
  const raw = layout as unknown as Record<string, unknown>;

  it('has no safe zones, team spawns or team lights', () => {
    expect(layout.id).toBe(id);
    expect(raw.safeZones).toBeUndefined();
    for (const s of layout.spawns) expect((s as unknown as Record<string, unknown>).team).toBeUndefined();
    for (const l of layout.lights) expect((l as unknown as Record<string, unknown>).team).toBeUndefined();
    for (const z of layout.ground.zones) {
      expect(z.kind as string, z.id).not.toBe('spawn');
      expect((z as unknown as Record<string, unknown>).team, z.id).toBeUndefined();
    }
    expect(layout.targets.length).toBeGreaterThanOrEqual(8);
  });

  it('spreads its spawn points over the whole map', () => {
    const pts = layout.spawns.map((s) => s.pos);
    expect(pts.length).toBeGreaterThanOrEqual(12);
    expect(new Set(layout.spawns.map((s) => s.id)).size).toBe(pts.length);
    let minGap = Infinity;
    for (let a = 0; a < pts.length; a++)
      for (let b = a + 1; b < pts.length; b++) minGap = Math.min(minGap, Math.hypot(pts[a][0] - pts[b][0], pts[a][2] - pts[b][2]));
    expect(minGap).toBeGreaterThanOrEqual(4);
    // every quadrant of the map gets spawns, not just the old team yards at the west and east edges
    const [x0, z0, x1, z1] = layout.playArea;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      expect(pts.some((q) => (q[0] - cx) * sx > 0 && (q[2] - cz) * sz > 0), `quadrant ${sx},${sz}`).toBe(true);
    }
  });

  it('keeps spawns clear of props and practice targets', () => {
    for (const s of layout.spawns) {
      for (const t of layout.targets) expect(Math.hypot(t.pos[0] - s.pos[0], t.pos[2] - s.pos[2]), `${s.id} near ${t.id}`).toBeGreaterThanOrEqual(2);
      for (const p of [...layout.props, ...layout.obstacles]) {
        const col = catalog.props[p.type]?.collider;
        if (!col) continue;
        const a = (-p.heading * Math.PI) / 180;
        const rx = s.pos[0] - p.pos[0];
        const rz = s.pos[2] - p.pos[2];
        const lx = rx * Math.cos(a) - rz * Math.sin(a);
        const lz = rx * Math.sin(a) + rz * Math.cos(a);
        const inside = Math.abs(lx) < col[0] / 2 + MOVEMENT.radius && Math.abs(lz) < col[2] / 2 + MOVEMENT.radius;
        expect(inside, `${s.id} inside ${p.type}`).toBe(false);
      }
    }
  });

  it('no longer ships the old safe-zone sign props', () => {
    expect(layout.props.filter((p) => p.type === 'sign_blue' || p.type === 'sign_red')).toEqual([]);
  });
});

describe.each(MAP_IDS)('map %s: collision', (id) => {
  const { layout, collision } = loadMap(id);
  const world = new CollisionWorld();
  world.addMany(collision.boxes);

  it('spawns players on clear ground', () => {
    for (const s of layout.spawns) {
      const p = new PlayerController(world);
      p.teleport({ x: s.pos[0], y: s.pos[1] + 0.5, z: s.pos[2] }, s.heading);
      expect(p.grounded).toBe(true);
      expect(world.overlapsCylinder(p.position.x, p.position.z, MOVEMENT.radius, p.position.y + 0.45, p.position.y + 1.8)).toBe(false);
    }
  });

  it('keeps every walkable cell reachable for a player-sized body', () => {
    // Flood fill on a 0.5 m grid over the open zones, using the same probes as the controller.
    const step = 0.5;
    const r = MOVEMENT.radius;
    const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;
    const cells = new Map<string, { x: number; z: number; y: number }>();
    const zones = [...layout.ground.zones, ...layout.ground.covered.map((c) => ({ ...c, height: 0 }))];
    // one global grid for every zone (interiors start at fractional coordinates; per-zone grids would not line up)
    const first = (v: number) => Math.ceil((v - step / 2) / step) * step + step / 2;
    for (const zn of zones) {
      const [x0, z0, x1, z1] = zn.rect;
      for (let x = first(x0); x < x1; x += step) {
        for (let z = first(z0); z < z1; z += step) {
          const y = world.groundHeight(x, z, r * 0.7, 2.0);
          if (y === -Infinity) continue;
          if (world.overlapsCylinder(x, z, r, y + MOVEMENT.stepHeight, y + MOVEMENT.crouchHeight)) continue;
          cells.set(key(x, z), { x, z, y });
        }
      }
    }
    const spawn = layout.spawns[0];
    let start: string | null = null;
    let bestD = Infinity;
    for (const [k, c] of cells) {
      const d = Math.hypot(c.x - spawn.pos[0], c.z - spawn.pos[2]);
      if (d < bestD) {
        bestD = d;
        start = k;
      }
    }
    const seen = new Set<string>([start!]);
    const queue = [start!];
    while (queue.length) {
      const c = cells.get(queue.pop()!)!;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const k = key(c.x + dx, c.z + dz);
        const n = cells.get(k);
        if (!n || seen.has(k)) continue;
        if (n.y - c.y > MOVEMENT.stepHeight + 1e-3) continue; // too tall to step up
        seen.add(k);
        queue.push(k);
      }
    }
    const unreachable = [...cells.values()].filter((c) => !seen.has(key(c.x, c.z)));
    // allow a handful of edge cells squeezed between props/stairs; the network itself must connect
    expect(cells.size).toBeGreaterThan(1500);
    expect(unreachable.length / cells.size).toBeLessThan(0.02);
    // every spawn point is reachable from the first one
    for (const s of layout.spawns) {
      const near = [...seen].map((k) => cells.get(k)!).some((c) => Math.hypot(c.x - s.pos[0], c.z - s.pos[2]) < 1);
      expect(near, `spawn ${s.id}`).toBe(true);
    }
  });

  it('opens every passage, room and gate for walking through', () => {
    const covered = layout.ground.covered;
    expect(covered.length).toBeGreaterThan(4);
    for (const c of covered) {
      const [x0, z0, x1, z1] = c.rect;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      expect(world.overlapsCylinder(cx, cz, MOVEMENT.radius, 0.45, 1.8), `covered area ${c.id}`).toBe(false);
    }
  });
});
