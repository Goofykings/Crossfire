import type { Building, MapLayout, PropCatalog, Rect, StairRun } from './types';

/**
 * Tactical (overhead) map data and the world <-> map projection.
 *
 * Everything here is derived from the same layout.json that drives the Blender geometry and the collision boxes, so the
 * overlay cannot drift from the world: building footprints (with chamfers), roofed passages and walk-through rooms (with
 * their real door gaps), free-standing walls minus their gates, raised terraces and stairs, large prop colliders and the
 * named landmarks. No Babylon and no DOM: tests/tactical.test.ts checks it against the real collision data.
 *
 * Coordinates are game metres (x east, z south). The map is drawn north-up: +x to the right, +z downwards, which is
 * exactly the canvas convention, so the projection is a uniform scale plus an offset (no rotation, no mirroring).
 */

export type Point2 = [number, number];

export interface TacticalGround {
  id: string;
  kind: string;
  rect: Rect;
  height: number;
}

export interface TacticalStairs {
  rect: Rect;
  /** Side of the raised area the stairs lead down from ('n' = the steps descend towards the north). */
  side: StairRun['side'];
  steps: number;
}

export interface TacticalMapData {
  map: string;
  /** World rectangle the overlay shows (play area plus a small margin). */
  bounds: Rect;
  playArea: Rect;
  /** Open walkable ground (streets, yards, plazas, courts, terraces, spawn yards). */
  ground: TacticalGround[];
  /** Walkable ground under a roof: passages through buildings, walk-through rooms, accessible interiors. */
  covered: { id: string; kind: string; poly: Point2[] }[];
  /** Building footprints. `backdrop` buildings stand outside the play area. */
  buildings: { id: string; poly: Point2[]; backdrop: boolean }[];
  /** Free-standing walls, pillars and fences that block movement (gates already cut out). */
  walls: { id: string; poly: Point2[] }[];
  /** Large obstacles on walkable ground (props with big colliders, containers...). */
  obstacles: { type: string; poly: Point2[] }[];
  /** Edges of raised ground that cannot be stepped onto (drawn as a ledge line; stairs cross it). */
  ledges: Rect[];
  stairs: TacticalStairs[];
  landmarks: { name: string; pos: Point2 }[];
}

export interface TacticalOptions {
  /** Layout zone / covered-area id -> landmark label. Without it, plazas and courts get generic labels. */
  landmarks?: Record<string, string>;
  /** Margin around the play area in metres. */
  margin?: number;
  /** Props whose collider footprint is at least this many m² are drawn as obstacles (smaller ones are clutter). */
  minObstacleArea?: number;
}

/** Height a player can step onto without jumping (MOVEMENT.stepHeight); taller ground edges are ledges. */
const STEP_HEIGHT = 0.42;
// Walk-through room geometry, as in blender/scripts/lib/building_spec.py (WALL_T, ROOM_DOOR_W). The tactical test
// compares the result with the collision boxes, which are generated from those numbers, so a drift would fail it.
const ROOM_WALL = 0.32;
const ROOM_DOOR_W = 1.6;
const DEG = Math.PI / 180;

const DEFAULT_LABELS: Record<string, string> = { plaza: 'Plaza', court: 'Court' };

export function rectPoly([x0, z0, x1, z1]: Rect): Point2[] {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

/** Building outline, including a chamfered corner (same order as building_spec.footprint_polygon). */
export function footprint(b: Building): Point2[] {
  const [x0, z0, x1, z1] = b.rect;
  const pts = rectPoly(b.rect);
  if (!b.chamfer) return pts;
  const c = b.chamfer.size;
  const cut: Record<string, [number, Point2, Point2]> = {
    nw: [0, [x0, z0 + c], [x0 + c, z0]],
    ne: [1, [x1 - c, z0], [x1, z0 + c]],
    se: [2, [x1, z1 - c], [x1 - c, z1]],
    sw: [3, [x0 + c, z1], [x0, z1 - c]],
  };
  const [i, a, bb] = cut[b.chamfer.corner];
  return [...pts.slice(0, i), a, bb, ...pts.slice(i + 1)];
}

/** A rectangle minus a list of holes, as rectangles (2D version of collision_gen.subtract). */
export function subtractRects(rect: Rect, holes: Rect[]): Rect[] {
  let parts: Rect[] = [rect];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const r of parts) {
      const [rx0, rz0, rx1, rz1] = r;
      const [hx0, hz0, hx1, hz1] = h;
      if (hx0 >= rx1 || hx1 <= rx0 || hz0 >= rz1 || hz1 <= rz0) {
        next.push(r);
        continue;
      }
      if (hx0 > rx0) next.push([rx0, rz0, hx0, rz1]);
      if (hx1 < rx1) next.push([hx1, rz0, rx1, rz1]);
      const cx0 = Math.max(rx0, hx0);
      const cx1 = Math.min(rx1, hx1);
      if (hz0 > rz0) next.push([cx0, rz0, cx1, hz0]);
      if (hz1 < rz1) next.push([cx0, hz1, cx1, rz1]);
    }
    parts = next.filter((r) => r[2] - r[0] > 1e-6 && r[3] - r[1] > 1e-6);
  }
  return parts;
}

