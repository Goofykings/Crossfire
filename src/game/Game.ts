import { abortable } from '../core/cancellation';
import { ArcRotateCamera, Color3, Mesh, MeshBuilder, PBRMaterial, Quaternion, SceneInstrumentation, StandardMaterial, Vector3 } from '@babylonjs/core';
import { AudioManager, type SoundName } from '../audio/AudioManager';
import { FIXED_DT, MAX_FRAME_DT, MOVEMENT, PLAYER_MAX_HEALTH } from '../config/constants';
import { SettingsStore, type Settings } from '../config/settings';
import { GuestProfileStore } from '../config/guestProfile';
import { Input } from '../core/Input';
import { MapManager, type LoadedMap } from '../maps/MapManager';
import { DEFAULT_MAP_ID, getMap, MAPS } from '../maps/registry';
import { PlayerCamera } from '../player/PlayerCamera';
import { NO_INTENT, PlayerController, type MoveIntent } from '../player/PlayerController';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { PostFX } from '../rendering/PostFX';
import { GRAPHICS_PRESETS, SHADOW_PRESETS } from '../rendering/quality';
import { RenderContext } from '../rendering/RenderContext';
import { UI } from '../ui/UI';
import { Effects } from '../weapons/Effects';
import { applySpread, damageAt, Loadout, WEAPONS, type Weapon, type WeaponEvent } from '../weapons/Weapon';
import { RIG_CONFIGS, WeaponView } from '../weapons/WeaponView';
import { DamageSystem, type Attacker, type HitZone } from './Damage';
import { TeammateRegistry, type RemotePlayer } from './Teammates';
import { MultiplayerClient } from '../network/MultiplayerClient';
import { RemotePlayers } from './RemotePlayers';
import { Presence } from '../network/Presence';
import { weaponPreviews } from '../ui/WeaponPreviews';
import type { Snapshot } from '../../shared/protocol';

type State = 'menu' | 'loading' | 'start' | 'playing' | 'paused';

/** Sounds for the timed cues inside reloads and pump/bolt actions (weapons/Weapon.ts). */
const CUE_SOUNDS: Record<string, SoundName> = {
  mag_out: 'mag_out',
  mag_in: 'mag_in',
  bolt_release: 'bolt_release',
  pump_back: 'pump_back',
  pump_fwd: 'pump_fwd',
  bolt_up: 'bolt_up',
  bolt_back: 'bolt_back',
  bolt_fwd: 'bolt_fwd',
  bolt_down: 'bolt_down',
};

export interface GameOptions {
  /** Public multiplayer by default; ?practice retains the explicit development path. */
  multiplayer?: boolean;
  /** Skip menus and pointer lock (automated tests / screenshots). */
  autoplay: boolean;
  /** Initial camera: x, y, z, heading, pitch. */
  cam: number[] | null;
  /** Map to preload and (with autoplay) play; defaults to the registry's default map. */
  map?: string;
  hideHud: boolean;
  quality?: Settings['graphicsQuality'];
  shadows?: Settings['shadowQuality'];
  scale?: number;
}

