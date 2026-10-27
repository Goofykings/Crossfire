export const USERNAME_LIMIT = 24;

/** Shared display-name policy; the Worker always runs it on untrusted joins. */
export function normalizeUsername(value: string): string | null {
  const clean = value.normalize('NFKC').replace(/[\p{C}<>]/gu, '').trim();
  return Array.from(clean).slice(0, USERNAME_LIMIT).join('') || null;
}
