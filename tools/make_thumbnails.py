"""Menu thumbnails from the Blender preview renders.

Usage: python -I tools/make_thumbnails.py

For every map with an aerial preview (docs/previews/aerial.png for European Town, docs/previews/<id>/aerial.png for
the others) writes public/assets/maps/<id>/thumb.jpg (384 x 216).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    "european-town": ROOT / "docs" / "previews" / "aerial.png",
    "industrial-complex": ROOT / "docs" / "previews" / "industrial-complex" / "aerial.png",
    "modern-city": ROOT / "docs" / "previews" / "modern-city" / "aerial.png",
}


def main() -> None:
    for map_id, src in SOURCES.items():
        if not src.exists():
            print(f"skip {map_id}: no {src.relative_to(ROOT)}")
            continue
        im = Image.open(src).convert("RGB")
        # centre-crop to 16:9, then downscale
        w, h = im.size
        tw = min(w, int(h * 16 / 9))
        th = int(tw * 9 / 16)
        im = im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th)).resize((384, 216), Image.LANCZOS)
        out = ROOT / "public" / "assets" / "maps" / map_id / "thumb.jpg"
        out.parent.mkdir(parents=True, exist_ok=True)
        im.save(out, "JPEG", quality=84, optimize=True, progressive=True)
        print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
