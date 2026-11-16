import type { MapDefinition, MapLayout } from '../types';
import layout from './layout.json';

/**
 * Neon Backstreets: a compact, rainy night-time city block for 1v1 and small free-for-alls. Neon Street, a back alley,
 * two side lanes, a central crossing, a walk-through 24/7 Mart, a two-storey ramen shop with a balcony, a laundromat and a
 * hostel block with an underpass and a roof terrace.
 * Layout source: tools/layout_neon.py + tools/neon_structures.py + tools/neon_dressing.py -> layout.json; models:
 * blender/scripts/generate_all.py (stage "neon"); textures and night sky: tools/make_neon_textures.py. See docs/NEON_BACKSTREETS.md.
 */
export const NEON_BACKSTREETS: MapDefinition = {
  id: 'neon-backstreets',
  name: 'Neon Backstreets',
  description: 'A rain-soaked city block at night: lantern alleys, neon shopfronts, a ringed plaza under a ramen balcony and a roof terrace.',
  briefing:
    'Free for all: shotguns and SMGs own the shops and alleys, rifles the plaza and Neon Street. Two balconies face off over the plaza; lit strips mark every stair. Headshots deal 1.5x damage.',
  thumbnail: 'assets/maps/neon-backstreets/thumb.jpg',
  assetPath: 'assets/models/neon-backstreets/',
  layout: layout as unknown as MapLayout,
  assetIndex: 'map-assets.json',
  dimensions: [40, 40],
  environment: {
    hdr: 'assets/env/sky_neon_1k.hdr',
    skyImage: 'assets/env/sky_neon_2k.jpg',
    // the generated night sky has no sun disc: the moonlight direction is free (tools/make_neon_textures.py)
    hdriSunHeading: 140,
    sunHeading: 140,
    sunElevation: 38,
    sunColor: [0.62, 0.7, 1.0],
    // enough moon and sky fill that players stay readable in the darkest lane corners
    sunIntensity: 0.75,
    environmentIntensity: 1.55,
    fogColor: [0.1, 0.085, 0.2],
    fogDensity: 0.0115,
    exposure: 1.2,
    contrast: 1.16,
    // Chromebook mode: a dim violet night fill instead of the daytime hemisphere (the neon is self-lit and baked)
    lowSpecAmbient: { intensity: 0.3, sky: [0.5, 0.48, 0.85], ground: [0.16, 0.12, 0.2] },
  },
  collision: { killY: -20 },
  tactical: {
    // callouts (2026-11-15 overhaul): every zone is named after what a player sees there
    landmarks: {
      neon_street: 'Neon Street',
      east_lane: 'Karaoke Lane',
      west_lane: 'Vending Lane',
      west_lane_south: 'Laundry Lane',
      noodle_alley: 'Lantern Alley',
      back_alley: 'Loading Alley',
      crossing: 'Plaza',
      under_balcony: 'Balcony Arcade',
      market_court: 'Market Court',
      mart_floor: '24/7 Mart',
      ramen_floor: 'Ramen',
      laundry_floor: 'Laundromat',
      underpass: 'Tiled Underpass',
    },
  },
};
