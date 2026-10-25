import {
  Color3,
  InstancedMesh,
  LoadAssetContainerAsync,
  Matrix,
  Mesh,
  PointLight,
  Quaternion,
  StandardMaterial,
  Vector3,
  type AbstractMesh,
  type AssetContainer,
} from '@babylonjs/core';
import { MOVEMENT } from '../config/constants';
import { assetUrl, fetchJson } from '../core/assets';
import { SafeZoneSystem } from '../game/SafeZones';
import { TargetSystem } from '../game/Targets';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Environment } from '../rendering/Environment';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { ZoneBarriers } from '../rendering/ZoneBarriers';
import type { RenderContext } from '../rendering/RenderContext';
import { GeometryBatcher } from '../rendering/StaticBatcher';
import type { CollisionFile, MapAssetIndex, MapDefinition, PropCatalog, PropPlacement, SpawnPoint } from './types';

const DEG = Math.PI / 180;

export interface MapStats {
  loadMs: number;
  batchedMeshes: number;
  kitPieces: number;
  kitInstances: number;
  propInstances: number;
  vertices: number;
  colliders: number;
}

export interface LoadedMap {
  readonly def: MapDefinition;
  readonly world: CollisionWorld;
  readonly zones: SafeZoneSystem;
  readonly barriers: ZoneBarriers;
  readonly targets: TargetSystem;
  readonly environment: Environment;
  readonly spawns: SpawnPoint[];
  readonly stats: MapStats;
  /** Toggle the collision debug view (boxes from collision_debug.glb). */
  toggleCollisionDebug(): Promise<void>;
  dispose(): void;
}

export type ProgressFn = (fraction: number, label: string) => void;

/**
 * Loads and unloads maps described by a MapDefinition. Nothing here is specific to European Town:
 * any map that ships an asset index, GLBs, collision.json and a layout works.
 */
export class MapManager {
  current: LoadedMap | null = null;
  private propCatalog: PropCatalog | null = null;

  constructor(
    private readonly ctx: RenderContext,
    private readonly materials: MaterialLibrary,
    private readonly batchCell: () => number,
  ) {}

