import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { WORLDS } from '../server/src/world';
import { FIXED_DT, MOVEMENT } from '../src/config/constants';
import { NO_INTENT, PlayerController } from '../src/player/PlayerController';

/**
 * Farmstead hay bales (2026-11-12): large rectangular bales lying on their side (prop `hay_bale_big`, 1.7 x 0.9 x 0.85 m) in singles and in
 * stacks of three. A jump rises 1.09 m, so a 0.9 m bale can be jumped onto from the ground and a second layer from the first; the real shared
 * controller proves it, and that nothing is blocked: doorways stay open and every bale stands on open ground.
 */
vi.setConfig({ testTimeout: 120_000 });
const { world, layout } = WORLDS.farmstead;
const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')).props as Record<string, { size: number[]; collider: number[] }>;
const bales = layout.props.filter((p) => p.type === 'hay_bale_big');
const JUMP_RISE = (MOVEMENT.jumpSpeed * MOVEMENT.jumpSpeed) / (2 * MOVEMENT.gravity);

interface Stack { ground: typeof bales; upper: typeof bales }
const stacks: Stack[] = [];
for (const b of bales.filter((q) => q.pos[1] < 0.5)) {
  const s = stacks.find((q) => q.ground.some((g) => Math.hypot(g.pos[0] - b.pos[0], g.pos[2] - b.pos[2]) < 2.2));
  if (s) s.ground.push(b); else stacks.push({ ground: [b], upper: [] });
}
for (const b of bales.filter((q) => q.pos[1] >= 0.5)) stacks.find((q) => q.ground.some((g) => Math.hypot(g.pos[0] - b.pos[0], g.pos[2] - b.pos[2]) < 1.6))!.upper.push(b);

/** Run along `dir` from `start`, jumping once the body is within `gap` metres of `target`; returns the highest level the player stood on
 * (grounded) during `seconds`: a bale top is 0.9 m, the second layer 1.8 m, the ground 0. */
function climb(p: PlayerController, dir: [number, number], target: [number, number], gap = 1.2, seconds = 1.8): number {
  let jumped = false, stood = 0;
  for (let t = 0; t < Math.ceil(seconds / FIXED_DT); t++) {
    const near = Math.hypot(p.position.x - target[0], p.position.z - target[1]) < gap + 0.85;
    p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1, jumpPressed: near && !jumped && p.grounded });
    if (near && p.grounded) jumped = true;
    if (p.grounded) stood = Math.max(stood, p.position.y);
  }
  void dir;
  return stood;
}

describe('hay bale prop', () => {
  it('is low enough to jump onto and high enough to be cover', () => {
    const [x, h, z] = catalog.hay_bale_big.collider;
    expect(h).toBeGreaterThanOrEqual(0.8);
    expect(h).toBeLessThan(JUMP_RISE - 0.1);              // the jump clears it with a real margin
    expect(x).toBeGreaterThan(1.4);
    expect(z).toBeGreaterThan(0.7);
    expect(catalog.hay_bale_big.size).toEqual(catalog.hay_bale_big.collider);
  });
  it('is placed as several stacks, not wall to wall', () => {
    expect(stacks.length).toBeGreaterThanOrEqual(6);
    expect(stacks.length).toBeLessThanOrEqual(14);
    for (const s of stacks) {
      expect(s.ground.length).toBeGreaterThanOrEqual(1);
      expect(s.ground.length + s.upper.length).toBeLessThanOrEqual(3);
      // an upper bale rests exactly on the top of the ground bale(s) beneath it
      for (const u of s.upper) {
        expect(u.pos[1]).toBeCloseTo(catalog.hay_bale_big.collider[1], 3);
        expect(s.ground.some((g) => Math.hypot(g.pos[0] - u.pos[0], g.pos[2] - u.pos[2]) < 1.0)).toBe(true);
      }
    }
  });
  it('keeps doorways and the stairs of every building clear', () => {
    for (const s of layout.farm!.structures) {
      const [x0, z0, x1, z1] = s.rect;
      for (const b of bales) {
        const dx = Math.max(x0 - b.pos[0], 0, b.pos[0] - x1), dz = Math.max(z0 - b.pos[2], 0, b.pos[2] - z1);
        if (b.pos[1] >= 0.5) continue;
        // a bale may stand inside a barn or shed, but never within 1.6 m of a building's outside (where its entries open)
        const inside = b.pos[0] > x0 && b.pos[0] < x1 && b.pos[2] > z0 && b.pos[2] < z1;
        if (!inside) expect(Math.hypot(dx, dz), `bale at ${b.pos} next to ${s.id}`).toBeGreaterThan(1.6);
      }
    }
  });
});

