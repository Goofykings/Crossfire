"""Neon Backstreets ground and wall-surface art (overhaul 2026-11-15): tiling paving sets with wet patches (albedo, normal and
ORM), the circular plaza of the crossing, glazed wall tiles, and the atlas of painted road markings, stencils and litter.

Called by tools/make_neon_textures.py (`paint_all(T)` gets that module for its font helpers). Pillow only, fixed seeds,
everything original. Cell rectangles of the marks atlas live in blender/scripts/lib/neon_art.py.
"""
from __future__ import annotations

import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

import neon_art as art


# --- helpers --------------------------------------------------------------------------------------------------------------
def wrap_noise(size: int, cells: int, seed: int) -> Image.Image:
    """Tileable value noise (L): a random cells x cells grid, bicubic-upscaled with wrap padding."""
    r = random.Random(seed)
    vals = [[r.randrange(256) for _ in range(cells)] for _ in range(cells)]
    g = Image.new('L', (cells + 4, cells + 4))
    g.putdata([vals[(y - 2) % cells][(x - 2) % cells] for y in range(cells + 4) for x in range(cells + 4)])
    s = size // cells
    big = g.resize(((cells + 4) * s, (cells + 4) * s), Image.BICUBIC)
    return big.crop((2 * s, 2 * s, 2 * s + size, 2 * s + size))


def fbm(size: int, seed: int, cells=(4, 8, 16, 32)) -> Image.Image:
    out = wrap_noise(size, cells[0], seed)
    for i, c in enumerate(cells[1:]):
        out = Image.blend(out, wrap_noise(size, c, seed + 7 * (i + 1)), .5 / (i + 1.4))
    return out


def remap(img: Image.Image, lo: int, hi: int) -> Image.Image:
    return img.point(lambda v: int(lo + (hi - lo) * v / 255))


def soft_mask(noise: Image.Image, threshold: int, gain: float) -> Image.Image:
    return noise.point(lambda v: max(0, min(255, int((v - threshold) * gain))))


def wrap_pad(img: Image.Image, p: int) -> Image.Image:
    W, H = img.size
    out = Image.new(img.mode, (W + 2 * p, H + 2 * p))
    for ox in (-W, 0, W):
        for oy in (-H, 0, H):
            out.paste(img, (p + ox, p + oy))
    return out


def normal_map(height: Image.Image, strength: float, wrap=True) -> Image.Image:
    """Tangent-space normal map (OpenGL convention) from a height image (L, white = high)."""
    W, H = height.size
    src = wrap_pad(height, 2) if wrap else height
    sc = 8.0 / strength
    dx = src.filter(ImageFilter.Kernel((3, 3), [-1, 0, 1, -2, 0, 2, -1, 0, 1], scale=sc, offset=128))
    dy = src.filter(ImageFilter.Kernel((3, 3), [-1, -2, -1, 0, 0, 0, 1, 2, 1], scale=sc, offset=128))
    if wrap:
        dx, dy = dx.crop((2, 2, 2 + W, 2 + H)), dy.crop((2, 2, 2 + W, 2 + H))
    return Image.merge('RGB', (ImageChops.invert(dx), dy, Image.new('L', (W, H), 236)))


def rgb(l: Image.Image) -> Image.Image:
    return Image.merge('RGB', (l, l, l))


def save_set(out, name, albedo, height, rough, ao, strength, wrap=True, small=None):
    """Write <name>_albedo/_normal/_orm.jpg. `small` downsizes the normal and ORM maps (the plaza's albedo keeps its size)."""
    nrm = normal_map(height, strength, wrap)
    orm = Image.merge('RGB', (ao, rough, Image.new('L', albedo.size, 0)))
    if small:
        nrm, orm = nrm.resize((small, small), Image.LANCZOS), orm.resize((small, small), Image.LANCZOS)
    albedo.save(out / f'{name}_albedo.jpg', quality=90)
    nrm.save(out / f'{name}_normal.jpg', quality=92)
    orm.save(out / f'{name}_orm.jpg', quality=88)


