import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../src/config/constants';
import { SafeZoneSystem } from '../src/game/SafeZones';
import type { CollisionFile, MapLayout } from '../src/maps/types';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { PlayerController } from '../src/player/PlayerController';

const layout = JSON.parse(readFileSync('src/maps/european-town/layout.json', 'utf8')) as MapLayout;
const collision = JSON.parse(
  readFileSync('public/assets/models/european-town/collision.json', 'utf8'),
) as CollisionFile;

function buildWorld(): CollisionWorld {
  const w = new CollisionWorld();
  for (const b of collision.boxes) w.add(b);
  return w;
}

describe('European Town layout data', () => {
  it('has the expected structure', () => {
    expect(layout.id).toBe('european-town');
    expect(layout.buildings.length).toBeGreaterThanOrEqual(8);
    const types = new Set(layout.buildings.map((b) => b.type));
    for (const t of ['stone2', 'plaster3', 'shop', 'corner', 'narrow_passage', 'archway', 'balcony', 'room']) {
      expect(types.has(t), `building type ${t}`).toBe(true);
    }
    expect(layout.safeZones.map((z) => z.team).sort()).toEqual(['blue', 'red']);
    expect(layout.targets.length).toBeGreaterThanOrEqual(8);
  });

  it('places every spawn inside its own safe zone', () => {
    for (const s of layout.spawns) {
      const zone = layout.safeZones.find((z) => z.team === s.team)!;
      const [x0, z0, x1, z1] = zone.rect;
      expect(s.pos[0]).toBeGreaterThan(x0);
      expect(s.pos[0]).toBeLessThan(x1);
      expect(s.pos[2]).toBeGreaterThan(z0);
      expect(s.pos[2]).toBeLessThan(z1);
    }
  });

  it('has safe zones at opposite edges of the map', () => {
    const blue = layout.safeZones.find((z) => z.team === 'blue')!.rect;
    const red = layout.safeZones.find((z) => z.team === 'red')!.rect;
    expect((blue[0] + blue[2]) / 2).toBeLessThan(-20);
    expect((red[0] + red[2]) / 2).toBeGreaterThan(20);
  });
});

describe('safe zone entrances', () => {
  const world = buildWorld();
  const zones = new SafeZoneSystem(layout.safeZones);

  it('gives each zone entrances on its own edges with a sensible height', () => {
    for (const zone of layout.safeZones) {
      const [x0, z0, x1, z1] = zone.rect;
      expect(zone.entrances?.length, zone.id).toBeGreaterThanOrEqual(2);
      for (const e of zone.entrances!) {
        const [lo, hi] = e.side === 'n' || e.side === 's' ? [x0, x1] : [z0, z1];
        expect(e.from).toBeGreaterThanOrEqual(lo);
        expect(e.to).toBeLessThanOrEqual(hi);
        expect(e.to - e.from).toBeGreaterThanOrEqual(2);
        expect(e.height).toBeGreaterThan(2);
        expect(e.height).toBeLessThanOrEqual(3.5);
      }
    }
  });

  it('leads onto ground a player can stand on, one body width beyond each barrier', () => {
    for (const zone of layout.safeZones) {
      const [x0, z0, x1, z1] = zone.rect;
      for (const e of zone.entrances!) {
        const mid = (e.from + e.to) / 2;
        const out = 1.2;
        const [px, pz] = { n: [mid, z0 - out], s: [mid, z1 + out], w: [x0 - out, mid], e: [x1 + out, mid] }[e.side];
        const p = new PlayerController(world);
        p.teleport({ x: px, y: 0.5, z: pz }, 0);
        expect(p.grounded, `${zone.id} ${e.side}`).toBe(true);
        expect(world.overlapsCylinder(px, pz, MOVEMENT.radius, 0.45, 1.8), `${zone.id} ${e.side}`).toBe(false);
        // and that spot is not yet protected, while the spot just behind the barrier plane is
        expect(zones.isProtected({ x: px, y: 1, z: pz }, MOVEMENT.radius)).toBe(false);
      }
    }
  });

  it('protects a player exactly where the barrier plane stands (one body radius outside the zone edge)', () => {
    const r = MOVEMENT.radius;
    for (const zone of layout.safeZones) {
      const [x0, z0, x1, z1] = zone.rect;
      for (const e of zone.entrances!) {
        const mid = (e.from + e.to) / 2;
        const at = (d: number) =>
          ({ n: { x: mid, y: 1, z: z0 - r + d }, s: { x: mid, y: 1, z: z1 + r - d }, w: { x: x0 - r + d, y: 1, z: mid }, e: { x: x1 + r - d, y: 1, z: mid } })[e.side];
        expect(zones.isProtected(at(-0.02), r), `${zone.id} ${e.side} before the plane`).toBe(false);
        expect(zones.isProtected(at(0.02), r), `${zone.id} ${e.side} past the plane`).toBe(true);
      }
    }
  });

  it('no longer ships the old safe-zone sign props', () => {
    expect(layout.props.filter((p) => p.type.startsWith('sign_'))).toEqual([]);
  });
});

describe('European Town collision', () => {
  const world = buildWorld();

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
    for (const zn of zones) {
      const [x0, z0, x1, z1] = zn.rect;
      for (let x = x0 + step / 2; x < x1; x += step) {
        for (let z = z0 + step / 2; z < z1; z += step) {
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
    // both safe zones are reachable from each other
    const red = layout.spawns.find((s) => s.team === 'red')!;
    const nearRed = [...seen].map((k) => cells.get(k)!).some((c) => Math.hypot(c.x - red.pos[0], c.z - red.pos[2]) < 1);
    expect(nearRed).toBe(true);
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