/** Interior cavity and doorways of a walk-through room (building_spec.room_layout). */
export function roomOpenings(b: Building, room: Rect): Rect[] {
  const [bx0, bz0, bx1, bz1] = b.rect;
  let [cx0, cz0, cx1, cz1] = room;
  const [x0, z0, x1, z1] = room;
  const doors: Rect[] = [];
  const zc = (z0 + z1) / 2;
  const xc = (x0 + x1) / 2;
  const hw = ROOM_DOOR_W / 2;
  if (Math.abs(x0 - bx0) < 1e-6) {
    cx0 = x0 + ROOM_WALL;
    doors.push([x0, zc - hw, cx0, zc + hw]);
  }
  if (Math.abs(x1 - bx1) < 1e-6) {
    cx1 = x1 - ROOM_WALL;
    doors.push([cx1, zc - hw, x1, zc + hw]);
  }
  if (Math.abs(z0 - bz0) < 1e-6) {
    cz0 = z0 + ROOM_WALL;
    doors.push([xc - hw, z0, xc + hw, cz0]);
  }
  if (Math.abs(z1 - bz1) < 1e-6) {
    cz1 = z1 - ROOM_WALL;
    doors.push([xc - hw, cz1, xc + hw, z1]);
  }
  return [[cx0, cz0, cx1, cz1], ...doors];
}

/** Footprint of every stair step run of a raised area (collision_gen.stair_rects, merged per run). */
export function stairRects(rect: Rect, stairs: StairRun[]): TacticalStairs[] {
  const [x0, z0, x1, z1] = rect;
  return stairs.map((st) => {
    const depth = st.steps * st.run;
    const r: Rect =
      st.side === 'w'
        ? [x0, st.from, x0 + depth, st.to]
        : st.side === 'e'
          ? [x1 - depth, st.from, x1, st.to]
          : st.side === 'n'
            ? [st.from, z0, st.to, z0 + depth]
            : [st.from, z1 - depth, st.to, z1];
    return { rect: r, side: st.side, steps: st.steps };
  });
}

/** Oriented rectangle (centre, half extents, compass heading) as a polygon, using the layout's yaw convention. */
export function orientedRect(cx: number, cz: number, hw: number, hd: number, headingDeg: number): Point2[] {
  const yaw = -headingDeg * DEG;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corners: Point2[] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  // right-handed rotation about +Y: world.x = lx*cos + lz*sin, world.z = -lx*sin + lz*cos
  return corners.map(([lx, lz]) => [cx + lx * c + lz * s, cz - lx * s + lz * c] as Point2);
}

function center(r: Rect): Point2 {
  return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
}

export function deriveTacticalMap(layout: MapLayout, props: PropCatalog | null, opts: TacticalOptions = {}): TacticalMapData {
  const margin = opts.margin ?? 2;
  const minArea = opts.minObstacleArea ?? 1.0;
  const [px0, pz0, px1, pz1] = layout.playArea;
  const lim = layout.outerLimit;
  const bounds: Rect = [
    Math.max(-lim, px0 - margin),
    Math.max(-lim, pz0 - margin),
    Math.min(lim, px1 + margin),
    Math.min(lim, pz1 + margin),
  ];

  const inPlay = (r: Rect) => r[0] < px1 && r[2] > px0 && r[1] < pz1 && r[3] > pz0;
  const buildings = layout.buildings.map((b) => ({ id: b.id, poly: footprint(b), backdrop: b.type === 'backdrop' || !inPlay(b.rect) }));

  const covered: TacticalMapData['covered'] = [];
  for (const c of layout.ground.covered) {
    const owner = layout.buildings.find((b) => b.rooms?.some((r) => sameRect(r.rect, c.rect)));
    if (c.kind === 'room' && owner) {
      for (const r of roomOpenings(owner, c.rect)) covered.push({ id: c.id, kind: c.kind, poly: rectPoly(r) });
    } else {
      covered.push({ id: c.id, kind: c.kind, poly: rectPoly(c.rect) });
    }
  }

  const walls: TacticalMapData['walls'] = [];
  for (const w of layout.walls) {
    for (const r of subtractRects(w.rect, w.gates.map((g) => g.rect))) walls.push({ id: w.id, poly: rectPoly(r) });
  }

  const obstacles: TacticalMapData['obstacles'] = [];
  // Ground-level queries must respect the solid stair runs and support posts,
  // while leaving suspended floors' underpasses open. Exported with collision.
  for (const part of layout.navigation?.groundObstacles ?? []) {
    obstacles.push({ type: part.id, poly: rectPoly(part.rect) });
  }
  if (props) {
    for (const p of [...layout.props, ...layout.obstacles]) {
      const col = props.props[p.type]?.collider;
      if (!col || col[0] * col[2] < minArea || col[1] < 0.8) continue;
      obstacles.push({ type: p.type, poly: orientedRect(p.pos[0], p.pos[2], col[0] / 2, col[2] / 2, p.heading) });
    }
  }

  const ledges: Rect[] = [];
  const stairs: TacticalStairs[] = [];
  for (const z of layout.ground.zones) if (z.height > STEP_HEIGHT) ledges.push(z.rect);
  for (const t of layout.terraces) stairs.push(...stairRects(t.rect, t.stairs));

  const labels = opts.landmarks;
  const landmarks: TacticalMapData['landmarks'] = [];
  // a label box (about 4 x 1.6 m at map scale) that would sit on an obstacle, such as a plaza's well, moves north of it
  const covers = (x: number, z: number) =>
    obstacles.some((o) => o.poly.some(([ox, oz]) => Math.abs(ox - x) < 2.4 && Math.abs(oz - z) < 1.1));
  for (const area of [...layout.ground.zones, ...layout.ground.covered]) {
    const name = labels ? labels[area.id] : DEFAULT_LABELS[area.kind];
    if (!name) continue;
    const pos = center(area.rect);
    for (let k = 0; k < 3 && covers(pos[0], pos[1]); k++) pos[1] -= 1.1;
    landmarks.push({ name, pos });
  }

  return {
    map: layout.id,
    bounds,
    playArea: layout.playArea,
    ground: layout.ground.zones.map((z) => ({ id: z.id, kind: z.kind, rect: z.rect, height: z.height })),
    covered,
    buildings,
    walls,
    obstacles,
    ledges,
    stairs,
    landmarks,
  };
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
}

