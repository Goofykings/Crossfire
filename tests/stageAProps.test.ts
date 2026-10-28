import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_IDS } from '../shared/maps';
import { createMapWorld } from '../shared/world';
import type { CollisionFile, MapLayout, PropCatalog } from '../src/maps/types';

const catalog = JSON.parse(readFileSync('public/assets/models/shared/props/props.json', 'utf8')) as PropCatalog;

it('keeps the regenerated prop source winding and fabric sheets correct', () => {
  expect(execFileSync('python', ['-I', '-B', 'tools/check-stage-a-props.py'], { encoding: 'utf8' })).toContain('pass');
  const materials = JSON.parse(readFileSync('public/assets/materials.json', 'utf8'));
  for (const name of ['canvas_red', 'canvas_green']) expect(materials.materials[name].double_sided).toBe(true);
});

describe.each(MAP_IDS)('%s bench placement', (id) => {
  it('has supported feet and clearance from solids, stairs and other props', () => {
    const layout = JSON.parse(readFileSync(`src/maps/${id}/layout.json`, 'utf8')) as MapLayout;
    const collision = JSON.parse(readFileSync(`public/assets/models/${id}/collision.json`, 'utf8')) as CollisionFile;
    const benches = layout.props.filter((p) => p.type === 'bench' || p.type === 'bench_modern');
    for (const bench of benches) {
      const world = createMapWorld(collision, { ...layout, props: layout.props.filter((p) => p !== bench) }, catalog);
      const [x, y, z] = bench.pos;
      const yaw = -bench.heading * Math.PI / 180;
      const halfWidth = catalog.props[bench.type].size[0] / 2;
      // Includes the actual back slats, not just the smaller gameplay collider.
      const halfDepth = 0.26;
      const transform = (u: number, v: number) => ({ x: x + u * Math.cos(yaw) + v * Math.sin(yaw),
        z: z - u * Math.sin(yaw) + v * Math.cos(yaw) });
      for (const u of [-halfWidth + 0.1, halfWidth - 0.1]) for (const v of [-0.19, 0.19]) {
        const p = transform(u, v);
        expect(world.groundHeight(p.x, p.z, 0.015, y + 0.02), `unsupported ${bench.type} ${x},${z}`).toBeCloseTo(y, 3);
      }
      for (let u = -halfWidth - 0.15; u <= halfWidth + 0.15; u += 0.05) {
        for (let v = -halfDepth - 0.15; v <= halfDepth + 0.15; v += 0.05) {
          const p = transform(u, v);
          expect(world.overlapsCylinder(p.x, p.z, 0.025, y + 0.025, y + 0.85),
            `bench clearance ${x},${z} at ${p.x},${p.z}`).toBe(false);
        }
      }
    }
  });
});
