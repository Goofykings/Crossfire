import { validWeapon } from '../../shared/protocol';

/** Original, flat silhouettes. These are UI artwork, not replacement weapon models. */
const profiles = {
  rifle: 'M4 12h18l8-6h24v4h28v3h33v4H80v4H57l-4 10H43l3-11H30l-8 6H4z M49 3h18v5H49z',
  shotgun: 'M3 17h22l12-5h44V9h34v5H82v6H45l-7 6H25l-6 5H3z M50 17h31v7H50z',
  sniper: 'M3 16h24l12-5h30v2h47v3H71v5H50l-5 9H35l4-10H25l-7 8H3z M43 3h28v7H43z M49 9h5v5h-5z M64 9h5v5h-5z M86 18h4l6 13h-4z',
  smg: 'M8 13h24V9h14V6h23v5h20v3h23v4H86v5H68l-2 9H55l2-11H45l-5 10H29l5-13H21v8H8z M49 3h20v4H49z',
} as const;

export function weaponIcon(weapon: unknown): string {
  if(weapon==='melee')return '<svg class="weapon-icon" viewBox="0 0 50 40" role="img" aria-label="Dual daggers"><path fill="currentColor" d="M5 2L25 23 23 26 2 5ZM45 2L25 23 27 26 48 5ZM18 26L23 21 30 28 25 33ZM32 26L27 21 20 28 25 33ZM24 32L20 36 17 33 21 29ZM26 32L30 36 33 33 29 29Z"/></svg>';
  if (weapon === 'grenade') return '<svg class="weapon-icon grenade-icon" data-weapon="grenade" viewBox="0 0 34 40" role="img" aria-label="Grenade"><path fill="currentColor" d="M12 8V4h10v5l5 6v6h-3l-3-8h-9zm-1 5h10l5 7-1 13-6 5h-7l-6-5-1-13z"/><circle cx="27" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  if (!validWeapon(weapon)) return '<span class="weapon-unknown" aria-label="Weapon unavailable">—</span>';
  const names = { rifle: 'Assault Rifle', shotgun: 'Shotgun', sniper: 'Sniper Rifle', smg: 'SMG' };
  return `<svg class="weapon-icon" data-weapon="${weapon}" viewBox="0 0 120 34" role="img" aria-label="${names[weapon]}"><path fill="currentColor" d="${profiles[weapon]}"/></svg>`;
}

export const CROSSFIRE_LOGO = `<span>CROSS</span><svg class="logo-symbol" viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor"><path transform="translate(32 32) rotate(-45)" d="M-29-5h13l5-3H4v3h14v2h12v4H17v3H3L0 14h-7l2-11h-9l-6 6h-9z M-8-12H5v5H-8z"/><path transform="translate(32 32) rotate(-135)" d="M-29-5h13l5-3H4v3h14v2h12v4H17v3H3L0 14h-7l2-11h-9l-6 6h-9z M-8-12H5v5H-8z"/></g></svg><span>FIRE</span>`;
