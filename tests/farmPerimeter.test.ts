import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { unsafeMovement } from '../shared/movementSafety';
import { ZONE_MAPS, ZONE_SIZE } from '../shared/zoneControl';
import { WORLDS } from '../server/src/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import type { MapLayout } from '../src/maps/types';
import { NO_INTENT, PlayerController, type MoveIntent } from '../src/player/PlayerController';

/**
 * Farmstead perimeter wall (2026-11): the visible stone wall is the map boundary. Its collision is the very geometry that is drawn
 * (blender/scripts/lib/perimeter.py), closed at every seam, too tall and too sheer to climb or jump, with no invisible slab behind
 * it; bullets hit its stone faces. Hedges are eight different shapes; the strip hedges still close the margin outside the fence.
 */
vi.setConfig({ testTimeout: 120_000 });
const { world, layout } = WORLDS.farmstead;
const spec = layout.farm!.perimeter!;
const [X0, Z0, X1, Z1] = spec.inner;
const T = spec.thickness;
const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')).props as Record<string, { size: number[]; collider: number[] }>;
const wallColliders = () => [...world.all()].filter((c) => c.tag.startsWith('farm:perimeter:'));

describe('perimeter wall: layout and collision', () => {
  it('stands where the invisible boundary stood and is a thick, slightly low wall', () => {
    const [p0, q0, p1, q1] = layout.playArea;
    expect(spec.inner).toEqual([p0 - 0.5, q0 - 0.5, p1 + 0.5, q1 + 0.5]);
    expect(T).toBeGreaterThanOrEqual(0.8);
    expect(spec.corners).toHaveLength(4);
    expect(spec.piers.length).toBeGreaterThanOrEqual(24);
    // the shorter buildings' walls reach 3.4 m: the wall is at most that, and varies from section to section
    const tops = spec.sections.map((s) => s.top);
    expect(Math.max(...tops)).toBeLessThanOrEqual(3.45);
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(3.05);
    expect(new Set(tops).size).toBeGreaterThanOrEqual(4);
    for (const p of [...spec.piers, ...spec.corners]) expect(p.top).toBeGreaterThan(Math.max(...tops));
  });

  it('has no invisible boundary slabs: the wall boxes are the only boundary', () => {
    expect([...world.all()].filter((c) => c.tag === 'boundary')).toHaveLength(0);
    const colliders = wallColliders();
    expect(colliders.length).toBeGreaterThanOrEqual(spec.sections.length + spec.piers.length + 4);
    // every wall box has the exact footprint of its visible part
    for (const s of spec.sections) {
      const c = colliders.find((q) => q.tag === `farm:perimeter:${s.id}`)!;
      expect(c, s.id).toBeTruthy();
      const hx = (s.rect[2] - s.rect[0]) / 2, hz = (s.rect[3] - s.rect[1]) / 2;
      // sections overlap their piers by 2 cm
      expect(Math.abs(c.hx - hx) + Math.abs(c.hz - hz)).toBeLessThan(0.025);
      expect(c.cy + c.hy).toBeCloseTo(s.top, 3);
    }
  });

  it('is closed: no gap at any seam, corner or pier along the whole ring', () => {
    const probe = (x: number, z: number) => world.overlapsCylinder(x, z, 0.02, 0.6, 3.0);
    const pad = T + 0.4;
    for (let a = X0 - pad; a <= X1 + pad; a += 0.05) {
      expect(probe(a, Z0 - T / 2), `north wall at x ${a.toFixed(2)}`).toBe(true);
      expect(probe(a, Z1 + T / 2), `south wall at x ${a.toFixed(2)}`).toBe(true);
    }
    for (let a = Z0 - pad; a <= Z1 + pad; a += 0.05) {
      expect(probe(X0 - T / 2, a), `west wall at z ${a.toFixed(2)}`).toBe(true);
      expect(probe(X1 + T / 2, a), `east wall at z ${a.toFixed(2)}`).toBe(true);
    }
  });

  it('keeps props, spawns, targets and Zone Control squares clear of the wall', () => {
    for (const c of wallColliders()) {
      for (const p of layout.props) {
        const col = catalog[p.type]?.collider;
        if (!col || p.pos[1] < -0.5 || p.pos[1] > 0.5) continue;
        const r = (p.heading * Math.PI) / 180;
        const ex = Math.abs(Math.cos(r)) * col[0] / 2 + Math.abs(Math.sin(r)) * col[2] / 2, ez = Math.abs(Math.sin(r)) * col[0] / 2 + Math.abs(Math.cos(r)) * col[2] / 2;
        const overlap = p.pos[0] - ex < c.cx + c.hx && p.pos[0] + ex > c.cx - c.hx && p.pos[2] - ez < c.cz + c.hz && p.pos[2] + ez > c.cz - c.hz;
        expect(overlap, `${p.type} at ${p.pos} overlaps ${c.tag}`).toBe(false);
      }
    }
    const inside = (x: number, z: number, m: number) => x > X0 + m && x < X1 - m && z > Z0 + m && z < Z1 - m;
    for (const s of layout.spawns) expect(inside(s.pos[0], s.pos[2], 2.5), `spawn ${s.id}`).toBe(true);
    for (const t of layout.targets) expect(inside(t.pos[0], t.pos[2], 2.0), `target ${t.id}`).toBe(true);
    for (const z of ZONE_MAPS.farmstead) expect(inside(z.position[0] - ZONE_SIZE / 2, z.position[2] - ZONE_SIZE / 2, 1.0) && inside(z.position[0] + ZONE_SIZE / 2, z.position[2] + ZONE_SIZE / 2, 1.0), `zone ${z.id}`).toBe(true);
    // the footprints reach the tactical map and Practice navigation
    expect(layout.farm!.solids.filter((s) => s.id === 'perimeter').length).toBe(spec.sections.length + spec.piers.length + spec.corners.length);
    expect(layout.navigation!.groundObstacles.filter((o) => o.id.startsWith('perimeter:')).length).toBeGreaterThan(30);
  });
});

