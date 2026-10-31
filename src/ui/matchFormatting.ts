/** Truncate to hundreds before formatting; never round points used for ranking. */
export function formatScore(score: number): string {
  if (score < 1000) return String(Math.trunc(score));
  const hundreds = Math.floor(score / 100);
  return `${Math.floor(hundreds / 10)}${hundreds % 10 ? `.${hundreds % 10}` : ''}k`;
}
export function matchCountdown(endsAt: number | null, serverNow: number): string {
  if (endsAt === null) return '--:--';
  const seconds = Math.max(0, Math.ceil((endsAt - serverNow) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function comboLabel(count: number): string {
  return count === 2 ? 'Double Elimination' : count === 3 ? 'Triple Elimination' : `${count} Elimination Combo`;
}
