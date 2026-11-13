import type { WeaponId } from '../src/weapons/Weapon';

export type ChallengeCategory = 'daily' | 'weekly';
export type BotDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'absurd';
export type BotMetric = `bot-kills-${BotDifficulty}` | `bot-wins-${BotDifficulty}`;
export type ChallengeMetric = WeaponId | 'melee' | BotMetric | 'headshots' | 'wins' | 'mvp' | 'matches' | 'points' | 'eliminations';
export const CHALLENGES_PER_PERIOD=5;
export interface ChallengeDefinition { id: string; category: ChallengeCategory; metric: ChallengeMetric; target: number; reward: number; description: string; family: string }
const targets = {
  rifle: [[5, 8], [50, 75]], smg: [[5, 10], [50, 75]], shotgun: [[5, 8], [40, 50]], sniper: [[5, 8], [40, 50]],
  headshots: [[3, 5], [20, 30]], wins: [[1, 3], [5, 10]], mvp: [[1], [3, 5]],
  matches: [[2, 5], [15, 25]], points: [[1000, 2000], [10000, 20000]], eliminations: [[10, 15], [75, 100]],
};
const descriptions: Partial<Record<ChallengeMetric, (n: number) => string>> = {
  rifle: n => `Get ${n} AR kills`, smg: n => `Get ${n} SMG kills`, shotgun: n => `Get ${n} shotgun kills`, sniper: n => `Get ${n} sniper kills`,
  headshots: n => `Get ${n} headshot eliminations`, wins: n => `Win ${n} ${n === 1 ? 'match' : 'matches'}`,
  mvp: n => `Earn MVP ${n} ${n === 1 ? 'time' : 'times'}`, matches: n => `Play ${n} complete matches`,
  points: n => `Earn ${n.toLocaleString('en-US')} match points`, eliminations: n => `Get ${n} eliminations`,
};
/** Stable IDs must remain available when extending this library: saved periods reference them. */
const legacy:ChallengeDefinition[] = (['daily', 'weekly'] as const).flatMap((category, i) =>
  (Object.keys(targets) as (keyof typeof targets)[]).flatMap(metric => targets[metric][i].map(target => ({
    id: `${category}:${metric}:${target}`, category, metric, target, reward: category === 'daily' ? 100 : 250,
    description: descriptions[metric]!(target),
    family: ['rifle', 'smg', 'shotgun', 'sniper'].includes(metric) ? 'weapon' : ['wins', 'mvp', 'matches'].includes(metric) ? 'match' : metric,
  }))));
const weaponNames:Record<WeaponId|'melee',string>={rifle:'assault rifle',smg:'SMG',shotgun:'shotgun',sniper:'sniper rifle','semi-sniper':'semi-auto sniper',melee:'melee'};
const botNames:Record<BotDifficulty,string>={beginner:'Beginner',intermediate:'Intermediate',advanced:'Advanced',absurd:'Absurd'};
const rotation:ChallengeDefinition[]=[];
for(const category of ['daily','weekly'] as const){
  const weekly=category==='weekly';
  for(const metric of Object.keys(weaponNames) as (WeaponId|'melee')[])for(const daily of metric==='melee'?[3,5]:[5,8]){
    const target=daily*(weekly?4:1);
    rotation.push({id:`${category}:${metric}:${target}`,category,metric,target,reward:weekly?250:100,description:`Get ${target} ${weaponNames[metric]} kills`,family:'weapon:'+metric});
  }
  for(const difficulty of Object.keys(botNames) as BotDifficulty[]){
    const counts=difficulty==='absurd'?(weekly?[3,5]:[1]):difficulty==='advanced'?(weekly?[20,32]:[5,8]):difficulty==='intermediate'?(weekly?[40,80]:[10,20]):weekly?[60,80]:[15,20];
    for(const target of counts)rotation.push({id:`${category}:bot-kills-${difficulty}:${target}`,category,metric:`bot-kills-${difficulty}`,target,reward:weekly?250:100,description:`Eliminate ${target} ${botNames[difficulty]} ${target===1?'bot':'bots'}`,family:'bot-kills'});
  }
  for(const difficulty of ['beginner','intermediate'] as const)for(const target of weekly?[3,4]:[1])rotation.push({id:`${category}:bot-wins-${difficulty}:${target}`,category,metric:`bot-wins-${difficulty}`,target,reward:weekly?250:100,description:`Win ${target} ${botNames[difficulty]} bot ${target===1?'match':'matches'}`,family:'bot-wins'});
}
/** Keep legacy IDs readable until their saved rotations expire. */
export const CHALLENGES:readonly ChallengeDefinition[]=[...rotation,...legacy.filter(d=>!rotation.some(n=>n.id===d.id))];
export const challengeDefinition = (id: string): ChallengeDefinition | undefined => CHALLENGES.find(d => d.id === id);
export interface ChallengeProgress { id: string; progress: number; completedAt: number | null }
export interface ChallengePeriod { start: number; endsAt: number; challenges: ChallengeProgress[] }
export interface CareerProfile { revision: number; gems: number; daily: ChallengePeriod; weekly: ChallengePeriod; lastMatchRound: number; abandonedRound: number;
 /** Server-private receipts; never included in CareerView or accepted from clients. */
 matchRewards?:Record<string,{matchId:string;roundId:number;gems:number}> }
