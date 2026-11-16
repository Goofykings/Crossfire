"""Neon Backstreets textures (2026-11): original neon signs, ad panels, shop displays, lit windows, graffiti,
glow cards and the night sky. Everything is painted here with Pillow; no third-party artwork.

    python -B -I tools/make_neon_textures.py

Outputs public/assets/textures/neon-backstreets/{neon_signs,neon_panels,neon_windows}.jpg, neon_graffiti.png,
glow_soft.png, glow_wet.png and public/assets/env/sky_neon_1k.hdr + sky_neon_2k.jpg. The cell rectangles live in
blender/scripts/lib/neon_art.py (shared with the Blender builder). Deterministic: fixed seeds.
"""
from __future__ import annotations

import math
import random
import struct
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'blender' / 'scripts' / 'lib'))
import neon_art as art  # noqa: E402

OUT = ROOT / 'public' / 'assets' / 'textures' / 'neon-backstreets'
ENV = ROOT / 'public' / 'assets' / 'env'
FONTS = Path('C:/Windows/Fonts')

PINK = (255, 60, 170)
CYAN = (40, 230, 255)
BLUE = (60, 110, 255)
PURPLE = (170, 70, 255)
RED = (255, 50, 60)
YELLOW = (255, 210, 60)
GREEN = (60, 255, 140)
ORANGE = (255, 130, 40)
WHITE = (255, 255, 255)


