import type { GraphicsQuality, ShadowQuality } from '../config/settings';

export interface GraphicsPreset {
  msaa: number;
  fxaa: boolean;
  bloom: boolean;
  sharpen: boolean;
  ssao: boolean;
  anisotropy: number;
  fog: boolean;
  /** Static geometry batching cell size (m); larger = fewer draw calls, coarser culling. */
  batchCell: number;
}

export const GRAPHICS_PRESETS: Record<GraphicsQuality, GraphicsPreset> = {
  low: { msaa: 1, fxaa: true, bloom: false, sharpen: false, ssao: false, anisotropy: 2, fog: true, batchCell: 40 },
  medium: { msaa: 2, fxaa: true, bloom: true, sharpen: false, ssao: false, anisotropy: 4, fog: true, batchCell: 40 },
  high: { msaa: 4, fxaa: false, bloom: true, sharpen: true, ssao: true, anisotropy: 8, fog: true, batchCell: 40 },
};

export interface ShadowPreset {
  enabled: boolean;
  /**
   * 'static': one shadow map covering the whole map, rendered once (the sun and the town never
   * move), so shadows cost almost nothing per frame. 'cascaded': per-frame cascaded shadow maps
   * that also include moving objects such as tipping targets.
   */
  mode: 'static' | 'cascaded';
  mapSize: number;
  cascades: number;
  filtering: 'low' | 'medium' | 'high';
  maxZ: number;
}

export const SHADOW_PRESETS: Record<ShadowQuality, ShadowPreset> = {
  off: { enabled: false, mode: 'static', mapSize: 512, cascades: 1, filtering: 'low', maxZ: 60 },
  low: { enabled: true, mode: 'static', mapSize: 2048, cascades: 1, filtering: 'low', maxZ: 60 },
  medium: { enabled: true, mode: 'static', mapSize: 4096, cascades: 1, filtering: 'medium', maxZ: 80 },
  high: { enabled: true, mode: 'cascaded', mapSize: 2048, cascades: 3, filtering: 'high', maxZ: 90 },
};
