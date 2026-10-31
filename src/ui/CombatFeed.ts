import type { Elimination, Snapshot } from '../../shared/protocol';
import { teammates } from '../../shared/combat';
import { weaponIcon } from './WeaponIcons';

export function combatRelationship(mode: Snapshot['match']['mode'], selfId: string, selfTeam: Elimination['victimTeam'],
  id: string | null, targetTeam: Elimination['victimTeam']): 'friendly' | 'opponent' {
  return id === selfId || teammates(mode, selfTeam, targetTeam) ? 'friendly' : 'opponent';
}

/** Ephemeral, server-confirmed events. Player names are always rendered as text. */
export class CombatFeed {
  private readonly root = document.createElement('div');
  private readonly feed = document.createElement('div');
  private readonly confirmation = document.createElement('div');
  constructor(parent: HTMLElement) {
    this.root.className = 'combat-events'; this.root.hidden = true;
    this.feed.className = 'kill-feed'; this.feed.setAttribute('aria-live', 'polite');
    this.confirmation.className = 'elimination-confirmation'; this.confirmation.hidden = true;
    this.root.append(this.feed, this.confirmation); parent.appendChild(this.root);
  }
  setVisible(visible: boolean): void { this.root.hidden = !visible; }
  add(event: Elimination, snapshot: Snapshot, selfId: string): void {
    const selfTeam = snapshot.players.find((p) => p.id === selfId)?.team ?? null;
    const relation = (id: string | null, playerTeam: Elimination['victimTeam']) => combatRelationship(snapshot.match.mode, selfId, selfTeam, id, playerTeam);
    const row = document.createElement('div'); row.className = 'kill-feed-entry';
    const killer = document.createElement('span'); killer.className = `combat-name-${relation(event.killerId, event.killerTeam)}`;
    killer.textContent = event.killerName ?? 'Environment';
    const icon = document.createElement('span'); icon.className = 'kill-feed-weapon'; icon.innerHTML = weaponIcon(event.weapon);
    const victim = document.createElement('span'); victim.className = `combat-name-${relation(event.victimId, event.victimTeam)}`; victim.textContent = event.victimName;
    row.append(killer, icon, victim); this.feed.appendChild(row);
    while (this.feed.childElementCount > 5) this.feed.firstElementChild?.remove();
    window.setTimeout(() => row.remove(), 5500);
    if (event.killerId === selfId && event.victimId !== selfId) {
      const heading = document.createElement('strong'); heading.textContent = 'ELIMINATION';
      const name = document.createElement('span'); name.textContent = event.victimName;
      this.confirmation.replaceChildren(heading, name);
      this.confirmation.hidden = false;
      // Replacing the node restarts the animation even for rapid confirmed kills.
      this.confirmation.classList.remove('active'); void this.confirmation.offsetWidth; this.confirmation.classList.add('active');
    }
  }
  clear(): void { this.feed.replaceChildren(); this.confirmation.hidden = true; this.confirmation.classList.remove('active'); }
}
