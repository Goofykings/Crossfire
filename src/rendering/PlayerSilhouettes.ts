import { Color3, Color4, Effect, PostProcess, RenderTargetTexture, StandardMaterial, Texture,
  type AbstractMesh, type Camera, type Scene } from '@babylonjs/core';
import { WEAPON_RENDER_GROUP } from '../weapons/WeaponView';

// One union mask, independent of material/part boundaries. An inward 1.5 CSS-pixel
// border never expands concealed pixels around a wall or onto the crosshair gun.
Effect.ShadersStore.crossfireSilhouetteFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D playerMask;
uniform vec2 stepUV;
uniform float enabled;
void main(void) {
  vec4 scene = texture2D(textureSampler, vUV);
  vec3 c = texture2D(playerMask, vUV).rgb;
  float interior = 1.0;
  for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++) {
    vec3 n = texture2D(playerMask, vUV + vec2(float(x),float(y))*stepUV).rgb;
    interior = min(interior, step(0.4, max(n.r,n.b)));
  }
  float edge = step(0.4,max(c.r,c.b)) * (1.0-interior) * enabled;
  vec3 color = c.b > c.r ? vec3(0.2,0.5,1.0) : vec3(1.0,0.08,0.06);
  gl_FragColor = vec4(mix(scene.rgb,color,edge*0.92),scene.a);
}`;

/** One unlit depth-tested pass for the whole room, never a pass per body/part.
 * Opaque world meshes write black and depth; all parts of a player write the
 * same flat color. Skinning uses Babylon's normal material/rig shader path.
 */
export class PlayerSilhouettes {
  private readonly mask: RenderTargetTexture;
  private readonly world: StandardMaterial;
  private readonly red: StandardMaterial;
  private readonly blue: StandardMaterial;
  private readonly composite: PostProcess;
  private occluders: AbstractMesh[] = [];
  private players = new Map<AbstractMesh, boolean>();
  private enabled = false;
  constructor(private readonly scene: Scene, private readonly camera: Camera) {
    const flat = (name: string, color: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true; m.emissiveColor = color; m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black(); m.backFaceCulling = false;
      m.fogEnabled = false; m.disableDepthWrite = false;
      return m;
    };
    this.world = flat('silhouette:world', Color3.Black());
    this.red = flat('silhouette:opponent', new Color3(1, 0, 0));
    this.blue = flat('silhouette:ally', new Color3(0, 0, 1));
    this.mask = new RenderTargetTexture('silhouette:visible-union', { ratio: 1 }, scene,
      { generateMipMaps: false, samplingMode: Texture.NEAREST_SAMPLINGMODE, generateDepthBuffer: true });
    this.mask.activeCamera = camera;
    // This is a flat color/depth mask, not another SSAO/MRT scene. In High
    // quality the main camera's prepass must never replace its color target.
    this.mask.noPrePassRenderer = true;
    this.mask.clearColor = new Color4(0, 0, 0, 1);
    this.mask.renderParticles = false;
    this.mask.renderList = [];
    this.composite = new PostProcess('silhouette:contour', 'crossfireSilhouette', ['stepUV', 'enabled'], ['playerMask'], 1, camera);
    this.composite.onApply = (effect) => {
      effect.setTexture('playerMask', this.mask);
      const canvas = scene.getEngine().getRenderingCanvas();
      effect.setFloat2('stepUV', 1.5 / (canvas?.clientWidth || 1280), 1.5 / (canvas?.clientHeight || 720));
      effect.setFloat('enabled', this.enabled ? 1 : 0);
    };
  }
  setWorld(meshes: readonly AbstractMesh[]): void {
    this.occluders = meshes.filter((m) => (m.metadata?.canonical || m.renderingGroupId === WEAPON_RENDER_GROUP)
      && (m.material?.alpha ?? 1) >= .99);
    for (const m of this.occluders) this.mask.setMaterialForRendering(m, this.world);
  }
  set(meshes: readonly AbstractMesh[], friendly: boolean, visible: boolean): void {
    for (const mesh of meshes) {
      if (!visible) this.players.delete(mesh);
      else { this.players.set(mesh, friendly); this.mask.setMaterialForRendering(mesh, friendly ? this.blue : this.red); }
    }
  }
  remove(meshes: readonly AbstractMesh[]): void { for (const mesh of meshes) this.players.delete(mesh); }
  update(enabled: boolean): void {
    // Default/SSAO pipelines can rebuild again after a quality change. Repair
    // ordering only when needed, before this frame's camera pass is prepared.
    if (this.camera._postProcesses.filter((p) => p !== null).at(-1) !== this.composite) this.keepLast();
    this.enabled = enabled && this.players.size > 0;
    const targets = this.scene.customRenderTargets;
    const index = targets.indexOf(this.mask);
    if (this.enabled) {
      this.mask.renderList = [...this.occluders, ...this.players.keys()];
      if (index < 0) targets.push(this.mask);
    } else {
      if (index >= 0) targets.splice(index, 1);
      this.mask.renderList = [];
    }
  }
  has(meshes: readonly AbstractMesh[]): boolean { return this.enabled && meshes.some((m) => this.players.has(m)); }
  keepLast(): void {
    // Quality changes rebuild the default pipeline; the contour must follow
    // bloom/sharpen/AA so those effects never turn it into a glow or wide halo.
    this.camera.detachPostProcess(this.composite);
    this.camera.attachPostProcess(this.composite);
  }
  async interiorPixels(): Promise<{ x: number; y: number }[]> {
    const pixels = await this.mask.readPixels();
    if (!pixels) return [];
    const data = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const { width, height } = this.mask.getSize();
    const canvas = this.scene.getEngine().getRenderingCanvas()!;
    const points: { x: number; y: number }[] = [];
    // Actual GPU mask probes several pixels inside the union, including seams.
    const filled = (x: number, y: number) => Math.max(Number(data[(y * width + x) * 4]), Number(data[(y * width + x) * 4 + 2])) > 127;
    for (let y = 4; y < height - 4; y += 3) for (let x = 4; x < width - 4; x += 3) {
      if (filled(x, y) && [-4, 0, 4].every((dy) => [-4, 0, 4].every((dx) => filled(x + dx, y + dy))))
        points.push({ x: Math.floor(x / width * canvas.clientWidth), y: Math.floor((height - 1 - y) / height * canvas.clientHeight) });
    }
    return points;
  }
  inspect() { return { enabled: this.enabled, players: this.players.size, occluders: this.occluders.length, size: this.mask.getSize(), passes: 1,
    last: this.camera._postProcesses.filter((p) => p !== null).at(-1) === this.composite,
    chain: this.camera._postProcesses.filter((p) => p !== null).map((p) => p.name) }; }
  clear(): void { this.players.clear(); this.occluders = []; this.update(false); this.mask.renderList = []; }
  dispose(): void { this.clear(); this.composite.dispose(); this.mask.dispose(); this.world.dispose(); this.red.dispose(); this.blue.dispose(); }
}
