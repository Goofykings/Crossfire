/**
 * Map data contracts.
 *
 * `MapLayout` mirrors `src/maps/<id>/layout.json` (written by tools/layout_design.py, consumed by both
 * the Blender pipeline and the game). Coordinates are metres in game space: +x east, +y up, +z south.
 * Rects are [x0, z0, x1, z1]. Headings are compass degrees (0 = facing north / -z, 90 = east / +x).
 */

export type Rect = [number, number, number, number];
export type Vec3Tuple = [number, number, number];
export type Team = 'blue' | 'red';

export interface GroundZone {
  id: string;
  kind: 'street' | 'yard' | 'court' | 'plaza' | 'spawn' | 'terrace';
  rect: Rect;
  height: number;
  material: string;
  team?: Team;
}

export interface StairRun {
  side: 'n' | 'e' | 's' | 'w';
  from: number;
  to: number;
  steps: number;
  rise: number;
  run: number;
}

export interface Terrace {
  id: string;
  rect: Rect;
  height: number;
  stairs: StairRun[];
}

export interface BuildingDoor {
  side: 'n' | 'e' | 's' | 'w';
  at: number;
  width: number;
}

export interface Building {
  id: string;
  type: string;
  rect: Rect;
  floors: number;
  palette: string;
  seed: number;
  roof: { type: 'gable' | 'hip'; ridge: 'x' | 'z' };
  front: 'n' | 'e' | 's' | 'w';
  doors: BuildingDoor[];
  passages?: { rect: Rect; style: 'arch' | 'lintel'; clear: number }[];
  rooms?: { rect: Rect; clear: number }[];
  chamfer?: { corner: 'nw' | 'ne' | 'se' | 'sw'; size: number };
  balcony?: { side: string; floor: number };
  shopfront?: { side: string };
}

export interface PropPlacement {
  type: string;
  pos: Vec3Tuple;
  heading: number;
}

/** A stretch of a safe zone's edge where walkable ground continues outside (gets a barrier and a label). */
export interface ZoneEntrance {
  side: 'n' | 'e' | 's' | 'w';
  /** Extent along the edge in metres (x for n/s, z for e/w). */
  from: number;
  to: number;
  /** Height of the barrier (the spring line for an arched passage). */
  height: number;
  /** Crown height for arched passages; omitted for flat tops. */
  apex?: number;
}

export interface SafeZoneDef {
  id: string;
  team: Team;
  rect: Rect;
  height: number;
  entrances?: ZoneEntrance[];
}

export interface SpawnPoint {
  team: Team;
  pos: Vec3Tuple;
  heading: number;
}

export interface TargetPlacement {
  id: string;
  pos: Vec3Tuple;
  heading: number;
}

export interface LightDef {
  type: 'point';
  team?: Team;
  pos: Vec3Tuple;
  color: Vec3Tuple;
  intensity: number;
  range: number;
}

export interface MapLayout {
  id: string;
  name: string;
  version: number;
  playArea: Rect;
  outerLimit: number;
  ground: { baseHeight: number; zones: GroundZone[]; covered: { id: string; kind: string; rect: Rect }[] };
  terraces: Terrace[];
  buildings: Building[];
  walls: { id: string; rect: Rect; height: number; style: string; gates: { rect: Rect }[] }[];
  arches: { id: string; rect: Rect; spring: number; axis: 'x' | 'z' }[];
  props: PropPlacement[];
  lights: LightDef[];
  targets: TargetPlacement[];
  safeZones: SafeZoneDef[];
  spawns: SpawnPoint[];
  obstacles: PropPlacement[];
}

export interface MapAssetIndex {
  map: string;
  models: string[];
  collision: string;
  collisionDebug?: string;
}

export interface PropCatalog {
  version: number;
  props: Record<string, { file: string; size: Vec3Tuple; collider: Vec3Tuple | null }>;
}

export interface CollisionFile {
  version: number;
  map: string;
  boxes: { c: Vec3Tuple; h: Vec3Tuple; yaw: number; tag: string }[];
}

/** Lighting/atmosphere for a map. */
export interface EnvironmentConfig {
  /** Equirectangular HDR used for image-based lighting. */
  hdr: string;
  /** Tonemapped equirectangular image drawn as the visible sky. */
  skyImage: string;
  /** Compass heading the sunlight comes FROM, and its elevation above the horizon (degrees). */
  sunHeading: number;
  sunElevation: number;
  /** Compass heading of the sun inside the HDRI when the sky is not rotated (see tools/find_sun.py). */
  hdriSunHeading: number;
  sunColor: Vec3Tuple;
  sunIntensity: number;
  environmentIntensity: number;
  fogColor: Vec3Tuple;
  fogDensity: number;
  exposure: number;
  contrast: number;
}

/** Everything the engine needs to load and run a map. One entry per map in the registry. */
export interface MapDefinition {
  id: string;
  name: string;
  description: string;
  /** Base URL (relative to the deployed site) of the map's models. */
  assetPath: string;
  /** Map layout data (bundled JSON). */
  layout: MapLayout;
  /** File (relative to `assetPath`) listing the map's GLBs and collision data; written by the Blender pipeline. */
  assetIndex: string;
  /** Size of the playable area in metres [width, depth]. */
  dimensions: [number, number];
  environment: EnvironmentConfig;
  collision: { killY: number };
}
