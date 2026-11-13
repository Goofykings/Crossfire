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


# --- ivy / vine / weed atlas for the perimeter wall ---------------------------------------------------------
def _ivy_leaf(d, base, ang, size, color, light, vein, scale=1.0):
    """One palmate ivy leaf with a petiole at `base`, pointing along `ang` (radians from +y, clockwise)."""
    ca, sa = math.cos(ang), math.sin(ang)

    def tf(pt):
        x, y = pt
        return (base[0] + (x * ca + y * sa) * scale, base[1] - (y * ca - x * sa) * scale)

    def lobe(cx, cy, length, width, rot):
        """Pointed oval from (cx, cy) growing along local angle `rot` (0 = +y)."""
        out_l, out_r = [], []
        for k in range(11):
            t = k / 10
            w = width * math.sin(math.pi * t ** .85) ** .8 * (1 - .25 * t)
            for px, out in ((-w / 2, out_l), (w / 2, out_r)):
                py = t * length
                out.append((cx + px * math.cos(rot) + py * math.sin(rot), cy - px * math.sin(rot) + py * math.cos(rot)))
        return out_l + out_r[::-1]

    s = size
    shapes = [lobe(0, s * .12, s * .86, s * .5, 0.0),
              lobe(-s * .06, s * .16, s * .58, s * .36, -.95), lobe(s * .06, s * .16, s * .58, s * .36, .95),
              lobe(-s * .04, s * .04, s * .34, s * .3, -1.9), lobe(s * .04, s * .04, s * .34, s * .3, 1.9)]
    for shape in shapes:
        d.polygon([tf(p) for p in shape], fill=color)
    inner = [lobe(0, s * .16, s * .62, s * .3, 0.0), lobe(-s * .06, s * .18, s * .4, s * .2, -.95), lobe(s * .06, s * .18, s * .4, s * .2, .95)]
    for shape in inner:
        d.polygon([tf(p) for p in shape], fill=light)
    for rot, ln in ((0.0, .84), (-.95, .52), (.95, .52), (-1.9, .28), (1.9, .28)):
        d.line([tf((0, s * .1)), tf((math.sin(rot) * -ln * s, s * .1 + math.cos(rot) * ln * s))], fill=vein, width=max(1, int(s * scale * .03)))


