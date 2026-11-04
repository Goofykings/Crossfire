import { LeaderboardPage } from './LeaderboardPage';
import { PowerupHud } from './PowerupHud';
import { readinessDeadline } from '../core/assetReadiness';
import { ChallengesPanel } from './ChallengesPanel';
import { assetUrl } from '../core/assets';
import { CrosshairMotion } from './CrosshairMotion';
import type { AudioManager } from '../audio/AudioManager';
import { SETTING_LIMITS, type Settings, type SettingsStore } from '../config/settings';
import { SettingsDraft } from '../config/settingsDraft';
import { BINDABLE_ACTIONS, BINDING_LABELS, DEFAULT_BINDINGS, bindingConflict, bindingName, defaultBindings, supportedBinding, type BindableAction } from '../config/keybindings';
import type { GuestProfileStore } from '../config/guestProfile';
import { normalizeUsername } from '../../shared/username';
import { Dropdown } from './Dropdown';
import { Scoreboard } from './Scoreboard';
import { CROSSFIRE_LOGO } from './WeaponIcons';
import { validWeapon } from '../../shared/protocol';
import type { WeaponId } from '../weapons/Weapon';
import { DamageFeedback } from './DamageFeedback';
import { CombatFeed } from './CombatFeed';
import { weaponIcon } from './WeaponIcons';
import { MatchHud } from './MatchHud';
import type { RoundResult } from '../../shared/scoring';
import { createRoundResults } from './RoundResults';
import type { PlayerTeam } from '../../shared/combat';

export type Screen = 'menu' | 'leaderboard' | 'loading' | 'start' | 'spectate' | 'results' | 'weapons' | 'hud' | 'pause' | 'settings' | 'error';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * DOM user interface: main menu, loading, click-to-play, HUD, pause and settings.
 * Plain HTML/CSS so it scales crisply at any resolution.
 */
/**
 * Sniper scope picture: everything outside a centred circle is black (with a soft edge), and inside a thin reticle
 * with mil-dots and thicker posts toward the edge. The viewBox is square; `preserveAspectRatio slice` keeps the circle
 * round on any screen while the outer rectangle covers the whole view.
 */
const scopeSvg = (id: string) => `<svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="${id}-edge" cx="0" cy="0" r="46" gradientUnits="userSpaceOnUse">
      <stop offset="0.9" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.985" stop-color="#000" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#000" stop-opacity="1"/>
    </radialGradient>

  </defs>
  <path fill="#000" fill-rule="evenodd" d="M-400-400H400V400H-400Z M46 0a46 46 0 1 0-92 0a46 46 0 1 0 92 0Z"/>
  <circle r="46" fill="url(#${id}-edge)"/>
  <g stroke="#080808" fill="#080808">
    <line x1="-46" y1="0" x2="46" y2="0" stroke-width="0.16"/>
    <line x1="0" y1="-46" x2="0" y2="46" stroke-width="0.16"/>
    <rect x="-46" y="-0.55" width="30" height="1.1" stroke="none"/>
    <rect x="16" y="-0.55" width="30" height="1.1" stroke="none"/>
    <rect x="-0.55" y="16" width="1.1" height="30" stroke="none"/>
    ${[-12, -9, -6, -3, 3, 6, 9, 12].map((d) => `<circle cx="${d}" cy="0" r="0.42" stroke="none"/><circle cx="0" cy="${d}" r="0.42" stroke="none"/>`).join('')}
  </g>
  <circle r="0.32" fill="#d22" />
</svg>`;

export class UI {
  private readonly crosshairMotion = new CrosshairMotion();
  private readonly screens = new Map<Screen, HTMLElement>();
  private settingsReturn: Screen = 'menu';
  private settingsFocus: HTMLElement | null = null;
  /** What the settings screen edits. The game only sees changes when Apply hands them to the SettingsStore. */
  private readonly draft: SettingsDraft;
  private usernameDraft: string;
  private usernameInput!: HTMLInputElement;
  private usernameRow!: HTMLElement;
  private guestDialog!: HTMLDialogElement;
  private guestSetup: Promise<void> | null = null;
  private finishGuestSetup: () => void = () => {};

  // callbacks set by the game
  onGrenade: (held: boolean, cancel?: boolean) => void = () => {};
  private chargeRing!: HTMLElement;
  onPlay: () => void = () => {};
  onStart: () => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onCancelLoading: () => void = () => {};
  onChatSend: (text: string) => boolean = () => false;
  onChatClose: () => void = () => {};
  chatOpen = false;
  private chatBox!: HTMLElement;
  private chatLog!: HTMLElement;
  private chatInput!: HTMLInputElement;
  private chatFeed!: HTMLElement;
  private pendingChat: HTMLElement[] = [];
  private chatHint!: HTMLElement;

