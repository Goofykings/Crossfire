import { Color3, Color4, Constants, MeshBuilder, PointLight, SolidParticleSystem, StandardMaterial, Texture, Vector3, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import { meshesReady } from '../core/assetReadiness';
import type { GrenadeExplosion } from '../../shared/grenades';
import { burstEnvelope } from './burstEnvelope';

/** Four reusable bursts, two shadowless lights and two billboard draw calls. */
export class ExplosionBurst {
  private readonly slots: (GrenadeExplosion | null)[] = Array(4).fill(null);
  private cursor = 0;
  private readonly fire: SolidParticleSystem;
  private readonly glow: SolidParticleSystem;
  private readonly materials: StandardMaterial[] = [];
  private readonly lights: PointLight[];
  private readonly rings;
  constructor(private readonly scene: Scene) {
    const texture = new Texture(assetUrl('assets/textures/shared/fx/glow.png'), scene);
    texture.hasAlpha = true;
    const batch = (name: string, count: number, additive: boolean) => {
      const material = new StandardMaterial(name, scene);
      material.diffuseTexture = texture; material.useAlphaFromDiffuseTexture = true;
      material.disableLighting = true; material.emissiveColor = Color3.White();
      material.backFaceCulling = false; material.disableDepthWrite = true;
      material.alphaMode = additive ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE;
      this.materials.push(material);
      const source = MeshBuilder.CreatePlane(`${name}-source`, { size: 1 }, scene);
      const sps = new SolidParticleSystem(name, scene, { updatable: true });
      sps.addShape(source, count); source.dispose(); sps.billboard = true;
      const mesh = sps.buildMesh(); mesh.material = material; mesh.hasVertexAlpha = true;
      mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
      mesh.alphaIndex = additive ? 22 : 21;
      for (const p of sps.particles) { p.scaling.setAll(0); p.color = new Color4(1, 1, 1, 0); }
      sps.setParticles();mesh.setEnabled(false);return sps;
    };
    this.fire = batch('explosion-fire', 4 * 8, false);
    this.glow = batch('explosion-additive', 4 * 32, true);
    const ringMat = new StandardMaterial('explosion-shockwave', scene);
    ringMat.disableLighting = true; ringMat.diffuseColor = Color3.Black(); ringMat.emissiveColor = new Color3(1, .3, .04);
    ringMat.alphaMode = Constants.ALPHA_ADD; ringMat.disableDepthWrite = true;
    this.materials.push(ringMat);
    this.rings = Array.from({ length: 4 }, (_, i) => {
      const ring = MeshBuilder.CreateTorus(`explosion-ring:${i}`, { diameter: 1, thickness: .018, tessellation: 40 }, scene);
      ring.alphaIndex = 23; ring.material = ringMat; ring.isPickable = false; ring.visibility = 0; return ring;
    });
    this.lights = Array.from({ length: 2 }, (_, i) => {
      const light = new PointLight(`explosion-light:${i}`, new Vector3(0, -100, 0), scene);
      light.diffuse = new Color3(1, .48, .12); light.specular = new Color3(1, .7, .3);
      light.range = 9; light.renderPriority = -10; light.intensity = 0; light.shadowEnabled = false; return light;
    });
  }
  ready(signal?: AbortSignal): Promise<void> { return meshesReady([this.fire.mesh, this.glow.mesh, ...this.rings], signal); }
  explode(event: GrenadeExplosion, now: number): void {
    if (now - event.at >= 550) return;
    this.slots[this.cursor++ % this.slots.length] = structuredClone(event);
  }
  update(now: number, reduced: boolean, lighting=true): void {
    if(!this.slots.some(Boolean)&&!this.fire.mesh.isEnabled()&&!this.glow.mesh.isEnabled())return;
    const illumination: { id: string; position: Vector3; intensity: number }[] = [];
    this.slots.forEach((event, slot) => {
      const e = burstEnvelope(event ? now - event.at : 1000);
      if (event && e.age >= .55) this.slots[slot] = null;
      const position = event ? new Vector3(event.position.x, event.position.y + .45, event.position.z) : Vector3.Zero();
      const lobes = reduced ? 4 : 8, sparks = reduced ? 4 : 30;
      for (let i = 0; i < 8; i++) {
        const p = this.fire.particles[slot * 8 + i], angle = i * 2.399963 + slot;
        const radius = (.3 + (i % 3) * .25) * e.expansion;
        p.position.copyFrom(position).addInPlaceFromFloats(Math.cos(angle) * radius, (.15 + i % 3 * .32) * e.expansion, Math.sin(angle) * radius);
        p.scaling.setAll(i < lobes && e.fire > 0 ? (.85 + e.expansion * (2.1 + i % 3 * .35)) * (1 + e.age * .5) : 0);
        const core = i % 3 === 0;
        p.color!.set(1, core ? Math.max(.15, .65 - e.age) : .19, core ? .08 : .018, i < lobes ? e.fire * (core ? .92 : .8) : 0);
      }
      for (let i = 0; i < 32; i++) {
        const p = this.glow.particles[slot * 32 + i], core = i < 2;
        const angle = i * 2.399963 + slot, speed = 2 + i % 4;
        p.position.copyFrom(position);
        if (core) p.position.y += (i ? .5 : .2) * e.expansion;
        if (!core) p.position.addInPlaceFromFloats(Math.cos(angle) * speed * e.age, (2 + i % 3) * e.age - 5 * e.age ** 2, Math.sin(angle) * speed * e.age);
        p.scaling.setAll(core ? e.flash > 0 ? (i ? 1.2 : 2.8) + e.expansion * .9 : e.fire > 0 ? (i ? .8 : 1.3) + e.expansion * .5 : 0
          : i - 2 < sparks && e.sparks > 0 ? .055 + i % 3 * .015 : 0);
        p.color!.set(1, core ? e.flash > 0 ? .92 : .65 : .55, core ? e.flash > 0 ? .65 : .12 : .08,
          core ? Math.max(e.flash * .85, e.fire * (i ? .4 : .7)) : i - 2 < sparks ? e.sparks : 0);
      }
      const ring = this.rings[slot];
      ring.position.copyFrom(position); ring.position.y = (event?.position.y ?? 0) + .06; ring.scaling.setAll(.3 + e.expansion * 6.2);
      ring.visibility = e.ring * (reduced ? .15 : .3);
      if (lighting && event && e.light > 0) illumination.push({ id: event.id, position, intensity: e.light * (reduced ? 1.3 : 3) });
    });
    illumination.sort((a, b) => b.intensity - a.intensity);
    this.lights.forEach((light, i) => {
      const source = illumination[i];
      light.intensity = source?.intensity ?? 0;
      // Do not let inactive flash lights displace permanent interior lights.
      light.renderPriority = source ? 1 : -10;
      if (!source) { light.metadata = null; return; }
      light.position.copyFrom(source.position);
      if (light.metadata !== source.id) {
        light.metadata = source.id;
        light.includedOnlyMeshes = this.scene.meshes.filter(mesh => {
          if (!mesh.isEnabled() || !mesh.getTotalVertices()) return false;
          const sphere = mesh.getBoundingInfo().boundingSphere;
          return Vector3.Distance(sphere.centerWorld, source.position) <= sphere.radiusWorld + light.range;
        });
      }
    });
    this.fire.mesh.setEnabled(this.slots.some(event => !!event && burstEnvelope(now - event.at).fire > 0));
    this.glow.mesh.setEnabled(this.slots.some(event => !!event && burstEnvelope(now - event.at).sparks > 0));
    this.fire.setParticles(); this.glow.setParticles();
  }
  inspect(now: number) { return { budget: 4, fireParticles: 32, additiveParticles: 128, lights: 2,
    visibleFire: this.fire.particles.filter(p => p.scaling.x > 0).length,
    visibleGlow: this.glow.particles.filter(p => p.scaling.x > 0).length,
    active: this.slots.flatMap(e => e ? [{ id: e.id, ...burstEnvelope(now - e.at) }] : []) }; }
  clear(): void {
    this.slots.fill(null);
    for (const light of this.lights){light.includedOnlyMeshes = [];light.intensity=0;light.metadata=null;}
    for(const ring of this.rings)ring.visibility=0;
    // Run the final clearing upload even when the pool was already sleeping.
    this.fire.mesh.setEnabled(true);
    this.update(0, false);
  }
  dispose(): void {
    this.fire.dispose(); this.glow.dispose(); this.rings.forEach(r => r.dispose());
    this.lights.forEach(l => l.dispose());
    this.materials[0].diffuseTexture?.dispose(); this.materials.forEach(m => m.dispose());
  }
}
