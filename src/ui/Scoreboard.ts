import type { PlayerState, Snapshot } from '../../shared/protocol';

export const scoreOrder = (a: PlayerState, b: PlayerState): number => b.kills - a.kills || a.deaths - b.deaths
  || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

export function scoreboardGroups(snapshot: Snapshot): { label: string; players: PlayerState[] }[] {
  if (snapshot.match.mode === 'teams') return (['blue', 'red'] as const).map((team) => ({
    label: `${team.toUpperCase()} · ${snapshot.match.teamScores?.[team] ?? '—'}`,
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
    this.root.append(this.header, this.body);
    parent.appendChild(this.root);
  }
  get visible(): boolean { return !this.root.hidden; }
  setVisible(visible: boolean): void { this.root.hidden = !visible; }
  update(snapshot: Snapshot | null, selfId: string, serverNow: number): void {
    const mode = snapshot?.match.mode;
    const end = snapshot?.match.endsAt;
    const seconds = end == null ? null : Math.max(0, Math.ceil((end - serverNow) / 1000));
    this.header.textContent = `${mode === 'teams' ? 'TEAMS' : mode === 'ffa' ? 'FREE FOR ALL' : 'Mode unavailable'} · ${seconds === null ? '--:--' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}`;
    const signature = JSON.stringify([selfId, snapshot?.match, snapshot?.players.map((p) => [p.id, p.name, p.kills, p.deaths, p.team])]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.body.replaceChildren();
    const groups = snapshot ? scoreboardGroups(snapshot) : [{ label: '', players: [] }];
    for (const group of groups) {
      if (group.label) { const heading = document.createElement('h3'); heading.textContent = group.label; this.body.appendChild(heading); }
      const table = document.createElement('table');
      const head = table.createTHead().insertRow();
      for (const label of ['PLAYER', 'KILLS', 'DEATHS']) { const th = document.createElement('th'); th.textContent = label; head.appendChild(th); }
      const body = table.createTBody();
      for (const p of group.players) {
        const row = body.insertRow();
        row.dataset.playerId = p.id;
        row.classList.toggle('local', p.id === selfId);
        for (const value of [p.name, p.kills, p.deaths]) row.insertCell().textContent = String(value);
      }
      this.body.appendChild(table);
    }
  }
}
