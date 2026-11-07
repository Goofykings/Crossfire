import { GRENADE } from './grenades';

/** Held input is credited only by simulation time AND elapsed authority time.
 * No client duration/strength is accepted. Missing packets never release a throw. */
export class GrenadeCharge {
  private started = 0;
  private credited = 0;
  private seen = 0;
  active = false;
  reset(): void { this.active = false; this.credited = 0; this.started = this.seen = 0; }
  progress(now: number): number {
    return this.active ? Math.min(1, Math.max(0, Math.min(this.credited, now - this.started)) / GRENADE.chargeMs) : 0;
  }
  /** HUD interpolation between input ticks; never used to authorize throw power. */
  presentationProgress(now:number):number{
    return this.active?Math.min(1,Math.max(0,Math.min(this.credited+Math.min(50,Math.max(0,now-this.seen)),now-this.started))/GRENADE.chargeMs):0;
  }
  update(held: boolean | undefined, now: number, dt: number, allowed: boolean, cancel = false): number | null {
    if (cancel || !allowed || (this.active && now - this.seen > 400)) { this.reset(); return null; }
    if (held === undefined) return null;
    this.seen = now;
    if (held) {
      if (!this.active) { this.active = true; this.started = now; this.credited = 0; }
      else this.credited = Math.min(GRENADE.chargeMs, this.credited + Math.max(0, Math.min(dt, 1 / 30)) * 1000);
      return null;
    }
    const strength = this.active ? this.progress(now) : null;
    this.reset();
    return strength;
  }
}