function run(start: { x: number; y: number; z: number }, heading: number, kind: 'walk' | 'jump' | 'slide', seconds = 5): PlayerController {
  const p = new PlayerController(world);
  p.weaponClearance = 'rifle';
  p.teleport(start, heading);
  const ticks = Math.ceil(seconds / FIXED_DT);
  for (let t = 0; t < ticks; t++) {
    const intent: MoveIntent = { ...NO_INTENT, z: 1, jumpPressed: kind === 'jump' && t % 30 === 0, slide: kind === 'slide' && t % 150 < 80, x: kind === 'walk' ? 0 : (t % 220 < 110 ? 0.35 : -0.35) };
    p.fixedUpdate(FIXED_DT, intent);
    // Roof routes must stop at visible physical geometry before safety recovery.
    if (p.position.x < X0 || p.position.x > X1 || p.position.z < Z0 || p.position.z > Z1) throw new Error(`escaped to ${p.position.x.toFixed(2)},${p.position.y.toFixed(2)},${p.position.z.toFixed(2)} at tick ${t} from ${start.x},${start.y},${start.z} (${kind})`);
    if (unsafeMovement(p.position, layout as MapLayout)) throw new Error(`unsafe movement ${unsafeMovement(p.position, layout as MapLayout)}`);
  }
  return p;
}

