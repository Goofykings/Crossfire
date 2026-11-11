import {
  CascadedShadowGenerator,
  Color3,
  DirectionalLight,
  EquiRectangularCubeTexture,
  HDRCubeTexture,
  HemisphericLight,
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
import type { GraphicsPreset, ShadowPreset } from './quality';

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
  private hdr: HDRCubeTexture|null=null;
  readonly sky: Mesh;
  shadows: ShadowGenerator | null = null;
  private casters: AbstractMesh[] = [];
  private receivers: AbstractMesh[] = [];
  private hdrSettled = false;
  private disposed = false;
  private ultraHdr: HDRCubeTexture | null = null;
  private ultraSettled = false;
  private ultraReady = false;
  private wantsUltra = false;
  private wantsReflections=true;
  private ambient: HemisphericLight | null=null;

  constructor(
    private readonly scene: Scene,
    readonly cfg: EnvironmentConfig,
    initialGraphics?:GraphicsPreset,
  ) {
    // A mesh rotation of +t about +Y moves its features by -t in compass heading, while a cube
    // texture's rotationY moves them by +t. `hdriSunHeading` was calibrated empirically
    // (tools/dev-sun-sweep.mjs) as the sun's heading with no rotation applied.
    const rot = (cfg.hdriSunHeading - cfg.sunHeading) * DEG;

    this.wantsReflections=!initialGraphics?.noReflections;
    if(this.wantsReflections)scene.environmentTexture=this.reflections();
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
    if(initialGraphics)this.applyGraphicsPreset(initialGraphics);
  }

  private reflections():HDRCubeTexture {
    if(this.hdr)return this.hdr;
    const settled=()=>queueMicrotask(()=>{
      this.hdrSettled=true;
      if(this.disposed||!this.wantsReflections){this.hdr?.dispose();this.hdr=null;this.hdrSettled=false;}
    });
    this.hdr=new HDRCubeTexture(assetUrl(this.cfg.hdr),this.scene,256,false,true,false,true,settled,settled);
    this.hdr.rotationY=(this.cfg.sunHeading-this.cfg.hdriSunHeading)*DEG;
    return this.hdr;
  }

  setFog(enabled: boolean): void {
    this.scene.fogMode = enabled ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_NONE;
  }

  /** One optional cached prefilter per map, never a per-frame reflection pass.
   * Keep the original environment until the new cube has finished prefiltering. */
  applyGraphicsPreset(p: GraphicsPreset): void {
    this.setFog(p.fog);
    this.wantsReflections=!p.noReflections;
    this.wantsUltra = !p.noReflections && p.reflectionSize === 512;
    if(p.noReflections){
      // Disable the IBL shader path entirely. A cheap hemisphere preserves ambient
      // readability alongside the existing sun and authored interior fixtures.
      this.scene.environmentTexture=null;
      if(this.hdrSettled){this.hdr?.dispose();this.hdr=null;this.hdrSettled=false;}
      if(this.ultraSettled){this.ultraHdr?.dispose();this.ultraHdr=null;this.ultraSettled=false;this.ultraReady=false;}
      if(!this.ambient){this.ambient=new HemisphericLight('chromebook-ambient',Vector3.Up(),this.scene);
        this.ambient.diffuse=new Color3(.78,.84,1);this.ambient.groundColor=new Color3(.28,.3,.34);
        this.ambient.specular=Color3.Black();this.ambient.intensity=this.cfg.environmentIntensity*.65;this.ambient.renderPriority=2;}
      this.ambient.setEnabled(true);
      // Babylon reorders scene.lights on a priority change, but existing meshes
      // retain their old light list. Refresh once so ambient survives the 4-light cap.
      for(const mesh of this.scene.meshes)mesh._resyncLightSources();
      return;
    }
    this.ambient?.setEnabled(false);
    if (!this.wantsUltra) { this.scene.environmentTexture = this.reflections(); return; }
    if (this.ultraReady) { this.scene.environmentTexture = this.ultraHdr; return; }
    if (this.ultraHdr) return;
    const settled = (ready: boolean) => {
      // A cached Babylon texture may complete its callback inside construction.
      queueMicrotask(() => {
        this.ultraSettled = true;
        this.ultraReady = ready;
        if (this.disposed||!this.wantsReflections) {this.ultraHdr?.dispose();this.ultraHdr=null;this.ultraReady=false;this.ultraSettled=false;}
        else if (ready && this.wantsUltra) this.scene.environmentTexture = this.ultraHdr;
      });
    };
    // Babylon's HDR cache is keyed by URL, not requested cube dimensions.
    // Distinguish the 512 cube while still serving the same static HDR asset.
    this.ultraHdr = new HDRCubeTexture(`${assetUrl(this.cfg.hdr)}?ibl=512`, this.scene, 512, false, true, false, true,
      () => settled(true), () => settled(false));
    this.ultraHdr.rotationY = (this.cfg.sunHeading-this.cfg.hdriSunHeading)*DEG;
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
    if (this.disposed) return;
    this.disposed = true;
    this.shadows?.dispose();
    this.sun.dispose();
    this.ambient?.dispose();
    this.sky.material?.dispose(true, true);
    this.sky.dispose();
    // Babylon's native async prefilter cannot be interrupted safely. Detach now,
    // then release its texture after the prefilter settles instead of invalidating it mid-pass.
    if (this.hdrSettled) this.hdr?.dispose();
    if (this.ultraSettled) this.ultraHdr?.dispose();
    if (this.scene.environmentTexture === this.hdr || this.scene.environmentTexture === this.ultraHdr) this.scene.environmentTexture = null;
  }
}
