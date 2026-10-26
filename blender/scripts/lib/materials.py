"""Material table shared by Blender (preview materials in .blend files) and the game runtime.

Pure data, no bpy. `write_manifest()` exports public/assets/materials.json, which the runtime
MaterialLibrary turns into Babylon PBR materials. GLB files reference these materials by name
only (textures are not embedded), so every building shares one texture set in GPU memory.

Fields
  tex        texture set key: textures/shared/<tex>_albedo.jpg, _normal.jpg, _orm.jpg
  albedo     override the albedo file (e.g. a procedurally generated texture)
  tile       metres covered by one texture repeat (UVs are authored in metres)
  tint       albedo multiplier (linear RGB)
  roughness  multiplier on the ORM green channel (or absolute value when there is no texture)
  metallic   multiplier on the ORM blue channel (or absolute value when there is no texture)
  normal     normal-map strength (exported as normal_strength)
  emissive   linear RGB emissive colour (adds glow)
  alpha_cutoff  enables alpha testing with the albedo's alpha channel
  alpha      constant opacity < 1 enables alpha blending (e.g. the holo-sight lens)
  double_sided  render back faces
  decal      thin layer over another surface: the renderer applies a polygon offset to it
  atlas      the UVs address regions of one image (text signs, posters): the runtime must not flip the image
             vertically (glTF UVs are top-origin; flipping is only harmless for tiling textures)
"""
from __future__ import annotations

import json
from pathlib import Path

from catalog import PALETTES

TEX_DIR = "assets/textures/shared/"
PROC_DIR = "assets/textures/european-town/"
URBAN_DIR = "assets/textures/urban/"
IND_DIR = "assets/textures/industrial-complex/"
CITY_DIR = "assets/textures/modern-city/"
WEAPON_DIR = "assets/textures/weapons/"

