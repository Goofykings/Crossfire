import { Color3, MirrorTexture, PBRMaterial, Plane, Texture, type AbstractMesh, type Scene } from '@babylonjs/core';

/**
 * The shelter's puddles (material `puddle`, one shared PBR material on one batched mesh).
 *
 *  - Medium and above: ONE planar MirrorTexture for the whole floor plane (not one per puddle), 256 / 384 / 512 px by
 *    preset. It only renders while the camera is below the street slab, from a short list of the materials that exist
 *    down there (concrete, timber, iron, lamp bulbs, ...), every second frame, so it costs nothing outdoors.
 *  - Low and Chromebook mode: no reflection render target at all. The puddle is a dark, slightly glossy material and the
 *    texture is released, so switching presets in the settings screen takes effect immediately and returns the memory.
 *
 * MaterialLibrary leaves `puddle` alone (MANAGED); this class owns its gloss.
 */
const REFLECTED = /^(concrete_|wood_beam|wood_dark|iron|bulb_|trim_brown|stone_stacked|steel)/;

export class PuddleReflections {
  private mirror: MirrorTexture | null = null;
  private size = 0;
  private active = false;
  private readonly reflected: AbstractMesh[];

  constructor(
    private readonly scene: Scene,
    private readonly material: PBRMaterial,
    batched: readonly AbstractMesh[],
    private readonly planeY: number,
    puddles: readonly AbstractMesh[],
  ) {
    const own = new Set(puddles);
    this.reflected = batched.filter((m) => !own.has(m) && REFLECTED.test((m.metadata as { canonical?: string } | null)?.canonical ?? ''));
  }

  /** The reflection resolution now in effect (0: none). */
  get reflectionSize(): number { return this.size; }

  /** Apply a graphics preset's `puddleReflections` size (0 disables the render target). */
  apply(size: 0 | 256 | 384 | 512): void {
    if (size === this.size && (size === 0) === !this.mirror) return;
    this.size = size;
    this.mirror?.dispose();
    this.mirror = null;
    this.active = false;
    const m = this.material;
    if (size === 0) {
      // dark, slightly glossy concrete water: no environment sheen of the sky underground beyond a hint
      m.reflectionTexture = null;
      m.albedoColor = new Color3(0.025, 0.03, 0.035);
      m.metallic = 0;
      m.roughness = 0.32;
      m.environmentIntensity = 0.3;
      return;
    }
    const mirror = new MirrorTexture('puddle-mirror', size, this.scene, false, undefined, Texture.BILINEAR_SAMPLINGMODE, true);
    // Plane (0, -1, 0, d) mirrors a floor at y = d; the polygons sit 6 mm above the slab
    mirror.mirrorPlane = new Plane(0, -1, 0, this.planeY + 0.006);
    mirror.level = 0.92;
    mirror.renderList = [];
    mirror.refreshRate = 0;
    this.mirror = mirror;
    m.reflectionTexture = mirror;
    // metal with a pale tint = a mirror with a little loss; roughness stays tiny so the lamps stay crisp
    m.albedoColor = new Color3(0.5, 0.55, 0.6);
    m.metallic = 1;
    m.roughness = 0.07;
    m.environmentIntensity = 1;
  }

  /** Call every frame with the camera height: the mirror renders only while the camera is underground. */
  update(cameraY: number): void {
    const mirror = this.mirror;
    if (!mirror) return;
    const under = cameraY < this.planeY + 3.7;
    if (under === this.active) return;
    this.active = under;
    if (under) {
      mirror.renderList = [...this.reflected];
      mirror.refreshRate = 2;
    } else {
      mirror.renderList = [];
      mirror.refreshRate = 0;
    }
  }

  inspect(): { size: number; mirror: boolean; rendering: boolean; reflected: number } {
    return { size: this.size, mirror: !!this.mirror, rendering: !!this.mirror && this.active, reflected: this.reflected.length };
  }

  dispose(): void {
    this.mirror?.dispose();
    this.mirror = null;
    this.material.reflectionTexture = null;
  }
}
