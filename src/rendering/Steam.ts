import { Color4, ParticleSystem, Texture, Vector3, type Scene } from '@babylonjs/core';
import { assetUrl } from '../core/assets';
import type { SteamSpec } from '../maps/types';

/** The three tints a vent's puff can take: warm kitchen light, cool blue-white, neon magenta. */
const TINTS: readonly (readonly [number, number, number])[] = [[1, 0.78, 0.5], [0.5, 0.85, 1], [0.92, 0.45, 1]];

/**
 * Cosmetic steam (Neon Backstreets): a few vents (the ramen hatch, manholes, a dryer and a kitchen exhaust) breathe soft,
 * tinted puffs that rise and fade. Vents are grouped by tint into at most three small CPU particle systems (additive, no depth
 * write, depth tested so walls hide it), each picking a random vent of its group per puff, so the whole effect costs three draw
 * calls. Chromebook mode keeps the first two groups at half the rate; reduced motion creates none. No gameplay, network or
 * collision involvement; the puffs are faint enough that an enemy behind one stays readable.
 */
export class Steam {
  private readonly systems: ParticleSystem[] = [];
  private readonly texture: Texture;
  private disposed = false;

  constructor(scene: Scene, specs: readonly SteamSpec[], lowSpec: boolean) {
    this.texture = new Texture(assetUrl('assets/textures/neon-backstreets/smoke.png'), scene, true, false);
    const groups: SteamSpec[][] = TINTS.map(() => []);
    for (const s of specs) {
      let best = 0, bd = Infinity;
      TINTS.forEach((t, i) => {
        const d = (t[0] - s.col[0]) ** 2 + (t[1] - s.col[1]) ** 2 + (t[2] - s.col[2]) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      groups[best].push(s);
    }
    groups.forEach((vents, gi) => {
      if (!vents.length || (lowSpec && gi >= 2)) return;
      const rate = vents.reduce((n, v) => n + v.rate, 0) * (lowSpec ? 0.5 : 1);
      const rise = vents.reduce((n, v) => n + v.rise, 0) / vents.length;
      const size = vents.reduce((n, v) => n + v.size, 0) / vents.length;
      const ps = new ParticleSystem(`steam:${gi}`, Math.ceil(rate * 3.2) + 8, scene);
      ps.particleTexture = this.texture;
      ps.emitter = new Vector3();
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.startPositionFunction = (_world, position) => {
        const v = vents[Math.floor(Math.random() * vents.length)];
        position.set(v.p[0] + (Math.random() - 0.5) * 0.24, v.p[1], v.p[2] + (Math.random() - 0.5) * 0.24);
      };
      ps.direction1 = new Vector3(-0.12, 1, -0.12);
      ps.direction2 = new Vector3(0.12, 1, 0.12);
      ps.minLifeTime = 1.6;
      ps.maxLifeTime = 2.8;
      ps.minEmitPower = rise * 0.8;
      ps.maxEmitPower = rise * 1.3;
      ps.emitRate = rate;
      ps.minSize = size * 0.7;
      ps.maxSize = size * 1.15;
      ps.minAngularSpeed = -0.4;
      ps.maxAngularSpeed = 0.4;
      ps.addSizeGradient(0, 0.35);
      ps.addSizeGradient(1, 1.9);
      const [r, g, b] = TINTS[gi];
      ps.addColorGradient(0, new Color4(r, g, b, 0));
      ps.addColorGradient(0.25, new Color4(r, g, b, 0.2));
      ps.addColorGradient(1, new Color4(r, g, b, 0));
      ps.gravity = new Vector3(0.04, 0.02, 0);
      ps.updateSpeed = 1 / 60;
      ps.renderingGroupId = 0;
      ps.start();
      this.systems.push(ps);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.systems) s.dispose(false);
    this.texture.dispose();
  }
}
