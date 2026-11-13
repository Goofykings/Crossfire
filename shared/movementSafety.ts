import type { MapLayout } from '../src/maps/types';
import type { Vec3 } from '../src/player/PlayerController';

/** Secondary recovery only, beyond the existing thick perimeter / continuous ground.
 * Not a collision clamp: legal ledges, rooftops, stairs and airborne motion are untouched.
 */
export function unsafeMovement(position: Vec3, layout: MapLayout): string | null {
  const { x, y, z } = position;
  if (![x, y, z].every(Number.isFinite)) return 'non_finite';
  // The stone wall contains every reachable route (decks, balconies, roofs); nothing stands on top of it any more.
  // Keep authoritative recovery at that boundary for an already invalid position;
  // no invisible tall collider or different client-only clamp is added.
  const perimeter=layout.farm?.perimeter?.inner;
  if(perimeter&&(x<perimeter[0]||z<perimeter[1]||x>perimeter[2]||z>perimeter[3]))return 'outside_perimeter';
  const [minX, minZ, maxX, maxZ] = layout.playArea;
  if (x < minX - 1 || x > maxX + 1 || z < minZ - 1 || z > maxZ + 1) return 'outside_perimeter';
  // Underground passages are legal ground below the street.
  const lowest = Math.min(layout.ground.baseHeight, ...layout.ground.zones.map(zone => zone.height),
    ...(layout.underground ?? []).map(passage => passage.floor));
  return y < lowest - 1 ? 'below_ground' : null;
}
