import { MaterialPluginBase, RegisterClass, type BaseTexture, type Material, type MaterialDefines, type UniformBuffer } from '@babylonjs/core';
import type { SkinFx } from '../../shared/cosmetics';

/** One material plugin for every animated or procedural weapon skin. A skin supplies only
 * parameters and textures (shared/cosmetics.ts `fx`); the two modes are compile-time
 * defines of the same PBR shader, so nothing here costs a pass, a render target or CPU work
 * per vertex.
 *
 *   flow   Hydro Dip. A shared flow map (R marbling field, GB warp) is read at slowly
 *          drifting offsets and indexes the variant's periodic colour ramp. Offsets are
 *          taken modulo one repeat on the CPU and both textures tile, so the motion never
 *          jumps or loops visibly. Three map reads + one ramp read (lite: one + one).
 *   frost  Frosted. Snow above a gun-space height with a wavy edge, and on upward faces,
 *          from the object-space position and normal (so it stays put when the gun moves).
 *
 * Geometry is never displaced: only the fragment colour changes. */
let lite = false;
const live = new Set<SkinFxPlugin>();
const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Seconds for the flow animation; tests and screenshots may replace it. */
export const skinFxClock = { now: (): number => still ? 0 : performance.now() / 1000 };

/** Chromebook mode: cheaper variants of the same shader (Game.applySettings). */
export function setSkinFxLite(enabled: boolean): void {
  if (lite === enabled) return;
  lite = enabled;
  for (const plugin of live) plugin.markAllDefinesAsDirty();
}
export const skinFxLite = (): boolean => lite;
export const skinFxInfo = () => ({ lite, materials: live.size, modes: [...live].map((p) => p.mode) });

const wrap = (v: number) => v - Math.floor(v);

const FRAGMENT_ALBEDO = `
#ifdef SKINFX_FLOW
{
  vec2 skinUv=vSkinFxUV*skinFxA.x;
  #ifdef SKINFX_LITE
  vec4 skinS=texture2D(skinFxMap,skinUv+skinFxC.xy);
  float skinBand=skinS.r*skinFxA.y+skinS.g*.3+skinFxA.z;
  #else
  vec2 skinW=texture2D(skinFxMap,skinUv*.5+skinFxB.xy).gb-.5;
  vec2 skinW2=texture2D(skinFxMap,skinUv*1.3+skinW*.22+skinFxB.zw).gb-.5;
  float skinBand=texture2D(skinFxMap,skinUv+skinW*.4+skinW2*.1+skinFxC.xy).r*skinFxA.y+skinW2.x*.3+skinFxA.z;
  #endif
  surfaceAlbedo*=toLinearSpace(texture2D(skinFxRamp,vec2(skinBand,.5)).rgb);
}
#endif
#ifdef SKINFX_FROST
{
  #ifdef SKINFX_LITE
  float skinN=.5+.32*sin(vSkinFxP.z*71.+vSkinFxP.x*23.)+.18*sin(vSkinFxP.z*173.);
  #else
  float skinN=texture2D(skinFxMap,vec2(vSkinFxP.z*9.+vSkinFxP.x*4.,vSkinFxP.x*6.+.37)).r;
  skinN=clamp((skinN-.5)*2.2+.5,0.,1.);
  #endif
  float skinCap=smoothstep(-.0012,.0012,vSkinFxP.y+(skinN-.5)*skinFxC.z-skinFxC.w);
  float skinTop=smoothstep(.55,.8,vSkinFxN.y+(skinN-.5)*.3);
  surfaceAlbedo=mix(surfaceAlbedo,vec3(.8,.87,.98)+.12*skinN,max(skinCap,skinTop));
}
#endif
`;
const VARYINGS = `
#if defined(SKINFX_FLOW) || defined(SKINFX_FROST)
varying vec2 vSkinFxUV;
varying vec3 vSkinFxP;
varying vec3 vSkinFxN;
#endif
`;

export class SkinFxPlugin extends MaterialPluginBase {
  private cfg: SkinFx | null = null;
  private map: BaseTexture | null = null;
  private ramp: BaseTexture | null = null;

  constructor(material: Material) {
    super(material, 'SkinFx', 210, { SKINFX_FLOW: false, SKINFX_FROST: false, SKINFX_LITE: false });
    live.add(this);
    material.onDisposeObservable.addOnce(() => live.delete(this));
  }

