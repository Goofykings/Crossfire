import { Color3, Frustum, Matrix, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene, type Mesh } from '@babylonjs/core';
import '@babylonjs/core/Rendering/outlineRenderer';
import type { PlayerState, Snapshot } from '../../shared/protocol';
import { teammates } from '../../shared/combat';
import { CHARACTER_ASSET, CharacterAssetLibrary, type CharacterInstance } from './CharacterAsset';
import { VisibilityWorld } from '../rendering/VisibilityWorld';

interface Sample { at: number; player: PlayerState }
interface Avatar {
  root: TransformNode; look: TransformNode; samples: Sample[]; seen: number;
  meshes: Mesh[]; label: HTMLDivElement; character: CharacterInstance | null;
  friendly: boolean; visible: boolean; clearFor: number; height: number;
}

/** Real connected avatars with interpolated poses and relationship-based visibility. */
export class RemotePlayers {
  private readonly avatars = new Map<string, Avatar>();
  private readonly material: StandardMaterial;
  private readonly labels = document.createElement('div');
  private presenting = true;
  private outlinesEnabled = true;
  private visibilityWorld: VisibilityWorld | null = null;
  readonly characters: CharacterAssetLibrary;
  constructor(private readonly scene: Scene, uiRoot: HTMLElement) {
    this.characters = new CharacterAssetLibrary(scene);
    this.labels.className = 'remote-player-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    uiRoot.append(this.labels);
    this.material = new StandardMaterial('remote-player', scene);
    this.material.diffuseColor = new Color3(0.65, 0.5, 0.28);
    this.material.emissiveColor = new Color3(0.08, 0.06, 0.03);
  }
  prepare(signal?: AbortSignal): Promise<void> { return this.characters.load(CHARACTER_ASSET, signal); }
  prepareVisibility(): void { this.visibilityWorld = VisibilityWorld.fromMeshes(this.scene.meshes); }
  releaseVisibility(): void { this.visibilityWorld = null; }
  visibilityStats() { return this.visibilityWorld?.inspect() ?? null; }
  setPresentationVisible(visible: boolean): void { this.presenting = visible; this.labels.hidden = !visible; }
  setOutlinesEnabled(enabled: boolean): void { this.outlinesEnabled = enabled; }
  private remove(a: Avatar): void { a.character?.dispose(); a.root.dispose(); a.label.remove(); }
  snapshot(s: Snapshot, selfId: string): void {
    const self = s.players.find((p) => p.id === selfId);
    const ids = new Set(s.players.filter((p) => p.id !== selfId && p.alive).map((p) => p.id));
    for (const [id, avatar] of this.avatars) if (!ids.has(id)) { this.remove(avatar); this.avatars.delete(id); }
    for (const player of s.players) {
      if (player.id === selfId || !player.alive) continue;
      let a = this.avatars.get(player.id);
      if (!a) {
        const root = new TransformNode(`remote:${player.id}`, this.scene);
        const body = MeshBuilder.CreateCapsule(`remote-body:${player.id}`, { height: 1.8, radius: 0.3 }, this.scene);
        body.parent = root;
        body.position.y = 0.9;
        body.material = this.material;
        body.isPickable = false;
        const look = new TransformNode(`remote-look:${player.id}`, this.scene);
        look.parent = root;
        look.position.y = 1.6;
        const face = MeshBuilder.CreateBox(`remote-facing:${player.id}`, { width: 0.22, height: 0.16, depth: 0.14 }, this.scene);
        face.parent = look;
        face.position.set(0, 0, -0.29);
        face.material = this.material;
        face.isPickable = false;
        const label = document.createElement('div');
        label.className = 'remote-player-label'; label.dataset.playerId = player.id; label.hidden = true;
        this.labels.append(label);
        const character = this.characters.instantiate(root, player.id);
        if (character) { body.setEnabled(false); face.setEnabled(false); }
        a = { root, look, samples: [], seen: performance.now(), label, character,
          meshes: character?.meshes ?? [body], friendly: false, visible: false, clearFor: 0, height: 1.8 };
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
    for (const [id, a] of this.avatars) {
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
      a.root.scaling.y = 1 - (m.crouch + (n.crouch - m.crouch) * k) * (1 - 1.15 / 1.8);
      a.height = 1.8 * a.root.scaling.y;
      this.presentation(a, dt);
    }
  }
  private presentation(a: Avatar, dt: number): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    cam.computeWorldMatrix();
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const width = canvas?.clientWidth || engine.getRenderWidth(), height = canvas?.clientHeight || engine.getRenderHeight();
    const eye = cam.globalPosition;
    const head = a.root.position.add(new Vector3(0, a.height + .14, 0));
    const screen = Vector3.Project(head, Matrix.IdentityReadOnly, cam.getTransformationMatrix(), cam.viewport.toGlobal(width, height));
    const forward = cam.getForwardRay().direction;
    const inView = Vector3.Dot(head.subtract(eye), forward) > .1 && screen.z >= 0 && screen.z <= 1
      && screen.x >= 0 && screen.x <= width && screen.y >= 0 && screen.y <= height;
    const distance = Vector3.Distance(eye, head);
    const planes = Frustum.GetPlanes(cam.getTransformationMatrix());
    const bodyInView = a.meshes.some((mesh) => { mesh.computeWorldMatrix(true); return mesh.isInFrustum(planes); });
    // A scoped torso can be visible while its head marker is above the viewport.
    // Do not use the name anchor to decide whether the body outline can render.
    a.visible = this.presenting && bodyInView && this.visibleBody(a, eye);
    // Reveal after stable visibility; hide immediately when all interior probes are
    // occluded. Never retain an enemy marker behind a newly occluding wall.
    a.clearFor = a.visible ? Math.min(.1, a.clearFor + dt) : 0;
    const color = a.friendly ? new Color3(.2, .5, 1) : new Color3(1, .08, .06);
    for (const mesh of a.meshes) {
      mesh.renderOutline = this.outlinesEnabled && a.visible;
      mesh.outlineColor = color;
      mesh.outlineWidth = Math.max(.012, Math.min(.055, distance * .004));
    }
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
    for (const [side, y] of probes) {
      const point = new Vector3(p.x + Math.cos(a.root.rotation.y) * side, p.y + y, p.z - Math.sin(a.root.rotation.y) * side);
      const delta = point.subtract(eye), length = delta.length();
      if (length < .1) return true;
      if (!this.visibilityWorld?.occluded(eye, delta.scale(1 / length), length - .04)) return true;
    }
    return false;
  }

  inspect() {
    return [...this.avatars].map(([id, a]) => ({ id, x: a.root.position.x, y: a.root.position.y, z: a.root.position.z,
      yaw: a.root.rotation.y, height: a.height, friendly: a.friendly, visible: a.visible,
      labelVisible: !a.label.hidden && !this.labels.hidden, outline: a.meshes.some((m) => m.renderOutline),
      source: a.character ? 'glb' : 'placeholder', health: a.samples.at(-1)?.player.health ?? 0 }));
  }
  clear(): void { for (const a of this.avatars.values()) this.remove(a); this.avatars.clear(); }
}
