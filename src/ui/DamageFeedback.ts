import type { Vec3 } from '../player/PlayerController';
import { damageHaze, damageTurn } from '../game/CombatPresentation';

/** HUD-only presentation of server-confirmed hits, independent of prediction. */
export class DamageFeedback {
  private readonly edges = document.createElement('div');
  private readonly arrow = document.createElement('div');
  private hitAt = -Infinity;
  private strength = 0;
  private attackFrom = 0;
  private incoming: Vec3 | null = null;
  constructor(root: HTMLElement) {
    this.edges.className = 'damage-edges'; this.arrow.className = 'damage-arrow';
    this.edges.setAttribute('aria-hidden', 'true'); this.arrow.setAttribute('aria-hidden', 'true');
    root.append(this.edges, this.arrow);
  }
  hit(direction: Vec3, amount: number): void {
    const now = performance.now();
    this.attackFrom = Number(this.edges.style.opacity) || 0;
    this.strength = Math.min(.8, .4 + Math.min(100, amount) * .003 + (now - this.hitAt < 500 ? .1 : 0));
    this.incoming = direction; this.hitAt = now;
  }
  update(yaw: number, pitch = 0): void {
    const t = (performance.now() - this.hitAt) / 1000;
    const fade = t < .04 ? Math.max(0, t / .04) : t < .13 ? 1 : Math.max(0, 1 - (t - .13) / .37) ** 2;
    const side = this.incoming ? damageTurn(this.incoming, yaw) : 0;
    const haze = this.incoming ? damageHaze(this.incoming, yaw, pitch) : { left: 0, right: 0, top: 0, bottom: 0 };
    for (const [edge, weight] of Object.entries(haze)) this.edges.style.setProperty(`--damage-${edge}`, String(weight));
    this.edges.style.opacity = String(t < .04 ? this.attackFrom + (this.strength - this.attackFrom) * fade : fade * this.strength);
    this.arrow.style.opacity = String(side ? fade : 0);
    this.arrow.dataset.direction = side < 0 ? 'left' : 'right';
    this.arrow.style.setProperty('--side', String(side));
    this.arrow.textContent = side < 0 ? '\u2039' : '\u203a';
  }
  clear(): void { this.hitAt = -Infinity; this.incoming = null; this.strength = 0; this.update(0); }
  inspect() { return { age: (performance.now() - this.hitAt) / 1000, direction: this.arrow.dataset.direction,
    edges: Number(this.edges.style.opacity), arrow: Number(this.arrow.style.opacity) }; }
}
