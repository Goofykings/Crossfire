import { Color3, Frustum, Material, Matrix, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, type Scene, type Mesh, type BaseTexture } from '@babylonjs/core';
import type { Elimination, PlayerState, Snapshot } from '../../shared/protocol';
import { teammates } from '../../shared/combat';
import { CHARACTER_ASSET, CharacterAssetLibrary, type CharacterInstance } from './CharacterAsset';
import { VisibilityWorld } from '../rendering/VisibilityWorld';
import { animationVelocity } from './PlayerAnimation';
import { deathPose } from './CombatPresentation';
import { PlayerSilhouettes } from '../rendering/PlayerSilhouettes';

interface Sample { at: number; player: PlayerState }
interface Avatar {
  root: TransformNode; look: TransformNode; samples: Sample[]; seen: number;
  meshes: Mesh[]; label: HTMLDivElement; character: CharacterInstance | null;
  friendly: boolean; visible: boolean; clearFor: number; height: number;
  life: number; death?: { elapsed: number; started: number; direction: Elimination['direction']; rotation: Quaternion; baseY: number; materials: Material[]; textures: Set<BaseTexture> };
}

/** Real connected avatars with interpolated poses and relationship-based visibility. */
export class RemotePlayers {
  private readonly avatars = new Map<string, Avatar>();
  private readonly material: StandardMaterial;
  private readonly labels = document.createElement('div');
  private presenting = true;
  private outlinesEnabled = true;
  private visibilityWorld: VisibilityWorld | null = null;
  private dt = 1 / 60;
  private silhouettes: PlayerSilhouettes | null = null;
  readonly characters: CharacterAssetLibrary;
  constructor(private readonly scene: Scene, uiRoot: HTMLElement) {
    this.characters = new CharacterAssetLibrary(scene);
    this.labels.className = 'remote-player-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    uiRoot.append(this.labels);
    this.material = new StandardMaterial('remote-player', scene);
    this.material.diffuseColor = new Color3(0.65, 0.5, 0.28);
    this.material.emissiveColor = new Color3(0.08, 0.06, 0.03);
    // Read actual animated bone positions after the engine evaluates this frame.
    scene.onAfterAnimationsObservable.add(() => {
      for (const a of this.avatars.values()) this.presentation(a, this.dt);
      this.silhouettes?.update(this.outlinesEnabled && this.presenting);
    });
  }
  prepare(signal?: AbortSignal): Promise<void> { return this.characters.load(CHARACTER_ASSET, signal); }
  prepareVisibility(): void {
    this.visibilityWorld = VisibilityWorld.fromMeshes(this.scene.meshes);
    this.silhouettes ??= new PlayerSilhouettes(this.scene, this.scene.activeCamera!);
    this.silhouettes.setWorld(this.scene.meshes);
  }
  releaseVisibility(): void { this.visibilityWorld = null; this.silhouettes?.clear(); }
  silhouetteStats() { return this.silhouettes?.inspect() ?? null; }
  refreshEffects(): void { this.silhouettes?.keepLast(); }
  silhouetteInterior() { return this.silhouettes?.interiorPixels() ?? Promise.resolve([]); }
  visibilityStats() { return this.visibilityWorld?.inspect() ?? null; }
  setPresentationVisible(visible: boolean): void { this.presenting = visible; this.labels.hidden = !visible; }
  setOutlinesEnabled(enabled: boolean): void { this.outlinesEnabled = enabled; }
  private remove(a: Avatar): void {
    this.silhouettes?.remove(a.meshes); a.character?.dispose(); a.root.dispose(); a.label.remove();
    for (const material of a.death?.materials ?? []) material.dispose(false, false);
    for (const texture of a.death?.textures ?? []) texture.dispose();
  }
  eliminate(event: Elimination): void {
    const a = this.avatars.get(event.victimId);
    if (!a || a.life !== event.victimLife || a.death) return;
    const materials = new Map<Material, Material>();
    const textures = new Set<BaseTexture>();
    for (const mesh of a.meshes) if (mesh.material) {
      const source = mesh.material;
      let copy = materials.get(source);
      if (!copy) {
        copy = source.clone(`death:${event.id}:${source.name}`)!;
        for (const texture of copy.getActiveTextures()) if (!source.getActiveTextures().includes(texture)) textures.add(texture);
        copy.transparencyMode = Material.MATERIAL_ALPHABLEND;
        copy.needDepthPrePass = true;
        materials.set(source, copy);
      }
      mesh.material = copy;
    }
    a.death = { elapsed: 0, started: performance.now(), direction: event.direction, baseY: a.root.position.y,
      rotation: Quaternion.FromEulerAngles(0, a.root.rotation.y, 0), materials: [...materials.values()], textures };
    a.label.hidden = true;
    this.silhouettes?.remove(a.meshes);
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
        this.labels.append(label);
        a = { root, look, samples: [], seen: performance.now(), label, character,
          meshes, friendly: false, visible: false, clearFor: 0, height: 1.8, life: player.life };
        this.avatars.set(player.id, a);
      }
      a.friendly = teammates(s.match.mode, self?.team ?? null, player.team);
      if (a.label.textContent !== player.name) a.label.textContent = player.name;
      a.label.dataset.relationship = a.friendly ? 'teammate' : 'opponent';
      a.seen = performance.now();
      a.samples.push({ at: s.serverTime, player });
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
        a.root.rotationQuaternion = Quaternion.RotationAxis(new Vector3(pose.fall.z, 0, -pose.fall.x), pose.tip).multiply(death.rotation);
        a.root.position.y = death.baseY + pose.lift;
        for (const material of death.materials) material.alpha = pose.opacity;
        continue;
      }
      if (performance.now() - a.seen > 4000) { this.remove(a); this.avatars.delete(id); continue; }
      const samples = a.samples;
      while (samples.length > 2 && samples[1].at < serverTime) samples.shift();
      const older = samples[0], newer = samples[1] ?? older;
      const k = Math.max(0, Math.min(1, (serverTime - older.at) / Math.max(1, newer.at - older.at)));
      const m = older.player.motion, n = newer.player.motion;
      a.root.position.set(m.position.x + (n.position.x - m.position.x) * k, m.position.y + (n.position.y - m.position.y) * k,
        m.position.z + (n.position.z - m.position.z) * k);
      a.root.rotation.y = m.yaw + Math.atan2(Math.sin(n.yaw - m.yaw), Math.cos(n.yaw - m.yaw)) * k;
      a.look.rotation.x = m.pitch + (n.pitch - m.pitch) * k;
      const crouch = m.crouch + (n.crouch - m.crouch) * k;
      a.height = 1.8 - crouch * .65;
      a.root.scaling.y = a.character ? 1 : a.height / 1.8;
      a.character?.update({ crouch, grounded: k < .5 ? m.grounded : n.grounded,
        slideRemaining: m.slideRemaining + (n.slideRemaining - m.slideRemaining) * k,
        velocity: animationVelocity(m, n, (newer.at - older.at) / 1000, k) }, dt);
    }
  }
  private presentation(a: Avatar, dt: number): void {
    if (a.death) { a.label.hidden = true; return; }
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
    a.visible = this.presenting && bodyInView && this.visibleBody(a, eye);
    // Reveal after stable visibility; hide immediately when all interior probes are
    // occluded. Never retain an enemy marker behind a newly occluding wall.
    a.clearFor = a.visible ? Math.min(.1, a.clearFor + dt) : 0;
    this.silhouettes?.set(a.meshes, a.friendly, this.presenting && bodyInView);
    a.label.hidden = !this.presenting || !inView || (!a.friendly && a.clearFor < .04);
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

  inspect() {
    return [...this.avatars].map(([id, a]) => ({ id, x: a.root.position.x, y: a.root.position.y, z: a.root.position.z,
      yaw: a.root.rotation.y, height: a.height, friendly: a.friendly, visible: a.visible,
      labelVisible: !a.label.hidden && !this.labels.hidden, outline: !a.death && a.visible && (this.silhouettes?.has(a.meshes) ?? false),
      death: a.death ? { elapsed: a.death.elapsed, ...deathPose(a.death.elapsed, a.death.direction),
        alpha: a.meshes[0].material?.alpha, rotation: a.root.rotationQuaternion?.asArray() } : null,
      source: a.character ? 'glb' : 'placeholder', animation: a.character?.inspect() ?? null,
      health: a.samples.at(-1)?.player.health ?? 0 }));
  }
  clear(): void {
    for (const a of this.avatars.values()) this.remove(a);
    this.avatars.clear(); this.silhouettes?.update(false);
  }
}
