import { expect, it } from 'vitest';
import { VisibilityWorld } from '../src/rendering/VisibilityWorld';

const wall = (x0: number, x1: number, z: number) => [x0, 0, z, x1, 0, z, x1, 3, z, x0, 0, z, x1, 3, z, x0, 3, z];
it('tests finite rays in either direction against actual triangles, including cell boundaries', () => {
  const v = new VisibilityWorld(Float32Array.from(wall(-2, 2, -4)));
  const o = { x: 0, y: 1.5, z: 0 }, d = { x: 0, y: 0, z: -1 };
  expect(v.occluded(o, d, 3.9)).toBe(false);
  expect(v.occluded(o, d, 4.1)).toBe(true);
  expect(v.occluded({ x: 0, y: 1.5, z: -8 }, { x: 0, y: 0, z: 1 }, 5)).toBe(true);
  expect(v.occluded({ x: 3, y: 1.5, z: 0 }, d, 10)).toBe(false);
  expect(v.occluded({ x: 0, y: 4, z: 0 }, d, 10)).toBe(false);
  expect(v.occluded(o, d, 0)).toBe(false);
});
it('preserves visible openings rather than treating a whole building as one occluder', () => {
  const v = new VisibilityWorld(Float32Array.from([...wall(-4, -1, -6), ...wall(1, 4, -6)]));
  expect(v.occluded({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 10)).toBe(false);
  expect(v.occluded({ x: 2, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 10)).toBe(true);
});
it('uses local spatial buckets instead of scanning unrelated map triangles every frame', () => {
  const triangles = wall(-2, 2, -4);
  for (let i = 0; i < 2000; i++) triangles.push(...wall(100 + i * 5, 102 + i * 5, -4));
  const v = new VisibilityWorld(Float32Array.from(triangles));
  expect(v.occluded({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 6)).toBe(true);
  expect(v.inspect().triangleChecks).toBeLessThan(5);
  expect(v.inspect().triangles).toBe(4002);
});
