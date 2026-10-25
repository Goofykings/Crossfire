import { DefaultRenderingPipeline, SSAO2RenderingPipeline, type Camera, type Scene } from '@babylonjs/core';
import type { GraphicsPreset } from './quality';

/** Anti-aliasing, bloom, sharpening and optional SSAO. Tone mapping stays in the materials. */
export class PostFX {
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  apply(p: GraphicsPreset): void {
    this.dispose();
    const pl = new DefaultRenderingPipeline('post', true, this.scene, [this.camera]);
    // keep image processing per-material so the display-referred sky can opt out of tone mapping
    pl.imageProcessingEnabled = false;
    pl.samples = p.msaa;
    pl.fxaaEnabled = p.fxaa;
    pl.bloomEnabled = p.bloom;
    if (p.bloom) {
      pl.bloomThreshold = 0.92;
      pl.bloomWeight = 0.22;
      pl.bloomKernel = 48;
      pl.bloomScale = 0.5;
    }
    pl.sharpenEnabled = p.sharpen;
    if (p.sharpen) {
      pl.sharpen.edgeAmount = 0.22;
      pl.sharpen.colorAmount = 1.0;
    }
    this.pipeline = pl;
    if (p.ssao) {
      try {
        const ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera]);
        ssao.radius = 0.9;
        ssao.totalStrength = 0.85;
        ssao.base = 0.12;
        ssao.samples = 12;
        ssao.maxZ = 60;
        ssao.expensiveBlur = false;
        this.ssao = ssao;
      } catch (e) {
        console.warn('SSAO unavailable', e);
      }
    }
  }

  dispose(): void {
    this.ssao?.dispose();
    this.ssao = null;
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
