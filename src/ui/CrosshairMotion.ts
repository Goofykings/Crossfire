/** Cosmetic, frame-rate-independent damping; never feeds weapon accuracy. */
export class CrosshairMotion {
  gap = 4;
  update(spread: number, dt: number): number {
    const target = 4 + Math.max(0, spread);
    this.gap += (target - this.gap) * (1 - Math.exp(-18 * Math.max(0, dt)));
    return this.gap;
  }
}
