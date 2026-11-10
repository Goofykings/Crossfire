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


# --- bush foliage atlas -----------------------------------------------------------------------------------
def _leaf_outline(length, width, steps=14, round_base=0.0, tip=1.0):
    """Closed outline (list of (x, y) with the stalk at the origin, the tip at +y) of a leaf: pointed oval,
    widest a third of the way up, slightly asymmetric."""
    left, right = [], []
    for k in range(steps + 1):
        s = k / steps
        w = width * (math.sin(math.pi * min(1.0, s ** (0.8 + .35 * (1 - tip)))) ** 0.78) * (1 - .22 * s) * (1 - round_base * (1 - s) ** 3)
        left.append((-w * 0.52, s * length))
        right.append((w * 0.48, s * length))
    return left + right[::-1]


def _draw_leaf(d, base, ang, length, width, color, light, rnd, round_base=0.0, tip=1.0, scale=1.0):
    """One leaf with a stalk at `base`, pointing along `ang` (radians from +y, clockwise), midrib and vein marks."""
    ca, sa = math.cos(ang), math.sin(ang)
    def tf(pt):
        x, y = pt
        return (base[0] + (x * ca + y * sa) * scale, base[1] - (y * ca - x * sa) * scale)
    outline = _leaf_outline(length, width, round_base=round_base, tip=tip)
    d.polygon([tf(p) for p in outline], fill=color)
    # lighter sheen on the sun side, then the midrib and the side veins
    inner = [(x * .55, y * .92 + length * .04) for (x, y) in outline]
    d.polygon([tf(p) for p in inner], fill=light)
    rib = (max(0, color[0] - 34), max(0, color[1] - 30), max(0, color[2] - 22), 255)
    d.line([tf((0, length * .02)), tf((0, length * .93))], fill=rib, width=max(1, int(width * scale * .07)))
    for k in range(1, 5):
        yy = length * (.14 + .17 * k)
        ww = width * (.34 - .045 * k)
        d.line([tf((0, yy)), tf((-ww, yy + length * .09))], fill=rib, width=1)
        d.line([tf((0, yy)), tf((ww, yy + length * .09))], fill=rib, width=1)


def _spray(cell, kind, rnd):
    """One foliage cell (RGBA): twigs from the bottom centre with leaves along them; transparent elsewhere.
    Leaves are drawn back to front: the deepest are the darkest, so the card has depth without lighting.
    Kinds 0 and 2 are single sprays (long leaf, broadleaf); 1 and 3 are fanned clusters of several twigs (dense and fine)."""
    N = 1024    # drawn at 2x and reduced for clean alpha edges
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    greens = [(38, 78, 28), (46, 92, 32), (58, 108, 36), (70, 124, 40), (84, 138, 46), (62, 112, 52)]
    lights = [(72, 120, 44), (86, 138, 50), (100, 152, 56), (116, 166, 62), (132, 178, 70), (96, 146, 70)]
    cfg = {0: dict(n=26, L=(170, 270), W=(52, 80), twig=.9, spread=70, rb=0.0, tip=1.0, twigs=[0.0]),
           1: dict(n=24, L=(110, 170), W=(40, 62), twig=.8, spread=80, rb=0.0, tip=1.0, twigs=[-.62, -.3, 0.0, .3, .62]),
           2: dict(n=15, L=(180, 280), W=(110, 160), twig=.72, spread=62, rb=.45, tip=.55, twigs=[0.0]),
           3: dict(n=34, L=(60, 100), W=(26, 42), twig=.88, spread=92, rb=.2, tip=.7, twigs=[-.5, -.18, .18, .5])}[kind]
    stem = (118, 86, 54, 255)
    leaves = []
    for ti, fan in enumerate(cfg['twigs']):
        bend = rnd.uniform(-40, 40)
        length = N * cfg['twig'] * (1.0 if abs(fan) < .1 else .82)
        ca, sa = math.cos(fan), math.sin(fan)
        def at(t):
            # twig point at fraction t along a twig that fans out by `fan` radians and curves by `bend`
            x = N / 2 + (sa * t * length) + bend * t * t
            y = N - 10 - ca * t * length
            return x, y
        d.line([at(i / 24) for i in range(25)], fill=stem, width=9 if abs(fan) < .1 else 6)
        for i in range(cfg['n']):
            t = .1 + .88 * (i + rnd.uniform(0, .8)) / (cfg['n'] + .5)
            px, py = at(t)
            side = -1 if i % 2 == 0 else 1
            spread = math.radians(cfg['spread'] * (1.05 - .55 * t) + rnd.uniform(-14, 14))
            ang = fan + side * spread + rnd.uniform(-.12, .12)
            scale = (1.05 - .5 * t) * rnd.uniform(.85, 1.1)
            leaves.append((t + ti * .001, (px, py), ang, rnd.uniform(*cfg['L']), rnd.uniform(*cfg['W']), scale))
        tx, ty = at(1.0)
        leaves.append((1.0, (tx, ty), fan + rnd.uniform(-.12, .12), cfg['L'][1] * .9, cfg['W'][1] * .9, .75))
    # back to front: the leaves nearest the base first (they sit behind the upper ones)
    leaves.sort(key=lambda l: l[0])
    for k, (t, base, ang, length, width, scale) in enumerate(leaves):
        ci = rnd.choice(range(len(greens)))
        shade = .7 + .3 * (k / len(leaves))
        color = tuple(int(c * shade) for c in greens[ci]) + (255,)
        light = tuple(int(c * shade) for c in lights[ci]) + (255,)
        # a short stalk, then the blade
        sx, sy = base[0] + math.sin(ang) * 16 * scale, base[1] - math.cos(ang) * 16 * scale
        d.line([base, (sx, sy)], fill=stem, width=4)
        _draw_leaf(d, (sx, sy), ang, length, width, color, light, rnd, cfg['rb'], cfg['tip'], scale)
    return img.resize((512, 512), Image.LANCZOS)


def bush_leaves() -> None:
    """Foliage atlas for the bush and hedge cards: four 512 px sprays (tall, bushy, broadleaf, fine twig) in a 2 x 2 grid.
    Row 0 is the top of the image; every spray stands on the bottom centre of its cell. Colour is deliberately a little
    desaturated and dark: the material tint and the baked vertex shading lift it."""
    rnd = random.Random(8101)
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for kind in range(4):
        cell = _spray(None, kind, rnd)
        atlas.paste(cell, ((kind % 2) * 512, (kind // 2) * 512))
    # bleed the edge colour into transparent pixels so mip levels and filtering never show a pale fringe
    bg = Image.new("RGBA", atlas.size, (44, 84, 34, 0))
    bg.alpha_composite(atlas)
    atlas = bg.filter(ImageFilter.GaussianBlur(0)) if False else bg
    atlas.save(OUT / "bush_leaves.png", optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    leaves()
    hay()
    bush_leaves()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
