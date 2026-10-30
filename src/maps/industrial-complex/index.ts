import type { MapDefinition, MapLayout } from '../types';
import layout from './layout.json';

/**
 * Industrial Complex: packed warehouses, service alleys, loading docks and small storage yards.
 * Layout source: tools/layout_industrial.py -> layout.json; models: blender/scripts/generate_all.py (stage "industrial").
 */
export const INDUSTRIAL_COMPLEX: MapDefinition = {
  id: 'industrial-complex',
  name: 'Industrial Complex',
  description: 'Packed warehouses, loading docks, service alleys and walk-through halls.',
  briefing:
    'Free for all: clear the practice targets around the docks, alleys and warehouse halls. Headshots deal 1.5x damage.',
  thumbnail: 'assets/maps/industrial-complex/thumb.jpg',
  assetPath: 'assets/models/industrial-complex/',
  layout: layout as unknown as MapLayout,
  assetIndex: 'map-assets.json',
  dimensions: [54, 54],
  environment: {
    hdr: 'assets/env/sky_industrial_1k.hdr',
    skyImage: 'assets/env/sky_industrial_4k.jpg',
    // the sun sits at the same panorama longitude as European Town's sky (tools/find_sun.py: u = 0.600 vs 0.595)
    hdriSunHeading: 41,
    sunHeading: 205,
    sunElevation: 58.7,
    // slightly cool daylight under a hazy sky
    sunColor: [0.93, 0.95, 1.0],
    sunIntensity: 3.1,
    environmentIntensity: 1.15,
    fogColor: [0.68, 0.73, 0.8],
    fogDensity: 0.0046,
    exposure: 1.12,
    contrast: 1.08,
  },
  collision: { killY: -20 },
  tactical: {
    landmarks: {
      loading_square: 'Loading Square',
      warehouse_n: 'North Hall',
      warehouse_s: 'South Hall',
      utility_yard: 'Utility Yard',
      south_storage: 'Container Yard',
      workshop: 'Workshop',
      south_gallery_lane: 'Catwalk Lane',
    },
  },
};
