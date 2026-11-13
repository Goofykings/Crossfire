import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { WORLDS } from '../server/src/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';

/**
 * Farmstead round hay bales (2026-11-13): prop `hay_bale_round`, 1.5 m long and 1.12 m across, lying on their side and stacked in pyramids
 * (three on the ground, two in the notches, one on top; or two and one). The collision is a stack of slabs that follows the circle, so the
 * real shared controller walks and jumps over a rounded shape. A jump rises 1.09 m: a bale's crown (1.08 m) can be reached from the ground and
 * every row above from the row below.
 */
vi.setConfig({ testTimeout: 180_000 });
const { world, layout } = WORLDS.farmstead;
type Entry = { size: number[]; collider: number[]; colliders?: number[][] };
const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')).props as Record<string, Entry>;
const bales = layout.props.filter((p) => p.type === 'hay_bale_round');
const JUMP_RISE = (MOVEMENT.jumpSpeed * MOVEMENT.jumpSpeed) / (2 * MOVEMENT.gravity);
const ROW_DY = ((2 * 0.56 - 0.02) * Math.sqrt(3)) / 2;
const CROWN = catalog.hay_bale_round.collider[1];

// stacks = bales that touch each other horizontally (centres closer than 1.3 m, or one on top of another)
const parent = bales.map((_, i) => i);
const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
bales.forEach((a, i) => bales.forEach((b, j) => { if (j > i && Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) < 1.3) parent[find(i)] = find(j); }));
const groups = new Map<number, typeof bales>();
bales.forEach((b, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), b]));
const stacks = [...groups.values()].map((g) => ({ bales: g, rows: [0, 1, 2].map((r) => g.filter((b) => Math.abs(b.pos[1] - r * ROW_DY) < 0.05)) }));

/** The highest level the player stood on (grounded) while moving along `dir` from `start` for `seconds`, jumping once when `gap` metres from
 * `target` (never when gap < 0). The player faces ALONG the bale axis and strafes toward the stack, so the rifle barrel (the shared
 * controller sweeps it ahead of the body) points past the stack instead of into the bales above: that is how a player climbs a pyramid. */
function run(start: { x: number; y: number; z: number }, dir: [number, number], target: [number, number], gap: number, seconds: number): number {
  const p = new PlayerController(world);
  p.weaponClearance = 'rifle';
  p.teleport(start, (Math.atan2(dir[1], dir[0]) * 180) / Math.PI);       // the right-hand vector (cos yaw, -sin yaw) is then `dir`
  let jumped = false, stood = 0;
  for (let t = 0; t < Math.ceil(seconds / FIXED_DT); t++) {
    const near = gap >= 0 && Math.hypot(p.position.x - target[0], p.position.z - target[1]) < gap;
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, x: 1, jumpPressed: near && !jumped && p.grounded });
    if (near && p.grounded) jumped = true;
    if (p.grounded) stood = Math.max(stood, p.position.y);
  }
  return stood;
}
const best = (start: { x: number; y: number; z: number }, dir: [number, number], target: [number, number], seconds: number, gaps = [-1, 0.9, 1.2, 1.5, 1.8, 2.1]): number =>
  Math.max(...gaps.map((g) => run(start, dir, target, g, seconds)));

/** Unit vector across the stack (the direction its rows spread) */
const across = (heading: number): [number, number] => { const yaw = (-heading * Math.PI) / 180; return [Math.sin(yaw), Math.cos(yaw)]; };