export function pointInPoly(x: number, z: number, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const polyBounds = new WeakMap<Point2[], Rect>();

/** Point-in-polygon with a cached bounding-box rejection (queries run over thousands of polygons). */
function inPoly(x: number, z: number, poly: Point2[]): boolean {
  let b = polyBounds.get(poly);
  if (!b) {
    b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [px, pz] of poly) {
      b[0] = Math.min(b[0], px);
      b[1] = Math.min(b[1], pz);
      b[2] = Math.max(b[2], px);
      b[3] = Math.max(b[3], pz);
    }
    polyBounds.set(poly, b);
  }
  return x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && pointInPoly(x, z, poly);
}

/** What the tactical map shows at a world point (used by tests and by anything that wants to query the map). */
export function classifyPoint(data: TacticalMapData, x: number, z: number): 'open' | 'covered' | 'blocked' | 'outside' {
  const inR = (r: Rect) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
  if (data.obstacles.some((o) => inPoly(x, z, o.poly))) return 'blocked';
  if (data.walls.some((w) => inPoly(x, z, w.poly))) return 'blocked';
  if (data.covered.some((c) => inPoly(x, z, c.poly))) return 'covered';
  if (data.buildings.some((b) => inPoly(x, z, b.poly))) return 'blocked';
  // like the collision world: ground everywhere unless something stands on it (e.g. a chamfered corner's cut-off)
  return inR(data.playArea) ? 'open' : 'outside';
}

/**
 * North-up projection from world metres to map pixels: uniform scale, centred, no rotation.
 * +x (east) -> right, +z (south) -> down, so north is up and nothing is mirrored.
 */
export class TacticalProjection {
  readonly bounds: Rect;
  readonly width: number;
  readonly height: number;
  /** Pixels per metre. */
  readonly scale: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(bounds: Rect, width: number, height: number, padding = 0) {
    this.bounds = bounds;
    this.width = width;
    this.height = height;
    const [x0, z0, x1, z1] = bounds;
    const w = x1 - x0;
    const d = z1 - z0;
    this.scale = Math.min((width - 2 * padding) / w, (height - 2 * padding) / d);
    this.ox = (width - w * this.scale) / 2 - x0 * this.scale;
    this.oy = (height - d * this.scale) / 2 - z0 * this.scale;
  }

  toMap(x: number, z: number): { x: number; y: number } {
    return { x: this.ox + x * this.scale, y: this.oy + z * this.scale };
  }

  toWorld(px: number, py: number): { x: number; z: number } {
    return { x: (px - this.ox) / this.scale, z: (py - this.oy) / this.scale };
  }
}

/**
 * Rotation of a map marker drawn pointing up, for a player yaw (right-handed about +Y, 0 = facing north, positive = turned
 * left). Forward in the world is (-sin yaw, -cos yaw) in (x, z); on the north-up map that is a clockwise turn of -yaw,
 * i.e. the compass heading in radians.
 */
export function markerRotation(yaw: number): number {
  return -yaw;
}