MATERIALS: dict[str, dict] = {
    # --- architecture ----------------------------------------------------------------------------
    "stone_rubble": {"tex": "stone_rubble", "tile": 2.8, "tint": [1.0, 0.98, 0.95], "normal": 1.1},
    "stone_stacked": {"tex": "stone_stacked", "tile": 2.6, "tint": [1.0, 0.97, 0.93], "normal": 1.1},
    "stone_blocks": {"tex": "stone_blocks", "tile": 2.4, "tint": [1.0, 0.98, 0.95]},
    "stone_trim": {"tex": "stone_trim", "tile": 1.8, "tint": [0.98, 0.95, 0.9], "normal": 0.6},
    "plaster": {"tex": "plaster", "tile": 3.2, "tint": [0.96, 0.94, 0.9]},
    "plaster_red": {"tex": "plaster_red", "tile": 3.2, "tint": [1.0, 0.95, 0.92]},
    "plaster_worn": {"tex": "plaster_worn", "tile": 3.4, "tint": [1.0, 0.97, 0.92]},
    "brick": {"tex": "brick", "tile": 2.4, "tint": [1.0, 0.96, 0.94]},
    "interior_plaster": {"tex": "plaster", "tile": 2.5, "tint": [0.86, 0.8, 0.7], "roughness": 1.0},
    "interior_floor": {"tex": "wood_dark", "tile": 1.8, "tint": [0.85, 0.8, 0.75]},
    # the unlit inside of a building, seen only through door seams and shop glass (building.back_opening)
    "interior_dark": {"tint": [0.025, 0.024, 0.022], "roughness": 0.95, "metallic": 0.0},
    # --- ground ----------------------------------------------------------------------------------
    "cobble": {"tex": "cobble", "tile": 2.6, "tint": [0.95, 0.93, 0.9], "normal": 1.2},
    "slabs": {"tex": "slabs", "tile": 2.8, "tint": [0.98, 0.95, 0.9]},
    "slabs_blue": {"tex": "slabs", "tile": 2.8, "tint": [0.82, 0.88, 1.0]},
    "slabs_red": {"tex": "slabs", "tile": 2.8, "tint": [1.0, 0.84, 0.8]},
    # --- roofs -----------------------------------------------------------------------------------
    "roof_tiles": {"tex": "roof_tiles", "tile": 2.2, "tint": [1.0, 0.95, 0.9], "normal": 1.2},
    "roof_tiles_b": {"tex": "roof_tiles_b", "tile": 2.4, "tint": [1.0, 0.97, 0.92], "normal": 1.2},
    # --- wood ------------------------------------------------------------------------------------
    "wood_dark": {"tex": "wood_dark", "tile": 1.6, "tint": [0.8, 0.74, 0.68]},
    "wood_beam": {"tex": "wood_dark", "tile": 1.2, "tint": [0.55, 0.45, 0.38]},
    "wood_weathered": {"tex": "wood_weathered", "tile": 1.4},
    "wood_crate": {"tex": "wood_weathered", "tile": 1.0, "tint": [1.0, 0.9, 0.75]},
    "wood_door": {"tex": "wood_door", "tile": 1.3, "tint": [0.85, 0.75, 0.66]},
    "frame_white": {"albedo": PROC_DIR + "wood_painted_grey.jpg", "tex": "wood_painted", "tile": 0.8,
                    "tint": [0.93, 0.91, 0.87]},
    "frame_dark": {"tex": "wood_dark", "tile": 0.8, "tint": [0.42, 0.34, 0.28]},
    # --- metal / glass ---------------------------------------------------------------------------
    "iron": {"tex": "metal", "tile": 0.8, "tint": [0.16, 0.16, 0.17], "roughness": 0.75, "metallic": 0.9},
    "iron_rusty": {"tex": "metal", "tile": 1.0, "tint": [0.42, 0.33, 0.27], "roughness": 0.9, "metallic": 0.6},
    "copper": {"tex": "metal", "tile": 1.0, "tint": [0.45, 0.32, 0.22], "roughness": 0.6, "metallic": 0.9},
    "glass": {"tint": [0.05, 0.065, 0.075], "roughness": 0.05, "metallic": 0.15},
    "glass_shop": {"tint": [0.12, 0.14, 0.15], "roughness": 0.04, "metallic": 0.1},
    "lantern_glass": {"tint": [1.0, 0.82, 0.55], "roughness": 0.2, "metallic": 0.0, "emissive": [1.4, 0.95, 0.5]},
    "water": {"tint": [0.03, 0.05, 0.05], "roughness": 0.02, "metallic": 0.0},
    # --- fabric / misc ---------------------------------------------------------------------------
    "canvas_red": {"albedo": PROC_DIR + "canvas_stripes_red.jpg", "tex": "plaster", "tile": 1.6, "roughness": 0.95},
    "canvas_green": {"albedo": PROC_DIR + "canvas_stripes_green.jpg", "tex": "plaster", "tile": 1.6,
                     "roughness": 0.95},
    "canvas_cream": {"tex": "plaster", "tile": 1.0, "tint": [0.92, 0.86, 0.72], "roughness": 0.95},
    "terracotta": {"tex": "plaster", "tile": 0.7, "tint": [0.66, 0.34, 0.2], "roughness": 0.85},
    "soil": {"tex": "cobble", "tile": 0.6, "tint": [0.2, 0.14, 0.1], "roughness": 1.0, "normal": 0.4},
    "foliage": {"albedo": PROC_DIR + "foliage.png", "tile": 1.0, "roughness": 0.8, "alpha_cutoff": 0.45,
                "double_sided": True, "tint": [0.9, 1.0, 0.85]},
    "flowers": {"albedo": PROC_DIR + "flowers.png", "tile": 1.0, "roughness": 0.7, "alpha_cutoff": 0.45,
                "double_sided": True},
    "produce": {"albedo": PROC_DIR + "produce.jpg", "tile": 1.0, "roughness": 0.6},
    "sign_blue": {"albedo": PROC_DIR + "sign_blue.png", "tile": 1.0, "roughness": 0.5, "emissive": [0.25, 0.45, 1.0],
                  "emissive_tex": True},
    "sign_red": {"albedo": PROC_DIR + "sign_red.png", "tile": 1.0, "roughness": 0.5, "emissive": [1.0, 0.3, 0.25],
                 "emissive_tex": True},
    "shop_sign": {"albedo": PROC_DIR + "shop_signs.jpg", "tile": 1.0, "roughness": 0.7},
    "team_blue_glow": {"tint": [0.1, 0.25, 0.9], "roughness": 0.4, "emissive": [0.2, 0.5, 2.2]},
    "team_red_glow": {"tint": [0.9, 0.15, 0.1], "roughness": 0.4, "emissive": [2.2, 0.35, 0.25]},
    # --- weapon / targets ------------------------------------------------------------------------
    "weapon_body": {"tint": [0.3, 0.31, 0.34], "roughness": 0.34, "metallic": 0.65},
    "weapon_dark": {"tint": [0.035, 0.038, 0.045], "roughness": 0.42, "metallic": 0.5},
    "weapon_panel": {"tint": [0.36, 0.35, 0.33], "roughness": 0.5, "metallic": 0.05},
    "weapon_grip": {"tint": [0.06, 0.055, 0.05], "roughness": 0.85, "metallic": 0.0},
    "weapon_accent": {"tint": [0.95, 0.38, 0.06], "roughness": 0.4, "metallic": 0.15},
    "weapon_glow": {"tint": [0.2, 0.9, 1.0], "roughness": 0.3, "emissive": [0.12, 0.75, 1.1]},
    "weapon_lens": {"tint": [0.1, 0.45, 0.5], "roughness": 0.05, "metallic": 0.2, "alpha": 0.22,
                    "emissive": [0.0, 0.05, 0.06]},
    "weapon_reticle": {"tint": [1.0, 0.2, 0.1], "roughness": 0.5, "emissive": [3.0, 0.45, 0.15]},
    # the silhouette is not symmetric: load it unflipped like the sign atlases
    "target_face": {"albedo": PROC_DIR + "target_face.png", "tile": 1.0, "roughness": 0.62, "metallic": 0.15, "atlas": True},
    # --- first-person firearms and hands (blender/scripts/lib/weapon.py, hands.py) --------------------------------
    "gun_black": {"tex": "metal", "albedo": None, "tile": 0.22, "tint": [0.05, 0.052, 0.056], "roughness": 0.55,
                  "metallic": 0.7, "normal": 0.35},
    "gun_steel": {"tex": "metal", "albedo": None, "tile": 0.22, "tint": [0.085, 0.087, 0.092], "roughness": 0.4,
                  "metallic": 0.92, "normal": 0.3},
    "gun_polymer": {"tex": "concrete_smooth", "albedo": None, "tile": 0.3, "tint": [0.042, 0.042, 0.044], "roughness": 0.78,
                    "metallic": 0.0, "normal": 0.25},
    "gun_fde": {"tex": "concrete_smooth", "albedo": None, "tile": 0.3, "tint": [0.34, 0.27, 0.18], "roughness": 0.74,
                "metallic": 0.0, "normal": 0.25},
    "gun_wood": {"tex": "wood_dark", "tile": 0.4, "tint": [0.78, 0.52, 0.32], "roughness": 0.42, "metallic": 0.0, "normal": 0.5},
    "gun_rubber": {"tint": [0.028, 0.028, 0.028], "roughness": 0.95, "metallic": 0.0},
    "gun_glass": {"tint": [0.1, 0.16, 0.17], "roughness": 0.03, "metallic": 0.4, "alpha": 0.16},
    "gun_lens": {"tint": [0.015, 0.025, 0.045], "roughness": 0.04, "metallic": 0.65},
    # replaced at runtime by an additive emissive material (rendering it like a real holographic reticle)
    "reticle_holo": {"albedo": WEAPON_DIR + "reticle_holo.png", "tile": 1.0, "tint": [1.0, 1.0, 1.0], "roughness": 1.0,
                     "emissive": [3.0, 0.32, 0.22], "emissive_tex": True, "alpha_cutoff": 0.15},
    "sight_dot": {"tint": [1.0, 0.42, 0.05], "roughness": 0.4, "emissive": [2.4, 0.75, 0.08]},
    "brass": {"tex": "metal", "albedo": None, "tile": 0.08, "tint": [0.8, 0.56, 0.24], "roughness": 0.3, "metallic": 1.0,
              "normal": 0.2},
    "shell_red": {"tint": [0.5, 0.05, 0.04], "roughness": 0.45, "metallic": 0.0},
    "glove": {"tex": "fabric", "tex_dir": WEAPON_DIR, "tile": 0.05, "tint": [0.46, 0.31, 0.16], "roughness": 0.86,
              "metallic": 0.0, "normal": 0.9},
    "glove_pad": {"tint": [0.03, 0.03, 0.03], "roughness": 0.9, "metallic": 0.0},
    "sleeve": {"tex": "fabric", "tex_dir": WEAPON_DIR, "tile": 0.07, "tint": [0.15, 0.15, 0.095], "roughness": 0.92,
               "metallic": 0.0, "normal": 1.0},
    "sleeve_seam": {"tex": "fabric", "tex_dir": WEAPON_DIR, "tile": 0.04, "tint": [0.11, 0.11, 0.07], "roughness": 0.92,
                    "metallic": 0.0, "normal": 1.0},
    "target_frame": {"tint": [0.25, 0.27, 0.3], "roughness": 0.5, "metallic": 0.7},
}

