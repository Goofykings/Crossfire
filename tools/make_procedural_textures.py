"""Generate the project's original procedural textures with Pillow.

Usage: python -I tools/make_procedural_textures.py

Outputs to public/assets/textures/european-town/ (map dressing), industrial-complex/ and modern-city/ (the two newer
maps), urban/ (shared by both: road paint, hazard stripes, fencing, blinds, signs), weapons/ (holographic reticle,
glove and sleeve fabric) and shared/fx/ (muzzle flash, bullet holes, sparks).
Deterministic: the same seed always produces the same images.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "blender" / "scripts" / "lib"))
import props  # noqa: E402  (pure Python: the target outline shared with the Blender model)

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "public" / "assets" / "textures" / "shared"
TOWN = ROOT / "public" / "assets" / "textures" / "european-town"
FX = SHARED / "fx"
URBAN = ROOT / "public" / "assets" / "textures" / "urban"
INDUSTRIAL = ROOT / "public" / "assets" / "textures" / "industrial-complex"
CITY = ROOT / "public" / "assets" / "textures" / "modern-city"
WEAPONS = ROOT / "public" / "assets" / "textures" / "weapons"
FONT_DIRS = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu"), Path("/Library/Fonts")]


def font(names: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for d in FONT_DIRS:
        for n in names:
            p = d / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def noise(size: int, scale: int, seed: int) -> Image.Image:
    rnd = random.Random(seed)
    small = Image.new("L", (max(2, size // scale), max(2, size // scale)))
    small.putdata([rnd.randint(0, 255) for _ in range(small.width * small.height)])
    return small.resize((size, size), Image.BICUBIC)


def painted_wood_grey() -> None:
    src = Image.open(SHARED / "wood_painted_albedo.jpg").convert("L")
    src = ImageOps.autocontrast(src, cutoff=1)
    # lift into a light grey so palette tints read as the paint colour
    src = src.point(lambda v: int(150 + v * 0.42))
    src.convert("RGB").save(TOWN / "wood_painted_grey.jpg", quality=88)


def canvas(colors: tuple[tuple[int, int, int], tuple[int, int, int]], name: str) -> None:
    s = 512
    img = Image.new("RGB", (s, s))
    d = ImageDraw.Draw(img)
    stripe = s // 8
    for i in range(8):
        d.rectangle([i * stripe, 0, (i + 1) * stripe, s], fill=colors[i % 2])
    weave = noise(s, 2, 11).point(lambda v: int(205 + v * 0.2))
    fade = noise(s, 64, 12).point(lambda v: int(215 + v * 0.16))
    img = ImageChops.multiply(img, Image.merge("RGB", [weave] * 3))
    img = ImageChops.multiply(img, Image.merge("RGB", [fade] * 3))
    img.save(TOWN / f"{name}.jpg", quality=88)


def sign(team: str, color: tuple[int, int, int]) -> None:
    w, h = 512, 320
    img = Image.new("RGBA", (w, h), (30, 26, 22, 255))
    d = ImageDraw.Draw(img)
    # wooden board with iron frame
    for y in range(0, h, 40):
        shade = 34 + (y // 40 % 2) * 6
        d.rectangle([0, y, w, y + 38], fill=(shade, shade - 4, shade - 8, 255))
    d.rectangle([6, 6, w - 7, h - 7], outline=(90, 92, 96, 255), width=8)
    # emblem: shield
    cx, cy = 104, h // 2
    shield = [(cx - 58, cy - 72), (cx + 58, cy - 72), (cx + 58, cy + 8), (cx, cy + 78), (cx - 58, cy + 8)]
    d.polygon(shield, fill=color + (255,), outline=(235, 235, 235, 255))
    d.line([(cx, cy - 54), (cx, cy + 50)], fill=(245, 245, 245, 255), width=10)
    d.line([(cx - 36, cy - 10), (cx + 36, cy - 10)], fill=(245, 245, 245, 255), width=10)
    f1 = font(["arialbd.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"], 50)
    f2 = font(["arial.ttf", "DejaVuSans.ttf", "Arial.ttf"], 30)
    d.text((190, 92), team.upper(), font=f1, fill=color + (255,))
    d.text((190, 152), "SAFE ZONE", font=f1, fill=(240, 236, 228, 255))
    d.text((192, 216), "no damage inside", font=f2, fill=(190, 186, 178, 255))
    img.save(TOWN / f"sign_{team}.png")


def leaf_cluster(name: str, flowers: bool, seed: int) -> None:
    s = 512
    rnd = random.Random(seed)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    greens = [(52, 92, 38), (66, 110, 44), (40, 78, 32), (84, 124, 52), (58, 100, 36)]
    for _ in range(900):
        x, y = rnd.uniform(20, s - 20), rnd.uniform(20, s - 20)
        # denser towards the middle so cards read as rounded clumps
        if math.hypot(x - s / 2, y - s / 2) > s * 0.48 * rnd.uniform(0.75, 1.0):
            continue
        L = rnd.uniform(14, 30)
        W = L * rnd.uniform(0.38, 0.55)
        a = rnd.uniform(0, math.pi * 2)
        pts = []
        for k in range(10):
            t = k / 9 * math.pi
            px = math.cos(t) * L / 2
            py = math.sin(t) * W / 2 * (1 if k < 10 else -1)
            pts.append((px, py))
        pts += [(p[0], -p[1]) for p in reversed(pts)]
        rot = [(x + px * math.cos(a) - py * math.sin(a), y + px * math.sin(a) + py * math.cos(a)) for px, py in pts]
        g = rnd.choice(greens)
        k = rnd.uniform(0.8, 1.2)
        d.polygon(rot, fill=(int(g[0] * k), int(g[1] * k), int(g[2] * k), 255))
        d.line([rot[0], rot[len(rot) // 2]], fill=(30, 60, 24, 255), width=1)
    if flowers:
        palette = [(214, 48, 52), (236, 120, 160), (245, 240, 235), (240, 196, 60), (150, 80, 190), (230, 90, 40)]
        for _ in range(170):
            x, y = rnd.uniform(40, s - 40), rnd.uniform(40, s - 40)
            if math.hypot(x - s / 2, y - s / 2) > s * 0.42:
                continue
            c = rnd.choice(palette)
            r = rnd.uniform(5, 10)
            for p in range(5):
                a = p / 5 * math.pi * 2 + rnd.random()
                d.ellipse([x + math.cos(a) * r * 0.7 - r * 0.55, y + math.sin(a) * r * 0.7 - r * 0.55,
                           x + math.cos(a) * r * 0.7 + r * 0.55, y + math.sin(a) * r * 0.7 + r * 0.55], fill=c + (255,))
            d.ellipse([x - r * 0.35, y - r * 0.35, x + r * 0.35, y + r * 0.35], fill=(250, 210, 80, 255))
    img.save(TOWN / f"{name}.png")


def produce() -> None:
    s = 512
    rnd = random.Random(5)
    img = Image.new("RGB", (s, s), (60, 40, 25))
    d = ImageDraw.Draw(img)
    kinds = [((230, 120, 20), 22), ((200, 30, 30), 20), ((120, 170, 60), 30), ((240, 200, 40), 18),
             ((90, 30, 90), 14), ((210, 90, 40), 24)]
    for q in range(4):
        qx, qy = (q % 2) * s // 2, (q // 2) * s // 2
        col, r = kinds[(q * 2 + 1) % len(kinds)] if q % 2 else kinds[q]
        for _ in range(140):
            x, y = qx + rnd.uniform(r, s / 2 - r), qy + rnd.uniform(r, s / 2 - r)
            k = rnd.uniform(0.75, 1.1)
            c = tuple(int(v * k) for v in col)
            d.ellipse([x - r, y - r, x + r, y + r], fill=c, outline=tuple(int(v * 0.6) for v in c))
            d.ellipse([x - r * 0.5, y - r * 0.6, x - r * 0.1, y - r * 0.2], fill=tuple(min(255, int(v * 1.35)) for v in c))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(TOWN / "produce.jpg", quality=88)


SHOP_NAMES = ["BÄCKEREI", "CAFFÈ", "FROMAGERIE", "LIBRERIA", "OSTERIA", "APOTHEKE", "BOUCHERIE", "VINI"]


def shop_signs() -> None:
    """2x4 atlas of painted shop boards (each cell 512x128)."""
    w, h = 1024, 512
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    rnd = random.Random(9)
    boards = [(40, 60, 50), (90, 30, 28), (30, 40, 70), (70, 50, 30), (20, 20, 22), (60, 70, 40), (110, 80, 30),
              (50, 30, 50)]
    f = font(["georgiab.ttf", "timesbd.ttf", "DejaVuSerif-Bold.ttf", "arialbd.ttf"], 64)
    for i, name in enumerate(SHOP_NAMES):
        cx, cy = (i % 2) * 512, (i // 2) * 128
        bg = boards[i]
        d.rectangle([cx, cy, cx + 511, cy + 127], fill=bg)
        d.rectangle([cx + 8, cy + 8, cx + 503, cy + 119], outline=(205, 170, 90), width=4)
        tw = d.textlength(name, font=f)
        d.text((cx + 256 - tw / 2, cy + 22), name, font=f, fill=(232, 210, 150))
    grain = noise(w, 3, 21).resize((w, h)).point(lambda v: int(200 + v * 0.22))
    img = ImageChops.multiply(img, Image.merge("RGB", [grain] * 3))
    img.save(TOWN / "shop_signs.jpg", quality=90)


def target_face() -> None:
    """Face of the steel silhouette target: painted plate, head and body scoring zones, dark rim.

    Pixel (c, r) shows x = u0 - c / W * width, y = v0 + (1 - r / H) * height on the plate (props.TARGET_UV): the
    image reads as seen from the front, head at the top (the material loads it unflipped, like the sign atlases).
    """
    W, H = 600, 1000
    u0, v0, uw, vh = props.TARGET_UV

    def px(x, y):
        return ((u0 - x) / uw * W, (1 - (y - v0) / vh) * H)

    img = Image.new("RGB", (W, H), (226, 222, 211))
    grain = noise(W, 6, 31).resize((W, H)).point(lambda v: int(232 + v * 0.09))
    img = ImageChops.multiply(img, Image.merge("RGB", [grain] * 3))
    d = ImageDraw.Draw(img)
    outline = [px(x, y) for x, y in props.target_outline()]
    d.line(outline + [outline[0]], fill=(52, 50, 47), width=12, joint="curve")
    hy, hx, hh = props.TARGET_HEAD
    # head zone (1.5x damage): red ring and centre cross
    cx, cy = px(0.0, hy)
    rx, ry = hx * 0.62 / uw * W, hh * 0.62 / vh * H
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(176, 34, 28), width=7)
    d.line([(cx - 18, cy), (cx + 18, cy)], fill=(176, 34, 28), width=4)
    d.line([(cx, cy - 18), (cx, cy + 18)], fill=(176, 34, 28), width=4)
    # body zones: chest box and lower torso box
    for (x0, y0, x1, y1, w) in ((-0.08, 0.27, 0.08, 0.47, 6), (-0.15, 0.1, 0.15, 0.5, 4)):
        a, b = px(x0, y1), px(x1, y0)
        d.rectangle([min(a[0], b[0]), a[1], max(a[0], b[0]), b[1]], outline=(70, 68, 64), width=w)
    img.filter(ImageFilter.GaussianBlur(0.6)).save(TOWN / "target_face.png")


def radial(name: str, size: int, color: tuple[int, int, int], falloff: float, rings: bool = False) -> None:
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            r = math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2)
            a = max(0.0, 1 - r) ** falloff
            px[x, y] = (*color, int(255 * a))
    img.save(FX / f"{name}.png")


def bullet_hole() -> None:
    """Impact decal: a dark hole with a torn, lighter rim and fine dust around it."""
    s = 128
    rnd = random.Random(3)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    px = img.load()
    n = noise(s, 6, 4)
    for y in range(s):
        for x in range(s):
            r = math.hypot(x - s / 2, y - s / 2) / (s / 2)
            v = n.getpixel((x, y)) / 255
            rr = r * (0.9 + v * 0.25)
            if rr < 0.16:
                px[x, y] = (12, 11, 10, 255)
            elif rr < 0.26:
                k = (rr - 0.16) / 0.1
                c = int(40 + 70 * k)
                px[x, y] = (c, c - 4, c - 8, 255)
            elif rr < 0.95:
                a = (1 - (rr - 0.26) / 0.69) ** 2.2
                c = int(70 + 40 * v)
                px[x, y] = (c, c - 6, c - 12, int(150 * a))
    d = ImageDraw.Draw(img)
    for _ in range(9):
        a = rnd.uniform(0, math.pi * 2)
        r0, r1 = s * 0.12, s * rnd.uniform(0.22, 0.36)
        d.line([(s / 2 + math.cos(a) * r0, s / 2 + math.sin(a) * r0), (s / 2 + math.cos(a) * r1, s / 2 + math.sin(a) * r1)],
               fill=(30, 28, 26, 200), width=1)
    img.filter(ImageFilter.GaussianBlur(0.5)).save(FX / "bullet_hole.png")


def muzzle_flash() -> None:
    """Gunpowder muzzle flash: a white-hot core and ragged yellow-orange petals (front view), and a side view plume."""
    s = 256
    rnd = random.Random(8)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(5):
        a = i / 5 * math.pi * 2 + rnd.uniform(-0.25, 0.25)
        L = rnd.uniform(0.62, 0.98) * s / 2
        w = rnd.uniform(0.16, 0.26)
        pts = [(s / 2 + math.cos(a + w) * 18, s / 2 + math.sin(a + w) * 18), (s / 2 + math.cos(a) * L, s / 2 + math.sin(a) * L),
               (s / 2 + math.cos(a - w) * 18, s / 2 + math.sin(a - w) * 18)]
        d.polygon(pts, fill=(255, 160, 50, 240))
    img = img.filter(ImageFilter.GaussianBlur(2.5))
    mid = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(mid).ellipse([s / 2 - 52, s / 2 - 52, s / 2 + 52, s / 2 + 52], fill=(255, 205, 90, 210))
    img = Image.alpha_composite(img, mid.filter(ImageFilter.GaussianBlur(14)))
    core = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(core).ellipse([s / 2 - 26, s / 2 - 26, s / 2 + 26, s / 2 + 26], fill=(255, 250, 225, 255))
    img = Image.alpha_composite(img, core.filter(ImageFilter.GaussianBlur(8)))
    img.save(FX / "muzzle_flash.png")
    # side view: plume leaving the muzzle (left edge) toward the right, narrowing
    W, Hh = 256, 128
    side = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    sd = ImageDraw.Draw(side)
    for k in range(3):
        L = W * (0.95 - k * 0.22)
        h = Hh * (0.34 - k * 0.07)
        col = [(255, 140, 35, 150), (255, 190, 80, 200), (255, 245, 210, 255)][k]
        sd.polygon([(6, Hh / 2 - h * 0.35), (L * 0.45, Hh / 2 - h), (L, Hh / 2), (L * 0.45, Hh / 2 + h), (6, Hh / 2 + h * 0.35)], fill=col)
    side = side.filter(ImageFilter.GaussianBlur(5))
    side.save(FX / "muzzle_flash_side.png")


# --------------------------------------------------------------------------------------------------
# Industrial Complex / Modern City
# --------------------------------------------------------------------------------------------------
def paint_wear() -> None:
    """White road/floor paint with worn-through holes in the alpha (alpha-tested, tinted per material)."""
    s = 512
    coarse = noise(s, 48, 31)
    mid = noise(s, 12, 32)
    fine = noise(s, 3, 33)
    a = ImageChops.add(ImageChops.multiply(coarse, mid), fine.point(lambda v: v // 3))
    alpha = a.point(lambda v: 255 if v > 58 else 0).filter(ImageFilter.MedianFilter(3))
    dirt = ImageChops.multiply(noise(s, 20, 34).point(lambda v: int(205 + v * 0.2)), fine.point(lambda v: int(225 + v * 0.12)))
    img = Image.merge("RGBA", [dirt, dirt, dirt, alpha])
    img.save(URBAN / "paint_wear.png")


def hazard_stripes() -> None:
    s = 512
    img = Image.new("RGB", (s, s))
    d = ImageDraw.Draw(img)
    band = s // 4
    for i in range(-8, 8):
        x = i * band
        d.polygon([(x, 0), (x + band / 2, 0), (x + band / 2 + s, s), (x + s, s)], fill=(222, 170, 20))
        d.polygon([(x + band / 2, 0), (x + band, 0), (x + band + s, s), (x + band / 2 + s, s)], fill=(24, 22, 20))
    wear = noise(s, 6, 41).point(lambda v: int(190 + v * 0.25))
    blot = noise(s, 40, 42).point(lambda v: int(170 + v * 0.33))
    img = ImageChops.multiply(img, Image.merge("RGB", [wear] * 3))
    img = ImageChops.multiply(img, Image.merge("RGB", [blot] * 3))
    img.save(URBAN / "hazard_stripes.jpg", quality=88)


def chainlink() -> None:
    """One diamond-mesh tile (wires with alpha), drawn at 4x and filtered down for clean edges."""
    s = 1024
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    n = 4
    step = s / n
    col = (168, 172, 172, 255)
    for i in range(-n, 2 * n + 1):
        x = i * step
        d.line([(x, 0), (x + s, s)], fill=col, width=18)
        d.line([(x, s), (x + s, 0)], fill=col, width=18)
    img = img.resize((256, 256), Image.LANCZOS)
    img.save(URBAN / "chainlink.png")


def blinds() -> None:
    """Half-drawn venetian blinds behind glass: what most windows show instead of an interior."""
    w, h = 256, 512
    img = Image.new("RGB", (w, h), (34, 36, 40))
    d = ImageDraw.Draw(img)
    rnd = random.Random(51)
    drop = int(h * 0.58)
    for y in range(0, drop, 12):
        shade = 150 + rnd.randint(-8, 8)
        d.rectangle([0, y, w, y + 9], fill=(shade, shade - 4, shade - 12))
        d.line([(0, y + 9), (w, y + 9)], fill=(90, 88, 84), width=2)
    d.rectangle([0, drop, w, drop + 10], fill=(120, 116, 108))
    # a dim room below: a lamp glow and furniture silhouettes
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse([30, drop + 40, 220, drop + 220], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    room = Image.merge("RGB", [glow.point(lambda v: int(v * 0.9)), glow.point(lambda v: int(v * 0.75)),
                               glow.point(lambda v: int(v * 0.5))])
    img = ImageChops.add(img, room)
    d = ImageDraw.Draw(img)
    d.rectangle([20, h - 120, 120, h], fill=(26, 24, 24))
    d.rectangle([150, h - 80, 240, h], fill=(30, 28, 27))
    img.save(URBAN / "blinds.jpg", quality=86)


def oil_stains() -> None:
    s = 512
    rnd = random.Random(61)
    a = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(a)
    for _ in range(9):
        x, y, r = rnd.uniform(80, s - 80), rnd.uniform(80, s - 80), rnd.uniform(25, 70)
        d.ellipse([x - r, y - r * rnd.uniform(0.6, 1.0), x + r, y + r], fill=rnd.randint(90, 160))
    a = a.filter(ImageFilter.GaussianBlur(14))
    a = ImageChops.multiply(a, noise(s, 8, 62).point(lambda v: int(140 + v * 0.45)))
    img = Image.merge("RGBA", [Image.new("L", (s, s), 18), Image.new("L", (s, s), 16), Image.new("L", (s, s), 14), a])
    img.save(URBAN / "oil_stains.png")


def street_signs() -> None:
    """4x2 atlas (256 px cells) of original traffic and street-name signs, alpha outside the plates."""
    w, h = 1024, 512
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fb = font(["arialbd.ttf", "DejaVuSans-Bold.ttf"], 58)
    white, red = (240, 240, 236, 255), (178, 28, 30, 255)
    ink = (20, 20, 20, 255)
    # 0: stop octagon
    cx, cy, r = 128, 128, 116
    octagon = [(cx + r * math.cos(math.pi / 8 + k * math.pi / 4), cy + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    d.polygon(octagon, fill=white)
    inner = [(cx + (r - 10) * math.cos(math.pi / 8 + k * math.pi / 4), cy + (r - 10) * math.sin(math.pi / 8 + k * math.pi / 4))
             for k in range(8)]
    d.polygon(inner, fill=red)
    tw = d.textlength("STOP", font=fb)
    d.text((cx - tw / 2, cy - 34), "STOP", font=fb, fill=white)
    # 1: one way
    d.rectangle([256 + 8, 78, 512 - 8, 178], fill=(16, 16, 18, 255))
    d.polygon([(256 + 20, 128), (256 + 66, 88), (256 + 66, 106), (512 - 20, 106), (512 - 20, 150), (256 + 66, 150),
               (256 + 66, 168)], fill=white)
    f1 = font(["arialbd.ttf", "DejaVuSans-Bold.ttf"], 30)
    d.text((256 + 156 - d.textlength("ONE WAY", font=f1) / 2, 111), "ONE WAY", font=f1, fill=(16, 16, 18, 255))
    # 2: no parking
    cx = 512 + 128
    d.ellipse([cx - 110, 18, cx + 110, 238], fill=white)
    d.ellipse([cx - 98, 30, cx + 98, 226], fill=red)
    d.ellipse([cx - 82, 46, cx + 82, 210], fill=(40, 90, 170, 255))
    d.line([(cx - 64, 64), (cx + 64, 192)], fill=red, width=22)
    # 3: pedestrian crossing (diamond)
    cx = 768 + 128
    d.polygon([(cx, 10), (cx + 118, 128), (cx, 246), (cx - 118, 128)], fill=ink)
    d.polygon([(cx, 20), (cx + 108, 128), (cx, 236), (cx - 108, 128)], fill=(236, 196, 30, 255))
    d.ellipse([cx - 14, 62, cx + 14, 90], fill=ink)
    d.line([(cx, 92), (cx - 6, 150)], fill=ink, width=16)
    d.line([(cx - 6, 150), (cx - 34, 196)], fill=ink, width=14)
    d.line([(cx - 6, 150), (cx + 26, 196)], fill=ink, width=14)
    d.line([(cx - 2, 106), (cx + 32, 132)], fill=ink, width=12)
    d.line([(cx - 2, 106), (cx - 34, 128)], fill=ink, width=12)
    # bottom row: street-name plates
    names = ["MILL ST", "CANAL AVE", "5TH ST", "ORCHARD RD"]
    for i, n in enumerate(names):
        x0, y0 = i * 256 + 6, 256 + 72
        d.rounded_rectangle([x0, y0, x0 + 244, y0 + 112], radius=12, fill=(18, 92, 60, 255))
        d.rounded_rectangle([x0 + 6, y0 + 6, x0 + 238, y0 + 106], radius=9, outline=white, width=4)
        ff, size = _fit(d, n, ["arialbd.ttf", "DejaVuSans-Bold.ttf"], 40, 214)
        tw = d.textlength(n, font=ff)
        d.text((x0 + 122 - tw / 2, y0 + 56 - size * 0.6), n, font=ff, fill=white)
    img.save(URBAN / "street_signs.png")


INDUSTRIAL_SIGNS = [
    ("WAREHOUSE A", (24, 58, 120), (240, 240, 236)),
    ("WAREHOUSE B", (24, 58, 120), (240, 240, 236)),
    ("DOCK 1", (226, 178, 24), (22, 22, 22)),
    ("DOCK 2", (226, 178, 24), (22, 22, 22)),
    ("LOADING BAY", (36, 36, 38), (236, 190, 40)),
    ("NO SMOKING", (178, 30, 28), (240, 240, 236)),
    ("AUTHORISED ONLY", (240, 240, 236), (160, 26, 24)),
    ("FORKLIFT ROUTE", (226, 178, 24), (22, 22, 22)),
    ("BLOCK C", (40, 96, 64), (240, 240, 236)),
    ("STORES", (70, 72, 76), (240, 240, 236)),
    ("PUMP HOUSE", (40, 96, 64), (240, 240, 236)),
    ("FIRE EXIT", (32, 130, 72), (240, 240, 236)),
    ("NORTHGATE FREIGHT", (232, 230, 224), (32, 44, 86)),
    ("KESTREL STEELWORKS", (60, 30, 26), (230, 200, 150)),
    ("HALVERN COLD STORE", (230, 232, 236), (20, 90, 140)),
    ("UNIT 7", (36, 36, 38), (240, 240, 236)),
]

BOLD = ["bahnschrift.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]


def _fit(d, text, names, size, width):
    ff = font(names, size)
    while d.textlength(text, font=ff) > width and size > 30:
        size -= 4
        ff = font(names, size)
    return ff, size


def industrial_signs() -> None:
    """2x8 atlas (512x128 cells) of fictional company boards and site signage."""
    w, h = 1024, 1024
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for i, (text, bg, fg) in enumerate(INDUSTRIAL_SIGNS):
        cx, cy = (i % 2) * 512, (i // 2) * 128
        d.rectangle([cx, cy, cx + 511, cy + 127], fill=bg)
        d.rectangle([cx + 6, cy + 6, cx + 505, cy + 121], outline=fg, width=3)
        ff, size = _fit(d, text, BOLD, 62, 470)
        tw = d.textlength(text, font=ff)
        d.text((cx + 256 - tw / 2, cy + 64 - size * 0.62), text, font=ff, fill=fg)
        for bx in (cx + 16, cx + 496):
            for by in (cy + 16, cy + 112):
                d.ellipse([bx - 4, by - 4, bx + 4, by + 4], fill=(150, 150, 150))
    grime = ImageChops.multiply(noise(w, 30, 71).point(lambda v: int(170 + v * 0.33)),
                                noise(w, 3, 72).point(lambda v: int(215 + v * 0.16)))
    img = ImageChops.multiply(img, Image.merge("RGB", [grime] * 3))
    img.save(INDUSTRIAL / "signs_industrial.jpg", quality=88)


CITY_SHOPS = [
    ("CAFE NOVA", (34, 34, 36), (236, 196, 120)),
    ("PHARMACY", (24, 120, 76), (245, 245, 240)),
    ("BAKERY", (120, 56, 30), (246, 226, 190)),
    ("LAUNDROMAT", (30, 90, 160), (245, 245, 240)),
    ("PIZZA", (176, 32, 30), (250, 236, 200)),
    ("HARDWARE", (232, 170, 30), (26, 26, 26)),
    ("BOOKS", (36, 60, 50), (230, 214, 170)),
    ("BARBER", (240, 240, 236), (30, 50, 110)),
    ("DELI 24", (20, 20, 22), (120, 230, 120)),
    ("FLOWERS", (220, 150, 170), (40, 40, 44)),
    ("MINI MARKET", (200, 40, 40), (250, 250, 248)),
    ("NOODLE BAR", (240, 200, 40), (30, 30, 30)),
    ("GYM", (20, 20, 22), (255, 90, 60)),
    ("DINER", (40, 140, 160), (252, 240, 220)),
    ("TAILOR", (70, 40, 70), (236, 220, 236)),
    ("PARKING", (24, 70, 150), (250, 250, 250)),
]


def city_signs() -> None:
    """2x8 atlas (512x128 cells) of storefront fascia signs (fictional shops)."""
    w, h = 1024, 1024
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for i, (text, bg, fg) in enumerate(CITY_SHOPS):
        cx, cy = (i % 2) * 512, (i // 2) * 128
        d.rectangle([cx, cy, cx + 511, cy + 127], fill=bg)
        names = ["segoeuib.ttf", "bahnschrift.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"] if i % 3 else \
            ["impact.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
        ff, size = _fit(d, text, names, 74, 450)
        tw = d.textlength(text, font=ff)
        d.text((cx + 256 - tw / 2, cy + 64 - size * 0.64), text, font=ff, fill=fg)
        d.line([(cx + 30, cy + 112), (cx + 482, cy + 112)], fill=fg, width=3)
    img.save(CITY / "shop_signs_city.jpg", quality=90)


def posters() -> None:
    """2x2 atlas of original street posters (abstract shapes + generic words)."""
    s = 512
    img = Image.new("RGB", (s * 2, s * 2), (230, 228, 220))
    d = ImageDraw.Draw(img)
    rnd = random.Random(81)
    words = [("LIVE MUSIC", "FRI 9PM"), ("CITY RUN", "10K"), ("SALE", "-50%"), ("JAZZ NIGHT", "SAT")]
    palettes = [((235, 80, 60), (30, 40, 90)), ((40, 160, 140), (250, 220, 80)), ((250, 210, 40), (200, 30, 40)),
                ((70, 50, 120), (240, 150, 60))]
    fb = font(["impact.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"], 86)
    fs = font(BOLD, 54)
    for i, ((a, b), (c1, c2)) in enumerate(zip(words, palettes)):
        x0, y0 = (i % 2) * s, (i // 2) * s
        d.rectangle([x0, y0, x0 + s - 1, y0 + s - 1], fill=c1)
        for _ in range(6):
            r = rnd.uniform(40, 150)
            cx, cy = x0 + rnd.uniform(60, s - 60), y0 + rnd.uniform(60, s * 0.6)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=tuple(min(255, int(v * rnd.uniform(0.7, 1.2))) for v in c2))
        d.rectangle([x0, y0 + s * 0.66, x0 + s - 1, y0 + s - 1], fill=(20, 20, 22))
        d.text((x0 + 26, y0 + s * 0.68), a, font=fb, fill=(250, 250, 245))
        d.text((x0 + 28, y0 + s * 0.86), b, font=fs, fill=c2)
    paper = noise(s * 2, 4, 82).point(lambda v: int(215 + v * 0.16))
    img = ImageChops.multiply(img, Image.merge("RGB", [paper] * 3))
    img.save(CITY / "posters.jpg", quality=88)


def new_maps() -> None:
    for d in (URBAN, INDUSTRIAL, CITY):
        d.mkdir(parents=True, exist_ok=True)
    paint_wear()
    hazard_stripes()
    chainlink()
    blinds()
    oil_stains()
    street_signs()
    industrial_signs()
    city_signs()
    posters()


# --------------------------------------------------------------------------------------------------
# First-person weapons and hands (textures/weapons/)
# --------------------------------------------------------------------------------------------------
def reticle_holo() -> None:
    """Holographic sight reticle: a 65 MOA ring with a 1 MOA dot (and four ticks), red, on transparent black.

    Drawn additively at runtime, so the alpha also scales the brightness; supersampled for a crisp, anti-aliased ring.
    """
    s, k = 256, 4
    big = Image.new("L", (s * k, s * k), 0)
    d = ImageDraw.Draw(big)
    c = s * k / 2
    r = s * k * 0.42
    w = s * k * 0.028
    d.ellipse([c - r, c - r, c + r, c + r], outline=255, width=int(w))
    for ang in (0, 90, 180, 270):
        a = math.radians(ang)
        r0, r1 = r - w * 0.4, r - w * 3.2
        d.line([(c + math.cos(a) * r0, c + math.sin(a) * r0), (c + math.cos(a) * r1, c + math.sin(a) * r1)], fill=255, width=int(w * 0.9))
    dot = s * k * 0.032
    d.ellipse([c - dot, c - dot, c + dot, c + dot], fill=255)
    alpha = big.resize((s, s), Image.LANCZOS)
    glow = alpha.filter(ImageFilter.GaussianBlur(3)).point(lambda v: int(v * 0.45))
    alpha = ImageChops.lighter(alpha, glow)
    img = Image.merge("RGBA", [Image.new("L", (s, s), 255), Image.new("L", (s, s), 70), Image.new("L", (s, s), 50), alpha])
    img.save(WEAPONS / "reticle_holo.png")


def fabric() -> None:
    """Seamless woven fabric (gloves, sleeves): albedo, OpenGL normal map and ORM (AO, roughness, metallic)."""
    s = 512
    weave = Image.new("L", (s, s))
    px = weave.load()
    p = 8  # pixels per thread
    for y in range(s):
        for x in range(s):
            u, v = (x % p) / p, (y % p) / p
            over = ((x // p) + (y // p)) % 2 == 0
            # a thread runs across (warp) or along (weft) each cell: rounded cross-section
            h = math.sin(math.pi * (v if over else u)) ** 0.6
            px[x, y] = int(110 + 120 * h)
    lumps = noise(s, 32, 41).point(lambda v: int(228 + v * 0.1))
    height = ImageChops.multiply(weave, lumps).filter(ImageFilter.GaussianBlur(0.7))
    tone = noise(s, 64, 42).point(lambda v: int(200 + v * 0.2))
    albedo = ImageChops.multiply(Image.merge("RGB", [tone] * 3), Image.merge("RGB", [height.point(lambda v: int(150 + v * 0.42))] * 3))
    albedo.save(WEAPONS / "fabric_albedo.jpg", quality=90)
    hp = height.load()
    nrm = Image.new("RGB", (s, s))
    npx = nrm.load()
    k = 2.2 / 255
    for y in range(s):
        for x in range(s):
            dx = (hp[(x + 1) % s, y] - hp[(x - 1) % s, y]) * k
            dy = (hp[x, (y + 1) % s] - hp[x, (y - 1) % s]) * k
            nx, ny, nz = -dx, dy, 1.0  # OpenGL convention (+y up in the image)
            L = math.sqrt(nx * nx + ny * ny + nz * nz)
            npx[x, y] = (int((nx / L * 0.5 + 0.5) * 255), int((ny / L * 0.5 + 0.5) * 255), int((nz / L * 0.5 + 0.5) * 255))
    nrm.save(WEAPONS / "fabric_normal.jpg", quality=92)
    ao = height.point(lambda v: int(170 + v * 0.33))
    rough = Image.new("L", (s, s), 236)
    metal = Image.new("L", (s, s), 0)
    Image.merge("RGB", [ao, rough, metal]).save(WEAPONS / "fabric_orm.jpg", quality=92)


def weapon_textures() -> None:
    WEAPONS.mkdir(parents=True, exist_ok=True)
    reticle_holo()
    fabric()


def main() -> None:
    TOWN.mkdir(parents=True, exist_ok=True)
    FX.mkdir(parents=True, exist_ok=True)
    painted_wood_grey()
    canvas(((176, 40, 36), (232, 222, 196)), "canvas_stripes_red")
    canvas(((40, 100, 70), (228, 220, 190)), "canvas_stripes_green")
    sign("blue", (60, 120, 235))
    sign("red", (225, 62, 52))
    leaf_cluster("foliage", False, 1)
    leaf_cluster("flowers", True, 2)
    produce()
    shop_signs()
    target_face()
    radial("spark", 64, (255, 255, 255), 2.2)
    radial("glow", 128, (255, 255, 255), 1.6)
    bullet_hole()
    muzzle_flash()
    weapon_textures()
    new_maps()
    print("procedural textures written")


if __name__ == "__main__":
    main()
