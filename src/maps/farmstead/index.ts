import type { MapDefinition, MapLayout } from '../types';
import layout from './layout.json';

/**
 * Farmstead: an open rural yard (house, barn, cabin, garage, four open shacks, trees and crates inside a
 * gapped fence) over a close-quarters storm-shelter network.
 * Layout source: tools/layout_farm.py + tools/farm_structures.py -> layout.json; models: blender/scripts/generate_all.py
 * (stage "farm"). Plan: references_images/Newoutdoormap.png.
 */
export const FARMSTEAD: MapDefinition = {
  id: 'farmstead',
  name: 'Farmstead',
  description: 'Open yard and long sightlines on top, tight shelter tunnels below the barn, house and cabin.',
  briefing:
    'Free for all: take the long lanes above, the tunnels below. Rifles own the yard, shotguns and SMGs own the shelter. Headshots deal 1.5x damage.',
  thumbnail: 'assets/maps/farmstead/thumb.jpg',
  assetPath: 'assets/models/farmstead/',
  layout: layout as unknown as MapLayout,
  assetIndex: 'map-assets.json',
  dimensions: [74, 92],
  environment: {
    hdr: 'assets/env/sky_1k.hdr',
    skyImage: 'assets/env/sky_4k.jpg',
    // the town's panorama: its sun heading was measured with tools/dev-sun-sweep.mjs
    hdriSunHeading: 39,
    sunHeading: 205,
    sunElevation: 46,
    sunColor: [1.0, 0.95, 0.85],
    sunIntensity: 3.5,
    environmentIntensity: 1.05,
    fogColor: [0.72, 0.8, 0.88],
    fogDensity: 0.0034,
    exposure: 1.05,
    contrast: 1.1,
  },
  collision: { killY: -20 },
  tactical: {
    landmarks: {
      meadow: 'Meadow',
      south_gate_path: 'South Gate',
      garage_path: 'Garage Road',
      barn_path: 'Barn Road',
      cabin_path: 'Cabin Road',
      house_floor: 'Main House',
      barn_floor: 'Barn',
      cabin_floor: 'Cabin',
      garage_floor: 'Garage',
    },
  },
};
