import { PUBLIC_ROOM } from '../../shared/protocol';
import { presenceEndpoint } from './endpoint';

/** HTTP only: viewing the home must never create a player session. */
export class Presence {
  private timer = 0;
  private request: AbortController | null = null;
  private readonly onVisibility = () => { if (!document.hidden) void this.poll(); };
  constructor(private readonly endpoint: string, private readonly update: (count: number | null) => void,
    private readonly visible: () => boolean) {}

  start(): void {
    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), 5000);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async poll(): Promise<void> {
    if (!this.visible() || document.hidden || this.request) return;
    const controller = new AbortController();
    this.request = controller;
    const timeout = window.setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(presenceEndpoint(this.endpoint), { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('Presence unavailable');
      const data = await response.json();
      if (data.room !== PUBLIC_ROOM || !Number.isSafeInteger(data.online) || data.online < 0 || data.online > 16) throw new Error('Invalid presence');
      this.update(data.online);
    } catch { this.update(null); }
    finally { window.clearTimeout(timeout); this.request = null; }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.request?.abort();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
