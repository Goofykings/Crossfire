import type { WeaponId } from '../src/weapons/Weapon';

export type ChallengeCategory = 'daily' | 'weekly';
export type ChallengeMetric = 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'headshots' | 'wins' | 'mvp' | 'matches' | 'points' | 'eliminations';
export interface ChallengeDefinition { id: string; category: ChallengeCategory; metric: ChallengeMetric; target: number; reward: number; description: string; family: string }
const targets: Record<ChallengeMetric, [number[], number[]]> = {
  rifle: [[5, 8], [50, 75]], smg: [[5, 10], [50, 75]], shotgun: [[5, 8], [40, 50]], sniper: [[5, 8], [40, 50]],
  headshots: [[3, 5], [20, 30]], wins: [[1, 3], [5, 10]], mvp: [[1], [3, 5]],
  matches: [[2, 5], [15, 25]], points: [[1000, 2000], [10000, 20000]], eliminations: [[10, 15], [75, 100]],
};
const descriptions: Record<ChallengeMetric, (n: number) => string> = {
  rifle: n => `Get ${n} AR kills`, smg: n => `Get ${n} SMG kills`, shotgun: n => `Get ${n} shotgun kills`, sniper: n => `Get ${n} sniper kills`,
  headshots: n => `Get ${n} headshot eliminations`, wins: n => `Win ${n} ${n === 1 ? 'match' : 'matches'}`,
  mvp: n => `Earn MVP ${n} ${n === 1 ? 'time' : 'times'}`, matches: n => `Play ${n} complete matches`,
  points: n => `Earn ${n.toLocaleString('en-US')} match points`, eliminations: n => `Get ${n} eliminations`,
};
/** Stable IDs must remain available when extending this library: saved periods reference them. */
export const CHALLENGES: readonly ChallengeDefinition[] = (['daily', 'weekly'] as const).flatMap((category, i) =>
  (Object.keys(targets) as ChallengeMetric[]).flatMap(metric => targets[metric][i].map(target => ({
    id: `${category}:${metric}:${target}`, category, metric, target, reward: category === 'daily' ? 100 : 250,
    description: descriptions[metric](target),
    family: ['rifle', 'smg', 'shotgun', 'sniper'].includes(metric) ? 'weapon' : ['wins', 'mvp', 'matches'].includes(metric) ? 'match' : metric,
  }))));
export const challengeDefinition = (id: string): ChallengeDefinition | undefined => CHALLENGES.find(d => d.id === id);
export interface ChallengeProgress { id: string; progress: number; completedAt: number | null }
export interface ChallengePeriod { start: number; endsAt: number; challenges: ChallengeProgress[] }
export interface CareerProfile { revision: number; gems: number; daily: ChallengePeriod; weekly: ChallengePeriod; lastMatchRound: number; abandonedRound: number }
export interface CareerView { revision: number; gems: number; daily: ChallengePeriod; weekly: ChallengePeriod; serverTime: number }
export type ChallengeEvent = { kind: 'kill'; weapon: WeaponId | 'grenade'; head: boolean; points: number }
  | { kind: 'round'; won: boolean; mvp: boolean; complete: boolean };
const DAY = 86400000;
export function challengePeriod(category: ChallengeCategory, now: number): { start: number; endsAt: number } {
  let start = Math.floor(now / DAY) * DAY;
  if (category === 'weekly') start -= (new Date(start).getUTCDay() + 6) % 7 * DAY;
  return { start, endsAt: start + DAY * (category === 'daily' ? 1 : 7) };
}
function hash(value: string): number { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function selectChallenges(identity: string, category: ChallengeCategory, now: number): ChallengePeriod {
  const period = challengePeriod(category, now);
  let seed = hash(`${identity}:${category}:${period.start}:1`);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const candidates = CHALLENGES.filter(d => d.category === category);
  const families = [...new Set(candidates.map(d => d.family))];
  for (let i = families.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [families[i], families[j]] = [families[j], families[i]]; }
  const challenges = families.slice(0, 3).map(family => {
    const variants = candidates.filter(d => d.family === family);
    return { id: variants[Math.floor(random() * variants.length)].id, progress: 0, completedAt: null };
  });
  return { ...period, challenges };
}
export function createCareer(identity: string, now: number): CareerProfile {
  return { revision: 0, gems: 0, daily: selectChallenges(identity, 'daily', now), weekly: selectChallenges(identity, 'weekly', now), lastMatchRound: -1, abandonedRound: -1 };
}
export function refreshCareer(profile: CareerProfile, identity: string, now: number): boolean {
  let changed = false;
  for (const category of ['daily', 'weekly'] as const) if (profile[category].start < challengePeriod(category, now).start) {
    profile[category] = selectChallenges(identity, category, now); changed = true;
  }
  if (changed) profile.revision++;
  return changed;
}
/** Called only inside an authoritative gameplay transaction; never from client claims. */
export function advanceChallenges(profile: CareerProfile, identity: string, event: ChallengeEvent, at: number): void {
  refreshCareer(profile, identity, at);
  const amounts: Partial<Record<ChallengeMetric, number>> = event.kind === 'kill'
    ? { eliminations: 1, headshots: event.head ? 1 : 0, points: event.points, ...(event.weapon !== 'grenade' ? { [event.weapon]: 1 } : {}) }
    : { wins: Number(event.won), mvp: Number(event.mvp), matches: Number(event.complete) };
  let changed = false;
  for (const category of ['daily', 'weekly'] as const) for (const card of profile[category].challenges) {
    if (at < profile[category].start || at >= profile[category].endsAt) continue;
    const definition = challengeDefinition(card.id)!;
    if (card.completedAt !== null || !amounts[definition.metric]) continue;
    card.progress = Math.min(definition.target, card.progress + amounts[definition.metric]!); changed = true;
    if (card.progress === definition.target) { card.completedAt = at; profile.gems += definition.reward; }
  }
  if (changed) profile.revision++;
}
export function careerView(profile: CareerProfile, now: number): CareerView {
  return { revision: profile.revision, gems: profile.gems, daily: structuredClone(profile.daily), weekly: structuredClone(profile.weekly), serverTime: now };
}
const natural = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
export function validCareerView(value: unknown): value is CareerView {
  if (!value || typeof value !== 'object') return false;
  const p = value as CareerView;
  if (!natural(p.revision) || !natural(p.gems) || !natural(p.serverTime)
    || Object.keys(p).some(k => !['revision', 'gems', 'daily', 'weekly', 'serverTime'].includes(k))) return false;
  return (['daily', 'weekly'] as const).every(category => {
    const period = p[category], boundary = challengePeriod(category, p.serverTime);
    if (!period || period.start !== boundary.start || period.endsAt !== boundary.endsAt || !Array.isArray(period.challenges) || period.challenges.length !== 3
      || Object.keys(period).some(k => !['start', 'endsAt', 'challenges'].includes(k))) return false;
    const metrics = new Set<string>();
    return period.challenges.every(card => {
      if (!card || typeof card.id !== 'string') return false;
      const d = challengeDefinition(card.id);
      if (!d || d.category !== category || metrics.has(d.metric) || !natural(card.progress) || card.progress > d.target
        || Object.keys(card).some(k => !['id', 'progress', 'completedAt'].includes(k))
        || (card.progress === d.target ? !natural(card.completedAt) || card.completedAt > p.serverTime || card.completedAt < period.start : card.completedAt !== null)) return false;
      metrics.add(d.metric); return true;
    });
  });
}