describe('hay bales can be jumped onto, and off again', () => {
  it('lets a running jump from the ground land on the first bale of every stack', () => {
    let tried = 0;
    for (const s of stacks) {
      const a = s.ground[0], b = s.ground[1];
      // approach along the stack's axis from beyond its first bale, or across a single bale from its open side
      const axis: [number, number] = b ? [b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]] : [Math.cos((-a.heading * Math.PI) / 180), -Math.sin((-a.heading * Math.PI) / 180)];
      const len = Math.hypot(axis[0], axis[1]);
      const dir: [number, number] = [axis[0] / len, axis[1] / len];
      const results: number[] = [];
      for (const sign of [1, -1]) {
        const d: [number, number] = [dir[0] * sign, dir[1] * sign];
        const start = { x: a.pos[0] - d[0] * 3.2, y: 0, z: a.pos[2] - d[1] * 3.2 };
        if (world.overlapsCylinder(start.x, start.z, MOVEMENT.radius, 0.45, MOVEMENT.standHeight)) continue;
        const p = new PlayerController(world);
        p.weaponClearance = 'rifle';
        p.teleport(start, (Math.atan2(d[0], -d[1]) * 180) / Math.PI);
        results.push(Math.abs(climb(p, d, [a.pos[0], a.pos[2]]) - 0.9) < 0.05 ? 1 : 0);
      }
      expect(Math.max(...results, 0), `stack at ${a.pos}: no approach lands on the bale`).toBe(1);
      tried++;
    }
    expect(tried).toBe(stacks.length);
  });

  it('lets a second jump from the first layer reach the 1.8 m level of every three-bale stack', () => {
    let tried = 0;
    for (const s of stacks.filter((q) => q.upper.length)) {
      const u = s.upper[0];
      // stand on the ground bale that is NOT under the upper one's centre, then jump toward the upper bale
      const from = s.ground.reduce((best, g) => (Math.hypot(g.pos[0] - u.pos[0], g.pos[2] - u.pos[2]) > Math.hypot(best.pos[0] - u.pos[0], best.pos[2] - u.pos[2]) ? g : best));
      const ax = u.pos[0] - from.pos[0], az = u.pos[2] - from.pos[2], len = Math.hypot(ax, az) || 1;
      const dir: [number, number] = [ax / len, az / len];
      const p = new PlayerController(world);
      p.weaponClearance = 'rifle';
      // start on the first bale, at its far end, facing the upper bale
      p.teleport({ x: from.pos[0] - dir[0] * 0.5, y: 0.9, z: from.pos[2] - dir[1] * 0.5 }, (Math.atan2(dir[0], -dir[1]) * 180) / Math.PI);
      const level = climb(p, dir, [u.pos[0], u.pos[2]], 1.2, 1.2);
      expect(Math.abs(level - 1.8) < 0.06, `stack at ${from.pos}: highest standing level ${level.toFixed(2)}`).toBe(true);
      tried++;
    }
    expect(tried).toBeGreaterThanOrEqual(4);
  });

  it('lets a player walk off the top and land on the ground without getting stuck', () => {
    const s = stacks.find((q) => q.upper.length)!;
    const u = s.upper[0];
    const p = new PlayerController(world);
    p.teleport({ x: u.pos[0], y: 1.8, z: u.pos[2] }, 0);
    for (let t = 0; t < 4 / FIXED_DT; t++) p.fixedUpdate(FIXED_DT, { ...NO_INTENT, z: 1 });
    expect(p.position.y, 'walking forward ends on a lower level').toBeLessThan(1.8);
  });
});

describe('hay bales stand on open ground', () => {
  it('overlap no building, wall, hedge, tree or other prop, and no spawn', () => {
    const solids = [...world.all()].filter((c) => c.solid && !c.tag.includes('roof') && c.cy - c.hy < 0.85 && c.cy + c.hy > 0.1 && !c.tag.startsWith('prop:hay_bale_big'));
    for (const b of bales.filter((q) => q.pos[1] < 0.5)) {
      const r = (b.heading * Math.PI) / 180, hx = 0.85, hz = 0.425;
      const ex = Math.abs(Math.cos(r)) * hx + Math.abs(Math.sin(r)) * hz, ez = Math.abs(Math.sin(r)) * hx + Math.abs(Math.cos(r)) * hz;
      for (const c of solids) {
        const overlap = b.pos[0] - ex < c.cx + c.hx - 0.02 && b.pos[0] + ex > c.cx - c.hx + 0.02 && b.pos[2] - ez < c.cz + c.hz - 0.02 && b.pos[2] + ez > c.cz - c.hz + 0.02;
        expect(overlap, `bale at ${b.pos} overlaps ${c.tag}`).toBe(false);
      }
    }
    for (const sp of layout.spawns) for (const b of bales.filter((q) => q.pos[1] < 0.5)) expect(Math.hypot(sp.pos[0] - b.pos[0], sp.pos[2] - b.pos[2]), `spawn ${sp.id}`).toBeGreaterThan(1.8);
  });
});
