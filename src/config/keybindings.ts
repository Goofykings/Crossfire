/** Physical keyboard codes and mouse buttons; multiple defaults preserve existing controls. */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], slide: ['ShiftLeft', 'ShiftRight'], crouch: ['ControlLeft'], melee: ['KeyV'], grenade: ['KeyG'], aim: ['Mouse2', 'KeyK'], fire: ['Mouse0', 'KeyJ'], reload: ['KeyR'],
  leanLeft: ['KeyQ'], leanRight: ['KeyE'], leaderboard: ['Tab'], chat: ['Enter'], pause: ['Escape'],
  weapon1: ['Digit1', 'Numpad1'], weapon2: ['Digit2', 'Numpad2'], weapon3: ['Digit3', 'Numpad3'], weapon4: ['Digit4', 'Numpad4'], weapon5: ['Digit5', 'Numpad5'],
} as const;
export type BindableAction = keyof typeof DEFAULT_BINDINGS;
export type KeyBindings = Record<BindableAction, string[]>;
export const BINDING_LABELS: Record<BindableAction, string> = {
  forward: 'Move forward', back: 'Move backward', left: 'Move left', right: 'Move right', jump: 'Jump', slide: 'Slide',
  aim: 'Aim down sights', fire: 'Shoot / melee attack', reload: 'Reload', crouch: 'Hold to crouch', melee: 'Toggle dual daggers', grenade: 'Throw grenade', leanLeft: 'Lean left', leanRight: 'Lean right',
  leaderboard: 'Leaderboard', chat: 'Open chat', pause: 'Pause menu', weapon1: 'Weapon 1', weapon2: 'Weapon 2', weapon3: 'Weapon 3', weapon4: 'Weapon 4', weapon5: 'Weapon 5',
};
export const BINDABLE_ACTIONS = Object.keys(DEFAULT_BINDINGS) as BindableAction[];
export const defaultBindings = (): KeyBindings => Object.fromEntries(BINDABLE_ACTIONS.map((a) => [a, [...DEFAULT_BINDINGS[a]]])) as KeyBindings;
export const supportedBinding = (code: string) => /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Tab|Enter|Backspace|CapsLock|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Mouse[0-4]|Escape)$/.test(code);

export function sanitizeBindings(value: unknown): KeyBindings {
  const fallback = defaultBindings();
  if (!value || typeof value !== 'object') return fallback;
  const data = { ...value as Record<string, unknown> }, result = {} as KeyBindings, seen = new Set<string>();
  const oldActions = BINDABLE_ACTIONS.filter(a => a !== 'grenade' && a !== 'crouch' && a !== 'melee' && a !== 'weapon5');
  // Migrate only the complete former factory layout. A saved custom R grenade
  // (or any other customization) remains intentional; never steal its key.
  const formerDefault = BINDABLE_ACTIONS.filter(a=>a!=='melee'&&a!=='weapon5').every(a => JSON.stringify(data[a]) === JSON.stringify(
    a === 'grenade' ? ['KeyR'] : a === 'reload' ? ['KeyF'] : a === 'aim' ? ['Mouse2'] : a === 'fire' ? ['Mouse0'] : DEFAULT_BINDINGS[a]));
  if (formerDefault) return fallback;
  // Validate saved controls first. New actions must never steal a custom key.
  for (const action of oldActions) {
    const candidate = data[action];
    if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > 4
      || candidate.some((code) => typeof code !== 'string' || !supportedBinding(code) || (code === 'Escape' && action !== 'pause') || seen.has(code))) return fallback;
    result[action] = [...candidate];
    for (const code of candidate) { if (seen.has(code)) return fallback; seen.add(code); }
  }
  for (const action of ['grenade', 'crouch', 'melee', 'weapon5'] as const) {
    const candidate = data[action];
    if (candidate === undefined) {
      const choices = [...(action === 'weapon5' ? ['Digit5','Numpad5'] : action === 'melee' ? ['KeyV','KeyB','KeyN'] : action === 'grenade' ? ['KeyG','KeyH','KeyN','KeyB'] : ['ControlLeft','ControlRight','KeyC','KeyV','KeyZ']),
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
