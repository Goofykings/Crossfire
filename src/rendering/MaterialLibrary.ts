import { Color3, Material, PBRMaterial, Texture, type Scene } from '@babylonjs/core';
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
  private fallback: PBRMaterial | null = null;
  readonly missing = new Set<string>();

  constructor(private readonly scene: Scene) {}

  async load(url = assetUrl('assets/materials.json')): Promise<void> {
    const file = await fetchJson<MaterialFile>(url);
    this.defs = file.materials;
  }

  has(name: string): boolean {
    return name in this.defs;
  }

  names(): string[] {
    return Object.keys(this.defs);
  }

  setAnisotropy(level: number): void {
    this.anisotropy = level;
    for (const t of this.textures.values()) t.anisotropicFilteringLevel = level;
  }

  private texture(path: string, tile: number, linear: boolean, invertY = true): Texture {
    const key = `${path}|${tile}|${linear}|${invertY}`;
    let tex = this.textures.get(key);
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
    if (def.normal) {
      m.bumpTexture = this.texture(def.normal, tile, true);
      m.bumpTexture.level = def.normal_strength ?? 1;
      // OpenGL-convention normal maps in a right-handed scene
      m.invertNormalMapX = false;
      m.invertNormalMapY = false;
    }
    if (def.orm) {
      m.metallicTexture = this.texture(def.orm, tile, true);
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
    for (const m of this.materials.values()) {
      for (const t of [m.albedoTexture, m.bumpTexture, m.metallicTexture, m.emissiveTexture]) if (t) keep.add(t as Texture);
    }
    let textures = 0;
    for (const [key, t] of this.textures) {
      if (keep.has(t)) continue;
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
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear();
    this.textures.clear();
  }
}
