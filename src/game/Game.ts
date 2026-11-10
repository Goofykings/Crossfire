import {SniperZoom} from '../player/SniperZoom';
import {MeleeFeedback} from './melee/MeleeFeedback';
import {meleeBlocked,meleeClip,createMeleeState,stepMelee,MELEE} from '../../shared/melee';
import { CosmeticsClient } from '../network/CosmeticsClient';
import { PracticeClient,type MatchSession } from '../practice/PracticeClient';
import {PracticeChallenges} from '../practice/PracticeChallenges';
import {EnvironmentSimulation} from '../../shared/environment';
import type { PracticeSetup } from '../practice/config';
import { defaultEquipment, killEffect } from '../../shared/cosmetics';
import { MoneyBurst } from '../weapons/MoneyBurst';
import { visualCosmetic } from '../rendering/CosmeticAssets';
import { RoomClient } from '../network/RoomClient';
import type { RoomAdmission } from '../../shared/rooms';
import { BulletTrails } from '../weapons/BulletTrails';
import { unsafeMovement } from '../../shared/movementSafety';
import { GrenadeCharge } from '../../shared/grenadeCharge';
import { CareerClient } from '../network/CareerClient';
import { meshesReady } from '../core/assetReadiness';
import { abortable } from '../core/cancellation';
import { ArcRotateCamera, Color3, Mesh, MeshBuilder, PBRMaterial, Quaternion, SceneInstrumentation, StandardMaterial, Vector3 } from '@babylonjs/core';
import { AudioManager, type SoundName } from '../audio/AudioManager';
import { FIXED_DT, MAX_FRAME_DT, MOVEMENT, PLAYER_MAX_HEALTH } from '../config/constants';
import { SettingsStore, effectiveSettings, type Settings } from '../config/settings';
import { isTextInput } from '../config/keybindings';
import { GuestProfileStore } from '../config/guestProfile';
import { LastUsedWeapon } from '../config/lastUsedWeapon';
import { Input } from '../core/Input';
import { MapManager, type LoadedMap } from '../maps/MapManager';
import { DEFAULT_MAP_ID, getMap, MAPS } from '../maps/registry';
import { PlayerCamera } from '../player/PlayerCamera';
import { AimAssist } from '../player/AimAssist';
import { NO_INTENT, PlayerController, type MoveIntent } from '../player/PlayerController';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { PostFX } from '../rendering/PostFX';
import { graphicsPreset, SHADOW_PRESETS } from '../rendering/quality';
import { RenderContext } from '../rendering/RenderContext';
import { UI } from '../ui/UI';
import { Effects } from '../weapons/Effects';
import { GrenadeView } from '../weapons/GrenadeView';
import { GRENADE, advanceGrenade, throwGrenade, blastDamage, sweepSphere, type GrenadeEvent, type GrenadeState } from '../../shared/grenades';
import { applySpread, damageAt, rollDamage, pelletSpreadAt, weaponAdsFov, Loadout, WEAPONS, Weapon, type WeaponEvent } from '../weapons/Weapon';
import { RIG_CONFIGS, WEAPON_RENDER_GROUP, WeaponView } from '../weapons/WeaponView';
import { MeleeView } from '../weapons/MeleeView';
import type { MeleeClipName, MeleeStage } from './melee/MeleeAnimation';
import { DamageSystem, type Attacker, type HitZone } from './Damage';
import { TeammateRegistry, type RemotePlayer } from './Teammates';
import { MultiplayerClient } from '../network/MultiplayerClient';
import { RemotePlayers } from './RemotePlayers';
import { Presence } from '../network/Presence';
import { resolveMultiplayerBackend } from '../network/backendConfig';
import { weaponPreviews } from '../ui/WeaponPreviews';
import { HomeCharacter, type CharacterLabOptions } from '../ui/HomeCharacter';
import type { Elimination, Snapshot } from '../../shared/protocol';