describe('round hay bale prop', () => {
  it('is large, round-shaped in section and small enough to jump onto', () => {
    const e = catalog.hay_bale_round;
    expect(e.size[1]).toBeGreaterThanOrEqual(1.0);                    // about 1.1 m across, taller than the old 0.9 m box
    expect(e.size[1]).toBeLessThan(JUMP_RISE);                        // the crown can be reached from the ground
    expect(e.size[0]).toBeGreaterThan(1.3);
    const slabs = e.colliders!;
    expect(slabs.length).toBeGreaterThanOrEqual(6);
    const widths = slabs.map((s) => s[5]);
    const widest = Math.max(...widths);
    // widths follow a circle: narrow at the foot and crown, widest near the middle, never a box
    expect(Math.min(...widths) / widest).toBeLessThan(0.62);
    const mid = widths.indexOf(widest);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(slabs.length - 1);
    for (let i = 1; i <= mid; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] - 1e-6);
    for (let i = mid + 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 1e-6);
    // the slabs tile the height with no gaps and stay inside the bounding box that the layout tools use
    for (let i = 1; i < slabs.length; i++) expect(slabs[i][1] - slabs[i][4] / 2).toBeCloseTo(slabs[i - 1][1] + slabs[i - 1][4] / 2, 3);
    expect(slabs[0][1] - slabs[0][4] / 2).toBeCloseTo(0, 3);
    expect(Math.max(...slabs.map((s) => s[1] + s[4] / 2))).toBeLessThanOrEqual(e.collider[1] + 1e-3);
    expect(widest).toBeLessThanOrEqual(e.collider[2] + 1e-3);
  });
  it('becomes one collider per slab in the authoritative world, and the old box bale is gone', () => {
    const b = bales[0];
    const tag = 'prop:hay_bale_round';
    const own = [...world.all()].filter((c) => c.tag === tag && c.cy - c.hy > b.pos[1] - 0.01 && c.cy + c.hy < b.pos[1] + 1.09 && Math.hypot(c.cx - b.pos[0], c.cz - b.pos[2]) < 0.01);
    expect(own.length).toBe(catalog.hay_bale_round.colliders!.length);
    expect(layout.props.some((p) => p.type === ('hay_bale_big' as string))).toBe(false);
  });
  it('is placed as a few touching pyramids, not wall to wall', () => {
    expect(stacks.length).toBeGreaterThanOrEqual(4);
    expect(stacks.length).toBeLessThanOrEqual(9);
    expect(stacks.some((s) => s.bales.length === 6)).toBe(true);        // three, two, one
    expect(stacks.some((s) => s.bales.length === 3)).toBe(true);        // two and one
    for (const s of stacks) {
      const counts = s.rows.map((r) => r.length).filter((n) => n > 0);
      expect([[3, 2, 1], [2, 1]].some((x) => JSON.stringify(x) === JSON.stringify(counts)), `rows ${counts}`).toBe(true);
      expect(s.rows.flat().length).toBe(s.bales.length);
      // every bale above rests in the notch between two below: centre distance equals a bale's diameter (they touch, nothing floats or sinks)
      for (let r = 1; r < 3; r++) for (const u of s.rows[r]) {
        const below = s.rows[r - 1].map((g) => Math.hypot(g.pos[0] - u.pos[0], g.pos[2] - u.pos[2])).sort((a, b) => a - b);
        expect(below.length).toBeGreaterThanOrEqual(2);
        for (const d of below.slice(0, 2)) expect(Math.hypot(d, ROW_DY)).toBeCloseTo(1.1, 1);
      }
    }
  });
  it('keeps doorways and the stairs of every building clear, and stays well inside the wall', () => {
    for (const s of layout.farm!.structures) {
      const [x0, z0, x1, z1] = s.rect;
      for (const b of bales) {
        const dx = Math.max(x0 - b.pos[0], 0, b.pos[0] - x1), dz = Math.max(z0 - b.pos[2], 0, b.pos[2] - z1);
        expect(Math.hypot(dx, dz), `bale at ${b.pos} next to ${s.id}`).toBeGreaterThan(1.6);
      }
    }
    // the tall three-row pyramids (crown 3 m) stay 8 m or more from the stone so nobody can reach its 4.1 m top from them
    for (const s of stacks.filter((q) => q.bales.length === 6)) for (const b of s.bales) {
      const inner = Math.min(b.pos[0] + 37, 37 - b.pos[0], b.pos[2] + 47, 45 - b.pos[2]);
      expect(inner).toBeGreaterThan(8);
    }
  });
});

