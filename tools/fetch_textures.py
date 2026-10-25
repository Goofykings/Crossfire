"""Download CC0 PBR textures + sky from Poly Haven and convert them to runtime assets.

Usage:  python -I tools/fetch_textures.py [--force]

Downloads go to .cache/polyhaven (git-ignored). Processed, web-sized files are written to
public/assets/textures/shared and public/assets/env, and a credits file is regenerated.

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
}

SKY_ID = "kloofendal_48d_partly_cloudy_puresky"


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
            url = files[ph_key][res]["jpg"]["url"]
            raw = download(url, CACHE / asset_id / Path(url).name, force)
            size = albedo_res if suffix == "albedo" else detail_res
            quality = 90 if suffix == "normal" else 84
            save_jpg(raw, TEX_OUT / f"{key}_{suffix}.jpg", size, quality)
        authors = ", ".join(info.get("authors", {}).keys())
        credits.append(
            f"| `{key}` | [{info.get('name', asset_id)}](https://polyhaven.com/a/{asset_id}) | {authors} | CC0 1.0 |"
        )

    print(f"[sky] {SKY_ID}")
    files = fetch_json(f"https://api.polyhaven.com/files/{SKY_ID}")
    info = fetch_json(f"https://api.polyhaven.com/info/{SKY_ID}")
    hdr = download(files["hdri"]["1k"]["hdr"]["url"], CACHE / SKY_ID / f"{SKY_ID}_1k.hdr", force)
    ENV_OUT.mkdir(parents=True, exist_ok=True)
    (ENV_OUT / "sky_1k.hdr").write_bytes(hdr.read_bytes())
    tonemapped = download(files["tonemapped"]["url"], CACHE / SKY_ID / f"{SKY_ID}_tonemapped.jpg", force)
    Image.MAX_IMAGE_PIXELS = None
    sky = Image.open(tonemapped).convert("RGB").resize((4096, 2048), Image.LANCZOS)
    sky.save(ENV_OUT / "sky_4k.jpg", "JPEG", quality=86, optimize=True, progressive=True)
    authors = ", ".join(info.get("authors", {}).keys())
    credits.append(
        f"| `sky_1k.hdr`, `sky_4k.jpg` | [{info.get('name', SKY_ID)}](https://polyhaven.com/a/{SKY_ID}) | {authors} | CC0 1.0 |"
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
