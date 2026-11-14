"""Neon Backstreets props (2026-11): convenience-store shelf, drink fridge, washers, dryers, scooter, bicycle and a
ramen food cart. Original low-poly MeshData models; origin at the floor centre, front toward local -z.
Sizes and colliders are in catalog.py."""
from __future__ import annotations

import math

from meshkit import MeshData

GOODS = ('plastic_orange', 'plastic_green', 'plastic_blue', 'plastic_white', 'paint_white', 'carpaint_red', 'cardboard')


def store_shelf():
    """Double-sided gondola shelf (2.0 x 1.45 x 0.62 m) stocked on both faces; low enough to see over standing."""
    m = MeshData()
    W, D, H = 1.0, .31, 1.45
    m.box(-W, 0, -D, W, .1, D, 'plastic_black')
    m.box(-.03, .1, -.04, .03, H, .04, 'steel_white')
    m.box(-W, .1, -.02, W, H - .05, .02, 'steel_white')
    for x in (-W, W - .04):
        m.box(x, .1, -D, x + .04, H, D, 'steel_white')
    m.box(-W, H - .05, -D, W, H, D, 'steel_white')
    k = 0
    for y in (.1, .45, .8, 1.12):
        for sgn in (-1, 1):
            z0, z1 = (-D, -.03) if sgn < 0 else (.03, D)
            m.box(-W + .04, y, z0, W - .04, y + .025, z1, 'steel_white')
            if y > 1.1:
                continue
            x = -W + .08
            while x < W - .16:
                w = .1 + ((k * 37) % 7) * .02
                h = .14 + ((k * 53) % 5) * .035
                zz0, zz1 = (z0 + .02, z1 - .03) if sgn < 0 else (z0 + .03, z1 - .02)
                m.box(x, y + .025, zz0, min(x + w, W - .08), y + .025 + h, zz1, GOODS[k % len(GOODS)])
                x += w + .025
                k += 1
    # price rails
    for y in (.1, .45, .8):
        m.box(-W + .04, y - .04, -D - .01, W - .04, y + .025, -D + .01, 'plastic_white')
        m.box(-W + .04, y - .04, D - .01, W - .04, y + .025, D + .01, 'plastic_white')
    return m


def drink_fridge():
    """Three-door glass drinks fridge (1.6 x 2.05 x 0.76 m) with a lit interior and a header sign."""
    m = MeshData()
    W, D, H = .8, .38, 2.05
    m.box(-W, 0, -D, W, H, D, 'steel_white', skip=('nz',))
    m.box(-W + .04, .12, -D + .02, W - .04, 1.8, D - .04, 'lamp_led', skip=('nz',))
    for i in range(3):
        x0 = -W + .04 + i * (2 * W - .08) / 3
        x1 = x0 + (2 * W - .08) / 3
        for y in (.32, .68, 1.04, 1.4):
            m.box(x0 + .03, y, -D + .06, x1 - .03, y + .02, D - .06, 'aluminium')
            n = 5
            for k in range(n):
                cx = x0 + .05 + (x1 - x0 - .1) * (k + .5) / n
                m.cylinder((cx, y + .02, -D + .16), .032, .22, GOODS[(i * 3 + k + int(y * 10)) % 6], segments=6)
        m.box(x1 - .015, .12, -D - .01, x1 + .015, 1.8, -D + .02, 'steel_dark')
        m.box(x0 + .02, .12, -D - .005, x1 - .02, 1.8, -D + .005, 'glass_store')
    m.box(-W, 0, -D - .01, W, .12, -D, 'steel_dark')
    m.box(-W, 1.8, -D - .02, W, H, -D, 'lamp_led')
    return m


