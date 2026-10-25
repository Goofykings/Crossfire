import type { AudioManager } from '../audio/AudioManager';
import { SETTING_LIMITS, type Settings, type SettingsStore } from '../config/settings';
import { SettingsDraft } from '../config/settingsDraft';
import { Dropdown } from './Dropdown';
import { MAPS, UPCOMING_MAPS } from '../maps/registry';
import type { Team } from '../maps/types';

export type Screen = 'menu' | 'loading' | 'start' | 'hud' | 'pause' | 'settings' | 'error';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump'],
  ['Ctrl / C', 'Crouch'],
  ['Left click', 'Fire'],
  ['Right click', 'Aim down sights'],
  ['R', 'Reload'],
  ['Esc', 'Pause / release mouse'],
  ['F3', 'Toggle FPS counter'],
];

/**
 * DOM user interface: main menu, loading, click-to-play, HUD, pause and settings.
 * Plain HTML/CSS so it scales crisply at any resolution.
 */
export class UI {
  private readonly screens = new Map<Screen, HTMLElement>();
  private settingsReturn: Screen = 'menu';
  /** What the settings screen edits. The game only sees changes when Apply hands them to the SettingsStore. */
  private readonly draft: SettingsDraft;
  selectedMap = MAPS[0].id;

  // callbacks set by the game
  onPlay: (mapId: string) => void = () => {};
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
  private zonePill!: HTMLElement;
  private zoneText!: HTMLElement;
  private fpsBox!: HTMLElement;
  /** The FPS readout element (read by the debug API). */
  get fpsElement(): HTMLElement {
    return this.fpsBox;
  }
  private statsBox!: HTMLElement;
  private toast!: HTMLElement;
  private toastTimer = 0;
  private lockHint!: HTMLElement;
  private loadingBar!: HTMLElement;
  private loadingLabel!: HTMLElement;
  private menuStatus!: HTMLElement;
  private playButton!: HTMLButtonElement;
  private errorText!: HTMLElement;
  private weaponName!: HTMLElement;
  private mapTitle!: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    settings: SettingsStore,
    private readonly audio: AudioManager,
  ) {
    this.draft = new SettingsDraft(settings);
    this.buildMenu();
    this.buildLoading();
    this.buildStart();
    this.buildHud();
    this.buildPause();
    this.buildSettings();
    this.buildError();
    root.addEventListener('mouseover', (e) => {
      if ((e.target as HTMLElement).closest?.('.btn, .map-card, .tab')) this.audio.play('ui_hover', { volume: 0.5 });
    });
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
    const col = el('div', 'menu-col');
    col.appendChild(el('h1', 'logo', 'CROSSFIRE'));
    col.appendChild(el('div', 'tagline', 'Prototype &middot; Milestone 1'));
    const buttons = el('div', 'menu-buttons');
    const map = MAPS.find((m) => m.id === this.selectedMap)!;
    this.playButton = this.button('Play', map.name, 'primary', () => this.onPlay(this.selectedMap));
    buttons.appendChild(this.playButton);
    const mapList = el('div', 'map-list');
    const mapBtn = this.button('Map', map.name, '', () => mapList.classList.toggle('open'));
    buttons.appendChild(mapBtn);
    buttons.appendChild(mapList);
    for (const m of MAPS) {
      const card = el('button', 'map-card selected', `<div><div class="name">${m.name}</div><div class="desc">${m.description}</div></div><span class="badge">Ready</span>`);
      card.addEventListener('click', () => {
        this.selectedMap = m.id;
        mapList.classList.remove('open');
      });
      mapList.appendChild(card);
    }
    for (const m of UPCOMING_MAPS) {
      const card = el('button', 'map-card locked', `<div><div class="name">${m.name}</div><div class="desc">${m.description}</div></div><span class="badge">Coming soon</span>`);
      card.disabled = true;
      mapList.appendChild(card);
    }
    buttons.appendChild(
      this.button('Settings', '', '', () => this.openSettings('menu')),
    );
    col.appendChild(buttons);
    this.menuStatus = el('div', 'status-line', '');
    col.appendChild(this.menuStatus);
    col.appendChild(
      el(
        'div',
        'menu-footer',
        `<span class="kbd">WASD</span> move &nbsp; <span class="kbd">Shift</span> sprint &nbsp; <span class="kbd">Space</span> jump<br>
         <span class="kbd">Ctrl</span> / <span class="kbd">C</span> crouch &nbsp; <span class="kbd">R</span> reload &nbsp; <span class="kbd">Esc</span> pause<br>
         <span class="kbd">LMB</span> fire &nbsp; <span class="kbd">RMB</span> aim down sights<br>
         Single-player prototype &middot; Babylon.js + Blender`,
      ),
    );
    s.appendChild(col);
  }

  setMenuStatus(text: string): void {
    this.menuStatus.textContent = text;
  }

  private buildLoading(): void {
    const s = this.screen('loading');
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'Entering the town'));
    this.loadingLabel = el('p', '', 'Preparing...');
    card.appendChild(this.loadingLabel);
    const prog = el('div', 'progress');
    this.loadingBar = el('div');
    prog.appendChild(this.loadingBar);
    card.appendChild(prog);
    s.appendChild(card);
  }

  setLoading(fraction: number, label: string): void {
    this.loadingBar.style.width = `${Math.round(fraction * 100)}%`;
    this.loadingLabel.textContent = label;
  }

  private buildStart(): void {
    const s = this.screen('start');
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'European Town'));
    card.appendChild(el('p', '', 'Find the practice targets hidden around the lanes. Damage is disabled inside the blue and red safe zones.'));
    const grid = el('div', 'controls-grid');
    for (const [k, v] of CONTROLS) {
      grid.appendChild(el('span', 'kbd', k));
      grid.appendChild(el('span', '', v));
    }
    card.appendChild(grid);
    card.appendChild(this.button('Click to play', 'captures the mouse', 'primary', () => this.onStart()));
    s.appendChild(card);
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
    this.zonePill = el('div', 'zone-pill');
    this.zoneText = el('span');
    this.zonePill.appendChild(el('span', 'shield'));
    this.zonePill.appendChild(this.zoneText);
    s.appendChild(this.zonePill);
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
    this.ammoReserve = el('div', 'reserve', '/ 150');
    this.ammoBox.appendChild(this.ammoValue);
    this.ammoBox.appendChild(this.ammoReserve);
    this.weaponName = el('div', 'weapon-name', '');
    this.reloadBar = el('div', 'reload-bar');
    this.reloadBar.appendChild(el('div'));
    br.appendChild(this.ammoBox);
    br.appendChild(this.reloadBar);
    br.appendChild(this.weaponName);
    s.appendChild(br);
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
    b.appendChild(this.button('Main menu', '', '', () => this.onQuit()));
    card.appendChild(b);
    s.appendChild(card);
  }

  private buildError(): void {
    const s = this.screen('error');
    const card = el('div', 'card');
    card.appendChild(el('h2', '', 'Something went wrong'));
    this.errorText = el('p');
    card.appendChild(this.errorText);
    s.appendChild(card);
  }

  showError(message: string): void {
    this.errorText.textContent = message;
    this.show('error');
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
    this.settingsReturn = from;
    this.draft.discard();
    this.selectSettingsTab(0, false);
    this.setSettingsStatus('');
    this.show('settings', from === 'pause');
  }

  /** Back: drop every unapplied edit and return to where settings were opened from. */
  private closeSettings(): void {
    this.draft.discard();
    this.show(this.settingsReturn, this.settingsReturn === 'pause');
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
      if (e.key === 'Escape') this.closeSettings();
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
    for (const [id, s] of this.screens) {
      s.classList.toggle('visible', id === screen || (overlayHud && id === 'hud'));
    }
    if (screen === 'settings') this.syncSettings();
  }

  setPlayReady(ready: boolean, label?: string): void {
    this.playButton.disabled = false;
    const sub = this.playButton.querySelector('.sub');
    if (sub) sub.textContent = label ?? (ready ? MAPS[0].name : 'Loading...');
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

  setAmmo(ammo: number, reserve: number, magazine: number, reloading: boolean, progress: number): void {
    this.ammoValue.textContent = String(ammo);
    this.ammoReserve.textContent = `/ ${reserve}`;
    this.ammoBox.classList.toggle('low', ammo <= Math.floor(magazine * 0.2));
    this.reloadBar.classList.toggle('active', reloading);
    (this.reloadBar.firstElementChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  setZone(team: Team | null): void {
    this.zonePill.classList.toggle('visible', team !== null);
    this.zonePill.classList.toggle('blue', team === 'blue');
    this.zonePill.classList.toggle('red', team === 'red');
    this.crosshair.classList.toggle('blocked', team !== null);
    if (team) this.zoneText.innerHTML = `${team} safe zone <small>&middot; damage disabled</small>`;
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
