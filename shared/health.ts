import { maxHealth, type ActivePowerup, type BurnState } from './powerups';

export const REGEN_DELAY_MS = 5000;
export const REGEN_STEP_MS = 100;
export interface RegeneratingHealth { alive: boolean; health: number; regenAt: number | null; powerup?: ActivePowerup | null; burn?: BurnState | null }

/** Server wall-clock cursor: eligibility time, then the last consumed 100ms step.
 * Persist it with health so repeated ticks/reconstruction cannot double-heal.
 * First HP is earned at damage time + 5000ms + 100ms. */
export function regenerate(state: RegeneratingHealth, now: number): number {
  const cap = maxHealth(state);
  if (state.burn && now < state.burn.expiresAt) return 0;
  if (!state.alive || state.health >= cap) { state.regenAt = null; return 0; }
  if (state.regenAt === null) return 0;
  const steps = Math.max(0, Math.floor((now - state.regenAt) / REGEN_STEP_MS));
  if (!steps) return 0;
  const before = state.health;
  state.health = Math.min(cap, before + steps);
  state.regenAt = state.health === cap ? null : state.regenAt + steps * REGEN_STEP_MS;
  return state.health - before;
}