def _ivy_cell(kind, rnd):
    N = 1024
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    greens = [(26, 62, 30), (34, 76, 34), (44, 90, 38), (54, 104, 42), (64, 116, 48), (40, 84, 52)]
    lights = [(52, 98, 44), (62, 112, 46), (74, 128, 50), (88, 142, 56), (100, 154, 62), (70, 120, 64)]
    stem = (84, 62, 42, 255)

    def colors(shade, new=.07, old=.04):
        i = rnd.randrange(len(greens))
        c, l = greens[i], lights[i]
        r = rnd.random()
        if r < new:
            c, l = (96, 140, 52), (130, 172, 70)           # fresh pale growth
        elif r < new + old:
            c, l = (118, 112, 40), (150, 140, 56)          # a yellowing leaf
        dark = (max(0, int(c[0] * shade) - 18), max(0, int(c[1] * shade) - 16), max(0, int(c[2] * shade) - 10), 255)
        return tuple(int(v * shade) for v in c) + (255,), tuple(int(v * shade) for v in l) + (255,), dark

    leaves = []
    if kind == 0:       # a climbing vine: a sinuous woody stem with alternate leaves, smaller toward the tip, and tendrils
        pts, x, y, a = [], N / 2, N - 10, 0.0
        for i in range(61):
            pts.append((x, y))
            a += rnd.uniform(-.09, .09) - a * .06
            x += math.sin(a) * 15
            y -= math.cos(a) * 15
        d.line(pts, fill=stem, width=11, joint="curve")
        d.line(pts, fill=(112, 86, 58, 255), width=4)
        for i in range(2, 60, 2):
            t = i / 60
            px, py = pts[i]
            side = 1 if (i // 2) % 2 else -1
            ang = side * rnd.uniform(.7, 1.15) + rnd.uniform(-.15, .15)
            leaves.append((t, (px, py), ang, 170 * (1.05 - .55 * t) * rnd.uniform(.85, 1.1)))
            if i % 6 == 0:                                  # aerial rootlets and tendrils
                d.line([(px, py), (px + side * rnd.uniform(14, 34), py + rnd.uniform(8, 26))], fill=stem, width=3)
        leaves.append((1.0, pts[-1], rnd.uniform(-.2, .2), 130))
    elif kind == 1:     # a dense patch: leaves fanning out of the bottom centre, overlapping into a mass
        for i in range(70):
            r = rnd.random()
            ang = rnd.uniform(-1.35, 1.35)
            dist = 60 + 330 * math.sqrt(r) * (1 - .25 * abs(ang) / 1.35)
            px, py = N / 2 + math.sin(ang) * dist * 1.05, N - 30 - math.cos(ang) * dist * .95
            leaves.append((r, (px, py), ang + rnd.uniform(-.7, .7), 120 * rnd.uniform(.75, 1.2)))
            if i % 9 == 0:
                d.line([(N / 2, N - 20), (px, py)], fill=stem, width=5)
    elif kind == 2:     # a weed tuft from a crack: grass blades, a few round leaves and tiny pale flowers
        for i in range(34):
            a = rnd.uniform(-.75, .75)
            L = rnd.uniform(300, 720) * (1 - abs(a) * .35)
            bx = N / 2 + rnd.uniform(-70, 70)
            tipx, tipy = bx + math.sin(a) * L + rnd.uniform(-60, 60), N - 12 - math.cos(a) * L
            c = rnd.choice(((58, 104, 34, 255), (74, 122, 40, 255), (46, 88, 30, 255), (92, 134, 50, 255)))
            wb = rnd.uniform(11, 20)
            d.polygon([(bx - wb, N - 12), (bx + wb, N - 12), (tipx, tipy)], fill=c)
            d.line([(bx, N - 12), (tipx, tipy)], fill=tuple(min(255, v + 26) for v in c[:3]) + (255,), width=3)
        for i in range(9):
            a = rnd.uniform(-1.1, 1.1)
            leaves.append((rnd.random(), (N / 2 + rnd.uniform(-60, 60), N - 20), a, 95 * rnd.uniform(.7, 1.1)))
        for i in range(5):
            fx, fy = N / 2 + rnd.uniform(-190, 190), N - rnd.uniform(300, 640)
            d.ellipse((fx - 15, fy - 15, fx + 15, fy + 15), fill=rnd.choice(((236, 232, 214, 255), (240, 214, 92, 255))))
            d.ellipse((fx - 6, fy - 6, fx + 6, fy + 6), fill=(196, 150, 40, 255))
    else:               # a moss and fern tuft: low rounded mound of tiny leaflets with a few small fronds
        for i in range(520):
            ang = rnd.uniform(-1.5, 1.5)
            dist = 330 * math.sqrt(rnd.random()) * (1 - .35 * abs(ang) / 1.5)
            px, py = N / 2 + math.sin(ang) * dist * 1.3, N - 18 - math.cos(ang) * dist * .72
            r = rnd.uniform(8, 20)
            c = rnd.choice(((54, 92, 34, 255), (68, 108, 40, 255), (80, 122, 48, 255), (44, 78, 30, 255), (96, 138, 56, 255)))
            d.ellipse((px - r, py - r * .8, px + r, py + r * .8), fill=c)
        for f in range(16):
            # small clover-like leaves on thin stalks standing out of the mound
            a0 = rnd.uniform(-.9, .9)
            L = rnd.uniform(110, 300)
            bx, by = N / 2 + math.sin(a0) * rnd.uniform(0, 200), N - 60
            tx, ty = bx + math.sin(a0) * L * .5, by - math.cos(a0) * L
            d.line([(bx, by), (tx, ty)], fill=(70, 100, 44, 255), width=4)
            c = rnd.choice(((70, 112, 42, 255), (86, 128, 50, 255), (58, 98, 38, 255)))
            for ox, oy in ((-14, 4), (14, 4), (0, -14)):
                d.ellipse((tx + ox - 17, ty + oy - 15, tx + ox + 17, ty + oy + 15), fill=c)
    leaves.sort(key=lambda l: l[0])
    for k, (t, base, ang, size) in enumerate(leaves):
        shade = .72 + .28 * (k / max(1, len(leaves)))
        c, l, v = colors(shade)
        sx, sy = base[0] + math.sin(ang) * 10, base[1] - math.cos(ang) * 10
        d.line([base, (sx, sy)], fill=stem, width=4)
        _ivy_leaf(d, (sx, sy), ang, size, c, l, v)
    return img.resize((512, 512), Image.LANCZOS)


def ivy_leaves() -> None:
    """Wall-vegetation atlas (2 x 2, row 0 = top): 0 vine strand, 1 dense ivy patch, 2 weed tuft with flowers, 3 moss and fern tuft.
    Every cell stands on its bottom centre like the bush atlas; edge colour is bled into transparent pixels."""
    rnd = random.Random(5521)
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for kind in range(4):
        atlas.paste(_ivy_cell(kind, rnd), ((kind % 2) * 512, (kind // 2) * 512))
    bg = Image.new("RGBA", atlas.size, (36, 70, 30, 0))
    bg.alpha_composite(atlas)
    bg.save(OUT / "ivy_leaves.png", optimize=True)


def main() -> None:
    import sys
    OUT.mkdir(parents=True, exist_ok=True)
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    for name, fn in (("leaves", leaves), ("hay", hay), ("bush_leaves", bush_leaves), ("ivy", ivy_leaves)):
        # `python tools/make_farm_textures.py ivy` rewrites just one atlas; with no argument the ivy atlas is not touched
        if (not only and name != "ivy") or name in only:
            fn()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
