import type { MapDefinition, MapLayout } from '../types';
import layout from './layout.json';

/**
 * Modern City: a tight downtown block of brick apartments, shops and offices with back alleys, courtyards and a plaza.
 * Layout source: tools/layout_city.py -> layout.json; models: blender/scripts/generate_all.py (stage "city").
 */
export const MODERN_CITY: MapDefinition = {
  id: 'modern-city',
  name: 'Modern City',
  description: 'Narrow streets, back alleys, corner shops and walk-through storefronts.',
  briefing:
    'Free for all: hunt the practice targets along the streets, alleys and courtyards. Headshots deal 1.5x damage.',
  thumbnail: 'assets/maps/modern-city/thumb.jpg',
  assetPath: 'assets/models/modern-city/',
  layout: layout as unknown as MapLayout,
  assetIndex: 'map-assets.json',
  dimensions: [68, 68],
  environment: {
    hdr: 'assets/env/sky_city_1k.hdr',
    skyImage: 'assets/env/sky_city_4k.jpg',
    // the sun sits at the same panorama longitude as European Town's sky (tools/find_sun.py: u = 0.600 vs 0.595)
    hdriSunHeading: 41,
    sunHeading: 195,
    sunElevation: 49.8,
    sunColor: [1.0, 0.96, 0.9],
    sunIntensity: 3.3,
    // a little extra sky light so the narrow alleys stay readable
    environmentIntensity: 1.2,
    fogColor: [0.72, 0.79, 0.88],
    fogDensity: 0.0036,
    exposure: 1.08,
    contrast: 1.1,
  },
  collision: { killY: -20 },
  tactical: {
    landmarks: {
      plaza: 'Plaza',
      blue_court: 'West Court',
      blue_courtr: 'East Court',
      spawn_blue: 'West Yard',
      spawn_bluer: 'East Yard',
      ne_court: 'Garden Court',
      ne_courtr: 'Garden Court',
      diner: 'Diner',
      dinerr: 'Diner',
      shop_n: 'Market',
      shop_nr: 'Market',
      n_road: 'North St',
      n_roadr: 'South St',
    },
  },
};
