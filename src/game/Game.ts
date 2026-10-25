import { Color3, Mesh, MeshBuilder, PBRMaterial, Quaternion, SceneInstrumentation, StandardMaterial, Vector3 } from '@babylonjs/core';
import { AudioManager, type SoundName } from '../audio/AudioManager';
import { FIXED_DT, MAX_FRAME_DT, MOVEMENT, PLAYER_MAX_HEALTH } from '../config/constants';
import { SettingsStore, type Settings } from '../config/settings';
import { Input } from '../core/Input';
import { MapManager, type LoadedMap } from '../maps/MapManager';
import { DEFAULT_MAP_ID, getMap } from '../maps/registry';
import type { Team } from '../maps/types';
import { PlayerCamera } from '../player/PlayerCamera';
import { NO_INTENT, PlayerController, type MoveIntent } from '../player/PlayerController';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { PostFX } from '../rendering/PostFX';
import { GRAPHICS_PRESETS, SHADOW_PRESETS } from '../rendering/quality';
import { RenderContext } from '../rendering/RenderContext';
import { UI } from '../ui/UI';
import { Effects } from '../weapons/Effects';
import { applySpread, Weapon, type WeaponEvent } from '../weapons/Weapon';
import { WeaponView } from '../weapons/WeaponView';
import { DamageSystem, type Attacker } from './Damage';

type State = 'menu' | 'loading' | 'start' | 'playing' | 'paused';

export interface GameOptions {
  /** Skip menus and pointer lock (automated tests / screenshots). */
  autoplay: boolean;
  /** Initial camera: x, y, z, heading, pitch. */
  cam: number[] | null;
  hideHud: boolean;
  quality?: Settings['graphicsQuality'];
  shadows?: Settings['shadowQuality'];
  scale?: number;
}