def washer_row():
    """Three front-loading coin washers on a plinth (2.4 x 1.0 x 0.72 m)."""
    m = MeshData()
    m.box(-1.2, 0, -.36, 1.2, .12, .36, 'concrete_trim')
    for i in range(3):
        x = -.8 + i * .8
        m.box(x - .38, .12, -.34, x + .38, .98, .36, 'plastic_white')
        m.box(x - .38, .9, -.35, x + .38, .98, -.3, 'steel_grey')
        # porthole: ring and glass facing -z
        seg = 14
        for s in range(seg):
            a, b = 2 * math.pi * s / seg, 2 * math.pi * (s + 1) / seg
            r0, r1 = .2, .25
            pts = [(x + math.cos(a) * r1, .52 + math.sin(a) * r1, -.35), (x + math.cos(b) * r1, .52 + math.sin(b) * r1, -.35),
                   (x + math.cos(b) * r0, .52 + math.sin(b) * r0, -.35), (x + math.cos(a) * r0, .52 + math.sin(a) * r0, -.35)]
            m.face_toward(pts, 'aluminium', (0, 0, -1))
        m.face_toward([(x + math.cos(2 * math.pi * s / seg) * .2, .52 + math.sin(2 * math.pi * s / seg) * .2, -.345) for s in range(seg)],
                      'glass_store', (0, 0, -1))
        m.box(x + .14, .92, -.355, x + .3, .96, -.34, 'lamp_led')
    return m


def dryer_stack():
    """Two rows of three tumble dryers (2.4 x 1.9 x 0.72 m)."""
    m = MeshData()
    m.box(-1.2, 0, -.36, 1.2, 1.9, .36, 'steel_grey', skip=('nz',))
    m.box(-1.2, 0, -.37, 1.2, .1, -.36, 'steel_dark')
    for row in range(2):
        y = .55 + row * .85
        for i in range(3):
            x = -.8 + i * .8
            m.box(x - .37, y - .42, -.37, x + .37, y + .4, -.36, 'steel_white')
            seg = 12
            m.face_toward([(x + math.cos(2 * math.pi * s / seg) * .24, y + math.sin(2 * math.pi * s / seg) * .24, -.375) for s in range(seg)],
                          'glass_store', (0, 0, -1))
            m.box(x - .3, y + .3, -.375, x + .3, y + .36, -.37, 'plastic_black')
    return m


def _wheel(m, cx, cy, cz, r, w, mat='rubber', seg=12, axis='x'):
    """A wheel as a short cylinder whose axis runs along local x."""
    for s in range(seg):
        a, b = 2 * math.pi * s / seg, 2 * math.pi * (s + 1) / seg
        pa = (cy + math.sin(a) * r, cz + math.cos(a) * r)
        pb = (cy + math.sin(b) * r, cz + math.cos(b) * r)
        quad = [(cx - w / 2, pa[0], pa[1]), (cx + w / 2, pa[0], pa[1]), (cx + w / 2, pb[0], pb[1]), (cx - w / 2, pb[0], pb[1])]
        mid = (a + b) / 2
        m.face_toward(quad, mat, (0, math.sin(mid), math.cos(mid)))
    for sgn in (-1, 1):
        m.face_toward([(cx + sgn * w / 2, cy + math.sin(2 * math.pi * s / seg) * r * .96, cz + math.cos(2 * math.pi * s / seg) * r * .96)
                       for s in range(seg)], 'steel_grey', (sgn, 0, 0))


def scooter():
    """Step-through city scooter on its side stand (0.66 x 1.18 x 1.76 m), length along local z."""
    m = MeshData()
    _wheel(m, 0, .22, -.62, .22, .1)
    _wheel(m, 0, .22, .6, .22, .12)
    m.box(-.2, .3, -.1, .2, .62, .72, 'carpaint_red')
    m.box(-.18, .62, .05, .18, .76, .7, 'plastic_black')                    # seat
    m.box(-.12, .2, -.45, .12, .32, .1, 'plastic_black')                      # floorboard
    m.box(-.16, .3, -.62, .16, 1.02, -.44, 'carpaint_red')                    # leg shield
    m.tube((0, .4, -.62), (0, 1.06, -.58), .03, 'steel_dark', segments=6)
    m.box(-.33, 1.02, -.62, .33, 1.06, -.56, 'steel_dark')                    # handlebar
    m.box(-.09, .92, -.66, .09, 1.02, -.62, 'headlight')
    m.box(-.1, .52, .72, .1, .58, .76, 'taillight')
    m.box(-.24, .3, .45, .24, .38, .8, 'carpaint_red')
    return m