describe('round hay bales can be climbed with the real controller', () => {
  it('lets a running jump from the ground land on the crown of every stack', () => {
    let tried = 0;
    for (const s of stacks) {
      const rows = s.rows[0];
      const a = across(rows[0].heading);
      // run along the row direction from beyond either end, toward the end bale
      const ends = [...rows].sort((p, q) => (p.pos[0] - q.pos[0]) * a[0] + (p.pos[2] - q.pos[2]) * a[1]);
      const results: number[] = [];
      for (const [bale, sign] of [[ends[0], 1], [ends[ends.length - 1], -1]] as const) {
        const d: [number, number] = [a[0] * sign, a[1] * sign];
        const start = { x: bale.pos[0] - d[0] * 3.5, y: 0, z: bale.pos[2] - d[1] * 3.5 };
        if (world.overlapsCylinder(start.x, start.z, MOVEMENT.radius, 0.45, MOVEMENT.standHeight)) continue;
        results.push(best(start, d, [bale.pos[0], bale.pos[2]], 2.0));
      }
      expect(Math.max(...results, 0), `stack at ${rows[0].pos}: best standing level`).toBeGreaterThan(CROWN - 0.1);
      tried++;
    }
    expect(tried).toBe(stacks.length);
  });

  it('lets the player climb row by row to the top of every pyramid', () => {
    let climbed = 0;
    for (const s of stacks) {
      for (let r = 1; r < 3; r++) {
        if (!s.rows[r].length) continue;
        const top = r * ROW_DY + CROWN;
        // from the crown of the lower bale on the same side, toward the upper bale
        const u = s.rows[r][0];
        const lower = [...s.rows[r - 1]].sort((p, q) => Math.hypot(p.pos[0] - u.pos[0], p.pos[2] - u.pos[2]) - Math.hypot(q.pos[0] - u.pos[0], q.pos[2] - u.pos[2]))[0];
        const dx = u.pos[0] - lower.pos[0], dz = u.pos[2] - lower.pos[2], len = Math.hypot(dx, dz);
        const d: [number, number] = [dx / len, dz / len];
        const startY = (r - 1) * ROW_DY + CROWN + 0.02;
        const level = best({ x: lower.pos[0] - d[0] * 0.15, y: startY, z: lower.pos[2] - d[1] * 0.15 }, d, [u.pos[0], u.pos[2]], 1.6, [-1, 0.3, 0.6, 0.9]);
        expect(level, `row ${r} of the stack at ${s.rows[0][0].pos}`).toBeGreaterThan(top - 0.12);
        climbed++;
      }
    }
    expect(climbed).toBe(stacks.reduce((n, s) => n + s.rows.slice(1).filter((r) => r.length).length, 0));
  });

  it('lets a player walk off the top of the tallest pyramid and reach the ground', () => {
    const s = stacks.find((q) => q.bales.length === 6)!;
    const u = s.rows[2][0];
    const p = new PlayerController(world);
    p.teleport({ x: u.pos[0], y: 2 * ROW_DY + CROWN + 0.02, z: u.pos[2] }, 0);
    const a = across(u.heading);
    for (let t = 0; t < 5 / FIXED_DT; t++) p.fixedUpdate(FIXED_DT, { ...NO_INTENT, x: a[0] > a[1] ? 1 : 0, z: 1 });
    expect(p.position.y, 'walking off ends on a lower level').toBeLessThan(1.5);
  });

  it('never gives a way over the stone: from the top of each pyramid, running at the wall with jumps stays inside', () => {
    for (const s of stacks.filter((q) => q.bales.length === 6)) {
      const u = s.rows[2][0];
      for (const ang of [0, 90, 180, 270]) {
        const p = new PlayerController(world);
        p.weaponClearance = 'rifle';
        p.teleport({ x: u.pos[0], y: 2 * ROW_DY + CROWN + 0.02, z: u.pos[2] }, ang);
        let maxY = 0;
        for (let t = 0; t < 8 / FIXED_DT; t++) {
          p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, jumpPressed: p.grounded });
          if (p.grounded) maxY = Math.max(maxY, p.position.y);
        }
        expect(p.position.x).toBeGreaterThan(-37);
        expect(p.position.x).toBeLessThan(37);
        expect(p.position.z).toBeGreaterThan(-47);
        expect(p.position.z).toBeLessThan(45);
        expect(maxY).toBeLessThan(3.2 + 0.01);                          // never stands above the tallest pyramid's own crown
      }
    }
  });
});

describe('round hay bales stand on open ground', () => {
  it('overlap no building, wall, hedge, tree or other prop, and no spawn', () => {
    const solids = [...world.all()].filter((c) => c.solid && !c.tag.includes('roof') && c.cy - c.hy < 0.85 && c.cy + c.hy > 0.1 && !c.tag.startsWith('prop:hay_bale_round'));
    for (const b of bales.filter((q) => q.pos[1] < 0.5)) {
      const r = (b.heading * Math.PI) / 180, hx = 0.75, hz = 0.567;
      const ex = Math.abs(Math.cos(r)) * hx + Math.abs(Math.sin(r)) * hz, ez = Math.abs(Math.sin(r)) * hx + Math.abs(Math.cos(r)) * hz;
      for (const c of solids) {
        const overlap = b.pos[0] - ex < c.cx + c.hx - 0.02 && b.pos[0] + ex > c.cx - c.hx + 0.02 && b.pos[2] - ez < c.cz + c.hz - 0.02 && b.pos[2] + ez > c.cz - c.hz + 0.02;
        expect(overlap, `bale at ${b.pos} overlaps ${c.tag}`).toBe(false);
      }
    }
    for (const sp of layout.spawns) for (const b of bales.filter((q) => q.pos[1] < 0.5)) expect(Math.hypot(sp.pos[0] - b.pos[0], sp.pos[2] - b.pos[2]), `spawn ${sp.id}`).toBeGreaterThan(1.8);
  });
});
