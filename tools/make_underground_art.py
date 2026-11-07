"""Original wall art for the underground spaces and the decorative posters on every map (Pillow).

Usage: python -I tools/make_underground_art.py

Writes two texture atlases (deterministic, nothing downloaded):
  public/assets/textures/urban/posters_fun.jpg          4 x 3 playful fictional posters (384 x 576 each)
  public/assets/textures/modern-city/underground_signs.jpg   4 x 8 signage cells (512 x 192 each); the station
      name banner spans two cells, the route map spans 2 x 3 cells; the last two rows are old enamel
      signs for the town cellar.
The cell layout must match ATLASES / the cell tables in blender/scripts/lib/underground.py and
tools/compact_layouts.py. All names, places and logos are invented.
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_procedural_textures import CITY, URBAN, font, noise  # noqa: E402

PLAYFUL = ["comicbd.ttf", "segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
HEAVY = ["impact.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
CLEAN = ["bahnschrift.ttf", "segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
SERIF = ["georgiab.ttf", "timesbd.ttf", "DejaVuSerif-Bold.ttf", "arialbd.ttf"]
WHITE, INK = (250, 248, 240), (28, 28, 34)


def centred(d: ImageDraw.ImageDraw, cx: float, y: float, text: str, ff, fill, stroke=0, stroke_fill=(0, 0, 0), maxw=None):
    w = d.textlength(text, font=ff)
    if maxw and w > maxw and hasattr(ff, "path"):
        size = ff.size
        while w > maxw and size > 12:
            size -= 2
            ff = ImageFont.truetype(ff.path, size)
            w = d.textlength(text, font=ff)
    d.text((cx - w / 2, y), text, font=ff, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)


def fit(d, text, names, size, width, min_size=14):
    ff = font(names, size)
    while d.textlength(text, font=ff) > width and size > min_size:
        size -= 2
        ff = font(names, size)
    return ff, size


def pcentred(d, cx, y, text, ff, fill, stroke=0, stroke_fill=(0, 0, 0)):
    """Poster text: shrinks to fit the sheet."""
    centred(d, cx, y, text, ff, fill, stroke, stroke_fill, maxw=PW - 30)


def blob(d, cx, cy, r, fill, outline=None, width=0):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=outline, width=width)


# --------------------------------------------------------------------------------------------
# Posters: 4 x 3 cells of 384 x 576
# --------------------------------------------------------------------------------------------
PW, PH = 384, 576


def poster_flowers(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(255, 226, 232))
    for k in range(7):
        cx, cy = x + 60 + k * 44, y + 250 - (k % 3) * 30
        d.line([(cx, cy), (cx + (k - 3) * 6, y + 420)], fill=(60, 130, 70), width=6)
        col = [(255, 90, 140), (255, 200, 60), (255, 120, 80), (250, 250, 250), (190, 110, 230), (255, 90, 140), (255, 200, 60)][k]
        for a in range(8):
            ang = a * math.pi / 4
            blob(d, cx + math.cos(ang) * 22, cy + math.sin(ang) * 22, 17, col, (60, 40, 40), 2)
        blob(d, cx, cy, 13, (255, 220, 70), (120, 80, 20), 2)
    d.rectangle([x, y + 410, x + PW, y + 470], fill=(70, 150, 90))
    pcentred(d, x + PW / 2, y + 28, "PETUNIA'S", font(PLAYFUL, 66), (210, 40, 100), 3, WHITE)
    pcentred(d, x + PW / 2, y + 100, "FLOWER SHOP", font(PLAYFUL, 44), (80, 40, 90))
    pcentred(d, x + PW / 2, y + 420, "Say it with petals!", font(PLAYFUL, 38), WHITE, 2, (40, 90, 50))
    pcentred(d, x + PW / 2, y + 486, "fresh daisies  2 for 3", font(PLAYFUL, 30), (90, 40, 70))
    pcentred(d, x + PW / 2, y + 526, "Bloom Lane 14", font(PLAYFUL, 26), (90, 40, 70))


def poster_cat(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(248, 244, 214))
    d.rectangle([x + 10, y + 10, x + PW - 10, y + PH - 10], outline=(30, 30, 30), width=5)
    pcentred(d, x + PW / 2, y + 26, "MISSING", font(HEAVY, 92), (200, 30, 30))
    cx, cy = x + PW / 2, y + 250
    d.polygon([(cx - 100, cy - 50), (cx - 80, cy - 140), (cx - 30, cy - 85)], fill=(240, 150, 60), outline=(60, 40, 20))
    d.polygon([(cx + 100, cy - 50), (cx + 80, cy - 140), (cx + 30, cy - 85)], fill=(240, 150, 60), outline=(60, 40, 20))
    blob(d, cx, cy, 108, (244, 160, 66), (60, 40, 20), 4)
    for sx in (-1, 1):
        blob(d, cx + sx * 40, cy - 12, 20, (250, 250, 220), (40, 40, 40), 3)
        d.ellipse([cx + sx * 40 - 6, cy - 26, cx + sx * 40 + 6, cy + 2], fill=(20, 20, 20))
        for k in (-1, 0, 1):
            d.line([(cx + sx * 56, cy + 22 + k * 11), (cx + sx * 135, cy + 14 + k * 24)], fill=(50, 40, 30), width=3)
    d.polygon([(cx - 14, cy + 20), (cx + 14, cy + 20), (cx, cy + 36)], fill=(230, 100, 120), outline=(60, 30, 30))
    d.arc([cx - 30, cy + 28, cx, cy + 64], 0, 180, fill=(50, 30, 30), width=4)
    d.arc([cx, cy + 28, cx + 30, cy + 64], 0, 180, fill=(50, 30, 30), width=4)
    for k in range(3):
        d.line([(cx - 70 + k * 24, cy - 70), (cx - 62 + k * 24, cy - 100)], fill=(190, 100, 30), width=5)
    pcentred(d, x + PW / 2, y + 376, "SIR PURRCIVAL", font(PLAYFUL, 46), (30, 30, 80))
    pcentred(d, x + PW / 2, y + 428, "answers to 'Percy' (never does)", font(PLAYFUL, 24), INK)
    pcentred(d, x + PW / 2, y + 462, "fluffy, orange, judges you", font(PLAYFUL, 24), INK)
    pcentred(d, x + PW / 2, y + 506, "REWARD: TUNA", font(HEAVY, 40), (200, 30, 30))


def poster_concert(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(36, 24, 70))
    for k in range(18):
        a = k * math.pi / 9
        d.polygon([(x + PW / 2, y + 230), (x + PW / 2 + math.cos(a) * 400, y + 230 + math.sin(a) * 400),
                   (x + PW / 2 + math.cos(a + .12) * 400, y + 230 + math.sin(a + .12) * 400)], fill=(54, 36, 98) if k % 2 else (44, 30, 84))
    blob(d, x + PW / 2, y + 250, 130, (20, 20, 24), (250, 200, 70), 5)
    for r in (110, 90, 70, 50):
        blob(d, x + PW / 2, y + 250, r, None, (60, 60, 70), 2)
    blob(d, x + PW / 2, y + 250, 38, (255, 90, 120), (250, 240, 200), 3)
    blob(d, x + PW / 2, y + 250, 6, (20, 20, 24))
    pcentred(d, x + PW / 2, y + 22, "THE VELVET", font(HEAVY, 72), (255, 210, 70), 3, (110, 20, 60))
    pcentred(d, x + PW / 2, y + 96, "PICKLES", font(HEAVY, 84), (120, 230, 120), 3, (20, 70, 40))
    pcentred(d, x + PW / 2, y + 396, "LIVE!  Saturday 9 PM", font(PLAYFUL, 38), WHITE)
    pcentred(d, x + PW / 2, y + 446, "at The Rusty Kettle", font(PLAYFUL, 34), (255, 200, 120))
    pcentred(d, x + PW / 2, y + 496, "tickets 12  /  pickles free", font(PLAYFUL, 28), (190, 190, 240))


def poster_trattoria(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(214, 40, 36))
    for k in range(0, PW, 48):
        d.rectangle([x + k, y + PH - 18, x + k + 24, y + PH], fill=(250, 244, 230))
    pcentred(d, x + PW / 2, y + 22, "LUIGINA'S", font(SERIF, 64), (255, 238, 190), 2, (90, 10, 10))
    pcentred(d, x + PW / 2, y + 92, "TRATTORIA", font(SERIF, 52), (255, 238, 190))
    blob(d, x + PW / 2, y + 270, 124, (250, 244, 230), (80, 30, 20), 5)
    blob(d, x + PW / 2, y + 270, 96, (250, 200, 80), (200, 130, 30), 3)
    rnd = random.Random(7)
    for _ in range(14):
        a, r = rnd.uniform(0, 6.28), rnd.uniform(10, 84)
        px, py = x + PW / 2 + math.cos(a) * r, y + 270 + math.sin(a) * r
        d.arc([px - 24, py - 14, px + 24, py + 14], rnd.randint(0, 200), rnd.randint(200, 360), fill=(240, 160, 40), width=5)
    for px, py in ((-40, -30), (30, -10), (-10, 34), (46, 40)):
        blob(d, x + PW / 2 + px, y + 270 + py, 22, (150, 60, 36), (80, 30, 20), 3)
    pcentred(d, x + PW / 2, y + 404, "PASTA NIGHT", font(HEAVY, 46), (255, 238, 190))
    pcentred(d, x + PW / 2, y + 456, "Tue - Thu: 2 for 1 meatballs", font(PLAYFUL, 24), WHITE)
    pcentred(d, x + PW / 2, y + 516, "Via Lumaca 9  -  no pineapple", font(PLAYFUL, 24), (60, 20, 20))


def poster_water(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(120, 205, 240))
    for k in range(7):
        d.arc([x - 60 + k * 70, y + 440, x + 40 + k * 70, y + 520], 180, 360, fill=(240, 252, 255), width=8)
    d.polygon([(x + PW / 2, y + 120), (x + PW / 2 - 105, y + 300), (x + PW / 2 + 105, y + 300)], fill=(40, 130, 220), outline=(10, 60, 130))
    blob(d, x + PW / 2, y + 306, 105, (40, 130, 220), (10, 60, 130), 4)
    d.rectangle([x + PW / 2 - 80, y + 266, x + PW / 2 + 80, y + 310], fill=(20, 20, 30))
    blob(d, x + PW / 2 - 40, y + 288, 24, (40, 40, 60))
    blob(d, x + PW / 2 + 40, y + 288, 24, (40, 40, 60))
    d.arc([x + PW / 2 - 40, y + 320, x + PW / 2 + 40, y + 380], 20, 160, fill=(10, 40, 90), width=6)
    pcentred(d, x + PW / 2, y + 22, "HYDRATE", font(HEAVY, 76), WHITE, 4, (20, 80, 160))
    pcentred(d, x + PW / 2, y + 400, "OR DIEDRATE!", font(HEAVY, 54), (250, 220, 70), 3, (20, 60, 120))
    pcentred(d, x + PW / 2, y + 470, "Public Service Announcement", font(PLAYFUL, 24), (20, 60, 120))
    pcentred(d, x + PW / 2, y + 506, "drink water. be a hero.", font(PLAYFUL, 28), (20, 60, 120))


def poster_travel(d, x, y):
    for yy in range(PH):
        t = yy / PH
        d.line([(x, y + yy), (x + PW, y + yy)], fill=(int(255 - 50 * t), int(200 - 20 * t), int(90 + 70 * t)))
    blob(d, x + PW / 2, y + 250, 90, (255, 240, 150), (255, 170, 60), 6)
    d.polygon([(x, y + 330), (x + 110, y + 270), (x + 200, y + 330), (x + 300, y + 260), (x + PW, y + 330), (x + PW, y + 420), (x, y + 420)], fill=(40, 90, 150))
    for k in range(6):
        d.arc([x - 20 + k * 70, y + 380, x + 50 + k * 70, y + 430], 180, 360, fill=(230, 245, 255), width=6)
    d.polygon([(x + 70, y + 190), (x + 150, y + 176), (x + 160, y + 188), (x + 84, y + 206)], fill=(250, 250, 250), outline=(60, 60, 80))
    d.polygon([(x + 110, y + 190), (x + 130, y + 150), (x + 140, y + 152), (x + 128, y + 192)], fill=(220, 60, 60))
    pcentred(d, x + PW / 2, y + 24, "VISIT", font(HEAVY, 54), (130, 40, 20))
    pcentred(d, x + PW / 2, y + 74, "PLUMBERIA", font(HEAVY, 82), (130, 40, 20), 2, WHITE)
    pcentred(d, x + PW / 2, y + 436, "Sun, sand & sandwiches", font(PLAYFUL, 32), WHITE, 2, (40, 60, 100))
    pcentred(d, x + PW / 2, y + 486, "fly CLOUD AIR", font(HEAVY, 40), (255, 240, 150), 2, (40, 60, 100))
    pcentred(d, x + PW / 2, y + 536, "turbulence included", font(PLAYFUL, 22), WHITE)


def poster_tonic(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(236, 220, 176))
    d.rectangle([x + 14, y + 14, x + PW - 14, y + PH - 14], outline=(110, 70, 40), width=6)
    pcentred(d, x + PW / 2, y + 34, "DR. SPROCKET'S", font(SERIF, 54), (110, 40, 30))
    pcentred(d, x + PW / 2, y + 96, "TONIC", font(HEAVY, 88), (30, 90, 70), 2, (236, 220, 176))
    d.rounded_rectangle([x + PW / 2 - 52, y + 240, x + PW / 2 + 52, y + 410], radius=26, fill=(60, 140, 100), outline=(30, 70, 50), width=5)
    d.rectangle([x + PW / 2 - 22, y + 196, x + PW / 2 + 22, y + 244], fill=(60, 140, 100), outline=(30, 70, 50), width=4)
    d.rectangle([x + PW / 2 - 26, y + 184, x + PW / 2 + 26, y + 200], fill=(160, 100, 50))
    d.rectangle([x + PW / 2 - 44, y + 290, x + PW / 2 + 44, y + 370], fill=(250, 236, 190), outline=(110, 40, 30), width=3)
    pcentred(d, x + PW / 2, y + 300, "CURES", font(PLAYFUL, 26), (110, 40, 30))
    pcentred(d, x + PW / 2, y + 328, "EVERYTHING", font(PLAYFUL, 20), (110, 40, 30))
    pcentred(d, x + PW / 2, y + 428, "hiccups  -  boredom  -  mondays", font(PLAYFUL, 24), (110, 40, 30))
    pcentred(d, x + PW / 2, y + 470, "NOW WITH 40% MORE FIZZ", font(HEAVY, 34), (200, 60, 40))
    pcentred(d, x + PW / 2, y + 520, "est. 1923 - ask your goat", font(SERIF, 22), (80, 50, 30))


def poster_sock(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(255, 236, 120))
    pcentred(d, x + PW / 2, y + 30, "LOST", font(HEAVY, 120), (30, 30, 30))
    d.polygon([(x + 130, y + 190), (x + 230, y + 190), (x + 238, y + 330), (x + 310, y + 400), (x + 290, y + 450), (x + 120, y + 380)], fill=(240, 120, 150), outline=(80, 30, 50))
    for k in range(5):
        d.rectangle([x + 130, y + 200 + k * 26, x + 232, y + 214 + k * 26], fill=(250, 250, 250) if k % 2 else (120, 190, 240))
    pcentred(d, x + PW / 2, y + 468, "ONE LEFT SOCK", font(HEAVY, 46), (30, 30, 30))
    pcentred(d, x + PW / 2, y + 518, "very sentimental. striped.", font(PLAYFUL, 26), INK)
    d.rectangle([x + 20, y + 548, x + PW - 20, y + PH - 4], fill=(255, 236, 120))
    for k in range(10):
        d.line([(x + 38 + k * 34, y + 548), (x + 38 + k * 34, y + PH - 4)], fill=(120, 100, 40), width=2)


def poster_race(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(252, 244, 220))
    d.polygon([(x, y + 340), (x + PW, y + 250), (x + PW, y + PH), (x, y + PH)], fill=(80, 170, 120))
    pcentred(d, x + PW / 2, y + 22, "CITY", font(HEAVY, 64), (30, 40, 120))
    pcentred(d, x + PW / 2, y + 82, "MARATHON", font(HEAVY, 72), (210, 50, 50))
    cx, cy = x + 190, y + 250
    blob(d, cx, cy - 70, 24, (250, 210, 170), (60, 40, 30), 3)
    d.line([(cx, cy - 46), (cx, cy + 40)], fill=(30, 60, 160), width=14)
    d.line([(cx, cy - 30), (cx + 56, cy - 56)], fill=(250, 210, 170), width=10)
    d.line([(cx, cy - 30), (cx - 50, cy + 6)], fill=(250, 210, 170), width=10)
    d.line([(cx, cy + 40), (cx + 50, cy + 80)], fill=(30, 60, 160), width=12)
    d.line([(cx, cy + 40), (cx - 46, cy + 94)], fill=(30, 60, 160), width=12)
    d.rectangle([cx + 90, cy - 40, cx + 150, cy - 20], fill=(250, 250, 250), outline=(40, 40, 40), width=3)
    d.text((cx + 98, cy - 40), '5K', font=font(HEAVY, 18), fill=(210, 50, 50))
    blob(d, x + 300, y + 330, 44, (230, 170, 90), (110, 60, 30), 4)
    d.arc([x + 270, y + 300, x + 330, y + 330], 200, 340, fill=(110, 60, 30), width=3)
    pcentred(d, x + PW / 2, y + 420, "5K  -  RUN FOR PIE!", font(HEAVY, 44), WHITE, 3, (20, 90, 60))
    pcentred(d, x + PW / 2, y + 480, "Sunday 8 AM, Civic Plaza", font(PLAYFUL, 28), (20, 60, 40))
    pcentred(d, x + PW / 2, y + 520, "every finisher gets pie", font(PLAYFUL, 26), (20, 60, 40))


def poster_robot(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(200, 232, 214))
    pcentred(d, x + PW / 2, y + 22, "ROBOT", font(HEAVY, 88), (30, 70, 120))
    pcentred(d, x + PW / 2, y + 108, "REPAIR", font(HEAVY, 70), (30, 70, 120))
    cx, cy = x + PW / 2, y + 290
    d.rectangle([cx - 90, cy - 80, cx + 90, cy + 40], fill=(160, 170, 190), outline=(40, 50, 70), width=5)
    d.line([(cx, cy - 80), (cx, cy - 120)], fill=(40, 50, 70), width=6)
    blob(d, cx, cy - 126, 10, (240, 80, 80), (40, 50, 70), 3)
    for sx in (-1, 1):
        blob(d, cx + sx * 40, cy - 30, 24, (250, 250, 230), (40, 50, 70), 4)
        blob(d, cx + sx * 40 + sx * 4, cy - 28, 8, (40, 90, 200))
    d.rectangle([cx - 52, cy + 6, cx + 52, cy + 26], fill=(40, 50, 70))
    for k in range(7):
        d.line([(cx - 46 + k * 15, cy + 6), (cx - 46 + k * 15, cy + 26)], fill=(220, 220, 230), width=3)
    d.rectangle([cx - 60, cy + 46, cx + 60, cy + 120], fill=(130, 140, 165), outline=(40, 50, 70), width=5)
    pcentred(d, x + PW / 2, y + 420, "we fix toasters too", font(PLAYFUL, 36), (30, 70, 120))
    pcentred(d, x + PW / 2, y + 470, "beep boop - ring 555-0142", font(PLAYFUL, 30), INK)
    pcentred(d, x + PW / 2, y + 516, "no job too small, no bolt too loose", font(PLAYFUL, 22), INK)


def poster_pigeon(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(224, 214, 240))
    pcentred(d, x + PW / 2, y + 24, "BE KIND TO", font(HEAVY, 62), (70, 40, 120))
    pcentred(d, x + PW / 2, y + 86, "PIGEONS", font(HEAVY, 92), (70, 40, 120))
    cx, cy = x + PW / 2, y + 290
    d.ellipse([cx - 110, cy - 20, cx + 100, cy + 120], fill=(140, 150, 175), outline=(50, 50, 70), width=5)
    d.polygon([(cx + 90, cy + 30), (cx + 170, cy + 90), (cx + 100, cy + 100)], fill=(110, 120, 150), outline=(50, 50, 70))
    blob(d, cx - 90, cy - 30, 48, (150, 160, 190), (50, 50, 70), 5)
    d.polygon([(cx - 134, cy - 34), (cx - 168, cy - 24), (cx - 134, cy - 14)], fill=(250, 190, 70), outline=(110, 70, 20))
    blob(d, cx - 100, cy - 40, 9, (250, 250, 250), (20, 20, 20), 2)
    blob(d, cx - 98, cy - 40, 4, (20, 20, 20))
    d.arc([cx - 120, cy - 5, cx - 50, cy + 30], 0, 180, fill=(230, 120, 190), width=8)
    d.line([(cx - 30, cy + 118), (cx - 30, cy + 160)], fill=(230, 120, 90), width=6)
    d.line([(cx + 20, cy + 118), (cx + 20, cy + 160)], fill=(230, 120, 90), width=6)
    pcentred(d, x + PW / 2, y + 458, "they know where you live", font(PLAYFUL, 34), (70, 40, 120))
    pcentred(d, x + PW / 2, y + 512, "city pigeon council - est. 1801", font(PLAYFUL, 24), INK)


def poster_boba(d, x, y):
    d.rectangle([x, y, x + PW, y + PH], fill=(255, 190, 210))
    for k in range(12):
        rnd = random.Random(k)
        blob(d, x + rnd.randint(20, PW - 20), y + rnd.randint(250, 540), rnd.randint(6, 12), (110, 60, 50))
    pcentred(d, x + PW / 2, y + 20, "GRAND OPENING", font(HEAVY, 52), (140, 20, 90))
    pcentred(d, x + PW / 2, y + 74, "BUBBLE TEA", font(HEAVY, 78), WHITE, 3, (140, 20, 90))
    pcentred(d, x + PW / 2, y + 150, "PALACE", font(HEAVY, 78), (255, 240, 120), 3, (140, 20, 90))
    cx = x + PW / 2
    d.polygon([(cx - 70, y + 290), (cx + 70, y + 290), (cx + 52, y + 450), (cx - 52, y + 450)], fill=(240, 210, 160), outline=(110, 60, 30))
    d.rectangle([cx - 76, y + 280, cx + 76, y + 296], fill=(250, 250, 250), outline=(110, 60, 30), width=3)
    d.line([(cx + 18, y + 290), (cx + 38, y + 214)], fill=(230, 60, 120), width=10)
    for k in range(10):
        blob(d, cx - 40 + (k % 5) * 20, y + 420 + (k // 5) * 18 - (k % 3) * 4, 9, (60, 36, 30))
    pcentred(d, x + PW / 2, y + 470, "free pearl with every cup!", font(PLAYFUL, 30), (140, 20, 90))
    pcentred(d, x + PW / 2, y + 516, "queue politely. sip happily.", font(PLAYFUL, 24), (110, 30, 70))


POSTERS = [poster_flowers, poster_cat, poster_concert, poster_trattoria, poster_water, poster_travel,
           poster_tonic, poster_sock, poster_race, poster_robot, poster_pigeon, poster_boba]


def make_posters() -> None:
    cols, rows = 4, 3
    img = Image.new("RGB", (cols * PW, rows * PH), (230, 228, 220))
    for i, fn in enumerate(POSTERS):
        sheet = Image.new("RGB", (PW, PH), (230, 228, 220))   # each poster is drawn on its own sheet: nothing spills over
        fn(ImageDraw.Draw(sheet), 0, 0)
        img.paste(sheet, ((i % cols) * PW, (i // cols) * PH))
    # Paper grain and a little age, per cell edge, so the sheets do not look printed by a machine.
    paper = noise(max(img.size), 4, 91).crop((0, 0) + img.size).point(lambda v: int(222 + v * .14))
    img = ImageChops.multiply(img, Image.merge("RGB", [paper] * 3))
    URBAN.mkdir(parents=True, exist_ok=True)
    img.save(URBAN / "posters_fun.jpg", quality=88)


# --------------------------------------------------------------------------------------------
# Signs: 4 x 8 cells of 512 x 192 (name banner 2 x 1, route map 2 x 3)
# --------------------------------------------------------------------------------------------
CW, CH = 512, 192
BLUE, NAVY, GREEN, RED, AMBER = (22, 82, 168), (14, 30, 76), (18, 120, 70), (190, 36, 40), (240, 180, 30)


def arrow(d, cx, cy, size, direction, fill):
    """Solid arrow: direction in 'up', 'left', 'right', 'down'."""
    s = size
    shapes = {
        'up': [(cx, cy - s), (cx + s * .8, cy), (cx + s * .3, cy), (cx + s * .3, cy + s), (cx - s * .3, cy + s), (cx - s * .3, cy), (cx - s * .8, cy)],
        'down': [(cx, cy + s), (cx + s * .8, cy), (cx + s * .3, cy), (cx + s * .3, cy - s), (cx - s * .3, cy - s), (cx - s * .3, cy), (cx - s * .8, cy)],
        'left': [(cx - s, cy), (cx, cy - s * .8), (cx, cy - s * .3), (cx + s, cy - s * .3), (cx + s, cy + s * .3), (cx, cy + s * .3), (cx, cy + s * .8)],
        'right': [(cx + s, cy), (cx, cy - s * .8), (cx, cy - s * .3), (cx - s, cy - s * .3), (cx - s, cy + s * .3), (cx, cy + s * .3), (cx, cy + s * .8)],
    }
    d.polygon(shapes[direction], fill=fill)


def cell(i: int, span=(1, 1)):
    return (i % 4) * CW, (i // 4) * CH, span[0] * CW, span[1] * CH


def plate(d, i, bg, fg, text, sub=None, arrow_dir=None, names=CLEAN, size=76, span=(1, 1), border=None):
    x, y, w, h = cell(i, span)
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=bg)
    pad = 10
    if border:
        d.rectangle([x + pad, y + pad, x + w - pad - 1, y + h - pad - 1], outline=border, width=4)
    room = w - (170 if arrow_dir else 60)
    ff, sz = fit(d, text, names, size, room)
    tx = x + (w - (110 if arrow_dir in ('right', 'up', 'down') else 0)) / 2 + (55 if arrow_dir == 'left' else 0)
    ty = y + (h - sz) / 2 - (14 if sub else 6)
    centred(d, tx, ty, text, ff, fg)
    if sub:
        ff2, _ = fit(d, sub, names, int(sz * .42), room)
        centred(d, tx, y + h - 54, sub, ff2, fg)
    if arrow_dir in ('left', 'right'):
        arrow(d, x + (74 if arrow_dir == 'left' else w - 74), y + h / 2, 44, arrow_dir, fg)
    elif arrow_dir in ('up', 'down'):
        arrow(d, x + w - 70, y + h / 2, 44, arrow_dir, fg)


def route_map(d, i):
    x, y, w, h = cell(i, (2, 3))
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(244, 242, 232))
    d.rectangle([x + 8, y + 8, x + w - 9, y + h - 9], outline=NAVY, width=5)
    d.rectangle([x + 8, y + 8, x + w - 9, y + 70], fill=NAVY)
    centred(d, x + w / 2, y + 14, "METRO NETWORK", font(CLEAN, 44), WHITE)
    lines = [
        (RED, "LINE 1", [(70, 400), (240, 330), (400, 330), (540, 250), (700, 250), (860, 170)]),
        (BLUE, "LINE 2", [(120, 150), (260, 230), (400, 330), (400, 440), (540, 500)]),
        (GREEN, "LINE 3", [(300, 530), (400, 440), (540, 400), (700, 400), (900, 480)]),
    ]
    for col, name, pts in lines:
        pts = [(x + px, y + py) for px, py in pts]
        d.line(pts, fill=col, width=18, joint='curve')
        px, py = pts[0]
        d.rounded_rectangle([px - 56, py - 40, px + 56, py - 12], radius=6, fill=col)
        centred(d, px, py - 38, name, font(CLEAN, 22), WHITE)
    stops = [(70, 400, "Harbour"), (240, 330, "Old Mill"), (540, 250, "Museum"), (700, 250, "Zoo"), (860, 170, "Airport"),
             (120, 150, "Uni Park"), (260, 230, "Market"), (400, 440, "South Plaza"), (540, 500, "Stadium"),
             (300, 530, "Docks"), (540, 400, "Tower"), (700, 400, "Library"), (900, 480, "Lakeside")]
    for px, py, name in stops:
        blob(d, x + px, y + py, 9, WHITE, NAVY, 4)
        d.text((x + px + 12, y + py + 8), name, font=font(CLEAN, 21), fill=INK)
    cx, cy = x + 400, y + 330
    blob(d, cx, cy, 24, WHITE, NAVY, 6)
    blob(d, cx, cy, 11, AMBER)
    d.rounded_rectangle([cx - 108, cy + 34, cx + 108, cy + 78], radius=10, fill=AMBER, outline=NAVY, width=4)
    centred(d, cx, cy + 40, "CIVIC CENTRAL", font(CLEAN, 28), NAVY)
    centred(d, cx, cy + 62, "you are here", font(CLEAN, 18), NAVY)


def cellar_signs(d):
    cream, ink, rust = (236, 226, 196), (36, 40, 52), (140, 40, 32)
    plate(d, 24, (28, 60, 120), cream, "WEINKELLER", "WINE CELLAR  -  1742", names=SERIF, size=64, border=cream)
    plate(d, 25, cream, ink, "AUSGANG", "EXIT  -  TO THE MARKET", arrow_dir='left', names=SERIF, size=64, border=ink)
    plate(d, 26, cream, ink, "ZISTERNE", "CISTERN COURT EXIT", arrow_dir='right', names=SERIF, size=60, border=ink)
    plate(d, 27, rust, cream, "KEIN FEUER", "NO NAKED FLAMES", names=SERIF, size=64, border=cream)
    plate(d, 28, (96, 94, 88), (230, 226, 210), "ANNO 1742", "RESTORED 1908", names=SERIF, size=60, border=(200, 196, 180))
    plate(d, 29, cream, rust, "FASSLAGER", "CASK STORE", names=SERIF, size=64, border=rust)
    plate(d, 30, cream, ink, "MARKT", "MARKET STAIR", arrow_dir='up', names=SERIF, size=64, border=ink)
    plate(d, 31, (28, 60, 120), cream, "VORSICHT", "MIND THE STEP", names=SERIF, size=62, border=cream)


def make_signs() -> None:
    img = Image.new("RGB", (4 * CW, 8 * CH), (30, 30, 36))
    d = ImageDraw.Draw(img)
    # Station name banner: two cells wide.
    x, y, w, h = cell(0, (2, 1))
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=BLUE)
    d.rectangle([x, y + h - 26, x + w - 1, y + h - 1], fill=RED)
    blob(d, x + 96, y + 84, 54, WHITE)
    blob(d, x + 96, y + 84, 38, BLUE)
    d.rectangle([x + 40, y + 74, x + 152, y + 94], fill=WHITE)
    centred(d, x + 150 + (w - 150) / 2, y + 22, "CIVIC CENTRAL", font(CLEAN, 96), WHITE)
    plate(d, 2, NAVY, WHITE, "PLATFORM 1", "to the Harbour", arrow_dir='left', size=62, border=WHITE)
    plate(d, 3, NAVY, WHITE, "PLATFORM 2", "to the Airport", arrow_dir='right', size=62, border=WHITE)
    plate(d, 4, GREEN, WHITE, "WAY OUT", "EXIT", arrow_dir='up', size=76, border=WHITE)
    plate(d, 5, BLUE, WHITE, "TICKETS", "and information", size=76, border=WHITE)
    plate(d, 6, NAVY, WHITE, "WAITING ROOM", size=60, border=WHITE)
    plate(d, 7, (60, 60, 66), AMBER, "STAFF ONLY", "authorised persons", size=66, border=AMBER)
    plate(d, 8, RED, WHITE, "VENDING", "drinks & snacks", size=74, border=WHITE)
    plate(d, 9, NAVY, WHITE, "RESTROOMS", size=64, border=WHITE)
    route_map(d, 10)
    plate(d, 12, WHITE, RED, "NO SMOKING", "thank you for breathing", size=60, border=RED)
    plate(d, 13, AMBER, NAVY, "LOST & FOUND", "ask at the office", size=60, border=NAVY)
    plate(d, 16, GREEN, WHITE, "EXIT NORTH", "Civic Plaza", arrow_dir='up', size=64, border=WHITE)
    plate(d, 17, GREEN, WHITE, "EXIT SOUTH", "South Plaza", arrow_dir='up', size=64, border=WHITE)
    plate(d, 20, AMBER, INK, "CAUTION", "wet floor - slippery", size=72, border=INK)
    plate(d, 21, NAVY, WHITE, "MIND THE STEP", size=56, border=WHITE)
    plate(d, 22, BLUE, WHITE, "KEEP LEFT", "stand right on stairs", size=70, border=WHITE)
    plate(d, 23, (60, 60, 66), WHITE, "LAST TRAIN 00:30", "service resumes 05:00", size=48, border=WHITE)
    cellar_signs(d)
    grain = noise(max(img.size), 6, 93).crop((0, 0) + img.size).point(lambda v: int(236 + v * .08))
    img = ImageChops.multiply(img, Image.merge("RGB", [grain] * 3))
    CITY.mkdir(parents=True, exist_ok=True)
    img.save(CITY / "underground_signs.jpg", quality=90)


def main() -> None:
    make_posters()
    make_signs()
    print("wrote posters_fun.jpg and underground_signs.jpg")


if __name__ == "__main__":
    main()
