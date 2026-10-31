import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, MeshBuilder,
  PBRMaterial, Quaternion, Scene, Space, TransformNode, Vector3 } from '@babylonjs/core';
import { CharacterAssetLibrary, type CharacterInstance } from '../game/CharacterAsset';
import { CharacterWeaponLibrary, type CharacterWeapon, type CharacterHoldPose } from '../game/CharacterWeapon';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { WeaponId } from '../weapons/Weapon';

/** Each existing model has different grip spacing, stock and fore-end geometry. */
const HOME_HOLDS: Record<WeaponId, CharacterHoldPose> = {
  rifle: { offset: [.08, .01, -.20], yaw: .72, pitch: .18, elbows: [[.40, 1.10, -.14], [-.37, 1.09, -.28]], hands: [[0, -1, 0], [0, -.3, -1]] },
  shotgun: { offset: [.09, -.02, -.19], yaw: .82, pitch: .22, elbows: [[.40, 1.08, -.14], [-.38, 1.08, -.30]], hands: [[0, -1, 0], [0, -.35, -1]] },
  sniper: { offset: [.09, -.07, -.19], yaw: .68, pitch: -.08, elbows: [[.41, 1.06, -.14], [-.38, 1.06, -.30]], hands: [[0, -1, 0], [0, -.3, -1]] },
  smg: { offset: [.10, .05, -.17], yaw: .88, pitch: .46, elbows: [[.38, 1.12, -.12], [-.34, 1.13, -.23]], hands: [[0, -1, 0], [0, -.3, -1]] },
};

/** Isolated preview of the same selected/default skin; never creates a map,
 * gameplay controller, map, environment or multiplayer connection. */
