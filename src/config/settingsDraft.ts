import { DEFAULT_SETTINGS, sameSetting, sanitizeSettings, type Settings, type SettingsStore } from './settings';

/**
 * Two layers of settings: the *applied* ones (owned by SettingsStore: live in the game and saved to localStorage) and a
 * *draft* that the settings menu edits. Nothing in the draft reaches the game, the audio or localStorage until apply().
 */
export class SettingsDraft {
  private draft: Settings;
  /** The applied values the draft was last in sync with; used to tell edited keys from untouched ones. */
  private base: Settings;
  private readonly unsubscribe: () => void;

  constructor(private readonly store: SettingsStore) {
    this.base = { ...store.value };
    this.draft = { ...store.value };
    // Applied settings can change behind the menu's back (F3 toggles the FPS counter): follow those for keys the player has not edited
    this.unsubscribe = store.onChange((now, changed) => {
      for (const k of changed) if (sameSetting(k, this.draft[k], this.base[k])) (this.draft[k] as Settings[typeof k]) = now[k];
      this.base = { ...now };
    });
  }

  get value(): Readonly<Settings> {
    return this.draft;
  }

  /** Keys whose draft value differs from the applied value. */
  get dirtyKeys(): (keyof Settings)[] {
    const applied = this.store.value;
    return (Object.keys(this.draft) as (keyof Settings)[]).filter((k) => !sameSetting(k, this.draft[k], applied[k]));
  }

  get dirty(): boolean {
    return this.dirtyKeys.length > 0;
  }

  /** Edit one draft value (clamped/validated like stored settings). Does not touch the game. */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.draft = sanitizeSettings({ ...this.draft, [key]: value });
  }

  /** Draft := factory defaults. Still only a draft until apply(). */
  loadDefaults(): void {
    this.draft = { ...DEFAULT_SETTINGS };
  }

  /** Throw away every unapplied edit: the draft goes back to the applied settings. */
  discard(): void {
    this.base = { ...this.store.value };
    this.draft = { ...this.store.value };
  }

  /**
   * Validate the draft, hand it to the store (which applies the changed keys to the game in one notification and saves
   * them), and re-read the result. Returns the keys that changed.
   */
  apply(): (keyof Settings)[] {
    const changed = this.dirtyKeys;
    if (changed.length) this.store.update(sanitizeSettings(this.draft));
    this.discard();
    return changed;
  }

  dispose(): void {
    this.unsubscribe();
  }
}
