import {compactSurfaceTexture} from './SurfaceTexture';
import { Color3, Material, Observable, PBRMaterial, Texture, type Scene } from '@babylonjs/core';
import { assetUrl, fetchJson } from '../core/assets';

interface MaterialDef {
  tile: number;
  tint: [number, number, number];
  albedo?: string;
  normal?: string;
  orm?: string;
  roughness?: number;
  metallic?: number;
  normal_strength?: number;
  emissive?: [number, number, number];
  emissive_tex?: boolean;
  alpha_cutoff?: number;
  alpha?: number;
  double_sided?: boolean;
  /** Thin layer over another surface (ground inlays): drawn with a small polygon offset. */
  decal?: boolean;
  /** UVs address regions of one image (signs, posters): load it without the vertical flip. */
  atlas?: boolean;
}

interface MaterialFile {
  version: number;
  materials: Record<string, MaterialDef>;
}

/**
 * Shared PBR materials built from public/assets/materials.json (written by the Blender pipeline).
 *
 * GLB files only carry material *names*; every mesh using "stone_rubble" ends up with the same
 * PBRMaterial and the same GPU textures, regardless of which file it came from. UVs are authored in
 * metres, so each material's `tile` (metres per texture repeat) sets the texture density.
 */
export class MaterialLibrary {
  private defs: Record<string, MaterialDef> = {};
  private readonly materials = new Map<string, PBRMaterial>();
  private readonly textures = new Map<string, Texture>();
  private anisotropy = 4;
  private ultra = false;
  private chromebook=false;
  readonly onQualityChanged = new Observable<void>();
  get chromebookMode():boolean {return this.chromebook;}
  private readonly smallTextures=new Map<Texture,Texture>();
  private readonly compactWork=new Map<Texture,Promise<void>>();
  private readonly textureLifetime=new AbortController();
  setChromebook(enabled:boolean):void {
    if(this.chromebook===enabled)return;this.chromebook=enabled;
    for(const [name,m] of this.materials)this.applyQuality(name,this.defs[name],m);
    this.onQualityChanged.notifyObservers();
    this.releaseUnusedTextures();
  }
  private compactTexture(source:Texture,m:PBRMaterial):void {
    const assign=()=>{
      if(!this.chromebook||!this.scene.materials.includes(m)||this.scene.isDisposed)return;
      const size=source.getSize();if(Math.max(size.width,size.height)<=256)return;
      if(this.compactWork.has(source))return;
      const work=(async()=>{
        const copy=this.smallTextures.get(source)??await compactSurfaceTexture(source,this.scene,256,this.textureLifetime.signal);
        if(!this.chromebook||this.scene.isDisposed){copy.dispose();return;}
        copy.anisotropicFilteringLevel=this.anisotropy;
        this.smallTextures.set(source,copy);
        // Replace every user before releasing the full-size GPU allocation.
        for(const material of this.materials.values()){
          if(material.albedoTexture===source)material.albedoTexture=copy;
          if(material.emissiveTexture===source)material.emissiveTexture=copy;
        }
        this.onQualityChanged.notifyObservers();
      })().catch(error=>{
        // A failed image optimization must never leave a missing surface.
        if(!this.scene.isDisposed)console.warn('Keeping original texture',source.name,error);
      }).finally(()=>this.compactWork.delete(source));
      this.compactWork.set(source,work);
    };
    if(source.isReady())assign();else source.onLoadObservable.addOnce(assign);
  }
  private fallback: PBRMaterial | null = null;
  readonly missing = new Set<string>();

  constructor(private readonly scene: Scene) {
    scene.onDisposeObservable.addOnce(()=>this.textureLifetime.abort());
  }

  async load(url = assetUrl('assets/materials.json'), signal?: AbortSignal): Promise<void> {
    const file = await fetchJson<MaterialFile>(url, signal);
    signal?.throwIfAborted();
    this.defs = file.materials;
  }