def bicycle():
    """City bicycle on its kickstand (0.56 x 1.02 x 1.72 m), length along local z."""
    m = MeshData()
    for z in (-.58, .58):
        seg = 16
        for s in range(seg):
            a, b = 2 * math.pi * s / seg, 2 * math.pi * (s + 1) / seg
            m.tube((0, .34 + math.sin(a) * .32, z + math.cos(a) * .32), (0, .34 + math.sin(b) * .32, z + math.cos(b) * .32), .02, 'rubber', segments=4, caps=False)
        m.tube((0, .34, z - .3), (0, .34, z + .3), .005, 'aluminium', segments=3, caps=False)
    pts = {'bb': (0, .32, 0.0), 'seat': (0, .86, .18), 'head': (0, .9, -.42), 'rear': (0, .34, .58), 'front': (0, .34, -.58)}
    for a, b in (('bb', 'seat'), ('bb', 'head'), ('seat', 'head'), ('bb', 'rear'), ('seat', 'rear'), ('head', 'front')):
        m.tube(pts[a], pts[b], .022, 'steel_blue', segments=6)
    m.box(-.08, .88, .1, .08, .93, .3, 'plastic_black')
    m.tube((-.26, .98, -.46), (.26, .98, -.46), .015, 'steel_dark', segments=5)
    m.tube((0, .9, -.42), (0, .98, -.46), .02, 'steel_dark', segments=5)
    m.box(-.14, .62, -.72, .14, .74, -.56, 'steel_dark')                       # basket
    return m


def food_cart():
    """Ramen yatai cart (1.9 x 2.45 x 1.05 m): wooden counter body on wheels, a cloth-covered roof on posts and two
    red paper lanterns hanging from the eave (lit; the cart's collider is only its body)."""
    m = MeshData()
    W, D = .95, .5
    m.box(-W, .25, -D, W, 1.0, D, 'wood_dark')
    m.box(-W - .05, 1.0, -D - .05, W + .05, 1.05, D + .05, 'wood_weathered')
    _wheel(m, -W + .1, .25, 0, .25, .06, 'wood_weathered')
    _wheel(m, W - .1, .25, 0, .25, .06, 'wood_weathered')
    for x in (-W + .04, W - .08):
        for z in (-D + .02, D - .06):
            m.box(x, 1.05, z, x + .04, 2.2, z + .04, 'wood_dark')
    m.box(-W - .1, 2.2, -D - .15, W + .1, 2.32, D + .1, 'wood_dark')
    m.face_toward([(-W - .15, 2.32, -D - .2), (W + .15, 2.32, -D - .2), (W + .15, 2.45, 0), (-W - .15, 2.45, 0)], 'canvas_red', (0, 1, -.6))
    m.face_toward([(-W - .15, 2.45, 0), (W + .15, 2.45, 0), (W + .15, 2.32, D + .15), (-W - .15, 2.32, D + .15)], 'canvas_red', (0, 1, .6))
    # noren strip along the front eave and two lanterns
    for i in range(4):
        x0 = -W + i * (2 * W) / 4 + .02
        m.box(x0, 1.86, -D - .19, x0 + (2 * W) / 4 - .04, 2.2, -D - .17, 'canvas_indigo')
    for x in (-W + .05, W - .05):
        m.tube((x, 2.2, -D - .15), (x, 2.08, -D - .15), .006, 'steel_dark', segments=3)
        m.sphere((x, 1.92, -D - .15), .14, 'neon_tube', rings=5, segments=8, col=(1.0, .22, .16, 1.0))
    # bowls and a pot on the counter
    m.cylinder((.45, 1.05, 0), .2, .28, 'steel_grey', segments=10)
    for x in (-.6, -.3, 0.0):
        m.cylinder((x, 1.05, -.2), .08, .06, 'ceramic', segments=8)
    return m