  get mode(): SkinFx['type'] | null { return this.cfg?.type ?? null; }

  /** Textures are owned by the caller (the cosmetic's container), never disposed here. */
  configure(cfg: SkinFx, map: BaseTexture | null, ramp: BaseTexture | null): void {
    this.cfg = cfg; this.map = map; this.ramp = ramp;
    this._enable(true);
    this.markAllDefinesAsDirty();
  }

  override getClassName(): string { return 'SkinFxPlugin'; }
  override isReadyForSubMesh(): boolean { return (!this.map || this.map.isReady()) && (!this.ramp || this.ramp.isReady()); }

  override prepareDefinesBeforeAttributes(defines: MaterialDefines): void {
    // The varyings need the mesh's UVs and normals even where the source material has no maps.
    if (this.cfg) { defines._needUVs = true; defines._needNormals = true; }
  }
  override prepareDefines(defines: MaterialDefines): void {
    const type = this.cfg?.type, d = defines as unknown as Record<string, boolean>;
    d.SKINFX_FLOW = type === 'flow'; d.SKINFX_FROST = type === 'frost'; d.SKINFX_LITE = lite;
  }
  override hasTexture(texture: BaseTexture): boolean { return texture === this.map || texture === this.ramp; }
  override getActiveTextures(textures: BaseTexture[]): void { if (this.map) textures.push(this.map); if (this.ramp) textures.push(this.ramp); }
  override getSamplers(samplers: string[]): void { samplers.push('skinFxMap', 'skinFxRamp'); }
  override getUniforms() {
    return {
      ubo: [{ name: 'skinFxA', size: 4, type: 'vec4' }, { name: 'skinFxB', size: 4, type: 'vec4' }, { name: 'skinFxC', size: 4, type: 'vec4' }],
      fragment: 'uniform vec4 skinFxA;uniform vec4 skinFxB;uniform vec4 skinFxC;',
    };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    const cfg = this.cfg;
    if (!cfg) return;
    if (cfg.type === 'flow') {
      // Every offset wraps at one repeat of a tileable texture: seamless for any session length.
      const t = skinFxClock.now() * cfg.speed;
      ubo.updateFloat4('skinFxA', 1 / cfg.tile, cfg.bands, wrap(t * .012), 0);
      ubo.updateFloat4('skinFxB', wrap(t * .013), wrap(t * .008), wrap(-t * .009), wrap(-t * .011));
      ubo.updateFloat4('skinFxC', wrap(-t * .006), wrap(t * .0045), 0, 0);
    } else if (cfg.type === 'frost') {
      ubo.updateFloat4('skinFxA', 0, 0, 0, 0);
      ubo.updateFloat4('skinFxB', 0, 0, 0, 0);
      ubo.updateFloat4('skinFxC', 0, 0, cfg.wave * 2, cfg.line);
    }
    if (this.map) ubo.setTexture('skinFxMap', this.map);
    if (this.ramp) ubo.setTexture('skinFxRamp', this.ramp);
  }
  override getCustomCode(shaderType: string): { [point: string]: string } {
    if (shaderType === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: VARYINGS,
      CUSTOM_VERTEX_MAIN_END: `
#if defined(SKINFX_FLOW) || defined(SKINFX_FROST)
vSkinFxP=positionUpdated;
#ifdef UV1
vSkinFxUV=uvUpdated;
#else
vSkinFxUV=positionUpdated.zy;
#endif
#ifdef NORMAL
vSkinFxN=normalUpdated;
#else
vSkinFxN=vec3(0.,0.,1.);
#endif
#endif
`,
    };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: VARYINGS + `
#if defined(SKINFX_FLOW) || defined(SKINFX_FROST)
uniform sampler2D skinFxMap;
#endif
#ifdef SKINFX_FLOW
uniform sampler2D skinFxRamp;
#endif
`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: FRAGMENT_ALBEDO,
    };
  }
  /** Material.clone (the elimination fade clones weapon materials) recreates the plugin by
   * class name, then copies the configuration here; textures stay shared. */
  override copyTo(plugin: MaterialPluginBase): void {
    super.copyTo(plugin);
    if (plugin instanceof SkinFxPlugin && this.cfg) plugin.configure(this.cfg, this.map, this.ramp);
  }
  override dispose(): void { live.delete(this); }
}
RegisterClass('BABYLON.SkinFxPlugin', SkinFxPlugin);
