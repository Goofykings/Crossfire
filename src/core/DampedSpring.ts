/** Exact unit-mass damped oscillator. Independent of render rate, including long frames. */
export class DampedSpring {
  value = 0;
  velocity = 0;

  constructor(readonly frequency: number, readonly dampingRatio: number) {}

  update(dt: number): number {
    if (dt <= 0) return this.value;
    const w = this.frequency, z = this.dampingRatio;
    const x = this.value, v = this.velocity;
    if (z < 1) {
      const decay = z * w, wd = w * Math.sqrt(1 - z * z);
      const e = Math.exp(-decay * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      this.value = e * (x * c + (v + decay * x) / wd * s);
      this.velocity = e * (v * c - (decay * v + w * w * x) / wd * s);
    } else {
      // All callers use underdamped or critical springs.
      const e = Math.exp(-w * dt), b = v + w * x;
      this.value = (x + b * dt) * e;
      this.velocity = (v - w * b * dt) * e;
    }
    return this.value;
  }

  reset(): void { this.value = this.velocity = 0; }
}
