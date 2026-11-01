import { Color3, Color4, MeshBuilder, SolidParticleSystem, StandardMaterial, Texture, TransformNode,
  Vector3, type AssetContainer, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { loadContainer } from '../core/loadContainer';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import { advanceGrenade, type GrenadeExplosion, type GrenadeState } from '../../shared/grenades';
import type { CollisionWorld } from '../physics/CollisionWorld';

/** One shared GLB and one bounded billboard batch; effects never participate in physics. */
export class GrenadeView {
  private container: AssetContainer | null = null;
  private readonly objects = new Map<string, { root: TransformNode; state: GrenadeState; smoke: number; authority: number }>();
  private readonly particles: SolidParticleSystem;
  private readonly material: StandardMaterial;
  private readonly lives = Array.from({ length: 128 }, () => ({ age: 0, born: 0, life: 0, size: 0, flash: false, debris: false, velocity: Vector3.Zero() }));
  private cursor = 0;
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
  }
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
  explode(event: GrenadeExplosion): void {
    const object = this.objects.get(event.grenadeId);
    object?.root.dispose(); this.objects.delete(event.grenadeId);
    for (let i = 0; i < 5; i++) this.emit(event.position, .35, .035, false,
      new Vector3((Math.random() - .5) * 5, 2 + Math.random() * 2, (Math.random() - .5) * 5), true);
    for (let i = 0; i < 18; i++) {
      const flash = i < 2;
      this.emit(event.position, flash ? .19 : .55 + Math.random() * .25, flash ? .75 : .16,
        flash, new Vector3((Math.random() - .5) * 3, Math.random() * 2, (Math.random() - .5) * 3));
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
        object.smoke = .09; this.emit(p, .45, .10, false, new Vector3(0, .22, 0));
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
  }
  inspect() {
    const mesh=this.particles.mesh;
    return { projectiles: this.objects.size, particles: this.lives.filter((p) => p.life > 0).length,
      rendering: { active:this.scene.getActiveMeshes().data.includes(mesh),enabled:mesh.isEnabled(),visible:mesh.isVisible,
        ready:mesh.isReady(),alpha:mesh.hasVertexAlpha,texture:this.material.diffuseTexture?.isReady(),disposed:mesh.isDisposed(),
        blending:this.material.needAlphaBlendingForMesh(mesh),vertices:mesh.getTotalVertices() },
      samples:this.lives.flatMap((data,i)=>data.life>0?[{age:data.age,flash:data.flash,position:this.particles.particles[i].position.asArray(),
        color:this.particles.particles[i].color?.asArray(),size:this.particles.particles[i].scaling.x}]:[]).slice(-24) };
  }
  clear(): void {
    for (const object of this.objects.values()) object.root.dispose(); this.objects.clear();
    for (const p of this.lives) p.life = 0;
    for (const p of this.particles.particles) { p.scaling.setAll(0); p.color!.a = 0; }
    this.particles.setParticles();
  }
  dispose(): void { this.clear(); this.container?.dispose(); this.particles.dispose(); this.material.dispose(true, true); }
}
