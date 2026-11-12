import {meleeClip,meleeBlocked} from '../../shared/melee';
import { visualCosmetic } from '../rendering/CosmeticAssets';
import { Color3, Frustum, Material, Matrix, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, type Scene, type Mesh, type BaseTexture } from '@babylonjs/core';
import type { Elimination, PlayerState, Snapshot } from '../../shared/protocol';
import { playerColor } from '../ui/teamColors';
import { CharacterAssetLibrary, type CharacterInstance } from './CharacterAsset';
import { VisibilityWorld } from '../rendering/VisibilityWorld';
import { animationVelocity } from './PlayerAnimation';
import { deathPose } from './CombatPresentation';
import { PlayerSilhouettes } from '../rendering/PlayerSilhouettes';
import { CharacterWeaponLibrary, type CharacterWeapon } from './CharacterWeapon';
import { MeleeLibrary, type CharacterMelee } from './melee/MeleeAssets';
import type { MeleeClipName, MeleeStage } from './melee/MeleeAnimation';
import { MeleeTrails, trailPlan } from './melee/MeleeTrail';
import { presentedAction, ShotTimeline } from './RemoteTimeline';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import { WEAPONS, type WeaponId, type WeaponState } from '../weapons/Weapon';
import { MOVEMENT, PLAYER_MAX_HEALTH } from '../config/constants';
import { LEAN_CAMERA_ANGLE, leanOffset } from '../../shared/lean';
import {DeathMotion} from './DeathMotion';
import {hashSeed} from './LimpBody';
import type {CollisionWorld} from '../physics/CollisionWorld';
import type {AimTarget} from '../player/AimAssist';
import {extrapolatedPosition} from '../network/remoteMotion';

interface Sample { at: number; player: PlayerState }
interface Avatar {
  root: TransformNode; look: TransformNode; samples: Sample[]; seen: number;
  meshes: Mesh[]; label: HTMLDivElement; nameLabel:HTMLSpanElement; healthFill:HTMLSpanElement; shownHealth:number; character: CharacterInstance | null;
  friendly: boolean; visible: boolean; clearFor: number; height: number;
  lean: number; visualScaleY:number; crouch:number; lowAmount:number;
  weapon: CharacterWeapon | null;
  /** Dual daggers (created on first use; survive gun swaps, hidden at death). */
  melee?: CharacterMelee | null;
  meleeKey?:string;
  meleeDebug?:boolean;
  /** Cosmetic blade trails in world space (created at this player's first trail). */
  trails?: MeleeTrails;
  loadingCosmetic?:string; failedCosmetic?:string;
  weaponAds: number;
  poseSampleAt?:number;extrapolating?:boolean;
  correction?:{x:number;y:number;z:number};
  /** Server-confirmed shots waiting for the interpolated pose to reach them. */
  shots: ShotTimeline;
  life: number; death?: { elapsed: number; started: number; direction: Elimination['direction']; rotation: Quaternion; motion:DeathMotion; axis: Vector3; materials: Material[]; textures: Set<BaseTexture> };
}

/** Interval between shots at the weapon's cadence (milliseconds). */
const shotInterval = (id: WeaponId | null) => 60000 / (WEAPONS.find((w) => w.id === id)?.rpm ?? 600);
/** Arm/finger solves for distant players run every Nth frame (cached in between); `detail`
 * below 1 (low graphics quality) brings those distances closer. */
export function solveInterval(distance: number, detail = 1): number {
  const d = distance / Math.max(.25, detail);
  return d > 32 ? 3 : d > 16 ? 2 : 1;
}

/** Mirrors Weapon.update's ADS gate from synchronized intent and action, so the
 * third-person pose can blend on its own 150 ms curve instead of the slower gun ramp. */
export function aimIntent(player: Pick<PlayerState, 'weapon' | 'combat'>, action = player.combat.gun?.action): number {
  if (!player.combat.gun) return 0;
  const canAim = action === 'idle' || (action === 'cycle' && player.weapon !== 'sniper');
  return player.combat.aimHeld && canAim ? 1 : 0;
}

