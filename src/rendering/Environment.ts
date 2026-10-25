import {
  CascadedShadowGenerator,
  Color3,
  DirectionalLight,
  EquiRectangularCubeTexture,
  HDRCubeTexture,
  InstancedMesh,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  type AbstractMesh,
  type Camera,
} from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import type { EnvironmentConfig } from '../maps/types';
import type { ShadowPreset } from './quality';

const DEG = Math.PI / 180;

/** Unit vector pointing from the ground TOWARD the sun for a compass heading and elevation. */
export function sunVector(headingDeg: number, elevationDeg: number): Vector3 {
  const h = headingDeg * DEG;
  const e = elevationDeg * DEG;
  // compass heading: 0 = north (-z), 90 = east (+x)
  return new Vector3(Math.sin(h) * Math.cos(e), Math.sin(e), -Math.cos(h) * Math.cos(e));
}

/**
 * Sky, image-based lighting, sun + cascaded shadows, fog and tone mapping for one map.
 *
 * The HDRI provides ambient light and reflections; the tonemapped 4K panorama is drawn as the
 * visible sky. Both are rotated together so the HDRI's sun lines up with the directional light.
 */
export class Environment {
  readonly sun: DirectionalLight;
  readonly hdr: HDRCubeTexture;
  readonly sky: Mesh;
  shadows: ShadowGenerator | null = null;
  private casters: AbstractMesh[] = [];
  private receivers: AbstractMesh[] = [];

  constructor(
    private readonly scene: Scene,
    readonly cfg: EnvironmentConfig,
  ) {
    // A mesh rotation of +t about +Y moves its features by -t in compass heading, while a cube
    // texture's rotationY moves them by +t. `hdriSunHeading` was calibrated empirically
    // (tools/dev-sun-sweep.mjs) as the sun's heading with no rotation applied.
    const rot = (cfg.hdriSunHeading - cfg.sunHeading) * DEG;

    this.hdr = new HDRCubeTexture(assetUrl(cfg.hdr), scene, 256, false, true, false, true);
    this.hdr.rotationY = -rot;
    scene.environmentTexture = this.hdr;
    scene.environmentIntensity = cfg.environmentIntensity;

    const skyTex = new EquiRectangularCubeTexture(assetUrl(cfg.skyImage), scene, 1024, false, true);
    skyTex.coordinatesMode = Texture.SKYBOX_MODE;
    const skyMat = new StandardMaterial('sky', scene);
    skyMat.backFaceCulling = false;
    skyMat.reflectionTexture = skyTex;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = Color3.Black();
    skyMat.specularColor = Color3.Black();
    skyMat.fogEnabled = false;
    // the panorama is already display-referred: keep it out of the scene tone mapping
    const ip = new ImageProcessingConfiguration();
    ip.toneMappingEnabled = false;
    ip.exposure = 1;
    ip.contrast = 1;
    skyMat.imageProcessingConfiguration = ip;
    this.sky = MeshBuilder.CreateBox('sky', { size: 800 }, scene);
    this.sky.material = skyMat;
    this.sky.infiniteDistance = true;
    this.sky.isPickable = false;
    this.sky.applyFog = false;
    this.sky.renderingGroupId = 0;
    this.sky.rotation.y = rot;

    const toSun = sunVector(cfg.sunHeading, cfg.sunElevation);
    this.sun = new DirectionalLight('sun', toSun.scale(-1), scene);
    this.sun.position = toSun.scale(120);
    this.sun.diffuse = new Color3(...cfg.sunColor);
    this.sun.specular = new Color3(...cfg.sunColor);
    this.sun.intensity = cfg.sunIntensity;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 260;

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = cfg.fogDensity;
    scene.fogColor = new Color3(...cfg.fogColor);

    const ipc = scene.imageProcessingConfiguration;
    ipc.toneMappingEnabled = true;
    ipc.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ipc.exposure = cfg.exposure;
    ipc.contrast = cfg.contrast;
    ipc.vignetteEnabled = true;
    ipc.vignetteWeight = 1.4;
    ipc.vignetteStretch = 0.4;
    ipc.vignetteColor.set(0.05, 0.04, 0.03, 0);
  }

  setFog(enabled: boolean): void {
    this.scene.fogMode = enabled ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_NONE;
  }

  /**
   * `casters` cast shadows in every mode; `dynamicCasters` (things that move, like targets) are
   * only included in cascaded mode because the static map is rendered once.
   */
  registerShadowMeshes(casters: AbstractMesh[], receivers: AbstractMesh[], dynamicCasters: AbstractMesh[] = []): void {
    this.casters.push(...casters);
    this.dynamicCasters.push(...dynamicCasters);
    // instances share their source mesh's shadow settings
    const meshes = receivers.map((r) => (r instanceof InstancedMesh ? r.sourceMesh : r));
    this.receivers.push(...new Set(meshes));
    for (const r of this.receivers) r.receiveShadows = true;
  }

  private dynamicCasters: AbstractMesh[] = [];

  unregisterAll(): void {
    this.casters = [];
    this.dynamicCasters = [];
    this.receivers = [];
    const list = this.shadows?.getShadowMap()?.renderList;
    if (list) list.length = 0;
  }

  applyShadowPreset(p: ShadowPreset, camera: Camera, mapHalfExtent = 42): void {
    if (this.shadows) {
      this.shadows.dispose();
      this.shadows = null;
    }
    for (const r of this.receivers) r.receiveShadows = p.enabled;
    if (!p.enabled) return;
    const quality =
      p.filtering === 'high'
        ? ShadowGenerator.QUALITY_HIGH
        : p.filtering === 'medium'
          ? ShadowGenerator.QUALITY_MEDIUM
          : ShadowGenerator.QUALITY_LOW;
    if (p.mode === 'static') {
      // fixed orthographic frustum over the whole map, rendered once
      const sun = this.sun;
      sun.autoUpdateExtends = false;
      sun.autoCalcShadowZBounds = false;
      sun.shadowFrustumSize = mapHalfExtent * 2 * 1.42;
      sun.shadowMinZ = 40;
      sun.shadowMaxZ = 220;
      const sg = new ShadowGenerator(p.mapSize, sun, true);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = quality;
      sg.bias = 0.0012;
      sg.normalBias = 0.012;
      sg.transparencyShadow = true;
      const map = sg.getShadowMap()!;
      map.renderList!.push(...this.casters);
      map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      this.shadows = sg;
      return;
    }
    this.sun.shadowFrustumSize = 0;
    this.sun.autoUpdateExtends = true;
    const csm = new CascadedShadowGenerator(p.mapSize, this.sun, true, camera);
    csm.numCascades = p.cascades;
    csm.lambda = 0.82;
    csm.shadowMaxZ = p.maxZ;
    csm.stabilizeCascades = true;
    csm.cascadeBlendPercentage = 0.08;
    csm.depthClamp = true;
    csm.autoCalcDepthBounds = false;
    csm.usePercentageCloserFiltering = true;
    csm.filteringQuality = quality;
    csm.bias = 0.0025;
    csm.normalBias = 0.018;
    csm.transparencyShadow = true;
    csm.getShadowMap()!.renderList!.push(...this.casters, ...this.dynamicCasters);
    this.shadows = csm;
  }

  dispose(): void {
    this.shadows?.dispose();
    this.sun.dispose();
    this.sky.material?.dispose(true, true);
    this.sky.dispose();
    this.hdr.dispose();
    this.scene.environmentTexture = null;
  }
}
