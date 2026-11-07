import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../shared/maps';
import { WORLDS } from '../server/src/world';

interface Poster { building: string; cell: number; framed: boolean; interior?: boolean; w: number; h: number; x: number; y: number; z: number; normal: [number, number] }

/** Decorative posters (blender/scripts/lib/building.py poster_pass / interior_posters, underground.py decor):
 * every one hangs on a real wall, in front of free air, never floating or in a doorway. */
describe.each(MAP_IDS)('%s posters', (id) => {
  const posters = (JSON.parse(readFileSync(`docs/map-posters/${id}.json`, 'utf8')) as { facade: Poster[] }).facade;
  const { world, layout } = WORLDS[id];

  it('has several, with varied designs', () => {
    const underground = (layout.underground ?? []).flatMap((p) => ((p as unknown as { decor?: { art?: string; cell?: number }[] }).decor ?? []).filter((d) => d.art === 'poster'));
    const total = posters.length + underground.length;
    expect(total, `${id} poster count`).toBeGreaterThanOrEqual(8);
    const cells = new Set([...posters.map((p) => p.cell), ...underground.map((d) => d.cell)]);
    expect(cells.size, `${id} distinct designs`).toBeGreaterThanOrEqual(6);
    // No design dominates a map.
    const counts = new Map<number, number>();
    for (const c of [...posters.map((p) => p.cell), ...underground.map((d) => d.cell!)]) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(Math.max(...counts.values()) / total, `${id} repetition`).toBeLessThan(.3);
  });

  it('hang on solid walls with free air in front, inside their buildings\' surfaces', () => {
    for (const p of posters) {
      const [nx, nz] = p.normal, cy = p.y + p.h / 2, label = `${p.building} cell ${p.cell} at ${p.x},${p.z}`;
      // The wall surface: solid 4 cm behind the sheet's centre and at both lower corners; free 5 cm in front.
      const across = [-p.w / 2 + .05, 0, p.w / 2 - .05];
      for (const t of across) {
        const px = p.x + -nz * t, pz = p.z + nx * t;
        expect(world.pointInside(px - nx * .04, cy, pz - nz * .04), `${label} floats (nothing behind it at ${t})`).not.toBeNull();
        expect(world.pointInside(px + nx * .05, cy, pz + nz * .05), `${label} is inside a solid`).toBeNull();
      }
      expect(world.pointInside(p.x - nx * .04, p.y + .03, p.z - nz * .04), `${label} lower edge off the wall`).not.toBeNull();
      expect(world.pointInside(p.x - nx * .04, p.y + p.h - .03, p.z - nz * .04), `${label} upper edge off the wall`).not.toBeNull();
      // Reading height and a sensible size.
      expect(p.y, label).toBeGreaterThan(.7); expect(p.y + p.h, label).toBeLessThan(4.4); expect(p.w).toBeLessThanOrEqual(.8);
      // Nothing in the 40 cm of air in front of a pasted sheet except the player's own space: no prop or stair in the way.
      expect(world.raycast(p.x + nx * .4, cy, p.z + nz * .4, -nx, 0, -nz, .36), `${label} blocked in front`).toBeNull();
    }
  });
});

describe('underground wall art', () => {
  it('sits on real wall, pier and block faces without overlap (tools/check_underground.py)', () => {
    const out = execFileSync('python', ['-I', '-B', 'tools/check_underground.py'], { encoding: 'utf8' });
    expect(out).not.toContain('PROBLEM');
    expect(out).toContain('metro_underpass');
    expect(out).toContain('cistern_passage');
  });
});
