"""Original procedural textures for the Farmstead map (Pillow only, deterministic).

Usage: python -B -I tools/make_farm_textures.py

Writes public/assets/textures/farmstead/: leaves.jpg (mottled foliage), hay.jpg (straw), field_poster.jpg is not
needed. Both are seamless: every mark is drawn at the nine wrapped offsets.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "textures" / "farmstead"
S = 512


def wrap(draw_fn, size=S):
    """Call draw_fn(offset_x, offset_y) for the nine wrapped copies."""
    for ox in (-size, 0, size):
        for oy in (-size, 0, size):
            draw_fn(ox, oy)


def leaves() -> None:
    rnd = random.Random(2611)
    img = Image.new("RGB", (S, S), (58, 96, 38))
    d = ImageDraw.Draw(img)
    palette = [(46, 82, 30), (66, 112, 42), (80, 128, 50), (54, 94, 34), (96, 140, 58), (38, 70, 26)]
    for _ in range(2600):
        x, y = rnd.uniform(0, S), rnd.uniform(0, S)
        r = rnd.uniform(5, 15)
        a = rnd.uniform(0, math.pi)
        col = rnd.choice(palette)
        pts = []
        for k in range(10):
            t = 2 * math.pi * k / 10
            px, py = math.cos(t) * r, math.sin(t) * r * .45
            pts.append((x + px * math.cos(a) - py * math.sin(a), y + px * math.sin(a) + py * math.cos(a)))
        wrap(lambda ox, oy: d.polygon([(p[0] + ox, p[1] + oy) for p in pts], fill=col))
    # shadow pockets and sun glints give the canopy depth under a flat tint
    glow = Image.new("L", (S, S), 128)
    g = ImageDraw.Draw(glow)
    for _ in range(90):
        x, y, r = rnd.uniform(0, S), rnd.uniform(0, S), rnd.uniform(18, 46)
        v = rnd.choice((60, 70, 190, 200))
        wrap(lambda ox, oy: g.ellipse((x - r + ox, y - r + oy, x + r + ox, y + r + oy), fill=v))
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    shade = Image.merge("RGB", (glow, glow, glow))
    img = Image.blend(img, Image.composite(img, Image.new("RGB", (S, S), (0, 0, 0)), glow), .0)
    px = img.load(); gp = glow.load()
    for yy in range(S):
        for xx in range(S):
            k = .62 + gp[xx, yy] / 255 * .76
            r, gc, b = px[xx, yy]
            px[xx, yy] = (min(255, int(r * k)), min(255, int(gc * k)), min(255, int(b * k)))
    img.save(OUT / "leaves.jpg", quality=88)


def hay() -> None:
    rnd = random.Random(1741)
    img = Image.new("RGB", (S, S), (176, 142, 64))
    d = ImageDraw.Draw(img)
    palette = [(205, 172, 84), (188, 150, 66), (158, 124, 52), (222, 190, 104), (140, 108, 46)]
    for _ in range(5200):
        x, y = rnd.uniform(0, S), rnd.uniform(0, S)
        L = rnd.uniform(14, 48)
        a = rnd.gauss(0, .5) + (0 if rnd.random() < .6 else math.pi / 2)
        col = rnd.choice(palette)
        x1, y1 = x + math.cos(a) * L, y + math.sin(a) * L
        wrap(lambda ox, oy: d.line((x + ox, y + oy, x1 + ox, y1 + oy), fill=col, width=rnd.choice((1, 2, 2, 3))))
    img = img.filter(ImageFilter.GaussianBlur(.6))
    img.save(OUT / "hay.jpg", quality=88)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    leaves()
    hay()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
