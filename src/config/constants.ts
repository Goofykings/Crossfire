/** Gameplay tuning constants. Distances in metres, times in seconds. */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Longest real frame the simulation will try to catch up on (avoids spiral of death). */
export const MAX_FRAME_DT = 0.25;

export interface MovementConfig {
  radius: number;
  standHeight: number;
  crouchHeight: number;
  standEye: number;
  crouchEye: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  aimSpeed: number;
  groundAccel: number;
  groundDecel: number;
  airAccel: number;
  gravity: number;
  jumpSpeed: number;
  stepHeight: number;
  snapDown: number;
  coyoteTime: number;
  jumpBuffer: number;
  crouchRate: number;
  maxSubstep: number;
  killY: number;
}

export const MOVEMENT: MovementConfig = {
  radius: 0.34,
  standHeight: 1.8,
  crouchHeight: 1.15,
  standEye: 1.64,
  crouchEye: 1.02,
  walkSpeed: 4.7,
  sprintSpeed: 7.1,
  crouchSpeed: 2.4,
  aimSpeed: 3.0,
  groundAccel: 42,
  groundDecel: 30,
  airAccel: 9,
  gravity: 20,
  jumpSpeed: 6.6,
  stepHeight: 0.42,
  snapDown: 0.45,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  crouchRate: 8,
  maxSubstep: 0.1,
  killY: -20,
};

export const PLAYER_MAX_HEALTH = 100;
