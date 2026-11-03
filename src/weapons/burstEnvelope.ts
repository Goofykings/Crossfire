/** Presentation only: elapsed authoritative milliseconds, never damage/radius. */
export function burstEnvelope(ageMs: number) {
  const age = Math.max(0, ageMs) / 1000;
  return {
    age,
    flash: age < .06 ? (1 - age / .06) ** 2 : 0,
    fire: age < .45 ? Math.min(1, age / .035) * (1 - age / .45) ** 1.4 : 0,
    expansion: 1 - Math.exp(-age * 16),
    ring: age < .24 ? (1 - age / .24) ** 2 : 0,
    light: age < .24 ? (1 - age / .24) ** 3 : 0,
    sparks: age < .55 ? (1 - age / .55) ** 2 : 0,
  };
}
