import { teammates, type PlayerTeam } from '../../shared/combat';
import { pointsOrder, resultOutcome, type RoundResult, type RoundStanding } from '../../shared/scoring';
import { formatScore } from './matchFormatting';
import { weaponIcon } from './WeaponIcons';

export function resultGroups(result: RoundResult): { team: PlayerTeam; players: RoundStanding[] }[] {
  const players = [...(result.players ?? [])].sort(pointsOrder);
  return result.mode === 'teams' ? (['blue', 'red'] as const).map((team) => ({ team, players: players.filter((p) => p.team === team) }))
    : [{ team: null, players }];
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = cls; element.textContent = text; return element;
}

/** Built once per immutable server result. No polling, animation timers or live-round data. */
export function createRoundResults(result: RoundResult, selfId: string, team: PlayerTeam, next: () => void, home: () => void): HTMLElement {
  const outcome = resultOutcome(result, selfId, team);
  const panel = node('div', 'round-results'); panel.dataset.outcome = outcome.toLowerCase();
  const banner = node('header', 'result-banner');
  banner.append(node('small', 'result-mode', result.mode === 'teams' ? 'TEAMS · MATCH COMPLETE' : 'FREE FOR ALL · MATCH COMPLETE'), node('h1', 'result-title', outcome));
  const winner = node('p', 'result-winner', result.draw ? 'Match drawn' : result.mode === 'teams'
    ? `${result.winningTeam?.toUpperCase()} TEAM WINS` : `${result.winner?.name} wins`);
  banner.append(winner); panel.append(banner);
  const boards = node('div', 'result-boards'); boards.dataset.mode = result.mode;
  if (!result.players) boards.append(node('p', 'result-unavailable', 'Detailed results unavailable for this earlier round.'));
  else for (const group of resultGroups(result)) {
    const section = node('section', 'result-board'); section.dataset.team = group.team ?? 'ffa';
    const heading = node('h2', 'result-board-heading', group.team ? `${group.team.toUpperCase()} TEAM` : 'FINAL RANKING');
    if (group.team && result.teamScores) heading.append(node('strong', 'result-team-score', String(result.teamScores[group.team])));
    section.append(heading);
    const scroll = node('div', 'result-table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', `${group.team ?? 'FFA'} match results`);
    const table = node('table'); const head = table.createTHead().insertRow();
    for (const label of ['PLAYER', 'WEAPON', 'SCORE', 'K', 'D']) { const th = node('th', '', label); th.scope = 'col'; if (label === 'K') th.title = 'Kills'; if (label === 'D') th.title = 'Deaths'; head.append(th); }
    const body = table.createTBody();
    for (const [i, p] of group.players.entries()) {
      const row = body.insertRow(); row.dataset.playerId = p.id; row.classList.toggle('local', p.id === selfId);
      const friendly = p.id === selfId || teammates(result.mode, team, p.team);
      const name = row.insertCell(); name.className = `score-name-${friendly ? 'friendly' : 'opponent'}`;
      name.append(node('span', 'result-rank', String(i + 1)), node('span', 'result-player-name', p.name)); name.title = p.name;
      if (p.id === result.winner?.id) name.append(node('small', 'result-player-winner', 'WINNER'));
      row.insertCell().innerHTML = weaponIcon(p.weapon);
      const score = row.insertCell(); score.textContent = formatScore(p.score); score.title = `${p.score} points`; score.dataset.score = String(p.score);
      for (const value of [p.kills, p.deaths]) row.insertCell().textContent = String(value);
    }
    scroll.append(table); section.append(scroll);
    if (!group.players.length) section.append(node('p', 'result-empty', 'No participants'));
    boards.append(section);
  }
  panel.append(boards);
  const mvp = node('div', 'result-mvp');
  mvp.append(node('small', '', 'MVP'), node('strong', '', result.mvp?.name ?? 'No participants'), node('span', '', result.mvp ? `${result.mvp.score} points` : ''));
  panel.append(mvp);
  const actions = node('div', 'result-actions');
  const play = node('button', 'btn primary', 'PLAY AGAIN'), lobby = node('button', 'btn leave-match', 'RETURN TO LOBBY');
  let activated = false;
  const once = (action: () => void) => () => { if (activated) return; activated = true; play.disabled = lobby.disabled = true; action(); };
  play.onclick = once(next); lobby.onclick = once(home); actions.append(play, lobby); panel.append(actions);
  return panel;
}
