import { assetUrl } from '../core/assets';
import type { AudioManager } from '../audio/AudioManager';
import { SETTING_LIMITS, type Settings, type SettingsStore } from '../config/settings';
import { SettingsDraft } from '../config/settingsDraft';
import { Dropdown } from './Dropdown';
import { Scoreboard } from './Scoreboard';
import { CROSSFIRE_LOGO } from './WeaponIcons';
import { validWeapon } from '../../shared/protocol';
import type { WeaponId } from '../weapons/Weapon';

export type Screen = 'menu' | 'loading' | 'start' | 'weapons' | 'hud' | 'pause' | 'settings' | 'error';

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
const SCOPE_SVG = `<svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="scope-edge" cx="0" cy="0" r="46" gradientUnits="userSpaceOnUse">
      <stop offset="0.9" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.985" stop-color="#000" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#000" stop-opacity="1"/>
    </radialGradient>
    <mask id="scope-hole"><rect x="-400" y="-400" width="800" height="800" fill="#fff"/><circle r="46" fill="#000"/></mask>
  </defs>
  <rect x="-400" y="-400" width="800" height="800" fill="#000" mask="url(#scope-hole)"/>
  <circle r="46" fill="url(#scope-edge)"/>
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
  private readonly screens = new Map<Screen, HTMLElement>();
  private settingsReturn: Screen = 'menu';
  private settingsFocus: HTMLElement | null = null;
  /** What the settings screen edits. The game only sees changes when Apply hands them to the SettingsStore. */
  private readonly draft: SettingsDraft;

  // callbacks set by the game
  onPlay: () => void = () => {};
  onStart: () => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};

  // HUD elements
  private crosshair!: HTMLElement;
  private hitmarker!: HTMLElement;
  private healthValue!: HTMLElement;
  private healthBar!: HTMLElement;
  private ammoBox!: HTMLElement;
  private ammoValue!: HTMLElement;
  private ammoReserve!: HTMLElement;
  private reloadBar!: HTMLElement;
  private weaponSlots!: HTMLElement;
  private slotNames = '';
  private scope!: HTMLElement;
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
  private homeIndicator!: HTMLElement;
  private selectedName!: HTMLElement;
  private selectedPreview!: HTMLImageElement;
  private spawnButton!: HTMLButtonElement;
  private spawnError!: HTMLElement;
  private pendingWeapon: WeaponId = 'rifle';
  private readonly previews = new Map<WeaponId, string>();
  private readonly weaponCards = new Map<WeaponId, HTMLButtonElement>();
  private readonly labels: Record<WeaponId, string> = { smg: 'SMG', rifle: 'Assault Rifle', shotgun: 'Shotgun', sniper: 'Sniper Rifle' };
  currentScreen: Screen = 'menu';
  readonly scoreboard: Scoreboard;

  constructor(
    private readonly root: HTMLElement,
    settings: SettingsStore,
    private readonly audio: AudioManager,
  ) {
    this.draft = new SettingsDraft(settings);
    this.buildMenu();
    this.buildLoading();
    try { const saved = localStorage.getItem('crossfire.pending-weapon'); if (validWeapon(saved)) this.pendingWeapon = saved; } catch { /* Optional preference. */ }
    this.buildStart();
    this.buildWeapons();
    this.buildHud();
    this.buildPause();
    this.buildSettings();
    this.buildError();
    this.scoreboard = new Scoreboard(root);
  }

  private screen(id: Screen, cls = ''): HTMLElement {
    const s = el('div', `screen ${cls}`);
    s.id = id;
    this.root.appendChild(s);
    this.screens.set(id, s);
    return s;
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
      this.button('Play', '', 'nav-button', () => { if (this.currentScreen === 'settings') this.closeSettings(); }),
      this.button('Settings', '', 'nav-button', () => { if (this.currentScreen !== 'settings') this.openSettings('menu'); }),
    ];
    const indicator = el('span', 'nav-indicator');
    this.homeIndicator = indicator;
    indicator.setAttribute('aria-hidden', 'true');
    const hoverIndicator = el('span', 'nav-hover-indicator');
    hoverIndicator.setAttribute('aria-hidden', 'true');
    nav.append(...this.homeTabs, hoverIndicator, indicator);
    header.appendChild(nav);
    const actions = el('div', 'home-actions');
    actions.appendChild(this.button('Play', '', 'primary', () => this.onPlay()));
    this.onlineCount = el('div', 'online-count', '0 Players Online');
    this.onlineCount.dataset.available = 'false';
    actions.appendChild(this.onlineCount);
    s.append(backdropFrame, actions);
    this.root.appendChild(header);
    const labels = new ResizeObserver(() => this.updateHomeIndicator());
    for (const tab of this.homeTabs) labels.observe(tab.firstElementChild!);
  }

  private updateHomeIndicator(): void {
    this.homeTabs.forEach((tab, index) => {
      const text = tab.firstElementChild as HTMLElement;
      if (text.offsetWidth) this.homeIndicator.parentElement!.style.setProperty(index === 0 ? '--play-underline-width' : '--settings-underline-width', `${text.offsetWidth + 24}px`);
    });
    const label = this.homeTabs.find((tab) => tab.hasAttribute('aria-current'))?.firstElementChild as HTMLElement | undefined;
    // Use layout width so hover scaling never changes the underline's target size.
    if (label?.offsetWidth) this.homeIndicator.style.setProperty('--underline-width', `${label.offsetWidth + 24}px`);
  }

  private buildLoading(): void {
    const s = this.screen('loading');
    s.setAttribute('role', 'status');
    s.setAttribute('aria-live', 'polite');
    s.appendChild(el('div', 'loading-word', 'LOADING'));
  }

  setLoading(fraction: number, _label: string): void {
    this.screens.get('loading')!.setAttribute('aria-busy', String(fraction < 1));
  }

  private buildStart(): void {
    const s = this.screen('start');
    const card = el('div', 'prespawn');
    card.appendChild(this.button('Switch Gun', '', '', () => this.show('weapons')));
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
    head.append(el('h2', '', 'Loadout'), this.button('Back', '', 'weapon-back', () => this.show('start')));
    const grid = el('div', 'weapon-grid');
    for (const id of ['smg', 'rifle', 'sniper', 'shotgun'] as const) {
      const card = this.button(this.labels[id], '', 'weapon-card', () => {
        this.pendingWeapon = id;
        try { localStorage.setItem('crossfire.pending-weapon', id); } catch { /* Optional preference. */ }
        this.refreshSelection();
        this.show('start');
      });
      card.dataset.weapon = id;
      this.weaponCards.set(id, card);
      grid.appendChild(card);
    }
    s.append(head, grid);
    this.refreshSelection();
  }

  get selectedWeapon(): WeaponId { return this.pendingWeapon; }
  get spawnPending(): boolean { return this.spawnButton.disabled; }

  private refreshSelection(): void {
    this.selectedName.textContent = this.labels[this.pendingWeapon];
    const url = this.previews.get(this.pendingWeapon);
    this.selectedPreview.hidden = !url;
    if (url) this.selectedPreview.src = url;
    for (const [id, card] of this.weaponCards) {
      card.classList.toggle('selected', id === this.pendingWeapon);
      card.setAttribute('aria-pressed', String(id === this.pendingWeapon));
    }
  }

  setWeaponPreview(id: WeaponId, url: string): void {
    this.previews.set(id, url);
    const img = el('img');
    img.src = url;
    img.alt = this.labels[id];
    this.weaponCards.get(id)?.prepend(img);
    this.refreshSelection();
  }

  setSpawnState(respawn: boolean, busy = false, error = ''): void {
    this.spawnButton.firstElementChild!.textContent = respawn ? 'Respawn' : 'Spawn';
    for (const button of this.screens.get('start')!.querySelectorAll('button')) button.disabled = busy;
    this.spawnError.textContent = error;
  }

  setOnline(count: number | null): void {
    const available = count !== null && Number.isSafeInteger(count) && count >= 0 && count <= 16;
    this.onlineCount.dataset.available = String(available);
    const display = available ? count : 0;
    this.onlineCount.textContent = `${display} ${display === 1 ? 'Player' : 'Players'} Online`;
  }

  private buildHud(): void {
    const s = this.screen('hud');
    const ch = el('div', 'crosshair', '<i class="h l"></i><i class="h r"></i><i class="v t"></i><i class="v b"></i><i class="dot"></i>');
    this.crosshair = ch;
    s.appendChild(ch);
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
    br.appendChild(this.ammoBox);
    br.appendChild(this.reloadBar);
    br.appendChild(this.weaponName);
    br.appendChild(this.weaponSlots);
    s.appendChild(br);
    // sniper scope: black surround, the round field of view with a mil-dot reticle (SVG, crisp at any resolution)
    this.scope = el('div', 'scope', SCOPE_SVG);
    s.insertBefore(this.scope, s.firstChild);
    this.toast = el('div', 'toast');
    s.appendChild(this.toast);
    this.lockHint = el('div', 'lock-hint', 'Click to capture the mouse');
    s.appendChild(this.lockHint);

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
    b.appendChild(this.button('Leave Match', '', '', () => this.onQuit()));
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

  /** Open the settings screen from the main menu or the pause menu; edits start from the applied settings. */
  private openSettings(from: Screen): void {
    this.settingsFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.settingsReturn = from;
    this.draft.discard();
    this.selectSettingsTab(0, false);
    this.setSettingsStatus('');
    this.show('settings', from === 'pause');
    this.settingTabs[0]?.tab.focus();
  }

  /** Back: drop every unapplied edit and return to where settings were opened from. */
  private closeSettings(): void {
    this.draft.discard();
    this.show(this.settingsReturn, this.settingsReturn === 'pause');
    this.settingsFocus?.focus();
  }

  private applySettings(): void {
    if (!this.draft.dirty) return;
    const changed = this.draft.apply();
    this.syncSettings();
    this.setSettingsStatus(`Applied ${changed.length} change${changed.length === 1 ? '' : 's'}`, true);
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
      {
        key: 'sound',
        title: 'Sound',
        rows: [['masterVolume', this.rangeRow('masterVolume', 'Master volume', 0.01, pct)]],
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
      for (const [key, row] of c.rows) {
        panel.appendChild(row);
        this.settingRows.set(key, row);
      }
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
      this.settingTabs.push({ key: c.key, tab, panel, keys: c.rows.map(([k]) => k) });
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

  /** Push the draft into every control and refresh the "unapplied" markers. */
  private syncSettings(): void {
    for (const f of this.settingSyncs) f();
    const dirty = new Set(this.draft.dirtyKeys);
    for (const [key, row] of this.settingRows) row.classList.toggle('changed', dirty.has(key));
    for (const t of this.settingTabs) t.tab.classList.toggle('changed', t.keys.some((k) => dirty.has(k)));
    this.dirtyPill.hidden = dirty.size === 0;
    this.applyButton.setAttribute('aria-disabled', String(dirty.size === 0));
    this.applyButton.classList.toggle('inactive', dirty.size === 0);
    if (dirty.size && this.settingsStatus.classList.contains('ok')) this.setSettingsStatus('');
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

  private toggleRow(key: 'invertY' | 'showFps', label: string): HTMLElement {
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
    this.currentScreen = screen;
    document.body.dataset.screen = screen;
    const homeSettings = screen === 'settings' && this.settingsReturn === 'menu';
    const home = screen === 'menu' || homeSettings;
    document.body.dataset.homePage = homeSettings ? 'settings' : home ? 'play' : '';
    this.homeHeader.hidden = !home;
    this.homeHeader.dataset.page = homeSettings ? 'settings' : 'play';
    this.homeTabs.forEach((tab, i) => {
      if (i === (homeSettings ? 1 : 0)) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    if (home) this.updateHomeIndicator();
    this.screens.get('settings')!.classList.toggle('home-settings', homeSettings);
    this.screens.get('menu')!.inert = homeSettings;
    this.screens.get('menu')!.setAttribute('aria-hidden', String(homeSettings || !home));
    this.scoreboard?.setVisible(false);
    for (const [id, s] of this.screens) {
      s.classList.toggle('visible', id === screen || (overlayHud && id === 'hud') || (homeSettings && id === 'menu'));
    }
    if (screen === 'settings') this.syncSettings();
  }

  setMapTitle(name: string, sub: string): void {
    this.mapTitle.innerHTML = `${name}<small>${sub}</small>`;
  }

  setWeaponName(name: string): void {
    this.weaponName.textContent = name;
  }

  setHealth(hp: number, max: number): void {
    this.healthValue.textContent = String(Math.ceil(hp));
    this.healthBar.style.width = `${Math.max(0, (hp / max) * 100)}%`;
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
    this.scope.style.opacity = String(amount);
    this.scope.classList.toggle('visible', amount > 0.001);
  }

  setAmmo(ammo: number, reserve: number, magazine: number, reloading: boolean, progress: number): void {
    this.ammoValue.textContent = String(ammo);
    this.ammoReserve.innerHTML = Number.isFinite(reserve) ? `/ ${reserve}` : '/ &infin;';
    this.ammoBox.classList.toggle('low', ammo <= Math.floor(magazine * 0.2));
    this.reloadBar.classList.toggle('active', reloading);
    (this.reloadBar.firstElementChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  setCrosshairSpread(px: number, visible: boolean): void {
    this.crosshair.style.setProperty('--gap', `${Math.round(4 + px)}px`);
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