type State = 'menu' | 'loading' | 'start' | 'playing' | 'paused' | 'spectating' | 'results';

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
  private cosmetics:CosmeticsClient|null=null;
  private shownCosmetic='';
  private career: CareerClient | null = null;
  readonly guestProfile = new GuestProfileStore();
  private readonly lastUsedWeapon = new LastUsedWeapon();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  readonly audio: AudioManager;
  readonly ui: UI;
  readonly materials: MaterialLibrary;
  readonly maps: MapManager;
  private readonly postfx: PostFX;
  private readonly instrumentation: SceneInstrumentation;
  map: LoadedMap | null = null;
  player: PlayerController | null = null;
  private cameraRig: PlayerCamera | null = null;
  private readonly aimAssist=new AimAssist();
  /** Rifle, shotgun, sniper and SMG (slots 1-4); infinite reserve ammunition, limited magazines. */
  readonly loadout = new Loadout(WEAPONS);
  private weaponView: WeaponView | null = null;
  /** First-person dual daggers (presentation; the combat layer drives equip/attack/unequip). */
  private readonly sniperZoom=new SniperZoom();
  private meleeView: MeleeView | null = null;
  private localMelee=createMeleeState();
  private meleeDebug=false;
  private meleeSoundSequence=-1;
  private meleeFlourishKey='';
  private meleeTogglePending=false;
  private meleeShown = false;
  private moneyView: MoneyBurst | null = null;
  private moneyWorld: MoneyBurst | null = null;
  private effects: Effects | null = null;
  private readonly trails: BulletTrails;
  private grenadeView: GrenadeView | null = null;
  private practiceGrenades: GrenadeState[] = [];
  private grenadeCount: number = GRENADE.perLife;
  private grenadeClick = false;
  private grenadeHeld = false;
  private readonly grenadeCharge = new GrenadeCharge();
  private grenadePointerHeld = false;
  private readonly damage = new DamageSystem();
  state: State = 'menu';
  private acc = 0;
  private health = PLAYER_MAX_HEALTH;
  private stepDistance = 0;
  private stats = { shots: 0, hits: 0, downs: 0, headshots: 0, grenadesThrown: 0, grenadeHits: 0 };
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
  private network: MatchSession | null = null;
  private practiceSetup:PracticeSetup|null=null;
  private onlineRequested=false;
  private onlineAbort:AbortController|null=null;
  private get localPractice(){return this.network instanceof PracticeClient?this.network:null;}
  private practiceChallenges:PracticeChallenges|null=null;
  private practiceDebug:import('../practice/PracticeDebug').PracticeDebug|null=null;
  private practiceDebugLoading=false;
  private leavingRoom:Promise<void>=Promise.resolve();
  private roomClient:RoomClient|null=null;
  private admission:RoomAdmission|null=null;
  private networkReady = false;
  private loadedRound = -1;
  private roundLoad: Promise<void> | null = null;
  private gameAssets: Promise<void> | null = null;
  private joinAbort: AbortController | null = null;
  private networkLife = -1;
  private appliedPlayerId = '';
  private tabHeld = false;
  private preSpawnPaused = false;
  private spectatingDeath: Elimination | null = null;
  private spectatorWeapon: Weapon | null = null;
  private spectatorFov = 90;
  private presence: Presence | null = null;
  private readonly multiplayerBackend = resolveMultiplayerBackend({
    VITE_MULTIPLAYER_PROVIDER: import.meta.env.VITE_MULTIPLAYER_PROVIDER,
    VITE_MULTIPLAYER_URL: import.meta.env.VITE_MULTIPLAYER_URL,
    VITE_CUSTOM_MULTIPLAYER_URL: import.meta.env.VITE_CUSTOM_MULTIPLAYER_URL,
  });
  private readonly remotePlayers: RemotePlayers;
  private readonly homeCharacter: HomeCharacter;
  private shownResult = '';
  private readonly dismissedResults = new Set<string>();

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    readonly options: GameOptions,
  ) {
    this.audio = new AudioManager(options.autoplay);
    this.ctx = new RenderContext(canvas, { preserveDrawingBuffer: options.autoplay });
    this.trails=new BulletTrails(this.ctx.scene);
    this.input = new Input(canvas);
    this.input.setBindings(this.settings.value.keyBindings);
    this.ui = new UI(uiRoot, this.settings, this.audio, this.guestProfile);
    this.homeCharacter = new HomeCharacter(uiRoot.querySelector('#menu')!);
    this.materials = new MaterialLibrary(this.ctx.scene);
    this.maps = new MapManager(this.ctx, this.materials, () => graphicsPreset(this.settings.value), !options.multiplayer);
    this.remotePlayers = new RemotePlayers(this.ctx.scene, uiRoot, this.materials);
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
    const s = effectiveSettings(this.settings.value);
    this.ctx.setResolutionScale(s.resolutionScale,s.chromebookMode);
    this.ctx.setFov(s.fov);
    this.audio.setVolume(s.masterVolume);
    this.audio.setSfxVolume(s.sfxVolume);
    this.postfx.apply(graphicsPreset(s));
    this.materials.setAnisotropy(graphicsPreset(s).anisotropy);
    this.materials.setUltra(!!graphicsPreset(s).ultraMaterials);
    this.remotePlayers.setAnimationDetail(s.chromebookMode ? .25 : s.graphicsQuality === 'low' ? .5 : 1);
    this.remotePlayers.setTrailsReduced(s.chromebookMode);
    this.materials.setChromebook(s.chromebookMode);
    this.settings.onChange((v, changed) => this.applySettings(v, changed));

    // Public Play has no silent practice fallback.
    this.input.onWheel=direction=>{if(this.state!=='playing'||!this.weapon.stats.scope||this.weapon.ads<.72||meleeBlocked(this.network?.melee??this.localMelee))return false;this.sniperZoom.scroll(-direction);return true;};
    this.input.onClear = () => {this.meleeTogglePending=false;this.cancelGrenadeCharge();};
    this.ui.onGrenade = (held, cancel) => {
      if (cancel) { this.cancelGrenadeCharge(); return; }
      if (this.state !== 'playing') return;
      this.grenadePointerHeld = held;
      if (held) this.grenadeClick = true;
    };
    this.ui.onPlay = () => void this.play(this.wantedMap);
    if(this.options.multiplayer)this.ui.onModeSelect=()=>this.ui.rooms.open();
    this.ui.rooms.onOnline=()=>{this.practiceSetup=null;this.enableOnline();};
    this.ui.rooms.onPractice=()=>{this.stopOnline();this.ui.practice.open();};
    this.ui.practice.onStart=setup=>{this.stopOnline();this.practiceSetup={...setup};this.admission=null;void this.play(setup.mapId);};
    this.ui.rooms.onAdmission=admission=>{this.practiceSetup=null;this.admission=admission;void this.play(admission.room.mapId);};
    this.ui.onStart = () => void this.spawnSelected();
    this.ui.onResume = () => {
      if (this.preSpawnPaused) { this.preSpawnPaused = false; this.showPreSpawn(); }
      else void this.enterPlay();
    };
    this.ui.onQuit = () => this.quitToMenu();
    this.ui.onCancelLoading = () => {const practice=!!this.practiceSetup,selected=!!this.admission;this.quitToMenu();if(practice)this.ui.practice.open();else if(selected)this.ui.rooms.open();};
    this.ui.onChatSend = (text) => this.network?.sendChat(text) ?? false;
    this.ui.onChatClose = () => {
      if (this.state !== 'playing') return;
      this.input.clearState();
      if (this.options.autoplay) this.input.enabled = true;
      else void this.input.requestLock().then(() => { if (!this.input.pointerLocked && this.state === 'playing') this.ui.setLockHint(true); });
    };
    this.input.lockListeners.add((locked) => this.onPointerLock(locked));
    this.ctx.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.ui.chatOpen && !this.input.pointerLocked && !this.options.autoplay) void this.input.requestLock();
    });
    window.addEventListener('beforeunload', (e) => {
      // Ask before leaving mid-game through a browser shortcut
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'spectating') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('pagehide', () => { this.network?.disconnect(false); this.presence?.dispose(); this.career?.dispose(); });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted&&this.onlineRequested&&!this.localPractice) { this.presence?.start(); this.career?.start(() => this.onlineRequested&&!this.localPractice&&this.ui.currentScreen === 'menu'); }
      if (e.persisted && this.network) void this.network.connect().catch((error) => this.connectionError((error as Error).message));
    });
    window.addEventListener('keyup', (e) => { if (this.input.matches('leaderboard', e.code)) { this.tabHeld = false; this.ui.scoreboard.setVisible(false); } });
    window.addEventListener('mouseup', (e) => { if (this.input.matches('leaderboard', `Mouse${e.button}`)) { this.tabHeld = false; this.ui.scoreboard.setVisible(false); } });
    window.addEventListener('blur', () => { this.tabHeld = false; this.ui.scoreboard.setVisible(false); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.tabHeld = false; this.input.clearState(); this.ui.scoreboard.setVisible(false); } });
    window.addEventListener('keydown', (e) => {
      if (this.ui.chatOpen || isTextInput(e.target)) return;
      if (this.input.matches('chat', e.code) && this.state === 'playing' && !e.repeat) {
        e.preventDefault();
        if (this.localPractice||this.network?.state !== 'connected') this.ui.showToast('Chat is available in multiplayer', 'warn');
        else { this.input.enabled = false; this.input.clearState(); this.ui.openChat(); this.input.releaseLock(); }
        return;
      }
      if (this.input.matches('pause', e.code) && this.state === 'playing' && !e.repeat) {
        e.preventDefault(); this.state = 'paused'; this.input.enabled = false; this.input.clearState(); this.input.releaseLock(); this.ui.show('pause', true);
      }
      if (this.input.matches('pause', e.code) && this.state === 'start' && !this.ui.spawnPending && (this.ui.currentScreen === 'start' || this.ui.currentScreen === 'weapons')) {
        this.preSpawnPaused = true;
        this.state = 'paused';
        this.tabHeld = false;
        this.ui.show('pause');
      }
      if (this.input.matches('leaderboard', e.code) && (this.ui.currentScreen === 'hud' || this.ui.currentScreen === 'start' || this.ui.currentScreen === 'spectate')) {
        e.preventDefault();
        this.tabHeld = true;
      }
      if (e.code === 'F3') this.settings.update({ showFps: !this.settings.value.showFps });
      if (e.code === 'F2' && this.map && this.state === 'playing') void this.map.toggleCollisionDebug();
      if(import.meta.env.DEV&&e.code==='F4'&&!e.repeat&&this.localPractice){e.preventDefault();void this.togglePracticeDebug();}
    });
    this.ctx.canvas.addEventListener('mousedown', (e) => {
      if (this.ui.chatOpen) return;
      if (this.state === 'playing' && this.input.matches('chat', `Mouse${e.button}`)) {
        e.preventDefault();
        if (this.localPractice||this.network?.state !== 'connected') this.ui.showToast('Chat is available in multiplayer', 'warn');
        else { this.input.enabled = false; this.input.clearState(); this.ui.openChat(); this.input.releaseLock(); }
        return;
      }
      if (this.state === 'playing' && this.input.matches('pause', `Mouse${e.button}`)) {
        e.preventDefault(); this.state = 'paused'; this.input.enabled = false; this.input.clearState(); this.input.releaseLock(); this.ui.show('pause', true);
      }
    });

    const first = MAPS.some((m) => m.id === this.options.map) ? this.options.map! : DEFAULT_MAP_ID;
    this.ui.show('menu');
    this.presence = new Presence(this.multiplayerBackend.ok ? this.multiplayerBackend.url : '', (count) => this.ui.setOnline(count),
      () => this.ui.currentScreen === 'menu');
    if (this.multiplayerBackend.ok) {
      this.career = new CareerClient(this.multiplayerBackend.url);
      this.roomClient=new RoomClient(this.multiplayerBackend.url,async()=>{await this.career!.ensure();const token=this.career!.joinCredential();if(!token)throw Error('A guest profile is required. Retry shortly.');return token;});this.ui.rooms.client=this.roomClient;
      this.ui.leaderboard.request = (period,metric,signal) => {this.enableOnline();return this.career!.statistics(period,metric,signal);};
      this.cosmetics=new CosmeticsClient(this.multiplayerBackend.url,this.career);this.ui.cosmetics.client=this.cosmetics;
      this.ui.cosmetics.onRefreshAccount=()=>{this.enableOnline();void this.career!.ensure().catch(()=>{});};
      this.cosmetics.onChange=()=>{if(this.weaponView&&this.cosmetics?.view)void this.weaponView.setCosmetics(this.cosmetics.view.equipped).then(()=>{if(this.map)this.excludeViewFromSun(this.map);}).catch(error=>this.ui.showToast((error as Error).message,'warn'));};
      this.career.onChange = () => {this.ui.challenges.set(this.career!.view, this.career!.error, this.career!.temporary);this.ui.cosmetics.setBalance(this.career!.view?.gems??null);};
      this.ui.challenges.onRetry = this.ui.challenges.onReset = () => {this.enableOnline();void this.career?.ensure().catch(() => {});};
      this.ui.challenges.set(null,'Online data not loaded.');
    } else this.ui.challenges.set(null, 'Challenges unavailable: check multiplayer configuration.');
    this.ctx.engine.runRenderLoop(() => this.frame(this.ctx.engine.getDeltaTime() / 1000));
    await this.ui.ensureGuestProfile();
    if (this.options.autoplay) await this.play(first);
  }

  /** Offline entry cannot start account/directory/presence requests. Online features
   * opt in explicitly; Practice cancels polling and never receives a reward adapter. */
  private enableOnline():void {
    if(this.practiceSetup||this.localPractice||this.onlineRequested)return;
    this.onlineRequested=true;const abort=new AbortController();this.onlineAbort=abort;
    this.presence?.start();this.career?.start(()=>this.onlineRequested&&!this.localPractice&&['menu','shop','locker'].includes(this.ui.currentScreen));
    void this.career?.ensure().then(()=>{abort.signal.throwIfAborted();return this.cosmetics?.load(abort.signal);}).catch(()=>{});
  }
  private stopOnline():void {this.onlineRequested=false;this.onlineAbort?.abort();this.onlineAbort=null;this.presence?.dispose();this.career?.dispose();this.ui.rooms.cancel();}

  private async togglePracticeDebug(){
    if(this.practiceDebug){this.practiceDebug.dispose();this.practiceDebug=null;return;}
    if(this.practiceDebugLoading)return;this.practiceDebugLoading=true;const session=this.localPractice;
    try{const {PracticeDebug}=await import('../practice/PracticeDebug');if(session&&session===this.localPractice)this.practiceDebug=new PracticeDebug();}finally{this.practiceDebugLoading=false;}
  }

  /** Playable maps and environments are loaded only when entering the game. */
  private prepareGameAssets(signal?: AbortSignal): Promise<void> {
    if (this.gameAssets) return abortable(this.gameAssets, signal);
    let effects: Effects | null = null;
    let view: WeaponView | null = null;
    let melee: MeleeView | null = null;
    let grenades: GrenadeView | null = null;
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
      melee = new MeleeView(this.ctx, this.remotePlayers.meleeLibrary); this.meleeView = melee;
      melee.flourishHandler = () => this.sound('melee_flourish', .14);
      melee.setReducedTrails(this.settings.value.chromebookMode);
      grenades = new GrenadeView(this.ctx.scene); this.grenadeView = grenades;
      this.remotePlayers.setSmokeVisibility((from, to) => this.grenadeView?.obscures(from, to) ?? false);
      this.ui.setLoading(0, 'Loading weapons and character');
      await Promise.all([grenades.load(this.materials, signal), view.load(signal), effects.loadCasings(this.materials, signal), this.remotePlayers.prepare(signal)]);
      await melee.load(signal);
      await melee.setCosmetic(this.cosmetics?.view?.equipped.melee);
      signal?.throwIfAborted();
      this.ui.setLoading(0, 'Loading weapon materials');
      await this.materials.ready(signal);
      await view.setCosmetics(this.cosmetics?.view?.equipped??defaultEquipment());
      await weaponPreviews((id, url) => this.ui.setWeaponPreview(id, url, signal), signal);
      signal?.throwIfAborted();
      this.ui.setWeaponName(this.weapon.stats.name);
    })().catch((error) => {
      grenades?.dispose();
      if (this.grenadeView === grenades) this.grenadeView = null;
      view?.dispose();
      melee?.dispose();
      if (this.meleeView === melee) this.meleeView = null;
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
    const add = [...this.weaponView.meshes, ...(this.meleeView?.meshes ?? [])].filter((m) => !list.includes(m));
    const bad = add.filter((m) => typeof (m as unknown as { _resyncLightSource?: unknown })._resyncLightSource !== 'function');
    if (bad.length) console.warn('[crossfire] not meshes:', bad.map((m) => `${m.name}:${m.getClassName?.()}`).join(', '));
    list.push(...add.filter((m) => !bad.includes(m)));
  }

  private async loadMap(id: string, signal?: AbortSignal): Promise<LoadedMap> {
    const def = getMap(id);
    this.grenadeView?.clear(); this.practiceGrenades = [];
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
    if (this.options.multiplayer) this.remotePlayers.prepareVisibility(map.world);
    this.player = new PlayerController(map.world);
    this.cameraRig = new PlayerCamera(this.ctx, this.player);
    const s = effectiveSettings(this.settings.value);
    map.environment.applyShadowPreset(SHADOW_PRESETS[s.shadowQuality], this.ctx.camera);
    this.excludeViewFromSun(map);
    map.environment.applyGraphicsPreset(graphicsPreset(s));
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
    this.effects?.clearDecals(); this.trails.clear();
    console.info('[crossfire] map loaded', map.stats);
    return map;
  }

  async play(id: string): Promise<void> {
    await this.ui.ensureGuestProfile();
    if (this.state === 'loading' && this.ui.currentScreen === 'loading') return;
    this.joinAbort?.abort();
    await this.leavingRoom;
    await this.network?.leaveRoom();
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
    this.homeCharacter.setVisible(false);
    this.ui.setLoading(0, 'Opening match');
    this.ui.show('loading');
    try {
      if (this.options.multiplayer||this.practiceSetup) {
        let network:MatchSession;
        if(this.practiceSetup){
          this.ui.setPractice(true);await this.prepareGameAssets(signal);await this.requestMap(id,signal);signal.throwIfAborted();
          this.map!.props.resetSynchronization();
          network=new PracticeClient(this.practiceSetup,{world:this.map!.world,layout:this.map!.def.layout,revision:this.map!.revision,environment:new EnvironmentSimulation(this.map!.props.definition,this.map!.world)},this.guestProfile.value.username);
          if(this.career){this.practiceChallenges=new PracticeChallenges(this.career,(network as PracticeClient).simulation);void this.practiceChallenges.start();}
        }else{
          this.ui.setPractice(false);this.enableOnline();
          if (!this.multiplayerBackend.ok) throw new Error(this.multiplayerBackend.error);
          await this.career?.ensure().catch(() => {});signal.throwIfAborted();
          network = new MultiplayerClient(this.admission?this.roomClient!.socket(this.admission.room.id):this.multiplayerBackend.url, () => this.guestProfile.value.username,
            { ...(this.admission?{roomTicket:this.admission.ticket}:{}),debug: new URLSearchParams(location.search).has('networkDebug'), profileToken: () => this.career?.joinCredential(), profileScope: () => this.career?.sessionScope() });
        }
        this.network = network;
        network.onRoomExit=message=>{if(this.network===network){this.quitToMenu();this.ui.rooms.open(message);}};
        network.onCareer = profile => { if (!signal.aborted && this.network === network) this.career?.accept(profile); };
        network.onChat = (message) => {
          if (signal.aborted || this.network !== network) return;
          this.ui.addChat(message.name, message.text);
        };
        network.onSystem = message => {
          if (!signal.aborted && this.network === network) this.ui.addChat('Server', `${message.name} joined.`, true);
        };
        network.onChatError = (message) => { if (!signal.aborted && this.network === network) this.ui.showToast(message, 'warn'); };
        network.onShot = (shot) => {
          if (signal.aborted || this.network !== network) return;
          if(this.map && this.state!=='loading' && this.state!=='results')this.trails.shot(shot);
          if (shot.shooterId !== network.selfId && ['playing','spectating','paused','start'].includes(this.state)) {
            this.recentCombat.set(shot.shooterId, Date.now() + network.clockOffset);
            this.remotePlayers.fire(shot.shooterId, shot.weapon, Date.now() + network.clockOffset);
            const shooter=network.latest?.players.find(p=>p.id===shot.shooterId);
            const origin=this.remotePlayers.muzzle(shot.shooterId)??shot.traces?.[0]?.from
              ??(shooter?{x:shooter.motion.position.x,y:shooter.motion.position.y+MOVEMENT.standEye,z:shooter.motion.position.z}:null);
            if(origin)this.audio.playSpatial(`${shot.weapon}_shot` as SoundName,origin);
            const watching=this.state==='spectating'&&this.spectatingDeath?.killerId===shot.shooterId;
            if(watching&&this.weaponView?.currentId===shot.weapon)this.weaponView.fire();
          }
          const self = network.latest?.players.find((p) => p.id === network.selfId);
          const received = shot.hits.find((h) => h.id === network.selfId && h.life === self?.life);
          if (received) this.ui.damage.hit(received.direction, received.amount);
          if (shot.shooterId !== network.selfId || !shot.hits.length) return;
          const head = shot.hits.some((h) => h.head);
          this.stats.hits++;
          if (head) this.stats.headshots++;
          this.ui.hitMarker(head);
          this.sound(head ? 'hit_head' : 'hit', .65);
          this.lastShot = { weapon: shot.weapon, pellets: WEAPONS.find((w) => w.id === shot.weapon)!.pellets,
            hits: shot.hits.length, damage: shot.hits.reduce((n, h) => n + h.amount, 0), head, target: shot.hits[0].id };
        };
        network.onEnvironment=(frame)=>{if(!signal.aborted&&this.network===network&&this.networkReady&&frame.roundId===this.loadedRound)this.map?.props.sync(frame);};
        const meleeFeedback=new MeleeFeedback();
        network.onMelee=(event)=>{
          if(signal.aborted||this.network!==network)return;
          if(event.roundId!==this.loadedRound||!this.networkReady||!meleeFeedback.accept(event,Date.now()+network.clockOffset))return;
          const selfId=network.selfId,shooter=network.latest?.players.find(p=>p.id===event.shooterId);
          this.remotePlayers.meleeImpact(event);
          if(event.shooterId!==selfId&&shooter?.life===event.life)this.audio.playSpatial(('melee_swing'+event.stage) as SoundName,shooter.motion.position,.32);
          const hit=event.hits.find(h=>h.amount>0);
          if(hit){
            if(event.shooterId===selfId&&event.life===this.networkLife){this.ui.hitMarker(false);this.sound('melee_impact',.55);this.cameraRig?.meleeHit(event.stage);}
            else {const target=network.latest?.players.find(p=>p.id===hit.id&&p.life===hit.life);if(target)this.audio.playSpatial('melee_impact',target.motion.position,.42);}
          }
          for(const hit of event.hits)if(hit.amount>0&&hit.id===selfId&&hit.life===this.networkLife){this.ui.damage.hit(hit.direction,hit.amount);}
        };
        network.onGrenade = (event) => {
          if (!signal.aborted && this.network === network && this.networkReady) this.presentGrenade(event);
        };
        network.onElimination = (event) => {
          if (signal.aborted || this.network !== network) return;
          this.remotePlayers.eliminate(event);
          if(event.assists?.some(a=>a.id===network.selfId))this.ui.showToast('+50 ASSIST','blue',1.8);
          if (event.killerId === network.selfId && event.victimId !== network.selfId && event.award) this.ui.grenadeReward();
          if (network.latest) { this.ui.combatFeed.add(event, network.latest, network.selfId); this.killEffect(event, network.latest, network.selfId); }
        };
        network.onSnapshot = (snapshot) => { if (!signal.aborted && this.network === network) this.acceptSnapshot(snapshot); };
        network.onState = (state, message) => {
          if (signal.aborted || this.network !== network) return;
          if (state !== 'connected') { this.cancelGrenadeCharge(); this.remotePlayers.clear(); this.ui.scoreboard.setVisible(false); }
          if (state === 'connected' && !this.networkReady) {
            void this.prepareNetworkMap().catch((e) => { if (!signal.aborted) this.connectionError((e as Error).message); });
          }
          if (state === 'reconnecting') this.ui.showToast(message ?? 'Reconnecting…', 'warn', 5);
          if (state === 'error') {if(this.admission){this.quitToMenu();this.ui.rooms.open(message??'This room is unavailable. Choose another room.');}else this.connectionError(message ?? 'Multiplayer connection failed');}
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
      this.ui.setLoading(0, 'Preparing weapons and character shaders');
      await Promise.all([meshesReady(this.weaponView?.meshes ?? [], signal), this.remotePlayers.ready(signal)]);
      signal.throwIfAborted();
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
    if (network.state !== 'connected') return Promise.resolve();
    if (network.latest && this.presentRoundResult(network.latest)) return Promise.resolve();
    if (this.roundLoad) return this.roundLoad;
    let failed = false;
    const work = (async () => {
      this.grenadeView?.clear();
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
        this.map!.props.resetSynchronization();
        this.ui.setLoading(0, 'Preparing weapons and character shaders');
        await this.materials.ready(signal);
        await Promise.all([meshesReady(this.weaponView?.meshes ?? [], signal), this.remotePlayers.ready(signal)]);
        signal.throwIfAborted();
        if (!network.latest || network.state !== 'connected') return;
        if (target.roundId !== network.latest.roundId || target.mapId !== network.latest.mapId) continue;
        this.loadedRound = target.roundId;
        this.networkReady = true;
        this.acceptSnapshot(network.latest);
        if (this.ui.currentScreen === 'results') return;
        this.ui.setMapTitle(this.map!.def.name, (this.localPractice?'Practice · ':'')+(target.match.mode === 'teams' ? 'Teams' : target.match.mode === 'ffa' ? 'Free for all' : 'Public match'));
        this.excludeViewFromSun(this.map!);
        const self = network.latest.players.find((p) => p.id === network.selfId);
        if (!self) throw new Error('Server did not assign a player');
        if (self.alive) {
          if (this.options.autoplay) this.activateWithoutLock();
          else { this.state = 'paused'; this.ui.show('pause'); }
        } else if (self.death) this.beginSpectating(self.death);
        else this.showPreSpawn();
        return;
      }
    })().catch((error) => { failed = true; throw error; }).finally(() => {
      if (this.roundLoad === work) this.roundLoad = null;
      // A reconnect can complete while an interrupted asset load still owns
      // roundLoad. Retry that load once its old promise releases ownership.
      if (!failed && !signal.aborted && this.network === network && network.state === 'connected'
        && !this.networkReady && this.state === 'loading') {
        queueMicrotask(() => { void this.prepareNetworkMap().catch((e) => {
          if (!signal.aborted) this.connectionError((e as Error).message);
        }); });
      }
    });
    this.roundLoad = work;
    return work;
  }

  /** Legendary Rich kill effect. Cosmetic and local: it reads the killer's synchronized
   * cosmetic from the snapshot, so other players nearby see it too without new messages. */
  private killEffect(event: Elimination, snapshot: Snapshot, selfId: string | null): void {
    if (!event.killerId || event.killerId === event.victimId) return;
    const killer = snapshot.players.find((p) => p.id === event.killerId);
    if (!killer?.weapon || killEffect(event.weapon==='melee'?killer.meleeCosmeticId:visualCosmetic(killer.weapon, killer.cosmeticId).id) !== 'money') return;
    if (event.killerId === selfId) { this.emitMoney(null); return; }
    const at = this.remotePlayers.muzzle(event.killerId);
    if (at && at.subtract(this.ctx.camera.globalPosition).length() < 45) this.emitMoney(at);
  }
  /** Creates (once) and pre-compiles both Rich effect emitters; called when a match weapon loads. */
  private prepareMoney(): void {
    const scene = this.ctx.scene;
    if (!this.moneyView || this.moneyView.meshes()[0].isDisposed()) {
      this.moneyView = new MoneyBurst(scene, { parent: this.ctx.camera, group: WEAPON_RENDER_GROUP, scale: .5, pop: .72, size: 1.5 });
      void this.moneyView.warm().catch(() => {});
    }
    if (!this.moneyWorld || this.moneyWorld.meshes()[0].isDisposed()) { this.moneyWorld = new MoneyBurst(scene, { scale: 1.7 }); void this.moneyWorld.warm().catch(() => {}); }
  }
  private emitMoney(world: Vector3 | null): void {
    const camera = this.ctx.camera;
    if (!world) {
      if (!this.weaponView) return;
      // The gun sits ~0.4 m from the eye, so the camera-space burst is scaled down (size,
      // speed and gravity) to stay framed around it instead of leaving the screen.
      this.prepareMoney();
      // Camera space (looking down -Z): pop over the receiver, lower right, mostly toward the
      // hand side so the burst frames the gun without covering the crosshair.
      const muzzle = Vector3.TransformCoordinates(this.weaponView.muzzleWorld(), camera.getViewMatrix());
      this.moneyView!.emit(new Vector3(muzzle.x * .3 + .12, muzzle.y * .3 + .02, muzzle.z * .3 - .26));
      return;
    }
    this.prepareMoney();
    this.moneyWorld!.emit(world.add(new Vector3(0, .25, 0)));
  }
  private acceptSnapshot(snapshot: Snapshot): void {
    if (this.presentRoundResult(snapshot) || this.state === 'results') return;
    if (!this.networkReady || !this.player || !this.map || this.network?.state !== 'connected') return;
    if (snapshot.roundId !== this.loadedRound || snapshot.mapId !== this.map.def.id) {
      const signal = this.joinAbort?.signal;
      void this.prepareNetworkMap().catch((e) => { if (!signal?.aborted) this.connectionError((e as Error).message); });
      return;
    }
    if (this.map.revision !== snapshot.mapVersion) { this.network.disconnect(); this.connectionError('Map assets differ from the server. Rebuild the matching client and server.'); return; }
    const self = snapshot.players.find((p) => p.id === this.network!.selfId);
    if(this.network.environment)this.map.props.sync(this.network.environment);
    this.grenadeView?.sync(snapshot.grenades);
    for (const explosion of snapshot.explosions) this.grenadeView?.explode(explosion, snapshot.serverTime);
    this.ui.combatFeed.updatePerspective(snapshot, this.network.selfId);
    this.remotePlayers.snapshot(snapshot, this.network.selfId);
    if (!self) return;
    this.grenadeCount = self.grenades; this.ui.setGrenades(self.grenades);
    if(!self.alive){this.network.melee=createMeleeState();this.meleeDebug=false;}
    this.health = self.health;
    this.ui.setHealth(self.health, PLAYER_MAX_HEALTH);
    if (self.alive) {
      if(self.weapon&&self.cosmeticId&&this.shownCosmetic!==`${self.weapon}:${self.cosmeticId}`){this.shownCosmetic=`${self.weapon}:${self.cosmeticId}`;void this.weaponView?.setCosmetic(self.weapon,self.cosmeticId).then(()=>{if(this.map)this.excludeViewFromSun(this.map);this.prepareMoney();}).catch(error=>this.ui.showToast((error as Error).message,'warn'));}
      if ((self.life !== this.networkLife || self.id !== this.appliedPlayerId) && self.weapon) {
        this.lastUsedWeapon.remember(self.weapon);
        this.ui.damage.clear();
        this.networkLife = self.life;
        this.appliedPlayerId = self.id;
        this.player.restore(self.motion);
        this.loadout.reset(WEAPONS.findIndex((w) => w.id === self.weapon), true);
        this.weaponView?.select(self.weapon);
        this.network.melee=structuredClone(self.combat.melee??createMeleeState());this.localMelee=createMeleeState();this.meleeDebug=false;this.meleeSoundSequence=-1;
        this.meleeView?.reset();
        this.weaponView?.motion.reset();
        this.cameraRig?.resetMotion();this.sniperZoom.reset();
        this.ui.setWeaponName(this.weapon.stats.name);
        if (self.combat.gun) this.weapon.restore(self.combat.gun);
        this.acc = 0;
        this.cameraRig?.snapFov(this.settings.value.fov);
      } else this.network.reconcile(this.player, snapshot, this.weapon);
    } else if (self.death) {
      if (this.state !== 'spectating' || this.spectatingDeath?.id !== self.death.id) this.beginSpectating(self.death);
      else this.spectatingDeath = self.death;
    } else if (this.state === 'playing' || this.state === 'spectating' || (this.state === 'paused' && !this.preSpawnPaused)) this.showPreSpawn();
    this.ui.damage.observeHealth({ id: self.id, life: self.life, round: snapshot.roundId,
      at: snapshot.serverTime, health: self.health, max: PLAYER_MAX_HEALTH, alive: self.alive });
  }

  private presentRoundResult(snapshot: Snapshot): boolean {
    const result = snapshot.result, network = this.network;
    const self = snapshot.players.find((p) => p.id === network?.selfId);
    if (!result || !network || self?.lastPlayedRound !== result.roundId) return false;
    if(this.localPractice){
      if(this.state==='results')return true;const setup={...this.practiceSetup!};
      this.networkReady=false;this.state='results';this.tabHeld=false;this.input.enabled=false;this.input.clearState();this.input.releaseLock();
      this.spectatingDeath=null;this.remotePlayers.setSpectated(null);this.remotePlayers.clear();this.grenadeView?.clear();this.weaponView?.setVisible(false);this.ui.damage.clear();this.ui.setScope(0);
      this.ui.showRoundResult(result,network.selfId,self.lastPlayedTeam,()=>{this.quitToMenu();this.stopOnline();this.practiceSetup=setup;void this.play(setup.mapId);},()=>this.quitToMenu(),{settings:()=>{this.quitToMenu();this.ui.practice.open();}});
      return true;
    }
    const key = `crossfire.result.${network.selfId}.${result.roundId}`;
    let dismissed = this.dismissedResults.has(key);
    try { dismissed ||= sessionStorage.getItem(key) === 'dismissed'; } catch { /* Optional persistence. */ }
    if (dismissed) return false;
    if (this.shownResult === key && this.state === 'results') {this.ui.updateResultGems(result,network.selfId);return true;}
    this.grenadeView?.clear();
    this.shownResult = key;
    this.networkReady = false; this.state = 'results'; this.tabHeld = false;
    this.spectatingDeath = null; this.remotePlayers.setSpectated(null); this.remotePlayers.clear();
    this.input.enabled = false; this.input.clearState(); this.input.releaseLock();
    this.weaponView?.setVisible(false); this.ui.setScope(0); this.ui.damage.clear(); this.ui.combatFeed.clear();
    this.ui.showRoundResult(result, network.selfId, self.lastPlayedTeam, () => {
      this.dismissedResults.add(key);
      try { sessionStorage.setItem(key, 'dismissed'); } catch { /* Optional persistence. */ }
      this.shownResult = '';
      const signal = this.joinAbort?.signal;
      void this.prepareNetworkMap().then(() => {
        if (this.options.autoplay && this.networkReady) return this.spawnSelected();
      }).catch((e) => { if (!signal?.aborted) this.connectionError((e as Error).message); });
    }, () => this.quitToMenu());
    return true;
  }

  private beginSpectating(death: Elimination): void {
    this.meleeView?.reset();
    this.spectatingDeath = death;
    this.state = 'spectating';
    this.spectatorWeapon = null;
    this.spectatorFov = this.ctx.camera.fov * 180 / Math.PI;
    this.tabHeld = false;
    this.input.enabled = false; this.input.clearState(); this.input.releaseLock();
    this.weaponView?.setVisible(false); this.ui.setScope(0); this.ui.damage.clear();
    this.ui.setRespawnBusy(false);
    this.remotePlayers.setSpectated(death.killerId);
    this.ui.setSpectate(death.killerName, Math.max(0, death.respawnAt - (Date.now() + (this.network?.clockOffset ?? 0))), this.network?.state === 'connected');
    this.ui.show('spectate');
  }

  private showPreSpawn(): void {
    this.meleeView?.reset();
    this.spectatingDeath = null; this.remotePlayers.setSpectated(null);
    this.state = 'start';
    this.tabHeld = false;
    this.input.enabled = false;
    this.input.clearState();
    this.input.releaseLock();
    this.weaponView?.setVisible(false);
    this.ui.setScope(0);
    this.ui.setSpawnState((this.network?.latest?.players.find((p) => p.id === this.network?.selfId)?.life ?? 0) > 0);
    this.ui.openWeaponSelection();
  }

  private async spawnSelected(): Promise<void> {
    const spectating = this.state === 'spectating';
    if (spectating ? this.ui.currentScreen !== 'spectate' : this.state !== 'start'
      || (this.ui.currentScreen !== 'start' && this.ui.currentScreen !== 'weapons') || this.ui.spawnPending) return;
    if (spectating && (!this.spectatingDeath || this.network?.state !== 'connected'
      || Date.now() + this.network.clockOffset < this.spectatingDeath.respawnAt)) return;
    const respawn = (this.network?.latest?.players.find((p) => p.id === this.network?.selfId)?.life ?? 0) > 0;
    if (spectating) this.ui.setRespawnBusy(true); else this.ui.setSpawnState(respawn, true);
    try {
      if (this.options.multiplayer) {
        const network = this.network!;
        // Slow startup can time out the request before its authoritative approval
        // arrives. Retry must enter that already-approved life, not request another
        // spawn or change its server-locked weapon.
        const approved = network.latest?.players.find((p) => p.id === network.selfId)?.alive;
        const snapshot = approved ? network.latest! : await network.spawn(this.ui.selectedWeapon);
        if (this.network !== network || !this.networkReady || network.state !== 'connected' || this.state !== (spectating ? 'spectating' : 'start')) return;
        this.acceptSnapshot(snapshot);
      } else {
        this.spawn();
        this.loadout.reset(WEAPONS.findIndex((w) => w.id === this.ui.selectedWeapon), !this.options.autoplay);
        this.localMelee=createMeleeState();this.meleeDebug=false;this.meleeSoundSequence=-1;
        this.meleeView?.reset();
        this.lastUsedWeapon.remember(this.weapon.stats.id);
        this.weaponView?.select(this.weapon.stats.id);
        this.ui.setWeaponName(this.weapon.stats.name);
      }
      this.spectatingDeath = null; this.remotePlayers.setSpectated(null); this.ui.setRespawnBusy(false);
      this.ui.setSpawnState(respawn);
      // enterPlay's pointer-lock callback transitions from the pre-spawn state.
      if (spectating) this.state = 'start';
      if (this.options.autoplay) this.activateWithoutLock();
      else await this.enterPlay();
    } catch (e) {
      if (spectating && this.state === 'spectating') this.ui.setRespawnBusy(false, (e as Error).message);
      else if (this.state === 'start') this.ui.setSpawnState(respawn, false, (e as Error).message);
    }
  }

  private activateWithoutLock(): void {
    this.preSpawnPaused = false;
    this.spectatingDeath = null; this.remotePlayers.setSpectated(null);
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
    this.grenadeView?.clear();
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
    this.meleeView?.reset();
    this.grenadeCount = GRENADE.perLife; this.practiceGrenades = []; this.grenadeHeld = false;
    this.grenadeView?.clear(); this.ui.setGrenades(this.grenadeCount);
    this.health = PLAYER_MAX_HEALTH;
    this.cameraRig?.resetMotion();this.sniperZoom.reset();
    this.weaponView?.motion.reset();
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
      if (this.ui.chatOpen) { this.input.releaseLock(); return; }
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
    } else if (this.state === 'playing' && !this.options.autoplay && !this.ui.chatOpen) {
      this.state = 'paused';
      this.input.enabled = false;
      this.ui.show('pause', true);
    }
  }

  private quitToMenu(): void {
    const wasPractice=!!this.practiceSetup||!!this.localPractice;
    this.practiceChallenges?.stop();this.practiceChallenges=null;
    this.practiceDebug?.dispose();this.practiceDebug=null;
    this.ui.rooms.update(null,'',0,false);
    this.admission=null;
    this.grenadeView?.clear(); this.practiceGrenades = []; this.grenadeClick = false; this.grenadeHeld = false;
    this.spectatingDeath = null; this.remotePlayers.setSpectated(null); this.ui.combatFeed.clear();
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
    if(this.network)this.leavingRoom=this.network.leaveRoom();
    this.network = null; this.selectionTarget = null; this.selectionFocus = null; this.recentCombat.clear();
    this.practiceSetup=null;this.ui.setPractice(false);
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
    this.effects?.clearDecals(); this.trails.clear();
    this.ui.show('menu');
    if(!wasPractice&&this.onlineRequested){void this.presence?.poll();void this.career?.ensure().then(()=>this.cosmetics?.load(this.onlineAbort?.signal??new AbortController().signal)).catch(() => {});}
  }

  private applySettings(raw: Readonly<Settings>, changed: (keyof Settings)[]): void {
    const v=effectiveSettings(raw);
    if(changed.includes('chromebookMode'))changed=[...new Set([...changed,'resolutionScale','graphicsQuality','shadowQuality'] as (keyof Settings)[])];
    if (changed.includes('keyBindings')) { this.input.setBindings(v.keyBindings); this.ui.setChatBinding(v.keyBindings.chat[0]); }
    if (changed.includes('resolutionScale')) this.ctx.setResolutionScale(v.resolutionScale,v.chromebookMode);
    if (changed.includes('masterVolume')) this.audio.setVolume(v.masterVolume);
    if (changed.includes('sfxVolume')) this.audio.setSfxVolume(v.sfxVolume);
    if (changed.includes('graphicsQuality')) {
      const p = graphicsPreset(v);
      this.postfx.apply(p);
      this.remotePlayers.refreshEffects();
      this.materials.setAnisotropy(p.anisotropy);
      this.materials.setUltra(!!p.ultraMaterials);
      this.materials.setChromebook(v.chromebookMode);
      this.remotePlayers.setAnimationDetail(v.chromebookMode ? .25 : v.graphicsQuality === 'low' ? .5 : 1);
      this.remotePlayers.setTrailsReduced(v.chromebookMode);
      this.meleeView?.setReducedTrails(v.chromebookMode);
      this.map?.environment.applyGraphicsPreset(p);
      this.map?.puddles?.apply(p.puddleReflections ?? 0);
      this.map?.foliage?.setLite(v.chromebookMode);
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
    this.ctx.updateResolution(rawDt,this.state==='playing'&&!document.hidden);
    this.ui.rooms.update(this.network?.latest??null,this.network?.selfId??'',Date.now()+(this.network?.clockOffset??0),!['menu','loading','results'].includes(this.state));
    this.ui.challenges.update(this.guestProfile.value.username, this.career?.serverNow ?? null);
    this.homeCharacter.setCosmetics(this.cosmetics?.view?.equipped??defaultEquipment());
    this.homeCharacter.setWeapon(this.lastUsedWeapon.value ?? this.ui.selectedWeapon);
    this.homeCharacter.setName(this.guestProfile.value.username);
    this.homeCharacter.setVisible(this.state === 'menu' && this.ui.currentScreen === 'menu' && !this.options.autoplay);
    if(this.state!=='playing')this.aimAssist.reset();
    if (this.grenadeCharge.active && (this.state !== 'playing' || !this.input.enabled
      || (this.options.multiplayer && this.network?.state !== 'connected'))) this.cancelGrenadeCharge();
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
      this.selectionCamera(dt);
    }
    this.localPractice?.advance(dt,this.state==='paused'||this.state==='loading');
    this.practiceChallenges?.update();
    if(this.practiceDebug&&this.localPractice)this.practiceDebug.update(this.localPractice.simulation,this.fps.value);
    this.updateScoreboard();
    this.remotePlayers.setPresentationVisible(this.ui.currentScreen === 'hud' || this.state === 'spectating');
    // Inputs above refer to the previously drawn pose. Advance the remote
    // playhead only when that new pose is actually about to be presented.
    if (this.network?.state === 'connected') this.remotePlayers.update(this.network.presentationTime(), dt);
    this.ui.combatFeed.setVisible(this.ui.currentScreen === 'hud' || this.ui.currentScreen === 'spectate');
    let spectatorScoped = false;
    if (this.state === 'spectating' && this.spectatingDeath) {
      const death = this.spectatingDeath;
      const pose = death.killerId && this.network?.state === 'connected' ? this.remotePlayers.spectatePose(death.killerId) : null;
      if (pose) {
        if(this.shownCosmetic!==`${pose.weapon}:${pose.cosmeticId}`){this.shownCosmetic=`${pose.weapon}:${pose.cosmeticId}`;void this.weaponView?.setCosmetic(pose.weapon,pose.cosmeticId).then(()=>{if(this.map)this.excludeViewFromSun(this.map);}).catch(error=>this.ui.showToast((error as Error).message,'warn'));}
        const camera = this.ctx.camera, blend = 1 - Math.exp(-dt * 7);
        camera.position = Vector3.Lerp(camera.position, pose.position, blend);
        camera.rotationQuaternion ??= Quaternion.Identity();
        Quaternion.SlerpToRef(camera.rotationQuaternion, pose.rotation, blend, camera.rotationQuaternion);
        if (this.spectatorWeapon?.stats.id !== pose.weapon) {
          this.spectatorWeapon = new Weapon(WEAPONS.find((w) => w.id === pose.weapon)!);
          this.weaponView?.select(pose.weapon);
          this.weaponView?.motion.reset();
        }
        this.spectatorWeapon.restore(pose.gun);
        const w = this.spectatorWeapon;
        const targetFov = this.settings.value.fov + (weaponAdsFov(w.stats,this.settings.value.fov)-this.settings.value.fov)*w.ads;
        this.spectatorFov += (targetFov - this.spectatorFov) * (1 - Math.exp(-dt * 18));
        this.ctx.setFov(this.spectatorFov);
        const scope = w.stats.scope ? Math.max(0, Math.min(1, (w.ads - .72) / .22)) : 0;
        this.meleeView?.sync(pose.melee??createMeleeState(),Date.now()+(this.network?.clockOffset??0));
        this.meleeView?.setCosmetic(pose.meleeCosmeticId);this.meleeView?.advance(dt);
        this.weaponView?.setMelee(this.meleeView?.gunLower??0,this.meleeView?.gunVisible??true);
        if(this.meleeView&&this.weaponView){this.meleeView.setVisible(this.ui.currentScreen==='spectate');this.meleeView.update(this.weaponView.motion.pose);this.meleeShown=true;}
        spectatorScoped = scope > .98 && this.ui.currentScreen === 'spectate';
        this.weaponView?.update(dt, w, { sprinting: false, speed: pose.speed, grounded: pose.grounded,
          lean:pose.lean, verticalSpeed: pose.verticalSpeed, sliding: pose.sliding, crouch: pose.crouch, reducedMotion: this.reducedMotion.matches });
        this.weaponView?.setHidden(scope > .98);
        this.weaponView?.setVisible(this.ui.currentScreen === 'spectate');
        this.ui.setScope(scope);
      } else {
        this.spectatorWeapon = null;
        this.spectatorFov += (this.settings.value.fov - this.spectatorFov) * (1 - Math.exp(-dt * 18));
        this.ctx.setFov(this.spectatorFov);
        this.weaponView?.setVisible(false);
        this.ui.setScope(0);
      }
      this.ui.setSpectate(death.killerName, Math.max(0, death.respawnAt - (Date.now() + (this.network?.clockOffset ?? 0))), this.network?.state === 'connected', pose&&meleeBlocked(pose.melee)?'melee':pose?.weapon ?? null);
    }
    this.remotePlayers.setSpectatorScope(spectatorScoped);
    this.effects?.setReduced(this.settings.value.chromebookMode);
    this.trails.setReduced(this.settings.value.chromebookMode);
    this.effects?.update(dt);
    if(this.map){const cam=this.ctx.camera.globalPosition;this.map.foliage?.update(cam);this.map.puddles?.update(cam.y);this.map.environment.updateUnderground(cam.y);}
    if(this.map&&this.state!=='loading')this.map.props.update(dt,Date.now()+(this.network?.clockOffset??0),!this.options.multiplayer);
    if (this.map && this.state !== 'loading' && this.state !== 'results') {
      if (!this.options.multiplayer) this.updatePracticeGrenades();
      this.grenadeView?.setReduced(effectiveSettings(this.settings.value).reducedEffects || this.settings.value.graphicsQuality === 'low');
      this.grenadeView?.setChromebook(this.settings.value.chromebookMode);
      this.grenadeView?.update(dt, Date.now() + (this.network?.clockOffset ?? 0), this.map.world);
    }
    this.ui.update(dt);
    const cameraAngles = this.ctx.camera.rotationQuaternion?.toEulerAngles();
    this.ui.damage.update(cameraAngles?.y ?? this.player?.yaw ?? 0, cameraAngles?.x ?? this.player?.pitch ?? 0);
    this.updateHudMeta();
    this.ui.matchHud.update(this.network?.latest ?? null, Date.now() + (this.network?.clockOffset ?? 0),
      this.ui.currentScreen === 'hud' || this.ui.currentScreen === 'spectate', this.network?.selfId);
    this.audio.setListener(this.ctx.camera.globalPosition,this.ctx.camera.getDirection(Vector3.Forward(true)),this.ctx.camera.getDirection(Vector3.Up()));
    this.trails.update();
    // The first-person daggers only show while this player is simulated (not spectating/menus).
    if (!this.meleeShown && this.meleeView?.root.isEnabled()) { this.meleeView.setVisible(false); this.meleeView.update(this.weaponView?.motion.pose ?? { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }); }
    this.meleeShown = false;
    this.ctx.scene.render();
    this.input.endFrame();
  }

  /** No tactical-map DOM is created. Release, blur and screen changes hide Tab immediately. */
  private updateScoreboard(): void {
    const show = (this.ui.currentScreen === 'hud' || this.ui.currentScreen === 'start' || this.ui.currentScreen === 'spectate')
      && (this.tabHeld || this.input.isDown('leaderboard')) && (!this.options.multiplayer || this.network?.state === 'connected');
    this.ui.scoreboard.setVisible(show);
    if (show) this.ui.scoreboard.update(this.network?.latest ?? null, this.network?.selfId ?? '', Date.now() + (this.network?.clockOffset ?? 0));
  }

  private selectionTarget: string | null = null;
  private selectionTargetAt = 0;
  private selectionFocus: Vector3 | null = null;
  private readonly recentCombat = new Map<string, number>();
  private selectionCamera(dt: number): void {
    if (!this.map) return;
    const now = Date.now() + (this.network?.clockOffset ?? 0);
    const self = this.network?.latest?.players.find(p => p.id === this.network?.selfId);
    const candidates = this.network?.latest?.players.filter(p => p.alive && p.id !== this.network?.selfId
      && (this.network?.latest?.match.mode !== 'teams' || !self?.team || p.team === self.team)) ?? [];
    const current = candidates.find(p => p.id === this.selectionTarget);
    if (!current || now - this.selectionTargetAt > 6000) {
      candidates.sort((a,b) => (this.recentCombat.get(b.id) ?? 0) - (this.recentCombat.get(a.id) ?? 0) || a.id.localeCompare(b.id));
      this.selectionTarget = candidates[0]?.id ?? null; this.selectionTargetAt = now;
    }
    const pose = this.selectionTarget ? this.remotePlayers.spectatePose(this.selectionTarget) : null;
    if (pose) {
      const anchor = pose.position.clone();
      const behind = new Vector3(0, .8, 3.2).applyRotationQuaternion(Quaternion.RotationYawPitchRoll(pose.rotation.toEulerAngles().y, 0, 0));
      const hit = sweepSphere(this.map.world, anchor, behind, .22);
      const desired = anchor.add(behind.scale(hit ? Math.max(0, hit.fraction - .05) : 1));
      const cam = this.ctx.camera, blend = 1 - Math.exp(-dt * 4);
      const next = Vector3.Lerp(cam.position, desired, blend);
      // Recheck the interpolated camera, including on a target switch across a wall.
      const delta = next.subtract(anchor), safe = sweepSphere(this.map.world, anchor, delta, .22);
      cam.position.copyFrom(anchor.add(delta.scale(safe ? Math.max(0, safe.fraction - .02) : 1)));
      this.selectionFocus ??= anchor.clone(); Vector3.LerpToRef(this.selectionFocus, anchor, blend, this.selectionFocus);
      cam.setTarget(this.selectionFocus); this.ctx.setFov(72); this.weaponView?.setVisible(false); return;
    }
    this.selectionFocus = null;

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
    const s = effectiveSettings(this.settings.value);
    const input = this.input;
    this.weaponView?.setVisible(true);

    const meleeState=this.network?.melee??this.localMelee;
    // A render frame can be shorter than one physics tick. Keep this press until
    // it is sent once; blur, menus and rebinding clear it through Input.onClear.
    this.meleeTogglePending ||= input.wasPressed('melee');
    if(this.meleeTogglePending)this.meleeDebug=false;
    const blockedMelee=meleeBlocked(meleeState);
    const magnification=this.sniperZoom.update(dt);
    const zoom = 1 + ((this.weapon.stats.scope?1/magnification:weaponAdsFov(this.weapon.stats,s.fov)/s.fov) - 1) * this.weapon.ads;
    this.ui.setScopeZoom(magnification);
    const events: WeaponEvent[] = [];
    // weapon switching: number keys and mouse wheel
    for (let k = 0; k < this.loadout.weapons.length; k++) {
      if (!blockedMelee && input.wasPressed(`weapon${k + 1}` as 'weapon1')) this.loadout.select(k, events);
    }
    if (!blockedMelee && input.wasPressed('lastWeapon')) this.loadout.selectPrevious(events);
    if (!blockedMelee && input.wasPressed('nextWeapon')) this.loadout.cycle(1, events);
    if (!blockedMelee && input.wasPressed('prevWeapon')) this.loadout.cycle(-1, events);
    const look = input.takeMouseDelta();
    const manualYaw=player.yaw,manualPitch=player.pitch;
    rig.applyLook(look.dx, look.dy, s.mouseSensitivity, s.invertY, zoom);
    if(s.aimAssist&&!blockedMelee){const eye=player.leanEye(),now=performance.now(),assist=this.aimAssist.step({enabled:true,now,dt,yaw:player.yaw,pitch:player.pitch,
      inputYaw:Math.atan2(Math.sin(player.yaw-manualYaw),Math.cos(player.yaw-manualYaw)),inputPitch:player.pitch-manualPitch,eye,
      boosted:this.ui.aimAssistBoosted,targets:this.remotePlayers.aimTargets(this.ui.aimAssistBoosted),canSee:target=>this.remotePlayers.aimVisible(target,eye),firing:input.isDown('fire')||input.wasPressed('fire'),recoiling:rig.recoiling||this.weapon.capture().cooldown>0});
    player.yaw=Math.atan2(Math.sin(player.yaw+assist.yaw),Math.cos(player.yaw+assist.yaw));player.pitch=Math.max(-88*Math.PI/180,Math.min(88*Math.PI/180,player.pitch+assist.pitch));
    }else this.aimAssist.reset();
    this.weaponView?.addSway(look.dx, look.dy);

    const it = this.intent;
    it.x = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    it.z = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    it.slide = input.isDown('slide');
    it.crouch = input.isDown('crouch');
    // Preserve a quick physical release/repress even when both events fall between
    // fixed ticks. Send a neutral release tick before the new held press.
    if (input.wasPressed('slide') && player.slideHeld) this.slideReleasePending = true;
    it.aim = !blockedMelee&&input.isDown('aim');
    it.lean = ((input.isDown('leanRight') ? 1 : 0) - (input.isDown('leanLeft') ? 1 : 0)) as -1 | 0 | 1;
    let jumpEdge = input.wasPressed('jump');
    let fireEdge = input.wasPressed('fire');
    let reloadEdge = input.wasPressed('reload');
    let grenadeEdge = input.wasPressed('grenade');

    for (const e of events) this.onWeaponEvent(e);
    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      it.slide = input.isDown('slide') && !this.slideReleasePending;
      this.slideReleasePending = false;
      it.jumpPressed = jumpEdge;
      const wasGrounded = player.grounded;
      player.weaponClearance = meleeBlocked(meleeState)?null:this.weapon.stats.id;
      player.fixedUpdate(FIXED_DT, it);
      const toggle=this.meleeTogglePending;this.meleeTogglePending=false;
      const combat={trigger:input.isDown('fire')||fireEdge,reload:input.isDown('reload')||reloadEdge,melee:toggle};
      if(!this.network)stepMelee(this.localMelee,Date.now(),combat,this.weapon.action==='idle');
      const throwing = !meleeBlocked(meleeState)&&(input.isDown('grenade') || grenadeEdge || this.grenadeClick || this.grenadePointerHeld);
      // A quick key tap can be released between render frames. Forward its
      // press edge as one authoritative input tick instead of losing the action.
      this.network?.fixedInput(player, it, { ...combat, grenade: throwing, ...rig.aimAngles(this.scope) });
      const charge = this.grenadeCharge.update(throwing, Date.now(), FIXED_DT,
        !meleeBlocked(meleeState)&&this.grenadeCount > 0 && this.weapon.action === 'idle' && !player.sliding);
      if (!this.options.multiplayer && charge !== null) {
        const projectile = throwGrenade(map.world, player.leanEye(), { x: player.position.x, y: player.position.y + player.eyeHeight, z: player.position.z },
          player.lookDirection(), player.velocity, { id: crypto.randomUUID(), ownerId: 'player', ownerLife: 1, roundId: 0, at: Date.now() }, charge);
        if (projectile) { this.grenadeCount--; this.practiceGrenades.push(projectile); this.grenadeView?.sync(this.practiceGrenades);
          this.presentGrenade({ kind: 'throw', id: `throw:${projectile.id}`, projectile }); }
      }
      this.grenadeHeld = throwing; this.grenadeClick = false;
      rig.onTick();
      if (player.landedSpeed > 3) this.weaponView?.land(player.landedSpeed);
      if (jumpEdge && wasGrounded && !player.grounded && player.velocity.y > 0) this.sound('jump', 0.35);
      if (player.landedSpeed > 4) this.sound('land', Math.min(0.8, player.landedSpeed * 0.07));
      events.length = 0;
      this.loadout.update(
        FIXED_DT,
        {
          trigger: !meleeBlocked(meleeState)&&input.isDown('fire'),
          triggerPressed: !meleeBlocked(meleeState)&&fireEdge,
          reloadPressed: !meleeBlocked(meleeState)&&reloadEdge,
          aim: !meleeBlocked(meleeState)&&it.aim,
          moveFactor: player.horizontalSpeed / MOVEMENT.weaponMoveReference,
          airborne: !player.grounded,
          sprinting: false,
        },
        events,
      );
      for (const e of events) this.onWeaponEvent(e);
      map.targets.update(FIXED_DT);
      this.footsteps(FIXED_DT);
      if (!this.options.multiplayer && (unsafeMovement(player.position, map.def.layout) || player.position.y < map.def.collision.killY)) this.spawn();
      jumpEdge = fireEdge = reloadEdge = grenadeEdge = false;
      this.acc -= FIXED_DT;
    }
    const alpha = this.acc / FIXED_DT;
    const w = this.weapon;
    // sniper scope: the overlay fades in over the last part of the aim and replaces the weapon in view
    this.scope = w.stats.scope ? Math.max(0, Math.min(1, (w.ads - 0.72) / 0.22)) : 0;
    rig.update(dt, alpha, s.fov, zoom, this.scope, this.reducedMotion.matches);
    const shown = this.viewOverride ? ({ ...this.viewOverride, stats: w.stats } as unknown as Weapon) : w;
    if(!this.meleeDebug){
      const clip=this.meleeView?.sync(this.network?.melee??this.localMelee,Date.now()+(this.network?.clockOffset??0));
      if(clip==='equip'||clip==='unequip')this.sound('melee_equip',.25);
      const state=this.network?.melee??this.localMelee;
      const activeClip=meleeClip(state),flourish=activeClip&&this.remotePlayers.meleeLibrary.meta?.clips[activeClip as MeleeClipName].flourish;
      const elapsed=(Date.now()+(this.network?.clockOffset??0)-state.startedAt)/1000,key=`${activeClip}:${state.startedAt}:${state.sequence}`;
      if(flourish&&elapsed>=flourish[0]&&elapsed<=flourish[1]&&this.meleeFlourishKey!==key){this.meleeFlourishKey=key;this.sound('melee_flourish',.18);}
      if(state.phase==='attacking'&&state.sequence!==this.meleeSoundSequence&&Date.now()+(this.network?.clockOffset??0)-state.startedAt>=MELEE.attacks[state.stage-1].contact-50&&Date.now()+(this.network?.clockOffset??0)-state.startedAt<=MELEE.attacks[state.stage-1].duration){this.meleeSoundSequence=state.sequence;this.sound(('melee_swing'+state.stage) as SoundName,.35);}
      this.meleeView?.setCosmetic(this.network?.latest?.players.find(p=>p.id===this.network?.selfId)?.meleeCosmeticId??this.cosmetics?.view?.equipped.melee);
    }
    this.meleeView?.advance(dt);
    this.weaponView?.setMelee(this.meleeView?.gunLower ?? 0, this.meleeView?.gunVisible ?? true);
    this.weaponView?.update(dt, shown, { sprinting: false, speed: player.horizontalSpeed,
      lean:player.lean, grounded: player.grounded, verticalSpeed: player.velocity.y, sliding: player.sliding, crouch: player.crouch, reducedMotion: this.reducedMotion.matches });
    if (this.meleeView && this.weaponView) {
      this.meleeView.setVisible(true);
      this.meleeView.update(this.weaponView.motion.pose);
      this.meleeShown = true;
    }
    this.weaponView?.setHidden(this.scope > 0.98);
    this.ui.setScope(this.scope);

    // HUD
    const aimDeg = w.spread({ moveFactor: player.horizontalSpeed / MOVEMENT.weaponMoveReference, airborne: !player.grounded });
    const spreadDeg = aimDeg + pelletSpreadAt(w.stats,w.ads);
    const px = (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan(this.ctx.camera.fov / 2)) * (this.ctx.engine.getRenderWidth() / 2);
    // render pixels -> CSS pixels; hidden while aimed (the sight has its own reticle) or switching
    const crosshair = w.ads < 0.6 && (w.action === 'idle' || w.action === 'cycle' || w.reloading);
    this.ui.setCrosshairSpread(px * this.ctx.engine.getHardwareScalingLevel(), crosshair, dt);
    this.ui.setWeaponName(meleeBlocked(this.network?.melee??this.localMelee)?'Dual Daggers':w.stats.name);
    this.ui.setMeleeEquipped(meleeBlocked(this.network?.melee??this.localMelee));
    this.ui.setAmmo(w.ammo, w.reserve, w.stats.magazine, w.reloading, w.reloadProgress);
    this.ui.setWeaponSlots(meleeBlocked(this.network?.melee??this.localMelee)?['Dual Daggers']:this.options.multiplayer ? [w.stats.name] : this.loadout.weapons.map((x) => x.stats.name), this.options.multiplayer ? 0 : this.loadout.switchingTo ?? this.loadout.currentIndex);
    this.ui.setGrenades(this.grenadeCount);
    this.ui.setGrenadeCharge(this.grenadeCharge.presentationProgress(Date.now()),this.grenadeCharge.active);
    this.ui.setHealth(this.health, PLAYER_MAX_HEALTH);
    this.ui.setSlideEffect(player.sliding, player.horizontalSpeed, player.slideRemaining / MOVEMENT.slideDuration);
  }

  private cancelGrenadeCharge(): void {
    if (this.player && this.options.multiplayer && (this.grenadeCharge.active || this.grenadeHeld)) {
      this.network?.fixedInput(this.player, NO_INTENT, { trigger: false, reload: false, grenadeCancel: true });
    }
    this.grenadeCharge.reset(); this.grenadeHeld = this.grenadeClick = this.grenadePointerHeld = false;
    this.ui?.setGrenadeCharge(0);
  }

  private presentGrenade(event: GrenadeEvent): void {
    if (!this.map) return;
    if(event.kind==='bounce'){if(Date.now()+(this.network?.clockOffset??0)-event.at<600)this.audio.playSpatial('shell_drop',event.position,.12*event.strength);return;}
    if (event.kind === 'throw') {
      if (event.projectile.ownerId === (this.network?.selfId ?? 'player')) { this.stats.grenadesThrown++; this.weaponView?.throwGrenade(); }
      return;
    }
    const now = Date.now() + (this.network?.clockOffset ?? 0);
    this.grenadeView?.explode(event, now);
    if (now - event.at > 600) return; // History restores smoke, never old sound or hit feedback.
    this.audio.playSpatial('grenade_explosion',event.position,.8);
    const self = this.network?.latest?.players.find((p) => p.id === this.network?.selfId);
    const received = event.hits.find((h) => h.id === self?.id && h.life === self.life);
    if (received) {this.ui.damage.hit(received.direction, received.amount);if(event.ownerId!==self?.id&&now-event.at<300&&this.state==='playing')this.cameraRig?.explosion(received.amount);}
    if (event.ownerId === this.network?.selfId && event.hits.some((h) => h.id !== event.ownerId)) {
      this.stats.grenadeHits++; this.ui.hitMarker(false); this.sound('hit', .5);
    }
  }

  private updatePracticeGrenades(): void {
    const now = Date.now(), world = this.map!.world;
    for (const g of [...this.practiceGrenades]) {
      advanceGrenade(g, now, world);
      if (now < g.explodeAt) continue;
      this.practiceGrenades = this.practiceGrenades.filter((p) => p.id !== g.id);
      this.presentGrenade({ kind: 'explode', id: `blast:${g.id}`, grenadeId: g.id, ownerId: 'player', ownerLife: 1,
        roundId: 0, at: now, position: { ...g.position }, hits: [] });
      for (const target of this.map!.targets.targets) {
        const p = target.bodyCollider;
        const motion = this.player!.capture(); motion.position = { x: p.cx, y: p.cy - .7, z: p.cz }; motion.crouch = 0;
        const amount = blastDamage(world, g.position, motion);
        if (amount > 0) this.damage.tryApply(this.attacker, target, { bodyDamage: amount, zone: 'body', point: g.position, weapon: 'grenade' });
      }
    }
    this.grenadeView?.sync(this.practiceGrenades);
  }

  private onWeaponEvent(e: WeaponEvent): void {
    switch (e.type) {
      case 'fire':
        this.aimAssist.suppress(performance.now());
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
        this.lastUsedWeapon.remember(this.weapon.stats.id);
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
    const angles = this.cameraRig?.aimAngles(this.scope) ?? { aimYaw: this.player!.yaw, aimPitch: this.player!.pitch };
    this.cameraRig?.addRecoil(st.recoilPitch * (st.scope?1:1 - w.ads * 0.4), st.recoilYaw,!st.scope);
    // self-loading rifle: the case flies out with every shot (pump and bolt guns eject when worked)
    if (st.cycleTime === 0) this.ejectCase();
    cam.computeWorldMatrix();
    // Environment impacts are cosmetic prediction. Only server shot results may
    // produce multiplayer player damage, scores or hit markers.
    const origin = cam.globalPosition.clone();
    const cp = Math.cos(angles.aimPitch);
    const aim = applySpread({ x: -Math.sin(angles.aimYaw) * cp, y: Math.sin(angles.aimPitch), z: -Math.cos(angles.aimYaw) * cp }, spreadDeg);
    const shot = { weapon: st.id, pellets: st.pellets, hits: 0, damage: 0, head: false, target: '' };
    for (let k = 0; k < st.pellets; k++) {
      const dir = st.pellets > 1 ? applySpread(aim, pelletSpreadAt(st,w.ads)) : aim;
      const hit = map.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, st.range);
      if(!this.options.multiplayer)map.props.practice.shoot({x:origin.x,y:origin.y,z:origin.z},dir,hit?.distance??st.range,st.id);
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
          bodyDamage: damageAt(st, end.subtract(origin).length(),rollDamage(st,Math.random)),
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
    const s = effectiveSettings(this.settings.value);
    if (s.showFps) {
      const fps = Math.max(1, this.fps.value);
      const ping=this.network?.state==='connected'&&!this.localPractice?` · ${Math.round(this.network.latency)} ms ping`:'';
      this.ui.setFps(`${Math.round(fps)} FPS · ${(1000 / fps).toFixed(1)} ms${ping}`);
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
      /** Local GPU inspection only; never expose the live scene in production. */
      renderScene: () => import.meta.env.DEV ? this.ctx.scene : null,
      network: () => ({ state: this.network?.state ?? 'idle', selfId: this.network?.selfId ?? '',
        snapshot: this.network?.latest ?? null, rendered: this.remotePlayers.inspect(), diagnostics: this.network?.inspect() ?? null }),
      practice:()=>this.localPractice?.simulation.inspect()??null,
      practiceFinish:()=>{if(import.meta.env.DEV&&this.localPractice){this.localPractice.simulation.finish();this.localPractice.advance(0);}},
      networkReconnect: () => this.network?.reconnect(),
      networkLeave: () => this.quitToMenu(),
      state: () => this.state,
      spectate: () => ({ death: this.spectatingDeath, camera: this.ctx.camera.position.asArray(),
        rotation: this.ctx.camera.rotationQuaternion?.asArray() ?? null,
        weapon: this.spectatorWeapon?.stats.id ?? null, ads: this.spectatorWeapon?.ads ?? 0,
        fov: this.ctx.camera.fov * 180 / Math.PI, viewWeapon: this.weaponView?.currentId ?? null,
        viewVisible: this.weaponView?.root.isEnabled() ?? false,
        target: this.spectatingDeath?.killerId ? this.remotePlayers.spectatePose(this.spectatingDeath.killerId)?.position.asArray() ?? null : null }),
      selectionView: () => ({ target: this.selectionTarget, camera: this.ctx.camera.position.asArray() }),
      loadingState: () => ({ round: this.loadedRound, networkReady: this.networkReady, mapLoad: this.loading?.id,
        roundLoad: !!this.roundLoad, sceneReady: this.ctx.scene.isReady() }),
      teleport: (x: number, y: number, z: number, heading = 0, pitch = 0) => {
        if (this.state === 'paused' && this.options.autoplay) this.state = 'playing';
        this.player?.teleport({ x, y, z }, heading);
        this.cameraRig?.resetMotion();this.sniperZoom.reset();
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
      leanView: () => {
        const camera = this.ctx.camera;
        camera.computeWorldMatrix();
        const muzzle = this.weaponView?.muzzleWorld();
        const p = camera.globalPosition;
        return { camera: p.asArray(), rotation: camera.rotationQuaternion?.asArray(),
          forward: camera.getDirection(new Vector3(0, 0, -1)).asArray(),
          eye: this.player?.leanEye(), body: this.player?.position, lean: this.player?.lean,
          weaponParented: this.weaponView?.root.parent === camera, muzzle: muzzle?.asArray(),
          weaponPullback: this.weaponView?.root.position.z,
          cameraBlocked: this.map?.world.overlapsCylinder(p.x, p.z, .1, p.y - .1, p.y + .1),
          muzzleBlocked: muzzle && this.map?.world.overlapsCylinder(muzzle.x, muzzle.z, .1, muzzle.y - .1, muzzle.y + .1) };
      },
      characterAsset: () => this.remotePlayers.characters.inspect(),
      cosmetics:()=>({view:this.cosmetics?.view??null,page:this.ui.cosmetics.inspect()}),
      /** Freeze the crate reveal or jump to a time on its timeline (screenshots/tests). */
      crateReveal:(paused:boolean,seek?:number)=>this.ui.cosmetics.revealDebug(paused,seek),
      homeCharacter: () => this.homeCharacter.inspect(),
      /** Pose lab on the isolated home preview (same rig as remote players); null restores it. */
      characterLab: (options: CharacterLabOptions | null) => this.homeCharacter.characterLab(options),
      /** Dual-dagger presentation hooks (the combat layer wires real input/authority):
       * 'equip' | 'unequip' | 'attack' (optional stage) | 'reset', or 'freeze' with a clip and
       * time for repeatable screenshots ('freeze' with no clip resumes); 'pause'/'step'/'resume'
       * advance real transitions by exact steps. */
      melee: (command: 'equip' | 'unequip' | 'attack' | 'reset' | 'freeze' | 'pause' | 'resume' | 'step' | 'flourish', arg?: MeleeStage | MeleeClipName | number | 'r' | 'l', time?: number) => {
        this.meleeDebug=true;
        const view = this.meleeView;
        if (!view) return null;
        if (command === 'pause' || command === 'resume') view.pause(command === 'pause');
        else if (command === 'step') view.step(Number(arg ?? 1 / 60));
        else if (command === 'equip') view.equip();
        else if (command === 'unequip') view.unequip();
        else if (command === 'flourish') view.flourish(arg === 'r' || arg === 'l' ? arg : undefined);
        else if (command === 'attack') return view.attack(arg as MeleeStage | undefined);
        else if (command === 'reset') view.reset();
        else view.freeze((arg as MeleeClipName | undefined) ?? null, time ?? 0);
        return view.inspect();
      },
      meleeInspect: () => this.meleeView?.inspect() ?? null,
      /** Test hook: play the death presentation for a remote avatar / bot (id null = the first living one). */
      eliminateRemote: (id: string | null = null, dx = 0, dz = 1) => this.remotePlayers.debugEliminate(id, { x: dx, y: 0, z: dz }),
      /** Same commands for remote players and practice bots (third person); id null = all. */
      meleeRemote: (command: 'equip' | 'unequip' | 'attack' | 'reset', stage?: MeleeStage, id: string | null = null) => this.remotePlayers.presentMelee(id, command, stage),
      meleeRemoteSync: (id: string, clip: MeleeClipName, elapsed: number) => this.remotePlayers.syncMelee(id, clip, elapsed),
      meleeRemoteInspect: (id?: string) => this.remotePlayers.inspectMelee(id),
      characterPerf: (count: number, frames?: number) => this.homeCharacter.characterPerf(count, frames),
      silhouetteStats: () => this.remotePlayers.silhouetteStats(),
      silhouetteInterior: () => this.remotePlayers.silhouetteInterior(),
      damageFeedback: () => this.ui.damage.inspect(),
      sceneTextureIds: () => this.ctx.scene.textures.map((t) => t.uniqueId),
      graphics: () => ({
        quality: this.settings.value.graphicsQuality,
        chromebook:this.settings.value.chromebookMode,effective:effectiveSettings(this.settings.value),preset:graphicsPreset(this.settings.value),
        resolution:this.ctx.resolutionStats(),
        reflectionSize: this.ctx.scene.environmentTexture?.getSize().width ?? 0,
        reflectionId: this.ctx.scene.environmentTexture?.uniqueId ?? null,
        reflectionReady: this.ctx.scene.environmentTexture?.isReady() ?? false,
        viewLights:this.weaponView?.meshes.find(m=>m.isEnabled()&&m.material instanceof PBRMaterial)?.lightSources.slice(0,4).map(l=>l.name)??[],
        exposure: this.ctx.scene.imageProcessingConfiguration.exposure,
        environmentIntensity: this.ctx.scene.environmentIntensity,
        materials: this.materials.all().map(m => ({ name: m.name, metallic: m.metallic, roughness: m.roughness,
          textureSize:m.albedoTexture?.getSize().width??0,reflection:m.reflectionColor.asArray(),
          albedo: m.albedoTexture?.uniqueId ?? null, color: m.albedoColor.asArray(),
          normal: m.bumpTexture?.uniqueId ?? null, orm: m.metallicTexture?.name ?? null,
          roughnessFromAlpha: m.useRoughnessFromMetallicTextureAlpha, specularAA: m.enableSpecularAntiAliasing,
          coat: m.clearCoat.isEnabled, alpha: m.alpha })),
      }),
      visibilityStats: () => this.remotePlayers.visibilityStats(),
      remoteMotion:()=>this.remotePlayers.motionSamples(),
      renderResources:()=>({pending:this.ctx.scene.getWaitingItemsCount(),
        unready:this.ctx.scene.meshes.filter(m=>!m.isReady(true)).map(m=>({name:m.name,material:m.material?.name,
          textures:m.material?.getActiveTextures().map(t=>({name:t.name,ready:t.isReady(),size:t.getSize()}))})),
        textures:this.ctx.scene.textures.filter(t=>!!t.getInternalTexture()).map(t=>({name:t.name,size:t.getSize(),ready:t.isReady()}))}),
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
        grenadesThrown: this.stats.grenadesThrown, grenadeHits: this.stats.grenadeHits,
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
          view: this.weaponView ? { ...this.weaponView.debug, shown: this.weaponView.currentId,
            motion: { ...this.weaponView.motion.debug }, transform: { ...this.weaponView.motion.pose },
            pivot: this.ctx.scene.getTransformNodeByName('weapon-pivot')?.position.asArray(),
            rotation: this.ctx.scene.getTransformNodeByName('weapon-pivot')?.rotationQuaternion?.asArray() } : null,
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
      /** View-model meshes with their materials (and an optional visibility patch by mesh-name prefix), for scope/material audits. */
      viewMeshDebug: (hide: string[] = [], show = false) => (this.weaponView?.meshes ?? []).filter((m) => m.getTotalVertices() > 0 && m.parent).map((m) => {
        if (hide.some((h) => m.name.startsWith(h))) m.isVisible = show;
        const mat = m.material as { name: string; alpha: number; backFaceCulling: boolean; transparencyMode: number | null; needDepthPrePass?: boolean } | null;
        return { name: m.name, enabled: m.isEnabled(), visible: m.isVisible, group: m.renderingGroupId, material: mat?.name, alpha: mat?.alpha, cull: mat?.backFaceCulling,
          mode: mat?.transparencyMode, tris: m.getTotalIndices() / 3 };
      }),
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
      /** Play the Rich kill effect around the first-person gun (screenshots). */
      moneyBurst: () => this.emitMoney(null),
      moneyInfo: () => ({ view: this.moneyView?.active ?? 0, world: this.moneyWorld?.active ?? 0 }),
      /** The last shot's pellets, hits, damage and whether it was a headshot. */
      lastShot: () => ({ ...this.lastShot }),
      /** Sounds asked for recently, newest last (works without audio output). */
      sounds: () => [...this.audio.recent],
      spatialSounds: () => [...this.audio.recentSpatial],
      environmentProps:()=>this.map?.props.inspect(),
      /** Foliage detail sets and puddle reflection state (tests, quality review). */
      atmosphere:()=>({foliage:this.map?.foliage?.inspect()??null,puddles:this.map?.puddles?.inspect()??null}),
      environmentState:()=>this.network?.environment,
      grenades: () => ({ count: this.grenadeCount, charge:this.grenadeCharge.presentationProgress(Date.now()),charging:this.grenadeCharge.active,shake:this.cameraRig?.blastState(), ...this.grenadeView?.inspect(), lower: this.weaponView?.debug.lower }),
      aimAssist:()=>({enabled:this.settings.value.aimAssist,...this.aimAssist.inspect()}),
      mouseInput:(dx:number,dy:number)=>this.input.injectMouse(dx,dy),
      trails: () => this.trails.inspect(),
      spatialAudio: () => this.audio.inspectSpatial(),
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
