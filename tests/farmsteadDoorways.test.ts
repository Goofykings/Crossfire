import { describe, expect, it } from 'vitest';
import { WORLDS } from '../server/src/world';
import { MOVEMENT } from '../src/config/constants';

/**
 * Farmstead doorway audit (2026-11): every door opening must lead into usable space. For each door of every wall,
 * on both sides, the body-width strip in front of the opening is free of solids above step height for 1.4 m, the
 * floor there is level with the opening's sill (no stairwell void, no stair mouth directly behind the door), and
 * the opening itself is as wide as authored (nothing narrows it).
 */
const { world, layout } = WORLDS.farmstead;
const farm = layout.farm!;
type Open = { a: [number, number]; top: number; sill?: number; kind: string };
type Wall = { t: 'wall'; rect: [number, number, number, number]; y: [number, number]; open: Open[] };
const doors: { id: string; label: string; alongX: boolean; line: number; lo: number; hi: number; y0: number }[] = [];
for (const s of farm.structures) {
  for (const e of s.elements) {
    if (e.t !== 'wall') continue;
    const w = e as unknown as Wall;
    const [x0, z0, x1, z1] = w.rect;
    const alongX = x1 - x0 >= z1 - z0;
    const line = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
    for (const o of w.open) {
      if (o.kind !== 'door') continue;
      doors.push({ id: s.id, label: `${s.id} ${alongX ? 'z' : 'x'}=${line.toFixed(2)} ${o.a[0]}..${o.a[1]} y${w.y[0]}`, alongX, line, lo: o.a[0], hi: o.a[1], y0: w.y[0] });
    }
  }
}

describe('farmstead doorways', () => {
  it('finds the authored doors', () => {
    expect(doors.length).toBeGreaterThan(40);
  });

  it('has clear, level floor in front of both sides of every door', () => {
    const structural: string[] = [], levels: string[] = [], blockedByProps: string[] = [];
    const R = MOVEMENT.radius;
    const hits = (x: number, z: number, y0: number) => world.query(x - R, y0 + MOVEMENT.stepHeight + 0.02, z - R, x + R, y0 + MOVEMENT.standHeight, z + R)
      .filter((c) => c.solid && Math.hypot(Math.max(c.minX - x, 0, x - c.maxX), Math.max(c.minZ - z, 0, z - c.maxZ)) < R);
    for (const d of doors) {
      const mid = (d.lo + d.hi) / 2;
      const half = Math.max(0, (d.hi - d.lo) / 2 - R - 0.05);
      for (const side of [-1, 1]) {
        const lanes = [-half, -half / 2, 0, half / 2, half].map((off) => ({ off, clear: true }));
        for (const dist of [0.45, 0.9, 1.4]) {
          for (const lane of lanes) {
            const along = mid + lane.off, across = d.line + side * dist;
            const [x, z] = d.alongX ? [along, across] : [across, along];
            const floor = world.groundHeight(x, z, R, d.y0 + 0.8, d.y0 - 6);
            if (floor < d.y0 - 0.12) { lane.clear = false; levels.push(`${d.label} side ${side} at ${dist} m off ${lane.off.toFixed(1)}: floor ${floor.toFixed(2)}`); }
            for (const c of hits(x, z, d.y0)) {
              lane.clear = false;
              // Structural pieces (walls, guards, stairs, posts) may never narrow an entry; furniture and crates may as long as a lane stays free.
              if (/^farm:[a-z_0-9]+:(wall|stairs?|slab|floor|deck|ceiling)/.test(c.tag)) structural.push(`${d.label} side ${side} at ${dist} m off ${lane.off.toFixed(1)}: ${c.tag}`);
            }
          }
        }
        if (!lanes.some((l) => l.clear)) blockedByProps.push(`${d.label} side ${side}: no clear lane`);
      }
    }
    expect({ structural: [...new Set(structural)], levels: [...new Set(levels)], blockedByProps }).toEqual({ structural: [], levels: [], blockedByProps: [] });
  });
});
