"""Shared asset catalog: imported by the Blender generators AND by tools/layout_design.py.

Keep this file free of `bpy` imports so plain CPython can use it.

All sizes are metres. Props are modelled with their origin at the centre of their footprint on the
ground (y = 0), facing -Z in game space (i.e. their "front" looks north when yaw = 0).
`collider` is the simplified collision box (width x height x depth) the runtime uses; None means
the prop is purely decorative (players walk through / over it).
"""

BUILDING_TYPES = {
    "stone2": "Two-story stone townhouse",
    "plaster3": "Three-story plaster townhouse",
    "shop": "Small European shop building",
    "corner": "Corner building with an angled facade",
    "narrow_passage": "Narrow building with a passageway",
    "archway": "Building with an archway",
    "balcony": "Building with a small balcony",
    "room": "Building with an accessible ground-floor room",
    "backdrop": "Simplified perimeter building (seen only from a distance)",
}

# Facade palettes: wall material + tint, trim, roof, shutter/door paint. Colours are LINEAR RGB
# multipliers (as in Blender nodes and Babylon PBR), so paint values look darker than sRGB picks.
PALETTES = {
    "stone_warm": {"wall": "stone_stacked", "tint": [1.0, 0.97, 0.92], "trim": "stone_trim", "roof": "roof_tiles",
                   "shutter": [0.148, 0.043, 0.009], "door": [0.099, 0.029, 0.006]},
    "stone_grey": {"wall": "stone_rubble", "tint": [1.0, 1.0, 1.0], "trim": "stone_trim", "roof": "roof_tiles",
                   "shutter": [0.036, 0.087, 0.071], "door": [0.071, 0.023, 0.006]},
    "stone_blocks": {"wall": "stone_blocks", "tint": [1.0, 0.98, 0.95], "trim": "stone_trim", "roof": "roof_tiles_b",
                     "shutter": [0.268, 0.061, 0.009], "door": [0.047, 0.018, 0.005]},
    "plaster_white": {"wall": "plaster", "tint": [0.96, 0.94, 0.9], "trim": "stone_trim", "roof": "roof_tiles",
                      "shutter": [0.029, 0.106, 0.133], "door": [0.087, 0.029, 0.008]},
    "plaster_beige": {"wall": "plaster", "tint": [0.93, 0.84, 0.70], "trim": "stone_trim", "roof": "roof_tiles",
                      "shutter": [0.106, 0.036, 0.009], "door": [0.071, 0.020, 0.005]},
    "plaster_ochre": {"wall": "plaster", "tint": [0.95, 0.72, 0.42], "trim": "stone_trim", "roof": "roof_tiles_b",
                      "shutter": [0.047, 0.119, 0.071], "door": [0.061, 0.018, 0.004]},
    "plaster_rose": {"wall": "plaster", "tint": [0.93, 0.70, 0.60], "trim": "stone_trim", "roof": "roof_tiles",
                     "shutter": [0.082, 0.133, 0.173], "door": [0.071, 0.023, 0.006]},
    "plaster_red": {"wall": "plaster_red", "tint": [1.0, 0.95, 0.92], "trim": "stone_trim", "roof": "roof_tiles",
                    "shutter": [0.029, 0.071, 0.061], "door": [0.052, 0.015, 0.004]},
    "plaster_worn": {"wall": "plaster_worn", "tint": [1.0, 0.97, 0.92], "trim": "stone_trim", "roof": "roof_tiles_b",
                     "shutter": [0.173, 0.052, 0.011], "door": [0.082, 0.026, 0.006]},
    "brick_old": {"wall": "brick", "tint": [1.0, 0.96, 0.94], "trim": "stone_trim", "roof": "roof_tiles",
                  "shutter": [0.043, 0.071, 0.036], "door": [0.056, 0.018, 0.005]},
}

