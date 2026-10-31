import { describe, expect, it } from 'vitest';
import { bindingConflict, defaultBindings, sanitizeBindings, supportedBinding } from '../src/config/keybindings';
import { SettingsStore } from '../src/config/settings';
import { SettingsDraft } from '../src/config/settingsDraft';
import { parseClientMessage, parseServerMessage } from '../shared/protocol';

describe('custom controls', () => {
  it('defaults chat to Enter while retaining saved custom chat bindings', () => {
    expect(defaultBindings().chat).toEqual(['Enter']);
    expect(sanitizeBindings({ ...defaultBindings(), chat: ['KeyT'] }).chat).toEqual(['KeyT']);
  });
  it('keeps keyboard aim and mouse fire in the draft until Apply, and Back discards', () => {
    const store = new SettingsStore(null), draft = new SettingsDraft(store);
    const changed = { ...draft.value.keyBindings, aim: ['KeyF'], fire: ['Mouse0'] };
    draft.set('keyBindings', changed);
    expect(draft.dirtyKeys).toEqual(['keyBindings']);
    expect(store.value.keyBindings.aim).toEqual(['Mouse2']);
    draft.discard(); expect(draft.value.keyBindings.aim).toEqual(['Mouse2']);
    draft.set('keyBindings', changed); draft.apply();
    expect(store.value.keyBindings.aim).toEqual(['KeyF']);
    expect(store.value.keyBindings.fire).toEqual(['Mouse0']);
    expect(draft.dirty).toBe(false);
  });
  it('detects duplicate bindings and validates corrupt stored values', () => {
    const b = defaultBindings();
    expect(bindingConflict(b, 'aim', ['KeyW'])).toBe('forward');
    expect(bindingConflict(b, 'aim', ['KeyF'])).toBeUndefined();
    expect(sanitizeBindings({ ...b, aim: ['KeyW'] })).toEqual(defaultBindings());
    expect(sanitizeBindings({ ...b, aim: ['KeyF'] }).aim).toEqual(['KeyF']);
    expect(supportedBinding('KeyF')).toBe(true);
    expect(supportedBinding('Mouse2')).toBe(true);
    expect(supportedBinding('F3')).toBe(false);
  });
  it('preserves bindings alongside the other settings on storage round trips', () => {
    const data = new Map<string, string>();
    const storage: Storage = { get length() { return data.size; }, clear: () => data.clear(),
      key: (i) => [...data.keys()][i] ?? null, removeItem: (k) => { data.delete(k); },
      getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
    const store = new SettingsStore(storage);
    store.update({ fov: 95, keyBindings: { ...store.value.keyBindings, aim: ['KeyF'] } });
    const loaded = new SettingsStore(storage);
    expect(loaded.value.fov).toBe(95); expect(loaded.value.keyBindings.aim).toEqual(['KeyF']);
  });
  it('validates chat text and rejects client-supplied sender identities', () => {
    expect(parseClientMessage(JSON.stringify({ v: 9, type: 'chat', text: 'hello' }))).not.toBeNull();
    for (const text of ['', '  ', 'x'.repeat(201), 'bad\nline']) {
      expect(parseClientMessage(JSON.stringify({ v: 9, type: 'chat', text }))).toBeNull();
    }
    expect(parseClientMessage(JSON.stringify({ v: 9, type: 'chat', text: 'hi', name: 'forged' }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ v: 9, type: 'chat', id: 'id', name: 'Player', text: 'hello' }))).not.toBeNull();
  });
});
