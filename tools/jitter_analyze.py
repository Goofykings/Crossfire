"""Compare the frames written by tools/dev-jitter.mjs.

For each view, frame 0 is the reference. Pixels near edges (where a sub-pixel camera move legitimately changes the
image) and the area where the weapon would be are excluded; in what remains, a stable scene changes very little between
frames, while a z-fight rewrites its pattern. Prints the share of those flat pixels that changed by more than 40/255.

    python -I tools/jitter_analyze.py [test-results/jitter] [--save-diffs]
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

THRESH = 40
FLAG = 0.05  # percent of flat pixels


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = Path(args[0] if args else "test-results/jitter")
    save = "--save-diffs" in sys.argv
    views: dict[str, list[tuple[int, Path]]] = defaultdict(list)
    for f in sorted(root.glob("*__*.png")):
        m = re.match(r"(.+)__(\d+)\.png", f.name)
        views[m.group(1)].append((int(m.group(2)), f))
    print(f"{'view':28} {'flat px':>9} {'changed px (max)':>17} {'share %':>8}")
    flagged = []
    for name, frames in views.items():
        frames.sort()
        ref = Image.open(frames[0][1]).convert("L")
        w, h = ref.size
        edges = ref.filter(ImageFilter.GaussianBlur(0.8)).filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 14 else 0)
        busy = edges.filter(ImageFilter.MaxFilter(9))
        flat = busy.point(lambda v: 0 if v else 255)
        # nothing to compare where the weapon would be drawn
        mask = Image.new("L", (w, h), 255)
        flat = ImageChops.multiply(flat, mask)
        n_flat = sum(flat.histogram()[255:])
        worst = 0
        worst_img = None
        for _, f in frames[1:]:
            d = ImageChops.difference(ref, Image.open(f).convert("L")).point(lambda v: 255 if v > THRESH else 0)
            d = ImageChops.multiply(d, flat)
            c = d.histogram()[255]
            if c > worst:
                worst, worst_img = c, d
        share = 100.0 * worst / max(1, n_flat)
        mark = "  <-- FLICKER" if share > FLAG else ""
        print(f"{name:28} {n_flat:9d} {worst:17d} {share:8.3f}{mark}")
        if share > FLAG:
            flagged.append(name)
        if save and worst_img is not None:
            worst_img.save(root / f"diff_{name}.png")
    print()
    print("flagged:", ", ".join(flagged) if flagged else "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
