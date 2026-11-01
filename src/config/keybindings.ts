/** Physical keyboard codes and mouse buttons; multiple defaults preserve existing controls. */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], slide: ['ShiftLeft', 'ShiftRight'], crouch: ['ControlLeft'], grenade: ['KeyR'], aim: ['Mouse2'], fire: ['Mouse0'], reload: ['KeyF'],
  leanLeft: ['KeyQ'], leanRight: ['KeyE'], leaderboard: ['Tab'], chat: ['Enter'], pause: ['Escape'],
  weapon1: ['Digit1', 'Numpad1'], weapon2: ['Digit2', 'Numpad2'], weapon3: ['Digit3', 'Numpad3'], weapon4: ['Digit4', 'Numpad4'],
} as const;
export type BindableAction = keyof typeof DEFAULT_BINDINGS;
export type KeyBindings = Record<BindableAction, string[]>;
export const BINDING_LABELS: Record<BindableAction, string> = {
  forward: 'Move forward', back: 'Move backward', left: 'Move left', right: 'Move right', jump: 'Jump', slide: 'Slide',
  aim: 'Aim down sights', fire: 'Shoot', reload: 'Reload', crouch: 'Hold to crouch', grenade: 'Throw grenade', leanLeft: 'Lean left', leanRight: 'Lean right',
  leaderboard: 'Leaderboard', chat: 'Open chat', pause: 'Pause menu', weapon1: 'Weapon 1', weapon2: 'Weapon 2', weapon3: 'Weapon 3', weapon4: 'Weapon 4',
};
export const BINDABLE_ACTIONS = Object.keys(DEFAULT_BINDINGS) as BindableAction[];
export const defaultBindings = (): KeyBindings => Object.fromEntries(BINDABLE_ACTIONS.map((a) => [a, [...DEFAULT_BINDINGS[a]]])) as KeyBindings;
export const supportedBinding = (code: string) => /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Tab|Enter|Backspace|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Mouse[0-4]|Escape)$/.test(code);

export function sanitizeBindings(value: unknown): KeyBindings {
  const fallback = defaultBindings();
  if (!value || typeof value !== 'object') return fallback;
  const data = { ...value as Record<string, unknown> }, result = {} as KeyBindings, seen = new Set<string>();
  const legacy = data.grenade === undefined && data.crouch === undefined;
  const oldActions = BINDABLE_ACTIONS.filter(a => a !== 'grenade' && a !== 'crouch');
  const oldDefault = legacy && oldActions.every(a => JSON.stringify(data[a]) === JSON.stringify(a === 'reload' ? ['KeyR'] : DEFAULT_BINDINGS[a]));
  if (oldDefault) data.reload = ['KeyF'];
  // Validate saved controls first. New actions must never steal a custom key.
  for (const action of oldActions) {
    const candidate = data[action];
    if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > 4
      || candidate.some((code) => typeof code !== 'string' || !supportedBinding(code) || (code === 'Escape' && action !== 'pause') || seen.has(code))) return fallback;
    result[action] = [...candidate];
    for (const code of candidate) { if (seen.has(code)) return fallback; seen.add(code); }
  }
  for (const action of ['grenade', 'crouch'] as const) {
    const candidate = data[action];
    if (candidate === undefined) {
      const choices = [...(action === 'grenade' ? ['KeyR','KeyG','KeyH','KeyN','KeyB'] : ['ControlLeft','ControlRight','KeyC','KeyV','KeyZ']),
        ...Array.from({ length: 26 }, (_, n) => `Key${String.fromCharCode(65 + n)}`), 'Mouse3', 'Mouse4'];
      const code = choices.find(c => !seen.has(c));
      if (!code) return fallback;
      result[action] = [code]; seen.add(code);
    } else {
      if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > 4
        || candidate.some(c => typeof c !== 'string' || !supportedBinding(c) || c === 'Escape' || seen.has(c))) return fallback;
      result[action] = [...candidate];
      for (const code of candidate) { if (seen.has(code)) return fallback; seen.add(code); }
    }
  }
  return Object.fromEntries(BINDABLE_ACTIONS.map(a => [a, result[a]])) as KeyBindings;
}
export function bindingConflict(bindings: KeyBindings, action: BindableAction, codes: readonly string[]): BindableAction | undefined {
  return BINDABLE_ACTIONS.find((other) => other !== action && bindings[other].some((code) => codes.includes(code)));
}
export function bindingName(code: string): string {
  if (code.startsWith('Mouse')) return ['Mouse left', 'Mouse middle', 'Mouse right', 'Mouse 4', 'Mouse 5'][Number(code.slice(5))] ?? code;
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Numpad ').replace(/^Arrow/, 'Arrow ').replace(/(Left|Right)$/, ' $1');
}
export function isTextInput(target: EventTarget | null): boolean {
  return typeof HTMLElement !== 'undefined' && target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}