def wetness(albedo, rough, size, seed, threshold=118, gain=3.2, dark=.62, wet_rough=26):
    """Standing water in the low-frequency hollows: darker and mirror-smooth there."""
    w = soft_mask(fbm(size, seed, (2, 4, 8)), threshold, gain).filter(ImageFilter.GaussianBlur(3))
    darker = albedo.point(lambda v: int(v * dark))
    return Image.composite(darker, albedo, w), Image.composite(Image.new('L', (size, size), wet_rough), rough, w), w


# --- tiling paving sets ----------------------------------------------------------------------------------------------------
def paving(size, n, joint, base, var, seed, *, joint_col=(34, 34, 38), bond=False, chip=.12, speck=(205, 255), tone_bias=(0, 0, 0)):
    """n x n square units: (albedo RGB, height L, joint mask L). `bond` staggers every other row by half a unit."""
    r = random.Random(seed)
    alb = Image.new('RGB', (size, size), joint_col)
    hgt = Image.new('L', (size, size), 60)
    da, dh = ImageDraw.Draw(alb), ImageDraw.Draw(hgt)
    u = size / n
    j = joint / 2
    for row in range(n):
        for col in range(-1, n + 1):
            k = r.uniform(-var, var)
            c = tuple(max(0, min(255, int(base[i] * (1 + k) + tone_bias[i] * r.random()))) for i in range(3))
            x0 = (col + (.5 if bond and row % 2 else 0)) * u
            y0 = row * u
            box = [x0 + j, y0 + j, x0 + u - j, y0 + u - j]
            da.rectangle(box, fill=c)
            dh.rectangle(box, fill=178 + int(40 * r.random()))
            if r.random() < chip:   # a chipped corner
                cx, cy = (box[0], box[2])[r.randrange(2)], (box[1], box[3])[r.randrange(2)]
                s = u * r.uniform(.025, .055)
                da.ellipse([cx - s, cy - s, cx + s, cy + s], fill=joint_col)
                dh.ellipse([cx - s, cy - s, cx + s, cy + s], fill=70)
    grain = remap(fbm(size, seed + 3, (8, 32, 128)), speck[0], speck[1])
    alb = ImageChops.multiply(alb, rgb(grain))
    hgt = hgt.filter(ImageFilter.GaussianBlur(1.2))
    joints = hgt.point(lambda v: 255 if v < 120 else 0)
    return alb, hgt, joints


def paint_paving(out):
    S = 1024
    # 1. alley pavers: 0.5 m concrete flags (2 m per repeat), cool grey, patchy standing water
    alb, hgt, joints = paving(S, 4, 9, (150, 150, 158), .2, 11, chip=.12)
    rough = remap(fbm(S, 12, (8, 32)), 120, 190)
    alb, rough, _ = wetness(alb, rough, S, 13)
    rough = Image.composite(Image.new('L', (S, S), 34), rough, joints)     # water sits in the joints
    ao = Image.composite(Image.new('L', (S, S), 150), Image.new('L', (S, S), 255), joints.filter(ImageFilter.GaussianBlur(2)))
    save_set(out, 'pave', alb, hgt, rough, ao, 2.2)
    # 2. small warm tiles (0.3 m, 1.2 m per repeat, running bond): the food alley and the market court
    alb, hgt, joints = paving(S, 4, 8, (158, 138, 118), .13, 21, joint_col=(30, 26, 24), bond=True, chip=.1, tone_bias=(10, 4, 0))
    rough = remap(fbm(S, 22, (8, 32)), 80, 150)
    alb, rough, _ = wetness(alb, rough, S, 23, threshold=124, gain=3.0, dark=.66, wet_rough=22)
    rough = Image.composite(Image.new('L', (S, S), 40), rough, joints)
    ao = Image.composite(Image.new('L', (S, S), 150), Image.new('L', (S, S), 255), joints.filter(ImageFilter.GaussianBlur(2)))
    save_set(out, 'tile', alb, hgt, rough, ao, 1.8)
    # 3. glazed wall tiles (12.5 cm, 1 m per repeat): off-white, grimy joints, a few replaced tiles, rain-dirt streaks
    alb, hgt, joints = paving(S, 8, 5, (214, 220, 216), .05, 31, joint_col=(74, 76, 74), chip=.03, speck=(228, 255), tone_bias=(0, 0, 6))
    r = random.Random(32)
    d = ImageDraw.Draw(alb)
    for _ in range(5):     # odd replacement tiles
        cx, cy = r.randrange(8), r.randrange(8)
        t = r.choice([(150, 186, 184), (214, 206, 180), (170, 176, 172)])
        d.rectangle([cx * 128 + 4, cy * 128 + 4, cx * 128 + 124, cy * 128 + 124], fill=t)
    dirt = remap(fbm(S, 33, (4, 16, 64)), 188, 255).filter(ImageFilter.GaussianBlur(1))
    streak = wrap_noise(S, 64, 34).resize((S, 16), Image.BICUBIC).resize((S, S), Image.BICUBIC)   # vertical runs
    alb = ImageChops.multiply(alb, rgb(dirt))
    alb = ImageChops.multiply(alb, rgb(remap(streak, 205, 255)))
    rough = Image.composite(Image.new('L', (S, S), 215), remap(fbm(S, 35, (8, 32)), 36, 78), joints)
    ao = Image.composite(Image.new('L', (S, S), 170), Image.new('L', (S, S), 255), joints.filter(ImageFilter.GaussianBlur(1.5)))
    save_set(out, 'walltile', alb, hgt, rough, ao, 1.5)