def font(name, size, index=0):
    for cand in (FONTS / name, Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')):
        if cand.exists():
            try:
                return ImageFont.truetype(str(cand), size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()


def jp(size):
    return font('YuGothB.ttc', size)


# --- light compositing --------------------------------------------------------------------------------------------
def add_light(img, mask, color, strength=1.0):
    solid = Image.new('RGB', img.size, tuple(min(255, int(c * strength)) for c in color))
    return ImageChops.add(img, ImageChops.multiply(solid, mask.convert('RGB')))


def dilate(m, k):
    return m.filter(ImageFilter.MaxFilter(k)) if k > 1 else m


def erode(m, k):
    return m.filter(ImageFilter.MinFilter(k)) if k > 1 else m


def neon(img, mask, color, glow=14, core=3):
    """A glass tube: wide soft glow, a coloured tube and a near-white core."""
    img = add_light(img, dilate(mask, 5).filter(ImageFilter.GaussianBlur(glow)), color, .7)
    img = add_light(img, mask.filter(ImageFilter.GaussianBlur(max(1, glow * .3))), color, .9)
    img = add_light(img, mask, color, .85)
    img = add_light(img, erode(mask, core).filter(ImageFilter.GaussianBlur(1)), WHITE, .75)
    return img


def text_mask(size, text, fnt, xy=None, anchor='mm', outline=0, spacing=0):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    xy = xy or (size[0] / 2, size[1] / 2)
    if spacing:
        # manual letter spacing (Pillow has none): centre the whole run
        widths = [d.textlength(ch, font=fnt) for ch in text]
        total = sum(widths) + spacing * (len(text) - 1)
        x = xy[0] - total / 2
        for ch, w in zip(text, widths):
            d.text((x + w / 2, xy[1]), ch, font=fnt, fill=255, anchor='mm')
            x += w + spacing
    else:
        d.text(xy, text, font=fnt, fill=255, anchor=anchor)
    if outline:
        m = ImageChops.subtract(dilate(m, outline * 2 + 1), erode(m, 3))
    return m


def vtext_mask(size, chars, fnt, pad=0.08):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    n = len(chars)
    h = size[1] * (1 - 2 * pad) / n
    for i, ch in enumerate(chars):
        d.text((size[0] / 2, size[1] * pad + h * (i + .5)), ch, font=fnt, fill=255, anchor='mm')
    return m


def frame_mask(size, inset, width, radius=14):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([inset, inset, size[0] - inset, size[1] - inset], radius=radius, outline=255, width=width)
    return m


def board(size, top=(10, 10, 18), bottom=(4, 4, 8)):
    img = Image.new('RGB', size)
    d = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        d.line([(0, y), (size[0], y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    # brushed-metal speckle so the dark board is not a flat void
    rnd = random.Random(size[0] * 7 + size[1])
    px = img.load()
    for _ in range(size[0] * size[1] // 40):
        x, y = rnd.randrange(size[0]), rnd.randrange(size[1])
        c = px[x, y]
        px[x, y] = tuple(min(255, v + 6) for v in c)
    return img


def lightbox(size, fill, edge, text, fnt, ink, sub=None, subfont=None, stripes=()):
    """Back-lit acrylic box: bright panel, darker edges, printed text."""
    img = Image.new('RGB', size, fill)
    d = ImageDraw.Draw(img)
    for i, (col, y0, y1) in enumerate(stripes):
        d.rectangle([0, int(size[1] * y0), size[0], int(size[1] * y1)], fill=col)
    d.text((size[0] / 2, size[1] * (.42 if sub else .5)), text, font=fnt, fill=ink, anchor='mm')
    if sub:
        d.text((size[0] / 2, size[1] * .8), sub, font=subfont, fill=ink, anchor='mm')
    # light falls off toward the edges of the box
    vign = Image.new('L', size, 0)
    ImageDraw.Draw(vign).rounded_rectangle([size[0] * .04, size[1] * .1, size[0] * .96, size[1] * .9], radius=40, fill=255)
    vign = vign.filter(ImageFilter.GaussianBlur(size[1] * .18))
    dark = Image.new('RGB', size, tuple(int(c * .55) for c in fill))
    img = Image.composite(img, dark, vign)
    ImageDraw.Draw(img).rectangle([0, 0, size[0] - 1, size[1] - 1], outline=edge, width=10)
    return img


# --- signs --------------------------------------------------------------------------------------------------------
def paint_signs():
    W, H = art.SIGNS_SIZE
    sheet = Image.new('RGB', (W, H), (6, 6, 10))

    def put(name, img):
        x, y, w, h = art.SIGNS[name]
        sheet.paste(img.resize((w, h), Image.LANCZOS), (x, y))

    def neon_sign(size, parts, border=None, bg=None):
        img = bg or board(size)
        if border:
            img = neon(img, frame_mask(size, 14, 6), border, glow=10)
        for mask, color, glow in parts:
            img = neon(img, mask, color, glow=glow)
        return img

    s = (1024, 256)
    put('mart', lightbox(s, (240, 248, 245), (30, 120, 90), '24/7 MART', font('impact.ttf', 150), (20, 70, 150),
                         stripes=[((30, 170, 110), 0, .14), ((30, 110, 220), .86, 1)]))
    put('ramen', neon_sign(s, [(text_mask(s, 'RAMEN', font('ROCKB.TTF', 118), (300, 128), outline=3), RED, 14),
                               (text_mask(s, 'ラーメン', jp(100), (790, 128)), PINK, 12)], border=RED))
    put('laundry', neon_sign(s, [(text_mask(s, 'COIN LAUNDRY', font('bahnschrift.ttf', 112), outline=2, spacing=6), CYAN, 14)], border=BLUE))
    put('arcade', neon_sign(s, [(text_mask(s, 'ARCADE', font('ERASBD.TTF', 168), outline=3, spacing=14), PURPLE, 16),
                                (text_mask(s, '★', font('seguisym.ttf', 120), (90, 128)), YELLOW, 10),
                                (text_mask(s, '★', font('seguisym.ttf', 120), (934, 128)), YELLOW, 10)], border=PINK))
    put('karaoke', neon_sign(s, [(text_mask(s, 'KARAOKE', font('segoeprb.ttf', 150), (512, 120)), PINK, 16)], border=PURPLE))
    put('tattoo', neon_sign((768, 256), [(text_mask((768, 256), 'TATTOO', font('STENCIL.TTF', 150), outline=2, spacing=8), RED, 14)], border=ORANGE))
    put('exit', lightbox((256, 128), (30, 170, 80), (10, 70, 30), 'EXIT', font('arialbd.ttf', 70), (240, 255, 240)))
    put('h24', neon_sign((256, 128), [(text_mask((256, 128), '24H', font('impact.ttf', 90)), YELLOW, 8)]))
    put('bar88', neon_sign((512, 256), [(text_mask((512, 256), 'BAR 88', font('ROCKB.TTF', 120), (256, 128), outline=2), BLUE, 14)], border=CYAN))
    put('open', neon_sign((512, 256), [(text_mask((512, 256), 'OPEN', font('arialbd.ttf', 150), outline=3), RED, 14)], border=BLUE))
    put('tea', neon_sign((512, 256), [(text_mask((512, 256), 'TEA', font('GOTHICB.TTF', 130), (180, 128)), GREEN, 12),
                                      (text_mask((512, 256), '茶', jp(150), (390, 128)), YELLOW, 12)], border=GREEN))
    put('heart', neon_sign((256, 256), [(text_mask((256, 256), '♥', font('seguisym.ttf', 200), (128, 136), outline=3), PINK, 14)]))
    cat = Image.new('L', (256, 256), 0)
    d = ImageDraw.Draw(cat)
    d.ellipse([58, 70, 198, 210], outline=255, width=9)
    d.polygon([(70, 104), (78, 40), (118, 78)], outline=255, width=9)
    d.polygon([(186, 104), (178, 40), (138, 78)], outline=255, width=9)
    d.line([(100, 140), (112, 132), (124, 140)], fill=255, width=7)
    d.line([(132, 140), (144, 132), (156, 140)], fill=255, width=7)
    d.arc([112, 150, 144, 176], 20, 160, fill=255, width=6)
    put('cat', neon_sign((256, 256), [(cat, YELLOW, 12)]))
    put('yoru', neon_sign((256, 256), [(text_mask((256, 256), '夜', jp(190), (128, 132)), PURPLE, 14)], border=PINK))
    arrow = Image.new('L', (256, 256), 0)
    ImageDraw.Draw(arrow).line([(40, 128), (200, 128), (150, 80), (200, 128), (150, 176)], fill=255, width=14, joint='curve')
    put('arrow', neon_sign((256, 256), [(arrow, CYAN, 12)]))
    cross = Image.new('L', (256, 256), 0)
    ImageDraw.Draw(cross).polygon([(98, 30), (158, 30), (158, 98), (226, 98), (226, 158), (158, 158), (158, 226), (98, 226), (98, 158),
                                   (30, 158), (30, 98), (98, 98)], fill=255)
    put('pharmacy', neon_sign((256, 256), [(cross, GREEN, 16)]))
    put('street', lightbox((512, 128), (30, 70, 150), (230, 230, 240), 'NEON ST.', font('arialbd.ttf', 80), (245, 245, 250)))
    put('alley', lightbox((512, 128), (30, 70, 150), (230, 230, 240), '← BACK ALLEY', font('arialbd.ttf', 64), (245, 245, 250)))
    menu = board((512, 256), (28, 18, 12), (14, 8, 6))
    md = ImageDraw.Draw(menu)
    md.text((256, 40), 'MENU  品書き', font=jp(40), fill=(255, 220, 160), anchor='mm')
    for i, (a, b) in enumerate([('SHOYU RAMEN', '880'), ('MISO RAMEN', '920'), ('GYOZA x6', '450'), ('TEA', '200')]):
        md.text((40, 88 + i * 40), a, font=font('bahnschrift.ttf', 30), fill=(250, 235, 210), anchor='lm')
        md.text((472, 88 + i * 40), b, font=font('bahnschrift.ttf', 30), fill=(255, 190, 90), anchor='rm')
    menu = add_light(menu, frame_mask((512, 256), 8, 4).filter(ImageFilter.GaussianBlur(2)), ORANGE, .8)
    put('menu', menu)
    put('hotel', neon_sign((256, 256), [(text_mask((256, 256), 'ホテル', jp(70), (128, 128)), PINK, 10)], border=PINK))
    # vertical blades
    v = (192, 768)
    put('ramen_v', neon_sign(v, [(vtext_mask(v, 'ラーメン', jp(130)), RED, 12)], border=YELLOW))
    put('hotel_v', neon_sign(v, [(vtext_mask(v, 'HOTEL', font('ERASBD.TTF', 128), .06), PINK, 14)], border=PINK))
    put('karaoke_v', neon_sign(v, [(vtext_mask(v, 'カラオケ', jp(126)), PURPLE, 12)], border=CYAN))
    put('hostel_v', neon_sign(v, [(vtext_mask(v, 'HOSTEL', font('bahnschrift.ttf', 104), .05), CYAN, 12)], border=BLUE))
    # polish pass (2026-11-14): more yokocho-style vertical blades and three more boards
    put('izakaya_v', neon_sign(v, [(vtext_mask(v, '居酒屋', jp(140)), PINK, 12)], border=PURPLE))
    put('ramen2_v', neon_sign(v, [(vtext_mask(v, 'ラーメン', jp(130)), CYAN, 12)], border=BLUE))
    put('sake_v', neon_sign(v, [(vtext_mask(v, '酒場', jp(150)), YELLOW, 12)], border=ORANGE))
    put('bar_v', neon_sign(v, [(vtext_mask(v, 'BAR', font('ERASBD.TTF', 150), .12), GREEN, 14)], border=CYAN))
    put('motel_v', neon_sign(v, [(vtext_mask(v, 'MOTEL', font('ERASBD.TTF', 112), .06), PINK, 14)], border=PURPLE))
    put('udon_v', neon_sign(v, [(vtext_mask(v, 'うどん', jp(130)), ORANGE, 12)], border=YELLOW))
    put('club_v', neon_sign(v, [(vtext_mask(v, 'CLUB', font('ERASBD.TTF', 116), .08), PURPLE, 14)], border=PINK))
    put('mahjong_v', neon_sign(v, [(vtext_mask(v, '麻雀', jp(150)), RED, 12)], border=ORANGE))
    put('cafe_v', neon_sign(v, [(vtext_mask(v, 'CAFE', font('bahnschrift.ttf', 112), .08), CYAN, 12)], border=GREEN))
    put('pachinko_v', neon_sign(v, [(vtext_mask(v, 'パチンコ', jp(120)), YELLOW, 12)], border=RED))
    # overhaul (2026-11-15): warm blades for the food alley, a bathhouse and an electronics blade for the cool west lane
    put('yakitori_v', neon_sign(v, [(vtext_mask(v, '焼鳥', jp(150)), ORANGE, 12)], border=RED))
    put('sento_v', neon_sign(v, [(vtext_mask(v, '銭湯', jp(150)), CYAN, 12)], border=WHITE))
    put('gyoza_v', neon_sign(v, [(vtext_mask(v, '餃子', jp(150)), YELLOW, 12)], border=RED))
    put('denki_v', neon_sign(v, [(vtext_mask(v, '電器', jp(150)), BLUE, 12)], border=CYAN))
    put('oden_v', neon_sign(v, [(vtext_mask(v, 'おでん', jp(130)), RED, 12)], border=ORANGE))
    put('izakaya', neon_sign((1024, 256), [(text_mask((1024, 256), '居酒屋', jp(150), (290, 128)), PINK, 14),
                                           (text_mask((1024, 256), 'IZAKAYA', font('bahnschrift.ttf', 96), (730, 128), spacing=6), YELLOW, 12)], border=ORANGE))
    put('udon', neon_sign((512, 256), [(text_mask((512, 256), 'うどん', jp(130)), ORANGE, 12)], border=RED))
    put('motel', neon_sign((512, 256), [(text_mask((512, 256), 'MOTEL', font('ERASBD.TTF', 112), (256, 92), spacing=6), PINK, 14),
                                        (text_mask((512, 256), 'VACANCY', font('arialbd.ttf', 56), (256, 192), spacing=8), GREEN, 10)], border=PURPLE))
    # the big sign hung across the crossing: the map's name in English and katakana
    put('arch', neon_sign((1024, 256), [(text_mask((1024, 256), 'NEON BACKSTREETS', font('ERASBD.TTF', 82), (512, 86), spacing=3), PINK, 16),
                                         (text_mask((1024, 256), 'ネオン裏通り', jp(74), (512, 190)), CYAN, 12)], border=PURPLE))
    # rooftop billboards (lit print, not tubes)
    bb = Image.new('RGB', (1024, 384))
    d = ImageDraw.Draw(bb)
    for y in range(384):
        t = y / 383
        d.line([(0, y), (1024, y)], fill=(int(40 + 120 * t), int(10 + 20 * t), int(90 + 60 * (1 - t))))
    for i in range(16):
        x = 520 + i * 32
        h = 80 + (i * 37) % 150
        d.rectangle([x, 384 - h, x + 26, 384], fill=(14, 8, 30))
        for wy in range(384 - h + 10, 380, 18):
            if (wy + i * 7) % 3:
                d.rectangle([x + 6, wy, x + 12, wy + 6], fill=(255, 200, 120))
    d.ellipse([820, 40, 920, 140], fill=(255, 230, 200))
    d.text((60, 120), 'NIGHTSHIFT', font=font('ERASBD.TTF', 120), fill=(255, 255, 255), anchor='lm')
    d.text((66, 230), 'energy for the city that never sleeps', font=font('bahnschrift.ttf', 38), fill=(255, 210, 240), anchor='lm')
    bb = add_light(bb, frame_mask((1024, 384), 6, 6, 4).filter(ImageFilter.GaussianBlur(3)), WHITE, .5)
    put('billboard', bb)
    b2 = Image.new('RGB', (1024, 384), (10, 30, 50))
    d = ImageDraw.Draw(b2)
    for r in range(380, 0, -6):
        c = int(255 * (1 - r / 380))
        d.ellipse([300 - r, 192 - r, 300 + r, 192 + r], fill=(0, int(60 + c * .6), int(90 + c * .64)))
    d.text((600, 150), 'TOKI', font=font('impact.ttf', 150), fill=(255, 255, 255), anchor='mm')
    d.text((600, 270), 'wireless · 夜 · 24h', font=jp(40), fill=(180, 250, 255), anchor='mm')
    d.rounded_rectangle([230, 90, 370, 300], radius=26, outline=(255, 255, 255), width=10)
    put('billboard2', b2)
    pil = Image.new('RGB', (256, 768), (20, 10, 40))
    d = ImageDraw.Draw(pil)
    for i, (col, word) in enumerate([(PINK, 'LIVE'), (CYAN, 'MUSIC'), (YELLOW, 'FRI'), (PURPLE, '23:00')]):
        y = 60 + i * 175
        d.rectangle([20, y - 70, 236, y + 70], fill=tuple(int(c * .35) for c in col))
        d.text((128, y), word, font=font('ERASBD.TTF', 64), fill=col, anchor='mm')
    put('pillar', pil)
    sheet.save(OUT / 'neon_signs.jpg', quality=90)


# --- ad panels, karaoke screen, shop displays -------------------------------------------------------------------------
def gradient(size, a, b, vertical=True):
    img = Image.new('RGB', size)
    d = ImageDraw.Draw(img)
    n = size[1] if vertical else size[0]
    for i in range(n):
        t = i / max(1, n - 1)
        c = tuple(int(x + (y - x) * t) for x, y in zip(a, b))
        d.line([(0, i), (size[0], i)] if vertical else [(i, 0), (i, size[1])], fill=c)
    return img


def paint_panels():
    W, H = art.PANELS_SIZE
    sheet = Image.new('RGB', (W, H), (8, 8, 12))

    def put(name, img):
        x, y, w, h = art.PANELS[name]
        sheet.paste(img.resize((w, h), Image.LANCZOS), (x, y))
    s = (384, 576)
    a = gradient(s, (255, 70, 90), (90, 10, 60))
    d = ImageDraw.Draw(a)
    d.rounded_rectangle([132, 150, 252, 430], radius=30, fill=(245, 245, 250))
    d.rectangle([132, 230, 252, 330], fill=(230, 40, 70))
    d.text((192, 280), 'FIZZ', font=font('impact.ttf', 50), fill=(255, 255, 255), anchor='mm')
    d.text((192, 80), 'FIZZ ZERO', font=font('impact.ttf', 70), fill=(255, 255, 255), anchor='mm')
    d.text((192, 500), 'ice cold · 120¥', font=font('bahnschrift.ttf', 34), fill=(255, 230, 240), anchor='mm')
    put('ad_fizz', a)
    a = gradient(s, (250, 200, 70), (220, 70, 20))
    d = ImageDraw.Draw(a)
    d.pieslice([72, 190, 312, 420], 0, 180, fill=(250, 250, 245))
    d.ellipse([72, 250, 312, 330], fill=(200, 120, 50))
    for k in range(5):
        d.arc([110 + k * 30, 210, 170 + k * 30, 300], 200, 340, fill=(255, 230, 160), width=6)
    d.line([(230, 170), (330, 300)], fill=(120, 60, 20), width=8)
    d.line([(250, 160), (340, 290)], fill=(120, 60, 20), width=8)
    d.text((192, 80), 'MIDNIGHT', font=font('ERASBD.TTF', 58), fill=(120, 20, 10), anchor='mm')
    d.text((192, 140), 'NOODLE', font=font('ERASBD.TTF', 58), fill=(120, 20, 10), anchor='mm')
    d.text((192, 500), '3 min · hot', font=font('bahnschrift.ttf', 36), fill=(255, 250, 230), anchor='mm')
    put('ad_noodle', a)
    a = gradient(s, (20, 20, 30), (40, 10, 80))
    d = ImageDraw.Draw(a)
    d.text((192, 220), '-50%', font=font('impact.ttf', 150), fill=(255, 230, 40), anchor='mm')
    d.text((192, 360), 'NIGHT SALE', font=font('impact.ttf', 70), fill=(255, 255, 255), anchor='mm')
    d.text((192, 470), 'every day 22-04', font=font('bahnschrift.ttf', 34), fill=(200, 200, 255), anchor='mm')
    a = add_light(a, frame_mask(s, 14, 6).filter(ImageFilter.GaussianBlur(3)), PINK, .8)
    put('ad_sale', a)
    a = gradient(s, (10, 60, 70), (5, 15, 30))
    d = ImageDraw.Draw(a)
    for k in range(6):
        d.line([(0, 300 + k * 18 - 60), (384, 220 + k * 18 - 60)], fill=(40, 230 - k * 25, 255), width=6)
    d.text((192, 110), 'PULSE', font=font('ERASBD.TTF', 96), fill=(160, 255, 255), anchor='mm')
    d.text((192, 470), 'stay awake', font=font('segoeprb.ttf', 52), fill=(255, 255, 255), anchor='mm')
    put('ad_pulse', a)
    # karaoke screen and the menu board in the ramen shop
    sc = gradient((512, 288), (30, 0, 70), (120, 0, 120))
    d = ImageDraw.Draw(sc)
    d.text((256, 110), '♪ NEON HEART ♪', font=font('seguisym.ttf', 44), fill=(255, 255, 255), anchor='mm')
    d.text((256, 190), 'sing it under the city lights', font=font('bahnschrift.ttf', 30), fill=(255, 220, 90), anchor='mm')
    d.rectangle([60, 240, 300, 252], fill=(255, 80, 200))
    put('screen', sc)
    mb = board((512, 288), (30, 20, 14), (20, 12, 8))
    d = ImageDraw.Draw(mb)
    for i, (word, price) in enumerate([('醤油', '880'), ('味噌', '920'), ('塩', '850'), ('餃子', '450')]):
        d.text((90, 50 + i * 60), word, font=jp(46), fill=(255, 240, 220), anchor='lm')
        d.text((420, 50 + i * 60), price, font=font('bahnschrift.ttf', 40), fill=(255, 180, 80), anchor='rm')
    put('menu_board', mb)
    # shop displays seen through the perimeter windows: back walls with depth painted in
    rnd = random.Random(11)

    def room(bg_top, bg_bottom, floor):
        img = gradient((512, 224), bg_top, bg_bottom)
        ImageDraw.Draw(img).rectangle([0, 176, 512, 224], fill=floor)
        return img
    im = room((20, 8, 40), (10, 4, 20), (30, 10, 50))
    d = ImageDraw.Draw(im)
    for k in range(6):
        x = 20 + k * 82
        d.rectangle([x, 60, x + 66, 190], fill=(12, 10, 18))
        col = [PINK, CYAN, YELLOW, GREEN, PURPLE, ORANGE][k]
        d.rectangle([x + 8, 70, x + 58, 120], fill=tuple(int(c * .9) for c in col))
        for j in range(5):
            d.rectangle([x + 12 + j * 9, 80 + (j * 13 + k * 7) % 30, x + 18 + j * 9, 86 + (j * 13 + k * 7) % 30], fill=(255, 255, 255))
    put('disp_arcade', im)
    im = room((120, 70, 40), (60, 34, 20), (50, 30, 20))
    d = ImageDraw.Draw(im)
    d.rectangle([150, 120, 362, 180], fill=(40, 24, 14))
    d.rectangle([150, 112, 362, 122], fill=(180, 140, 90))
    d.ellipse([60, 40, 110, 90], fill=(255, 220, 150))
    d.ellipse([400, 40, 450, 90], fill=(255, 220, 150))
    d.text((256, 60), 'RECEPTION', font=font('bahnschrift.ttf', 28), fill=(255, 230, 190), anchor='mm')
    put('disp_lobby', im)
    for name, wall, items in (('disp_shop', (220, 230, 235), 1), ('disp_pharmacy', (230, 245, 238), 2)):
        im = room(wall, tuple(int(c * .8) for c in wall), (200, 200, 200))
        d = ImageDraw.Draw(im)
        for row in range(4):
            y = 40 + row * 34
            d.rectangle([20, y + 26, 492, y + 30], fill=(150, 150, 160))
            for k in range(28):
                c = (rnd.randrange(60, 255), rnd.randrange(60, 255), rnd.randrange(60, 255)) if items == 1 else (rnd.randrange(200, 255), 255, rnd.randrange(200, 255))
                d.rectangle([24 + k * 17, y + 4 + rnd.randrange(6), 36 + k * 17, y + 26], fill=c)
        if items == 2:
            d.rectangle([236, 4, 276, 34], fill=(40, 200, 110))
        put(name, im)
    im = room((70, 30, 14), (30, 12, 6), (40, 20, 10))
    d = ImageDraw.Draw(im)
    for row in range(3):
        for k in range(22):
            c = rnd.choice([(80, 200, 120), (200, 120, 40), (220, 220, 240), (150, 40, 40), (60, 120, 200)])
            d.rectangle([30 + k * 21, 30 + row * 40, 40 + k * 21, 60 + row * 40], fill=c)
    d.rectangle([0, 150, 512, 190], fill=(60, 30, 14))
    d.rectangle([0, 146, 512, 152], fill=(255, 190, 110))
    put('disp_bar', im)
    im = room((70, 10, 90), (30, 4, 50), (40, 6, 50))
    d = ImageDraw.Draw(im)
    for _ in range(60):
        x, y = rnd.randrange(512), rnd.randrange(170)
        d.ellipse([x, y, x + 5, y + 5], fill=rnd.choice([PINK, CYAN, YELLOW, WHITE]))
    d.rectangle([180, 40, 332, 120], fill=(20, 0, 40))
    d.rectangle([186, 46, 326, 114], fill=(140, 40, 200))
    d.rounded_rectangle([60, 140, 452, 190], radius=20, fill=(110, 20, 60))
    put('disp_karaoke', im)
    im = room((40, 10, 12), (20, 4, 6), (30, 10, 10))
    d = ImageDraw.Draw(im)
    for k in range(5):
        x = 30 + k * 96
        d.rectangle([x, 30, x + 76, 120], fill=(230, 220, 200))
        d.ellipse([x + 18, 46, x + 58, 86], outline=(180, 30, 30), width=5)
        d.line([(x + 38, 86), (x + 38, 110)], fill=(30, 30, 30), width=4)
    d.rectangle([200, 140, 330, 180], fill=(15, 15, 15))
    put('disp_tattoo', im)
    im = room((90, 60, 40), (50, 30, 20), (60, 40, 30))
    d = ImageDraw.Draw(im)
    for k in range(4):
        d.ellipse([60 + k * 110, 100, 140 + k * 110, 150], fill=(200, 200, 205))
        for j in range(3):
            d.arc([70 + k * 110 + j * 15, 40, 110 + k * 110 + j * 15, 110], 200, 330, fill=(240, 240, 240), width=3)
    d.rectangle([0, 150, 512, 176], fill=(110, 70, 40))
    put('disp_noodle', im)
    # door curtains (noren) for the noodle shop: dark red cloth flaps with a white brushed glyph each
    nr = Image.new('RGB', (512, 256), (14, 8, 8))
    d = ImageDraw.Draw(nr)
    d.rectangle([0, 0, 512, 26], fill=(70, 44, 28))
    rnd2 = random.Random(5)
    for k, ch in enumerate('ラーメン'):
        x0 = 14 + k * 123
        for y in range(26, 256):
            t = (y - 26) / 230
            d.line([(x0, y), (x0 + 112, y)], fill=(int(150 - 40 * t), int(26 - 8 * t), int(32 - 10 * t)))
        for _ in range(180):
            xx, yy = rnd2.randrange(x0, x0 + 112), rnd2.randrange(30, 250)
            d.point((xx, yy), fill=(110, 18, 24))
        d.text((x0 + 56, 132), ch, font=jp(118), fill=(238, 224, 200), anchor='mm')
        d.rectangle([x0 + 108, 26, x0 + 112, 256], fill=(40, 6, 8))
    put('noren', nr)
    sp = board((256, 256), (18, 30, 26), (10, 18, 16))
    d = ImageDraw.Draw(sp)
    d.rectangle([6, 6, 249, 249], outline=(150, 110, 70), width=6)
    d.text((128, 52), "TODAY'S", font=font('segoeprb.ttf', 40), fill=(250, 245, 235), anchor='mm')
    d.text((128, 100), 'SPECIAL', font=font('segoeprb.ttf', 44), fill=(255, 150, 190), anchor='mm')
    d.text((128, 160), '豚骨ラーメン', font=jp(34), fill=(255, 235, 170), anchor='mm')
    d.text((128, 205), '¥ 900', font=font('segoeprb.ttf', 40), fill=(250, 245, 235), anchor='mm')
    put('specials', sp)
    # overhaul: shoji screens. Warm paper lit from inside behind a dark timber lattice, with a darker kick board
    for name, size, cols in (('shoji', (512, 256), 8), ('shoji_tall', (256, 256), 4)):
        sh = gradient(size, (255, 214, 130), (232, 150, 60))
        d = ImageDraw.Draw(sh)
        rnd3 = random.Random(9)
        for _ in range(6):      # faint silhouettes and stains behind the paper
            xx, yy = rnd3.randrange(size[0]), rnd3.randrange(40, 200)
            d.ellipse([xx - 30, yy - 44, xx + 30, yy + 44], fill=(236, 170, 84))
        sh = sh.filter(ImageFilter.GaussianBlur(7))
        d = ImageDraw.Draw(sh)
        wood = (38, 24, 16)
        cw = size[0] / cols
        for k in range(cols + 1):
            x = min(size[0] - 4, max(4, k * cw))
            d.rectangle([x - 4, 0, x + 4, size[1]], fill=wood)
            if k < cols:
                for j in (1, 2):
                    d.rectangle([x + cw * j / 3 - 1.5, 0, x + cw * j / 3 + 1.5, 206], fill=wood)
        for y in (0, 52, 104, 156, 206):
            d.rectangle([0, y - 3, size[0], y + 3], fill=wood)
        d.rectangle([0, 210, size[0], size[1]], fill=(52, 34, 22))
        d.rectangle([0, 0, size[0], 7], fill=wood)
        put(name, sh)
    sheet.save(OUT / 'neon_panels.jpg', quality=90)


# --- lit windows ---------------------------------------------------------------------------------------------------------
def paint_windows():
    W, H = art.WINDOWS_SIZE
    sheet = Image.new('RGB', (W, H), (0, 0, 0))
    rnd = random.Random(5)
    warm, cool, tv = (255, 196, 120), (170, 210, 255), (90, 140, 255)
    for cell in range(16):
        c, r = cell % 4, cell // 4
        img = Image.new('RGB', (128, 128))
        d = ImageDraw.Draw(img)
        kind = r
        base = [warm, cool, tv, (20, 24, 34)][kind]
        bright = [1.0, .9, .55, 1.0][kind]
        for y in range(128):
            t = y / 127
            col = tuple(int(v * bright * (.75 + .35 * (1 - t))) for v in base)
            d.line([(0, y), (128, y)], fill=col)
        if kind == 0:   # curtains drawn to the sides, a lamp or a plant
            d.rectangle([0, 0, 24 + c * 4, 128], fill=(150, 60, 50) if c % 2 else (90, 70, 110))
            d.rectangle([104 - c * 3, 0, 128, 128], fill=(150, 60, 50) if c % 2 else (90, 70, 110))
            if c == 1:
                d.ellipse([54, 70, 84, 110], fill=(30, 50, 25))
            if c == 2:
                d.polygon([(60, 40), (78, 40), (84, 60), (54, 60)], fill=(255, 240, 200))
        elif kind == 1:  # blinds
            for y in range(4, 128, 9):
                d.line([(0, y), (128, y)], fill=tuple(int(v * .55) for v in base), width=3)
            if c == 3:
                d.rectangle([0, 64, 128, 128], fill=tuple(int(v * .35) for v in base))
        elif kind == 2:  # dim room lit by a television
            d.rectangle([0, 0, 128, 128], fill=(14, 16, 30))
            d.rectangle([40 + c * 6, 60, 88 + c * 6, 92], fill=tv)
            img = img.filter(ImageFilter.GaussianBlur(6))
            d = ImageDraw.Draw(img)
        else:            # dark glass with a faint reflection streak
            d.polygon([(20 + c * 10, 0), (44 + c * 10, 0), (14 + c * 10, 128), (-10 + c * 10, 128)], fill=(40, 46, 64))
        # frame bars
        d.rectangle([0, 0, 127, 127], outline=(10, 10, 12), width=6)
        d.line([(64, 0), (64, 128)], fill=(10, 10, 12), width=5)
        sheet.paste(img, (c * 128, r * 128))
    del rnd
    sheet.save(OUT / 'neon_windows.jpg', quality=90)


# --- graffiti ---------------------------------------------------------------------------------------------------------------
def paint_graffiti():
    W, H = art.GRAFFITI_SIZE
    sheet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    tags = [('KAZE', 'impact.ttf', (255, 70, 160), (40, 220, 255)), ('NEON', 'ERASBD.TTF', (60, 240, 255), (255, 255, 255)),
            ('RUSH', 'impact.ttf', (255, 200, 40), (255, 60, 60)), ('ZERO', 'BAUHS93.TTF', (160, 90, 255), (255, 120, 220)),
            ('VX-9', 'impact.ttf', (60, 255, 140), (20, 90, 255)), ('DRIP', 'segoeprb.ttf', (255, 120, 60), (255, 230, 90)),
            ('夜猫', 'YuGothB.ttc', (255, 80, 120), (255, 255, 255)), ('LUNA', 'segoeprb.ttf', (120, 200, 255), (255, 90, 200))]
    rnd = random.Random(23)
    for cell, (word, fname, fill_a, fill_b) in enumerate(tags):
        c, r = cell % 2, cell // 2
        size = (512, 256)
        fnt = font(fname, 150 if len(word) > 2 else 170)
        m = text_mask(size, word, fnt, (256, 118))
        m = m.rotate(rnd.uniform(-7, 7), resample=Image.BICUBIC)
        outline = ImageChops.subtract(dilate(m, 13), m)
        shadow = dilate(m, 13).transform(size, Image.AFFINE, (1, 0, -8, 0, 1, -8))
        fillimg = gradient(size, fill_a, fill_b)
        img = Image.new('RGBA', size, (0, 0, 0, 0))
        img.paste((10, 10, 14, 255), (0, 0), shadow)
        img.paste((15, 12, 20, 255), (0, 0), outline)
        img.paste(fillimg, (0, 0), m)
        # drips under the letters
        d = ImageDraw.Draw(img)
        bbox = m.getbbox() or (100, 60, 400, 180)
        for _ in range(7):
            x = rnd.randrange(bbox[0] + 10, max(bbox[0] + 11, bbox[2] - 10))
            y0 = bbox[3] - 6
            L = rnd.randrange(14, 60)
            d.line([(x, y0), (x, y0 + L)], fill=fill_a + (255,), width=5)
            d.ellipse([x - 4, y0 + L - 3, x + 4, y0 + L + 5], fill=fill_a + (255,))
        # overspray: a faint speckled halo
        a = img.split()[3]
        halo = dilate(a, 9).filter(ImageFilter.GaussianBlur(6)).point(lambda v: int(v * .3))
        speck = Image.effect_noise(size, 90).point(lambda v: 255 if v > 200 else 0)
        halo = ImageChops.multiply(halo, speck)
        base = Image.new('RGBA', size, fill_a + (0,))
        base.putalpha(halo)
        img = Image.alpha_composite(base, img)
        sheet.paste(img, (c * 512, r * 256), img)
    # cells 8..11: rain streaks (dark), rust streaks, cracks and stickers; hard-edged (alpha test) on purpose
    def cell_at(i):
        return (i % 2) * 512, (i // 2) * 256

    def streaks(cell, color, seed, n, lo, hi, width):
        r2 = random.Random(seed)
        img = Image.new('RGBA', (512, 256), (0, 0, 0, 0))
        d2 = ImageDraw.Draw(img)
        for _ in range(n):
            x = r2.randrange(8, 504)
            L = r2.randrange(lo, hi)
            w = r2.randrange(width[0], width[1])
            top = r2.randrange(0, 40)
            for yy in range(top, min(256, top + L)):
                tt = (yy - top) / L
                ww = max(1, int(w * (1 - tt * .75)))
                wob = int(2 * math.sin(yy * .07 + x))
                d2.line([(x + wob - ww // 2, yy), (x + wob + ww // 2, yy)], fill=color + (255,))
            d2.ellipse([x - 2, top + L - 2, x + 2, top + L + 3], fill=color + (255,))
        sheet.paste(img, cell_at(cell), img)
    streaks(8, (20, 18, 26), 41, 34, 70, 230, (3, 9))
    streaks(9, (88, 48, 28), 43, 22, 50, 190, (3, 8))
    r3 = random.Random(47)
    img = Image.new('RGBA', (512, 256), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(img)

    def crack(x, y, ang, L, w):
        pts = [(x, y)]
        for _ in range(int(L / 9)):
            ang += r3.uniform(-.5, .5)
            x += math.cos(ang) * 9
            y += math.sin(ang) * 9
            pts.append((x, y))
            if r3.random() < .12 and w > 1:
                crack(x, y, ang + r3.choice((-1, 1)) * r3.uniform(.5, 1.0), L * .4, w - 1)
        d2.line(pts, fill=(10, 9, 14, 255), width=w, joint='curve')
    for sx, sy, a in ((40, 120, 0.2), (250, 20, 1.3), (470, 150, 3.0), (200, 230, 4.6)):
        crack(sx, sy, a, r3.randrange(190, 300), 3)
    sheet.paste(img, cell_at(10), img)
    img = Image.new('RGBA', (512, 256), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(img)
    for k in range(14):
        x, y = r3.randrange(20, 470), r3.randrange(20, 210)
        w, h = r3.randrange(26, 54), r3.randrange(20, 40)
        col = r3.choice([PINK, CYAN, YELLOW, GREEN, ORANGE, (240, 240, 245)])
        if r3.random() < .5:
            d2.rounded_rectangle([x, y, x + w, y + h], radius=6, fill=col + (255,), outline=(20, 18, 28, 255), width=3)
            d2.line([(x + 6, y + h // 2), (x + w - 6, y + h // 2)], fill=(20, 18, 28, 255), width=3)
        else:
            d2.ellipse([x, y, x + h, y + h], fill=col + (255,), outline=(20, 18, 28, 255), width=3)
            d2.ellipse([x + h // 3, y + h // 3, x + 2 * h // 3, y + 2 * h // 3], fill=(20, 18, 28, 255))
    sheet.paste(img, cell_at(11), img)
    sheet.save(OUT / 'neon_graffiti.png')


# --- glow cards -----------------------------------------------------------------------------------------------------------
def paint_glows():
    n = 128
    img = Image.new('RGBA', (n, n))
    px = img.load()
    for y in range(n):
        for x in range(n):
            r = math.hypot((x + .5) / n * 2 - 1, (y + .5) / n * 2 - 1)
            a = max(0.0, 1 - r) ** 2.2
            px[x, y] = (255, 255, 255, int(255 * a))
    img.save(OUT / 'glow_soft.png')
    # wet-ground reflection: a vertical streak broken into ripples, brightest at the top (the wall end)
    w, h = 128, 256
    img = Image.new('RGBA', (w, h))
    px = img.load()
    rnd = random.Random(3)
    bands = [rnd.random() for _ in range(64)]
    for y in range(h):
        t = (y + .5) / h
        ripple = .55 + .45 * bands[int(t * 63)] * (.6 + .4 * math.sin(y * .35))
        along = (1 - t) ** 1.3 * min(1.0, t * 8)
        for x in range(w):
            u = (x + .5) / w * 2 - 1
            wob = .08 * math.sin(y * .21 + bands[int(t * 63)] * 6)
            across = math.exp(-((u - wob) / .42) ** 2)
            px[x, y] = (255, 255, 255, int(255 * min(1.0, across * along * ripple)))
    img.save(OUT / 'glow_wet.png')
    # steam puff: a soft blob with value-noise breakup (the Steam particle system tints it per emitter)
    n = 128
    img = Image.new('RGBA', (n, n))
    px = img.load()
    for y in range(n):
        for x in range(n):
            u, v = (x + .5) / n * 2 - 1, (y + .5) / n * 2 - 1
            r = math.hypot(u, v)
            k = .55 + .45 * vnoise(x * .07, y * .07, 5, 1000) * 2 - .45
            a = max(0.0, 1 - r) ** 1.5 * max(0.0, min(1.0, k))
            px[x, y] = (255, 255, 255, int(255 * a))
    img.save(OUT / 'smoke.png')
    # light shaft: soft across, long fade along (top bright)
    w, h = 64, 256
    img = Image.new('RGBA', (w, h))
    px = img.load()
    for y in range(h):
        t = (y + .5) / h
        along = (1 - t) ** 1.1 * min(1.0, t * 12)
        for x in range(w):
            u = abs((x + .5) / w * 2 - 1)
            across = max(0.0, 1 - u) ** 1.7
            px[x, y] = (255, 255, 255, int(255 * across * along))
    img.save(OUT / 'beam.png')


# --- distant towers -----------------------------------------------------------------------------------------------------
def paint_skyline():
    """A tiling facade of dark storeys with scattered lit windows (one repeat = 9 m: 6 storeys x 8 bays)."""
    n = 512
    img = Image.new('RGB', (n, n), (7, 7, 11))
    d = ImageDraw.Draw(img)
    rnd = random.Random(77)
    cw, ch = n / 8, n / 6
    for r in range(6):
        for c in range(8):
            x0, y0 = c * cw + cw * .2, r * ch + ch * .25
            x1, y1 = c * cw + cw * .8, r * ch + ch * .78
            v = rnd.random()
            if v < .45:
                col = rnd.choice([(255, 190, 110), (255, 210, 150), (180, 210, 255), (140, 170, 255), (255, 140, 200)])
                k = rnd.uniform(.45, 1.0)
                col = tuple(int(x * k) for x in col)
            else:
                col = (16, 17, 26)
            d.rectangle([x0, y0, x1, y1], fill=col)
        d.rectangle([0, r * ch + ch - 4, n, r * ch + ch], fill=(12, 12, 18))
    img.save(OUT / 'skyline_windows.jpg', quality=88)


# --- night sky -----------------------------------------------------------------------------------------------------------
def _hash(ix, iz, seed):
    n = (ix * 374761393 + iz * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, z, seed, wrap):
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    fx, fz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a, b = _hash(ix % wrap, iz, seed), _hash((ix + 1) % wrap, iz, seed)
    c, d = _hash(ix % wrap, iz + 1, seed), _hash((ix + 1) % wrap, iz + 1, seed)
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz


def sky_radiance(u, v):
    """Linear RGB radiance of the night sky at panorama (u, v): v = 0 is the zenith."""
    elev = (0.5 - v) * math.pi            # +pi/2 zenith .. -pi/2 nadir
    if elev < 0:
        k = max(0.0, 1 + elev * 3)
        return (0.035 * k + .006, 0.02 * k + .005, 0.04 * k + .008)
    h = 1 - elev / (math.pi / 2)         # 1 at the horizon, 0 at the zenith
    # zenith navy -> violet -> magenta/orange city glow at the horizon
    r = .003 + .035 * h ** 3 + .09 * h ** 9
    g = .004 + .012 * h ** 3 + .026 * h ** 9
    b = .014 + .045 * h ** 2.5 + .05 * h ** 9
    # clouds lit from below by the city: two octaves of wrapped value noise, stretched horizontally
    n = .65 * vnoise(u * 12, v * 30, 2, 12) + .35 * vnoise(u * 28, v * 70, 9, 28)
    cloud = max(0.0, n - .48) * 2.4 * min(1.0, h * 1.6) * (1 - h ** 6 * .5)
    r += cloud * (.06 + .08 * h)
    g += cloud * (.02 + .025 * h)
    b += cloud * (.055 + .035 * h)
    # coloured glow domes over the surrounding streets (they tint reflections in the wet ground)
    for cu, col, width in ((.12, (1.0, .25, .7), .07), (.38, (.2, .75, 1.0), .06), (.63, (.75, .3, 1.0), .08), (.86, (1.0, .45, .2), .06)):
        du = min(abs(u - cu), 1 - abs(u - cu))
        g_ = math.exp(-(du / width) ** 2) * h ** 7 * .22
        r, g, b = r + col[0] * g_, g + col[1] * g_, b + col[2] * g_
    return (r, g, b)


def write_hdr(path, w, h, fn):
    def rgbe(r, g, b):
        m = max(r, g, b)
        if m < 1e-32:
            return b'\0\0\0\0'
        e = math.frexp(m)[1]
        s = 256.0 / (2 ** e)
        return bytes((min(255, int(r * s)), min(255, int(g * s)), min(255, int(b * s)), e + 128))
    rows = []
    for y in range(h):
        v = (y + .5) / h
        rows.append(b''.join(rgbe(*fn((x + .5) / w, v)) for x in range(w)))
    head = f'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {h} +X {w}\n'.encode()
    path.write_bytes(head + b''.join(rows))


def paint_sky():
    w, h = 1024, 512
    write_hdr(ENV / 'sky_neon_1k.hdr', w, h, sky_radiance)
    # display-referred panorama: the same radiance, tone mapped, with faint stars near the zenith
    W, H = 2048, 1024
    small = Image.new('RGB', (w, h))
    px = small.load()
    expo = 4.0
    for y in range(h):
        for x in range(w):
            r, g, b = sky_radiance((x + .5) / w, (y + .5) / h)
            px[x, y] = tuple(int(255 * (1 - math.exp(-c * expo)) ** (1 / 2.2)) for c in (r, g, b))
    img = small.resize((W, H), Image.BICUBIC)
    d = ImageDraw.Draw(img)
    rnd = random.Random(42)
    for _ in range(420):
        x, y = rnd.randrange(W), int(rnd.random() ** 1.8 * H * .38)
        a = rnd.randrange(70, 190)
        d.point((x, y), fill=(a, a, min(255, a + 25)))
    img.save(ENV / 'sky_neon_2k.jpg', quality=90)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    paint_signs()
    paint_panels()
    paint_windows()
    paint_graffiti()
    paint_glows()
    paint_skyline()
    paint_sky()
    sys.path.insert(0, str(ROOT / 'tools'))
    import neon_ground_art
    neon_ground_art.paint_all(sys.modules[__name__])
    print('wrote', OUT, 'and', ENV / 'sky_neon_1k.hdr')


if __name__ == '__main__':
    main()