# Thin layers laid over the ground (gutter strips, the plaza ring, team strips) sit a few millimetres above it. They get
# their own decal materials so the renderer can apply a small polygon offset to exactly these layers and nothing else.
MATERIALS["slabs_inlay"] = {**MATERIALS["slabs"], "decal": True}
MATERIALS["stone_inlay"] = {**MATERIALS["stone_trim"], "decal": True}
for _glow in ("team_blue_glow", "team_red_glow"):
    MATERIALS[_glow]["decal"] = True
for _sheet in ("shop_sign", "sign_blue", "sign_red"):
    MATERIALS[_sheet]["atlas"] = True

# palette-specific paint for shutters and doors
for _name, _pal in PALETTES.items():
    MATERIALS[f"shutter_{_name}"] = {"albedo": PROC_DIR + "wood_painted_grey.jpg", "tex": "wood_painted",
                                     "tile": 1.0, "tint": _pal["shutter"]}
    MATERIALS[f"door_{_name}"] = {"tex": "wood_door", "tile": 1.3, "tint": [min(1.0, c * 6.0) for c in _pal["door"]]}

# plaster tints used by palettes
PLASTER_TINTS = {
    "plaster_white": [0.96, 0.94, 0.9],
    "plaster_beige": [0.93, 0.84, 0.70],
    "plaster_ochre": [0.95, 0.72, 0.42],
    "plaster_rose": [0.93, 0.70, 0.60],
}
for _name, _tint in PLASTER_TINTS.items():
    MATERIALS[_name] = {"tex": "plaster", "tile": 3.2, "tint": _tint}


