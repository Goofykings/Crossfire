import type { Snapshot } from '../../shared/protocol';
import { matchCountdown } from './matchFormatting';

/** Server deadline, updated without rebuilding the layout or starting a local round. */
export class MatchHud {
  readonly root = document.createElement('div');
  private readonly mode = document.createElement('small');
  private readonly timer = document.createElement('strong');
  private readonly blue = document.createElement('span');
  private readonly red = document.createElement('span');
  constructor(parent: HTMLElement) {
    this.root.className = 'match-hud'; this.root.hidden = true;
    const clock = document.createElement('div'); clock.className = 'match-clock'; clock.append(this.mode, this.timer);
    this.blue.className = 'match-team blue'; this.red.className = 'match-team red';
    this.root.append(this.blue, clock, this.red); parent.appendChild(this.root);
  }
  update(snapshot: Snapshot | null, serverNow: number, visible: boolean): void {
    this.root.hidden = !visible || !snapshot;
    if (!snapshot) return;
    const mode = snapshot.match.mode === 'teams' ? 'TEAMS' : snapshot.match.mode === 'ffa' ? 'FFA' : '';
    const time = matchCountdown(snapshot.match.endsAt, serverNow);
    if (this.mode.textContent !== mode) this.mode.textContent = mode;
    if (this.timer.textContent !== time) this.timer.textContent = time;
    const scores = snapshot.match.teamScores;
    this.blue.hidden = this.red.hidden = snapshot.match.mode !== 'teams' || !scores;
    for (const [node, score] of [[this.blue, scores?.blue], [this.red, scores?.red]] as const) {
      const text = String(score ?? ''); if (node.textContent !== text) node.textContent = text;
    }
  }
}