# --- the crossing's plaza ---------------------------------------------------------------------------------------------------
def paint_plaza(out):
    """One 9 x 9 m image (art.PLAZA): 0.5 m flags outside (aligned with the tiling `pave` grid, so the seam with the alley
    paving falls on a joint), a ring of dark setts, a worn yellow-and-black hazard ring, concentric radial paving and a cast
    medallion at the centre."""
    S = 2048
    M = art.PLAZA['size']                       # metres across
    px = S / M
    cx, cy = (art.PLAZA['centre'][0] - art.PLAZA['origin'][0]) * px, (art.PLAZA['centre'][1] - art.PLAZA['origin'][1]) * px
    R = art.PLAZA['radius'] * px
    r = random.Random(41)
    joint_col = (34, 34, 38)
    alb = Image.new('RGB', (S, S), joint_col)
    hgt = Image.new('L', (S, S), 60)
    da, dh = ImageDraw.Draw(alb), ImageDraw.Draw(hgt)
    # outside: the alley flags
    u = .5 * px
    n = int(M / .5)
    for row in range(n):
        for col in range(n):
            k = r.uniform(-.16, .16)
            c = tuple(int(v * (1 + k)) for v in (150, 150, 158))
            box = [col * u + 4.5, row * u + 4.5, (col + 1) * u - 4.5, (row + 1) * u - 4.5]
            da.rectangle(box, fill=c)
            dh.rectangle(box, fill=178 + int(40 * r.random()))

    def ring(r0, r1, segs, tone, var, phase=0.0, joint=5.0, h=190, alt=None):
        """Annulus r0..r1 (px) of `segs` stones; `alt` paints every other stone in a second colour."""
        da.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=joint_col)
        dh.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=60)
        ja = joint / ((r0 + r1) / 2)             # joint as an angle
        for i in range(segs):
            a0 = phase + i / segs * 2 * math.pi + ja / 2
            a1 = phase + (i + 1) / segs * 2 * math.pi - ja / 2
            k = r.uniform(-var, var)
            base = alt if alt and i % 2 else tone
            c = tuple(max(0, min(255, int(v * (1 + k)))) for v in base)
            steps = max(2, int((a1 - a0) * r1 / 14))
            pts = [(cx + math.cos(a0 + (a1 - a0) * s / steps) * (r1 - joint / 2), cy + math.sin(a0 + (a1 - a0) * s / steps) * (r1 - joint / 2)) for s in range(steps + 1)]
            pts += [(cx + math.cos(a1 - (a1 - a0) * s / steps) * (r0 + joint / 2), cy + math.sin(a1 - (a1 - a0) * s / steps) * (r0 + joint / 2)) for s in range(steps + 1)]
            da.polygon(pts, fill=c)
            dh.polygon(pts, fill=h + int(30 * r.random()))

    m = px   # one metre in pixels
    ring(R - .22 * m, R, 72, (58, 58, 64), .2, h=200)                                  # dark sett border
    ring(R - .62 * m, R - .22 * m, 48, (214, 164, 30), .08, alt=(26, 26, 30), joint=3, h=186)   # hazard ring
    ring(R - .74 * m, R - .62 * m, 96, (176, 176, 172), .12, joint=3, h=196)           # pale kerb line
    radii = [R - .74 * m]
    while radii[-1] > .95 * m:
        radii.append(max(.62 * m, radii[-1] - .46 * m))
    for i in range(len(radii) - 1):
        r1_, r0_ = radii[i], radii[i + 1]
        segs = max(10, int(2 * math.pi * (r0_ + r1_) / 2 / (.62 * m)))
        tone = (176, 170, 162) if i % 2 == 0 else (132, 134, 146)
        ring(r0_, r1_, segs, tone, .13, phase=.37 * i)
    # medallion: a cast-iron cover with a radial sun and a rim of studs
    rm = radii[-1]
    da.ellipse([cx - rm, cy - rm, cx + rm, cy + rm], fill=(74, 74, 84))
    dh.ellipse([cx - rm, cy - rm, cx + rm, cy + rm], fill=150)
    for i in range(16):
        a = i / 16 * 2 * math.pi
        w = math.pi / 16 * .55
        pts = [(cx + math.cos(a - w) * rm * .28, cy + math.sin(a - w) * rm * .28), (cx + math.cos(a) * rm * .8, cy + math.sin(a) * rm * .8),
               (cx + math.cos(a + w) * rm * .28, cy + math.sin(a + w) * rm * .28)]
        da.polygon(pts, fill=(150, 146, 140) if i % 2 else (118, 118, 128))
        dh.polygon(pts, fill=205)
    for i in range(24):
        a = i / 24 * 2 * math.pi
        x, y = cx + math.cos(a) * rm * .9, cy + math.sin(a) * rm * .9
        da.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(160, 160, 166))
        dh.ellipse([x - 5, y - 5, x + 5, y + 5], fill=220)
    da.ellipse([cx - rm * .22, cy - rm * .22, cx + rm * .22, cy + rm * .22], fill=(104, 100, 96))
    dh.ellipse([cx - rm * .22, cy - rm * .22, cx + rm * .22, cy + rm * .22], fill=215)
    # wear: grain everywhere, and the hazard paint scuffed away along the walked lines
    grain = remap(Image.effect_noise((S, S), 36).filter(ImageFilter.GaussianBlur(.8)), 196, 255)
    alb = ImageChops.multiply(alb, rgb(grain))
    scuff = soft_mask(Image.effect_noise((S // 4, S // 4), 70).resize((S, S), Image.BICUBIC), 150, 5.0)
    hazard = Image.new('L', (S, S), 0)
    dz = ImageDraw.Draw(hazard)
    dz.ellipse([cx - (R - .22 * m), cy - (R - .22 * m), cx + (R - .22 * m), cy + (R - .22 * m)], fill=255)
    dz.ellipse([cx - (R - .62 * m), cy - (R - .62 * m), cx + (R - .62 * m), cy + (R - .62 * m)], fill=0)
    worn = ImageChops.multiply(hazard, scuff)
    alb = Image.composite(Image.new('RGB', (S, S), (72, 70, 70)), alb, worn)
    hgt = hgt.filter(ImageFilter.GaussianBlur(1.4))
    joints = hgt.point(lambda v: 255 if v < 118 else 0)
    rough = remap(Image.effect_noise((S // 8, S // 8), 60).resize((S, S), Image.BICUBIC), 110, 180)
    wet = soft_mask(Image.effect_noise((S // 64, S // 64), 80).resize((S, S), Image.BICUBIC), 138, 3.0).filter(ImageFilter.GaussianBlur(6))
    alb = Image.composite(alb.point(lambda v: int(v * .64)), alb, wet)
    rough = Image.composite(Image.new('L', (S, S), 24), rough, wet)
    rough = Image.composite(Image.new('L', (S, S), 34), rough, joints)
    ao = Image.composite(Image.new('L', (S, S), 150), Image.new('L', (S, S), 255), joints.filter(ImageFilter.GaussianBlur(2)))
    save_set(out, 'plaza', alb, hgt, rough, ao, 2.0, wrap=False, small=1024)


# --- painted markings, stencils and litter (alpha-tested atlas) ------------------------------------------------------------
def worn(mask: Image.Image, seed: int, amount=.22, grain=3) -> Image.Image:
    """Paint wear: knock holes out of a mask with thresholded noise (hard edges: the material is alpha-tested)."""
    W, H = mask.size
    random.seed(seed)
    n = Image.effect_noise((max(8, W // grain), max(8, H // grain)), 90).resize((W, H), Image.BICUBIC)
    big = Image.effect_noise((max(4, W // 40), max(4, H // 40)), 90).resize((W, H), Image.BICUBIC)
    n = Image.blend(n, big, .45)
    limit = 68 + amount * 160
    cut = n.point(lambda v: 0 if v < limit else 255)
    return ImageChops.multiply(mask, cut)


def paint_marks(out, T):
    W, H = art.MARKS_SIZE
    sheet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    white, yellow = (244, 244, 238), (250, 196, 40)

    def put(name, mask, color, seed, amount=.24):
        x, y, w, h = art.MARKS[name]
        m = worn(mask.resize((w, h), Image.LANCZOS) if mask.size != (w, h) else mask, seed, amount)
        img = Image.new('RGBA', (w, h), color + (0,))
        img.putalpha(m)
        sheet.paste(img, (x, y), img)

    def put_img(name, img):
        x, y, w, h = art.MARKS[name]
        sheet.paste(img, (x, y), img)

    def blank(name):
        _, _, w, h = art.MARKS[name]
        m = Image.new('L', (w, h), 0)
        return m, ImageDraw.Draw(m), w, h

    # straight arrow and turn arrow (the long Japanese road arrows)
    m, d, w, h = blank('arrow')
    d.polygon([(w / 2, 14), (w - 22, h * .36), (w * .64, h * .36), (w * .64, h - 14), (w * .36, h - 14), (w * .36, h * .36), (22, h * .36)], fill=255)
    put('arrow', m, white, 51, .1)
    m, d, w, h = blank('arrow_turn')
    d.polygon([(w * .3, h - 14), (w * .3, h * .42), (w * .56, h * .42), (w * .56, h * .56), (w - 16, h * .3), (w * .56, 20), (w * .56, h * .2),
               (w * .06, h * .2), (w * .06, h - 14)], fill=255)
    put('arrow_turn', m, white, 52, .1)
    # 止まれ (stop) and 徐行 (slow), painted tall as on the road
    for name, text, seed in (('tomare', '止まれ', 53), ('jokou', '徐行', 54)):
        m, d, w, h = blank(name)
        chars = list(text)
        ch = (h - 30) / len(chars)
        for i, c in enumerate(chars):
            g = T.text_mask((w, int(ch)), c, T.jp(int(min(w * .86, ch * .9))))
            g = g.resize((w, int(ch)))
            m.paste(g, (0, int(15 + i * ch)))
        put(name, m, white, seed, .08)
    # hatched keep-clear box
    m, d, w, h = blank('hatch')
    d.rectangle([6, 6, w - 6, h - 6], outline=255, width=22)
    for k in range(-h, w, 74):
        d.line([(k, h), (k + h, 0)], fill=255, width=20)
    put('hatch', m, yellow, 55, .14)
    # bay numbers 01..04 and the big wall stencil 07
    for i in range(4):
        name = f'bay{i + 1}'
        _, _, w, h = art.MARKS[name]
        m = T.text_mask((w, h), f'0{i + 1}', T.font('impact.ttf', int(h * .78)))
        put(name, m, yellow if i % 2 else white, 60 + i, .1)
    for name, text, col, fnt, seed in (('wall07', '07', white, 'impact.ttf', 70), ('wall12', '12', white, 'impact.ttf', 71)):
        _, _, w, h = art.MARKS[name]
        m = T.text_mask((w, h), text, T.font(fnt, int(h * .82)))
        # stencil bridges
        d = ImageDraw.Draw(m)
        for yy in (int(h * .36), int(h * .64)):
            d.rectangle([0, yy, w, yy + 9], fill=0)
        put(name, m, col, seed, .12)
    for name, lines, col, seed in (('no_parking', ['駐車禁止', 'NO PARKING'], (226, 64, 54), 72), ('loading', ['搬入口', 'LOADING B1'], white, 73),
                                   ('exit_way', ['出口  EXIT  →'], (80, 220, 130), 74), ('keep_clear', ['KEEP CLEAR'], yellow, 75)):
        _, _, w, h = art.MARKS[name]
        m = Image.new('L', (w, h), 0)
        n = len(lines)
        for i, line in enumerate(lines):
            jpn = any(ord(ch) > 0x2fff for ch in line)
            size = int(h / n * (.74 if jpn else .7))
            f = T.jp(size) if jpn else T.font('impact.ttf', size)
            g = T.text_mask((w, h // n), line, f)
            if g.getbbox() and g.getbbox()[2] - g.getbbox()[0] > w - 20:
                g = g.resize((w, h // n))
            m.paste(g, (0, i * (h // n)))
        put(name, m, col, seed, .1)
    # tyre marks: two wavering dark tracks
    _, _, w, h = art.MARKS['tyres']
    r = random.Random(76)
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    for off in (h * .3, h * .7):
        pts = [(x, off + math.sin(x / 90 + off) * 10 + r.uniform(-2, 2)) for x in range(0, w + 1, 12)]
        d.line(pts, fill=255, width=26)
    put('tyres', m, (16, 16, 18), 77, .5)
    # dark runoff stain below a drain or downpipe
    _, _, w, h = art.MARKS['stain']
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    r = random.Random(78)
    for _ in range(26):
        x = r.gauss(w / 2, w * .14)
        L = r.uniform(h * .3, h * .96)
        ww = r.uniform(5, 20)
        d.polygon([(x - ww, 0), (x + ww, 0), (x + ww * .2, L), (x - ww * .2, L)], fill=255)
    put('stain', m, (14, 15, 17), 79, .34)

    # litter: flat paper, flyers, cans, leaves (three clusters), painted in colour
    def litter(name, seed, kinds):
        x0, y0, w, h = art.MARKS[name]
        r = random.Random(seed)
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        for _ in range(kinds):
            kind = r.choice(['paper', 'paper', 'flyer', 'can', 'leaf', 'leaf', 'cup', 'butt', 'butt'])
            px_, py_ = r.gauss(w / 2, w * .2), r.gauss(h / 2, h * .2)
            ang = r.uniform(0, 360)
            if kind in ('paper', 'flyer'):
                sw, sh = r.randrange(54, 96), r.randrange(70, 120)
                p = Image.new('RGBA', (sw, sh), (0, 0, 0, 0))
                dd = ImageDraw.Draw(p)
                base = r.choice([(206, 204, 196), (188, 190, 196), (214, 208, 180)]) if kind == 'paper' else r.choice([(214, 70, 110), (60, 170, 214), (232, 186, 50), (240, 240, 232)])
                dd.polygon([(4, 3), (sw - 6, 0), (sw - 2, sh - 8), (9, sh - 2)], fill=base + (255,))
                for ly in range(14, sh - 14, 11):
                    dd.line([(12, ly), (sw - r.randrange(14, 30), ly + r.randrange(-1, 2))], fill=tuple(int(v * .45) for v in base) + (255,), width=3)
                if kind == 'flyer':
                    dd.rectangle([12, 10, sw - 14, 30], fill=(24, 24, 30, 255))
            elif kind == 'can':
                p = Image.new('RGBA', (62, 34), (0, 0, 0, 0))
                dd = ImageDraw.Draw(p)
                c = r.choice([(206, 40, 44), (40, 110, 206), (226, 226, 226), (60, 170, 90)])
                dd.rounded_rectangle([2, 4, 60, 30], 8, fill=c + (255,))
                dd.rectangle([20, 4, 34, 30], fill=(236, 236, 230, 255))
                dd.ellipse([52, 7, 62, 27], fill=(150, 150, 156, 255))
            elif kind == 'cup':
                p = Image.new('RGBA', (56, 44), (0, 0, 0, 0))
                dd = ImageDraw.Draw(p)
                dd.polygon([(2, 6), (54, 0), (54, 44), (2, 36)], fill=(232, 228, 216, 255))
                dd.polygon([(20, 4), (30, 3), (30, 41), (20, 39)], fill=(204, 60, 60, 255))
            elif kind == 'leaf':
                p = Image.new('RGBA', (44, 26), (0, 0, 0, 0))
                dd = ImageDraw.Draw(p)
                c = r.choice([(120, 92, 40), (150, 110, 44), (88, 96, 46), (160, 84, 40)])
                dd.polygon([(0, 13), (14, 2), (34, 4), (44, 13), (32, 23), (12, 24)], fill=c + (255,))
                dd.line([(2, 13), (42, 13)], fill=tuple(int(v * .6) for v in c) + (255,), width=2)
            else:
                p = Image.new('RGBA', (26, 10), (0, 0, 0, 0))
                dd = ImageDraw.Draw(p)
                dd.rectangle([0, 1, 16, 8], fill=(232, 228, 216, 255))
                dd.rectangle([16, 1, 25, 8], fill=(196, 136, 60, 255))
            p = p.rotate(ang, resample=Image.BICUBIC, expand=True)
            a = p.split()[3].point(lambda v: 255 if v > 110 else 0)
            p.putalpha(a)
            img.paste(p, (int(px_ - p.size[0] / 2), int(py_ - p.size[1] / 2)), p)
        sheet.paste(img, (x0, y0), img)
    litter('litter_a', 81, 16)
    litter('litter_b', 82, 11)
    litter('litter_c', 83, 22)

    # a decorated cast manhole cover (Japan's are famous): rim, waves and a lucky cat's face, in enamel colours
    x0, y0, w, h = art.MARKS['manhole']
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = w / 2
    d.ellipse([6, 6, w - 6, h - 6], fill=(46, 46, 52, 255))
    d.ellipse([26, 26, w - 26, h - 26], fill=(28, 70, 110, 255))
    for i in range(36):
        a = i / 36 * 2 * math.pi
        d.ellipse([c + math.cos(a) * (c - 16) - 6, c + math.sin(a) * (c - 16) - 6, c + math.cos(a) * (c - 16) + 6, c + math.sin(a) * (c - 16) + 6], fill=(92, 92, 98, 255))
    for row in range(5):       # waves
        yy = h * .58 + row * 26
        for k in range(-1, 8):
            xx = 40 + k * 64 + (32 if row % 2 else 0)
            d.arc([xx, yy, xx + 64, yy + 52], 180, 360, fill=(120, 196, 226, 255), width=7)
    d.ellipse([c - 110, c - 150, c + 110, c + 50], fill=(238, 236, 226, 255))                      # cat head
    d.polygon([(c - 104, c - 96), (c - 92, c - 190), (c - 30, c - 136)], fill=(238, 236, 226, 255))
    d.polygon([(c + 104, c - 96), (c + 92, c - 190), (c + 30, c - 136)], fill=(238, 236, 226, 255))
    d.polygon([(c - 88, c - 112), (c - 84, c - 166), (c - 48, c - 134)], fill=(226, 96, 110, 255))
    d.polygon([(c + 88, c - 112), (c + 84, c - 166), (c + 48, c - 134)], fill=(226, 96, 110, 255))
    for sx in (-1, 1):
        d.arc([c + sx * 52 - 26, c - 84, c + sx * 52 + 26, c - 44], 200, 340, fill=(30, 30, 34, 255), width=8)
        for k in (-1, 0, 1):
            d.line([(c + sx * 40, c - 12 + k * 4), (c + sx * 124, c - 22 + k * 22)], fill=(30, 30, 34, 255), width=4)
    d.polygon([(c - 12, c - 34), (c + 12, c - 34), (c, c - 20)], fill=(226, 96, 110, 255))
    d.arc([c - 30, c - 30, c, c + 4], 0, 180, fill=(30, 30, 34, 255), width=6)
    d.arc([c, c - 30, c + 30, c + 4], 0, 180, fill=(30, 30, 34, 255), width=6)
    d.ellipse([c - 30, c + 36, c + 30, c + 96], fill=(232, 184, 50, 255))                         # bell
    d.line([(c - 100, c + 40), (c + 100, c + 40)], fill=(206, 50, 60, 255), width=14)
    edge = Image.new('L', (w, h), 0)
    ImageDraw.Draw(edge).ellipse([6, 6, w - 6, h - 6], fill=255)
    img.putalpha(edge)
    grime = remap(Image.effect_noise((w, h), 50).filter(ImageFilter.GaussianBlur(1.5)), 150, 255)
    img = Image.merge('RGBA', (*ImageChops.multiply(img.convert('RGB'), rgb(grime)).split(), edge))
    sheet.paste(img, (x0, y0), img)

    # small wall plates: electrical hazard, fire hydrant, a house-number plate and a row of stuck flyers
    x0, y0, w, h = art.MARKS['plate_volt']
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([8, 8, w - 8, h - 8], 14, fill=(236, 190, 30, 255), outline=(20, 20, 22, 255), width=8)
    d.polygon([(w * .56, h * .14), (w * .3, h * .56), (w * .5, h * .56), (w * .42, h * .88), (w * .72, h * .42), (w * .52, h * .42)], fill=(20, 20, 22, 255))
    sheet.paste(img, (x0, y0), img)
    x0, y0, w, h = art.MARKS['plate_fire']
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([8, 8, w - 8, h - 8], 14, fill=(206, 40, 40, 255), outline=(240, 236, 226, 255), width=8)
    g = T.text_mask((w, h), '消火栓', T.jp(int(h * .26)))
    img.paste((244, 240, 230, 255), (0, 0), g)
    sheet.paste(img, (x0, y0), img)
    x0, y0, w, h = art.MARKS['plate_block']
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([6, 6, w - 6, h - 6], 10, fill=(22, 90, 60, 255), outline=(226, 226, 220, 255), width=5)
    g = T.text_mask((w, h), '裏通り 3-7', T.jp(int(h * .42)))
    img.paste((236, 236, 228, 255), (0, 0), g)
    sheet.paste(img, (x0, y0), img)
    x0, y0, w, h = art.MARKS['flyers']
    r = random.Random(90)
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    xx = 10
    while xx < w - 60:
        fw, fh = r.randrange(56, 86), r.randrange(84, 112)
        yy = r.randrange(4, h - fh - 4)
        base = r.choice([(232, 226, 204), (226, 80, 120), (70, 180, 226), (240, 200, 60), (236, 236, 232), (140, 96, 226)])
        d.rectangle([xx, yy, xx + fw, yy + fh], fill=base + (255,))
        d.rectangle([xx + 8, yy + 8, xx + fw - 8, yy + 8 + fh * .34], fill=tuple(int(v * .3) for v in base) + (255,))
        for ly in range(int(yy + fh * .5), yy + fh - 10, 12):
            d.line([(xx + 10, ly), (xx + fw - r.randrange(12, 36), ly)], fill=tuple(int(v * .4) for v in base) + (255,), width=4)
        if r.random() < .4:    # a torn corner
            d.polygon([(xx + fw, yy + fh), (xx + fw - 34, yy + fh), (xx + fw, yy + fh - 40)], fill=(0, 0, 0, 0))
        xx += fw + r.randrange(-12, 30)
    sheet.paste(img, (x0, y0), img)
    sheet.save(out / 'neon_marks.png')


def paint_all(T):
    paint_paving(T.OUT)
    paint_plaza(T.OUT)
    paint_marks(T.OUT, T)
