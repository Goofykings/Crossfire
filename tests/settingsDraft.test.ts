import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/config/settings';
import { SettingsDraft } from '../src/config/settingsDraft';

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  writes = 0;
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
    this.writes++;
    this.data.set(k, v);
  }
}

function setup(initial: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const storage = new MemoryStorage();
  const store = new SettingsStore(storage);
  if (Object.keys(initial).length) store.update(initial);
  storage.writes = 0;
  const notifications: string[][] = [];
  store.onChange((_, changed) => notifications.push([...changed]));
  return { storage, store, draft: new SettingsDraft(store), notifications };
}

describe('settings draft (Apply / Back)', () => {
  it('starts equal to the applied settings and clean', () => {
    const { draft, store } = setup({ fov: 75 });
    expect(draft.value).toEqual(store.value);
    expect(draft.dirty).toBe(false);
  });

  it('edits touch only the draft: no notification, no save', () => {
    const { draft, store, storage, notifications } = setup({ fov: 75, masterVolume: 0.8 });
    draft.set('fov', 95);
    draft.set('masterVolume', 0.3);
    draft.set('shadowQuality', 'low');
    expect(draft.value.fov).toBe(95);
    expect(store.value.fov).toBe(75);
    expect(store.value.masterVolume).toBe(0.8);
    expect(store.value.shadowQuality).toBe('medium');
    expect(notifications).toEqual([]);
    expect(storage.writes).toBe(0);
    expect(draft.dirtyKeys.sort()).toEqual(['fov', 'masterVolume', 'shadowQuality']);
  });

  it('Back (discard) restores the applied values and saves nothing: the example from the brief', () => {
    const { draft, store, storage } = setup({ fov: 75, masterVolume: 0.8 });
    draft.set('fov', 95);
    draft.set('masterVolume', 0.3);
    draft.set('shadowQuality', 'low'); // after "switching category": the draft is one object
    draft.discard();
    expect(draft.value).toEqual(store.value);
    expect(draft.dirty).toBe(false);
    expect(store.value.fov).toBe(75);
    expect(store.value.masterVolume).toBe(0.8);
    expect(store.value.shadowQuality).toBe('medium');
    expect(storage.writes).toBe(0);
  });

  it('Apply commits every change at once, notifies once and saves', () => {
    const { draft, store, storage, notifications } = setup({ fov: 75, masterVolume: 0.8 });
    draft.set('fov', 95);
    draft.set('masterVolume', 0.3);
    draft.set('shadowQuality', 'low');
    const changed = draft.apply();
    expect(changed.sort()).toEqual(['fov', 'masterVolume', 'shadowQuality']);
    expect(store.value.fov).toBe(95);
    expect(store.value.masterVolume).toBe(0.3);
    expect(store.value.shadowQuality).toBe('low');
    expect(notifications).toEqual([expect.arrayContaining(['fov', 'masterVolume', 'shadowQuality'])]);
    expect(storage.writes).toBe(1);
    expect(new SettingsStore(storage).value.fov).toBe(95); // survives a "refresh"
    expect(draft.dirty).toBe(false);
  });

  it('edits after Apply stay uncommitted until Apply is pressed again', () => {
    const { draft, store, storage } = setup();
    draft.set('fov', 100);
    draft.apply();
    storage.writes = 0;
    draft.set('fov', 80);
    expect(store.value.fov).toBe(100);
    expect(draft.dirty).toBe(true);
    draft.discard();
    expect(draft.value.fov).toBe(100);
    expect(storage.writes).toBe(0);
  });

  it('Apply with nothing pending does nothing', () => {
    const { draft, storage, notifications } = setup();
    expect(draft.apply()).toEqual([]);
    expect(storage.writes).toBe(0);
    expect(notifications).toEqual([]);
  });

  it('an edit that is changed back is no longer dirty', () => {
    const { draft } = setup({ fov: 75 });
    draft.set('fov', 90);
    draft.set('fov', 75);
    expect(draft.dirty).toBe(false);
  });

  it('validates: out-of-range values are clamped before they can be applied', () => {
    const { draft, store } = setup();
    draft.set('fov', 500);
    draft.set('masterVolume', -3);
    expect(draft.value.fov).toBe(110);
    draft.apply();
    expect(store.value.fov).toBe(110);
    expect(store.value.masterVolume).toBe(0);
  });

  it('Defaults only fill the draft; they apply when Apply is pressed', () => {
    const { draft, store } = setup({ fov: 75, showFps: false });
    draft.loadDefaults();
    expect(draft.value).toEqual(DEFAULT_SETTINGS);
    expect(store.value.fov).toBe(75);
    draft.discard();
    expect(draft.value.fov).toBe(75);
    draft.loadDefaults();
    draft.apply();
    expect(store.value).toEqual(DEFAULT_SETTINGS);
  });

  it('follows applied changes made elsewhere (F3) for keys the player has not edited', () => {
    const { draft, store } = setup();
    draft.set('fov', 100);
    store.update({ showFps: false, fov: 85 });
    expect(draft.value.showFps).toBe(false); // untouched: follows
    expect(draft.value.fov).toBe(100); // edited: keeps the player's draft
  });

  it('never writes defaults over valid saved settings just by being created or discarded', () => {
    const storage = new MemoryStorage();
    new SettingsStore(storage).update({ fov: 99, shadowQuality: 'high' });
    storage.writes = 0;
    const store = new SettingsStore(storage);
    const draft = new SettingsDraft(store);
    draft.discard();
    draft.dispose();
    expect(storage.writes).toBe(0);
    expect(new SettingsStore(storage).value.fov).toBe(99);
  });
});
