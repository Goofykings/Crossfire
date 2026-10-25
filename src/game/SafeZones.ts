import type { Rect, SafeZoneDef, Team } from '../maps/types';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned protection volume. Reusable for any map; data comes from the map layout. */
export class SafeZone {
  readonly id: string;
  readonly team: Team;
  readonly rect: Rect;
  readonly minY: number;
  readonly maxY: number;

  constructor(def: SafeZoneDef, baseY = -2) {
    this.id = def.id;
    this.team = def.team;
    this.rect = def.rect;
    this.minY = baseY;
    this.maxY = def.height;
  }

  /**
   * True when the point is inside the zone. `margin` grows the volume, so callers can treat a body
   * (not just its centre) as inside: a player whose capsule overlaps the zone counts as protected.
   */
  contains(p: Point3, margin = 0): boolean {
    const [x0, z0, x1, z1] = this.rect;
    return (
      p.x >= x0 - margin &&
      p.x <= x1 + margin &&
      p.z >= z0 - margin &&
      p.z <= z1 + margin &&
      p.y >= this.minY - margin &&
      p.y <= this.maxY + margin
    );
  }
}

export class SafeZoneSystem {
  readonly zones: SafeZone[];

  constructor(defs: SafeZoneDef[]) {
    this.zones = defs.map((d) => new SafeZone(d));
  }

  zoneAt(p: Point3, margin = 0): SafeZone | null {
    for (const z of this.zones) if (z.contains(p, margin)) return z;
    return null;
  }

  isProtected(p: Point3, margin = 0): boolean {
    return this.zoneAt(p, margin) !== null;
  }
}
