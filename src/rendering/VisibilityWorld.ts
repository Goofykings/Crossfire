import type { AbstractMesh } from '@babylonjs/core';
import type { Vec3 } from '../player/PlayerController';

const CELL = 4;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Static rendered triangles indexed once per map. Collisions remain server-owned
 * boxes; this separate acceleration data only answers visual occlusion queries.
 */
export class VisibilityWorld {
  private readonly cells = new Map<string, Int32Array>();
  private readonly stamps: Int32Array;
  private stamp = 0;
  queries = 0;
  triangleChecks = 0;

  constructor(private readonly triangles: Float32Array) {
    const count = triangles.length / 9;
    this.stamps = new Int32Array(count);
    const buckets = new Map<string, number[]>();
    for (let id = 0; id < count; id++) {
      const i = id * 9;
      const lo = [0, 1, 2].map((a) => Math.floor(Math.min(triangles[i + a], triangles[i + 3 + a], triangles[i + 6 + a]) / CELL));
      const hi = [0, 1, 2].map((a) => Math.floor(Math.max(triangles[i + a], triangles[i + 3 + a], triangles[i + 6 + a]) / CELL));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const k = key(x, y, z), bucket = buckets.get(k);
        if (bucket) bucket.push(id); else buckets.set(k, [id]);
      }
    }
    for (const [k, bucket] of buckets) this.cells.set(k, Int32Array.from(bucket));
  }

  static fromMeshes(all: readonly AbstractMesh[]): VisibilityWorld {
    const meshes = all.filter((m) => m.metadata?.canonical && m.isEnabled() && m.isVisible && (m.material?.alpha ?? 1) >= .99);
    const total = meshes.reduce((n, m) => n + (m.getIndices()?.length ?? 0) * 3, 0);
    const triangles = new Float32Array(total);
    let out = 0;
    for (const mesh of meshes) {
      const p = mesh.getVerticesData('position'), indices = mesh.getIndices();
      if (!p || !indices) continue;
      const world = mesh.computeWorldMatrix(true), m = world.asArray(), identity = world.isIdentity();
      for (const index of indices) {
        const x = p[index * 3], y = p[index * 3 + 1], z = p[index * 3 + 2];
        triangles[out++] = identity ? x : x * m[0] + y * m[4] + z * m[8] + m[12];
        triangles[out++] = identity ? y : x * m[1] + y * m[5] + z * m[9] + m[13];
        triangles[out++] = identity ? z : x * m[2] + y * m[6] + z * m[10] + m[14];
      }
    }
    return new VisibilityWorld(out === total ? triangles : triangles.slice(0, out));
  }

  /** Unit direction and finite ray: geometry beyond a body cannot hide that body. */
  occluded(origin: Vec3, dir: Vec3, length: number): boolean {
    if (!(length > 0)) return false;
    this.queries++;
    if (++this.stamp >= 0x7ffffffe) { this.stamps.fill(0); this.stamp = 1; }
    const cell = [Math.floor(origin.x / CELL), Math.floor(origin.y / CELL), Math.floor(origin.z / CELL)];
    const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
    const step = d.map((v) => Math.sign(v));
    const delta = d.map((v) => v === 0 ? Infinity : CELL / Math.abs(v));
    const next = d.map((v, a) => v === 0 ? Infinity : ((cell[a] + (v > 0 ? 1 : 0)) * CELL - o[a]) / v);
    let distance = 0;
    while (distance <= length) {
      const bucket = this.cells.get(key(cell[0], cell[1], cell[2]));
      if (bucket) for (const id of bucket) {
        if (this.stamps[id] === this.stamp) continue;
        this.stamps[id] = this.stamp; this.triangleChecks++;
        if (this.intersects(id * 9, origin, dir, length)) return true;
      }
      const axis = next[0] < next[1] ? next[0] < next[2] ? 0 : 2 : next[1] < next[2] ? 1 : 2;
      distance = next[axis];
      if (!Number.isFinite(distance)) break;
      cell[axis] += step[axis]; next[axis] += delta[axis];
    }
    return false;
  }

  private intersects(i: number, o: Vec3, d: Vec3, length: number): boolean {
    const t = this.triangles, ax = t[i], ay = t[i + 1], az = t[i + 2];
    const ex = t[i + 3] - ax, ey = t[i + 4] - ay, ez = t[i + 5] - az;
    const fx = t[i + 6] - ax, fy = t[i + 7] - ay, fz = t[i + 8] - az;
    const px = d.y * fz - d.z * fy, py = d.z * fx - d.x * fz, pz = d.x * fy - d.y * fx;
    const det = ex * px + ey * py + ez * pz;
    if (Math.abs(det) < 1e-9) return false;
    const inv = 1 / det, tx = o.x - ax, ty = o.y - ay, tz = o.z - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return false;
    const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) return false;
    const distance = (fx * qx + fy * qy + fz * qz) * inv;
    return distance > .001 && distance <= length;
  }

  inspect() { return { triangles: this.triangles.length / 9, cells: this.cells.size, queries: this.queries, triangleChecks: this.triangleChecks }; }
}
