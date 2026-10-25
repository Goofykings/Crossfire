/**
 * Static + dynamic collision world made of oriented boxes (rotation about +Y only).
 *
 * Deliberately independent of Babylon.js so the same code runs in the browser, in Node unit tests,
 * and later on an authoritative multiplayer server. Coordinates are game space: x east, y up,
 * z south (right-handed, matching glTF).
 *
 * Box yaw follows the standard right-handed rotation about +Y:
 *   world.x =  local.x * cos(yaw) + local.z * sin(yaw)
 *   world.z = -local.x * sin(yaw) + local.z * cos(yaw)
 */

export interface BoxDesc {
  c: [number, number, number];
  h: [number, number, number];
  yaw?: number;
  tag?: string;
}

export interface Collider {
  readonly id: number;
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  cos: number;
  sin: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  tag: string;
  /** Blocks player movement. */
  solid: boolean;
  /** Can be hit by hitscan rays. */
  shootable: boolean;
  userData?: unknown;
  /** @internal query de-duplication stamp */
  stamp: number;
  /** @internal grid cells the collider is registered in */
  cells: number[];
}

export interface RayHit {
  collider: Collider;
  distance: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

export interface CylinderContact {
  nx: number;
  nz: number;
  depth: number;
  collider: Collider;
}

const CELL = 4;
const GRID_OFFSET = 4096;

function cellKey(ix: number, iz: number): number {
  return (ix + GRID_OFFSET) * 8192 + (iz + GRID_OFFSET);
}

export class CollisionWorld {
  private readonly colliders = new Map<number, Collider>();
  private readonly grid = new Map<number, Collider[]>();
  private nextId = 1;
  private stampCounter = 1;
  private readonly scratch: Collider[] = [];

  get size(): number {
    return this.colliders.size;
  }

  all(): IterableIterator<Collider> {
    return this.colliders.values();
  }

  add(desc: BoxDesc, opts: { solid?: boolean; shootable?: boolean; userData?: unknown } = {}): Collider {
    const yaw = desc.yaw ?? 0;
    const col: Collider = {
      id: this.nextId++,
      cx: desc.c[0],
      cy: desc.c[1],
      cz: desc.c[2],
      hx: desc.h[0],
      hy: desc.h[1],
      hz: desc.h[2],
      yaw,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 0,
      maxY: 0,
      maxZ: 0,
      tag: desc.tag ?? '',
      solid: opts.solid ?? true,
      shootable: opts.shootable ?? true,
      userData: opts.userData,
      stamp: 0,
      cells: [],
    };
    this.updateBounds(col);
    this.colliders.set(col.id, col);
    this.insert(col);
    return col;
  }

  addMany(descs: BoxDesc[], opts?: { solid?: boolean; shootable?: boolean }): Collider[] {
    return descs.map((d) => this.add(d, opts));
  }

  remove(col: Collider): void {
    if (!this.colliders.delete(col.id)) return;
    this.unlink(col);
  }

  clear(): void {
    this.colliders.clear();
    this.grid.clear();
  }

  /** Move/rotate a dynamic collider (e.g. a practice target that tips over). */
  setTransform(col: Collider, cx: number, cy: number, cz: number, yaw = col.yaw): void {
    this.unlink(col);
    col.cx = cx;
    col.cy = cy;
    col.cz = cz;
    col.yaw = yaw;
    col.cos = Math.cos(yaw);
    col.sin = Math.sin(yaw);
    this.updateBounds(col);
    this.insert(col);
  }

  private updateBounds(c: Collider): void {
    const ac = Math.abs(c.cos);
    const as = Math.abs(c.sin);
    const ex = ac * c.hx + as * c.hz;
    const ez = as * c.hx + ac * c.hz;
    c.minX = c.cx - ex;
    c.maxX = c.cx + ex;
    c.minZ = c.cz - ez;
    c.maxZ = c.cz + ez;
    c.minY = c.cy - c.hy;
    c.maxY = c.cy + c.hy;
  }