# --- Industrial Complex + Modern City ----------------------------------------------------------------
# Tint variants of one texture set collapse into a single runtime material (MaterialLibrary.canonical), so the many
# paint colours below cost vertex colours, not draw calls.
def _tints(prefix: str, base: dict, tints: dict) -> None:
    for k, t in tints.items():
        MATERIALS[f"{prefix}_{k}"] = {**base, "tint": t}


# Painted steel / aluminium: the normal + ORM maps of the rusty_metal_02 set (scratches, roughness variation) under a
# paint colour, without its rust-coloured albedo. Low metallic multiplier: it is paint, not bare metal.
PAINTED = {"tex": "metal", "albedo": None, "tile": 1.4, "roughness": 0.85, "metallic": 0.35, "normal": 0.6}

MATERIALS.update({
    # walls
    "brick_factory": {"tex": "brick_factory", "tile": 2.6, "tint": [1.0, 0.97, 0.95], "normal": 1.1},
    "brick_factory_soot": {"tex": "brick_factory", "tile": 2.6, "tint": [0.66, 0.6, 0.57], "normal": 1.1},
    "concrete_wall": {"tex": "concrete_wall", "tile": 3.6, "tint": [0.96, 0.95, 0.93]},
    "concrete_wall_stained": {"tex": "concrete_wall", "tile": 3.6, "tint": [0.78, 0.76, 0.72]},
    "concrete_panel": {"tex": "concrete_panel", "tile": 4.0, "tint": [0.95, 0.95, 0.94]},
    "concrete_trim": {"tex": "concrete_wall", "tile": 1.6, "tint": [0.9, 0.89, 0.87], "normal": 0.6},
    "cladding_rusty": {"tex": "corrugated_rusty", "tile": 1.8},
    # roofs
    "roof_corrugated": {"tex": "corrugated_worn", "tile": 2.0, "tint": [0.9, 0.9, 0.9]},
    "roof_rusty": {"tex": "corrugated_rusty", "tile": 2.0},
    "roof_gravel": {"tex": "roof_gravel", "tile": 2.5},
    # ground
    "asphalt": {"tex": "asphalt", "tile": 4.5, "tint": [0.92, 0.92, 0.94], "normal": 0.9},
    "concrete_floor": {"tex": "concrete_floor", "tile": 3.2, "tint": [0.95, 0.94, 0.92]},
    "concrete_floor_dark": {"tex": "concrete_dark", "tile": 3.0},
    "asphalt_fine": {"tex": "asphalt_fine", "tile": 4.5, "tint": [0.9, 0.9, 0.92]},
    "pavers": {"tex": "pavers", "tile": 2.0, "tint": [0.96, 0.95, 0.93]},
    "curb": {"tex": "concrete_floor", "tile": 1.2, "tint": [0.86, 0.85, 0.83], "normal": 0.6},
    "granite": {"tex": "granite", "tile": 1.6},
    # metal
    "metal_plate": {"tex": "metal_plate", "tile": 1.0, "tint": [0.8, 0.8, 0.82]},
    "galvanized": {**PAINTED, "tint": [0.56, 0.57, 0.58], "roughness": 0.6, "metallic": 0.9},
    "aluminium": {**PAINTED, "tint": [0.66, 0.67, 0.69], "roughness": 0.55, "metallic": 0.85},
    # glass, rubber, lamps
    "glass_wired": {"tint": [0.07, 0.09, 0.085], "roughness": 0.12, "metallic": 0.2},
    "glass_skylight": {"tint": [0.3, 0.34, 0.34], "roughness": 0.3, "metallic": 0.1},
    "glass_window": {"tint": [0.055, 0.075, 0.095], "roughness": 0.04, "metallic": 0.35},
    "glass_store": {"tint": [0.09, 0.11, 0.12], "roughness": 0.03, "metallic": 0.15},
    "window_blinds": {"albedo": URBAN_DIR + "blinds.jpg", "tile": 1.0, "roughness": 0.12, "metallic": 0.1},
    "rubber": {"tint": [0.03, 0.03, 0.03], "roughness": 0.92, "metallic": 0.0},
    "lamp_sodium": {"tint": [1.0, 0.85, 0.6], "roughness": 0.3, "metallic": 0.0, "emissive": [2.2, 1.5, 0.7]},
    "lamp_led": {"tint": [0.95, 0.97, 1.0], "roughness": 0.3, "metallic": 0.0, "emissive": [1.7, 1.85, 2.0]},
    # plastics
    "plastic_black": {"tint": [0.025, 0.025, 0.027], "roughness": 0.6, "metallic": 0.0},
    "plastic_green": {"tint": [0.05, 0.2, 0.09], "roughness": 0.55, "metallic": 0.0},
    "plastic_blue": {"tint": [0.04, 0.11, 0.3], "roughness": 0.55, "metallic": 0.0},
    "plastic_orange": {"tint": [0.85, 0.22, 0.02], "roughness": 0.5, "metallic": 0.0},
    "plastic_grey": {"tint": [0.28, 0.29, 0.3], "roughness": 0.6, "metallic": 0.0},
    "plastic_white": {"tint": [0.84, 0.84, 0.81], "roughness": 0.45, "metallic": 0.0},
    "plastic_wrap": {"tint": [0.74, 0.76, 0.77], "roughness": 0.25, "metallic": 0.0},
    "cardboard": {"tex": "wood_weathered", "albedo": None, "tile": 1.0, "tint": [0.56, 0.42, 0.27], "roughness": 1.0,
                  "metallic": 0.0, "normal": 0.25},
    "ceramic": {"tint": [0.36, 0.2, 0.12], "roughness": 0.25, "metallic": 0.0},
    # vehicles and signals
    "headlight": {"tint": [0.85, 0.86, 0.84], "roughness": 0.08, "metallic": 0.3},
    "taillight": {"tint": [0.45, 0.02, 0.02], "roughness": 0.15, "metallic": 0.0, "emissive": [0.25, 0.0, 0.0]},
    "signal_off": {"tint": [0.04, 0.04, 0.035], "roughness": 0.2, "metallic": 0.0},
    "signal_green": {"tint": [0.1, 0.6, 0.3], "roughness": 0.2, "metallic": 0.0, "emissive": [0.2, 1.6, 0.6]},
    "sign_back": {"albedo": URBAN_DIR + "street_signs.png", "tile": 1.0, "tint": [0.32, 0.33, 0.34], "roughness": 0.5,
                  "metallic": 0.6, "alpha_cutoff": 0.5},
    # wood
    "wood_pallet": {"tex": "wood_weathered", "tile": 1.0, "tint": [1.0, 0.9, 0.74]},
    "wood_pole": {"tex": "wood_weathered", "tile": 1.6, "tint": [0.46, 0.38, 0.31]},
    # printed / alpha-tested
    "paint_yellow": {"albedo": URBAN_DIR + "paint_wear.png", "tile": 1.6, "tint": [0.86, 0.6, 0.05], "roughness": 0.7,
                     "alpha_cutoff": 0.5, "decal": True},
    "paint_white": {"albedo": URBAN_DIR + "paint_wear.png", "tile": 1.6, "tint": [0.86, 0.86, 0.84], "roughness": 0.7,
                    "alpha_cutoff": 0.5, "decal": True},
    "oil_stain": {"albedo": URBAN_DIR + "oil_stains.png", "tile": 3.0, "roughness": 0.35, "alpha_cutoff": 0.3,
                  "decal": True},
    "hazard": {"albedo": URBAN_DIR + "hazard_stripes.jpg", "tile": 0.8, "roughness": 0.6},
    "chainlink": {"albedo": URBAN_DIR + "chainlink.png", "tile": 0.5, "roughness": 0.5, "metallic": 0.7,
                  "alpha_cutoff": 0.4, "double_sided": True},
    "street_signs": {"albedo": URBAN_DIR + "street_signs.png", "tile": 1.0, "roughness": 0.45, "alpha_cutoff": 0.5},
    "sign_industrial": {"albedo": IND_DIR + "signs_industrial.jpg", "tile": 1.0, "roughness": 0.6},
    "sign_city": {"albedo": CITY_DIR + "shop_signs_city.jpg", "tile": 1.0, "roughness": 0.45},
    "posters": {"albedo": CITY_DIR + "posters.jpg", "tile": 1.0, "roughness": 0.8},
})
_tints("concrete_spawn", MATERIALS["concrete_floor"], {"blue": [0.76, 0.83, 0.98], "red": [0.98, 0.8, 0.76]})
_tints("pavers_spawn", MATERIALS["pavers"], {"blue": [0.78, 0.85, 1.0], "red": [1.0, 0.82, 0.78]})
for _sheet in ("window_blinds", "street_signs", "sign_back", "sign_industrial", "sign_city", "posters"):
    MATERIALS[_sheet]["atlas"] = True