PROPS = {
    "crate": {"size": [0.8, 0.8, 0.8], "collider": [0.8, 0.8, 0.8]},
    "crate_small": {"size": [0.55, 0.55, 0.55], "collider": [0.55, 0.55, 0.55]},
    "crate_stack": {"size": [1.4, 1.35, 0.9], "collider": [1.4, 1.35, 0.9]},
    "barrel": {"size": [0.62, 0.9, 0.62], "collider": [0.6, 0.9, 0.6]},
    "barrel_group": {"size": [1.3, 0.9, 1.25], "collider": [1.3, 0.9, 1.2]},
    "flower_pot": {"size": [0.5, 0.75, 0.5], "collider": None},
    "flower_pot_large": {"size": [0.8, 1.2, 0.8], "collider": [0.7, 1.0, 0.7]},
    "bench": {"size": [1.6, 0.85, 0.5], "collider": [1.6, 0.5, 0.5]},
    "market_stall": {"size": [2.6, 2.6, 1.6], "collider": [2.6, 1.0, 1.4]},
    "street_lantern": {"size": [0.5, 3.6, 0.5], "collider": [0.3, 3.6, 0.3]},
    "wall_lantern": {"size": [0.35, 0.8, 0.6], "collider": None},
    "drain_grate": {"size": [0.6, 0.04, 0.6], "collider": None},
    "railing": {"size": [2.0, 1.0, 0.08], "collider": [2.0, 1.0, 0.1]},
    "fence": {"size": [2.0, 1.1, 0.1], "collider": [2.0, 1.1, 0.12]},
    "fence_gate": {"size": [2.0, 1.1, 0.1], "collider": [2.0, 1.1, 0.12]},
    "well": {"size": [2.2, 2.6, 2.2], "collider": [2.0, 1.0, 2.0]},
    "cart": {"size": [1.4, 1.1, 2.4], "collider": [1.3, 1.0, 2.3]},
    "sign_blue": {"size": [1.4, 0.9, 0.08], "collider": None},
    "sign_red": {"size": [1.4, 0.9, 0.08], "collider": None},
    "target": {"size": [0.9, 1.9, 0.5], "collider": None},
    "table": {"size": [1.6, 0.78, 0.8], "collider": [1.6, 0.78, 0.8]},
    "stool": {"size": [0.4, 0.45, 0.4], "collider": None},
    # --- Industrial Complex + Modern City (props_industrial.py, props_city.py) ---
    "container_red": {"size": [6.06, 2.59, 2.44], "collider": [6.06, 2.59, 2.44]},
    "container_blue": {"size": [6.06, 2.59, 2.44], "collider": [6.06, 2.59, 2.44]},
    "container_green": {"size": [6.06, 2.59, 2.44], "collider": [6.06, 2.59, 2.44]},
    "container_grey": {"size": [6.06, 2.59, 2.44], "collider": [6.06, 2.59, 2.44]},
    "container_orange": {"size": [6.06, 2.59, 2.44], "collider": [6.06, 2.59, 2.44]},
    "container_white": {"size": [6.06, 2.59, 2.44], "collider": [6.06, 2.59, 2.44]},
    "container_stack_a": {"size": [6.2, 5.18, 2.5], "collider": [6.06, 5.18, 2.44]},
    "container_stack_b": {"size": [6.2, 5.18, 2.5], "collider": [6.06, 5.18, 2.44]},
    "pallet": {"size": [1.2, 0.12, 0.8], "collider": None},
    "pallet_stack": {"size": [1.25, 0.73, 0.85], "collider": [1.2, 0.73, 0.8]},
    "pallet_goods": {"size": [1.2, 1.26, 0.8], "collider": [1.2, 1.26, 0.8]},
    "pallet_wrapped": {"size": [1.2, 1.32, 0.8], "collider": [1.2, 1.32, 0.8]},
    "crate_large": {"size": [1.6, 1.3, 1.2], "collider": [1.6, 1.3, 1.2]},
    "oil_drum": {"size": [0.6, 0.88, 0.6], "collider": [0.58, 0.88, 0.58]},
    "oil_drum_red": {"size": [0.6, 0.88, 0.6], "collider": [0.58, 0.88, 0.58]},
    "drum_group": {"size": [1.2, 1.0, 1.0], "collider": [1.2, 1.0, 1.0]},
    "ibc_tank": {"size": [1.2, 1.16, 1.0], "collider": [1.2, 1.16, 1.0]},
    "gas_cage": {"size": [1.7, 2.04, 0.9], "collider": [1.65, 2.04, 0.85]},
    "cable_reel": {"size": [1.0, 1.4, 1.4], "collider": [1.0, 1.4, 1.4]},
    "tire_stack": {"size": [0.9, 0.77, 0.9], "collider": [0.85, 0.77, 0.85]},
    "jersey_barrier": {"size": [2.0, 0.81, 0.6], "collider": [2.0, 0.81, 0.6]},
    "bollard_yellow": {"size": [0.21, 1.0, 0.21], "collider": [0.22, 1.0, 0.22]},
    "floodlight_pole": {"size": [1.6, 8.1, 0.6], "collider": [0.3, 8.0, 0.3]},
    "electrical_cabinet": {"size": [1.3, 1.6, 0.6], "collider": [1.3, 1.6, 0.6]},
    "transformer": {"size": [2.0, 2.3, 1.6], "collider": [2.0, 2.0, 1.6]},
    "skip_bin": {"size": [3.6, 1.4, 1.85], "collider": [3.6, 1.4, 1.8]},
    "pipe_bundle": {"size": [3.0, 0.67, 1.2], "collider": [3.0, 0.67, 1.2]},
    "shelving_rack": {"size": [2.7, 4.0, 1.1], "collider": [2.7, 4.0, 1.1]},
    "workbench": {"size": [2.0, 1.05, 0.8], "collider": [2.0, 0.94, 0.8]},
    "forklift": {"size": [1.66, 2.3, 3.35], "collider": [1.3, 2.2, 2.5]},
    "dumpster": {"size": [2.06, 1.44, 1.27], "collider": [2.0, 1.2, 1.2]},
    "dumpster_blue": {"size": [2.06, 1.44, 1.27], "collider": [2.0, 1.2, 1.2]},
    "trash_bin": {"size": [0.62, 1.03, 0.75], "collider": [0.6, 1.03, 0.7]},
    "trash_bin_grey": {"size": [0.62, 1.03, 0.75], "collider": [0.6, 1.03, 0.7]},
    "bench_modern": {"size": [1.8, 0.85, 0.51], "collider": [1.8, 0.5, 0.5]},
    "planter": {"size": [1.6, 1.2, 0.8], "collider": [1.6, 0.6, 0.8]},
    "planter_long": {"size": [3.0, 1.2, 0.8], "collider": [3.0, 0.6, 0.8]},
    "streetlight": {"size": [0.32, 6.5, 2.1], "collider": [0.25, 6.5, 0.25]},
    "utility_pole": {"size": [2.2, 9.0, 0.84], "collider": [0.32, 9.0, 0.32]},
    "sign_stop": {"size": [0.72, 2.9, 0.08], "collider": [0.08, 2.9, 0.08]},
    "sign_crossing": {"size": [0.72, 2.9, 0.08], "collider": [0.08, 2.9, 0.08]},
    "sign_no_parking": {"size": [0.55, 2.9, 0.08], "collider": [0.08, 2.9, 0.08]},
    "sign_street": {"size": [0.9, 3.0, 0.9], "collider": [0.08, 3.0, 0.08]},
    "fire_hydrant": {"size": [0.42, 0.74, 0.41], "collider": [0.36, 0.74, 0.36]},
    "newspaper_box": {"size": [0.52, 1.04, 0.47], "collider": [0.5, 1.04, 0.45]},
    "bike_rack": {"size": [1.55, 0.87, 0.65], "collider": [1.55, 0.87, 0.6]},
    "bollard_steel": {"size": [0.21, 1.0, 0.21], "collider": [0.22, 1.0, 0.22]},
    "traffic_cone": {"size": [0.36, 0.65, 0.36], "collider": None},
    "ac_condenser": {"size": [1.0, 0.8, 0.44], "collider": [1.0, 0.8, 0.44]},
    "trash_bags": {"size": [1.15, 0.66, 0.82], "collider": [1.0, 0.6, 0.75]},
    "traffic_light": {"size": [0.37, 4.25, 0.42], "collider": [0.2, 4.25, 0.2]},
    "cafe_set": {"size": [2.4, 2.35, 2.4], "collider": [1.5, 0.85, 1.5]},
    "car_red": {"size": [2.0, 1.42, 4.6], "collider": [1.8, 1.42, 4.5]},
    "car_blue": {"size": [2.0, 1.42, 4.6], "collider": [1.8, 1.42, 4.5]},
    "car_silver": {"size": [2.0, 1.42, 4.6], "collider": [1.8, 1.42, 4.5]},
    "car_black": {"size": [2.0, 1.42, 4.6], "collider": [1.8, 1.42, 4.5]},
    "car_white": {"size": [2.0, 1.42, 4.6], "collider": [1.8, 1.42, 4.5]},
    "van_white": {"size": [2.04, 2.25, 5.3], "collider": [1.98, 2.25, 5.25]},
}

# Modular kit pieces exported for future maps (not instanced by the European Town layout itself).
KIT = [
    "road_cobble_4x4", "road_cobble_drain_4x4", "curb_2m", "curb_corner", "sidewalk_2x2",
    "stone_wall_2m", "stone_wall_pillar", "archway_4m", "door_wood_single", "door_wood_double",
    "stairs_stone_4", "roof_vent", "window_box",
]

FLOOR_HEIGHT_GROUND = 3.4
FLOOR_HEIGHT_UPPER = 3.0
