import type { PlayerTeam, MatchMode } from '../../shared/combat';
import { teammates } from '../../shared/combat';

/** Presentation only: never changes authoritative team identity or scores. */
export function playerColor(mode: MatchMode | null, selfId: string, selfTeam: PlayerTeam, id: string | null, team: PlayerTeam): 'friendly' | 'opponent' {
  return id === selfId || teammates(mode, selfTeam, team) ? 'friendly' : 'opponent';
}
export function displayTeam(team: PlayerTeam, selfTeam: PlayerTeam): PlayerTeam {
  if (!team || !selfTeam) return team;
  return team === selfTeam ? 'blue' : 'red';
}
export function teamOrder(selfTeam: PlayerTeam): ('blue' | 'red')[] {
  return selfTeam === 'red' ? ['red', 'blue'] : ['blue', 'red'];
}
