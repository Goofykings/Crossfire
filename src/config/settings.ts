/** Player settings persisted in localStorage. */

export type GraphicsQuality = 'low' | 'medium' | 'high';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';

export interface Settings {
  /** Multiplier on the base look speed (1 = default). */
  mouseSensitivity: number;
  invertY: boolean;
  /** Horizontal field of view in degrees. */
  fov: number;
  /** 0..1 */
  masterVolume: number;
  graphicsQuality: GraphicsQuality;
  shadowQuality: ShadowQuality;
  /** Render resolution relative to the display's device pixels (0.5..1). */
  resolutionScale: number;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  invertY: false,
  fov: 90,
  masterVolume: 0.7,
  graphicsQuality: 'medium',
  shadowQuality: 'medium',
  resolutionScale: 1,
  showFps: true,
};

export const SETTING_LIMITS = {
  mouseSensitivity: [0.1, 5],
  fov: [70, 110],
  masterVolume: [0, 1],
  resolutionScale: [0.5, 1],
} as const;

const STORAGE_KEY = 'crossfire.settings.v1';

type Listener = (s: Readonly<Settings>, changed: (keyof Settings)[]) => void;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Validate untrusted data (e.g. from localStorage) into a complete Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof typeof SETTING_LIMITS) => {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      (s[k] as number) = clamp(v, SETTING_LIMITS[k][0], SETTING_LIMITS[k][1]);
    }
  };
  num('mouseSensitivity');
  num('fov');
  num('masterVolume');
  num('resolutionScale');
  if (typeof r.invertY === 'boolean') s.invertY = r.invertY;
  if (typeof r.showFps === 'boolean') s.showFps = r.showFps;
  if (r.graphicsQuality === 'low' || r.graphicsQuality === 'medium' || r.graphicsQuality === 'high') {
    s.graphicsQuality = r.graphicsQuality;
  }
  if (r.shadowQuality === 'off' || r.shadowQuality === 'low' || r.shadowQuality === 'medium' || r.shadowQuality === 'high') {
    s.shadowQuality = r.shadowQuality;
  }
  return s;
}

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly storage: Storage | null = SettingsStore.safeStorage()) {
    this.current = this.load();
  }

  private static safeStorage(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }

  get value(): Readonly<Settings> {
    return this.current;
  }

  update(patch: Partial<Settings>): void {
    const next = sanitizeSettings({ ...this.current, ...patch });
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== this.current[k]);
    if (!changed.length) return;
    this.current = next;
    this.save();
    for (const l of this.listeners) l(this.current, changed);
  }

  reset(): void {
    this.update({ ...DEFAULT_SETTINGS });
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private load(): Settings {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      return sanitizeSettings(raw ? JSON.parse(raw) : null);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      /* storage full or blocked: settings still apply for this session */
    }
  }
}