  private insert(c: Collider): void {
    const x0 = Math.floor(c.minX / CELL);
    const x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL);
    const z1 = Math.floor(c.maxZ / CELL);
    c.cells.length = 0;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = cellKey(ix, iz);
        let list = this.grid.get(k);
        if (!list) {
          list = [];
          this.grid.set(k, list);
        }
        list.push(c);
        c.cells.push(k);
      }
    }
  }

  private unlink(c: Collider): void {
    for (const k of c.cells) {
      const list = this.grid.get(k);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
    }
    c.cells.length = 0;
  }

  /** Colliders whose world AABB overlaps the query box. The returned array is reused between calls. */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Collider[] {
    const out = this.scratch;
    out.length = 0;
    const stamp = ++this.stampCounter;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.grid.get(cellKey(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (c.maxX < minX || c.minX > maxX || c.maxY < minY || c.minY > maxY || c.maxZ < minZ || c.minZ > maxZ) {
            continue;
          }
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Push a vertical cylinder (feet-relative band [bottom, top]) out of solid colliders horizontally.
   * Returns the corrected x/z and the contacts that were resolved.
   */
  resolveCylinder(
    x: number,
    z: number,
    radius: number,
    bottom: number,
    top: number,
    contacts: CylinderContact[] = [],
    iterations = 4,
  ): { x: number; z: number; contacts: CylinderContact[] } {
    contacts.length = 0;
    for (let iter = 0; iter < iterations; iter++) {
      let moved = false;
      const cands = this.query(x - radius, bottom, z - radius, x + radius, top, z + radius);
      for (const c of cands) {
        if (!c.solid || c.maxY <= bottom || c.minY >= top) continue;
        const dx = x - c.cx;
        const dz = z - c.cz;
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
        const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
        let ox = lx - qx;
        let oz = lz - qz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= radius * radius) continue;
        let depth: number;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          ox /= d;
          oz /= d;
          depth = radius - d;
        } else {
          const ex = c.hx - Math.abs(lx);
          const ez = c.hz - Math.abs(lz);
          if (ex < ez) {
            ox = lx >= 0 ? 1 : -1;
            oz = 0;
            depth = ex + radius;
          } else {
            ox = 0;
            oz = lz >= 0 ? 1 : -1;
            depth = ez + radius;
          }
        }
        const nx = ox * c.cos + oz * c.sin;
        const nz = -ox * c.sin + oz * c.cos;
        x += nx * (depth + 1e-5);
        z += nz * (depth + 1e-5);
        contacts.push({ nx, nz, depth, collider: c });
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z, contacts };
  }

  /** True when a cylinder would overlap any solid collider. */
  overlapsCylinder(x: number, z: number, radius: number, bottom: number, top: number): boolean {
    const cands = this.query(x - radius, bottom, z - radius, x + radius, top, z + radius);
    for (const c of cands) {
      if (!c.solid || c.maxY <= bottom || c.minY >= top) continue;
      if (circleRectDistance2(x, z, c) < radius * radius) return true;
    }
    return false;
  }

  /**
   * Highest walkable top surface under a circle that is not above `maxY`.
   * Returns -Infinity when there is nothing underneath.
   */
  groundHeight(x: number, z: number, radius: number, maxY: number, minY = -50): number {
    let best = -Infinity;
    const cands = this.query(x - radius, minY, z - radius, x + radius, maxY + 0.001, z + radius);
    for (const c of cands) {
      if (!c.solid || c.maxY > maxY + 1e-4 || c.maxY <= best) continue;
      if (circleRectDistance2(x, z, c) <= radius * radius) best = c.maxY;
    }
    return best;
  }

  /** Lowest solid underside above `minY` overlapping the circle; +Infinity when open to the sky. */
  ceilingHeight(x: number, z: number, radius: number, minY: number, maxY = minY + 10): number {
    let best = Infinity;
    const cands = this.query(x - radius, minY, z - radius, x + radius, maxY, z + radius);
    for (const c of cands) {
      if (!c.solid || c.minY < minY - 1e-4 || c.minY >= best) continue;
      if (circleRectDistance2(x, z, c) < radius * radius) best = c.minY;
    }
    return best;
  }

  /**
   * Nearest ray hit against shootable colliders. `dir` must be normalised.
   * `filter` can reject colliders (e.g. the shooter's own collider).
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    filter?: (c: Collider) => boolean,
  ): RayHit | null {
    const ex = ox + dx * maxDist;
    const ey = oy + dy * maxDist;
    const ez = oz + dz * maxDist;
    const cands = this.query(
      Math.min(ox, ex),
      Math.min(oy, ey),
      Math.min(oz, ez),
      Math.max(ox, ex),
      Math.max(oy, ey),
      Math.max(oz, ez),
    );
    let best: RayHit | null = null;
    let bestT = maxDist;
    for (const c of cands) {
      if (!c.shootable || (filter && !filter(c))) continue;
      const rx = ox - c.cx;
      const rz = oz - c.cz;
      const lox = rx * c.cos - rz * c.sin;
      const loz = rx * c.sin + rz * c.cos;
      const loy = oy - c.cy;
      const ldx = dx * c.cos - dz * c.sin;
      const ldz = dx * c.sin + dz * c.cos;
      const ldy = dy;
      let tmin = 0;
      let tmax = bestT;
      let axis = -1;
      let sign = 0;
      // slab test on each local axis
      const o = [lox, loy, loz];
      const d = [ldx, ldy, ldz];
      const h = [c.hx, c.hy, c.hz];
      let miss = false;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-12) {
          if (o[i] < -h[i] || o[i] > h[i]) {
            miss = true;
            break;
          }
          continue;
        }
        const inv = 1 / d[i];
        let t1 = (-h[i] - o[i]) * inv;
        let t2 = (h[i] - o[i]) * inv;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = i;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) {
          miss = true;
          break;
        }
      }
      if (miss || axis < 0 || tmin >= bestT) continue; // axis < 0: ray starts inside the box
      bestT = tmin;
      let lnx = 0;
      let lny = 0;
      let lnz = 0;
      if (axis === 0) lnx = sign;
      else if (axis === 1) lny = sign;
      else lnz = sign;
      best = {
        collider: c,
        distance: tmin,
        point: { x: ox + dx * tmin, y: oy + dy * tmin, z: oz + dz * tmin },
        normal: { x: lnx * c.cos + lnz * c.sin, y: lny, z: -lnx * c.sin + lnz * c.cos },
      };
    }
    return best;
  }

  /** Is the point inside any solid collider? */
  pointInside(x: number, y: number, z: number): Collider | null {
    const cands = this.query(x, y, z, x, y, z);
    for (const c of cands) {
      if (!c.solid || y < c.minY || y > c.maxY) continue;
      const dx = x - c.cx;
      const dz = z - c.cz;
      const lx = dx * c.cos - dz * c.sin;
      const lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) return c;
    }
    return null;
  }
}

/** Squared distance from a point to the collider's footprint rectangle (0 when inside). */
export function circleRectDistance2(x: number, z: number, c: Collider): number {
  const dx = x - c.cx;
  const dz = z - c.cz;
  const lx = dx * c.cos - dz * c.sin;
  const lz = dx * c.sin + dz * c.cos;
  const ox = Math.max(Math.abs(lx) - c.hx, 0);
  const oz = Math.max(Math.abs(lz) - c.hz, 0);
  return ox * ox + oz * oz;
}
