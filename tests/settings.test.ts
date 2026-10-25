import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from '../src/config/settings';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('settings', () => {
  it('persists changes and reloads them', () => {
    const storage = new MemoryStorage();
    const a = new SettingsStore(storage);
    a.update({ fov: 100, mouseSensitivity: 2.5, shadowQuality: 'high', showFps: false });
    const b = new SettingsStore(storage);
    expect(b.value.fov).toBe(100);
    expect(b.value.mouseSensitivity).toBe(2.5);
    expect(b.value.shadowQuality).toBe('high');
    expect(b.value.showFps).toBe(false);
  });

  it('clamps and rejects invalid values', () => {
    const s = sanitizeSettings({ fov: 300, masterVolume: -1, graphicsQuality: 'ultra', resolutionScale: 'x', invertY: 1 });
    expect(s.fov).toBe(110);
    expect(s.masterVolume).toBe(0);
    expect(s.graphicsQuality).toBe(DEFAULT_SETTINGS.graphicsQuality);
    expect(s.resolutionScale).toBe(DEFAULT_SETTINGS.resolutionScale);
    expect(s.invertY).toBe(false);
  });

  it('survives corrupted storage and missing storage', () => {
    const storage = new MemoryStorage();
    storage.setItem('crossfire.settings.v1', '{not json');
    expect(new SettingsStore(storage).value).toEqual(DEFAULT_SETTINGS);
    const noStorage = new SettingsStore(null);
    noStorage.update({ fov: 80 });
    expect(noStorage.value.fov).toBe(80);
  });

  it('notifies listeners with the changed keys only', () => {
    const s = new SettingsStore(new MemoryStorage());
    const seen: string[][] = [];
    s.onChange((_v, changed) => seen.push(changed));
    s.update({ fov: 95 });
    s.update({ fov: 95 });
    expect(seen).toEqual([['fov']]);
  });
});
