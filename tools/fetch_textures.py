"""Download CC0 PBR textures + skies from Poly Haven and convert them to runtime assets.

Usage:  python -I tools/fetch_textures.py [--force]

Downloads go to .cache/polyhaven (git-ignored). Processed, web-sized files are written to
public/assets/textures/shared and public/assets/env, and a credits file is regenerated.
Outputs that already exist are kept (so adding a set does not re-encode the others); --force
re-downloads and rewrites everything.

Every texture set is exported as three JPGs that the runtime MaterialLibrary expects:
    <key>_albedo.jpg   base colour (sRGB)
    <key>_normal.jpg   tangent-space normal map, OpenGL convention (+Y up)
    <key>_orm.jpg      R = ambient occlusion, G = roughness, B = metallic (glTF ORM packing)
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "polyhaven"
TEX_OUT = ROOT / "public" / "assets" / "textures" / "shared"
ENV_OUT = ROOT / "public" / "assets" / "env"
CREDITS = ROOT / "public" / "assets" / "textures" / "CREDITS.md"

USER_AGENT = "CrossfireAssetFetcher/1.0 (+https://polyhaven.com)"

# key -> (poly haven id, albedo resolution, normal/orm resolution)
TEXTURES: dict[str, tuple[str, int, int]] = {
    "stone_rubble": ("castle_wall_slates", 2048, 1024),
    "stone_stacked": ("rustic_stone_wall_02", 2048, 1024),
    "stone_blocks": ("sandstone_blocks_05", 1024, 1024),
    "stone_trim": ("sandstone_blocks_04", 1024, 1024),
    "plaster": ("white_plaster_02", 2048, 1024),
    "plaster_worn": ("worn_plaster_wall", 2048, 1024),
    "plaster_red": ("red_plaster_weathered", 1024, 1024),
    "brick": ("red_brick_plaster_patch_02", 2048, 1024),
    "cobble": ("cobblestone_floor_08", 2048, 1024),
    "slabs": ("rock_tile_floor", 1024, 1024),
    "roof_tiles": ("clay_roof_tiles_02", 2048, 1024),
    "roof_tiles_b": ("ceramic_roof_01", 1024, 1024),
    "wood_dark": ("dark_wooden_planks", 1024, 1024),
    "wood_door": ("rough_pine_door", 1024, 1024),
    "wood_painted": ("blue_painted_planks", 1024, 1024),
    "wood_weathered": ("weathered_planks", 1024, 1024),
    "metal": ("rusty_metal_02", 1024, 512),
    # --- Industrial Complex ---------------------------------------------------------------------
    "brick_factory": ("factory_brick", 2048, 1024),
    "concrete_wall": ("concrete_wall_008", 2048, 1024),
    "concrete_panel": ("concrete_slab_wall", 1024, 1024),
    "corrugated": ("corrugated_iron", 1024, 1024),
    "corrugated_worn": ("worn_corrugated_iron", 1024, 1024),
    "corrugated_rusty": ("rusty_corrugated_iron", 1024, 1024),
    "metal_shutter": ("painted_metal_shutter", 1024, 1024),
    "metal_plate": ("metal_plate", 1024, 512),
    "asphalt": ("asphalt_02", 2048, 1024),
    "concrete_floor": ("concrete_floor_worn_001", 2048, 1024),
    "concrete_dark": ("hangar_concrete_floor", 1024, 1024),
    # --- Modern City ----------------------------------------------------------------------------
    "brick_city": ("brick_wall_09", 2048, 1024),
    "brick_city_b": ("brick_wall_07", 1024, 1024),
    "concrete_smooth": ("concrete_wall_004", 1024, 1024),
    "cladding": ("exterior_wall_cladding_03", 1024, 1024),
    "stucco": ("white_stucco", 1024, 1024),
    "facade_tiles": ("rectangular_facade_tiles", 1024, 1024),
    "pavers": ("square_concrete_pavers", 2048, 1024),
    "asphalt_fine": ("asphalt_01", 2048, 1024),
    "roof_gravel": ("tarred_gravel", 1024, 1024),
    "granite": ("granite_tile", 1024, 1024),
}

# output name -> Poly Haven HDRI ("pure sky": no ground in the panorama, so it works as a visible sky).
# Each map picks one in its MapDefinition (environment.hdr / skyImage).
SKIES: dict[str, str] = {
    "sky": "kloofendal_48d_partly_cloudy_puresky",  # European Town
    "sky_industrial": "kloppenheim_03_puresky",  # Industrial Complex: hazy, cooler daylight
    "sky_city": "qwantani_noon_puresky",  # Modern City: clear, high sun for bright alleys
}


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def download(url: str, dest: Path, force: bool) -> Path:
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if not data:
        raise RuntimeError(f"empty download: {url}")
    dest.write_bytes(data)
    return dest


def save_jpg(src: Path, dest: Path, size: int, quality: int) -> None:
    im = Image.open(src).convert("RGB")
    if im.width != size:
        im = im.resize((size, size), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=quality, optimize=True, progressive=True)


def main() -> None:
    force = "--force" in sys.argv
    credits: list[str] = []
    for key, (asset_id, albedo_res, detail_res) in TEXTURES.items():
        print(f"[{key}] {asset_id}")
        files = fetch_json(f"https://api.polyhaven.com/files/{asset_id}")
        info = fetch_json(f"https://api.polyhaven.com/info/{asset_id}")
        res = "2k" if max(albedo_res, detail_res) > 1024 else "1k"
        maps = {"albedo": "Diffuse", "normal": "nor_gl", "orm": "arm"}
        for suffix, ph_key in maps.items():
            if (TEX_OUT / f"{key}_{suffix}.jpg").exists() and not force:
                continue
            url = files[ph_key][res]["jpg"]["url"]
            raw = download(url, CACHE / asset_id / Path(url).name, force)
            size = albedo_res if suffix == "albedo" else detail_res
            quality = 90 if suffix == "normal" else 84
            save_jpg(raw, TEX_OUT / f"{key}_{suffix}.jpg", size, quality)
        authors = ", ".join(info.get("authors", {}).keys())
        credits.append(
            f"| `{key}` | [{info.get('name', asset_id)}](https://polyhaven.com/a/{asset_id}) | {authors} | CC0 1.0 |"
        )

    for name, sky_id in SKIES.items():
        print(f"[{name}] {sky_id}")
        info = fetch_json(f"https://api.polyhaven.com/info/{sky_id}")
        ENV_OUT.mkdir(parents=True, exist_ok=True)
        hdr_out, jpg_out = ENV_OUT / f"{name}_1k.hdr", ENV_OUT / f"{name}_4k.jpg"
        if force or not (hdr_out.exists() and jpg_out.exists()):
            files = fetch_json(f"https://api.polyhaven.com/files/{sky_id}")
            hdr = download(files["hdri"]["1k"]["hdr"]["url"], CACHE / sky_id / f"{sky_id}_1k.hdr", force)
            hdr_out.write_bytes(hdr.read_bytes())
            tonemapped = download(files["tonemapped"]["url"], CACHE / sky_id / f"{sky_id}_tonemapped.jpg", force)
            Image.MAX_IMAGE_PIXELS = None
            sky = Image.open(tonemapped).convert("RGB").resize((4096, 2048), Image.LANCZOS)
            sky.save(jpg_out, "JPEG", quality=86, optimize=True, progressive=True)
        authors = ", ".join(info.get("authors", {}).keys())
        credits.append(
            f"| `{hdr_out.name}`, `{jpg_out.name}` | [{info.get('name', sky_id)}](https://polyhaven.com/a/{sky_id}) | {authors} | CC0 1.0 |"
        )

    CREDITS.write_text(
        "# Texture and environment credits\n\n"
        "All external textures and HDRIs come from [Poly Haven](https://polyhaven.com) and are released under "
        "[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, no attribution required). "
        "Credit is listed anyway as a courtesy.\n\n"
        "Files were downloaded by `tools/fetch_textures.py`, resized and re-encoded as JPG. "
        "Normal maps use the OpenGL (+Y) convention; `_orm` maps are Poly Haven's `arm` maps "
        "(R = AO, G = roughness, B = metallic).\n\n"
        "| Runtime key | Source asset | Authors | License |\n|---|---|---|---|\n" + "\n".join(credits) + "\n\n"
        "Procedurally generated textures (signs, leaves, decals) are created by `tools/make_procedural_textures.py` "
        "and are original to this project.\n",
        encoding="utf-8",
    )
    print("done")


if __name__ == "__main__":
    main()