export class Game {
  readonly ctx: RenderContext;
  readonly input: Input;
  readonly settings = new SettingsStore();
  readonly audio = new AudioManager();
  readonly ui: UI;
  readonly materials: MaterialLibrary;
  readonly maps: MapManager;
  private readonly postfx: PostFX;
  private readonly instrumentation: SceneInstrumentation;
  map: LoadedMap | null = null;
  player: PlayerController | null = null;
  private cameraRig: PlayerCamera | null = null;
  readonly weapon = new Weapon();
  private weaponView: WeaponView | null = null;
  private effects: Effects | null = null;
  private damage: DamageSystem | null = null;
  state: State = 'menu';
  private acc = 0;
  private health = PLAYER_MAX_HEALTH;
  private zoneTeam: Team | null = null;
  private stepDistance = 0;
  private stats = { shots: 0, hits: 0, downs: 0 };
  private fps = { frames: 0, time: 0, value: 0 };
  private loadPromise: Promise<LoadedMap> | null = null;
  private menuOrbit = 0;
  private blockedToastCooldown = 0;
  private readonly attacker: Attacker;
  private readonly tmpPos = { x: 0, y: 0, z: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    readonly options: GameOptions,
  ) {
    this.ctx = new RenderContext(canvas, { preserveDrawingBuffer: options.autoplay });
    this.input = new Input(canvas);
    this.ui = new UI(uiRoot, this.settings, this.audio);
    this.materials = new MaterialLibrary(this.ctx.scene);
    this.maps = new MapManager(this.ctx, this.materials, () => GRAPHICS_PRESETS[this.settings.value.graphicsQuality].batchCell);
    this.postfx = new PostFX(this.ctx.scene, this.ctx.camera);
    this.instrumentation = new SceneInstrumentation(this.ctx.scene);
    this.instrumentation.captureFrameTime = true;
    this.attacker = {
      id: 'player',
      bodyRadius: MOVEMENT.radius,
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

    this.ui.onPlay = (id) => void this.play(id);
    this.ui.onStart = () => void this.enterPlay();
    this.ui.onResume = () => void this.enterPlay();
    this.ui.onQuit = () => this.quitToMenu();
    this.input.lockListeners.add((locked) => this.onPointerLock(locked));
    this.ctx.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked && !this.options.autoplay) void this.input.requestLock();
    });
    window.addEventListener('beforeunload', (e) => {
      // Ctrl+W (crouch + forward) closes tabs in some browsers: ask before leaving mid-game
      if (this.state === 'playing' || this.state === 'paused') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') this.settings.update({ showFps: !this.settings.value.showFps });
      if (e.code === 'F2' && this.map && this.state === 'playing') void this.map.toggleCollisionDebug();
    });

    await this.materials.load();
    this.ui.show('menu');
    this.ui.setMenuStatus('Loading European Town...');
    this.ui.setPlayReady(false);
    this.effects = new Effects(this.ctx.scene);
    this.weaponView = new WeaponView(this.ctx, this.materials);
    this.weaponView.setVisible(false);
    const weaponLoad = this.weaponView.load();
    this.ui.setWeaponName(this.weapon.stats.name);
    this.ctx.engine.runRenderLoop(() => this.frame(this.ctx.engine.getDeltaTime() / 1000));
    // start streaming the default map right away so Play is instant
    this.loadPromise = this.loadMap(DEFAULT_MAP_ID);
    await weaponLoad;
    if (this.options.autoplay) await this.play(DEFAULT_MAP_ID);
  }

  private async loadMap(id: string): Promise<LoadedMap> {
    const def = getMap(id);
    const map = await this.maps.load(def, (f, label) => {
      this.ui.setLoading(f, label);
      if (this.state === 'menu') this.ui.setMenuStatus(`${label}... ${Math.round(f * 100)}%`);
    });
    this.map = map;
    this.damage = new DamageSystem(map.zones);
    this.player = new PlayerController(map.world);
    this.cameraRig = new PlayerCamera(this.ctx, this.player);
    const s = this.settings.value;
    map.environment.applyShadowPreset(SHADOW_PRESETS[s.shadowQuality], this.ctx.camera);
    // the view-model ignores direct sun (it never receives shadows, so it would glow in dark alleys)
    if (this.weaponView) map.environment.sun.excludedMeshes.push(...this.weaponView.meshes);
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
    this.ui.setMenuStatus(`Ready · loaded in ${(map.stats.loadMs / 1000).toFixed(1)} s`);
    this.ui.setPlayReady(true);
    console.info('[crossfire] map loaded', map.stats);
    return map;
  }

  async play(id: string): Promise<void> {
    this.audio.unlock();
    if (!this.map || this.map.def.id !== id) {
      this.state = 'loading';
      this.ui.show('loading');
      try {
        await (this.loadPromise && getMap(id).id === DEFAULT_MAP_ID ? this.loadPromise : this.loadMap(id));
      } catch (e) {
        console.error(e);
        this.ui.showError(`Could not load the map: ${(e as Error).message}`);
        return;
      }
    }
    this.spawn();
    if (this.options.autoplay) {
      this.state = 'playing';
      this.input.enabled = true;
      this.ui.show('hud');
      if (this.options.hideHud) this.hideAllUi();
      return;
    }
    this.state = 'start';
    this.ui.show('start');
  }

  private hideAllUi(): void {
    document.getElementById('ui')!.style.display = 'none';
  }

  private spawn(): void {
    const map = this.map!;
    const player = this.player!;
    const blue = map.spawns.filter((s) => s.team === 'blue');
    const sp = blue[Math.floor(Math.random() * blue.length)] ?? map.spawns[0];
    player.teleport({ x: sp.pos[0], y: sp.pos[1] + 0.2, z: sp.pos[2] }, sp.heading);
    if (this.options.cam) {
      const [x, y, z, h = 0, pitch = 0] = this.options.cam;
      player.teleport({ x, y, z }, h);
      player.pitch = (pitch * Math.PI) / 180;
    }
    this.weapon.refill();
    this.health = PLAYER_MAX_HEALTH;
    this.cameraRig?.snapFov(this.settings.value.fov);
  }

  private async enterPlay(): Promise<void> {
    this.audio.unlock();
    await this.input.requestLock();
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
    this.state = 'menu';
    this.input.enabled = false;
    this.input.releaseLock();
    this.weaponView?.setVisible(false);
    this.effects?.clearDecals();
    this.ui.show('menu');
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
    } else if (this.map && (this.state === 'menu' || this.state === 'start' || this.state === 'loading')) {
      this.menuCamera(dt);
    }
    this.effects?.update(dt);
    this.map?.barriers.update(dt, this.ctx.camera.position);
    this.ui.update(dt);
    this.updateHudMeta();
    this.ctx.scene.render();
    this.input.endFrame();
  }

  private menuCamera(dt: number): void {
    this.menuOrbit += dt * 0.04;
    const cam = this.ctx.camera;
    const r = 34;
    cam.position.set(Math.sin(this.menuOrbit) * r, 21, Math.cos(this.menuOrbit) * r);
    cam.setTarget(new Vector3(0, 2, 0));
    this.ctx.setFov(70);
    this.weaponView?.setVisible(false);
  }

  private intent: MoveIntent = { ...NO_INTENT };

  private simulate(dt: number): void {
    const player = this.player!;
    const rig = this.cameraRig!;
    const map = this.map!;
    const s = this.settings.value;
    const input = this.input;
    this.weaponView?.setVisible(true);

    const zoom = 1 + (this.weapon.stats.adsFovScale - 1) * this.weapon.ads;
    const look = input.takeMouseDelta();
    rig.applyLook(look.dx, look.dy, s.mouseSensitivity, s.invertY, zoom);
    this.weaponView?.addSway(look.dx, look.dy);

    const it = this.intent;
    it.x = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    it.z = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    it.sprint = input.isDown('sprint');
    it.crouch = input.isDown('crouch');
    it.aim = input.isDown('aim');
    let jumpEdge = input.wasPressed('jump');
    let fireEdge = input.wasPressed('fire');
    let reloadEdge = input.wasPressed('reload');

    this.acc += dt;
    const events: WeaponEvent[] = [];
    while (this.acc >= FIXED_DT) {
      it.jumpPressed = jumpEdge;
      const wasGrounded = player.grounded;
      player.fixedUpdate(FIXED_DT, it);
      rig.onTick();
      if (jumpEdge && wasGrounded && !player.grounded && player.velocity.y > 0) this.sound('jump', 0.35);
      if (player.landedSpeed > 4) this.sound('land', Math.min(0.8, player.landedSpeed * 0.07));
      const sprinting = it.sprint && it.z > 0.3 && player.grounded && player.horizontalSpeed > MOVEMENT.walkSpeed + 0.3;
      events.length = 0;
      this.weapon.update(
        FIXED_DT,
        {
          trigger: input.isDown('fire'),
          triggerPressed: fireEdge,
          reloadPressed: reloadEdge,
          aim: it.aim,
          moveFactor: player.horizontalSpeed / MOVEMENT.sprintSpeed,
          airborne: !player.grounded,
          sprinting,
        },
        events,
      );
      for (const e of events) this.onWeaponEvent(e);
      map.targets.update(FIXED_DT);
      this.footsteps(FIXED_DT);
      if (player.position.y < map.def.collision.killY) this.spawn();
      jumpEdge = fireEdge = reloadEdge = false;
      this.acc -= FIXED_DT;
    }
    const alpha = this.acc / FIXED_DT;
    rig.update(dt, alpha, s.fov, zoom);
    const sprinting = it.sprint && it.z > 0.3 && player.grounded && player.horizontalSpeed > MOVEMENT.walkSpeed + 0.3;
    this.weaponView?.update(dt, {
      ads: this.weapon.ads,
      reloadProgress: this.weapon.reloadProgress,
      reloading: this.weapon.reloading,
      sprinting,
      bobX: rig.bobX,
      bobY: rig.bobY,
      crouch: player.crouch,
    });
    this.blockedToastCooldown = Math.max(0, this.blockedToastCooldown - dt);

    // safe zone state
    const zone = map.zones.zoneAt(this.attacker.position(), MOVEMENT.radius);
    const team = zone?.team ?? null;
    if (team !== this.zoneTeam) {
      this.zoneTeam = team;
      this.ui.setZone(team);
      if (team) {
        this.sound('zone_enter', 0.5);
        if (this.weapon.reserve < this.weapon.stats.reserve || this.weapon.ammo < this.weapon.stats.magazine) {
          this.weapon.refill();
          this.ui.showToast('Ammo resupplied', 'blue');
        }
      }
    }
    // HUD
    const spreadDeg = this.weapon.spread({ moveFactor: player.horizontalSpeed / MOVEMENT.sprintSpeed, airborne: !player.grounded });
    const px = (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan(this.ctx.camera.fov / 2)) * (this.ctx.engine.getRenderWidth() / 2);
    // render pixels -> CSS pixels
    this.ui.setCrosshairSpread(px * this.ctx.engine.getHardwareScalingLevel(), this.weapon.ads < 0.6 && !sprinting);
    this.ui.setAmmo(this.weapon.ammo, this.weapon.reserve, this.weapon.stats.magazine, this.weapon.reloading, this.weapon.reloadProgress);
    this.ui.setHealth(this.health, PLAYER_MAX_HEALTH);
  }

  private onWeaponEvent(e: WeaponEvent): void {
    switch (e.type) {
      case 'fire':
        this.fireShot(e.spread);
        break;
      case 'empty':
        this.sound('empty', 0.7);
        if (this.weapon.reserve === 0) this.ui.showToast('Out of ammo - visit a safe zone to resupply', 'warn');
        break;
      case 'reloadStart':
        this.sound('reload_out', 0.6);
        break;
      case 'reloadEnd':
        this.sound('reload_in', 0.6);
        break;
    }
  }

  private fireShot(spreadDeg: number): void {
    const map = this.map!;
    const cam = this.ctx.camera;
    this.stats.shots++;
    this.sound('shot', 0.55);
    this.weaponView?.fire();
    this.cameraRig?.addRecoil(this.weapon.stats.recoilPitch * (1 - this.weapon.ads * 0.4), this.weapon.stats.recoilYaw);
    cam.computeWorldMatrix();
    const origin = cam.globalPosition.clone();
    const fwd = cam.getDirection(new Vector3(0, 0, -1)).normalize();
    const dir = applySpread({ x: fwd.x, y: fwd.y, z: fwd.z }, spreadDeg);
    const range = this.weapon.stats.range;
    const hit = map.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
    const muzzle = this.weaponView?.muzzleWorld() ?? origin;
    const end = hit ? new Vector3(hit.point.x, hit.point.y, hit.point.z) : origin.add(new Vector3(dir.x, dir.y, dir.z).scale(range));
    this.effects?.tracer(muzzle, end);
    if (!hit) return;
    const target = map.targets.find(hit.collider);
    const normal = new Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    if (target) {
      const zone = target.zoneAt(hit.point);
      const amount = this.weapon.stats.damage * (zone === 'bullseye' ? this.weapon.stats.critMultiplier : 1);
      const res = this.damage!.tryApply(this.attacker, target, { amount, point: hit.point, zone });
      this.effects?.burst(end.add(normal.scale(0.02)), normal, 8);
      if (res.applied) {
        this.stats.hits++;
        this.ui.hitMarker(zone === 'bullseye');
        this.sound(zone === 'bullseye' ? 'hit_crit' : 'hit', 0.65);
      } else if (res.reason !== 'target-dead') {
        this.sound('blocked', 0.5);
        if (this.blockedToastCooldown <= 0) {
          this.ui.showToast(
            res.reason === 'attacker-in-safe-zone' ? 'You are in a safe zone - damage disabled' : 'Target is protected by a safe zone',
            'blue',
          );
          this.blockedToastCooldown = 1.5;
        }
      }
    } else {
      this.effects?.impact(end, normal);
    }
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
    if (this.state === 'playing') {
      const acc = this.stats.shots ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
      this.ui.setStats(`Targets down ${this.stats.downs} · Accuracy ${acc}%`);
    }
  }

  // --- automation hooks (used by tools/browser-test.mjs) ---------------------------------------
  debugApi() {
    return {
      ready: () => this.state === 'playing' && !!this.map,
      state: () => this.state,
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
      stats: () => ({
        fps: this.fps.value,
        frameMs: this.instrumentation.frameTimeCounter.lastSecAverage,
        drawCalls: this.instrumentation.drawCallsCounter.current,
        activeMeshes: this.ctx.scene.getActiveMeshes().length,
        totalVertices: this.ctx.scene.getTotalVertices(),
        map: this.map?.stats,
        missingMaterials: [...this.materials.missing],
        shots: this.stats.shots,
        hits: this.stats.hits,
        downs: this.stats.downs,
        ammo: this.weapon.ammo,
        zone: this.zoneTeam,
        zoneBarriers: this.ctx.scene.meshes.filter((m) => m.name.startsWith('zone-barrier:')).length,
        zoneLabels: this.ctx.scene.meshes.filter((m) => m.name.startsWith('zone-label:')).length,
      }),
      setSetting: (patch: Partial<Settings>) => this.settings.update(patch),
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