def vend_neon(body, accent):
    """Drinks and snacks machine (1.0 x 1.95 x 0.85 m, front toward -z) for the night map: a densely stocked, colourful lit
    window (the back panel is a dim emissive, so the products read instead of one white block), selector panel, coin slot,
    tray and a lit header. Origin at the floor centre."""
    m = MeshData()
    W, D, H = .5, .425, 1.95
    m.box(-W, .06, -D, W, H, D, body)
    m.box(-W + .03, 0, -D + .05, W - .03, .07, D - .05, 'steel_dark')
    f = -D - .012
    m.box(-.43, .62, f, .14, 1.78, -D, 'plastic_black')
    m.box(-.40, .66, f - .004, .11, 1.74, -D - .004, 'lamp_vend')
    cols = ((.95, .14, .1, 1), (1, .5, .08, 1), (.14, .42, 1, 1), (.14, .85, .35, 1), (.95, .9, .78, 1), (1, .8, .12, 1), (.95, .14, .1, 1), (.14, .42, 1, 1))
    for row, y in enumerate((.70, 1.02, 1.34)):
        m.box(-.40, y, f - .006, .11, y + .02, -D - .006, 'aluminium')
        for k in range(8):
            c = cols[(k * 3 + row * 2) % len(cols)]
            m.box(-.385 + k * .062, y + .02, f - .034, -.335 + k * .062, y + .27, -D - .01, 'can_lit', col=c)
    m.box(.2, .62, f, .44, 1.78, -D, accent)
    for r in range(4):
        for c in range(3):
            m.box(.235 + c * .07, 1.5 - r * .1, f - .012, .275 + c * .07, 1.54 - r * .1, -D - .004, 'aluminium')
    m.box(.23, .95, f - .01, .41, 1.05, -D - .004, 'lamp_vend')
    m.box(.3, .7, f - .012, .34, .78, -D - .004, 'steel_dark')
    m.box(-.38, .18, f, .1, .5, -D, 'plastic_black')
    m.box(-.34, .22, f - .01, .06, .46, -D - .004, 'steel_dark')
    m.box(-W + .02, 1.8, f - .01, W - .02, 1.93, -D, 'lamp_vend')
    m.box(-W, .52, f - .002, W, .58, -D, accent)
    return m


def phone_booth():
    """Street phone booth (1.0 x 2.45 x 1.0 m, door toward -z): red steel frame, glass panes, a lit ad panel and a
    lit ceiling. The solid collision box is the booth's footprint; the lit interior is what reads from far away."""
    m = MeshData()
    W = .5
    m.box(-W, 0, -W, W, .12, W, 'steel_dark')
    for x in (-W, W - .07):
        for z in (-W, W - .07):
            m.box(x, .12, z, x + .07, 2.3, z + .07, 'steel_red')
    m.box(-W, 2.3, -W, W, 2.45, W, 'steel_red')
    m.box(-W + .07, 2.28, -W + .07, W - .07, 2.3, W - .07, 'lamp_led')
    # glass on three sides (door side open), rails
    for y0, y1 in ((.12, 2.28),):
        m.box(-W + .035, y0, -W + .03, -W + .045, y1, W - .03, 'glass_window')
        m.box(W - .045, y0, -W + .03, W - .035, y1, W - .03, 'glass_window')
    m.box(-W + .07, .12, W - .06, W - .07, 2.28, W - .05, 'lamp_led')
    m.box(-W + .07, 1.0, W - .09, W - .07, 1.12, W - .06, 'steel_dark')
    m.box(-.12, 1.12, W - .16, .12, 1.4, W - .09, 'plastic_black')
    m.box(-W - .02, 1.2, -W, -W, 1.3, W, 'steel_red')
    m.box(W, 1.2, -W, W + .02, 1.3, W, 'steel_red')
    return m


def gacha_bank():
    """Four capsule-toy machines side by side (1.7 x 1.45 x 0.5 m), front toward -z: coloured bodies, glass globes full
    of capsules, coin slots."""
    m = MeshData()
    bodies = ('steel_red', 'steel_blue', 'steel_yellow', 'steel_green')
    caps = ('plastic_orange', 'plastic_white', 'plastic_blue', 'plastic_green', 'carpaint_red')
    k = 0
    for i, body in enumerate(bodies):
        x = -.64 + i * .43
        m.box(x - .2, 0, -.22, x + .2, .62, .22, body)
        m.box(x - .15, .14, -.23, x + .15, .3, -.22, 'plastic_black')
        m.box(x - .05, .4, -.235, x + .05, .52, -.22, 'aluminium')
        m.box(x - .12, .62, -.14, x + .12, .7, .14, 'steel_dark')
        m.sphere((x, .93, 0), .21, 'glass_window', rings=6, segments=10)
        for _ in range(9):
            a = k * 2.399
            r = .1 * ((k * 37) % 7) / 7 + .02
            m.sphere((x + math.cos(a) * r, .8 + ((k * 53) % 9) * .027, math.sin(a) * r * .8), .045, caps[k % len(caps)], rings=3, segments=5)
            k += 1
        m.box(x - .05, 1.14, -.05, x + .05, 1.2, .05, 'steel_dark')
        m.box(x - .2, 1.2, -.22, x + .2, 1.45, .22, 'lamp_led', skip=('ny',))
    m.box(-.86, .6, .22, .86, .62, .24, 'steel_dark')
    return m


