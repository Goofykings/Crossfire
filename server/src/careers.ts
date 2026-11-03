import { createCareer, refreshCareer, careerView, type CareerProfile, type CareerView } from '../../shared/challenges';
import { PROTOCOL_VERSION } from '../../shared/protocol';

export async function careerIdentity(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export const validCareerCredential = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

/** Persistent guest capability, independent of room membership and editable guest UUIDs.
 * Pure challenge rules are shared; only this adapter depends on Workers storage.
 */
export class Careers {
  readonly profiles = new Map<string, CareerProfile>();
  private readonly dirty = new Map<string, number>();
  private generation = 0;
  mark(id: string): void { this.dirty.set(id, ++this.generation); }
  private readonly creationRates = new Map<string, { at: number; count: number }>();
  constructor(private readonly storage: DurableObjectStorage, private readonly active: () => Set<string>) {}
  async load(id: string): Promise<CareerProfile | undefined> {
    let profile = this.profiles.get(id);
    if (!profile) {
      profile = await this.storage.get<CareerProfile>(`career:${id}`);
      if (profile) { this.profiles.set(id, profile); this.trim(); }
    }
    return profile;
  }
  private trim(): void {
    const active = this.active();
    for (const id of this.profiles.keys()) {
      if (this.profiles.size <= 128) break;
      if (!active.has(id) && !this.dirty.has(id)) this.profiles.delete(id);
    }
  }
  capture(): { records: Record<string,CareerProfile>; versions: Map<string,number> } {
    return {records:Object.fromEntries([...this.dirty.keys()].flatMap(id=>{
      const profile=this.profiles.get(id);return profile?[[`career:${id}`,structuredClone(profile)]]:[];
    })),versions:new Map(this.dirty)};
  }
  committed(versions: Map<string,number>): void {
    for(const [id,version] of versions)if(this.dirty.get(id)===version)this.dirty.delete(id);
    this.trim();
  }
  views(now: number): Map<string, CareerView> {
    for (const [id, p] of this.profiles) if(refreshCareer(p, id, now))this.mark(id);
    return new Map([...this.profiles].map(([id, p]) => [id, careerView(p, now)]));
  }
  async http(request: Request): Promise<Response> {
    const now = Date.now();
    if (request.method === 'POST') {
      if (request.headers.has('Authorization') || (request.headers.get('Content-Length') && request.headers.get('Content-Length') !== '0')) return Response.json({ error: 'Profile creation accepts no player data.' }, { status: 400 });
      if (request.body) {
        const reader=request.body.getReader(), first=await reader.read();await reader.cancel();
        if (first.value?.byteLength) return Response.json({ error:'Profile creation accepts no player data.' },{status:400});
      }
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      let rate = this.creationRates.get(ip);
      if (!rate || now - rate.at >= 60000) { rate = { at: now, count: 0 }; this.creationRates.set(ip, rate); }
      if (++rate.count > 20) return Response.json({ error: 'Too many guest profiles. Try again shortly.' }, { status: 429 });
      if (this.creationRates.size > 128) this.creationRates.delete(this.creationRates.keys().next().value!);
      const credential = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
      const id = await careerIdentity(credential), profile = createCareer(id, now);
      await this.storage.put(`career:${id}`, profile);
      this.profiles.set(id, profile); this.trim();
      return Response.json({ v: PROTOCOL_VERSION, credential, profile: careerView(profile, now) }, { status: 201 });
    }
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const credential = (request.headers.get('Authorization')?.startsWith('Bearer ') ? request.headers.get('Authorization')!.slice(7) : '');
    if (!validCareerCredential(credential)) return Response.json({ error: 'A valid guest credential is required.' }, { status: 401 });
    const id = await careerIdentity(credential), profile = await this.load(id);
    if (!profile) return Response.json({ error: 'Guest profile not found. Restore its original credential or clear this site data to start a new guest.' }, { status: 401 });
    if (refreshCareer(profile, id, now)) await this.storage.put(`career:${id}`, profile);
    return Response.json({ v: PROTOCOL_VERSION, profile: careerView(profile, now) });
  }
}
