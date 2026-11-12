import {CosmeticMaterials} from '../../rendering/CosmeticMaterials';
import { Matrix, Mesh, Quaternion, TransformNode, Vector3, type AbstractMesh, type AssetContainer,
  type InstantiatedEntries, type Scene } from '@babylonjs/core';
import { meshesReady } from '../../core/assetReadiness';
import { assetUrl, fetchJson } from '../../core/assets';
import { abortable } from '../../core/cancellation';
import { loadContainer } from '../../core/loadContainer';
import { MaterialLibrary } from '../../rendering/MaterialLibrary';
import { cosmetic } from '../../../shared/cosmetics';
import { broadenCharacter } from '../CharacterProportions';
import { MELEE_CLIPS, MELEE_NODES, MeleeAnimator, MeleeClipSet, meleePose, type MeleeClipName, type MeleeMetadata,
  type MeleeNode, type MeleePose, type NodeRest, type NodeTracks, type Track } from './MeleeAnimation';

export const MELEE_METADATA_PATH = 'assets/models/shared/melee/daggers.json';
/** Wrist to the centre of the handle the gripping glove encloses (CharacterWeapon's grip). */
export const WRIST_TO_PALM = .08;

/** Tracks of every clip, read once from the clips GLB's animation groups (never played). */
export function extractClips(container: AssetContainer, meta: MeleeMetadata): MeleeClipSet {
  const tracks = new Map<MeleeClipName, Map<MeleeNode, NodeTracks>>();
  const names = new Set<string>(MELEE_NODES);
  for (const group of container.animationGroups) {
    if (!(MELEE_CLIPS as readonly string[]).includes(group.name)) continue;
    group.stop();
    const nodes = new Map<MeleeNode, NodeTracks>();
    for (const { animation, target } of group.targetedAnimations) {
      const name = (target as TransformNode).name;
      if (!names.has(name)) continue;
      const keys = animation.getKeys(), fps = animation.framePerSecond || 60;
      const property = animation.targetProperty, size = property === 'rotationQuaternion' ? 4 : 3;
      const track: Track = { times: new Float32Array(keys.length), values: new Float32Array(keys.length * size), size };
      keys.forEach((k, i) => {
        track.times[i] = k.frame / fps;
        const v = k.value as { x: number; y: number; z: number; w?: number };
        track.values[i * size] = v.x; track.values[i * size + 1] = v.y; track.values[i * size + 2] = v.z;
        if (size === 4) track.values[i * size + 3] = v.w ?? 1;
      });
      const entry = nodes.get(name as MeleeNode) ?? {};
      if (property === 'position') entry.position = track;
      else if (property === 'rotationQuaternion') entry.rotation = track;
      else if (property === 'scaling') entry.scale = track;
      nodes.set(name as MeleeNode, entry);
    }
    tracks.set(group.name as MeleeClipName, nodes);
  }
  const rest = new Map<MeleeNode, NodeRest>();
  for (const node of container.transformNodes) {
    if (!names.has(node.name)) continue;
    rest.set(node.name as MeleeNode, { position: node.position.clone(),
      rotation: node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation), scale: node.scaling.clone() });
  }
  return new MeleeClipSet(meta, tracks, rest);
}

/** Bone-local hand axes the arm IK orients (ArmChain): fingers (wrist to knuckles) and back. */
export interface HandAxes { fingers: Vector3; back: Vector3 }

/** The socket (dagger rest frame) in hand-bone space: the inverse of how the fist holds the
 * handle. Rotation maps the grip's fingers/back onto the bone's own axes; the handle centre
 * sits WRIST_TO_PALM along the hand and `depth` toward the palm. */
export function holdMatrix(hold: { fingers: number[]; back: number[]; depth: number }, axes: HandAxes): Matrix {
  const fd = Vector3.FromArray(hold.fingers).normalize(), bd = Vector3.FromArray(hold.back).normalize();
  const fb = axes.fingers.clone().normalize(), bb = axes.back.clone().normalize();
  const cd = Vector3.Cross(fd, bd), cb = Vector3.Cross(fb, bb);
  // Row vectors: v_bone = v_dagger * D^T * B (orthonormal rows).
  const D = Matrix.FromValues(fd.x, fd.y, fd.z, 0, bd.x, bd.y, bd.z, 0, cd.x, cd.y, cd.z, 0, 0, 0, 0, 1);
  const B = Matrix.FromValues(fb.x, fb.y, fb.z, 0, bb.x, bb.y, bb.z, 0, cb.x, cb.y, cb.z, 0, 0, 0, 0, 1);
  const m = D.transpose().multiply(B);
  const origin = fb.scale(WRIST_TO_PALM).subtract(bb.scale(hold.depth));
  m.setTranslation(origin);
  return m;
}

