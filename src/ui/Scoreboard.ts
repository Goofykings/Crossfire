import type { PlayerState, Snapshot } from '../../shared/protocol';
import {meleeBlocked} from '../../shared/melee';
import { weaponIcon } from './WeaponIcons';
import { playerColor, displayTeam, teamOrder } from './teamColors';
import { pointsOrder } from '../../shared/scoring';
import { formatScore, matchCountdown } from './matchFormatting';

export function scoreboardRelationship(snapshot: Snapshot, selfId: string, player: PlayerState): 'friendly' | 'opponent' {
  const self = snapshot.players.find((p) => p.id === selfId);
  return playerColor(snapshot.match.mode, selfId, self?.team ?? null, player.id, player.team);
}

export const scoreOrder = pointsOrder;

export function scoreboardGroups(snapshot: Snapshot, selfTeam: PlayerState['team'] = null): { label: string; players: PlayerState[] }[] {
  if (snapshot.match.mode === 'teams') return teamOrder(selfTeam).map((team) => ({
    label: `${displayTeam(team, selfTeam)!.toUpperCase()} · ${snapshot.match.teamScores?.[team] ?? '—'}`,
    players: snapshot.players.filter((p) => p.team === team).sort(scoreOrder),
  })).concat(snapshot.players.some((p) => p.team === null) ? [{ label: 'UNASSIGNED', players: snapshot.players.filter((p) => p.team === null).sort(scoreOrder) }] : []);
  return [{ label: '', players: [...snapshot.players].sort(scoreOrder) }];
}

/** Read-only server data. Player names always use textContent. */
export class Scoreboard {
  readonly root = document.createElement('div');
  private readonly header = document.createElement('div');
  private readonly body = document.createElement('div');
  private signature = '';
  constructor(parent: HTMLElement) {
    this.root.className = 'scoreboard';
    this.root.setAttribute('aria-label', 'Leaderboard');
    this.root.hidden = true;
    this.header.className = 'scoreboard-header';
    // Keep scrolling content separate so the decorative feather can extend outward.
    const content = document.createElement('div');
    content.className = 'scoreboard-content';
    content.append(this.header, this.body);
    this.root.append(content);
    parent.appendChild(this.root);
  }
  get visible(): boolean { return !this.root.hidden; }
  setVisible(visible: boolean): void { this.root.hidden = !visible; }
  update(snapshot: Snapshot | null, selfId: string, serverNow: number): void {
    const mode = snapshot?.match.mode;
    this.root.dataset.mode=mode??'';
    const end = snapshot?.match.endsAt;
    this.header.textContent = `${mode === 'teams' ? 'TEAMS' : mode === 'ffa' ? 'FREE FOR ALL' : 'Mode unavailable'} · ${matchCountdown(end ?? null, serverNow)}`;
    const signature = JSON.stringify([selfId, snapshot?.match, snapshot?.players.map((p) => [p.id, p.name, p.score, p.kills, p.deaths, p.assists, p.team, p.weapon, meleeBlocked(p.combat.melee)])]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.body.replaceChildren();
    const groups = snapshot ? scoreboardGroups(snapshot, snapshot.players.find(p => p.id === selfId)?.team ?? null) : [{ label: '', players: [] }];
    for (const group of groups) {
      if (group.label) { const heading = document.createElement('h3'); heading.textContent = group.label; heading.dataset.team = group.label.startsWith('BLUE') ? 'blue' : group.label.startsWith('RED') ? 'red' : ''; this.body.appendChild(heading); }
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      for (const label of ['PLAYER', 'WEAPON', 'SCORE', 'KILLS', 'DEATHS', 'ASSISTS']) { const th = document.createElement('th'); th.textContent = label; th.scope = 'col'; head.appendChild(th); }
      const body = table.createTBody();
      for (const p of group.players) {
        const row = body.insertRow();
        row.dataset.playerId = p.id;
        row.classList.toggle('local', p.id === selfId);
        const name = row.insertCell();
        name.className = `score-name-${snapshot ? scoreboardRelationship(snapshot, selfId, p) : 'opponent'}`;
        name.textContent = p.name;
        row.insertCell().innerHTML = weaponIcon(meleeBlocked(p.combat.melee)?'melee':p.weapon);
        const score = row.insertCell(); score.textContent = formatScore(p.score); score.title = `${p.score} points`; score.dataset.score = String(p.score);
        for (const value of [p.kills, p.deaths, p.assists??0]) row.insertCell().textContent = String(value);
      }
      this.body.appendChild(table);
    }
  }
}
