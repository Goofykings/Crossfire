import { Color4, ParticleSystem, Texture, Vector3, type Particle, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import type { RainSpec, Rect } from '../maps/types';

const inside = (r: Rect, x: number, z: number) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];

/**
 * Cosmetic rain around the active camera (Neon Backstreets). One bounded CPU particle system of stretched additive
 * streaks: drops spawn only outside roofed footprints and each one's lifetime ends exactly on the surface below it,
 * so nothing falls through a ceiling or a deck. A second small system throws short splash sprays where drops land
 * (half of them on puddles), and a third lets heavy drops fall from dripping edges (balcony, kiosk roof, awnings).
 * Chromebook mode keeps about a quarter of the drops and no splashes or drips; reduced motion turns it all off. No gameplay, network or collision involvement.
 */
export class Rain {
  private readonly system: ParticleSystem;
  private readonly splash: ParticleSystem;
  private readonly drips: ParticleSystem | null = null;
  private readonly texture: Texture;
  private readonly observer;
  private disposed = false;
  private static readonly SPEED = 13;
  private static readonly RADIUS = 13;
  private static readonly HEIGHT = 9;
  private static readonly SPLASH_RADIUS = 10;

  constructor(private readonly scene: Scene, private readonly spec: RainSpec, private readonly lowSpec: () => boolean) {
    this.texture = new Texture(assetUrl('assets/textures/neon-backstreets/glow_soft.png'), scene, true, false);
    const ps = new ParticleSystem('rain', 2000, scene);
    ps.particleTexture = this.texture;
    ps.emitter = new Vector3();
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.minSize = ps.maxSize = .035;
    ps.minScaleX = .45; ps.maxScaleX = .6;
    ps.minScaleY = 12; ps.maxScaleY = 17;
    ps.color1 = new Color4(.42, .46, .62, .55);
    ps.color2 = new Color4(.55, .5, .7, .45);
    ps.colorDead = new Color4(.42, .46, .62, .4);
    ps.direction1 = new Vector3(.06, -1, .03);
    ps.direction2 = new Vector3(.1, -1, .06);
    ps.minEmitPower = ps.maxEmitPower = Rain.SPEED;
    ps.minLifeTime = ps.maxLifeTime = .7;
    ps.updateSpeed = 1 / 60;
    ps.isLocal = false;
    ps.startPositionFunction = (world, position, particle) => this.spawn(world.m[12], world.m[13], world.m[14], position, particle);
    ps.renderingGroupId = 0;
    ps.start();
    this.system = ps;

    // splashes: tiny stretched sprays that leap off the ground and fall back within a fifth of a second
    const sp = new ParticleSystem('rain-splash', 700, scene);
    sp.particleTexture = this.texture;
    sp.emitter = new Vector3();
    sp.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    sp.blendMode = ParticleSystem.BLENDMODE_ADD;
    sp.minSize = .03; sp.maxSize = .05;
    sp.minScaleX = .5; sp.maxScaleX = .8;
    sp.minScaleY = 2.4; sp.maxScaleY = 4;
    sp.color1 = new Color4(.7, .78, 1, .7);
    sp.color2 = new Color4(.9, .7, 1, .55);
    sp.colorDead = new Color4(.6, .65, .9, 0);
    sp.direction1 = new Vector3(-.4, 1, -.4);
    sp.direction2 = new Vector3(.4, 1, .4);
    sp.minEmitPower = .9; sp.maxEmitPower = 1.9;
    sp.gravity = new Vector3(0, -9.5, 0);
    sp.minLifeTime = .12; sp.maxLifeTime = .26;
    sp.updateSpeed = 1 / 60;
    sp.isLocal = false;
    sp.startPositionFunction = (world, position) => this.spawnSplash(world.m[12], world.m[14], position);
    sp.renderingGroupId = 0;
    sp.start();
    this.splash = sp;
    // drips: a few heavy drops that gather on an edge and fall straight down (world-space emitter; gravity does the work)
    const edges = spec.drips ?? [];
    if (edges.length) {
      const total = edges.reduce((n, e) => n + Math.hypot(e[2] - e[0], e[3] - e[1]), 0);
      const dr = new ParticleSystem('rain-drips', 160, scene);
      dr.particleTexture = this.texture;
      dr.emitter = new Vector3();
      dr.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
      dr.blendMode = ParticleSystem.BLENDMODE_ADD;
      dr.minSize = .04; dr.maxSize = .055;
      dr.minScaleX = .5; dr.maxScaleX = .7;
      dr.minScaleY = 3; dr.maxScaleY = 5;
      dr.color1 = new Color4(.75, .82, 1, .8);
      dr.color2 = new Color4(.9, .8, 1, .7);
      dr.colorDead = new Color4(.7, .76, 1, .6);
      dr.direction1 = new Vector3(0, -1, 0);
      dr.direction2 = new Vector3(0, -1, 0);
      dr.minEmitPower = dr.maxEmitPower = .3;
      dr.gravity = new Vector3(0, -9.8, 0);
      dr.updateSpeed = 1 / 60;
      dr.isLocal = false;
      dr.startPositionFunction = (_world, position, particle) => {
        // pick an edge by length so the drops spread evenly
        let t = Math.random() * total, e = edges[0];
        for (const edge of edges) { const len = Math.hypot(edge[2] - edge[0], edge[3] - edge[1]); if (t <= len) { e = edge; break; } t -= len; }
        const k = Math.random(), x = e[0] + (e[2] - e[0]) * k, z = e[1] + (e[3] - e[1]) * k;
        position.set(x, e[4], z);
        // 0.3 m/s start: the fall time from the edge to the surface below
        const h = Math.max(.1, e[4] - this.floorAt(x, z));
        particle.lifeTime = (-.3 + Math.sqrt(.09 + 2 * 9.8 * h)) / 9.8;
      };
      dr.renderingGroupId = 0;
      dr.emitRate = Math.min(70, total * 1.6);
      dr.start();
      this.drips = dr;
    }
    this.observer = scene.onBeforeRenderObservable.add(() => this.follow());
  }

