import { PLAYER_MAX_HEALTH } from '../../src/config/constants';

export const REGEN_DELAY_MS = 5000;
export const REGEN_STEP_MS = 100;
export interface RegeneratingHealth { alive: boolean; health: number; regenAt: number | null }

/** Server wall-clock cursor: eligibility time, then the last consumed 100ms step.
 * Persist it with health so repeated ticks/reconstruction cannot double-heal.
 * First HP is earned at damage time + 5000ms + 100ms. */
export function regenerate(state: RegeneratingHealth, now: number): number {
  if (!state.alive || state.health >= PLAYER_MAX_HEALTH) { state.regenAt = null; return 0; }
  if (state.regenAt === null) return 0;
  const steps = Math.max(0, Math.floor((now - state.regenAt) / REGEN_STEP_MS));
  if (!steps) return 0;
  const before = state.health;
  state.health = Math.min(PLAYER_MAX_HEALTH, before + steps);
  state.regenAt = state.health === PLAYER_MAX_HEALTH ? null : state.regenAt + steps * REGEN_STEP_MS;
  return state.health - before;
}