export class HomeCharacter {
  private canvas: HTMLCanvasElement | null = null;
  private nameLabel: HTMLDivElement | null = null;
  private playerName = '';
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private library: CharacterAssetLibrary | null = null;
  private character: CharacterInstance | null = null;
  private weapons: CharacterWeaponLibrary | null = null;
  private weapon: CharacterWeapon | null = null;
  private selectedWeapon: WeaponId = 'rifle';
  private loadingWeapon: WeaponId | null = null;
  private abort: AbortController | null = null;
  private target = 0;
  private targetPitch = 0;
  private yaw = 0;
  private pitch = 0;
  private headYaw = 0;
  private headPitch = 0;
  private headNode: TransformNode | null = null;
  private readonly animatedHead = Quaternion.Identity();
  private hasHeadPose = false;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly move = (e: MouseEvent) => {
    this.target = Math.max(-1, Math.min(1, (e.clientX / innerWidth - .5) * 2)) * Math.PI / 12;
    this.targetPitch = -Math.max(-1, Math.min(1, (e.clientY / innerHeight - .5) * 2));
  };
  private readonly leave = () => { this.target = this.targetPitch = 0; };
  private readonly resize = () => {
    this.engine?.resize();
    const camera = this.scene?.activeCamera;
    if (!this.canvas || !(camera instanceof FreeCamera)) return;
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    // Keep the whole head and shoulders in view, even on narrow, tall screens.
    const height = Math.max(1.36, 1.18 / aspect);
    const top = 1.91, distance = 3.6;
    const center = top - height / 2;
    camera.position.set(0, center, -distance);
    camera.setTarget(new Vector3(0, center, 0));
    camera.fov = 2 * Math.atan(height / (2 * distance));
    // The mask follows measured world heights rather than viewport percentages:
    // start at the upper thighs and finish above the 0.50 m knee joints.
    this.canvas.style.setProperty('--character-fade-start', `${(top - .96) / height * 100}%`);
    this.canvas.style.setProperty('--character-fade-end', `${(top - .68) / height * 100}%`);
  };
  constructor(private readonly host: HTMLElement) {}
  setName(name: string): void {
    if (this.playerName === name) return;
    this.playerName = name;
    if (this.nameLabel) { this.nameLabel.textContent = name; this.nameLabel.hidden = !name; }
  }
  setWeapon(id: WeaponId): void {
    if (this.selectedWeapon === id) return;
    this.selectedWeapon = id;
    this.syncWeapon();
  }
  private syncWeapon(): void {
    if (!this.character || !this.weapons || !this.abort || this.loadingWeapon || this.weapon?.id === this.selectedWeapon) return;
    const id = this.selectedWeapon, library = this.weapons, controller = this.abort;
    this.loadingWeapon = id;
    void library.load(id, controller.signal).then(() => {
      if (controller.signal.aborted || library !== this.weapons || !this.character) return;
      if (id === this.selectedWeapon) { this.weapon?.dispose(); this.weapon = library.create(this.character, id); this.weapon?.setHomePose(HOME_HOLDS[id]); }
    }).catch((error) => { if (!controller.signal.aborted) console.warn('[crossfire] Home weapon:', error); })
      .finally(() => { if (library === this.weapons) { this.loadingWeapon = null; if (id !== this.selectedWeapon) this.syncWeapon(); } });
  }
  setVisible(visible: boolean): void {
    if (visible && !this.engine) this.create();
    else if (!visible && this.engine) this.dispose();
  }
  private create(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'home-character'; canvas.setAttribute('aria-hidden', 'true');
    this.host.append(canvas); this.canvas = canvas;
    const label = document.createElement('div'); label.className = 'home-character-name';
    label.textContent = this.playerName; label.hidden = !this.playerName;
    (this.host.parentElement ?? this.host).append(label); this.nameLabel = label;
    const engine = new Engine(canvas, true, { alpha: true, audioEngine: false, powerPreference: 'low-power' }, false);
    this.engine = engine;
    engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, 1.25));
    const scene = new Scene(engine); this.scene = scene;
    scene.useRightHandedSystem = true; scene.clearColor = new Color4(0, 0, 0, 0);
    scene.skipPointerMovePicking = scene.skipPointerDownPicking = scene.skipPointerUpPicking = true;
    const camera = new FreeCamera('home:camera', new Vector3(0, 1.2, -3.6), scene);
    camera.inputs.clear(); camera.minZ = .1;
    this.resize();
    const fill = new HemisphericLight('home:fill', new Vector3(0, 1, -1), scene);
    fill.intensity = .85; fill.diffuse = new Color3(.76, .84, 1); fill.groundColor = new Color3(.22, .24, .3);
    const key = new DirectionalLight('home:key', new Vector3(-.4, -1, .6), scene);
    key.position.set(2.5, 4, -3); key.intensity = 2.1; key.diffuse = new Color3(1, .93, .83);
    const rim = new DirectionalLight('home:rim', new Vector3(.7, -.6, -.5), scene);
    rim.intensity = 1.2; rim.diffuse = new Color3(.58, .72, 1);
    const padMaterial = new PBRMaterial('home:pad', scene);
    padMaterial.albedoColor = new Color3(.055, .065, .08); padMaterial.metallic = .45; padMaterial.roughness = .62;
    const pad = MeshBuilder.CreateCylinder('home:platform', { diameter: 1.45, height: .12, tessellation: 64 }, scene);
    pad.position.y = -.065; pad.material = padMaterial; pad.receiveShadows = true;
    const lip = MeshBuilder.CreateTorus('home:rounded-rim', { diameter: 1.41, thickness: .035, tessellation: 64 }, scene);
    lip.position.y = -.015; lip.material = padMaterial;
    pad.setEnabled(false); lip.setEnabled(false);
    const pivot = new TransformNode('home:character-pivot', scene);
    // Restore the unmodified idle pose before animation evaluation, then add the
    // mouse look in world axes afterwards. This keeps idle and avoids accumulating
    // rotations if animations are paused for reduced motion.
    scene.onBeforeAnimationsObservable.add(() => {
      this.weapon?.restore();
      if (this.headNode?.rotationQuaternion && this.hasHeadPose) this.headNode.rotationQuaternion.copyFrom(this.animatedHead);
    });
    scene.onAfterAnimationsObservable.add(() => {
      const head = this.headNode;
      if (head?.rotationQuaternion) {
        this.animatedHead.copyFrom(head.rotationQuaternion); this.hasHeadPose = true;
        head.parent?.computeWorldMatrix(true);
        head.rotate(Vector3.Up(), this.headYaw, Space.WORLD);
        head.rotate(Vector3.Right(), this.headPitch, Space.WORLD);
      }
      this.weapon?.update();
    });
    this.library = new CharacterAssetLibrary(scene);
    const controller = new AbortController(); this.abort = controller;
    const materials = new MaterialLibrary(scene);
    this.weapons = new CharacterWeaponLibrary(scene, materials);
    void Promise.all([this.library.load(controller.signal), materials.load(undefined, controller.signal)]).then(() => {
      if (controller.signal.aborted || this.scene !== scene) return;
      this.character = this.library!.instantiate(pivot, 'home-preview');
      this.headNode = this.character?.entries.skeletons[0]?.bones.find((bone) => bone.name === 'head')?.getTransformNode() ?? null;
      this.syncWeapon();
    }).catch((error) => { if (!controller.signal.aborted) console.warn('[crossfire] Home character:', error); });
    window.addEventListener('mousemove', this.move); window.addEventListener('mouseout', this.leave);
    window.addEventListener('blur', this.leave); window.addEventListener('resize', this.resize);
    engine.runRenderLoop(() => {
      if (document.hidden) return;
      const dt = Math.min(.05, engine.getDeltaTime() / 1000);
      const blend = 1 - Math.exp(-dt * 7);
      const yawTarget = this.reduced.matches ? 0 : this.target;
      const pitchTarget = this.reduced.matches ? 0 : this.targetPitch;
      this.yaw += (yawTarget - this.yaw) * blend;
      this.pitch += (pitchTarget * .045 - this.pitch) * blend;
      this.headYaw += (yawTarget * .55 - this.headYaw) * blend;
      this.headPitch += (pitchTarget * .16 - this.headPitch) * blend;
      // The head adds a little more turn than the body, including up/down look.
      pivot.rotation.y = -.12 + this.yaw;
      pivot.rotation.x = this.pitch;
      if (this.character) this.character.update({ velocity: { x: 0, y: 0, z: 0 }, grounded: true, crouch: 0, slideRemaining: 0 }, this.reduced.matches ? 0 : dt);
      scene.animationsEnabled = !this.reduced.matches;
      scene.render();
    });
  }
  inspect() { return { active: !!this.engine, ready: !!this.character, skin: this.library?.inspect().file ?? null,
    engines: Engine.Instances.length,
    platformVisible: this.scene?.getMeshByName('home:platform')?.isEnabled() ?? false,
    yaw: this.yaw, pitch: this.pitch, target: this.target, headYaw: this.headYaw, headPitch: this.headPitch,
    headRotation: this.headNode?.rotationQuaternion?.asArray() ?? null,
    animatedHeadRotation: this.hasHeadPose ? this.animatedHead.asArray() : null,
    reducedMotion: this.reduced.matches, character: this.character?.inspect() ?? null, weapon: this.weapon?.inspect() ?? null,
    meshes: this.scene?.meshes.length ?? 0, library: this.library?.inspect() ?? null }; }
  dispose(): void {
    this.abort?.abort(); this.abort = null;
    window.removeEventListener('mousemove', this.move); window.removeEventListener('mouseout', this.leave);
    window.removeEventListener('blur', this.leave); window.removeEventListener('resize', this.resize);
    this.engine?.stopRenderLoop(); this.weapon?.dispose(); this.weapon = null; this.character?.dispose(); this.character = null;
    this.scene?.dispose(); this.engine?.dispose(); this.scene = null; this.engine = null;
    this.library = null; this.weapons = null; this.loadingWeapon = null; this.headNode = null; this.hasHeadPose = false; this.canvas?.remove(); this.canvas = null;
    this.nameLabel?.remove(); this.nameLabel = null;
    this.yaw = this.target = this.targetPitch = this.pitch = this.headYaw = this.headPitch = 0;
  }
}
