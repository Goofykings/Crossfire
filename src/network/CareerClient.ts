import { validLeaderboard, validPersonalStats, type LeaderboardView, type PersonalStats, type StatsPeriod, type StatsMetric } from '../../shared/statistics';
import { validCareerView, type CareerView } from '../../shared/challenges';
import { PROTOCOL_VERSION } from '../../shared/protocol';
import { presenceEndpoint } from './endpoint';
import type {PracticeChallengeRequest} from '../../shared/practiceChallenges';

/** The credential is a bearer capability, never the editable guestId or display name. */
export class CareerClient {
  view: CareerView | null = null;
  error = '';
  temporary = false;
  onChange: () => void = () => {};
  private credential = '';
  private scope = '';
  sessionScope(): string | undefined { return this.view ? this.scope || undefined : undefined; }
  private work: Promise<void> | null = null;
  private receivedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeRequest:AbortController|null=null;
  private readonly endpoint: string;
  private readonly key: string;
  constructor(url: string, private readonly storage = CareerClient.storage()) {
    const endpoint = presenceEndpoint(url); endpoint.pathname = '/profile';
    this.endpoint = endpoint.href; this.key = `crossfire.career.v1:${endpoint.origin}`;
    try { const saved = storage?.getItem(this.key); if (saved && /^[a-f0-9]{64}$/.test(saved)) this.credential = saved; } catch { this.temporary = true; }
    if (!storage) this.temporary = true;
  }
  private static storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
  }
  /** Only passed privately in the validated join envelope; never expose in diagnostics. */
  joinCredential(): string | undefined { return this.view && this.scope ? this.credential : undefined; }
  get serverNow(): number | null { return this.view ? this.view.serverTime + Math.max(0, performance.now() - this.receivedAt) : null; }
  accept(view: CareerView): void {
    if (!validCareerView(view) || (this.view && (view.revision < this.view.revision || view.serverTime < this.view.serverTime))) return;
    this.view = view; this.receivedAt = performance.now(); this.error = ''; this.onChange();
  }
  ensure(): Promise<void> {
    if (this.work) return this.work;
    const controller=new AbortController();this.activeRequest=controller;
    this.work = (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(this.key, {signal:controller.signal},() => this.fetchProfile(controller)) : this.fetchProfile(controller)).finally(() => { this.work = null;if(this.activeRequest===controller)this.activeRequest=null; });
    return this.work;
  }
  private async fetchProfile(controller:AbortController): Promise<void> {
    controller.signal.throwIfAborted();
    if (!this.credential) { try { const saved=this.storage?.getItem(this.key);if(saved&&/^[a-f0-9]{64}$/.test(saved))this.credential=saved; } catch { this.temporary=true; } }
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(this.endpoint, { method: this.credential ? 'GET' : 'POST', cache:'no-store',
        ...(this.credential ? { headers: { Authorization: `Bearer ${this.credential}` } } : {}), signal:controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? 'Guest credential unavailable. This profile cannot be recovered automatically.' : 'Challenges unavailable. Retry shortly.');
      const data = await response.json() as { v: number; credential?: string; profile: unknown };
      controller.signal.throwIfAborted();
      if (data.v !== PROTOCOL_VERSION) throw new Error('Challenge protocol differs. Refresh after matching frontend and server deployment.');
      if (!validCareerView(data.profile)) throw new Error('Invalid challenge response.');
      if (!this.credential) {
        if (!data.credential || !/^[a-f0-9]{64}$/.test(data.credential)) throw new Error('Guest credential missing.');
        this.credential = data.credential;
        try { this.storage?.setItem(this.key, this.credential); } catch { this.temporary = true; }
      }
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(this.credential));
      controller.signal.throwIfAborted();
      this.scope=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
      this.accept(data.profile);
    } catch (error) { this.error = (error as Error).name === 'AbortError' ? 'Challenges timed out. Retry shortly.' : (error as Error).message; this.onChange(); throw error; }
    finally { clearTimeout(timeout); }
  }
  async statistics(period: StatsPeriod, metric: StatsMetric, signal: AbortSignal): Promise<{ board: LeaderboardView; personal: PersonalStats | null }> {
    if (!this.view) await this.ensure().catch(() => {});
    const headers = this.joinCredential() ? { Authorization: `Bearer ${this.credential}` } : undefined;
    const board = new URL(this.endpoint); board.pathname='/leaderboard';board.search=new URLSearchParams({period,stat:metric}).toString();
    const stats = new URL(this.endpoint); stats.pathname='/stats';
    const responses=await Promise.all([fetch(board,{headers,signal,cache:'no-store'}),headers ? fetch(stats,{headers,signal,cache:'no-store'}) : Promise.resolve(null)]);
    if(responses.some(r=>r&&!r.ok))throw new Error('Leaderboards unavailable. Please retry shortly.');
    const [ranking,personal]=await Promise.all(responses.map(r=>r?r.json() as Promise<unknown>:null));
    if(!validLeaderboard(ranking)||ranking.period!==period||ranking.metric!==metric||(personal!==null&&!validPersonalStats(personal)))
      throw new Error('Leaderboard response is incompatible. Publish matching frontend and backend.');
    return {board:ranking,personal};
  }
  async practiceChallenge(body:PracticeChallengeRequest):Promise<string|undefined>{
    if(!this.view)await this.ensure();
    const endpoint=new URL(this.endpoint);endpoint.pathname='/practice-challenges';
    const response=await fetch(endpoint,{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${this.credential}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Bot challenge progress could not sync.');
    const data=await response.json() as {version?:number;runId?:string;v?:number;profile?:unknown};
    if(body.action==='start'){
      if(data.version!==1||typeof data.runId!=='string'||!/^[a-f0-9-]{36}$/.test(data.runId))throw new Error('Invalid practice challenge session.');
      return data.runId;
    }
    if(data.v!==PROTOCOL_VERSION||!validCareerView(data.profile))throw new Error('Invalid practice challenge progress.');
    this.accept(data.profile);return undefined;
  }
  start(visible: () => boolean): void {
    if (this.timer) return;
    this.timer = setInterval(() => { if (visible()) void this.ensure().catch(() => {}); }, 30000);
  }
  dispose(): void { if (this.timer) clearInterval(this.timer); this.timer = null;this.activeRequest?.abort(); }
}