describe('perimeter wall: nobody gets over, through or around it', () => {
  const sides: { name: string; heading: number; starts: [number, number][] }[] = [];
  for (const [name, heading, fixed, axis, lo, hi] of [['north', 0, Z0 + 2.5, 'x', X0 + 2, X1 - 2], ['south', 180, Z1 - 2.5, 'x', X0 + 2, X1 - 2],
    ['west', 270, X0 + 2.5, 'z', Z0 + 2, Z1 - 2], ['east', 90, X1 - 2.5, 'z', Z0 + 2, Z1 - 2]] as const) {
    const starts: [number, number][] = [];
    for (let a = lo; a <= hi; a += 9.7) starts.push(axis === 'x' ? [a, fixed] : [fixed, a]);
    sides.push({ name, heading, starts });
  }
  for (const kind of ['walk', 'jump', 'slide'] as const) {
    it(`${kind}: running at every side of the wall from 2.5 m stops at the stone`, () => {
      let runs = 0;
      for (const s of sides) for (const [x, z] of s.starts) { run({ x, y: 0, z }, s.heading, kind); runs++; }
      expect(runs).toBeGreaterThan(30);
    });
  }
  it('corners: diagonal runs into all four corners stop at the stone', () => {
    for (const [x, z, h] of [[X0 + 4, Z0 + 4, 315], [X1 - 4, Z0 + 4, 45], [X1 - 4, Z1 - 4, 135], [X0 + 4, Z1 - 4, 225]] as const)
      for (const kind of ['walk', 'jump', 'slide'] as const) run({ x, y: 0, z }, h, kind);
  });
  it('elevated platforms and solid roofs stop physically at the stone or fence', () => {
    // Include reachable roofs, ridge caps, decks, balconies and railing tops.
    const tops = [...world.all()].filter((c) => c.solid && c.tag.startsWith('farm:') && !c.tag.startsWith('farm:perimeter') && !c.tag.includes('ceiling') && c.cy + c.hy >= 2.4 && c.cy + c.hy <= 11 && c.hy > 0.02);
    const near = tops.filter((c) => Math.min(c.cx - X0, X1 - c.cx, c.cz - Z0, Z1 - c.cz) < 16);
    expect(near.length).toBeGreaterThan(0);
    let tried = 0;
    for (const c of near) {
      const top = c.cy + c.hy;
      // the nearest wall decides the direction; start at the platform edge nearest to it
      const d = [[c.cx - X0, 270, -1, 0], [X1 - c.cx, 90, 1, 0], [c.cz - Z0, 0, 0, -1], [Z1 - c.cz, 180, 0, 1]].sort((a, b) => (a[0] as number) - (b[0] as number))[0];
      const x = c.cx + (d[2] as number) * Math.max(0, c.hx - 0.4), z = c.cz + (d[3] as number) * Math.max(0, c.hz - 0.4);
      if (world.groundHeight(x, z, 0.3, top + 0.6) < top - 0.05 || world.overlapsCylinder(x, z, MOVEMENT.radius, top + MOVEMENT.stepHeight + 0.01, top + MOVEMENT.standHeight)) continue;
      for (const kind of ['walk', 'jump', 'slide'] as const) run({ x, y: top, z }, d[1] as number, kind, 4);
      tried++;
    }
    expect(tried).toBeGreaterThan(0);
  });
});

