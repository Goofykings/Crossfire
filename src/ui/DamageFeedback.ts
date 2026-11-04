import type { Vec3 } from '../player/PlayerController';
import { damageHaze, damageTurn } from '../game/CombatPresentation';
import { HealthFeedback, type ConfirmedHealth } from './HealthFeedback';

/** Cosmetic only: hits and health gains come from authoritative messages, never a regen prediction. */
export class DamageFeedback {
  private readonly edges = document.createElement('div');
  private readonly healing = document.createElement('div');
  private readonly arrow = document.createElement('div');
  private readonly health = new HealthFeedback();
  private readonly symbols = Array.from({ length: 6 }, () => ({ element: document.createElement('span'),
    at: -Infinity, duration: 700, rise: 30, drift: 0 }));
  private hitAt = -Infinity;
  private healAt = -Infinity;
  private healStarted = -Infinity;
  private nextSymbol = 0;
  private strength = 0;
  private attackFrom = 0;
  private incoming: Vec3 | null = null;
  constructor(root: HTMLElement) {
    this.edges.className = 'damage-edges'; this.healing.className = 'healing-edges'; this.arrow.className = 'damage-arrow';
    for (const element of [this.edges, this.healing, this.arrow]) element.setAttribute('aria-hidden', 'true');
    for (const symbol of this.symbols) {
      symbol.element.className = 'healing-plus'; symbol.element.textContent = '+';
      symbol.element.setAttribute('aria-hidden', 'true');
    }
    root.append(this.edges, this.healing, this.arrow, ...this.symbols.map(s => s.element));
  }
  hit(direction: Vec3 | null, amount: number): void {
    if (!(amount > 0)) return;
    const now = performance.now();
    this.attackFrom = Number(this.edges.style.opacity) || 0;
    this.strength = Math.min(.9, Math.max(this.attackFrom, .34 + Math.min(100, amount) * .005));
    this.incoming = direction; this.hitAt = now; this.stopHealing();
  }
  observeHealth(confirmed: ConfirmedHealth): void {
    const change = this.health.observe(confirmed), now = performance.now();
    if (change.damage > 0) {
      this.stopHealing();
      // Hit messages precede their snapshot. Burn/environment damage may have no ray;
      // present those without inventing an attacker or duplicating the hit flash.
      if (now - this.hitAt > 150) this.hit(null, change.damage);
    } else if (change.full) this.stopHealing();
    else if (change.healed && now - this.hitAt > 180) {
      if (now - this.healAt > 250) { this.nextSymbol = now; this.healStarted = now; }
      this.healAt = now;
    }
  }
  private stopHealing(): void {
    this.healAt = -Infinity; this.healing.style.opacity = '0';
    for (const s of this.symbols) { s.at = -Infinity; s.element.style.opacity = '0'; }
  }
  update(yaw: number, pitch = 0): void {
    const now = performance.now(), t = (now - this.hitAt) / 1000;
    const fade = t < .075 ? Math.max(0, t / .075) : Math.max(0, 1 - (t - .075) / .55) ** 2;
    const side = this.incoming ? damageTurn(this.incoming, yaw) : 0;
    const haze = this.incoming ? damageHaze(this.incoming, yaw, pitch) : { left: .7, right: .7, top: .7, bottom: .7 };
    for (const [edge, weight] of Object.entries(haze)) this.edges.style.setProperty(`--edge-${edge}`, String(weight));
    this.edges.style.opacity = String(t < .075 ? this.attackFrom + (this.strength - this.attackFrom) * fade : fade * this.strength);
    this.arrow.style.opacity = String(side ? fade : 0);
    this.arrow.dataset.direction = side < 0 ? 'left' : 'right';
    this.arrow.style.setProperty('--side', String(side));
    this.arrow.textContent = side < 0 ? '\u2039' : '\u203a';
    const healingAge = now - this.healAt;
    this.healing.style.opacity = String(.34 * Math.max(0, Math.min(1, (now - this.healStarted) / 90, (350 - healingAge) / 150)));
    if (healingAge < 250 && now >= this.nextSymbol) {
      this.nextSymbol = now + 500; // Never catch up with a burst after a background tab.
      const s = this.symbols.find(s => now - s.at > s.duration);
      if (s) {
        s.at = now; s.duration = 500 + Math.random() * 400; s.rise = 20 + Math.random() * 20; s.drift = (Math.random() - .5) * 12;
        const edge = Math.floor(Math.random() * 4);
        s.element.style.left = `${edge < 2 ? (edge === 0 ? 3 : 91) + Math.random() * 5 : 8 + Math.random() * 84}%`;
        s.element.style.top = `${edge < 2 ? 15 + Math.random() * 70 : edge === 2 ? 6 + Math.random() * 5 : 88 + Math.random() * 6}%`;
        s.element.style.fontSize = `${16 + Math.random() * 8}px`;
      }
    }
    for (const s of this.symbols) {
      const progress = (now - s.at) / s.duration;
      s.element.style.opacity = String(progress >= 0 && progress < 1 ? .7 * Math.sin(Math.PI * progress) : 0);
      s.element.style.transform = `translate(${s.drift * Math.min(1, progress)}px, ${-s.rise * Math.min(1, progress)}px)`;
    }
  }
  clear(): void {
    this.hitAt = -Infinity; this.incoming = null; this.strength = this.attackFrom = 0;
    this.health.clear(); this.stopHealing(); this.update(0);
  }
  inspect() { return { age: (performance.now() - this.hitAt) / 1000, direction: this.arrow.dataset.direction,
    edges: Number(this.edges.style.opacity), arrow: Number(this.arrow.style.opacity),
    healing: Number(this.healing.style.opacity), symbols: this.symbols.filter(s => Number(s.element.style.opacity) > 0).length }; }
}
