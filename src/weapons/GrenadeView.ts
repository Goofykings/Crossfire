import { Color3, Color4, Scene as BabylonScene, MeshBuilder, SolidParticleSystem, StandardMaterial, Texture, TransformNode,
  Vector3, type AssetContainer, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { loadContainer } from '../core/loadContainer';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import { advanceGrenade, type GrenadeExplosion, type GrenadeState } from '../../shared/grenades';
import { GRENADE_SMOKE_MS } from '../../shared/grenades';
import { smokeEnvelope, smokeRadius, smokeInterior, smokeObscures } from './grenadeSmoke';
import type { CollisionWorld } from '../physics/CollisionWorld';

/** Shared GLB plus two bounded billboard batches; effects never change damage or physics. */
export class GrenadeView {
  private container: AssetContainer | null = null;
  private readonly objects = new Map<string, { root: TransformNode; state: GrenadeState; smoke: number; authority: number }>();
  private readonly particles: SolidParticleSystem;
  private readonly material: StandardMaterial;
  private readonly lives = Array.from({ length: 128 }, () => ({ age: 0, born: 0, life: 0, size: 0, flash: false, debris: false, velocity: Vector3.Zero() }));
  private cursor = 0;
  private reduced = false;
  private readonly clouds = new Map<string, GrenadeExplosion>();
  private readonly seen = new Set<string>();
  private serverTime = 0;
  private fog: { mode: number; density: number; color: Color3 } | null = null;
  private readonly before;
  private readonly after;
  private inside = 0;
  private readonly cloudParticles: SolidParticleSystem;
  private readonly cloudMaterial: StandardMaterial;
  constructor(private readonly scene: Scene) {
    this.material = new StandardMaterial('grenade-fx', scene);
    this.material.diffuseTexture = new Texture(assetUrl('assets/textures/shared/fx/glow.png'), scene);
    this.material.diffuseTexture.hasAlpha = true;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.disableLighting = true; this.material.emissiveColor = Color3.White();
    this.material.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane('grenade-fx-source', { size: 1 }, scene);
    this.particles = new SolidParticleSystem('grenade-fx-batch', scene, { updatable: true });
    this.particles.addShape(plane, this.lives.length); plane.dispose();
    this.particles.billboard = true;
    const mesh = this.particles.buildMesh(); mesh.material = this.material;
    mesh.hasVertexAlpha = true; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
    for (const p of this.particles.particles) { p.scaling.setAll(0); p.color = new Color4(1, 1, 1, 0); }
    this.particles.setParticles();
    this.cloudMaterial = this.material.clone('grenade-smoke');
    this.cloudMaterial.fogEnabled = false;
    const source = MeshBuilder.CreatePlane('smoke-source', { size: 1 }, scene);
    this.cloudParticles = new SolidParticleSystem('smoke-clouds', scene, { updatable: true });
    this.cloudParticles.addShape(source, 12 * 32); source.dispose();
    this.cloudParticles.billboard = true;
    const clouds = this.cloudParticles.buildMesh(); clouds.material = this.cloudMaterial;
    clouds.hasVertexAlpha = true; clouds.isPickable = false; clouds.alwaysSelectAsActiveMesh = true;
    for (const p of this.cloudParticles.particles) { p.scaling.setAll(0); p.color = new Color4(.43, .45, .47, 0); }
    this.cloudParticles.setParticles();
    // Depth-dependent fog only while physically inside a cloud, blended at its
    // boundary. Near objects remain visible; this is never an opaque HUD overlay.
    // Restore map fog after every render, including graphics/map changes.
    this.before = scene.onBeforeRenderObservable.add(() => {
      if (this.inside <= .001) return;
      this.fog = { mode: scene.fogMode, density: scene.fogDensity, color: scene.fogColor.clone() };
      scene.fogMode = BabylonScene.FOGMODE_EXP2;
      scene.fogDensity = Math.max(scene.fogDensity, this.inside * .95);
      scene.fogColor = Color3.Lerp(scene.fogColor, new Color3(.43, .45, .47), this.inside);
    });
    this.after = scene.onAfterRenderObservable.add(() => this.restoreFog());
  }
  private restoreFog(): void {
    if (!this.fog) return;
    this.scene.fogMode = this.fog.mode; this.scene.fogDensity = this.fog.density;
    this.scene.fogColor = this.fog.color; this.fog = null;
  }
  setReduced(value: boolean): void { this.reduced = value; }
  async load(materials: MaterialLibrary, signal?: AbortSignal): Promise<void> {
    this.container = await loadContainer(assetUrl('assets/models/shared/weapons/grenade.glb'), this.scene, signal);
    for (const mesh of this.container.meshes) if (mesh.material) mesh.material = materials.get(mesh.material.name);
  }
  sync(states: GrenadeState[]): void {
    const ids = new Set(states.map((g) => g.id));
    for (const [id, object] of this.objects) if (!ids.has(id)) { object.root.dispose(); this.objects.delete(id); }
    for (const g of states) {
      let object = this.objects.get(g.id);
      if (!object && this.container) {
        const entries = this.container.instantiateModelsToScene((name) => `grenade:${g.id}:${name}`, false);
        const root = new TransformNode(`grenade:${g.id}`, this.scene);
        for (const node of entries.rootNodes) node.parent = root;
        for (const mesh of root.getChildMeshes()) mesh.isPickable = false;
        object = { root, state: structuredClone(g), smoke: 0, authority: g.updatedAt }; this.objects.set(g.id, object);
      }
      if (object) { object.state = structuredClone(g); object.authority = g.updatedAt; }
    }
  }
  explode(event: GrenadeExplosion, serverTime = event.at): void {
    if (this.seen.has(event.id) || serverTime - event.at >= GRENADE_SMOKE_MS) return;
    this.seen.add(event.id);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    this.clouds.set(event.id, structuredClone(event));
    if (this.clouds.size > 12) this.clouds.delete(this.clouds.keys().next().value!);
    const object = this.objects.get(event.grenadeId);
    object?.root.dispose(); this.objects.delete(event.grenadeId);
    // Expand the brief flash/burst separately from the seven-second smoke;
    // presentation sizes never change the authoritative blast radius.
    if (serverTime - event.at > 300) return; // Do not replay expired flash/debris on resume.
    const scale = 4;
    for (let i = 0; i < 5; i++) this.emit(event.position, .35, .035 * scale, false,
      new Vector3((Math.random() - .5) * 5, 2 + Math.random() * 2, (Math.random() - .5) * 5).scaleInPlace(scale), true);
    for (let i = 0; i < 18; i++) {
      const flash = i < 2;
      this.emit(event.position, flash ? .19 : .55 + Math.random() * .25, (flash ? .75 : .16) * scale,
        flash, new Vector3((Math.random() - .5) * 3, Math.random() * 2, (Math.random() - .5) * 3).scaleInPlace(scale));
    }
  }
  private emit(at: { x: number; y: number; z: number }, life: number, size: number, flash: boolean, velocity: Vector3, debris = false): void {
    const index = this.cursor++ % this.lives.length, p = this.particles.particles[index], data = this.lives[index];
    Object.assign(data, { age: 0, born: performance.now() / 1000, life, size, flash, velocity, debris });
    p.position.copyFromFloats(at.x, at.y, at.z); p.scaling.setAll(size);
    p.color!.set(flash ? 1 : .35, flash ? .72 : .36, flash ? .25 : .37, flash ? .8 : .24);
  }
  update(dt: number, serverTime: number, world: CollisionWorld): void {
    for (const object of this.objects.values()) {
      // At most 100ms prediction between authoritative 20Hz snapshots; never advance the server fuse.
      advanceGrenade(object.state, Math.min(serverTime, object.authority + 100), world);
      const p = object.state.position; object.root.position.set(p.x, p.y, p.z);
      object.root.rotation.x += dt * Math.min(5, Math.hypot(object.state.velocity.x, object.state.velocity.z));
      object.smoke -= dt;
      if (object.smoke <= 0 && serverTime < object.state.explodeAt) {
        object.smoke = this.reduced ? .14 : .07; this.emit(p, 1.4, .24, false, new Vector3(0, .40, 0));
      }
    }
    const now = performance.now() / 1000;
    for (let i = 0; i < this.lives.length; i++) {
      const data = this.lives[i], p = this.particles.particles[i];
      if (!data.life) continue;
      // A server event may arrive between frames: do not age it by time before its birth.
      const previousAge = data.age;
      data.age = Math.max(0, now - data.born);
      const elapsed = data.age - previousAge;
      if (data.age >= data.life) { data.life = 0; p.scaling.setAll(0); p.color!.a = 0; continue; }
      if (data.debris) data.velocity.y -= 20 * elapsed;
      p.position.addInPlaceFromFloats(data.velocity.x * elapsed, data.velocity.y * elapsed, data.velocity.z * elapsed);
      const t = data.age / data.life;
      p.scaling.setAll(data.size * (1 + t * (data.flash ? .6 : data.debris ? 0 : 2)));
      p.color!.a = (data.flash ? .8 : .24) * (1 - t) ** 2;
    }
    this.particles.setParticles();
    this.serverTime = serverTime;
    this.inside = 0;
    const eye = this.scene.activeCamera?.globalPosition;
    let slot = 0;
    for (const [id, cloud] of this.clouds) {
      const age = serverTime - cloud.at;
      if (age >= GRENADE_SMOKE_MS) { this.clouds.delete(id); continue; }
      const radius = smokeRadius(age), opacity = smokeEnvelope(age);
      if (eye) this.inside = Math.max(this.inside, smokeInterior(Vector3.Distance(eye, new Vector3(cloud.position.x, cloud.position.y + 1, cloud.position.z)), age));
      // Deterministic world-space spiral: same cloud volume for all peers and
      // reduced effects. Fewer, larger sprites keep the same obscuring coverage.
      const count = this.reduced ? 16 : 32;
      let seed = 2166136261;
      for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
      const phase = (seed >>> 0) / 4294967296 * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const p = this.cloudParticles.particles[slot++], angle = phase + i * 2.399963;
        const r = radius * Math.sqrt((i + .5) / count) * .76;
        p.position.set(cloud.position.x + Math.cos(angle) * r, cloud.position.y + .5 + (i % 5) * .42 + Math.max(0, age) * (.00008 + (i % 7) * .000015), cloud.position.z + Math.sin(angle) * r);
        p.scaling.setAll((.85 + .3 * Math.abs(Math.sin(phase + i * 13.7))) * (this.reduced ? 3.8 : 2.9) * (.55 + .45 * Math.min(1, age / 500)));
        p.color!.set(.43, .45, .47, opacity * (.85 + .15 * Math.abs(Math.sin(phase + i * 9.1))) * (this.reduced ? .78 : .65));
      }
    }
    for (; slot < this.cloudParticles.nbParticles; slot++) { const p = this.cloudParticles.particles[slot]; p.scaling.setAll(0); p.color!.a = 0; }
    this.cloudParticles.setParticles();
  }
  obscures(from: Vector3, to: Vector3): boolean {
    return [...this.clouds.values()].some(c => smokeObscures(from, to, c.position, this.serverTime - c.at));
  }
  inspect() {
    const mesh=this.particles.mesh;
    return { clouds: [...this.clouds.values()].map(c => ({ id:c.id, age:this.serverTime-c.at, opacity:smokeEnvelope(this.serverTime-c.at), position:c.position })), inside:this.inside, reduced:this.reduced, cloudBudget:this.cloudParticles.nbParticles, projectiles: this.objects.size, particles: this.lives.filter((p) => p.life > 0).length,
      rendering: { active:this.scene.getActiveMeshes().data.includes(mesh),enabled:mesh.isEnabled(),visible:mesh.isVisible,
        ready:mesh.isReady(),alpha:mesh.hasVertexAlpha,texture:this.material.diffuseTexture?.isReady(),disposed:mesh.isDisposed(),
        blending:this.material.needAlphaBlendingForMesh(mesh),vertices:mesh.getTotalVertices() },
      samples:this.lives.flatMap((data,i)=>data.life>0?[{age:data.age,flash:data.flash,position:this.particles.particles[i].position.asArray(),
        color:this.particles.particles[i].color?.asArray(),size:this.particles.particles[i].scaling.x}]:[]).slice(-24) };
  }
  clear(): void {
    this.clouds.clear(); this.seen.clear(); this.inside = 0; this.restoreFog();
    for (const p of this.cloudParticles.particles) { p.scaling.setAll(0); p.color!.a = 0; }
    this.cloudParticles.setParticles();
    for (const object of this.objects.values()) object.root.dispose(); this.objects.clear();
    for (const p of this.lives) p.life = 0;
    for (const p of this.particles.particles) { p.scaling.setAll(0); p.color!.a = 0; }
    this.particles.setParticles();
  }
  dispose(): void { this.clear(); this.scene.onBeforeRenderObservable.remove(this.before); this.scene.onAfterRenderObservable.remove(this.after);
    this.container?.dispose(); this.cloudParticles.dispose(); this.cloudMaterial.dispose(); this.particles.dispose(); this.material.dispose(true, true); }
}