describe('perimeter wall: bullets', () => {
  const allowed = [0, spec.plinth[1], 0.4, 0.8];   // wall face, plinth, pier, corner pier (distance into the yard of the faces players meet)
  it('hit the visible stone face at every height, along the whole wall, and never an invisible plane', () => {
    let hits = 0;
    for (const [dx, dz, fixed, axis, lo, hi] of [[0, -1, Z0 + 3, 'x', X0 + 3, X1 - 3], [0, 1, Z1 - 3, 'x', X0 + 3, X1 - 3], [-1, 0, X0 + 3, 'z', Z0 + 3, Z1 - 3], [1, 0, X1 - 3, 'z', Z0 + 3, Z1 - 3]] as const) {
      for (let a = lo; a <= hi; a += 3.3) for (const y of [0.3, 0.9, 1.7, 2.6, 3.0]) {
        const o = axis === 'x' ? { x: a, z: fixed } : { x: fixed, z: a };
        const hit = world.raycastBullet(o.x, y, o.z, dx, 0, dz, 10, (c) => c.tag.startsWith('farm:perimeter:'));   // trees and hedges in the strips are not the point here
        expect(hit, `ray from ${o.x},${y},${o.z}`).not.toBeNull();
        expect(hit!.collider.tag.startsWith('farm:perimeter:')).toBe(true);
        // distance of the hit point from the wall's inner face (positive into the yard)
        const e = dx !== 0 ? (dx < 0 ? hit!.point.x - X0 : X1 - hit!.point.x) : (dz < 0 ? hit!.point.z - Z0 : Z1 - hit!.point.z);
        expect(allowed.some((v) => Math.abs(e - v) < 0.01), `hit ${e.toFixed(3)} m from the face at ${o.x},${y},${o.z} (${hit!.collider.tag})`).toBe(true);
        expect(hit!.normal.x * dx + hit!.normal.z * dz).toBeLessThan(-0.9);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(200);
  });
  it('fly over the visible fence tops: no invisible ceiling', () => {
    for (const heading of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const r = (heading * Math.PI) / 180, pitch = (30 * Math.PI) / 180;
      const hit = world.raycastBullet(-2.7, 15, 36, Math.sin(r) * Math.cos(pitch), Math.sin(pitch), -Math.cos(r) * Math.cos(pitch), 400);
      expect(hit, `rising ray, heading ${heading}`).toBeNull();
    }
  });
  it('fence bars block players but bullets pass through their visible gaps', () => {
    const bars=[...world.all()].filter(c=>c.tag.startsWith('farm:perimeter-fence:')&&c.tag.includes(':bar:'));
    expect(spec.extensions?.length).toBeGreaterThan(0);
    expect(spec.extensions!.reduce((n,f)=>n+f.a[1]-f.a[0],0)).toBeLessThan((X1-X0+Z1-Z0)*2);
    for(const f of spec.extensions!){
      const prefix=`farm:perimeter-fence:${f.id}:`,parts=bars.filter(c=>c.tag.startsWith(prefix)),a=parts[1],b=parts[2],dx=f.side==='w'?1:f.side==='e'?-1:0,dz=f.side==='n'?1:f.side==='s'?-1:0,y=(f.base+f.top)/2;
      expect(Math.hypot(a.cx-b.cx,a.cz-b.cz)-.08).toBeLessThan(MOVEMENT.radius*2);
      const ray=(x:number,z:number)=>world.raycastBullet(x+dx,y,z+dz,-dx,0,-dz,2,c=>c.tag.startsWith(prefix));
      expect(ray(a.cx,a.cz)?.collider.tag).toContain(':bar:');
      expect(ray((a.cx+b.cx)/2,(a.cz+b.cz)/2)).toBeNull();
      expect(world.overlapsCylinder((a.cx+b.cx)/2,(a.cz+b.cz)/2,MOVEMENT.radius,y,y+MOVEMENT.standHeight)).toBe(true);
    }
  });
});

describe('hedgerows: eight shapes, no shortcuts', () => {
  const variants = Object.keys(catalog).filter((k) => k.startsWith('hedge_'));
  it('has eight hedge shapes with different dimensions, all used by the layout', () => {
    expect(variants).toHaveLength(8);
    expect(new Set(variants.map((k) => catalog[k].collider.join('x'))).size).toBe(8);
    const lengths = variants.map((k) => catalog[k].collider[0]), heights = variants.map((k) => catalog[k].collider[1]), thick = variants.map((k) => catalog[k].collider[2]);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1.0);       // tall and short sections
    expect(Math.max(...thick) / Math.min(...thick)).toBeGreaterThan(2);             // thin and wide
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(1.5);
    const used = new Set(layout.props.map((p) => p.type).filter((t) => t.startsWith('hedge_')));
    expect([...used].sort()).toEqual([...variants].sort());
    // still taller than a standing eye (1.64 m): every hedge blocks sight and a jump
    for (const k of variants) expect(catalog[k].collider[1]).toBeGreaterThanOrEqual(2.3);
  });
  it('the hedges in the four margin strips still close them between the fence and the wall', () => {
    // walk the strips' centre lines toward the next hedge from both sides: the player must stop at it, never pass
    const fence = layout.farm!.fences;
    const f = Object.fromEntries(fence.map((q) => [q.id, q]));
    const strips: { start: [number, number]; heading: number; limit: (p: PlayerController) => boolean }[] = [
      { start: [(X0 + f.west.a[0]) / 2, -15], heading: 0, limit: (p) => p.position.z > -30 + 1 },        // west strip, north from z -15 stops before the hedge at -30
      { start: [(X0 + f.west.a[0]) / 2, 15], heading: 180, limit: (p) => p.position.z < 30 - 1 },
      { start: [(X1 + f.east.a[0]) / 2, -10], heading: 0, limit: (p) => p.position.z > -24 + 1 },
      { start: [(X1 + f.east.a[0]) / 2, 15], heading: 180, limit: (p) => p.position.z < 30 - 1 },
      { start: [-5, (Z0 + f.north.a[1]) / 2], heading: 270, limit: (p) => p.position.x > -18 + 1 },
      { start: [-5, (Z1 + f.south.a[1]) / 2], heading: 270, limit: (p) => p.position.x > -18 + 1 },
    ];
    for (const s of strips) for (const kind of ['walk', 'jump', 'slide'] as const) {
      const p = run({ x: s.start[0], y: 0, z: s.start[1] }, s.heading, kind, 8);
      expect(s.limit(p), `strip from ${s.start} (${kind}) ended at ${p.position.x.toFixed(2)},${p.position.z.toFixed(2)}`).toBe(true);
    }
  });
});
