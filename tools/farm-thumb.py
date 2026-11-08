"""Crops test-results/farm/thumb-source.png (tools/farm-thumb.mjs) to the Farmstead menu thumbnail, 384 x 216."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
im = Image.open(ROOT / "test-results" / "farm" / "thumb-source.png").convert("RGB")
w, h = im.size
tw = min(w, int(h * 16 / 9))
th = int(tw * 9 / 16)
im = im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th)).resize((384, 216), Image.LANCZOS)
out = ROOT / "public" / "assets" / "maps" / "farmstead" / "thumb.jpg"
out.parent.mkdir(parents=True, exist_ok=True)
im.save(out, "JPEG", quality=84, optimize=True, progressive=True)
print("wrote", out.relative_to(ROOT))