  async ready(signal?: AbortSignal): Promise<void> {
    const end=Date.now()+60000;
    for(;;){
      signal?.throwIfAborted();
      if(this.scene.isDisposed)throw new Error('Material scene disposed');
      // Compaction replaces and disposes sources while loading. Re-read the
      // live set so readiness never waits forever on a released original.
      const live=[...this.textures.values(),...this.smallTextures.values()].filter(t=>!!t.getInternalTexture());
      const failed=live.find(t=>t.loadingError);
      if(failed)throw new Error(`Required texture failed to load: ${failed.name}`);
      if(live.every(t=>t.isReady())&&this.compactWork.size===0)return;
      if(Date.now()>=end)throw new Error('Required material textures timed out');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }

  private releaseUnusedTextures():void {
    const used=new Set([...this.scene.materials,...this.materials.values()].flatMap(m=>m.getActiveTextures()));
    for(const [key,t] of this.textures){
      if(used.has(t))continue;
      if(this.compactWork.has(t))continue;
      // Retain a source until its replacement has finished uploading.
      const compact=this.smallTextures.get(t);
      if(compact&&!compact.isReady())continue;
      t.dispose();
      if(!compact)this.textures.delete(key);
    }
    for(const [source,copy]of this.smallTextures){
      // A cached image can finish before material assignment runs. Its live
      // source still owns that replacement during the handover.
      if(used.has(copy)||used.has(source)||!copy.isReady())continue;
      copy.dispose();this.smallTextures.delete(source);
    }
  }

  /** Run after shader/asset readiness, once no loader is awaiting a source image. */
  trim():void {this.releaseUnusedTextures();}

  has(name: string): boolean {
    return name in this.defs;
  }

  names(): string[] {
    return Object.keys(this.defs);
  }

  setAnisotropy(level: number): void {
    this.anisotropy = level;
    for (const t of this.textures.values()) t.anisotropicFilteringLevel = level;
    for (const t of this.smallTextures.values()) t.anisotropicFilteringLevel = level;
  }

  /** Update shared instances in place, including weapon/remote materials, without rebatching. */
  setUltra(enabled: boolean): void {
    if (this.ultra === enabled) return;
    this.ultra = enabled;
    for (const [name, material] of this.materials) this.applyQuality(name, this.defs[name], material);
    this.onQualityChanged.notifyObservers();
  }

  private applyQuality(name: string, def: MaterialDef, m: PBRMaterial): void {
    // Preserve source maps for a lossless return from the derived low-cost mode.
    if(def.albedo){const source=this.texture(def.albedo,def.tile||1,false,!def.atlas);m.albedoTexture=source;
      if(this.chromebook&&!def.atlas)this.compactTexture(source,m);}
    m.emissiveTexture=def.emissive_tex?m.albedoTexture:null;
    m.bumpTexture=!this.chromebook&&def.normal?this.texture(def.normal,def.tile||1,true):null;
    if(m.bumpTexture){m.bumpTexture.level=def.normal_strength??1;m.invertNormalMapX=false;m.invertNormalMapY=false;}
    m.roughness=def.roughness??(def.orm?1:.8);
    m.reflectionColor=this.chromebook?Color3.Black():Color3.White();
    m.enableSpecularAntiAliasing = this.ultra;
    // Alpha defaults to true in Babylon and takes precedence over green. Our
    // authored ORM images store roughness in green, with an opaque alpha channel.
    m.useRoughnessFromMetallicTextureAlpha = !this.ultra;
    m.metallicTexture=null;
    if (def.orm&&!this.chromebook) {
      // This borrowed dielectric texture has almost zero metal in blue. The
      // existing corrected variant preserves its identical AO/roughness channels
      // and supplies white metal so the authored scalar metallic factor applies.
      const path = this.ultra && def.orm === 'assets/textures/shared/metal_orm.jpg' && (def.metallic ?? 0) > 0
        ? 'assets/textures/weapons/gun_metal_orm.png' : def.orm;
      m.metallicTexture = this.texture(path, def.tile || 1, true);
    }
    m.metallic = def.metallic ?? (def.orm ? 1 : 0);
    // Remove JPEG metal-channel noise from dielectric masonry/wood/fabric.
    if (this.ultra && /^(stone|slabs|plaster|brick|concrete|cobble|pavers|curb|stucco|facade_tiles|wood|canvas|cardboard|soil|terracotta|interior_)/.test(name)) m.metallic = 0;
    if (this.ultra && /^(glass|gun_glass|weapon_lens)/.test(name)) m.metallic = 0;
    // A thin finish belongs on painted bodywork, not stone, cloth or rubber.
    const coat = this.ultra ? (/^carpaint_/.test(name) ? .45 : /^(steel_|container_|paint_)/.test(name) ? .14 : 0) : 0;
    m.clearCoat.isEnabled = coat > 0;
    m.clearCoat.intensity = coat;
    m.clearCoat.roughness = /^carpaint_/.test(name) ? .22 : .45;
    if(this.chromebook){m.bumpTexture=null;m.metallicTexture=null;m.clearCoat.isEnabled=false;m.enableSpecularAntiAliasing=false;m.metallic=0;m.roughness=1;}

  }

  private texture(path: string, tile: number, linear: boolean, invertY = true): Texture {
    const key = `${path}|${tile}|${linear}|${invertY}`;
    let tex = this.textures.get(key);
    if(tex&&this.chromebook&&!linear&&invertY){const compact=this.smallTextures.get(tex);if(compact?.isReady())return compact;}
    // Leaving Chromebook mode lazily reloads originals instead of retaining
    // invisible full-resolution textures for the entire match.
    if(tex&&!tex.getInternalTexture()){this.textures.delete(key);tex=undefined;}
    if (!tex) {
      tex = new Texture(assetUrl(path), this.scene, {
        noMipmap: false,
        // glTF UVs are top-origin, so the flip turns images upside down. Tiling surfaces do not care (and keep it so
        // existing normal maps read the same); image sheets such as signs set `atlas` and load unflipped.
        invertY,
        samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
        gammaSpace: !linear,
      });
      tex.uScale = 1 / tile;
      tex.vScale = 1 / tile;
      tex.wrapU = Texture.WRAP_ADDRESSMODE;
      tex.wrapV = Texture.WRAP_ADDRESSMODE;
      tex.anisotropicFilteringLevel = this.anisotropy;
      this.textures.set(key, tex);
    }
    return tex;
  }

  /** Materials that should not cast shadows (transparent, emissive or too small to matter). */
  static readonly NO_SHADOW = new Set([
    // wall ivy: thousands of thin cards on the Farmstead perimeter wall (see MapManager)
    'leaf_ivy', 'leaf_ivy_lite',
    'glass', 'glass_shop', 'soil', 'flowers', 'foliage', 'lantern_glass', 'team_blue_glow', 'team_red_glow',
    'sign_blue', 'sign_red', 'slabs_inlay', 'stone_inlay', 'water', 'frame_white', 'frame_dark', 'produce', 'shop_sign', 'copper',
    // Industrial Complex / Modern City: glazing, paint and stain decals, lamps, and the alpha-tested chain-link mesh
    // (a shadow map would draw it as a solid slab; the fence posts still cast)
    'glass_wired', 'glass_skylight', 'glass_window', 'glass_store', 'window_blinds', 'paint_yellow', 'paint_white', 'oil_stain',
    'asphalt_inlay', 'concrete_floor_inlay', 'asphalt_fine_inlay', 'pavers_inlay', 'lamp_sodium', 'lamp_led', 'signal_green',
    'signal_off', 'headlight', 'taillight', 'chainlink', 'aluminium',
    // backs of door and shop openings: inside the wall, never in the light's path
    'interior_dark',
  ]);

  /**
   * Materials that differ only by tint share one "canonical" material; the caller bakes the
   * returned tint ratio into vertex colours. Cuts ~30 material variants down to their texture sets.
   */
  canonical(rawName: string): { material: Material; tint: [number, number, number]; name: string } {
    const name = MaterialLibrary.cleanName(rawName);
    const def = this.defs[name];
    if (!def) return { material: this.get(name), tint: [1, 1, 1], name };
    const { tint, ...rest } = def;
    const key = JSON.stringify(rest);
    let canon = this.canonByKey.get(key);
    if (!canon) {
      canon = name;
      this.canonByKey.set(key, canon);
    }
    const ct = this.defs[canon].tint;
    return {
      material: this.get(canon),
      tint: [tint[0] / Math.max(1e-4, ct[0]), tint[1] / Math.max(1e-4, ct[1]), tint[2] / Math.max(1e-4, ct[2])],
      name: canon,
    };
  }

  private readonly canonByKey = new Map<string, string>();

  static cleanName(raw: string): string {
    return raw.replace(/^lib:/, '').replace(/\.\d{3}$/, '');
  }

  /** Get (or build) the shared material for a name; unknown names get a visible fallback. */
  get(rawName: string): Material {
    const name = MaterialLibrary.cleanName(rawName);
    const existing = this.materials.get(name);
    if (existing) return existing;
    const def = this.defs[name];
    if (!def) {
      this.missing.add(name);
      return this.getFallback();
    }
    const m = new PBRMaterial(`lib:${name}`, this.scene);
    const tile = def.tile || 1;
    m.albedoColor = new Color3(def.tint[0], def.tint[1], def.tint[2]);
    if (def.albedo) {
      m.albedoTexture = this.texture(def.albedo, tile, false, !def.atlas);
      if (def.alpha_cutoff) {
        m.albedoTexture.hasAlpha = true;
        m.useAlphaFromAlbedoTexture = true;
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        m.alphaCutOff = def.alpha_cutoff;
      }
    }
    if (def.normal&&!this.chromebook) {
      m.bumpTexture = this.texture(def.normal, tile, true);
      m.bumpTexture.level = def.normal_strength ?? 1;
      // OpenGL-convention normal maps in a right-handed scene
      m.invertNormalMapX = false;
      m.invertNormalMapY = false;
    }
    if (def.orm) {
      if(!this.chromebook)m.metallicTexture = this.texture(def.orm, tile, true);
      m.useAmbientOcclusionFromMetallicTextureRed = true;
      m.useRoughnessFromMetallicTextureGreen = true;
      m.useMetallnessFromMetallicTextureBlue = true;
      m.metallic = def.metallic ?? 1;
      m.roughness = def.roughness ?? 1;
    } else {
      m.metallic = def.metallic ?? 0;
      m.roughness = def.roughness ?? 0.8;
    }
    if (def.emissive) {
      m.emissiveColor = new Color3(def.emissive[0], def.emissive[1], def.emissive[2]);
      if (def.emissive_tex && m.albedoTexture) m.emissiveTexture = m.albedoTexture;
    }
    if (def.alpha !== undefined && def.alpha < 1) {
      m.alpha = def.alpha;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    }
    if (def.double_sided) {
      m.backFaceCulling = false;
      m.twoSidedLighting = true;
    }
    if (def.decal) {
      // intentional layering only: pull towards the camera so the layer wins against the surface it lies on
      m.zOffset = -2;
      m.zOffsetUnits = -2;
    }
    m.environmentIntensity = 1;
    this.applyQuality(name, def, m);
    this.materials.set(name, m);
    return m;
  }

  private getFallback(): PBRMaterial {
    if (!this.fallback) {
      this.fallback = new PBRMaterial('lib:missing', this.scene);
      this.fallback.albedoColor = new Color3(1, 0, 1);
      this.fallback.roughness = 1;
      this.fallback.metallic = 0;
    }
    return this.fallback;
  }

  all(): PBRMaterial[] {
    return [...this.materials.values()];
  }

  /**
   * Free the materials (and the textures only they used) that nothing in the scene renders with any more, e.g. the
   * previous map's after a map switch. Returns how many materials and textures were disposed.
   */
  prune(inUse: ReadonlySet<Material>): { materials: number; textures: number } {
    let materials = 0;
    for (const [name, m] of this.materials) {
      if (inUse.has(m)) continue;
      m.dispose(false, false);
      this.materials.delete(name);
      materials++;
    }
    const keep = new Set<Texture>();
    for (const m of [...this.materials.values(),...inUse]) {
      for (const t of m.getActiveTextures()) keep.add(t as Texture);
    }
    let textures = 0;
    for (const [key, t] of this.textures) {
      const compact=this.smallTextures.get(t);
      if (keep.has(t)||compact&&keep.has(compact)) continue;
      if(this.compactWork.has(t))continue;
      this.smallTextures.get(t)?.dispose();this.smallTextures.delete(t);
      t.dispose();
      this.textures.delete(key);
      textures++;
    }
    // canonical groups may now point at disposed materials: rebuild them lazily
    this.canonByKey.clear();
    return { materials, textures };
  }

  /** Loaded material and texture counts (debug API / leak tests). */
  counts(): { materials: number; textures: number } {
    return { materials: this.materials.size, textures: this.textures.size };
  }

  dispose(): void {
    this.onQualityChanged.clear();
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    for(const t of this.smallTextures.values())t.dispose();this.smallTextures.clear();
    this.materials.clear();
    this.textures.clear();
  }
}