/** Real connected avatars with interpolated poses and relationship-based visibility. */
export class RemotePlayers {
  private readonly avatars = new Map<string, Avatar>();
  private readonly material: StandardMaterial;
  private readonly labels = document.createElement('div');
  private presenting = true;
  private smokeObscures: (from: Vector3, to: Vector3) => boolean = () => false;
  setSmokeVisibility(test: (from: Vector3, to: Vector3) => boolean): void { this.smokeObscures = test; }
  private spectatedId: string | null = null;
  private outlinesEnabled = true;
  private visibilityWorld: VisibilityWorld | null = null;
  private collisionWorld:CollisionWorld|null=null;
  private dt = 1 / 60;
  private animationDetail = 1;
  private trailsReduced = false;
  private silhouettes: PlayerSilhouettes | null = null;
  readonly characters: CharacterAssetLibrary;
  private readonly weapons: CharacterWeaponLibrary;
  /** Dagger models and clips for this scene (also used by the first-person MeleeView). */
  readonly meleeLibrary: MeleeLibrary;
  constructor(private readonly scene: Scene, uiRoot: HTMLElement, materials: MaterialLibrary) {
    this.characters = new CharacterAssetLibrary(scene);
    this.weapons = new CharacterWeaponLibrary(scene, materials);
    this.meleeLibrary = new MeleeLibrary(scene);
    this.labels.className = 'remote-player-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    uiRoot.append(this.labels);
    this.material = new StandardMaterial('remote-player', scene);
    this.material.diffuseColor = new Color3(0.65, 0.5, 0.28);
    this.material.emissiveColor = new Color3(0.08, 0.06, 0.03);
    // Read actual animated bone positions after the engine evaluates this frame.
    scene.onBeforeAnimationsObservable.add(() => { for (const a of this.avatars.values()) { if(a.character&&!a.death)a.root.scaling.y=1; a.weapon?.restore(); a.character?.restoreLean(); } });
    scene.onAfterAnimationsObservable.add(() => {
      const camera = scene.activeCamera;
      const planes = camera ? Frustum.GetPlanes(camera.getTransformationMatrix()) : null;
      const eye = camera?.globalPosition;
      for (const [id, a] of this.avatars) {
        a.character?.applyLean();
        if(a.death)a.character?.poseDeath(a.death.elapsed,a.death.motion.angle,a.death.axis);
        if (a.weapon && !a.death) {
          // Arm IK only for avatars that can be seen; their blend states still advance.
          a.weapon.posing = a.root.isEnabled() && (!planes || a.meshes.some((mesh) => { mesh.computeWorldMatrix(); return mesh.isInFrustum(planes); }));
          a.weapon.solveEvery = eye ? solveInterval(Vector3.Distance(eye, a.root.position), this.animationDetail) : 1;
          a.weapon.update();
        }
        // Solve in the unchanged rig metric, then apply the low presentation to
        // body, hands and held model together. Nonuniform pre-IK scale twists grips.
        if(a.character&&!a.death){a.root.scaling.y=a.visualScaleY;a.root.computeWorldMatrix(true);}
        this.trail(a, id, eye);
        this.presentation(a, this.dt);
      }
      this.silhouettes?.update(this.outlinesEnabled && this.presenting);
    });
  }
  async prepare(signal?: AbortSignal): Promise<void> {
    await Promise.all([this.characters.load(signal), this.meleeLibrary.load(signal), ...WEAPONS.map(w=>w.id)
      .map((id) => this.weapons.load(id, signal))]);
  }
  async ready(signal?: AbortSignal): Promise<void> {
    await Promise.all([this.characters.ready(signal), this.weapons.ready(signal), this.meleeLibrary.whenReady(signal)]);
  }
  /** Dual-dagger presentation for one remote player (or every avatar with null): the combat
   * sync calls this with the authoritative melee state; presentation only. */
  presentMelee(id: string | null, command: 'equip' | 'unequip' | 'attack' | 'reset', stage?: MeleeStage): void {
    for (const [key, a] of this.avatars) {
      if (id !== null && key !== id) continue;
      const melee = this.meleeFor(key, a);
      if (!melee) continue;
      a.meleeDebug=command!=='reset';
      if (command === 'equip') melee.animator.equip();
      else if (command === 'unequip') melee.animator.unequip();
      else if (command === 'attack') melee.animator.attack(stage);
      else melee.animator.reset();
    }
  }
  /** Play a clip from a given elapsed time (late joiners / authoritative resync). */
  syncMelee(id: string, clip: MeleeClipName, elapsed: number): void {
    const a = this.avatars.get(id), melee = a && this.meleeFor(id, a);
    if(a)a.meleeDebug=true;
    // The random idle flourish is a cosmetic variant of idle: an idle resync must not cancel it.
    if (clip === 'idle' && melee?.animator.clip?.startsWith('flourish_')) return;
    if (melee && (melee.animator.clip !== clip || Math.abs(melee.animator.time - elapsed) > .1)) melee.animator.play(clip, elapsed);
  }
  inspectMelee(id?: string) {
    const out: Record<string, unknown> = {};
    // Avatars playing their death fade hold no daggers (put away at elimination).
    for (const [key, a] of this.avatars) if ((!id || key === id) && !a.death) { const base = a.weapon?.inspectMelee() ?? (a.melee ? a.melee.animator.inspect() : null); out[key] = base && { ...base, trail: a.trails?.inspect() ?? null }; }
    return out;
  }
  private meleeFor(id: string, a: Avatar): CharacterMelee | null {
    if (!a.melee && a.character && !a.death && this.meleeLibrary.ready) a.melee = this.meleeLibrary.createCharacterMelee(`remote-melee:${id}`);
    return a.melee ?? null;
  }
  prepareVisibility(world?:CollisionWorld): void {
    this.collisionWorld=world??null;
    this.visibilityWorld = VisibilityWorld.fromMeshes(this.scene.meshes);
    this.silhouettes ??= new PlayerSilhouettes(this.scene, this.scene.activeCamera!);
    this.silhouettes.setWorld(this.scene.meshes);
  }
  releaseVisibility(): void { this.visibilityWorld = null;this.collisionWorld=null; this.silhouettes?.clear(); }
  silhouetteStats() { return this.silhouettes?.inspect() ?? null; }
  setWorldSaturation(value:number):void {this.silhouettes?.setSaturation(value);}
  refreshEffects(): void { this.silhouettes?.keepLast(); }
  silhouetteInterior() { return this.silhouettes?.interiorPixels() ?? Promise.resolve([]); }
  visibilityStats() { return this.visibilityWorld?.inspect() ?? null; }
  setPresentationVisible(visible: boolean): void { this.presenting = visible; this.labels.hidden = !visible; }
  /** A scoped spectator may see labels only through the visible scope opening. */
  setSpectatorScope(scoped: boolean): void { this.labels.classList.toggle('spectator-scoped', scoped); }
  setSpectated(id: string | null): void {
    if (this.spectatedId === id) return;
    this.spectatedId = id;
    for (const [playerId, a] of this.avatars) {
      a.root.setEnabled(playerId !== id);
      if (playerId === id) { a.label.hidden = true; this.silhouettes?.remove(a.meshes); }
    }
  }
  spectatePose(id: string): { position: Vector3; rotation: Quaternion; weapon: WeaponId; cosmeticId:string; gun: WeaponState;
    melee?:import('../../shared/melee').MeleeState;meleeCosmeticId?:string;speed: number; verticalSpeed: number; grounded: boolean; sliding: boolean; crouch: number; lean:number } | null {
    const a = this.avatars.get(id);
    if (!a || a.death || !a.samples.length) return null;
    const player = a.samples.at(-1)!.player;
    if (!player.weapon || !player.combat.gun) return null;
    const crouch = a.crouch;
    const offset = leanOffset(a.root.rotation.y, a.lean);
    return { position: new Vector3(a.root.position.x + offset.x,
      a.root.position.y + (MOVEMENT.standEye + ((MOVEMENT.crouchEye+(MOVEMENT.slideEye-MOVEMENT.crouchEye)*a.lowAmount) - MOVEMENT.standEye) * crouch),
      a.root.position.z + offset.z),
      rotation: Quaternion.RotationYawPitchRoll(a.root.rotation.y, a.look.rotation.x, -a.lean * LEAN_CAMERA_ANGLE),
      weapon: player.weapon, cosmeticId:visualCosmetic(player.weapon,player.cosmeticId).id, gun: { ...player.combat.gun, ads: a.weaponAds },
      melee:player.combat.melee,meleeCosmeticId:player.meleeCosmeticId,speed: Math.hypot(player.motion.velocity.x, player.motion.velocity.z), verticalSpeed: player.motion.velocity.y,
      grounded: player.motion.grounded, sliding: player.motion.slideRemaining > 0, crouch, lean:a.lean };
  }
  setOutlinesEnabled(enabled: boolean): void { this.outlinesEnabled = enabled; }
  /** 1 = full third-person animation detail; lower values reduce distant arm solves. */
  setAnimationDetail(detail: number): void { this.animationDetail = detail; }
  setTrailsReduced(reduced: boolean): void { this.trailsReduced = reduced; for (const a of this.avatars.values()) a.trails?.setReduced(reduced); }
  /** Simplified third-person blade trail: sampled from the dagger's real world tip and guard
   * once per frame after the arms are posed (the ribbon is smoothed between frames). Skipped
   * for avatars that are unseen or far away; purely cosmetic. */
  private trail(a: Avatar, id: string, eye?: Vector3): void {
    const melee = a.melee, pose = melee?.pose, plan = pose && !a.death ? trailPlan(pose.clip) : null;
    const near = !eye || Vector3.DistanceSquared(eye, a.root.position) < 45 * 45;
    if (plan && pose && melee && near && a.visible && a.weapon?.posing && pose.trail >= .01 && melee.pair.bound) {
      if (!a.trails) { a.trails = new MeleeTrails(this.scene, `remote-melee:${id}`); a.trails.setReduced(this.trailsReduced); void a.trails.warm(); }
      a.trails.tick(this.dt);
      const tips = melee.pair.anchor('tip'), guards = melee.pair.anchor('guard');
      for (const i of [0, 1] as const) if (plan.sides[i]) a.trails.push(i, plan.finisher, tips[i], guards[i], pose.trail);
      a.trails.flush(eye);
    } else if (a.trails) {
      if (a.death || !a.visible) a.trails.clear();
      else { a.trails.tick(this.dt); a.trails.flush(eye); }
    }
  }
  /** A server-confirmed shot by this player; its cosmetic recoil plays when the delayed
   * (interpolated) pose reaches it. `serverNow` is the estimated current server time. */
  muzzle(id:string):Vector3|null { return this.avatars.get(id)?.weapon?.muzzleWorld()??null; }
  fire(id: string, weapon: WeaponId, serverNow: number): void {
    this.avatars.get(id)?.shots.receive(serverNow, shotInterval(weapon));
  }
  effectAnchor(id: string): TransformNode | null { const a=this.avatars.get(id);return a&&!a.death?a.root:null; }
  private remove(a: Avatar): void {
    // The daggers hang from the character's hand bones: release them before the rig.
    a.melee?.dispose(); a.melee = null;
    a.trails?.dispose(); a.trails = undefined;
    this.silhouettes?.remove(a.meshes); a.weapon?.dispose(); a.character?.dispose(); a.root.dispose(); a.label.remove();
    for (const material of a.death?.materials ?? []) material.dispose(false, false);
    for (const texture of a.death?.textures ?? []) texture.dispose();
  }
  private readonly meleeFinishers=new Set<string>();
  meleeImpact(event:import('../../shared/protocol').MeleeResult):void {
    if(event.stage!==3)return;
    for(const hit of event.hits){if(!hit.killed||hit.amount<=0)continue;const key=`${hit.id}:${hit.life}`;
      if(this.meleeFinishers.has(key))continue;this.meleeFinishers.add(key);
      if(this.meleeFinishers.size>128)this.meleeFinishers.delete(this.meleeFinishers.values().next().value!);
      const avatar=this.avatars.get(hit.id);if(avatar?.life===hit.life)avatar.death?.motion.emphasize();
    }
  }
  eliminate(event: Elimination): void {
    this.avatars.get(event.victimId)?.weapon?.stopFiring();
    const a = this.avatars.get(event.victimId);
    if (!a || a.life !== event.victimLife || a.death) return;
    const materials = new Map<Material, Material>();
    const textures = new Set<BaseTexture>();
    for (const mesh of [...a.meshes, ...(a.weapon?.meshes ?? [])]) if (mesh.material) {
      const source = mesh.material;
      let copy = materials.get(source);
      if (!copy) {
        copy = source.clone(`death:${event.id}:${source.name}`)!;
        for (const texture of copy.getActiveTextures()) if (!source.getActiveTextures().includes(texture)) textures.add(texture);
        copy.transparencyMode = Material.MATERIAL_ALPHABLEND;
        copy.needDepthPrePass = true;
        materials.set(source, copy);
      }
      // Keep the already compiled, lit material while the transparent skinning
      // variant warms up. Swapping immediately rendered the falling body black
      // during parallel shader compilation on a cold graphics cache.
      const faded=copy;
      void faded.forceCompilationAsync(mesh).then(()=>{
        if(this.avatars.get(event.victimId)===a&&a.death&&!mesh.isDisposed())mesh.material=faded;
      }).catch(()=>{ /* Retain the original lit material if the GPU rejects the fade variant. */ });
    }
    const motion=new DeathMotion(a.root.position,event.direction,this.collisionWorld),rotation=Quaternion.FromEulerAngles(0, a.root.rotation.y, 0);
    // The body tips about Cross(up, fall): the limbs lag behind that rotation in the character's own pre-fall frame.
    if(this.meleeFinishers.has(`${event.victimId}:${event.victimLife}`))motion.emphasize();
    const axis=new Vector3(motion.fall.z,0,-motion.fall.x).applyRotationQuaternionInPlace(Quaternion.Inverse(rotation));
    a.death = { elapsed: 0, started: performance.now(), direction: event.direction, motion, axis, rotation, materials: [...materials.values()], textures };
    // Relax from the exact pose of the last frame (gun or dagger IK included), whatever the player was doing.
    a.character?.captureDeath(hashSeed(event.id));
    a.label.hidden = true;
    this.silhouettes?.remove(a.meshes);
    // The death fade clones character/gun materials only: put the daggers away at once.
    if (a.melee) { a.melee.animator.reset(); a.melee.advance(0); a.melee.pair.update(a.melee.pose); }
  }
  /** Test hook: play the real death presentation for one avatar (no scoring, no authority). */
  debugEliminate(id: string | null, direction: Elimination['direction']): string | null {
    const found = [...this.avatars].find(([key, a]) => (id === null || key === id) && !a.death);
    if (!found) return null;
    const [key, a] = found;
    this.eliminate({ id: `debug:${key}:${Math.round(performance.now())}`, victimId: key, victimLife: a.life, direction, award: null, roundId: 0, victimName: '',
      killerId: null, killerName: null, weapon: null, head: false, at: 0, respawnAt: 0, killerTeam: null, victimTeam: null });
    return key;
  }
  snapshot(s: Snapshot, selfId: string): void {
    const self = s.players.find((p) => p.id === selfId);
    const ids = new Set(s.players.filter((p) => p.id !== selfId && p.alive).map((p) => p.id));
    for (const [id, avatar] of this.avatars) {
      const current = s.players.find((p) => p.id === id);
      if ((!ids.has(id) && !(avatar.death && current)) || (current && current.life !== avatar.life)) {
        this.remove(avatar); this.avatars.delete(id);
      }
    }
    for (const player of s.players) {
      if (player.id === selfId || !player.alive) continue;
      let a = this.avatars.get(player.id);
      if (!a) {
        const root = new TransformNode(`remote:${player.id}`, this.scene);
        const character = this.characters.instantiate(root, player.id);
        const meshes: Mesh[] = character?.meshes ?? [];
        const look = new TransformNode(`remote-look:${player.id}`, this.scene);
        look.parent = root;
        look.position.y = 1.6;
        if (!character) {
          const body = MeshBuilder.CreateCapsule(`remote-body:${player.id}`, { height: 1.8, radius: 0.3 }, this.scene);
          body.parent = root; body.position.y = .9; body.material = this.material; body.isPickable = false;
          const face = MeshBuilder.CreateBox(`remote-facing:${player.id}`, { width: .22, height: .16, depth: .14 }, this.scene);
          face.parent = look; face.position.set(0, 0, -.29); face.material = this.material; face.isPickable = false;
          meshes.push(body);
        }
        const label = document.createElement('div');
        label.className = 'remote-player-label'; label.dataset.playerId = player.id; label.hidden = true;
        const nameLabel=document.createElement('span');nameLabel.className='remote-player-name';
        const healthBar=document.createElement('span');healthBar.className='remote-player-health';const healthFill=document.createElement('span');healthBar.append(healthFill);label.append(nameLabel,healthBar);
        this.labels.append(label);
        a = { root, look, samples: [], seen: performance.now(), label, nameLabel, healthFill, shownHealth:player.health/PLAYER_MAX_HEALTH, character,
          meshes, weapon: null, weaponAds: player.combat.gun?.ads ?? 0, shots: new ShotTimeline(), friendly: false, visible: false, clearFor: 0, height: 1.8, lean: 0, visualScaleY:1, crouch:0, lowAmount:0, life: player.life };
        this.avatars.set(player.id, a);
        root.setEnabled(player.id !== this.spectatedId);
      }
      if(player.weapon&&a.character){
        const weapon=player.weapon,key=visualCosmetic(weapon,player.cosmeticId).id,avatar=a;
        if(a.weapon?.id!==weapon||a.weapon.cosmeticId!==key){
          const ready=this.weapons.create(a.character,weapon,key);
          if(ready){a.weapon?.dispose();a.weapon=ready;}
          else if(a.loadingCosmetic!==key&&a.failedCosmetic!==key){
            a.loadingCosmetic=key;if(!a.weapon)a.weapon=this.weapons.create(a.character,weapon);
            void this.weapons.load(weapon,undefined,key).then(()=>{
              const latest=avatar.samples.at(-1)?.player;if(this.avatars.get(player.id)!==avatar||!latest?.weapon||visualCosmetic(latest.weapon,latest.cosmeticId).id!==key)return;
              const next=this.weapons.create(avatar.character!,weapon,key);if(next){avatar.weapon?.dispose();avatar.weapon=next;}
            }).catch(()=>{avatar.failedCosmetic=key;}).finally(()=>{if(avatar.loadingCosmetic===key)avatar.loadingCosmetic=undefined;});
          }
        }
      }else if(!player.weapon){a.weapon?.dispose();a.weapon=null;}
      a.friendly = playerColor(s.match.mode, selfId, self?.team ?? null, player.id, player.team) === 'friendly';
      if (a.nameLabel.textContent !== player.name) a.nameLabel.textContent = player.name;
      a.label.dataset.health=String(player.health);a.label.dataset.maxHealth=String(PLAYER_MAX_HEALTH);
      a.label.dataset.relationship = a.friendly ? 'teammate' : 'opponent';
      a.seen = performance.now();
      const last=a.samples.at(-1);
      if(last&&s.serverTime<last.at)continue;
      if(last?.at===s.serverTime)a.samples[a.samples.length-1]={at:s.serverTime,player};
      else{
        if(last&&Math.hypot(player.motion.position.x-last.player.motion.position.x,player.motion.position.y-last.player.motion.position.y,player.motion.position.z-last.player.motion.position.z)>2.5){a.samples.length=0;a.correction=undefined;a.extrapolating=false;}
        a.samples.push({ at: s.serverTime, player });
      }
      a.shots.stamp(s.serverTime);
      if (a.samples.length > 30) a.samples.shift();
    }
  }
  update(serverTime: number, dt = 1 / 60): void {
    this.dt = dt;
    for (const [id, a] of this.avatars) {
      if (a.death) {
        const death = a.death;
        death.elapsed = (performance.now() - death.started) / 1000;
        const pose = deathPose(death.elapsed, death.direction);
        if (pose.done) { this.remove(a); this.avatars.delete(id); continue; }
        // Cross(up, fall) rotates the upright body away from the incoming shot.
        death.motion.advance(dt);const body=death.motion;
        a.root.rotationQuaternion = Quaternion.RotationAxis(new Vector3(body.fall.z, 0, -body.fall.x), body.angle).multiply(death.rotation);
        const hip=new Vector3(0,.9,0).applyRotationQuaternion(a.root.rotationQuaternion);
        a.root.position.set(body.center.x-hip.x,body.center.y-hip.y,body.center.z-hip.z);
        // The collision spheres keep the body axis 0.30 m up while the real torso is thinner: settle the lying body onto the floor.
        const lying=Math.min(1,body.angle/(Math.PI*.45));a.root.position.y-=.04*lying*lying;
        for (const material of death.materials) material.alpha = pose.opacity;
        continue;
      }
      if (performance.now() - a.seen > 4000) { this.remove(a); this.avatars.delete(id); continue; }
      const samples = a.samples;
      a.shownHealth+=(samples.at(-1)!.player.health/PLAYER_MAX_HEALTH-a.shownHealth)*(1-Math.exp(-dt*18));
      a.healthFill.style.transform=`scaleX(${Math.max(0,Math.min(1,a.shownHealth))})`;
      while (samples.length > 2 && samples[1].at < serverTime) samples.shift();
      const older = samples[0], newer = samples[1] ?? older;
      const k = Math.max(0, Math.min(1, (serverTime - older.at) / Math.max(1, newer.at - older.at)));
      const m = older.player.motion, n = newer.player.motion;
      const predicted=serverTime>newer.at,position=predicted?extrapolatedPosition(n,serverTime-newer.at,this.collisionWorld):{
        x:m.position.x+(n.position.x-m.position.x)*k,y:m.position.y+(n.position.y-m.position.y)*k,z:m.position.z+(n.position.z-m.position.z)*k};
      if(a.extrapolating&&a.poseSampleAt!==newer.at){
        const error=a.root.position.subtract(new Vector3(position.x,position.y,position.z));
        a.correction=error.length()<1.5?{x:error.x,y:error.y,z:error.z}:undefined;
      }
      if(a.correction){const decay=Math.exp(-Math.max(0,dt)*24);a.correction.x*=decay;a.correction.y*=decay;a.correction.z*=decay;
        const offset=this.collisionWorld?.moveCylinder(position.x,position.z,a.correction.x,a.correction.z,MOVEMENT.radius,position.y+MOVEMENT.stepHeight,position.y+a.height);
        position.x=offset?.x??position.x+a.correction.x;position.z=offset?.z??position.z+a.correction.z;
        // Vertical corrections stay on the actual interpolated floor/ceiling band.
      }
      a.root.position.set(position.x,position.y,position.z);a.poseSampleAt=newer.at;a.extrapolating=predicted;
      a.root.rotation.y = m.yaw + Math.atan2(Math.sin(n.yaw - m.yaw), Math.cos(n.yaw - m.yaw)) * k;
      a.look.rotation.x = m.pitch + (n.pitch - m.pitch) * k;
      const ads = (older.player.combat.gun?.ads ?? 0) + ((newer.player.combat.gun?.ads ?? 0) - (older.player.combat.gun?.ads ?? 0)) * k;
      a.weaponAds = ads;
      const gun = presentedAction({ at: older.at, gun: older.player.combat.gun }, { at: newer.at, gun: newer.player.combat.gun }, serverTime);
      a.weapon?.setState({ pitch: a.look.rotation.x, ads: aimIntent(newer.player, gun?.action), airborne: !(k < .5 ? m.grounded : n.grounded),
        action: gun?.action ?? 'idle', progress: gun?.progress ?? 0 });
      if (a.shots.due(serverTime)) a.weapon?.fire();
      const meleeState=(newer.player.combat.melee&&newer.player.combat.melee.startedAt<=serverTime?newer.player:older.player).combat.melee;
      if(!a.meleeDebug&&meleeBlocked(meleeState)){
        const melee=this.meleeFor(id,a),clip=meleeState&&meleeClip(meleeState),key=meleeState&&`${clip}:${meleeState.startedAt}:${meleeState.sequence}`;
        if(melee&&clip&&key!==a.meleeKey){a.meleeKey=key;melee.animator.play(clip as MeleeClipName,Math.max(0,(serverTime-meleeState!.startedAt)/1000));}
        melee?.pair.setCosmetic(newer.player.meleeCosmeticId);
      }else if(!a.meleeDebug&&meleeState&&a.melee?.active){a.melee.animator.reset();a.meleeKey='';}
      if (a.melee) {
        a.melee.advance(dt);
        if (a.weapon && a.weapon.melee !== a.melee) a.weapon.melee = a.melee;
      }
      a.weapon?.advance(dt);
      const crouch = m.crouch + (n.crouch - m.crouch) * k;
      a.lean = m.lean + (n.lean - m.lean) * k;
      a.character?.setLean(a.lean);
      if (!a.character) {
        const body = a.meshes[0];
        body.rotation.z = -a.lean * .12;
        body.position.x = a.lean * .06;
        a.look.position.x = a.lean * .28;
      }

      const low = Number(!!m.lowClearance)*(1-k)+Number(!!n.lowClearance)*k;
      a.crouch=crouch;a.lowAmount=low;
      a.height = 1.8 + (1.15 + (.78-1.15)*low - 1.8)*crouch;
      a.visualScaleY = a.height/(1.8-.65*crouch);
      a.root.scaling.set(1, a.character ? 1 : a.height/1.8, 1);
      a.character?.update({ crouch, grounded: k < .5 ? m.grounded : n.grounded,
        slideRemaining: m.slideRemaining + (n.slideRemaining - m.slideRemaining) * k,
        velocity: animationVelocity(m, n, (newer.at - older.at) / 1000, k) }, dt);
    }
  }
  private presentation(a: Avatar, dt: number): void {
    if (a.death || !a.root.isEnabled()) { a.label.hidden = true; return; }
    const cam = this.scene.activeCamera;
    if (!cam) return;
    cam.computeWorldMatrix();
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const width = canvas?.clientWidth || engine.getRenderWidth(), height = canvas?.clientHeight || engine.getRenderHeight();
    const eye = cam.globalPosition;
    const head = a.character?.headPosition() ?? a.root.position.add(new Vector3(0, a.height + .14, 0));
    const screen = Vector3.Project(head, Matrix.IdentityReadOnly, cam.getTransformationMatrix(), cam.viewport.toGlobal(width, height));
    const forward = cam.getForwardRay().direction;
    const inView = Vector3.Dot(head.subtract(eye), forward) > .1 && screen.z >= 0 && screen.z <= 1
      && screen.x >= 0 && screen.x <= width && screen.y >= 0 && screen.y <= height;
    const distance = Vector3.Distance(eye, head);
    const planes = Frustum.GetPlanes(cam.getTransformationMatrix());
    const bodyInView = a.meshes.some((mesh) => { mesh.computeWorldMatrix(); return mesh.isInFrustum(planes); });
    // A scoped torso can be visible while its head marker is above the viewport.
    // Do not use the name anchor to decide whether the body outline can render.
    const smoked = this.smokeObscures(eye, head);
    a.visible = !smoked && this.presenting && bodyInView && this.visibleBody(a, eye);
    // Reveal after stable visibility; hide immediately when all interior probes are
    // occluded. Never retain an enemy marker behind a newly occluding wall.
    a.clearFor = a.visible ? Math.min(.1, a.clearFor + dt) : 0;
    this.silhouettes?.set(a.meshes, a.friendly, this.presenting && bodyInView && !smoked);
    a.label.hidden = smoked || !this.presenting || !inView || (!a.friendly && a.clearFor < .04);
    if (!a.label.hidden) {
      a.label.style.left = `${screen.x}px`; a.label.style.top = `${screen.y}px`;
      a.label.style.fontSize = `${Math.max(11, Math.min(14, 15 - distance * .07))}px`;
    }
  }

