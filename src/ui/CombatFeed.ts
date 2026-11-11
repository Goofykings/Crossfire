import type { Elimination, Snapshot } from '../../shared/protocol';
import { playerColor } from './teamColors';
import { weaponIcon } from './WeaponIcons';
import { comboLabel } from './matchFormatting';

export function combatRelationship(mode: Snapshot['match']['mode'], selfId: string, selfTeam: Elimination['victimTeam'],
  id: string | null, targetTeam: Elimination['victimTeam']): 'friendly' | 'opponent' {
  return playerColor(mode, selfId, selfTeam, id, targetTeam);
}

/** Ephemeral, server-confirmed events. Player names are always rendered as text. */
export class CombatFeed {
  private readonly seen = new Set<string>();
  private readonly root = document.createElement('div');
  private readonly feed = document.createElement('div');
  private readonly confirmation = document.createElement('div');
  constructor(parent: HTMLElement) {
    this.root.className = 'combat-events'; this.root.hidden = true;
    this.feed.className = 'kill-feed'; this.feed.setAttribute('aria-live', 'polite');
    this.confirmation.className = 'elimination-confirmation'; this.confirmation.hidden = true;
    this.confirmation.addEventListener('animationend', (event) => {
      if (event.target === this.confirmation) this.hideConfirmation();
    });
    this.root.append(this.feed, this.confirmation); parent.appendChild(this.root);
  }
  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) this.hideConfirmation();
  }
  private hideConfirmation(): void { this.confirmation.hidden = true; this.confirmation.classList.remove('active'); }
  add(event: Elimination, snapshot: Snapshot, selfId: string): void {
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    const selfTeam = snapshot.players.find((p) => p.id === selfId)?.team ?? null;
    const relation = (id: string | null, playerTeam: Elimination['victimTeam']) => combatRelationship(snapshot.match.mode, selfId, selfTeam, id, playerTeam);
    const row = document.createElement('div'); row.className = 'kill-feed-entry';
    const killer = document.createElement('span'); killer.className = `combat-name-${relation(event.killerId, event.killerTeam)}`;
    killer.dataset.id = event.killerId ?? ''; killer.dataset.team = event.killerTeam ?? '';
    killer.textContent = event.killerName ?? 'Environment';
    const icon = document.createElement('span'); icon.className = 'kill-feed-weapon'; icon.innerHTML = weaponIcon(event.weapon);
    const victim = document.createElement('span'); victim.className = `combat-name-${relation(event.victimId, event.victimTeam)}`; victim.textContent = event.victimName;
    victim.dataset.id = event.victimId; victim.dataset.team = event.victimTeam ?? '';
    row.append(killer, icon, victim); this.feed.appendChild(row);
    while (this.feed.childElementCount > 5) this.feed.firstElementChild?.remove();
    window.setTimeout(() => row.remove(), 5500);
    if (!this.root.hidden && event.killerId === selfId && event.victimId !== selfId) {
      const heading = document.createElement('strong'); heading.textContent = 'ELIMINATED';
      const name = document.createElement('span'); name.textContent = event.victimName;
      this.confirmation.replaceChildren(heading, name);
      if (event.award) {
        const score = document.createElement('b'); score.className = 'elimination-points'; score.textContent = `+${event.award.total}`;
        const breakdown = document.createElement('small'); breakdown.className = 'elimination-breakdown';
        const rows: [number, string][] = [[event.award.base, 'Elimination']];
        if (event.award.headshot) rows.push([event.award.headshot, 'Headshot']);
        if (event.award.combo) rows.push([event.award.combo, comboLabel(event.award.comboCount)]);
        for (const [amount, label] of rows) { const row = document.createElement('span'); row.textContent = `+${amount} ${label}`; breakdown.appendChild(row); }
        this.confirmation.append(score, breakdown);
      }
      this.confirmation.hidden = false;
      // Restart the animation even for rapid confirmed kills.
      this.confirmation.classList.remove('active'); void this.confirmation.offsetWidth; this.confirmation.classList.add('active');
    }
  }
  updatePerspective(snapshot: Snapshot, selfId: string): void {
    const team = snapshot.players.find(p => p.id === selfId)?.team ?? null;
    for (const node of this.feed.querySelectorAll<HTMLElement>('[data-id]')) {
      const target = snapshot.players.find(p => p.id === node.dataset.id);
      const targetTeam = target ? target.team : (node.dataset.team === 'blue' || node.dataset.team === 'red' ? node.dataset.team : null);
      node.className = `combat-name-${playerColor(snapshot.match.mode, selfId, team, node.dataset.id || null, targetTeam)}`;
    }
  }
  clear(): void { this.feed.replaceChildren(); this.hideConfirmation(); }
}