export interface CareerView { developer?:boolean; accountId?:string; revision: number; gems: number; daily: ChallengePeriod; weekly: ChallengePeriod; serverTime: number }
export type ChallengeEvent = { kind: 'kill'; weapon: WeaponId | 'grenade' | 'melee'; head: boolean; points: number }
  | { kind: 'points'; points:number }
  | { kind: 'bot'; difficulty:BotDifficulty; kills:number; won:boolean }
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
  const candidates = rotation.filter(d => d.category === category);
  const families = Object.keys(weaponNames).map(metric=>'weapon:'+metric);
  for (let i = families.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [families[i], families[j]] = [families[j], families[i]]; }
  const challenges = [...families.slice(0,3),'bot-kills','bot-wins'].map(family => {
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
  }else if(profile[category].challenges.length===3){
    // Preserve progress and rewards in active legacy rotations; append bot goals.
    profile[category].challenges.push(...selectChallenges(identity,category,profile[category].start).challenges.slice(3));changed=true;
  }
  if (changed) profile.revision++;
  return changed;
}
/** Apply inside a server transaction: authoritative online events or bounded bot-only practice reports. */
export function advanceChallenges(profile: CareerProfile, identity: string, event: ChallengeEvent, at: number): void {
  refreshCareer(profile, identity, at);
  const amounts: Partial<Record<ChallengeMetric, number>> = event.kind === 'kill'
    ? { eliminations: 1, headshots: event.head ? 1 : 0, points: event.points, ...(event.weapon !== 'grenade' ? { [event.weapon]: 1 } : {}) }
    : event.kind==='bot'?{[`bot-kills-${event.difficulty}`]:Math.max(0,Math.floor(event.kills)),[`bot-wins-${event.difficulty}`]:Number(event.won)}
    : event.kind==='points'?{points:event.points}:{ wins: Number(event.won), mvp: Number(event.mvp), matches: Number(event.complete) };
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
  if ((p.developer!==undefined&&typeof p.developer!=='boolean')||(p.accountId!==undefined&&!/^[a-f0-9]{64}$/.test(p.accountId)))return false;
  if (!natural(p.revision) || !natural(p.gems) || !natural(p.serverTime)
    || Object.keys(p).some(k => !['revision', 'gems', 'daily', 'weekly', 'serverTime','developer','accountId'].includes(k))) return false;
  return (['daily', 'weekly'] as const).every(category => {
    const period = p[category], boundary = challengePeriod(category, p.serverTime);
    if (!period || period.start !== boundary.start || period.endsAt !== boundary.endsAt || !Array.isArray(period.challenges) || period.challenges.length !== CHALLENGES_PER_PERIOD
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
