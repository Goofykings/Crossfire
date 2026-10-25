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
"""
from __future__ import annotations

import json
from pathlib import Path

from catalog import PALETTES

TEX_DIR = "assets/textures/shared/"
PROC_DIR = "assets/textures/european-town/"

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
    "target_face": {"albedo": PROC_DIR + "target_face.png", "tile": 1.0, "roughness": 0.7},
    "target_frame": {"tint": [0.25, 0.27, 0.3], "roughness": 0.5, "metallic": 0.7},
}

# Thin layers laid over the ground (gutter strips, the plaza ring, team strips) sit a few millimetres above it. They get
# their own decal materials so the renderer can apply a small polygon offset to exactly these layers and nothing else.
MATERIALS["slabs_inlay"] = {**MATERIALS["slabs"], "decal": True}
MATERIALS["stone_inlay"] = {**MATERIALS["stone_trim"], "decal": True}
for _glow in ("team_blue_glow", "team_red_glow"):
    MATERIALS[_glow]["decal"] = True

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
        out = {"albedo": f"{TEX_DIR}{m['tex']}_albedo.jpg", "normal": f"{TEX_DIR}{m['tex']}_normal.jpg",
               "orm": f"{TEX_DIR}{m['tex']}_orm.jpg"}
    if "albedo" in m:
        out["albedo"] = m["albedo"]
    return out


def manifest() -> dict:
    out = {}
    for name, m in MATERIALS.items():
        e = {"tile": m.get("tile", 1.0), "tint": m.get("tint", [1.0, 1.0, 1.0])}
        e.update(texture_files(name))
        for k in ("roughness", "metallic", "emissive", "alpha_cutoff", "alpha", "double_sided", "emissive_tex", "decal"):
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
