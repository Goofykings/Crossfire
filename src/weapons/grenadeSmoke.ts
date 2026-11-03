import { GRENADE_SMOKE_MS, GRENADE_SMOKE_DENSE_MS } from '../../shared/grenades';
/** Age comes from the authoritative explosion clock, including late joins. */
export function smokeEnvelope(ageMs: number): number {
  if (ageMs < 0 || ageMs >= GRENADE_SMOKE_MS) return 0;
  const expand = Math.min(1, ageMs / 300);
  const fade = Math.max(0, (ageMs - GRENADE_SMOKE_DENSE_MS) / (GRENADE_SMOKE_MS - GRENADE_SMOKE_DENSE_MS));
  return expand * (1 - fade * fade * (3 - 2 * fade));
}
export function smokeRadius(ageMs: number): number { return 2.8 + Math.min(1, Math.max(0, ageMs) / 1500) * 1.4; }
export function smokeInterior(distance: number, ageMs: number): number {
  const t = Math.max(0, Math.min(1, (smokeRadius(ageMs) - distance) / 1.4));
  return t * t * (3 - 2 * t) * smokeEnvelope(ageMs);
}

/** Length of a view ray inside a cloud, so labels/outlines cannot reveal bodies through it. */
export function smokeObscures(from: {x:number;y:number;z:number}, to: {x:number;y:number;z:number}, center: {x:number;y:number;z:number}, ageMs: number): boolean {
  const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z,length=Math.hypot(dx,dy,dz);
  if (length < .001) return false;
  const x=from.x-center.x,y=from.y-center.y-1,z=from.z-center.z;
  const projection=-(x*dx+y*dy+z*dz)/length;
  const perpendicular=x*x+y*y+z*z-projection*projection;
  const radius=smokeRadius(ageMs), disc=radius*radius-perpendicular;
  if(disc<=0) return false;
  const half=Math.sqrt(disc),near=Math.max(0,projection-half),far=Math.min(length,projection+half);
  return Math.max(0,far-near)*smokeEnvelope(ageMs)>1;
}