const pairScratch = { m: new Matrix(), s: Vector3.One() };

/** Both daggers parented to a rig's hand bones. Each frame the local transform is the clip's
 * spin/twirl/reveal (relative to the socket) times the inverse grip, so a dagger can never
 * leave its hand: if the arm cannot reach, the dagger stays in the fist. */
export class DaggerPair {
  readonly roots: [TransformNode, TransformNode];
  readonly meshes: Mesh[] = [];
  private readonly entries: InstantiatedEntries[];
  private holds: [Matrix, Matrix] | null = null;
  private hands: [TransformNode, TransformNode] | null = null;
  visible = false;
  private cosmeticId='default-melee';
  private skinReady:Promise<void>=Promise.resolve();
  private readonly skins:CosmeticMaterials;
  private readonly materialLibrary:MaterialLibrary;
  constructor(scene: Scene, containers: [AssetContainer, AssetContainer], readonly name: string, readonly meta: MeleeMetadata) {
    this.materialLibrary=new MaterialLibrary(scene);
    this.entries = containers.map((c, i) => c.instantiateModelsToScene((n) => `${name}:${i ? 'l' : 'r'}:${n}`, false, { doNotInstantiate: true }));
    this.roots = (['r', 'l'] as const).map((side, i) => {
      const root = new TransformNode(`${name}:dagger_${side}`, scene);
      root.rotationQuaternion = Quaternion.Identity();
      for (const node of this.entries[i].rootNodes) node.parent = root;
      for (const mesh of root.getChildMeshes(false)) if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
        mesh.isPickable = false; this.meshes.push(mesh);
      }
      root.setEnabled(false);
      return root;
    }) as [TransformNode, TransformNode];
    this.skins=new CosmeticMaterials(this.meshes,scene,this.materialLibrary,'melee');
  }
  /** Parent to the hand bone nodes; `axes` are each bone's local IK axes. */
  bind(hands: [TransformNode, TransformNode], axes: [HandAxes, HandAxes]): void {
    if (this.hands && this.hands[0] === hands[0] && this.hands[1] === hands[1]) return;
    this.hands = hands;
    this.holds = [holdMatrix(this.meta.hold.r, axes[0]), holdMatrix(this.meta.hold.l, axes[1])];
    this.roots.forEach((root, i) => { root.parent = hands[i]; });
  }
  get bound(): boolean { return !!this.holds; }
  get appearance():string {return this.cosmeticId;}
  setCosmetic(id='default-melee'):Promise<void> {
    const item=cosmetic(id);if(this.cosmeticId===id||item?.weapon!=='melee')return this.skinReady;
    this.cosmeticId=id;
    this.skinReady=this.skins.apply(id).then(()=>meshesReady(this.meshes))
      .catch(()=>{if(this.cosmeticId===id){this.cosmeticId='default-melee';return this.skins.apply();}});
    return this.skinReady;
  }
  update(pose: MeleePose): void {
    const shown = pose.hands > 0 && !!this.holds;
    this.visible = false;
    for (let i = 0; i < 2; i++) {
      const root = this.roots[i], on = shown && pose.scale[i] >= .01;
      root.setEnabled(on);
      if (!on) continue;
      this.visible = true;
      pose.daggers[i].multiplyToRef(this.holds![i], pairScratch.m);
      pairScratch.m.decompose(root.scaling, root.rotationQuaternion!, root.position);
    }
  }
  /** World positions of the given anchor on both daggers (for tests and trails). */
  anchor(name: 'tip' | 'grip' | 'edge' | 'guard' | 'pommel'): [Vector3, Vector3] {
    return this.roots.map((root, i) => {
      const side = i ? 'l' : 'r';
      return Vector3.TransformCoordinates(Vector3.FromArray(this.meta.models[side].anchors[name]), root.computeWorldMatrix(true));
    }) as [Vector3, Vector3];
  }
  setRenderingGroup(group: number): void { for (const mesh of this.meshes) mesh.renderingGroupId = group; }
  dispose(): void { for (const entry of this.entries) entry.dispose(); for (const root of this.roots) root.dispose();this.skins.dispose(); }
}

