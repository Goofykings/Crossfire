import type { CollisionWorld } from '../src/physics/CollisionWorld';
import type { Vec3 } from '../src/player/PlayerController';
import { MOVEMENT } from '../src/config/constants';

/** Fixed, server-owned lean envelope; positive is the player's right. */
export const LEAN_OFFSET = .28;
export const LEAN_ANGLE = 14 * Math.PI / 180;
export const LEAN_RATE = 20; // exponential response: ~95% in 150 ms
export const LEAN_RADIUS = .20;

export function leanOffset(yaw: number, amount: number): { x: number; z: number } {
  const offset = Math.max(-1, Math.min(1, amount)) * LEAN_OFFSET;
  return { x: Math.cos(yaw) * offset, z: -Math.sin(yaw) * offset };
}

/** Sweep the upper body from the authoritative center; small increments also catch thin walls. */
export function safeLean(world: CollisionWorld, position: Vec3, yaw: number, eyeHeight: number, desired: number): number {
  const amount = Math.max(-1, Math.min(1, desired));
  const displacement = leanOffset(yaw, amount);
  const steps = Math.max(1, Math.ceil(Math.abs(amount * LEAN_OFFSET) / .02));
  let clear = 0;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const x = position.x + displacement.x * k, z = position.z + displacement.z * k;
    const height = eyeHeight + .16;
    if (world.overlapsCylinder(x, z, LEAN_RADIUS, position.y + Math.max(.45, eyeHeight - .65), position.y + eyeHeight + .16)
      || world.overlapsCylinder(position.x + displacement.x * k * .5, position.z + displacement.z * k * .5,
        MOVEMENT.radius, position.y + height * .5, position.y + height - .4)) break;
    clear = k;
  }
  return amount * clear;
}