export class Game {
  readonly ctx: RenderContext;
  readonly input: Input;
  readonly settings = new SettingsStore();
  readonly guestProfile = new GuestProfileStore();
  readonly audio = new AudioManager();
  readonly ui: UI;
  readonly materials: MaterialLibrary;
  readonly maps: MapManager;
  private readonly postfx: PostFX;
  private readonly instrumentation: SceneInstrumentation;
  map: LoadedMap | null = null;
  player: PlayerController | null = null;
  private cameraRig: PlayerCamera | null = null;
  /** Rifle, shotgun, sniper and SMG (slots 1-4); infinite reserve ammunition, limited magazines. */
  readonly loadout = new Loadout(WEAPONS);
  private weaponView: WeaponView | null = null;
  private effects: Effects | null = null;
  private readonly damage = new DamageSystem();
  state: State = 'menu';
  private acc = 0;
  private health = PLAYER_MAX_HEALTH;
  private stepDistance = 0;
  private stats = { shots: 0, hits: 0, downs: 0, headshots: 0 };
  /** The last shot's result (for tests): pellets fired and on target, damage dealt, headshot. */
  private lastShot = { weapon: '', pellets: 0, hits: 0, damage: 0, head: false, target: '' };
  private lastSpawn = -1;
  private scope = 0;
  /** Debug: render the view-model at a fixed action/progress (screenshots of animation phases). */
  private viewOverride: { action: Weapon['action']; progress: number; ads: number } | null = null;
  private fps = { frames: 0, time: 0, value: 0 };
  /** The map load in flight (only one runs at a time) and the map the player asked for last. */
  private loading: { id: string; signal?: AbortSignal; promise: Promise<LoadedMap> } | null = null;
  private wantedMap: string = DEFAULT_MAP_ID;
  private menuOrbit = 0;
  private readonly attacker: Attacker;
  private readonly tmpPos = { x: 0, y: 0, z: 0 };
  /** Other players' last known positions (fed by a future network client; empty in single player). */
  readonly teammates = new TeammateRegistry();
  private network: MultiplayerClient | null = null;
  private networkReady = false;
  private loadedRound = -1;
  private roundLoad: Promise<void> | null = null;
  private gameAssets: Promise<void> | null = null;
  private joinAbort: AbortController | null = null;
  private networkLife = -1;
  private appliedPlayerId = '';
  private tabHeld = false;
  private preSpawnPaused = false;
  private presence: Presence | null = null;
  private readonly remotePlayers: RemotePlayers;

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    readonly options: GameOptions,
  ) {
    this.ctx = new RenderContext(canvas, { preserveDrawingBuffer: options.autoplay });
    this.input = new Input(canvas);
    this.ui = new UI(uiRoot, this.settings, this.audio, this.guestProfile);
    this.materials = new MaterialLibrary(this.ctx.scene);
    this.maps = new MapManager(this.ctx, this.materials, () => GRAPHICS_PRESETS[this.settings.value.graphicsQuality].batchCell, !options.multiplayer);
    this.remotePlayers = new RemotePlayers(this.ctx.scene, uiRoot);
    this.postfx = new PostFX(this.ctx.scene, this.ctx.camera);
    this.instrumentation = new SceneInstrumentation(this.ctx.scene);
    this.instrumentation.captureFrameTime = true;
    this.attacker = {
      id: 'player',
      position: () => {
        const p = this.player?.position ?? { x: 0, y: 0, z: 0 };
        this.tmpPos.x = p.x;
        this.tmpPos.y = p.y + 0.9;
        this.tmpPos.z = p.z;
        return this.tmpPos;
      },
    };
    if (options.quality || options.shadows || options.scale) {
      this.settings.update({
        ...(options.quality ? { graphicsQuality: options.quality } : {}),
        ...(options.shadows ? { shadowQuality: options.shadows } : {}),
        ...(options.scale ? { resolutionScale: options.scale } : {}),
      });
    }
  }

  async init(): Promise<void> {
    const s = this.settings.value;
    this.ctx.setResolutionScale(s.resolutionScale);
    this.ctx.setFov(s.fov);
    this.audio.setVolume(s.masterVolume);
    this.postfx.apply(GRAPHICS_PRESETS[s.graphicsQuality]);
    this.materials.setAnisotropy(GRAPHICS_PRESETS[s.graphicsQuality].anisotropy);
    this.settings.onChange((v, changed) => this.applySettings(v, changed));

    // Public Play has no silent practice fallback.
    this.ui.onPlay = () => void this.play(this.wantedMap);
    this.ui.onStart = () => void this.spawnSelected();
    this.ui.onResume = () => {
      if (this.preSpawnPaused) { this.preSpawnPaused = false; this.showPreSpawn(); }
      else void this.enterPlay();
    };
    this.ui.onQuit = () => this.quitToMenu();
    this.ui.onCancelLoading = () => this.quitToMenu();
    this.input.lockListeners.add((locked) => this.onPointerLock(locked));
    this.ctx.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked && !this.options.autoplay) void this.input.requestLock();
    });
    window.addEventListener('beforeunload', (e) => {
      // Ask before leaving mid-game through a browser shortcut
      if (this.state === 'playing' || this.state === 'paused') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('pagehide', () => { this.network?.disconnect(); this.presence?.dispose(); });
    window.addEventListener('keyup', (e) => { if (e.code === 'Tab') { this.tabHeld = false; this.ui.scoreboard.setVisible(false); } });
    window.addEventListener('blur', () => { this.tabHeld = false; this.ui.scoreboard.setVisible(false); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.tabHeld = false; this.input.clearState(); this.ui.scoreboard.setVisible(false); } });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'start' && !this.ui.spawnPending && (this.ui.currentScreen === 'start' || this.ui.currentScreen === 'weapons')) {
        this.preSpawnPaused = true;
        this.state = 'paused';
        this.tabHeld = false;
        this.ui.show('pause');
      }
      if (e.code === 'Tab' && (this.ui.currentScreen === 'hud' || this.ui.currentScreen === 'start')) {
        e.preventDefault();
        this.tabHeld = true;
      }
      if (e.code === 'F3') this.settings.update({ showFps: !this.settings.value.showFps });
      if (e.code === 'F2' && this.map && this.state === 'playing') void this.map.toggleCollisionDebug();
    });

    const first = MAPS.some((m) => m.id === this.options.map) ? this.options.map! : DEFAULT_MAP_ID;
    this.ui.show('menu');
    this.presence = new Presence(import.meta.env.VITE_MULTIPLAYER_URL ?? '', (count) => this.ui.setOnline(count),
      () => this.ui.currentScreen === 'menu');
    this.presence.start();
    this.ctx.engine.runRenderLoop(() => this.frame(this.ctx.engine.getDeltaTime() / 1000));
    await this.ui.ensureGuestProfile();
    if (this.options.autoplay) await this.play(first);
  }

  /** No playable map, environment, weapon GLB or textures are requested by home. */
  private prepareGameAssets(signal?: AbortSignal): Promise<void> {
    if (this.gameAssets) return abortable(this.gameAssets, signal);
    let effects: Effects | null = null;
    let view: WeaponView | null = null;
    const work = (async () => {
      await this.materials.load(undefined, signal);
      signal?.throwIfAborted();
      effects = new Effects(this.ctx.scene);
      this.effects = effects;
      effects.onCasingLand = (type, at) => {
        const d = this.ctx.camera.globalPosition.subtract(at).length();
        this.sound(type === 'casing_shell' ? 'shell_drop' : 'casing', Math.max(0.05, 0.4 - d * 0.04));
      };
      view = new WeaponView(this.ctx, this.materials, effects);
      this.weaponView = view;
      view.setVisible(false);
      await Promise.all([view.load(signal), effects.loadCasings(this.materials, signal), this.remotePlayers.prepare(signal)]);
      signal?.throwIfAborted();
      await weaponPreviews((id, url) => this.ui.setWeaponPreview(id, url), signal);
      signal?.throwIfAborted();
      this.ui.setWeaponName(this.weapon.stats.name);
    })().catch((error) => {
      view?.dispose();
      effects?.dispose();
      if (this.weaponView === view) this.weaponView = null;
      if (this.effects === effects) this.effects = null;
      if (this.gameAssets === work) this.gameAssets = null;
      this.materials.prune(new Set(this.ctx.scene.meshes.map((m) => m.material).filter((m): m is NonNullable<typeof m> => !!m)));
      throw error;
    });
    this.gameAssets = work;
    return work;
  }

  /**
   * Load a map unless it is the current one. Only one load runs at a time: a request made while another map is
   * loading waits for it and then loads whatever was asked for last, so overlapping requests never leave two maps
   * (or a half-loaded one) in the scene.
   */
  requestMap(id: string, signal?: AbortSignal): Promise<LoadedMap> {
    signal?.throwIfAborted();
    this.wantedMap = id;
    if (this.loading?.signal?.aborted) this.loading = null;
    if (this.loading) {
      if (this.loading.id === id) return this.loading.promise;
      return this.loading.promise.catch(() => null).then(() => this.requestMap(this.wantedMap, signal));
    }
    if (this.map && this.map.def.id === id) return Promise.resolve(this.map);
    const promise = this.loadMap(id, signal).finally(() => {
      if (this.loading?.promise === promise) this.loading = null;
    });
    this.loading = { id, signal, promise };
    return promise;
  }

  /** The view-model never receives direct sun (it gets no shadows, so it would glow in dark alleys). */
  private excludeViewFromSun(map: LoadedMap): void {
    if (!this.weaponView) return;
    const list = map.environment.sun.excludedMeshes;
    const add = this.weaponView.meshes.filter((m) => !list.includes(m));
    const bad = add.filter((m) => typeof (m as unknown as { _resyncLightSource?: unknown })._resyncLightSource !== 'function');
    if (bad.length) console.warn('[crossfire] not meshes:', bad.map((m) => `${m.name}:${m.getClassName?.()}`).join(', '));
    list.push(...add.filter((m) => !bad.includes(m)));
  }

  private async loadMap(id: string, signal?: AbortSignal): Promise<LoadedMap> {
    const def = getMap(id);
    this.remotePlayers.releaseVisibility();
    // the previous map is disposed by the manager; nothing may touch it while the next one streams in
    this.map = null;
    this.player = null;
    this.cameraRig = null;
    const map = await this.maps.load(def, (f, label) => {
      if (!signal?.aborted) this.ui.setLoading(f, label);
    }, signal);
    signal?.throwIfAborted();
    this.map = map;
    if (this.options.multiplayer) this.remotePlayers.prepareVisibility();
    this.player = new PlayerController(map.world);
    this.cameraRig = new PlayerCamera(this.ctx, this.player);
    const s = this.settings.value;
    map.environment.applyShadowPreset(SHADOW_PRESETS[s.shadowQuality], this.ctx.camera);
    this.excludeViewFromSun(map);
    map.environment.setFog(GRAPHICS_PRESETS[s.graphicsQuality].fog);
    for (const t of map.targets.targets) {
      t.onStateChange = (_t, state) => {
        if (state === 'falling') {
          this.stats.downs++;
          this.sound('target_down', 0.7);
        }
      };
    }
    this.ui.setMapTitle(def.name, `${def.dimensions[0]} x ${def.dimensions[1]} m · practice`);
    this.teammates.clear();
    this.effects?.clearDecals();
    console.info('[crossfire] map loaded', map.stats);
    return map;
  }

  async play(id: string): Promise<void> {
    await this.ui.ensureGuestProfile();
    if (this.state === 'loading' && this.ui.currentScreen === 'loading') return;
    this.joinAbort?.abort();
    this.network?.disconnect();
    this.network = null;
    const controller = new AbortController();
    this.joinAbort = controller;
    const signal = controller.signal;
    this.roundLoad = null;
    this.networkReady = false;
    this.input.enabled = false;
    this.input.clearState();
    this.input.releaseLock();
    this.audio.unlock();
    this.state = 'loading';
    this.ui.setLoading(0, 'Opening match');
    this.ui.show('loading');
    try {
      if (this.options.multiplayer) {
        const network = new MultiplayerClient(import.meta.env.VITE_MULTIPLAYER_URL ?? '', () => this.guestProfile.value.username);
        this.network = network;
        network.onShot = (shot) => {
          if (signal.aborted || this.network !== network || shot.shooterId !== network.selfId || !shot.hits.length) return;
          const head = shot.hits.some((h) => h.head);
          this.stats.hits++;
          if (head) this.stats.headshots++;
          this.ui.hitMarker(head);
          this.sound(head ? 'hit_head' : 'hit', .65);
          this.lastShot = { weapon: shot.weapon, pellets: WEAPONS.find((w) => w.id === shot.weapon)!.pellets,
            hits: shot.hits.length, damage: shot.hits.reduce((n, h) => n + h.amount, 0), head, target: shot.hits[0].id };
        };
        network.onElimination = (event) => {
          if (signal.aborted || this.network !== network) return;
          this.ui.showToast(event.killerName ? `${event.killerName} eliminated ${event.victimName}${event.head ? ' (headshot)' : ''}`
            : `${event.victimName} was eliminated`, event.victimId === network.selfId ? 'warn' : '', 2.5);
        };
        network.onSnapshot = (snapshot) => { if (!signal.aborted && this.network === network) this.acceptSnapshot(snapshot); };
        network.onState = (state, message) => {
          if (signal.aborted || this.network !== network) return;
          if (state !== 'connected') { this.remotePlayers.clear(); this.ui.scoreboard.setVisible(false); }
          if (state === 'connected' && !this.networkReady) {
            void this.prepareNetworkMap().catch((e) => { if (!signal.aborted) this.connectionError((e as Error).message); });
          }
          if (state === 'reconnecting') this.ui.showToast(message ?? 'Reconnecting…', 'warn', 5);
          if (state === 'error') this.connectionError(message ?? 'Multiplayer connection failed');
        };
        await network.connect();
        signal.throwIfAborted();
        await this.prepareNetworkMap();
        signal.throwIfAborted();
        if (this.options.autoplay && this.networkReady) await this.spawnSelected();
        return;
      }
      await this.prepareGameAssets(signal);
      signal.throwIfAborted();
      await this.requestMap(id, signal);
      signal.throwIfAborted();
      if (this.map?.def.id !== id) return;
      this.showPreSpawn();
      if (this.options.autoplay) await this.spawnSelected();
    } catch (error) {
      if (!signal.aborted) this.connectionError((error as Error).message);
    }
  }

  private prepareNetworkMap(): Promise<void> {
    const signal = this.joinAbort?.signal;
    const network = this.network;
    if (!signal || signal.aborted || !network) return Promise.resolve();
    if (this.roundLoad) return this.roundLoad;
    const work = (async () => {
      this.networkReady = false;
      this.state = 'loading';
      this.tabHeld = false;
      this.preSpawnPaused = false;
      this.input.enabled = false;
      this.input.clearState();
      this.input.releaseLock();
      this.weaponView?.setVisible(false);
      this.ui.setScope(0);
      this.remotePlayers.clear();
      this.ui.show('loading');
      await this.prepareGameAssets(signal);
      signal.throwIfAborted();
      while (network.state === 'connected' && network.latest && this.network === network) {
        const target = network.latest;
        await this.requestMap(target.mapId, signal);
        signal.throwIfAborted();
        if (!network.latest || network.state !== 'connected') return;
        if (target.roundId !== network.latest.roundId || target.mapId !== network.latest.mapId) continue;
        if (this.map!.revision !== target.mapVersion) throw new Error('Map assets differ from the server. Rebuild matching client/server assets.');
        this.loadedRound = target.roundId;
        this.networkReady = true;
        this.acceptSnapshot(network.latest);
        this.ui.setMapTitle(this.map!.def.name, target.match.mode === 'teams' ? 'Teams' : target.match.mode === 'ffa' ? 'Free for all' : 'Public match');
        this.excludeViewFromSun(this.map!);
        const self = network.latest.players.find((p) => p.id === network.selfId);
        if (!self) throw new Error('Server did not assign a player');
        if (self.alive) {
          if (this.options.autoplay) this.activateWithoutLock();
          else { this.state = 'paused'; this.ui.show('pause'); }
        } else this.showPreSpawn();
        return;
      }
    })().finally(() => { if (this.roundLoad === work) this.roundLoad = null; });
    this.roundLoad = work;
    return work;
  }

  private acceptSnapshot(snapshot: Snapshot): void {
    if (!this.networkReady || !this.player || !this.map || this.network?.state !== 'connected') return;
    if (snapshot.roundId !== this.loadedRound || snapshot.mapId !== this.map.def.id) {
      const signal = this.joinAbort?.signal;
      void this.prepareNetworkMap().catch((e) => { if (!signal?.aborted) this.connectionError((e as Error).message); });
      return;
    }
    if (this.map.revision !== snapshot.mapVersion) { this.network.disconnect(); this.connectionError('Map assets differ from the server. Rebuild the matching client and server.'); return; }
    const self = snapshot.players.find((p) => p.id === this.network!.selfId);
    this.remotePlayers.snapshot(snapshot, this.network.selfId);
    if (!self) return;
    this.health = self.health;
    this.ui.setHealth(self.health, PLAYER_MAX_HEALTH);
    if (self.alive) {
      if ((self.life !== this.networkLife || self.id !== this.appliedPlayerId) && self.weapon) {
        this.networkLife = self.life;
        this.appliedPlayerId = self.id;
        this.player.restore(self.motion);
        this.loadout.reset(WEAPONS.findIndex((w) => w.id === self.weapon), true);
        this.weaponView?.select(self.weapon);
        this.ui.setWeaponName(this.weapon.stats.name);
        if (self.combat.gun) this.weapon.restore(self.combat.gun);
        this.acc = 0;
        this.cameraRig?.snapFov(this.settings.value.fov);
      } else this.network.reconcile(this.player, snapshot, this.weapon);
    } else if (this.state === 'playing' || (this.state === 'paused' && !this.preSpawnPaused)) this.showPreSpawn();
  }

  private showPreSpawn(): void {
    this.state = 'start';
    this.tabHeld = false;
    this.input.enabled = false;
    this.input.clearState();
    this.input.releaseLock();
    this.weaponView?.setVisible(false);
    this.ui.setScope(0);
    this.ui.setSpawnState((this.network?.latest?.players.find((p) => p.id === this.network?.selfId)?.life ?? 0) > 0);
    this.ui.show('start');
  }

  private async spawnSelected(): Promise<void> {
    if (this.state !== 'start' || this.ui.currentScreen !== 'start') return;
    const respawn = (this.network?.latest?.players.find((p) => p.id === this.network?.selfId)?.life ?? 0) > 0;
    this.ui.setSpawnState(respawn, true);
    try {
      if (this.options.multiplayer) {
        const network = this.network!;
        // Slow startup can time out the request before its authoritative approval
        // arrives. Retry must enter that already-approved life, not request another
        // spawn or change its server-locked weapon.
        const approved = network.latest?.players.find((p) => p.id === network.selfId)?.alive;
        const snapshot = approved ? network.latest! : await network.spawn(this.ui.selectedWeapon);
        if (this.network !== network || !this.networkReady || network.state !== 'connected' || this.state !== 'start') return;
        this.acceptSnapshot(snapshot);
      } else {
        this.spawn();
        this.loadout.reset(WEAPONS.findIndex((w) => w.id === this.ui.selectedWeapon), !this.options.autoplay);
        this.weaponView?.select(this.weapon.stats.id);
        this.ui.setWeaponName(this.weapon.stats.name);
      }
      if (this.options.autoplay) this.activateWithoutLock();
      else await this.enterPlay();
    } catch (e) {
      if (this.state === 'start') this.ui.setSpawnState(respawn, false, (e as Error).message);
    }
  }

  private activateWithoutLock(): void {
    this.preSpawnPaused = false;
    this.state = 'playing';
    this.input.enabled = true;
    this.input.clearState();
    this.ui.show('hud');
    if (this.options.hideHud) this.hideAllUi();
  }

  private hideAllUi(): void {
    document.getElementById('ui')!.style.display = 'none';
  }

  private connectionError(message: string): void {
    this.joinAbort?.abort();
    this.roundLoad = null;
    this.network?.disconnect();
    this.state = 'loading';
    this.tabHeld = false;
    this.input.clearState();
    this.weaponView?.setVisible(false);
    this.ui.setScope(0);
    this.input.enabled = false;
    this.input.releaseLock();
    this.ui.showConnectionError(message, () => void this.play(this.wantedMap), () => this.quitToMenu());
  }

  private spawn(): void {
    const map = this.map!;
    const player = this.player!;
    // free-for-all: any spawn point, never the same one twice in a row
    let i = Math.floor(Math.random() * map.spawns.length);
    if (map.spawns.length > 1 && i === this.lastSpawn) i = (i + 1) % map.spawns.length;
    this.lastSpawn = i;
    const sp = map.spawns[i];
    player.teleport({ x: sp.pos[0], y: sp.pos[1] + 0.2, z: sp.pos[2] }, sp.heading);
    if (this.options.cam) {
      const [x, y, z, h = 0, pitch = 0] = this.options.cam;
      player.teleport({ x, y, z }, h);
      player.pitch = (pitch * Math.PI) / 180;
    }
    this.loadout.reset();
    this.weaponView?.select(this.weapon.stats.id);
    this.health = PLAYER_MAX_HEALTH;
    this.cameraRig?.snapFov(this.settings.value.fov);
  }

  private async enterPlay(): Promise<void> {
    if (this.options.multiplayer && !this.network?.latest?.players.find((p) => p.id === this.network?.selfId)?.alive) return;
    this.audio.unlock();
    this.preSpawnPaused = false;
    this.cameraRig?.snapFov(this.settings.value.fov);
    await this.input.requestLock();
    if (this.options.multiplayer && !this.network?.latest?.players.find((p) => p.id === this.network?.selfId)?.alive) {
      this.input.releaseLock();
      return;
    }
    if (!this.input.pointerLocked) {
      // browsers refuse to re-lock for ~1 s after Esc; keep the game visible and hint
      this.state = 'playing';
      this.input.enabled = false;
      this.ui.show('hud');
      this.ui.setLockHint(true);
    }
  }

  private onPointerLock(locked: boolean): void {
    if (locked) {
      if (this.options.multiplayer && !this.network?.latest?.players.find((p) => p.id === this.network?.selfId)?.alive) {
        this.input.releaseLock();
        return;
      }
      if (this.state === 'start' || this.state === 'paused' || this.state === 'playing') {
        this.state = 'playing';
        this.input.enabled = true;
        this.input.clearState();
        this.ui.show('hud');
        this.ui.setLockHint(false);
        this.weaponView?.setVisible(true);
      }
    } else if (this.state === 'playing' && !this.options.autoplay) {
      this.state = 'paused';
      this.input.enabled = false;
      this.ui.show('pause', true);
    }
  }

  private quitToMenu(): void {
    const wasLoading = this.state === 'loading';
    this.joinAbort?.abort();
    this.joinAbort = null;
    this.roundLoad = null;
    if (this.loading?.signal?.aborted) this.loading = null;
    if (wasLoading) {
      this.remotePlayers.releaseVisibility();
      this.maps.unload();
      this.map = null;
      this.player = null;
      this.cameraRig = null;
    }
    this.preSpawnPaused = false;
    this.network?.disconnect();
    this.network = null;
    this.networkReady = false;
    this.loadedRound = -1;
    this.networkLife = -1;
    this.tabHeld = false;
    this.acc = 0;
    this.input.clearState();
    this.ui.setScope(0);
    this.remotePlayers.clear();
    this.state = 'menu';
    this.input.enabled = false;
    this.input.releaseLock();
    this.weaponView?.setVisible(false);
    this.effects?.clearDecals();
    this.ui.show('menu');
    void this.presence?.poll();
  }

  private applySettings(v: Readonly<Settings>, changed: (keyof Settings)[]): void {
    if (changed.includes('resolutionScale')) this.ctx.setResolutionScale(v.resolutionScale);
    if (changed.includes('masterVolume')) this.audio.setVolume(v.masterVolume);
    if (changed.includes('graphicsQuality')) {
      const p = GRAPHICS_PRESETS[v.graphicsQuality];
      this.postfx.apply(p);
      this.materials.setAnisotropy(p.anisotropy);
      this.map?.environment.setFog(p.fog);
    }
    if (changed.includes('shadowQuality') && this.map) {
      this.map.environment.applyShadowPreset(SHADOW_PRESETS[v.shadowQuality], this.ctx.camera);
    }
    if (changed.includes('fov')) {
      this.cameraRig?.snapFov(v.fov);
      // the camera is only driven while playing: when applied from the pause menu, show the new field of view right away
      if (this.state === 'paused') this.ctx.setFov(v.fov);
    }
  }

  // --- main loop -------------------------------------------------------------------------------
  private frame(rawDt: number): void {
    if (this.state === 'menu') { this.ui.update(rawDt); this.input.endFrame(); return; }
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, rawDt));
    this.fps.frames++;
    this.fps.time += rawDt;
    if (this.fps.time >= 0.5) {
      this.fps.value = this.fps.frames / this.fps.time;
      this.fps.frames = 0;
      this.fps.time = 0;
    }
    if (this.state === 'playing' && this.player && this.map) {
      this.simulate(dt);
    } else if (this.map && (this.state === 'start' || this.state === 'loading')) {
      this.menuCamera(dt);
    }
    this.updateScoreboard();
    this.remotePlayers.setPresentationVisible(this.ui.currentScreen === 'hud');
    if (this.network?.state === 'connected') this.remotePlayers.update(Date.now() + this.network.clockOffset - 100, dt);
    this.effects?.update(dt);
    this.ui.update(dt);
    this.updateHudMeta();
    this.ctx.scene.render();
    this.input.endFrame();
  }

  /** No tactical-map DOM is created. Release, blur and screen changes hide Tab immediately. */
  private updateScoreboard(): void {
    const show = (this.ui.currentScreen === 'hud' || this.ui.currentScreen === 'start')
      && (this.tabHeld || this.input.isDown('leaderboard')) && (!this.options.multiplayer || this.network?.state === 'connected');
    this.ui.scoreboard.setVisible(show);
    if (show) this.ui.scoreboard.update(this.network?.latest ?? null, this.network?.selfId ?? '', Date.now() + (this.network?.clockOffset ?? 0));
  }

  private menuCamera(dt: number): void {
    this.menuOrbit += dt * 0.04;
    const cam = this.ctx.camera;
    const [w, d] = this.map?.def.dimensions ?? [66, 66];
    const r = Math.max(w, d) * 0.52;
    cam.position.set(Math.sin(this.menuOrbit) * r, r * 0.62, Math.cos(this.menuOrbit) * r);
    cam.setTarget(new Vector3(0, 2, 0));
    this.ctx.setFov(70);
    this.weaponView?.setVisible(false);
  }

  private intent: MoveIntent = { ...NO_INTENT };
  private slideReleasePending = false;

  /** The weapon in hand. */
  get weapon(): Weapon {
    return this.loadout.current;
  }

  private simulate(dt: number): void {
    if (this.options.multiplayer && (this.network?.state !== 'connected' || !this.network.latest?.players.find((p) => p.id === this.network?.selfId)?.alive)) return;
    const player = this.player!;
    const rig = this.cameraRig!;
    const map = this.map!;
    const s = this.settings.value;
    const input = this.input;
    this.weaponView?.setVisible(true);

    const zoom = 1 + (this.weapon.stats.adsFovScale - 1) * this.weapon.ads;
    const events: WeaponEvent[] = [];
    // weapon switching: number keys, Q (previous weapon), mouse wheel
    for (let k = 0; k < this.loadout.weapons.length; k++) {
      if (input.wasPressed(`weapon${k + 1}` as 'weapon1')) this.loadout.select(k, events);
    }
    if (input.wasPressed('lastWeapon')) this.loadout.selectPrevious(events);
    if (input.wasPressed('nextWeapon')) this.loadout.cycle(1, events);
    if (input.wasPressed('prevWeapon')) this.loadout.cycle(-1, events);
    const look = input.takeMouseDelta();
    rig.applyLook(look.dx, look.dy, s.mouseSensitivity, s.invertY, zoom);
    this.weaponView?.addSway(look.dx, look.dy);

    const it = this.intent;
    it.x = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    it.z = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    it.slide = input.isDown('slide');
    // Preserve a quick physical release/repress even when both events fall between
    // fixed ticks. Send a neutral release tick before the new held press.
    if (input.wasPressed('slide') && player.slideHeld) this.slideReleasePending = true;
    it.aim = input.isDown('aim');
    let jumpEdge = input.wasPressed('jump');
    let fireEdge = input.wasPressed('fire');
    let reloadEdge = input.wasPressed('reload');

    for (const e of events) this.onWeaponEvent(e);
    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      it.slide = input.isDown('slide') && !this.slideReleasePending;
      this.slideReleasePending = false;
      it.jumpPressed = jumpEdge;
      const wasGrounded = player.grounded;
      player.fixedUpdate(FIXED_DT, it);
      this.network?.fixedInput(player, it, { trigger: input.isDown('fire'), reload: input.isDown('reload') });
      rig.onTick();
      if (jumpEdge && wasGrounded && !player.grounded && player.velocity.y > 0) this.sound('jump', 0.35);
      if (player.landedSpeed > 4) this.sound('land', Math.min(0.8, player.landedSpeed * 0.07));
      events.length = 0;
      this.loadout.update(
        FIXED_DT,
        {
          trigger: input.isDown('fire'),
          triggerPressed: fireEdge,
          reloadPressed: reloadEdge,
          aim: it.aim,
          moveFactor: player.horizontalSpeed / MOVEMENT.weaponMoveReference,
          airborne: !player.grounded,
          sprinting: false,
        },
        events,
      );
      for (const e of events) this.onWeaponEvent(e);
      map.targets.update(FIXED_DT);
      this.footsteps(FIXED_DT);
      if (!this.options.multiplayer && player.position.y < map.def.collision.killY) this.spawn();
      jumpEdge = fireEdge = reloadEdge = false;
      this.acc -= FIXED_DT;
    }
    const alpha = this.acc / FIXED_DT;
    const w = this.weapon;
    // sniper scope: the overlay fades in over the last part of the aim and replaces the weapon in view
    this.scope = w.stats.scope ? Math.max(0, Math.min(1, (w.ads - 0.72) / 0.22)) : 0;
    rig.update(dt, alpha, s.fov, zoom, this.scope);
    const shown = this.viewOverride ? ({ ...this.viewOverride, stats: w.stats } as unknown as Weapon) : w;
    this.weaponView?.update(dt, shown, { sprinting: false, bobX: rig.bobX, bobY: rig.bobY, crouch: player.crouch });
    this.weaponView?.setHidden(this.scope > 0.98);
    this.ui.setScope(this.scope);

    // HUD
    const aimDeg = w.spread({ moveFactor: player.horizontalSpeed / MOVEMENT.weaponMoveReference, airborne: !player.grounded });
    const spreadDeg = aimDeg + w.stats.pelletSpread;
    const px = (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan(this.ctx.camera.fov / 2)) * (this.ctx.engine.getRenderWidth() / 2);
    // render pixels -> CSS pixels; hidden while aimed (the sight has its own reticle) or switching
    const crosshair = w.ads < 0.6 && (w.action === 'idle' || w.action === 'cycle' || w.reloading);
    this.ui.setCrosshairSpread(px * this.ctx.engine.getHardwareScalingLevel(), crosshair);
    this.ui.setAmmo(w.ammo, w.reserve, w.stats.magazine, w.reloading, w.reloadProgress);
    this.ui.setWeaponSlots(this.options.multiplayer ? [w.stats.name] : this.loadout.weapons.map((x) => x.stats.name), this.options.multiplayer ? 0 : this.loadout.switchingTo ?? this.loadout.currentIndex);
    this.ui.setHealth(this.health, PLAYER_MAX_HEALTH);
  }

  private onWeaponEvent(e: WeaponEvent): void {
    switch (e.type) {
      case 'fire':
        this.fireShot(e.spread);
        break;
      case 'empty':
        this.sound('empty', 0.7);
        break;
      case 'shellIn':
        this.sound('shell_in', 0.55);
        break;
      case 'cue':
        if (e.cue === 'eject') this.ejectCase();
        else if (CUE_SOUNDS[e.cue]) this.sound(CUE_SOUNDS[e.cue], 0.55);
        break;
      case 'equipStart':
        this.weaponView?.select(this.weapon.stats.id);
        this.ui.setWeaponName(this.weapon.stats.name);
        this.sound('draw', 0.45);
        break;
    }
  }

  /** A spent case (or shotgun hull) out of the ejection port. */
  private ejectCase(): void {
    const p = this.player;
    if (!p) return;
    const v = p.velocity;
    this.weaponView?.eject(new Vector3(v.x, Math.max(0, v.y), v.z), p.position.y);
  }

  private fireShot(spreadDeg: number): void {
    const map = this.map!;
    const cam = this.ctx.camera;
    const w = this.weapon;
    const st = w.stats;
    this.stats.shots++;
    this.sound(`${st.id}_shot` as SoundName, st.id === 'rifle' ? 0.5 : 0.62);
    this.weaponView?.fire();
    this.cameraRig?.addRecoil(st.recoilPitch * (1 - w.ads * 0.4), st.recoilYaw);
    // self-loading rifle: the case flies out with every shot (pump and bolt guns eject when worked)
    if (st.cycleTime === 0) this.ejectCase();
    cam.computeWorldMatrix();
    // Environment impacts are cosmetic prediction. Only server shot results may
    // produce multiplayer player damage, scores or hit markers.
    const origin = cam.globalPosition.clone();
    const fwd = cam.getDirection(new Vector3(0, 0, -1)).normalize();
    const aim = applySpread({ x: fwd.x, y: fwd.y, z: fwd.z }, spreadDeg);
    const shot = { weapon: st.id, pellets: st.pellets, hits: 0, damage: 0, head: false, target: '' };
    for (let k = 0; k < st.pellets; k++) {
      const dir = st.pellets > 1 ? applySpread(aim, st.pelletSpread) : aim;
      const hit = map.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, st.range);
      if (!hit) continue;
      const end = new Vector3(hit.point.x, hit.point.y, hit.point.z);
      const normal = new Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      if (this.options.multiplayer) {
        this.effects?.impact(end, normal, k % 2 === 0 || st.pellets === 1);
        continue;
      }
      const t = map.targets.find(hit.collider);
      if (t) {
        const zone: HitZone = t.zone;
        const res = this.damage.tryApply(this.attacker, t.target, {
          bodyDamage: damageAt(st, end.subtract(origin).length()),
          point: hit.point,
          zone,
          weapon: st.id,
        });
        // steel: sparks, no hole
        this.effects?.burst(end.add(normal.scale(0.02)), normal, st.pellets > 1 ? 4 : 9);
        if (res.applied) {
          shot.hits++;
          shot.damage += res.amount;
          shot.head ||= zone === 'head';
          shot.target = t.target.id;
        }
      } else {
        this.effects?.impact(end, normal, k % 2 === 0 || st.pellets === 1);
      }
    }
    if (shot.hits > 0) {
      this.stats.hits++;
      if (shot.head) this.stats.headshots++;
      this.ui.hitMarker(shot.head);
      this.sound(shot.head ? 'hit_head' : 'hit', 0.65);
    }
    this.lastShot = shot;
  }

  private footsteps(dt: number): void {
    const p = this.player!;
    if (!p.grounded) return;
    const speed = p.horizontalSpeed;
    if (speed < 0.8) {
      this.stepDistance = Math.min(this.stepDistance, 1.2);
      return;
    }
    this.stepDistance += speed * dt;
    if (p.sliding) return;
    const stride = speed > MOVEMENT.walkSpeed + 0.5 ? 2.6 : p.crouch > 0.5 ? 1.6 : 2.1;
    if (this.stepDistance >= stride) {
      this.stepDistance = 0;
      const n = (1 + Math.floor(Math.random() * 4)) as 1 | 2 | 3 | 4;
      this.sound(`step${n}` as SoundName, p.crouch > 0.5 ? 0.12 : speed > MOVEMENT.walkSpeed + 0.5 ? 0.42 : 0.3);
    }
  }

  private sound(name: SoundName, volume: number): void {
    this.audio.play(name, { volume });
  }

  private updateHudMeta(): void {
    const s = this.settings.value;
    if (s.showFps) {
      const fps = Math.max(1, this.fps.value);
      this.ui.setFps(`${Math.round(fps)} FPS · ${(1000 / fps).toFixed(1)} ms`);
    } else {
      this.ui.setFps(null);
    }
    if (this.options.multiplayer) this.ui.setStats('');
    else if (this.state === 'playing') {
      const acc = this.stats.shots ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
      this.ui.setStats(`Targets down ${this.stats.downs} · Headshots ${this.stats.headshots} · Accuracy ${acc}%`);
    }
  }

  // --- automation hooks (used by tools/browser-test.mjs) ---------------------------------------
  debugApi() {
    return {
      ready: () => this.state === 'playing' && !!this.map && (!this.options.multiplayer || this.network?.state === 'connected'),
      network: () => ({ state: this.network?.state ?? 'idle', selfId: this.network?.selfId ?? '',
        snapshot: this.network?.latest ?? null, rendered: this.remotePlayers.inspect() }),
      networkReconnect: () => this.network?.reconnect(),
      networkLeave: () => this.quitToMenu(),
      state: () => this.state,
      loadingState: () => ({ round: this.loadedRound, networkReady: this.networkReady, mapLoad: this.loading?.id,
        roundLoad: !!this.roundLoad, sceneReady: this.ctx.scene.isReady() }),
      teleport: (x: number, y: number, z: number, heading = 0, pitch = 0) => {
        if (this.state === 'paused' && this.options.autoplay) this.state = 'playing';
        this.player?.teleport({ x, y, z }, heading);
        if (this.player) this.player.pitch = (pitch * Math.PI) / 180;
      },
      look: (headingDeg: number, pitchDeg: number) => {
        if (!this.player) return;
        this.player.yaw = PlayerController.headingToYaw(headingDeg);
        this.player.pitch = (pitchDeg * Math.PI) / 180;
      },
      hold: (action: Parameters<Input['simulate']>[0], held: boolean) => this.input.simulate(action, held),
      /** Place a mirror sphere (checks that image-based lighting lines up with the sky). */
      mirrorSphere: (x: number, y: number, z: number) => {
        const sphere = MeshBuilder.CreateSphere('debug-mirror', { diameter: 1.5, segments: 48 }, this.ctx.scene);
        sphere.position.set(x, y, z);
        const m = new PBRMaterial('debug-mirror', this.ctx.scene);
        m.metallic = 1;
        m.roughness = 0.02;
        m.albedoColor = new Color3(1, 1, 1);
        sphere.material = m;
      },
      /**
       * Two different-coloured quads in (almost exactly) the same plane: a deliberate z-fight, used to prove that the flicker
       * test (tools/dev-jitter.mjs) can actually detect one.
       */
      fightProbe: (x: number, y: number, z: number) => {
        for (const m of this.ctx.scene.meshes.filter((q) => q.name.startsWith('debug-fight:'))) m.dispose(false, true);
        for (const [i, c] of [Color3.Red(), Color3.Blue()].entries()) {
          const quad = MeshBuilder.CreatePlane(`debug-fight:${i}`, { size: 1.2, sideOrientation: Mesh.DOUBLESIDE }, this.ctx.scene);
          // 3 micrometres apart (the quad drawn first is the nearer one, so rounding decides which wins): far below the depth
          // buffer resolution, like the numerical noise of real coplanar geometry
          quad.position.set(x, y, z - i * 0.000003);
          const m = new StandardMaterial(`debug-fight:${i}`, this.ctx.scene);
          m.emissiveColor = c;
          m.disableLighting = true;
          m.backFaceCulling = false;
          quad.material = m;
        }
      },
      clearFightProbe: () => {
        for (const m of this.ctx.scene.meshes.filter((q) => q.name.startsWith('debug-fight:'))) m.dispose(false, true);
      },
      /** Detach the camera from the player (no physics) for screenshots; call teleport() to resume. */
      freeCam: (x: number, y: number, z: number, heading: number, pitch: number) => {
        this.state = 'paused';
        this.weaponView?.setVisible(false);
        const cam = this.ctx.camera;
        cam.position.set(x, y, z);
        cam.rotationQuaternion = Quaternion.RotationYawPitchRoll((-heading * Math.PI) / 180, (pitch * Math.PI) / 180, 0);
      },
      player: () => (this.player ? { ...this.player.position, grounded: this.player.grounded } : null),
      motion: () => (this.player ? { ...this.player.capture(), height: this.player.height,
        eyeHeight: this.player.eyeHeight, cameraY: this.ctx.camera.position.y } : null),
      characterAsset: () => this.remotePlayers.characters.inspect(),
      sceneTextureIds: () => this.ctx.scene.textures.map((t) => t.uniqueId),
      visibilityStats: () => this.remotePlayers.visibilityStats(),
      remoteOutlines: (enabled: boolean) => this.remotePlayers.setOutlinesEnabled(enabled),
      stats: () => ({
        fps: this.fps.value,
        frameMs: this.instrumentation.frameTimeCounter.lastSecAverage,
        drawCalls: this.instrumentation.drawCallsCounter.current,
        activeMeshes: this.ctx.scene.getActiveMeshes().length,
        totalVertices: this.ctx.scene.getTotalVertices(),
        map: this.map?.stats,
        mapId: this.map?.def.id ?? null,
        missingMaterials: [...this.materials.missing],
        shots: this.stats.shots,
        hits: this.stats.hits,
        downs: this.stats.downs,
        headshots: this.stats.headshots,
        ammo: this.weapon.ammo,
        weapon: this.weapon.stats.id,
      }),
      /** The weapon in hand and the loadout (ammo, action, aim, scope), for tests. */
      weapon: () => {
        const w = this.weapon;
        return {
          id: w.stats.id,
          name: w.stats.name,
          ammo: w.ammo,
          magazine: w.stats.magazine,
          reserve: Number.isFinite(w.reserve) ? w.reserve : 'infinite',
          action: w.action,
          progress: w.progress,
          ads: w.ads,
          scope: this.scope,
          slots: this.loadout.weapons.map((x) => ({ id: x.stats.id, ammo: x.ammo, action: x.action })),
          view: this.weaponView ? { ...this.weaponView.debug, shown: this.weaponView.currentId } : null,
          viewMeshes: this.weaponView?.meshes.filter((m) => m.isEnabled()).map((m) => m.name) ?? [],
        };
      },
      /**
       * Look at the view-model from outside (an orbit camera around the weapon; angles in degrees, radius in metres),
       * for checking the model from every side. null: back to the player's eyes.
       */
      inspectView: (alpha: number | null, beta = 80, radius = 0.9) => {
        const scene = this.ctx.scene;
        if (alpha === null) {
          scene.activeCamera = this.ctx.camera;
          return;
        }
        const root = scene.getTransformNodeByName('weapon-pivot');
        root?.computeWorldMatrix(true);
        const at = root ? root.getAbsolutePosition().clone() : this.ctx.camera.globalPosition.clone();
        let cam = scene.getCameraByName('debug-inspect') as ArcRotateCamera | null;
        cam ??= new ArcRotateCamera('debug-inspect', 0, 0, 1, at, scene);
        cam.minZ = 0.01;
        cam.fov = 0.6;
        cam.setTarget(at.add(new Vector3(0, 0.0, 0)));
        cam.alpha = (alpha * Math.PI) / 180;
        cam.beta = (beta * Math.PI) / 180;
        cam.radius = radius;
        scene.activeCamera = cam;
      },
      /** Change a weapon's view-model placement live (hip position, rotation, sight distance) while tuning. */
      tuneView: (id: keyof typeof RIG_CONFIGS, patch: Record<string, unknown>) => Object.assign(RIG_CONFIGS[id], patch),
      /** Ejected cases in the world: enabled count and positions (tests). */
      casingInfo: () =>
        this.ctx.scene.meshes
          .filter((m) => m.name.startsWith('casing:') && m.isEnabled())
          .map((m) => ({ name: m.name, x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(3), z: +m.position.z.toFixed(2) })),
      /** Hold the muzzle flash on (screenshots). */
      holdFlash: (on: boolean) => this.weaponView?.holdFlash(on),
      /** Freeze the view-model at an action and progress (null: back to the live weapon). */
      viewPose: (action: Weapon['action'] | null, progress = 0, ads = 0) => {
        this.viewOverride = action ? { action, progress, ads } : null;
      },
      /** Switch weapons as the number keys do (0-based slot). */
      selectWeapon: (i: number) => this.loadout.select(i),
      /** The last shot's pellets, hits, damage and whether it was a headshot. */
      lastShot: () => ({ ...this.lastShot }),
      /** Sounds asked for recently, newest last (works without audio output). */
      sounds: () => [...this.audio.recent],
      /** Turn the view toward a world point (tests aim at a target's head or body). */
      aimAt: (x: number, y: number, z: number) => {
        if (!this.player) return;
        const cam = this.ctx.camera.globalPosition;
        const dx = x - cam.x;
        const dy = y - cam.y;
        const dz = z - cam.z;
        this.player.yaw = Math.atan2(-dx, -dz);
        this.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      },
      /** A practice target's head and body centres (world space). */
      targetPoints: (id: string) => {
        const t = this.map?.targets.targets.find((q) => q.id === id);
        if (!t) return null;
        const c = (k: 'headCollider' | 'bodyCollider') => ({ x: t[k].cx, y: t[k].cy, z: t[k].cz });
        return { head: c('headCollider'), body: c('bodyCollider'), health: t.health, state: t.state };
      },
      setSetting: (patch: Partial<Settings>) => this.settings.update(patch),
      /** Load a map for development/testing and resolve with the loaded map's id. */
      loadMap: (id: string) => this.requestMap(id).then((m) => m.def.id),
      /** Play a map as the Play button does (loads it if needed, then spawns). */
      play: (id: string) => this.play(id).then(() => this.map?.def.id ?? null),
      /** The loaded map's gameplay data (for tests that need spawn, target and safe-zone positions). */
      mapInfo: () => {
        const l = this.map?.def.layout;
        return l
          ? {
              id: l.id,
              spawns: l.spawns,
              targets: l.targets,
              playArea: l.playArea,
              walls: l.walls.map((w) => ({ id: w.id, style: w.style ?? null })),
            }
          : null;
      },
      /** Scene object counts, for checking that map switches do not leak. */
      memory: () => {
        const scene = this.ctx.scene;
        return {
          meshes: scene.meshes.length,
          skeletons: scene.skeletons.length,
          animationGroups: scene.animationGroups.length,
          materials: scene.materials.length,
          textures: scene.textures.length,
          geometries: scene.geometries.length,
          lights: scene.lights.length,
          transformNodes: scene.transformNodes.length,
          library: this.materials.counts(),
        };
      },
      scoreboard: () => ({ visible: this.ui.scoreboard.visible, text: this.ui.scoreboard.root.innerText }),
      spawn: () => this.spawnSelected(),
      /** Feed the teammate registry like a network client would (automated tests only; nothing calls it in play). */
      remotePlayer: (p: RemotePlayer) => this.teammates.update(p),
      clearRemotePlayers: () => this.teammates.clear(),
      /** The applied settings (what the game is using and what is saved). */
      settings: () => ({ ...this.settings.value }),
      /** What the engine is actually using right now, for checking that Apply reaches the game systems. */
      live: () => ({
        fovDeg: (this.ctx.camera.fov * 180) / Math.PI,
        resolutionScale: this.ctx.renderScale,
        volume: this.audio.masterVolume,
        fpsVisible: getComputedStyle(this.ui.fpsElement).display !== 'none',
      }),
      /** Show the pause menu as if pointer lock had been released (headless browsers cannot lock the pointer). */
      pause: () => {
        this.state = 'paused';
        this.input.enabled = false;
        this.input.releaseLock();
        this.ui.show('pause', true);
      },
      /** Raw world-space triangles of every batched mesh, for geometry audits (tools/dev-zfight.mjs). */
      dumpBatches: () =>
        this.ctx.scene.meshes
          .filter((m) => (m.metadata as { canonical?: string } | null)?.canonical)
          .map((m) => ({
            name: m.name,
            material: (m.metadata as { canonical: string }).canonical,
            alpha: m.material?.alpha ?? 1,
            origin: (m.metadata as { origin: { tri: number; name: string }[] }).origin,
            positions: Array.from(m.getVerticesData('position')!),
            indices: Array.from(m.getIndices()!),
          })),
      /** Summarise batched meshes using a canonical material (debugging aid). */
      inspectBatch: (material: string) =>
        this.ctx.scene.meshes
          .filter((m) => (m.metadata as { canonical?: string } | null)?.canonical === material)
          .map((m) => {
            const kinds = (m as Mesh).getVerticesDataKinds();
            const range = (k: string, stride: number) => {
              const d = m.getVerticesData(k);
              if (!d) return null;
              const lo = new Array(stride).fill(Infinity);
              const hi = new Array(stride).fill(-Infinity);
              for (let i = 0; i < d.length; i++) {
                lo[i % stride] = Math.min(lo[i % stride], d[i]);
                hi[i % stride] = Math.max(hi[i % stride], d[i]);
              }
              return { lo: lo.map((v) => +v.toFixed(2)), hi: hi.map((v) => +v.toFixed(2)) };
            };
            const mat = m.material as unknown as Record<string, unknown> & { name: string; isReady: (mesh: unknown) => boolean };
            const tex = (k: string) => (mat[k] as { name?: string; isReady?: () => boolean } | null)?.name ?? null;
            return {
              name: m.name,
              verts: m.getTotalVertices(),
              kinds,
              uv: range('uv', 2),
              normal: range('normal', 3),
              color: range('color', 4),
              enabled: m.isEnabled(),
              visible: m.isVisible,
              active: this.ctx.scene.getActiveMeshes().data.includes(m),
              bounds: m.getBoundingInfo().boundingSphere.radiusWorld,
              material: { name: mat.name, ready: mat.isReady(m), albedo: tex('albedoTexture'), orm: tex('metallicTexture'), metallic: mat.metallic, roughness: mat.roughness },
            };
          }),
    };
  }
}
