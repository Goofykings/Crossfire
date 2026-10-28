import { BoundingInfo, Mesh, TransformNode, Vector3, type AssetContainer, type Scene, type InstantiatedEntries, type AnimationGroup } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { loadContainer } from '../core/loadContainer';
import { abortable } from '../core/cancellation';
import { PlayerAnimator, type CharacterClip, type CharacterMotion } from './PlayerAnimation';
import exported from '../../public/assets/characters/player.json';

export type { CharacterClip } from './PlayerAnimation';
export interface CharacterAssetDefinition {
  file: string;
  /** Measured export height/ground and verified correction to face game -Z. */
  height: number;
  groundY: number;
  yawCorrection: number;
  clips: Record<CharacterClip, string>;
  durations: Record<CharacterClip, number>;
  bounds: { min: number[]; max: number[] };
}

// Measured by Blender and audited from the actual exported GLB before enabling.
export const CHARACTER_ASSET: CharacterAssetDefinition = exported;

export interface CharacterInstance {
  root: TransformNode;
  meshes: Mesh[];
  entries: InstantiatedEntries;
  update(motion: CharacterMotion, dt: number): void;
  visibilityPoints(): Vector3[];
  headPosition(): Vector3 | undefined;
  inspect(): ReturnType<PlayerAnimator['inspect']> & { geometry: number[]; materials: number[]; bones: number;
    rig: number; joints: Record<string, number[]>; textures: { id: number; ready: boolean }[]; poseTextures: number[] };
  dispose(): void;
}

/** Shared geometry/material load, with independent copies of the same exported rig.
 * Deliberately does not manufacture animations or bind guessed clip names.
 */
export class CharacterAssetLibrary {
  private container: AssetContainer | null = null;
  private definition: CharacterAssetDefinition | null = null;
  private state: 'missing' | 'loading' | 'ready' | 'error' = 'missing';
  private reason = 'No exported character GLB has been supplied';
  private loading: Promise<void> | null = null;
  private loads = 0;

  constructor(private readonly scene: Scene) {}

  load(definition: CharacterAssetDefinition | null, signal?: AbortSignal): Promise<void> {
    if (!definition || this.container) return Promise.resolve();
    if (this.loading) return abortable(this.loading, signal);
    const work = this.performLoad(definition, signal).finally(() => { if (this.loading === work) this.loading = null; });
    this.loading = work;
    return work;
  }
  private async performLoad(definition: CharacterAssetDefinition, signal?: AbortSignal): Promise<void> {
    this.state = 'loading';
    let container: AssetContainer | null = null;
    try {
      if (!(definition.height > 0) || !Number.isFinite(definition.height) || !Number.isFinite(definition.groundY)
        || !Number.isFinite(definition.yawCorrection) || ![...definition.bounds.min, ...definition.bounds.max].every(Number.isFinite)) {
        throw new Error('Character export measurements are invalid');
      }
      container = await loadContainer(assetUrl(definition.file), this.scene, signal);
      this.loads++;
      signal?.throwIfAborted();
      if (container.skeletons.length !== 1 || !container.meshes.some((m) => m.skeleton)) throw new Error('Expected one shared character rig');
      for (const clip of Object.values(definition.clips)) {
        if (!container.animationGroups.some((g) => g.name === clip)) throw new Error(`Export is missing actual clip: ${clip}`);
      }
      for (const group of container.animationGroups) group.stop();
      this.container = container;
      this.definition = definition;
      this.state = 'ready'; this.reason = '';
    } catch (error) {
      container?.dispose();
      if (signal?.aborted) { this.state = 'missing'; throw error; }
      this.state = 'error'; this.reason = (error as Error).message;
      // Character failure cannot break a working multiplayer connection.
      console.warn('[crossfire] Character export unavailable:', this.reason);
    }
  }

  instantiate(parent: TransformNode, id: string): CharacterInstance | null {
    const definition = this.definition;
    if (!this.container || !definition) return null;
    const root = new TransformNode(`character:${id}`, this.scene);
    root.parent = parent;
    const scale = 1.8 / definition.height;
    root.scaling.setAll(scale);
    root.position.y = -definition.groundY * scale;
    root.rotation.y = definition.yawCorrection;
    // Mesh.clone shares its Geometry. Skeletons/animation groups are cloned so
    // different real players never drive one another's pose.
    const entries = this.container.instantiateModelsToScene((name) => `character:${id}:${name}`, false, { doNotInstantiate: true });
    for (const node of entries.rootNodes) node.parent = root;
    const meshes = root.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    if (!meshes.length) { entries.dispose(); root.dispose(); return null; }
    for (const mesh of meshes) {
      mesh.isPickable = false; mesh.renderingGroupId = 0;
      // Offline measured union of all posed vertices, not costly per-frame CPU skinning.
      mesh.setBoundingInfo(new BoundingInfo(Vector3.FromArray(definition.bounds.min), Vector3.FromArray(definition.bounds.max)));
    }
    const groups = Object.fromEntries(Object.entries(definition.clips).map(([clip, name]) =>
      [clip, entries.animationGroups[this.container!.animationGroups.findIndex((g) => g.name === name)]])) as Record<CharacterClip, AnimationGroup>;
    const animator = new PlayerAnimator(groups, definition.durations);
    const bones = entries.skeletons[0].bones;
    const byName = new Map(bones.map((b) => [b.name, b]));
    const point = (name: string): Vector3 | undefined => {
      const bone = byName.get(name), node = bone?.getTransformNode();
      if (node) return node.getAbsolutePosition().clone();
      return bone?.getAbsolutePosition(meshes[0]);
    };
    return { root, meshes, entries, update: (motion, dt) => animator.update(motion, dt),
      visibilityPoints: () => ['head', 'chest', 'pelvis', 'upper_arm_l', 'upper_arm_r', 'hand_l', 'hand_r', 'foot_l', 'foot_r']
        .map(point).filter((p): p is Vector3 => !!p),
      headPosition: () => point('head')?.addInPlace(new Vector3(0, .28, 0)),
      inspect: () => ({ ...animator.inspect(), geometry: meshes.map((m) => m.geometry?.uniqueId ?? -1),
        materials: meshes.map((m) => m.material?.uniqueId ?? -1), bones: bones.length,
        textures: meshes.flatMap((m) => m.material?.getActiveTextures().map((t) => ({ id: t.uniqueId, ready: t.isReady() })) ?? []),
        poseTextures: [...new Set(meshes.map((m) => entries.skeletons[0].getTransformMatrixTexture(m)?.uniqueId)
          .filter((v): v is number => v !== undefined))],
        rig: entries.skeletons[0].uniqueId, joints: Object.fromEntries(['head', 'hand_l', 'hand_r', 'foot_l', 'foot_r']
          .map((name) => [name, point(name)?.asArray() ?? []])) }),
      dispose: () => { animator.dispose(); entries.dispose(); root.dispose(); } };
  }

  inspect() {
    return { state: this.state, reason: this.reason, file: this.definition?.file ?? null,
      clips: this.container?.animationGroups.map((g) => g.name) ?? [],
      bones: this.container?.skeletons[0]?.bones.length ?? 0, loads: this.loads };
  }
}
