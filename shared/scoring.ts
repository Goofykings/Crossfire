import type { MatchMode, PlayerTeam } from './combat';
import type { MapId } from './maps';
import type { WeaponId } from '../src/weapons/Weapon';

export const COMBO_WINDOW_MS = 4000;
export interface ScoreState { score: number; comboCount: number; comboUntil: number | null }
export interface ScoreAward { base: number; headshot: number; combo: number; comboCount: number; total: number }
export interface RoundStanding { id: string; name: string; team: PlayerTeam; score: number; kills: number; deaths: number; assists?: number; weapon?: WeaponId | null }
export interface RoundResult {
  roundId: number; mapId: MapId; mode: MatchMode; endedAt: number;
  draw: boolean; winner: RoundStanding | null; winningTeam: PlayerTeam;
  mvp: RoundStanding | null; teamScores: { blue: number; red: number } | null;
  /** Optional only for results persisted before the complete-results update. */
  players?: RoundStanding[];
}
export interface RoundLedger {
  roundId: number; mapId: MapId; mode: MatchMode; endsAt: number;
  players: Record<string, RoundStanding>;
}
export function resetCombo(state: ScoreState): void { state.comboCount = 0; state.comboUntil = null; }
export function expireCombo(state: ScoreState, now: number): void {
  if (state.comboUntil !== null && now >= state.comboUntil) resetCombo(state);
}
/** Called only by the server's idempotent alive -> dead transition. */
export function awardElimination(state: ScoreState, now: number, head: boolean, windowMs = COMBO_WINDOW_MS): ScoreAward {
  expireCombo(state, now);
  state.comboCount++;
  state.comboUntil = now + windowMs;
  const award = { base: 100, headshot: head ? 50 : 0, combo: 20 * (state.comboCount - 1), comboCount: state.comboCount, total: 0 };
  award.total = award.base + award.headshot + award.combo;
  state.score += award.total;
  return award;
}
/** Points decide rank; immutable IDs break equal-score ties consistently. */
export const pointsOrder = (a: Pick<RoundStanding, 'id' | 'score'>, b: Pick<RoundStanding, 'id' | 'score'>): number =>
  b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function finalizeRound(ledger: RoundLedger, teamScores: { blue: number; red: number }): RoundResult {
  const ranked = Object.values(ledger.players).map((p) => ({ ...p, weapon: p.weapon ?? null })).sort(pointsOrder);
  const mvp = ranked[0] ? { ...ranked[0] } : null;
  const draw = ledger.mode === 'teams' ? teamScores.blue === teamScores.red
    : !mvp || (ranked.length > 1 && ranked[1].score === mvp.score);
  return { roundId: ledger.roundId, mapId: ledger.mapId, mode: ledger.mode, endedAt: ledger.endsAt, draw,
    winner: ledger.mode !== 'teams' && !draw ? mvp : null,
    winningTeam: ledger.mode === 'teams' && !draw ? teamScores.blue > teamScores.red ? 'blue' : 'red' : null,
    mvp, teamScores: ledger.mode === 'teams' ? { ...teamScores } : null, players: ranked };
}
export function resultOutcome(result: RoundResult, selfId: string, team: PlayerTeam): 'VICTORY' | 'DEFEAT' | 'DRAW' {
  if (result.draw) return 'DRAW';
  return (result.mode === 'teams' ? team !== null && team === result.winningTeam : selfId === result.winner?.id) ? 'VICTORY' : 'DEFEAT';
}