  private floorAt(x: number, z: number): number {
    const deck = this.spec.decks.find(([r]) => inside(r, x, z));
    return deck ? deck[1] : this.spec.raised.some((r) => inside(r, x, z)) ? .15 : 0;
  }

  private spawn(cx: number, cy: number, cz: number, position: Vector3, particle: Particle): void {
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = cx + (Math.random() * 2 - 1) * Rain.RADIUS, z = cz + (Math.random() * 2 - 1) * Rain.RADIUS;
      if (this.spec.roofs.some((r) => inside(r, x, z))) continue;
      const floor = this.floorAt(x, z);
      const y = Math.max(cy, floor) + 1.5 + Math.random() * Rain.HEIGHT;
      position.set(x, y, z);
      particle.lifeTime = (y - floor) / Rain.SPEED;
      return;
    }
    position.set(cx, -50, cz);
    particle.lifeTime = 0;
  }

  private spawnSplash(cx: number, cz: number, position: Vector3): void {
    const puddles = this.spec.puddles;
    for (let attempt = 0; attempt < 5; attempt++) {
      let x: number, z: number;
      const p = puddles && puddles.length && Math.random() < .55 ? puddles[Math.floor(Math.random() * puddles.length)] : null;
      if (p) {
        if (Math.abs(p[0] - cx) > Rain.SPLASH_RADIUS || Math.abs(p[1] - cz) > Rain.SPLASH_RADIUS) continue;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
        x = p[0] + Math.cos(a) * p[2] * r; z = p[1] + Math.sin(a) * p[3] * r;
      } else {
        x = cx + (Math.random() * 2 - 1) * Rain.SPLASH_RADIUS; z = cz + (Math.random() * 2 - 1) * Rain.SPLASH_RADIUS;
      }
      if (this.spec.roofs.some((r) => inside(r, x, z))) continue;
      position.set(x, this.floorAt(x, z) + (p ? .02 : .01), z);
      return;
    }
    position.set(cx, -50, cz);
  }

  private follow(): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const low = this.lowSpec();
    (this.system.emitter as Vector3).copyFrom(cam.globalPosition);
    (this.splash.emitter as Vector3).copyFrom(cam.globalPosition);
    // ~0.7 s of flight: 2400/s keeps about 1700 drops in the air; Chromebook mode about 450 and no splashes
    this.system.emitRate = low ? 650 : 2400;
    this.splash.emitRate = low ? 0 : 340;
    if (this.drips) { if (low && this.drips.isStarted()) this.drips.stop(); else if (!low && !this.drips.isStarted()) this.drips.start(); }
  }

  static reducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.system.dispose(false);
    this.splash.dispose(false);
    this.drips?.dispose(false);
    this.texture.dispose();
  }
}