/** One character's daggers and their animator, kept across gun swaps (CharacterWeapon reads it). */
export class CharacterMelee {
  readonly animator: MeleeAnimator;
  readonly pose = meleePose();
  constructor(readonly pair: DaggerPair, clips: MeleeClipSet) { this.animator = new MeleeAnimator(clips); }
  /** Advance by real seconds and refresh the pose. */
  advance(dt: number): void { this.animator.advance(dt); this.animator.pose(this.pose); }
  get active(): boolean { return this.pose.hands > 0 || this.animator.state !== 'hidden'; }
  dispose(): void { this.pair.dispose(); }
}

/** Loads the metadata, both daggers, the clips and (optionally) the first-person arms once
 * per scene; instances share geometry and the embedded materials. */
export class MeleeLibrary {
  meta: MeleeMetadata | null = null;
  clips: MeleeClipSet | null = null;
  private daggers: [AssetContainer, AssetContainer] | null = null;
  private arms: AssetContainer | null = null;
  private loading: Promise<void> | null = null;
  private armsLoading: Promise<void> | null = null;
  constructor(private readonly scene: Scene) {}
  get ready(): boolean { return !!this.clips && !!this.daggers; }
  load(signal?: AbortSignal): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.loading ??= this.performLoad(signal).finally(() => { this.loading = null; });
    return abortable(this.loading, signal);
  }
  private async performLoad(signal?: AbortSignal): Promise<void> {
    const meta = this.meta ?? await fetchJson<MeleeMetadata>(assetUrl(MELEE_METADATA_PATH), signal);
    if (meta.version !== 1) throw new Error('Unsupported melee metadata');
    this.meta = meta;
    const [r, l, clips] = await Promise.all([meta.models.r.file, meta.models.l.file, meta.clipsFile]
      .map((file) => loadContainer(assetUrl(file), this.scene, signal)));
    if (signal?.aborted || this.scene.isDisposed) { r.dispose(); l.dispose(); clips.dispose(); signal?.throwIfAborted(); return; }
    this.clips = extractClips(clips, meta);
    clips.dispose();
    this.daggers = [r, l];
  }
  /** First-person arms (the player's own arm, cuff and glove parts on the same 26-joint rig). */
  loadArms(signal?: AbortSignal): Promise<void> {
    if (this.arms) return Promise.resolve();
    this.armsLoading ??= this.load(signal).then(async () => {
      const arms = await loadContainer(assetUrl(this.meta!.arms.file), this.scene, signal);
      if (signal?.aborted || this.scene.isDisposed) { arms.dispose(); signal?.throwIfAborted(); return; }
      if (arms.skeletons.length !== 1) throw new Error('Expected one first-person arm rig');
      broadenCharacter(arms.meshes);
      this.arms = arms;
    }).finally(() => { this.armsLoading = null; });
    return abortable(this.armsLoading, signal);
  }
  async whenReady(signal?: AbortSignal): Promise<void> {
    await Promise.all([...(this.daggers ?? []), ...(this.arms ? [this.arms] : [])].map((c) => meshesReady(c.meshes as AbstractMesh[], signal)));
  }
  createPair(name: string): DaggerPair | null {
    return this.daggers && this.meta ? new DaggerPair(this.scene, this.daggers, name, this.meta) : null;
  }
  createCharacterMelee(name: string): CharacterMelee | null {
    const pair = this.createPair(name);
    return pair && this.clips ? new CharacterMelee(pair, this.clips) : null;
  }
  instantiateArms(name: string): InstantiatedEntries | null {
    return this.arms?.instantiateModelsToScene((n) => `${name}:${n}`, false, { doNotInstantiate: true }) ?? null;
  }
  dispose(): void { this.daggers?.forEach((c) => c.dispose()); this.arms?.dispose(); this.daggers = null; this.arms = null; this.clips = null; }
}
