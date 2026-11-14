import { FIXED_DT } from '../config/constants';

/** Up to 100 ms of 120 Hz work per dispatch. Normal 20 FPS needs six ticks.
 * Keep the remainder as debt; never replace elapsed physics with one large dt. */
export const MAX_SIMULATION_STEPS = 12;
export function elapsedSimulationTime(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}
/** A frame spanning loading/pause/respawn contains time before this life was controllable. */
export function activeSimulationTime(seconds:number,nowMs:number,activeSinceMs:number,visible=true):number {
  return visible?Math.min(elapsedSimulationTime(seconds),Math.max(0,(nowMs-activeSinceMs)/1000)):0;
}
export function simulationSteps(debt: number): number {
  return Math.min(MAX_SIMULATION_STEPS, Math.max(0, Math.floor((debt + 1e-10) / FIXED_DT)));
}
/** Remaining catch-up debt must not extrapolate the render capsule through walls. */
export function simulationAlpha(debt: number): number {
  return Math.max(0, Math.min(1, debt / FIXED_DT));
}