for _ground in ("asphalt", "concrete_floor", "asphalt_fine", "pavers"):
    # same surface laid over another one (patches, painted bays): needs the decal polygon offset
    MATERIALS[f"{_ground}_inlay"] = {**MATERIALS[_ground], "decal": True}

_tints("cladding", {"tex": "corrugated", "tile": 1.6, "normal": 1.1}, {
    "grey": [0.82, 0.83, 0.85], "blue": [0.3, 0.42, 0.6], "green": [0.34, 0.48, 0.38], "red": [0.6, 0.25, 0.19],
    "cream": [0.86, 0.8, 0.66], "white": [0.95, 0.95, 0.95]})
_tints("roller", {"tex": "metal_shutter", "tile": 2.2}, {
    "grey": [0.7, 0.71, 0.72], "blue": [0.26, 0.38, 0.58], "yellow": [0.86, 0.62, 0.12], "red": [0.6, 0.18, 0.14],
    "green": [0.28, 0.44, 0.32], "white": [0.92, 0.92, 0.9]})
_tints("steel", PAINTED, {
    "grey": [0.3, 0.31, 0.33], "yellow": [0.78, 0.52, 0.05], "blue": [0.1, 0.2, 0.4], "red": [0.48, 0.07, 0.05],
    "green": [0.08, 0.26, 0.14], "dark": [0.06, 0.065, 0.07], "white": [0.8, 0.8, 0.78], "orange": [0.78, 0.28, 0.04]})
