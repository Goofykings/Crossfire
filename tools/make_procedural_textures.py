"""Generate the project's original procedural textures with Pillow.

Usage: python -I tools/make_procedural_textures.py

Outputs to public/assets/textures/european-town/ (map dressing) and public/assets/textures/shared/fx/
(effects). Deterministic: the same seed always produces the same images.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "public" / "assets" / "textures" / "shared"
TOWN = ROOT / "public" / "assets" / "textures" / "european-town"
FX = SHARED / "fx"
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
    s = 512
    img = Image.new("RGBA", (s, s), (235, 232, 222, 255))
    d = ImageDraw.Draw(img)
    rings = [(250, (240, 238, 230)), (215, (30, 32, 36)), (175, (240, 238, 230)), (135, (220, 60, 40)),
             (95, (240, 238, 230)), (55, (220, 60, 40)), (22, (250, 200, 40))]
    for r, c in rings:
        d.ellipse([s / 2 - r, s / 2 - r, s / 2 + r, s / 2 + r], fill=c + (255,))
    d.line([(s / 2, 10), (s / 2, s - 10)], fill=(40, 40, 40, 120), width=2)
    d.line([(10, s / 2), (s - 10, s / 2)], fill=(40, 40, 40, 120), width=2)
    img.save(TOWN / "target_face.png")


def radial(name: str, size: int, color: tuple[int, int, int], falloff: float, rings: bool = False) -> None:
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            r = math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2)
            a = max(0.0, 1 - r) ** falloff
            px[x, y] = (*color, int(255 * a))
    img.save(FX / f"{name}.png")


def scorch() -> None:
    s = 128
    rnd = random.Random(3)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    px = img.load()
    n = noise(s, 8, 4)
    for y in range(s):
        for x in range(s):
            r = math.hypot(x - s / 2, y - s / 2) / (s / 2)
            v = n.getpixel((x, y)) / 255
            a = max(0.0, 1 - r * (0.85 + v * 0.4)) ** 0.8
            core = max(0.0, 1 - r * 3.2)
            c = int(18 + 60 * core)
            px[x, y] = (c + int(140 * core), c + int(110 * core), c + int(60 * core), int(235 * a))
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    img.save(FX / "scorch.png")
    del rnd


def muzzle_flash() -> None:
    s = 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rnd = random.Random(8)
    for i in range(7):
        a = i / 7 * math.pi * 2 + rnd.uniform(-0.2, 0.2)
        L = rnd.uniform(0.6, 1.0) * s / 2
        pts = [(s / 2 + math.cos(a + 0.18) * 16, s / 2 + math.sin(a + 0.18) * 16),
               (s / 2 + math.cos(a) * L, s / 2 + math.sin(a) * L),
               (s / 2 + math.cos(a - 0.18) * 16, s / 2 + math.sin(a - 0.18) * 16)]
        d.polygon(pts, fill=(120, 230, 255, 200))
    img = img.filter(ImageFilter.GaussianBlur(3))
    core = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(core).ellipse([s / 2 - 34, s / 2 - 34, s / 2 + 34, s / 2 + 34], fill=(235, 252, 255, 255))
    core = core.filter(ImageFilter.GaussianBlur(10))
    img = Image.alpha_composite(img, core)
    img.save(FX / "muzzle_flash.png")


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
    scorch()
    muzzle_flash()
    print("procedural textures written")


if __name__ == "__main__":
    main()