  // HUD elements
  private crosshair!: HTMLElement;
  private hitmarker!: HTMLElement;
  powerupHud!: PowerupHud;
  private healthValue!: HTMLElement;
  private healthBar!: HTMLElement;
  private slideLines!: HTMLElement;
  private grenadeButton!: HTMLButtonElement;
  private ammoBox!: HTMLElement;
  private ammoValue!: HTMLElement;
  private ammoReserve!: HTMLElement;
  private reloadBar!: HTMLElement;
  private weaponSlots!: HTMLElement;
  private slotNames = '';
  private scope!: HTMLElement;
  private spectatorScope!: HTMLElement;
  private fpsBox!: HTMLElement;
  /** The FPS readout element (read by the debug API). */
  get fpsElement(): HTMLElement {
    return this.fpsBox;
  }
  private statsBox!: HTMLElement;
  private toast!: HTMLElement;
  private toastTimer = 0;
  private lockHint!: HTMLElement;
  private errorText!: HTMLElement;
  private errorActions!: HTMLElement;
  private weaponName!: HTMLElement;
  private mapTitle!: HTMLElement;
  private onlineCount!: HTMLElement;
  private homeHeader!: HTMLElement;
  private homeTabs: HTMLButtonElement[] = [];
  private selectedName!: HTMLElement;
  private selectedPreview!: HTMLImageElement;
  private spawnButton!: HTMLButtonElement;
  private respawnButton!: HTMLButtonElement;
  private spectateBy!: HTMLElement;
  private spectateName!: HTMLElement;
  private spectateWeapon!: HTMLElement;
  private spectateError!: HTMLElement;
  private spectateKiller: string | null | undefined;
  private spectateObservedWeapon: WeaponId | null | undefined;
  private spectateConnectionLost = false;
  private spectateBusy = false;
  private weaponSelectionReturn: 'start' | 'spectate' = 'start';
  private spawnError!: HTMLElement;
  private pendingWeapon: WeaponId = 'rifle';
  private readonly previews = new Map<WeaponId, string>();
  private readonly weaponCards = new Map<WeaponId, HTMLButtonElement>();
  private readonly labels: Record<WeaponId, string> = { smg: 'SMG', rifle: 'Assault Rifle', shotgun: 'Shotgun', sniper: 'Sniper Rifle' };
  currentScreen: Screen = 'menu';
  readonly scoreboard: Scoreboard;
  readonly damage: DamageFeedback;
  readonly combatFeed: CombatFeed;
  readonly matchHud: MatchHud;
  readonly challenges: ChallengesPanel;
  readonly leaderboard: LeaderboardPage;
  private resultBody!: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    settings: SettingsStore,
    private readonly audio: AudioManager,
    private readonly profile: GuestProfileStore,
  ) {
    this.draft = new SettingsDraft(settings);
    this.usernameDraft = profile.value.username;
    this.buildMenu();
    this.challenges = new ChallengesPanel(this.screens.get('menu')!);
    this.root.appendChild(this.challenges.account);
    this.leaderboard = new LeaderboardPage(this.screen('leaderboard'), () => this.show('menu'));
    this.buildLoading();
    try { const saved = localStorage.getItem('crossfire.pending-weapon'); if (validWeapon(saved)) this.pendingWeapon = saved; } catch { /* Optional preference. */ }
    this.buildStart();
    this.buildWeapons();
    this.buildSpectate();
    this.resultBody = this.screen('results');
    this.buildHud();
    this.setChatBinding(settings.value.keyBindings.chat[0]);
    this.buildPause();
    this.buildSettings();
    this.buildError();
    this.buildGuestPrompt();
    this.scoreboard = new Scoreboard(root);
    this.damage = new DamageFeedback(root);
    this.combatFeed = new CombatFeed(root);
    this.matchHud = new MatchHud(root);
  }

  private screen(id: Screen, cls = ''): HTMLElement {
    const s = el('div', `screen ${cls}`);
    s.id = id;
    this.root.appendChild(s);
    this.screens.set(id, s);
    return s;
  }

  showRoundResult(result: RoundResult, selfId: string, team: PlayerTeam, next: () => void, home: () => void): void {
    this.resultBody.replaceChildren(createRoundResults(result, selfId, team, next, home)); this.show('results');
  }

  private button(label: string, sub: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, `<span>${label}</span>${sub ? `<span class="sub">${sub}</span>` : ''}`);
    b.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.play('ui_click');
      onClick();
    });
    return b;
  }

  private buildGuestPrompt(): void {
    const dialog = el('dialog', 'guest-dialog');
    dialog.id = 'guest-profile';
    dialog.setAttribute('aria-labelledby', 'guest-heading');
    const form = el('form');
    form.noValidate = true;
    const heading = el('h2', '', 'Choose your username');
    heading.id = 'guest-heading';
    const input = this.usernameField('guest-username');
    const label = el('label', '', 'Username');
    label.htmlFor = input.id;
    const error = el('div', 'guest-error');
    error.id = 'guest-error';
    error.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', error.id);
    input.addEventListener('input', () => { error.textContent = ''; input.removeAttribute('aria-invalid'); });
    form.append(heading, label, input, error, this.button('Continue', '', 'primary', () => {}));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!this.profile.setUsername(input.value)) {
        error.textContent = 'Enter a username (1–24 characters).';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      this.usernameDraft = this.profile.value.username;
      this.syncSettings();
      dialog.close();
      this.finishGuestSetup();
      this.guestSetup = null;
      this.root.querySelector<HTMLButtonElement>('.home-actions button')?.focus();
    });
    // Keep first-visit setup keyboard accessible without dismissing it unnamed.
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.appendChild(form);
    this.root.appendChild(dialog);
    this.guestDialog = dialog;
  }

  ensureGuestProfile(): Promise<void> {
    if (this.profile.value.username) return Promise.resolve();
    if (this.guestSetup) return this.guestSetup;
    this.guestSetup = new Promise((resolve) => { this.finishGuestSetup = resolve; });
    this.guestDialog.showModal();
    this.guestDialog.querySelector<HTMLInputElement>('input')!.focus();
    return this.guestSetup;
  }

  private usernameField(id: string): HTMLInputElement {
    const input = el('input', 'username-input');
    input.type = 'text';
    input.id = id;
    input.maxLength = 48;
    input.setAttribute('autocomplete', 'nickname');
    input.spellcheck = false;
    input.required = true;
    return input;
  }

  // ---------------------------------------------------------------------------------------------
  private buildMenu(): void {
    const s = this.screen('menu');
    s.setAttribute('aria-label', 'Crossfire home');
    const background = el('img', 'home-backdrop');
    background.src = assetUrl('assets/ui/town-plaza.webp');
    background.alt = '';
    background.setAttribute('aria-hidden', 'true');
    const backdropFrame = el('div', 'home-backdrop-frame');
    backdropFrame.appendChild(background);
    const header = el('header', 'home-header');
    this.homeHeader = header;
    const logo = el('h1', 'logo', CROSSFIRE_LOGO);
    logo.setAttribute('aria-label', 'CROSSFIRE');
    header.appendChild(logo);
    const nav = el('nav', 'home-nav');
    nav.setAttribute('aria-label', 'Main navigation');
    this.homeTabs = [
      this.button('Play', '', 'nav-button', () => { if (this.currentScreen === 'settings') this.closeSettings(); else this.show('menu'); }),
      this.button('Settings', '', 'nav-button', () => { if (this.currentScreen !== 'settings') this.openSettings('menu'); }),
      this.button('Leaderboard', '', 'nav-button', () => { if (this.currentScreen === 'settings') this.closeSettings(); this.show('leaderboard'); }),
    ];
    nav.append(...this.homeTabs);
    header.appendChild(nav);
    const actions = el('div', 'home-actions');
    actions.appendChild(this.button('Play', '', 'primary', () => this.onPlay()));
    this.onlineCount = el('div', 'online-count', '0 Players Online');
    this.onlineCount.dataset.available = 'false';
    actions.appendChild(this.onlineCount);
    s.append(backdropFrame, actions);
    this.root.appendChild(header);
  }

  private buildLoading(): void {
    const s = this.screen('loading');
    s.setAttribute('role', 'status');
    s.setAttribute('aria-live', 'polite');
    const back = this.button('Back', '', 'loading-back', () => this.onCancelLoading());
    const progress = el('div', 'loading-progress');
    const spinner = el('span', 'loading-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    progress.append(spinner, el('div', 'loading-word', 'LOADING'), el('div', 'loading-status', 'Opening match'));
    s.append(back, progress);
  }

  setLoading(fraction: number, label: string): void {
    this.screens.get('loading')!.setAttribute('aria-busy', String(fraction < 1));
    this.screens.get('loading')!.querySelector('.loading-status')!.textContent = label;
  }

  private buildStart(): void {
    const s = this.screen('start');
    const card = el('div', 'prespawn');
    card.appendChild(this.button('Switch Gun', '', '', () => { this.weaponSelectionReturn = 'start'; this.show('weapons'); }));
    this.selectedPreview = el('img', 'selected-preview');
    this.selectedPreview.alt = '';
    this.selectedPreview.hidden = true;
    this.selectedName = el('div', 'selected-name', this.labels[this.pendingWeapon]);
    card.append(this.selectedPreview, this.selectedName);
    card.appendChild(this.button('Settings', '', '', () => this.openSettings('start')));
    this.spawnButton = this.button('Spawn', '', 'primary', () => this.onStart());
    this.spawnError = el('div', 'spawn-error');
    this.spawnError.setAttribute('role', 'status');
    card.append(this.spawnButton, this.spawnError);
    s.appendChild(card);
  }

  private buildWeapons(): void {
    const s = this.screen('weapons');
    s.setAttribute('aria-label', 'Select weapon');
    const head = el('div', 'weapon-select-head');
    head.append(el('h2', '', 'Loadout'), this.button('Back', '', 'weapon-back', () => {
      if (this.weaponSelectionReturn === 'spectate') this.show('spectate');
      else this.onQuit();
    }));
    const grid = el('div', 'weapon-grid');
    for (const id of ['smg', 'rifle', 'sniper', 'shotgun'] as const) {
      const card = this.button(this.labels[id], '', 'weapon-card', () => {
        this.pendingWeapon = id;
        try { localStorage.setItem('crossfire.pending-weapon', id); } catch { /* Optional preference. */ }
        this.refreshSelection();
        if (this.weaponSelectionReturn === 'spectate') this.show('spectate');
        else this.onStart();
      });
      card.dataset.weapon = id;
      card.prepend(el('div', 'weapon-art'));
      this.weaponCards.set(id, card);
      grid.appendChild(card);
    }
    const status = el('div', 'spawn-error weapon-spawn-error');
    status.setAttribute('role', 'status');
    s.append(head, grid, status);
    this.refreshSelection();
  }

  get selectedWeapon(): WeaponId { return this.pendingWeapon; }
  openWeaponSelection(): void { this.weaponSelectionReturn = 'start'; this.show('weapons'); }
  get spawnPending(): boolean { return this.spawnButton.disabled; }

  private refreshSelection(): void {
    if (this.spectateWeapon) this.spectateWeapon.innerHTML = `<small>NEXT SPAWN</small><span>${this.labels[this.pendingWeapon]}</span>${weaponIcon(this.pendingWeapon)}`;
    this.selectedName.textContent = this.labels[this.pendingWeapon];
    const url = this.previews.get(this.pendingWeapon);
    this.selectedPreview.hidden = !url;
    if (url) this.selectedPreview.src = url;
    for (const [id, card] of this.weaponCards) {
      card.classList.toggle('selected', id === this.pendingWeapon);
      card.setAttribute('aria-pressed', String(id === this.pendingWeapon));
    }
  }

  private buildSpectate(): void {
    const s = this.screen('spectate');
    this.spectatorScope = el('div', 'scope', scopeSvg('spectator'));
    s.appendChild(this.spectatorScope);
    this.spectateBy = el('div', 'spectate-by');
    const bottom = el('div', 'spectate-bottom');
    this.spectateName = el('div', 'spectate-name');
    this.respawnButton = this.button('RESPAWN', '', 'primary respawn-button', () => this.onStart());
    this.respawnButton.disabled = true;
    this.spectateError = el('div', 'spectate-error'); this.spectateError.setAttribute('role', 'status');
    bottom.append(this.spectateName, this.respawnButton, this.spectateError);
    const controls = el('div', 'spectate-controls');
    this.spectateWeapon = el('div', 'spectate-weapon');
    controls.append(this.spectateWeapon,
      this.button('SWITCH WEAPON', '', '', () => { this.weaponSelectionReturn = 'spectate'; this.show('weapons'); }),
      this.button('SETTINGS', '', '', () => this.openSettings('spectate')),
      this.button('LEAVE MATCH', '', 'leave-match', () => this.onQuit()));
    s.append(this.spectateBy, bottom, controls);
    this.refreshSelection();
  }

  setSpectate(name: string | null, remainingMs: number, connected: boolean, weapon: WeaponId | null = null): void {
    if (name !== this.spectateKiller || weapon !== this.spectateObservedWeapon) {
      this.spectateKiller = name;
      this.spectateObservedWeapon = weapon;
      const heading = el('strong'); heading.textContent = 'ELIMINATED BY';
      const player = el('span'); player.textContent = name ?? 'Environment';
      this.spectateBy.replaceChildren(heading, player);
      this.spectateName.textContent = name ? `Spectating: ${name}${weapon ? ` · ${this.labels[weapon]}` : ''}` : 'Spectating: unavailable';
    }
    if (!connected) { this.spectateConnectionLost = true; this.spectateError.textContent = 'Reconnecting…'; }
    else if (this.spectateConnectionLost) { this.spectateConnectionLost = false; this.spectateError.textContent = ''; }
    this.respawnButton.disabled = !connected || this.spectateBusy || remainingMs > 0;
    this.respawnButton.firstElementChild!.textContent = remainingMs > 0 ? `RESPAWN  ${Math.ceil(remainingMs / 1000)}` : 'RESPAWN';
  }
  setRespawnBusy(busy: boolean, error = ''): void {
    this.spectateBusy = busy; this.spectateError.textContent = error;
    if (busy) this.respawnButton.disabled = true;
  }

  async setWeaponPreview(id: WeaponId, url: string, signal?: AbortSignal): Promise<void> {
    const img = el('img');
    img.src = url;
    img.alt = this.labels[id];
    await readinessDeadline(img.decode().catch(() => { throw new Error(`Weapon preview failed: ${id}`); }), signal, `Weapon preview timed out: ${id}`);
    signal?.throwIfAborted();
    this.previews.set(id, url);
    this.weaponCards.get(id)?.querySelector('.weapon-art')?.replaceChildren(img);
    this.refreshSelection();
  }

  setSpawnState(respawn: boolean, busy = false, error = ''): void {
    this.spawnButton.firstElementChild!.textContent = respawn ? 'Respawn' : 'Spawn';
    for (const button of this.screens.get('start')!.querySelectorAll('button')) button.disabled = busy;
    this.spawnError.textContent = error;
    if (this.weaponSelectionReturn === 'start') {
      for (const button of this.weaponCards.values()) button.disabled = busy;
      this.screens.get('weapons')!.querySelector('.weapon-spawn-error')!.textContent = busy ? 'Spawning…' : error;
    }
  }

  setOnline(count: number | null): void {
    const available = count !== null && Number.isSafeInteger(count) && count >= 0 && count <= 16;
    this.onlineCount.dataset.available = String(available);
    const display = available ? count : 0;
    this.onlineCount.textContent = `${display} ${display === 1 ? 'Player' : 'Players'} Online`;
  }

  private buildHud(): void {
    const s = this.screen('hud');
    this.slideLines = el('div', 'slide-lines');
    this.slideLines.setAttribute('aria-hidden', 'true');
    // A fixed set of lightweight streaks; only compositor transforms animate.
    for (let i = 0; i < 28; i++) {
      const line = el('i');
      line.style.setProperty('--angle', `${i * 360 / 28 + (i % 3) * 1.3}deg`);
      line.style.setProperty('--length', `${4 + i % 5}vmin`);
      line.style.setProperty('--streak-opacity', String(.35 + (i % 5) * .08));
      line.style.setProperty('--duration', `${.65 + (i % 4) * .075}s`);
      line.style.setProperty('--delay', `${-i * .073}s`);
      this.slideLines.appendChild(line);
    }
    s.appendChild(this.slideLines);
    const ch = el('div', 'crosshair', '<i class="h l"></i><i class="h r"></i><i class="v t"></i><i class="v b"></i><i class="dot"></i>');
    this.crosshair = ch;
    s.appendChild(ch);
    this.chargeRing = el('div', 'grenade-charge', '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" pathLength="100"/></svg>');
    this.chargeRing.setAttribute('aria-hidden', 'true'); s.appendChild(this.chargeRing);
    this.hitmarker = el('div', 'hitmarker', '<i></i><i></i><i></i><i></i>');
    s.appendChild(this.hitmarker);
    const tl = el('div', 'hud-tl');
    this.mapTitle = el('div', 'hud-map', `European Town<small>Practice</small>`);
    tl.appendChild(this.mapTitle);
    s.appendChild(tl);
    const tr = el('div', 'hud-tr');
    this.fpsBox = el('div');
    this.statsBox = el('div');
    tr.appendChild(this.fpsBox);
    tr.appendChild(this.statsBox);
    s.appendChild(tr);
    const bl = el('div', 'hud-bl');
    this.powerupHud=new PowerupHud(bl);
    const health = el('div', 'health');
    health.appendChild(el('div', 'cross'));
    const hcol = el('div');
    this.healthValue = el('div', 'value', '100');
    const bar = el('div', 'bar');
    this.healthBar = el('div');
    bar.appendChild(this.healthBar);
    hcol.appendChild(this.healthValue);
    hcol.appendChild(bar);
    health.appendChild(hcol);
    bl.appendChild(health);
    s.appendChild(bl);
    const br = el('div', 'hud-br');
    this.ammoBox = el('div', 'ammo');
    this.ammoValue = el('div', 'value', '30');
    this.ammoReserve = el('div', 'reserve', '/ &infin;');
    this.ammoBox.appendChild(this.ammoValue);
    this.ammoBox.appendChild(this.ammoReserve);
    this.weaponName = el('div', 'weapon-name', '');
    this.reloadBar = el('div', 'reload-bar');
    this.reloadBar.appendChild(el('div'));
    this.weaponSlots = el('div', 'weapon-slots');
    const ammoRow = el('div', 'combat-ammo-row');
    this.grenadeButton = el('button', 'grenade-count'); this.grenadeButton.type = 'button';
    this.grenadeButton.innerHTML = weaponIcon('grenade') + '<span>0</span>';
    this.grenadeButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.grenadeButton.title = 'Hold to charge; release to throw';
    this.grenadeButton.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.grenadeButton.disabled) return;
      e.preventDefault(); this.grenadeButton.setPointerCapture(e.pointerId); this.onGrenade(true);
    });
    this.grenadeButton.addEventListener('pointerup', () => this.onGrenade(false));
    this.grenadeButton.addEventListener('pointercancel', () => this.onGrenade(false, true));
    this.grenadeButton.addEventListener('lostpointercapture', () => this.onGrenade(false));
    this.grenadeButton.addEventListener('click', (e) => { if (e.detail === 0) { this.onGrenade(true); this.onGrenade(false); } });
    ammoRow.append(this.grenadeButton, this.ammoBox); br.appendChild(ammoRow);
    br.appendChild(this.reloadBar);
    br.appendChild(this.weaponName);
    br.appendChild(this.weaponSlots);
    s.appendChild(br);
    // sniper scope: black surround, the round field of view with a mil-dot reticle (SVG, crisp at any resolution)
    this.scope = el('div', 'scope', scopeSvg('local'));
    s.insertBefore(this.scope, s.firstChild);
    this.toast = el('div', 'toast');
    s.appendChild(this.toast);
    this.lockHint = el('div', 'lock-hint', 'Click to capture the mouse');
    s.appendChild(this.lockHint);
    this.chatHint = el('div', 'chat-hint');
    this.chatFeed = el('div', 'chat-feed');
    this.chatFeed.setAttribute('aria-live', 'polite');
    s.append(this.chatHint, this.chatFeed);
    this.chatBox = el('div', 'match-chat'); this.chatBox.hidden = true;
    this.chatLog = el('div', 'chat-log'); this.chatLog.setAttribute('aria-live', 'polite');
    const form = el('form', 'chat-form');
    this.chatInput = el('input'); this.chatInput.maxLength = 200; this.chatInput.placeholder = 'Message';
    this.chatInput.setAttribute('aria-label', 'Chat message'); this.chatInput.autocomplete = 'off';
    form.appendChild(this.chatInput);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (text && !this.onChatSend(text)) { this.showToast('Chat is not connected', 'warn'); return; }
      this.closeChat();
    });
    this.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeChat(); } });
    this.chatBox.append(this.chatLog, form); s.appendChild(this.chatBox);

  }

  private buildPause(): void {
    const s = this.screen('pause');
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'Paused'));
    const b = el('div', 'menu-buttons');
    b.appendChild(this.button('Resume', '', 'primary', () => this.onResume()));
    b.appendChild(
      this.button('Settings', '', '', () => this.openSettings('pause')),
    );
    b.appendChild(this.button('Leave Match', '', 'leave-match', () => this.onQuit()));
    card.appendChild(b);
    s.appendChild(card);
  }

  private buildError(): void {
    const s = this.screen('error');
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'Something went wrong'));
    this.errorText = el('p');
    card.appendChild(this.errorText);
    this.errorActions = el('div', 'menu-buttons');
    this.errorActions.hidden = true;
    card.appendChild(this.errorActions);
    s.appendChild(card);
  }

  showError(message: string): void {
    this.errorActions.replaceChildren();
    this.errorActions.hidden = true;
    this.errorText.textContent = message;
    this.show('error');
  }

  showConnectionError(message: string, retry: () => void, back: () => void): void {
    this.showError(message);
    this.errorActions.hidden = false;
    this.errorActions.append(this.button('Retry', '', 'primary', retry), this.button('Back', '', '', back));
  }

  // --- settings --------------------------------------------------------------------------------
  private readonly settingSyncs: (() => void)[] = [];
  private settingTabs: { key: string; tab: HTMLButtonElement; panel: HTMLElement; keys: (keyof Settings)[] }[] = [];
  private settingRows = new Map<keyof Settings, HTMLElement>();
  private applyButton!: HTMLButtonElement;
  private dirtyPill!: HTMLElement;
  private settingsStatus!: HTMLElement;
  private statusTimer = 0;
  private rebinding: BindableAction | null = null;
  private suppressBindingClick = false;

  /** Open the settings screen from the main menu or the pause menu; edits start from the applied settings. */
  private openSettings(from: Screen): void {
    this.settingsFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.settingsReturn = from;
    this.draft.discard();
    this.usernameDraft = this.profile.value.username;
    this.usernameInput.setCustomValidity('');
    this.selectSettingsTab(0, false);
    this.setSettingsStatus('');
    this.show('settings', from === 'pause');
    this.settingTabs[0]?.tab.focus();
  }

  /** Back: drop every unapplied edit and return to where settings were opened from. */
  private closeSettings(): void {
    this.rebinding = null;
    this.draft.discard();
    this.usernameDraft = this.profile.value.username;
    this.usernameInput.setCustomValidity('');
    this.show(this.settingsReturn, this.settingsReturn === 'pause');
    this.settingsFocus?.focus();
  }

  private applySettings(): void {
    const rename = this.usernameDraft !== this.profile.value.username;
    if (!this.draft.dirty && !rename) return;
    if (rename && !normalizeUsername(this.usernameDraft)) {
      this.setSettingsStatus('Enter a username (1–24 characters).');
      this.usernameInput.setCustomValidity('Enter a username.');
      this.usernameInput.reportValidity();
      return;
    }
    if (rename) this.profile.setUsername(this.usernameDraft);
    this.usernameDraft = this.profile.value.username;
    const changed = this.draft.apply();
    this.syncSettings();
    const count = changed.length + Number(rename);
    this.setSettingsStatus(`Applied ${count} change${count === 1 ? '' : 's'}`, true);
  }

  private setSettingsStatus(text: string, flash = false): void {
    window.clearTimeout(this.statusTimer);
    this.settingsStatus.textContent = text;
    this.settingsStatus.classList.toggle('ok', flash);
    if (flash) this.statusTimer = window.setTimeout(() => (this.settingsStatus.textContent = ''), 2600);
  }

  private buildSettings(): void {
    const s = this.screen('settings');
    const card = el('div', 'card settings-card');
    const head = el('div', 'settings-head');
    head.appendChild(el('h2', '', 'Settings'));
    this.dirtyPill = el('span', 'pill', 'Unapplied changes');
    this.dirtyPill.hidden = true;
    head.appendChild(this.dirtyPill);
    card.appendChild(head);

    const body = el('div', 'settings-body');
    const tabs = el('div', 'settings-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Settings categories');
    const panels = el('div', 'settings-panels');
    body.append(tabs, panels);
    card.appendChild(body);

    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const categories: { key: string; title: string; rows: [keyof Settings, HTMLElement][] }[] = [
      {
        key: 'gameplay',
        title: 'Gameplay',
        rows: [
          ['mouseSensitivity', this.rangeRow('mouseSensitivity', 'Mouse sensitivity', 0.05, (x) => x.toFixed(2))],
          ['invertY', this.toggleRow('invertY', 'Invert vertical look')],
          ['fov', this.rangeRow('fov', 'Field of view', 1, (x) => `${Math.round(x)}°`)],
        ],
      },
      { key: 'controls', title: 'Controls', rows: [] },
      {
        key: 'sound',
        title: 'Sound',
        rows: [['masterVolume', this.rangeRow('masterVolume', 'Master volume', 0.01, pct)],
            ['sfxVolume', this.rangeRow('sfxVolume', 'Sound effects', 0.01, pct)]],
      },
      {
        key: 'graphics',
        title: 'Graphics',
        rows: [
          [
            'graphicsQuality',
            this.selectRow('graphicsQuality', 'Graphics quality', [
              ['low', 'Low'],
              ['medium', 'Medium'],
              ['high', 'High'],
              ['ultra', 'Ultra'],
            ]),
          ],
          [
            'shadowQuality',
            this.selectRow('shadowQuality', 'Shadow quality', [
              ['off', 'Off'],
              ['low', 'Low'],
              ['medium', 'Medium'],
              ['high', 'High'],
            ]),
          ],
          ['resolutionScale', this.rangeRow('resolutionScale', 'Resolution scale', 0.05, pct)],
          ['showFps', this.toggleRow('showFps', 'Show FPS counter')],
          ['reducedEffects', this.toggleRow('reducedEffects', 'Reduced smoke particles')],
        ],
      },
    ];
    for (const c of categories) {
      const tab = el('button', 'tab', `<span>${c.title}</span><i class="dot" aria-hidden="true"></i>`);
      tab.type = 'button';
      tab.id = `tab-${c.key}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `panel-${c.key}`);
      const panel = el('section', 'settings-panel');
      panel.id = `panel-${c.key}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      if (c.key === 'gameplay') panel.appendChild(this.buildUsernameSetting());
      for (const [key, row] of c.rows) {
        panel.appendChild(row);
        this.settingRows.set(key, row);
      }
      if (c.key === 'controls') panel.appendChild(this.buildControls());
      panel.tabIndex = 0;
      const index = this.settingTabs.length;
      tab.addEventListener('click', () => this.selectSettingsTab(index, false));
      tab.addEventListener('keydown', (e) => {
        const n = categories.length;
        const move = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[e.key];
        if (move !== undefined) this.selectSettingsTab((index + move + n) % n, true);
        else if (e.key === 'Home') this.selectSettingsTab(0, true);
        else if (e.key === 'End') this.selectSettingsTab(n - 1, true);
        else return;
        e.preventDefault();
      });
      tabs.appendChild(tab);
      panels.appendChild(panel);
      this.settingTabs.push({ key: c.key, tab, panel, keys: [...c.rows.map(([k]) => k), ...(c.key === 'controls' ? ['keyBindings' as const] : [])] });
    }

    const foot = el('div', 'settings-foot');
    foot.appendChild(
      this.button('Defaults', '', 'ghost', () => {
        this.draft.loadDefaults();
        this.syncSettings();
        this.setSettingsStatus('Defaults loaded: press Apply to keep them');
      }),
    );
    this.settingsStatus = el('div', 'settings-status');
    this.settingsStatus.setAttribute('role', 'status');
    foot.appendChild(this.settingsStatus);
    foot.appendChild(this.button('Back', '', '', () => this.closeSettings()));
    this.applyButton = this.button('Apply', '', 'primary', () => this.applySettings());
    foot.appendChild(this.applyButton);
    card.appendChild(foot);
    s.appendChild(card);

    // Escape goes back (an open dropdown swallows it first)
    s.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeSettings();
      }
    });
    this.selectSettingsTab(0, false);
    this.syncSettings();
  }

  private buildControls(): HTMLElement {
    const section = el('div', 'control-settings');
    section.appendChild(el('h3', '', 'Controls'));
    const finish = (code: string) => {
      const action = this.rebinding;
      if (!action) return;
      if (code === 'Escape') { this.rebinding = null; this.syncSettings(); return; }
      if (!supportedBinding(code)) { this.setSettingsStatus('That key cannot be used. Press another key or Escape.'); return; }
      const conflict = bindingConflict(this.draft.value.keyBindings, action, [code]);
      if (conflict) { this.setSettingsStatus(`${bindingName(code)} is already used by ${BINDING_LABELS[conflict]}.`); return; }
      this.draft.set('keyBindings', { ...this.draft.value.keyBindings, [action]: [code] });
      this.rebinding = null;
      this.setSettingsStatus('');
      this.syncSettings();
    };
    window.addEventListener('keydown', (e) => {
      if (!this.rebinding || this.currentScreen !== 'settings') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) finish(e.code);
    }, true);
    window.addEventListener('mousedown', (e) => {
      if (!this.rebinding || this.currentScreen !== 'settings') return;
      e.preventDefault(); e.stopImmediatePropagation();
      // Only a primary mouse down is followed by a normal click. Do not block
      // the player's next intentional click after binding another button.
      this.suppressBindingClick = e.button === 0;
      if (this.suppressBindingClick) window.setTimeout(() => { this.suppressBindingClick = false; }, 500);
      finish(`Mouse${e.button}`);
    }, true);
    window.addEventListener('click', (e) => {
      if (!this.suppressBindingClick) return;
      this.suppressBindingClick = false; e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    for (const action of BINDABLE_ACTIONS) {
      const row = el('div', 'control-row');
      const label = el('span', '', BINDING_LABELS[action]);
      const bind = el('button', 'control-bind'); bind.type = 'button';
      bind.setAttribute('aria-label', `Rebind ${BINDING_LABELS[action]}`);
      bind.addEventListener('click', () => { this.rebinding = action; this.setSettingsStatus('Press a key or mouse button. Escape cancels.'); this.syncSettings(); });
      const reset = el('button', 'control-reset', 'Reset'); reset.type = 'button';
      reset.setAttribute('aria-label', `Reset ${BINDING_LABELS[action]}`);
      reset.addEventListener('click', () => {
        const codes = [...DEFAULT_BINDINGS[action]];
        const conflict = bindingConflict(this.draft.value.keyBindings, action, codes);
        if (conflict) { this.setSettingsStatus(`Reset conflicts with ${BINDING_LABELS[conflict]}. Reset that control first.`); return; }
        this.draft.set('keyBindings', { ...this.draft.value.keyBindings, [action]: codes });
        this.syncSettings();
      });
      this.settingSyncs.push(() => { bind.textContent = this.rebinding === action ? 'Press a key' : this.draft.value.keyBindings[action].map(bindingName).join(' / '); });
      row.append(label, bind, reset); section.appendChild(row);
    }
    const resetAll = el('button', 'control-reset-all', 'Reset controls'); resetAll.type = 'button';
    resetAll.addEventListener('click', () => { this.rebinding = null; this.draft.set('keyBindings', defaultBindings()); this.syncSettings(); });
    section.appendChild(resetAll);
    return section;
  }

  private selectSettingsTab(index: number, focus: boolean): void {
    this.settingTabs.forEach((t, i) => {
      const on = i === index;
      t.tab.setAttribute('aria-selected', String(on));
      t.tab.tabIndex = on ? 0 : -1;
      t.tab.classList.toggle('selected', on);
      t.panel.hidden = !on;
      if (on && focus) t.tab.focus();
    });
  }

  private buildUsernameSetting(): HTMLElement {
    const { row, lab } = this.settingRow('Username', 'set-username');
    row.classList.add('profile-setting');
    this.usernameRow = row;
    this.usernameInput = this.usernameField('set-username');
    this.usernameInput.addEventListener('input', () => {
      this.usernameDraft = this.usernameInput.value;
      this.usernameInput.setCustomValidity('');
      this.syncSettings();
    });
    const note = el('small', 'profile-note', 'Used on your next join.');
    note.id = 'username-note';
    this.usernameInput.setAttribute('aria-describedby', note.id);
    row.append(lab, this.usernameInput, el('output'), note);
    return row;
  }

  /** Push the draft into every control and refresh the "unapplied" markers. */
  private syncSettings(): void {
    for (const f of this.settingSyncs) f();
    const dirty = new Set(this.draft.dirtyKeys);
    const rename = this.usernameDraft !== this.profile.value.username;
    if (this.usernameInput.value !== this.usernameDraft) this.usernameInput.value = this.usernameDraft;
    this.usernameRow.classList.toggle('changed', rename);
    for (const [key, row] of this.settingRows) row.classList.toggle('changed', dirty.has(key));
    for (const t of this.settingTabs) t.tab.classList.toggle('changed', t.keys.some((k) => dirty.has(k)) || (t.key === 'gameplay' && rename));
    this.dirtyPill.hidden = dirty.size === 0 && !rename;
    this.applyButton.setAttribute('aria-disabled', String(dirty.size === 0 && !rename));
    this.applyButton.classList.toggle('inactive', dirty.size === 0 && !rename);
    if ((dirty.size || rename) && this.settingsStatus.classList.contains('ok')) this.setSettingsStatus('');
  }

  private settingRow(label: string, forId: string): { row: HTMLElement; lab: HTMLLabelElement } {
    const row = el('div', 'setting');
    const lab = el('label', '', label);
    lab.htmlFor = forId;
    lab.id = `${forId}-label`;
    return { row, lab };
  }

  private rangeRow(key: keyof typeof SETTING_LIMITS, label: string, step: number, fmt: (v: number) => string): HTMLElement {
    const id = `set-${key}`;
    const { row, lab } = this.settingRow(label, id);
    const [lo, hi] = SETTING_LIMITS[key];
    const input = el('input');
    input.type = 'range';
    input.id = id;
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(step);
    const out = el('output');
    const sync = () => {
      const val = this.draft.value[key];
      input.value = String(val);
      input.style.setProperty('--fill', `${((val - lo) / (hi - lo)) * 100}%`);
      input.setAttribute('aria-valuetext', fmt(val));
      out.textContent = fmt(val);
    };
    input.addEventListener('input', () => {
      this.draft.set(key, Number(input.value));
      this.syncSettings();
    });
    this.settingSyncs.push(sync);
    row.append(lab, input, out);
    return row;
  }

  private toggleRow(key: 'invertY' | 'showFps' | 'reducedEffects', label: string): HTMLElement {
    const id = `set-${key}`;
    const { row, lab } = this.settingRow(label, id);
    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('role', 'switch');
    const out = el('output');
    const sync = () => {
      input.checked = this.draft.value[key];
      out.textContent = input.checked ? 'On' : 'Off';
    };
    input.addEventListener('change', () => {
      this.draft.set(key, input.checked);
      this.syncSettings();
    });
    this.settingSyncs.push(sync);
    row.append(lab, input, out);
    return row;
  }

  private selectRow(key: 'graphicsQuality' | 'shadowQuality', label: string, options: [string, string][]): HTMLElement {
    const id = `set-${key}`;
    const { row, lab } = this.settingRow(label, id);
    const dd = new Dropdown(
      id,
      options,
      (value) => {
        this.draft.set(key, value as Settings[typeof key]);
        this.syncSettings();
      },
      lab.id,
    );
    // the combobox is a button, labelled through aria-labelledby; clicking the label focuses it
    lab.removeAttribute('for');
    lab.addEventListener('click', () => dd.focus());
    this.settingSyncs.push(() => (dd.value = this.draft.value[key]));
    row.append(lab, dd.root, el('output'));
    return row;
  }

  // ---------------------------------------------------------------------------------------------
  show(screen: Screen, overlayHud = false): void {
    if (screen !== 'hud') {
      this.setSlideEffect(false, 0, 0);
      this.chatOpen = false; this.chatBox.hidden = true; this.chatInput.blur();
    }
    if (screen === 'menu' || screen === 'loading' || screen === 'error') this.damage?.clear();
    if (screen === 'menu' || screen === 'error') {
      this.pendingChat.length = 0;
      this.chatLog.replaceChildren(); this.chatFeed.replaceChildren();
    }
    this.currentScreen = screen;
    document.body.dataset.screen = screen;
    const homeSettings = screen === 'settings' && this.settingsReturn === 'menu';
    const ranking = screen === 'leaderboard';
    const home = screen === 'menu' || homeSettings;
    document.body.dataset.homePage = ranking ? 'leaderboard' : homeSettings ? 'settings' : home ? 'play' : '';
    this.homeHeader.hidden = !home;
    this.challenges.account.hidden = screen !== 'menu';
    this.homeHeader.dataset.page = ranking ? 'leaderboard' : homeSettings ? 'settings' : 'play';
    this.homeTabs.forEach((tab, i) => {
      if (i === (ranking ? 2 : homeSettings ? 1 : 0)) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    if (ranking) this.leaderboard.show(); else this.leaderboard.hide();
    this.screens.get('settings')!.classList.toggle('home-settings', homeSettings);
    this.screens.get('menu')!.inert = homeSettings;
    this.screens.get('menu')!.setAttribute('aria-hidden', String(homeSettings || !home));
    this.scoreboard?.setVisible(false);
    for (const [id, s] of this.screens) {
      s.classList.toggle('visible', id === screen || (overlayHud && id === 'hud') || (homeSettings && id === 'menu'));
    }
    if (screen === 'hud') for (const message of this.pendingChat.splice(0)) this.displayChat(message);
    if (screen === 'settings') this.syncSettings();
  }

  setMapTitle(name: string, sub: string): void {
    this.mapTitle.innerHTML = `${name}<small>${sub}</small>`;
  }

  openChat(): void { this.chatOpen = true; this.chatBox.hidden = false; this.chatInput.value = ''; this.chatInput.focus(); }
  setChatBinding(code: string): void {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 20 20'); icon.setAttribute('aria-hidden', 'true');
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outline.setAttribute('d', 'M3 3.5h14v10H9l-4 3v-3H3z');
    icon.appendChild(outline);
    this.chatHint.replaceChildren(icon, document.createTextNode(`Press ${bindingName(code)} to Chat`));
  }
  closeChat(): void {
    if (!this.chatOpen) return;
    this.chatOpen = false; this.chatBox.hidden = true; this.chatInput.blur(); this.onChatClose();
  }
  addChat(name: string, text: string, system = false): void {
    const line = el('div', system ? 'chat-system' : 'chat-player');
    const sender = el('strong'); sender.textContent = `${!system && name.toLowerCase() === 'server' ? 'Server (player)' : name}: `;
    line.append(sender, document.createTextNode(text)); this.chatLog.appendChild(line);
    while (this.chatLog.childElementCount > 30) this.chatLog.firstElementChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    const recent = line.cloneNode(true) as HTMLElement;
    recent.classList.add('chat-feed-message');
    if (['loading', 'weapons', 'start'].includes(this.currentScreen)) {
      this.pendingChat.push(recent);
      if (this.pendingChat.length > 5) this.pendingChat.shift();
    } else this.displayChat(recent);
  }
  private displayChat(recent: HTMLElement): void {
    this.chatFeed.appendChild(recent);
    while (this.chatFeed.childElementCount > 5) this.chatFeed.firstElementChild?.remove();
    window.setTimeout(() => recent.remove(), 10000);
  }

  setWeaponName(name: string): void {
    this.weaponName.textContent = name;
  }

  setHealth(hp: number, max: number): void {
    this.healthValue.textContent = String(Math.ceil(hp));
    this.healthBar.style.width = `${Math.max(0, (hp / max) * 100)}%`;
  }

  setSlideEffect(sliding: boolean, speed: number, remaining: number): void {
    const start = Math.max(0, Math.min(1, (remaining - .75) / .25));
    const strength = sliding ? Math.min(.55, (.18 + .22 * Math.min(1, speed / 8)) * (1 + .32 * start)) : 0;
    this.slideLines.style.setProperty('--slide-strength', String(strength));
    this.slideLines.classList.toggle('active', sliding);
  }

  /** The weapon slots strip: names in slot order, the one in hand highlighted. */
  setWeaponSlots(names: readonly string[], current: number): void {
    const signature = JSON.stringify(names);
    if (this.slotNames !== signature) {
      this.slotNames = signature;
      this.weaponSlots.innerHTML = names.map((n, i) => `<span>${names.length > 1 ? `<b>${i + 1}</b>` : ''}${n}</span>`).join('');
    }
    [...this.weaponSlots.children].forEach((c, i) => c.classList.toggle('current', i === current));
  }

  /** Scope overlay (sniper fully aimed): `amount` 0..1 fades it in as the scope reaches the eye. */
  setScope(amount: number): void {
    for (const scope of [this.scope, this.spectatorScope]) {
      scope.style.opacity = String(amount);
      scope.classList.toggle('visible', amount > 0.001);
    }
  }

  grenadeReward(): void {
    // Only live, deduplicated server elimination events call this; snapshots never do.
    const awards = this.grenadeButton.querySelectorAll('.grenade-reward');
    if (awards.length >= 4) awards[0].remove();
    const popup = document.createElement('i'); popup.className = 'grenade-reward'; popup.textContent = '+1';
    const occupied = new Set([...this.grenadeButton.querySelectorAll<HTMLElement>('.grenade-reward')].map(node => Number(node.dataset.lane)));
    const lane = [0, 1, 2, 3].find(value => !occupied.has(value)) ?? 0;
    popup.dataset.lane = String(lane); popup.style.left = `${-16 + lane * 26}px`;
    this.grenadeButton.append(popup);
    window.setTimeout(() => popup.remove(), 800);
  }

  setGrenadeCharge(progress: number): void {
    if (!this.chargeRing) return;
    this.chargeRing.classList.toggle('visible', progress > .065);
    this.chargeRing.style.setProperty('--charge', String(Math.max(0, Math.min(1, progress))));
  }
  setGrenades(count: number): void {
    this.grenadeButton.querySelector('span')!.textContent = String(count);
    this.grenadeButton.disabled = count === 0;
    this.grenadeButton.setAttribute('aria-label', `Throw grenade (${count} remaining)`);
    this.grenadeButton.title = `Throw grenade: ${bindingName(this.draft.value.keyBindings.grenade[0])}`;
  }

  setAmmo(ammo: number, reserve: number, magazine: number, reloading: boolean, progress: number): void {
    this.ammoValue.textContent = String(ammo);
    this.ammoReserve.innerHTML = Number.isFinite(reserve) ? `/ ${reserve}` : '/ &infin;';
    this.ammoBox.classList.toggle('low', ammo <= Math.floor(magazine * 0.2));
    this.reloadBar.classList.toggle('active', reloading);
    (this.reloadBar.firstElementChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  setCrosshairSpread(px: number, visible: boolean, dt: number): void {
    this.crosshair.style.setProperty('--gap', `${this.crosshairMotion.update(px, dt)}px`);
    this.crosshair.style.opacity = visible ? '1' : '0';
  }

  hitMarker(crit: boolean): void {
    const h = this.hitmarker;
    h.classList.remove('show', 'crit');
    void h.offsetWidth; // restart animation
    h.classList.add('show');
    if (crit) h.classList.add('crit');
  }

  showToast(text: string, kind: '' | 'blue' | 'warn' = '', seconds = 1.6): void {
    this.toast.textContent = text;
    this.toast.className = `toast visible ${kind}`;
    this.toastTimer = seconds;
  }

  setFps(text: string | null): void {
    this.fpsBox.textContent = text ?? '';
    this.fpsBox.style.display = text ? 'block' : 'none';
  }

  setStats(text: string): void {
    this.statsBox.textContent = text;
  }

  setLockHint(visible: boolean): void {
    this.lockHint.style.display = visible ? 'block' : 'none';
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('visible');
    }
  }
}