  private visibleBody(a: Avatar, eye: Vector3): boolean {
    const p = a.root.position, h = a.height;
    // Interior points avoid revealing a fully hidden body merely because an
    // expanded outline hull extends around a wall edge. Actual static triangles
    // (including door openings) are tested, not an avatar bounding box.
    const probes = [[0, h - .2], [0, h * .52], [-.18, h * .58], [.18, h * .58], [0, .23]];
    const points = a.character?.visibilityPoints() ?? probes.map(([side, y]) =>
      new Vector3(p.x + Math.cos(a.root.rotation.y) * side, p.y + y, p.z - Math.sin(a.root.rotation.y) * side));
    for (const point of points) {
      const delta = point.subtract(eye), length = delta.length();
      if (length < .1) return true;
      if (!this.visibilityWorld?.occluded(eye, delta.scale(1 / length), length - .04)) return true;
    }
    return false;
  }

  aimTargets(head=false):AimTarget[]{return [...this.avatars].flatMap(([id,a])=>{
    const motion=a.samples.at(-1)?.player.motion;
    const offset=head?leanOffset(a.root.rotation.y,a.lean):{x:0,z:0};
    return !a.death&&!a.friendly&&a.visible&&a.clearFor>=.04&&motion?[{id,point:{x:a.root.position.x+offset.x,y:a.root.position.y+(head?a.height-.2:a.height*.68),z:a.root.position.z+offset.z},velocity:{...motion.velocity},grounded:motion.grounded,sliding:motion.slideRemaining>0}]:[];
  });}
  aimVisible(target:AimTarget,eye:{x:number;y:number;z:number}):boolean{
    const from=new Vector3(eye.x,eye.y,eye.z),to=new Vector3(target.point.x,target.point.y,target.point.z),delta=to.subtract(from),distance=delta.length();
    return !!this.visibilityWorld&&!this.smokeObscures(from,to)&&!this.visibilityWorld.occluded(from,delta.scale(1/Math.max(.001,distance)),distance-.04);
  }
  inspect() {
    return [...this.avatars].map(([id, a]) => ({ id, x: a.root.position.x, y: a.root.position.y, z: a.root.position.z,
      yaw: a.root.rotation.y, scale: a.root.scaling.x, height: a.height, lean: a.lean, friendly: a.friendly, visible: a.visible,
      extrapolating:!!a.extrapolating,
      labelVisible: !a.label.hidden && !this.labels.hidden, outline: !a.death && a.visible && (this.silhouettes?.has(a.meshes) ?? false),
      death: a.death ? { elapsed: a.death.elapsed, ...deathPose(a.death.elapsed, a.death.direction),
        alpha: a.meshes[0].material?.alpha, rotation: a.root.rotationQuaternion?.asArray() } : null,
      source: a.character ? 'glb' : 'placeholder', animation: a.character?.inspect() ?? null, weapon: a.weapon?.inspect() ?? null,
      shots: a.shots.inspect(),
      health: a.samples.at(-1)?.player.health ?? 0 }));
  }
  /** Lightweight frame sampling for network diagnostics; avoids inspecting every rig bone. */
  motionSamples(){return [...this.avatars].filter(([,a])=>!a.death).map(([id,a])=>({id,x:a.root.position.x,y:a.root.position.y,z:a.root.position.z,extrapolating:!!a.extrapolating}));}
  clear(): void {
    this.meleeFinishers.clear();
    for (const a of this.avatars.values()) this.remove(a);
    this.avatars.clear(); this.labels.classList.remove('spectator-scoped'); this.silhouettes?.update(false);
  }
}