_tints("container", {**PAINTED, "tile": 2.0, "roughness": 0.9}, {
    "red": [0.52, 0.1, 0.06], "blue": [0.07, 0.18, 0.4], "green": [0.1, 0.3, 0.16], "grey": [0.42, 0.43, 0.44],
    "orange": [0.75, 0.3, 0.05], "white": [0.82, 0.82, 0.8], "teal": [0.05, 0.3, 0.32]})
_tints("brick_city", {"tex": "brick_city", "tile": 2.4}, {
    "red": [1.0, 0.96, 0.94], "brown": [0.78, 0.66, 0.6], "pale": [1.0, 0.92, 0.86]})
_tints("brick_city_b", {"tex": "brick_city_b", "tile": 2.4}, {
    "orange": [1.0, 0.97, 0.95], "dark": [0.62, 0.56, 0.54]})
_tints("concrete_smooth", {"tex": "concrete_smooth", "tile": 3.0}, {
    "light": [0.96, 0.95, 0.93], "warm": [0.92, 0.86, 0.78], "cool": [0.8, 0.83, 0.86], "dark": [0.55, 0.56, 0.57]})
_tints("cladding_panel", {"tex": "cladding", "tile": 2.4}, {
    "white": [0.95, 0.95, 0.94], "sage": [0.72, 0.78, 0.68], "slate": [0.48, 0.52, 0.56]})
