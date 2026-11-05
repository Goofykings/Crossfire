import { teamOrder } from './teamColors';
import type { Snapshot } from '../../shared/protocol';
import { matchCountdown } from './matchFormatting';

/** Derive the last ten seconds from the same server deadline as the main clock. */
export function finalSeconds(endsAt: number | null, serverNow: number): number | null {
  if (endsAt === null || !Number.isFinite(endsAt) || !Number.isFinite(serverNow)) return null;
  const remaining = Math.ceil((endsAt - serverNow) / 1000);
  return remaining >= 1 && remaining <= 10 ? remaining : null;
}

/** Server deadline, updated without rebuilding the layout or starting a local round. */
export class MatchHud {
  readonly root = document.createElement('div');
  private readonly mode = document.createElement('small');
  private readonly timer = document.createElement('strong');
  private readonly blue = document.createElement('span');
  private readonly red = document.createElement('span');
  private readonly final = document.createElement('span');
  private lastFinal: number | null = null;
  private tick = false;
  constructor(parent: HTMLElement) {
    this.root.className = 'match-hud'; this.root.hidden = true;
    const clock = document.createElement('div'); clock.className = 'match-clock';
    this.final.className = 'match-final'; this.final.hidden = true; this.final.setAttribute('aria-label', 'Final countdown');
    clock.append(this.mode, this.timer, this.final);
    this.blue.className = 'match-team blue'; this.red.className = 'match-team red';
    this.root.append(this.blue, clock, this.red); parent.appendChild(this.root);
  }
  update(snapshot: Snapshot | null, serverNow: number, visible: boolean, selfId = ''): void {
    this.root.hidden = !visible || !snapshot;
    if (!snapshot) return;
    const mode = snapshot.match.mode === 'teams' ? 'TEAMS' : snapshot.match.mode === 'ffa' ? 'FFA' : '';
    const time = matchCountdown(snapshot.match.endsAt, serverNow);
    if (this.mode.textContent !== mode) this.mode.textContent = mode;
    if (this.timer.textContent !== time) this.timer.textContent = time;
    const final = finalSeconds(snapshot.match.endsAt, serverNow);
    this.final.hidden = final === null;
    if (final !== this.lastFinal) {
      this.lastFinal = final;
      this.final.textContent = final === null ? '' : String(final);
      if (final !== null) { this.tick = !this.tick; this.final.classList.toggle('tick-a', this.tick); this.final.classList.toggle('tick-b', !this.tick); }
    }
    const scores = snapshot.match.teamScores;
    this.blue.hidden = this.red.hidden = snapshot.match.mode !== 'teams' || !scores;
    const [friendly, enemy] = teamOrder(snapshot.players.find(p => p.id === selfId)?.team ?? null);
    for (const [node, score] of [[this.blue, scores?.[friendly]], [this.red, scores?.[enemy]]] as const) {
      const text = String(score ?? ''); if (node.textContent !== text) node.textContent = text;
    }
  }
}