def sandwich_board():
    """A-frame menu board (0.55 x 0.9 x 0.5 m) with the chalkboard 'specials' art on both faces."""
    import neon_art as art
    m = MeshData()
    u0, v0, u1, v1 = art.panel_uv('specials')
    uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for sgn in (-1, 1):
        zb, zt = .24 * sgn, .03 * sgn
        n = (0, .3, sgn * .95)
        m.face_toward([(-.27, 0, zb), (.27, 0, zb), (.25, .86, zt), (-.25, .86, zt)], 'wood_dark', n)
        zb2, zt2 = zb - sgn * .004, zt - sgn * .004
        # the chalkboard sits a hair proud of the frame; texture u runs toward the viewer's right
        pts = [(-.22, .06, zb2 - sgn * .0), (.22, .06, zb2), (.205, .8, zt2), (-.205, .8, zt2)]
        if sgn < 0:
            m.face_toward(pts, 'neon_panels', n, uv=uv)
        else:
            m.face_toward(pts[::-1][::-1], 'neon_panels', n, uv=[(u1, v0), (u0, v0), (u0, v1), (u1, v1)])
    m.box(-.02, .84, -.04, .02, .88, .04, 'steel_dark')
    # end caps close the A so it never reads as hollow from the side
    for sx, nrm in ((-1, (-1, 0, 0)), (1, (1, 0, 0))):
        m.face_toward([(sx * .27, 0, -.24), (sx * .27, 0, .24), (sx * .25, .86, .03), (sx * .25, .86, -.03)], 'wood_dark', nrm)
    return m


def bamboo_pot():
    """A tall potted bamboo (0.5 x 1.7 x 0.5 m): dark pot, cane stalks and leaf clumps."""
    m = MeshData()
    m.cylinder((0, 0, 0), .24, .5, 'plastic_black', segments=10, radius_top=.27)
    m.cylinder((0, .5, 0), .23, .02, 'soil', segments=10)
    for i in range(7):
        a = i * 2.4
        r = .08 + .05 * (i % 3)
        bx, bz = math.cos(a) * r, math.sin(a) * r
        h = 1.25 + .08 * ((i * 5) % 5)
        tx, tz = bx + math.cos(a) * .12, bz + math.sin(a) * .12
        m.tube((bx, .5, bz), (tx, .5 + h, tz), .014, 'plastic_green', segments=4)
        for j in range(3):
            t = .55 + j * .2
            m.sphere((bx + (tx - bx) * t + math.cos(a) * .13, .5 + h * t, bz + (tz - bz) * t + math.sin(a) * .13), .14, 'plastic_green',
                     rings=3, segments=6, squash=.35)
    return m


NEON_BUILDERS = {'store_shelf': store_shelf, 'drink_fridge': drink_fridge, 'washer_row': washer_row, 'dryer_stack': dryer_stack,
                 'scooter': scooter, 'bicycle': bicycle, 'food_cart': food_cart,
                 'vend_red': lambda: vend_neon('steel_red', 'steel_blue'), 'vend_blue': lambda: vend_neon('steel_blue', 'steel_red'),
                 'vend_yellow': lambda: vend_neon('steel_yellow', 'steel_blue'), 'vend_white': lambda: vend_neon('steel_white', 'steel_red'),
                 'phone_booth': phone_booth,
                 'gacha_bank': gacha_bank, 'sandwich_board': sandwich_board, 'bamboo_pot': bamboo_pot}