_tints("stucco", {"tex": "stucco", "tile": 3.0}, {
    "cream": [0.92, 0.86, 0.74], "peach": [0.92, 0.72, 0.58], "sky": [0.7, 0.8, 0.88], "grey": [0.72, 0.72, 0.71],
    "olive": [0.68, 0.7, 0.54], "white": [0.95, 0.94, 0.92]})
_tints("facade_tiles", {"tex": "facade_tiles", "tile": 1.8}, {"dark": [1.0, 1.0, 1.0], "light": [2.4, 2.4, 2.35]})
_tints("carpaint", {"tint": [1, 1, 1], "roughness": 0.28, "metallic": 0.55}, {
    "red": [0.42, 0.03, 0.03], "blue": [0.03, 0.08, 0.25], "silver": [0.5, 0.52, 0.54], "black": [0.02, 0.02, 0.022],
    "white": [0.78, 0.78, 0.76], "green": [0.04, 0.16, 0.08]})
_tints("canvas", {"tex": "plaster", "tile": 1.0, "roughness": 0.95}, {
    "blue": [0.16, 0.3, 0.55], "black": [0.06, 0.06, 0.065], "olive": [0.32, 0.36, 0.2]})


def wall_material(palette: str) -> str:
    """Material name for a palette's main wall."""
    pal = PALETTES[palette]
    if pal["wall"] == "plaster":
        return palette if palette in PLASTER_TINTS else "plaster"
    return pal["wall"]


def texture_files(name: str) -> dict:
    m = MATERIALS[name]
    out = {}
    if "tex" in m:
        d = m.get("tex_dir", TEX_DIR)
        out = {"albedo": f"{d}{m['tex']}_albedo.jpg", "normal": f"{d}{m['tex']}_normal.jpg", "orm": f"{d}{m['tex']}_orm.jpg"}
    if "albedo" in m:
        out["albedo"] = m["albedo"]
    return out


def manifest() -> dict:
    out = {}
    for name, m in MATERIALS.items():
        e = {"tile": m.get("tile", 1.0), "tint": m.get("tint", [1.0, 1.0, 1.0])}
        e.update(texture_files(name))
        for k in ("roughness", "metallic", "emissive", "alpha_cutoff", "alpha", "double_sided", "emissive_tex", "decal", "atlas"):
            if k in m:
                e[k] = m[k]
        if "normal" in m:
            e["normal_strength"] = m["normal"]
        out[name] = e
    return {"version": 1, "materials": out}


def write_manifest(public_dir: Path) -> Path:
    path = public_dir / "assets" / "materials.json"
    path.write_text(json.dumps(manifest(), indent=1), encoding="utf-8")
    return path


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[3]
    print(write_manifest(root / "public"))
