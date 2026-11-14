import type { ControllerState } from './PlayerController';

const scalars = ['grounded','crouch','slideRemaining','slideCooldown','slideHeld','slideYaw',
  'airTime','jumpBufferTimer','jumpedThisAirborne','lean'] as const;
/** Exact checkpoint equality; never a tolerance that could conceal an authority correction. */
export function sameControllerState(a: ControllerState, b: ControllerState, ignoreLook = false): boolean {
  return a.position.x===b.position.x&&a.position.y===b.position.y&&a.position.z===b.position.z
    &&a.velocity.x===b.velocity.x&&a.velocity.y===b.velocity.y&&a.velocity.z===b.velocity.z
    &&(ignoreLook||a.yaw===b.yaw&&a.pitch===b.pitch)&&!!a.lowClearance===!!b.lowClearance
    &&scalars.every(key=>a[key]===b[key]);
}
