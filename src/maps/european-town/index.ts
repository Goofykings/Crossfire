import type { MapDefinition, MapLayout } from '../types';
import layout from './layout.json';

/**
 * European Town: a compact, maze-like old town of stone and stucco houses.
 * Layout source: tools/layout_design.py -> layout.json; models: blender/scripts/generate_all.py.
 */
export const EUROPEAN_TOWN: MapDefinition = {
  id: 'european-town',
  name: 'European Town',
  description: 'Narrow cobbled lanes, arches and tiny courtyards between stone and stucco houses.',
  briefing: 'Free for all: find the practice targets hidden around the lanes. Headshots deal 1.5x damage.',
  thumbnail: 'assets/maps/european-town/thumb.jpg',
  assetPath: 'assets/models/european-town/',
  layout: layout as unknown as MapLayout,
  assetIndex: 'map-assets.json',
  dimensions: [66, 66],
  environment: {
    hdr: 'assets/env/sky_1k.hdr',
    skyImage: 'assets/env/sky_4k.jpg',
    // heading of the HDRI's sun with no sky rotation (measured with tools/dev-sun-sweep.mjs)
    hdriSunHeading: 39,
    // light the town from the south-south-west so both spawns get the same glare
    sunHeading: 200,
    sunElevation: 47.9,
    sunColor: [1.0, 0.94, 0.84],
    sunIntensity: 3.4,
    environmentIntensity: 1.0,
    fogColor: [0.72, 0.78, 0.86],
    fogDensity: 0.0042,
    exposure: 1.05,
    contrast: 1.12,
  },
  collision: { killY: -20 },
  tactical: {
    // labels for the Tab map, keyed by layout zone ids (positions come from the zones themselves)
    landmarks: {
      plaza: 'Well Plaza',
      spawn_blue: 'West Yard',
      spawn_bluer: 'East Yard',
      n_lane_mid: 'North Terrace',
      n_lane_midr: 'South Terrace',
      ne_court: 'NE Court',
      ne_courtr: 'SW Court',
      blue_yard: 'Gate Yard',
      blue_yardr: 'Gate Yard',
      cn_room: 'Hall',
      cn_roomr: 'Hall',
    },
  },
};
