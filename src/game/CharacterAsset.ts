import { Mesh, TransformNode, type AssetContainer, type Scene, type InstantiatedEntries } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { loadContainer } from '../core/loadContainer';

export type CharacterClip = 'IDLE' | 'RUN' | 'JUMP_START' | 'JUMP_LOOP' | 'JUMP_LAND' | 'SLIDE';
export interface CharacterAssetDefinition {
  file: string;
  /** Measured export height/ground and verified correction to face game -Z. */
  height: number;
  groundY: number;
  yawCorrection: number;
  clips: Record<CharacterClip, string>;
}

// The separate Blender export is unfinished. Set this only after inspecting the
// actual GLB's skeleton, clips, metres/ground and forward direction. No fake asset.
export const CHARACTER_ASSET: CharacterAssetDefinition | null = null;

export interface CharacterInstance {
  root: TransformNode;
  meshes: Mesh[];
  entries: InstantiatedEntries;
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

  constructor(private readonly scene: Scene) {}

  async load(definition: CharacterAssetDefinition | null, signal?: AbortSignal): Promise<void> {
    if (!definition || this.container) return;
    this.state = 'loading';
    let container: AssetContainer | null = null;
    try {
      if (!(definition.height > 0) || !Number.isFinite(definition.groundY) || !Number.isFinite(definition.yawCorrection)) {
        throw new Error('Character export measurements are invalid');
      }
      container = await loadContainer(assetUrl(definition.file), this.scene, signal);
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
    for (const mesh of meshes) { mesh.isPickable = false; mesh.renderingGroupId = 0; }
    return { root, meshes, entries, dispose: () => { entries.dispose(); root.dispose(); } };
  }

  inspect() {
    return { state: this.state, reason: this.reason, file: this.definition?.file ?? null,
      clips: this.container?.animationGroups.map((g) => g.name) ?? [],
      bones: this.container?.skeletons[0]?.bones.length ?? 0 };
  }
}