  async load(def: MapDefinition, onProgress: ProgressFn = () => {}): Promise<LoadedMap> {
    this.unload();
    const t0 = performance.now();
    const scene = this.ctx.scene;
    const base = assetUrl(def.assetPath);
    onProgress(0.02, 'Reading map data');
    const index = await fetchJson<MapAssetIndex>(base + def.assetIndex);
    const collision = await fetchJson<CollisionFile>(base + index.collision);
    this.propCatalog ??= await fetchJson<PropCatalog>(assetUrl('assets/models/shared/props/props.json'));
    const catalog = this.propCatalog;

    const environment = new Environment(scene, def.environment);
    const created: AbstractMesh[] = [];
    const containers: AssetContainer[] = [];

    // --- models -------------------------------------------------------------------------------
    let done = 0;
    const total = index.models.length;
    const loaded = await Promise.all(
      index.models.map(async (file) => {
        const c = await LoadAssetContainerAsync(base + file, scene);
        done++;
        onProgress(0.05 + 0.55 * (done / total), `Loading ${file}`);
        return c;
      }),
    );
    containers.push(...loaded);
    onProgress(0.62, 'Building town');

    // Everything static (building shells, terrain, kit pieces, props) is baked into one mesh per
    // canonical material and map quadrant. Kit pieces arrive as glTF instances of shared meshes.
    const batcher = new GeometryBatcher(scene, this.batchCell());
    let kitInstances = 0;
    const kitKeys = new Set<string>();
    const addMesh = (m: AbstractMesh, world: Matrix) => {
      const source = m instanceof InstancedMesh ? m.sourceMesh : (m as Mesh);
      const matName = source.material?.name ?? '';
      batcher.add(source, world, this.materials.canonical(matName));
    };
    for (const c of loaded) {
      c.addAllToScene();
      for (const m of c.meshes) {
        if (m.getTotalVertices() === 0) continue;
        const key = kitKey(m.name);
        if (key) {
          kitInstances++;
          kitKeys.add(key);
        }
        addMesh(m, m.computeWorldMatrix(true).clone());
      }
    }
    onProgress(0.7, 'Placing props');

    // --- props --------------------------------------------------------------------------------
    const world = new CollisionWorld();
    world.addMany(collision.boxes);
    const placements: PropPlacement[] = [...def.layout.props, ...def.layout.obstacles];
    const byType = new Map<string, PropPlacement[]>();
    for (const p of placements) {
      if (!catalog.props[p.type]) continue;
      let list = byType.get(p.type);
      if (!list) byType.set(p.type, (list = []));
      list.push(p);
    }
    let propInstances = 0;
    const propContainers = await Promise.all(
      [...byType.entries()].map(async ([type, list]) => {
        const entry = catalog.props[type];
        const c = await LoadAssetContainerAsync(assetUrl(`assets/models/shared/props/${entry.file}`), scene);
        return { type, list, entry, c };
      }),
    );
    for (const { type, list, entry, c } of propContainers) {
      containers.push(c);
      c.addAllToScene();
      const place = list.map((p) =>
        Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), -p.heading * DEG), new Vector3(p.pos[0], p.pos[1], p.pos[2])),
      );
      for (const m of c.meshes) {
        if (m.getTotalVertices() === 0) continue;
        const local = m.computeWorldMatrix(true).clone();
        for (const pm of place) addMesh(m, local.multiply(pm));
        propInstances += place.length;
      }
      if (entry.collider) {
        const [w, h, d] = entry.collider;
        for (const p of list) {
          world.add({ c: [p.pos[0], p.pos[1] + h / 2, p.pos[2]], h: [w / 2, h / 2, d / 2], yaw: -p.heading * DEG, tag: `prop:${type}` });
        }
      }
    }
    onProgress(0.8, 'Baking geometry');
    const batched = batcher.build();
    // the source GLB meshes are no longer needed
    for (const c of containers) c.dispose();
    containers.length = 0;
    created.push(...batched);
    onProgress(0.86, 'Setting up targets');

    // --- gameplay -----------------------------------------------------------------------------
    const zones = new SafeZoneSystem(def.layout.safeZones);
    const barriers = new ZoneBarriers(scene, def.layout.safeZones, MOVEMENT.radius);
    const targets = new TargetSystem(scene, world, this.materials);
    await targets.load(def.layout.targets);

    const lights: PointLight[] = [];
    for (const l of def.layout.lights) {
      const pl = new PointLight(`light:${l.team ?? 'map'}`, new Vector3(l.pos[0], l.pos[1], l.pos[2]), scene);
      pl.diffuse = new Color3(...l.color);
      pl.specular = new Color3(...l.color).scale(0.3);
      pl.intensity = l.intensity;
      pl.range = l.range;
      lights.push(pl);
    }

    const shadowCasters = [
      ...batched.filter((m) => !MaterialLibrary.NO_SHADOW.has((m.metadata as { canonical: string }).canonical)),
      ...targets.meshes,
    ];
    environment.registerShadowMeshes(
      shadowCasters.filter((m) => !targets.meshes.includes(m)),
      [...batched, ...targets.meshes],
      targets.meshes,
    );

    onProgress(0.94, 'Compiling shaders');
    await scene.whenReadyAsync();

    let debugMeshes: AbstractMesh[] | null = null;
    let debugVisible = false;
    const stats: MapStats = {
      loadMs: Math.round(performance.now() - t0),
      batchedMeshes: batched.length,
      kitPieces: kitKeys.size,
      kitInstances,
      propInstances,
      vertices: batched.reduce((n, m) => n + m.getTotalVertices(), 0),
      colliders: world.size,
    };
    const map: LoadedMap = {
      def,
      world,
      zones,
      barriers,
      targets,
      environment,
      spawns: def.layout.spawns,
      stats,
      toggleCollisionDebug: async () => {
        if (!debugMeshes) {
          if (!index.collisionDebug) return;
          const c = await LoadAssetContainerAsync(base + index.collisionDebug, scene);
          containers.push(c);
          c.addAllToScene();
          const mat = new StandardMaterial('collision-debug', scene);
          mat.wireframe = true;
          mat.emissiveColor = new Color3(0.1, 1, 0.4);
          mat.disableLighting = true;
          debugMeshes = c.meshes.filter((m) => m.getTotalVertices() > 0);
          for (const m of debugMeshes) {
            m.material = mat;
            m.isPickable = false;
          }
        }
        debugVisible = !debugVisible;
        for (const m of debugMeshes) m.setEnabled(debugVisible);
      },
      dispose: () => {
        targets.dispose();
        barriers.dispose();
        for (const l of lights) l.dispose();
        for (const m of created) m.dispose(false, false);
        for (const c of containers) c.dispose();
        environment.dispose();
        world.clear();
      },
    };
    this.current = map;
    onProgress(1, 'Ready');
    return map;
  }

  unload(): void {
    this.current?.dispose();
    this.current = null;
  }
}

/** "KIT_win_1.0x1.5_frame_white__glass#123" -> "win_1.0x1.5_frame_white__glass" */
function kitKey(name: string): string | null {
  if (!name.startsWith('KIT_')) return null;
  const hash = name.indexOf('#');
  return (hash >= 0 ? name.slice(4, hash) : name.slice(4)).replace(/\.\d{3}$/, '');
}
