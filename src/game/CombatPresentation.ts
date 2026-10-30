import type { Vec3 } from '../player/PlayerController';

export const COMBAT_EFFECT_SECONDS = .5;
/** Relative camera-space edge strengths; no world position/attacker tracking. */
export function damageHaze(incoming: Vec3, yaw: number, pitch = 0) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const right = -incoming.x * cy + incoming.z * sy;
  const forward = incoming.x * sy * cp - incoming.y * sp + incoming.z * cy * cp;
  const up = -incoming.x * sy * sp - incoming.y * cp - incoming.z * cy * sp;
  const front = Math.max(0, forward), rear = Math.max(0, -forward);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return { left: clamp(-right + .16 * front + .45 * rear), right: clamp(right + .16 * front + .45 * rear),
    top: clamp(.55 * front + .3 * rear + Math.max(0, up)), bottom: clamp(rear + Math.max(0, -up)) };
}
/** Incoming ray points from attacker to victim. Game yaw 0 faces -Z; positive
 * yaw turns left. Resolve the directly-behind ambiguity consistently to right. */
export function damageTurn(incoming: Vec3, yaw: number): -1 | 0 | 1 {
  if (Math.hypot(incoming.x, incoming.z) < .001) return 0;
  const heading = Math.atan2(incoming.x, incoming.z);
  const angle = Math.atan2(Math.sin(heading - yaw), Math.cos(heading - yaw));
  if (Math.abs(angle) < Math.PI / 9) return 0;
  if (Math.abs(Math.abs(angle) - Math.PI) < .005) return 1;
  return angle < 0 ? 1 : -1;
}
export function deathPose(elapsed: number, incoming: Vec3 | null) {
  const t = Math.max(0, Math.min(1, elapsed / COMBAT_EFFECT_SECONDS));
  const length = Math.hypot(incoming?.x ?? 0, incoming?.z ?? 0);
  const fall = length > .001 ? { x: incoming!.x / length, z: incoming!.z / length } : { x: 0, z: 1 };
  const tip = (1 - (1 - t) ** 2) * Math.PI * .47;
  return { fall, tip, lift: Math.sin(tip) * .1, opacity: 1 - t * t * (3 - 2 * t), done: t >= 1 };
}
