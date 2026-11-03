import { validCareerView, type CareerView } from '../../shared/challenges';
import { PROTOCOL_VERSION } from '../../shared/protocol';
import { presenceEndpoint } from './endpoint';

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
    this.work = (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(this.key, () => this.fetchProfile()) : this.fetchProfile()).finally(() => { this.work = null; });
    return this.work;
  }
  private async fetchProfile(): Promise<void> {
    if (!this.credential) { try { const saved=this.storage?.getItem(this.key);if(saved&&/^[a-f0-9]{64}$/.test(saved))this.credential=saved; } catch { this.temporary=true; } }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(this.endpoint, { method: this.credential ? 'GET' : 'POST', cache:'no-store',
        ...(this.credential ? { headers: { Authorization: `Bearer ${this.credential}` } } : {}), signal:controller.signal });
      if (!response.ok) throw new Error(response.status === 401 ? 'Guest credential unavailable. This profile cannot be recovered automatically.' : 'Challenges unavailable. Retry shortly.');
      const data = await response.json() as { v: number; credential?: string; profile: unknown };
      if (data.v !== PROTOCOL_VERSION) throw new Error('Challenge protocol differs. Refresh after matching frontend and server deployment.');
      if (!validCareerView(data.profile)) throw new Error('Invalid challenge response.');
      if (!this.credential) {
        if (!data.credential || !/^[a-f0-9]{64}$/.test(data.credential)) throw new Error('Guest credential missing.');
        this.credential = data.credential;
        try { this.storage?.setItem(this.key, this.credential); } catch { this.temporary = true; }
      }
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(this.credential));
      this.scope=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
      this.accept(data.profile);
    } catch (error) { this.error = (error as Error).name === 'AbortError' ? 'Challenges timed out. Retry shortly.' : (error as Error).message; this.onChange(); throw error; }
    finally { clearTimeout(timeout); }
  }
  start(visible: () => boolean): void {
    if (this.timer) return;
    this.timer = setInterval(() => { if (visible()) void this.ensure().catch(() => {}); }, 30000);
  }
  dispose(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
