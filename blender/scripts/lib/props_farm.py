"""Farmstead props (2026-11): trees, hay, farm tools, rural furniture and shelter storage.

Every prop is a low-poly MeshData with its origin at the centre of its footprint on the floor and its
front toward -z, like the rest of the catalogue. Sizes and colliders live in catalog.PROPS.
"""
import math
import random
from meshkit import MeshData
from foliage import GOLDEN, LITE_SIZE, box_dirs, card, card_count, dot, ellipsoid, puff, unit


# --- foliage (leaf-card volumes, see foliage.py) ------------------------------------------------------------
# Trees, bushes and hedges are an opaque dark core (`leaf_core`: bullets stop on it, gaps show dark leaf mass) wrapped in
# alpha-cut leaf cards that grow in every direction, so they look leafy from the front, the back, the sides and above.
# Each prop carries a detailed set (`leaf_bush`) and a lite twin (`leaf_bush_lite`); FoliageLod draws one of them.
def _trunk(m, h, r0, r1, seg=9):
    m.cylinder((0, 0, 0), r0, h, 'bark', segments=seg, radius_top=r1, caps=(False, False))


OAK_TINT = ((0.92, 1.0, 0.8), (1.02, 1.0, 0.74))     # two oak greens, picked per canopy lobe
OAK_BLOBS = [(0, 5.0, 0, 1.9), (1.25, 4.3, .4, 1.4), (-1.2, 4.5, -.3, 1.45), (.3, 4.4, -1.3, 1.3),
             (-.2, 4.2, 1.25, 1.25), (.2, 6.1, .1, 1.2), (1.0, 5.6, -.8, 1.05), (-1.0, 5.7, .8, 1.0)]


def tree_oak(scale=1.0, seed=0):
    """Broad oak: a flared trunk, three limbs and a canopy of eight leaf lobes (about 4.4 m wide, 7 m tall)."""
    s = scale
    m = MeshData()
    _trunk(m, 3.1 * s, .34 * s, .2 * s)
    m.cylinder((0, -.02, 0), .46 * s, .22 * s, 'bark', segments=9, radius_top=.34 * s, caps=(False, False))
    for (x, y, z) in ((.9, 3.0, .2), (-.8, 3.3, -.5), (.1, 3.5, -.9)):
        m.tube((0, 2.5 * s, 0), (x * s, y * s + .7 * s, z * s), .09 * s, 'bark', segments=6)
    for (x, y, z, r) in OAK_BLOBS:
        ellipsoid(m, (x * s, y * s, z * s), (r * s * .6, r * s * .5, r * s * .6), 'leaf_core', rings=4, segments=8)

    def inside_other(i):
        """Cards pointing into another lobe are wasted: reject directions whose surface point lies inside a neighbour."""
        cx, cy, cz, r = OAK_BLOBS[i]

        def skip(v, nrm):
            px, py, pz = cx + nrm[0] * r * .95, cy + nrm[1] * r * .8, cz + nrm[2] * r * .95
            return any(j != i and (px - ox) ** 2 + (py - oy) ** 2 + (pz - oz) ** 2 < (orr * .82) ** 2 for j, (ox, oy, oz, orr) in enumerate(OAK_BLOBS))
        return skip

    def in_canopy(pt):
        """Inside any lobe enlarged by 28%: the canopy keeps the silhouette (and the footprint) the catalogue promises."""
        return pt[1] > 2.1 * s and any(((pt[0] - x * s) / (r * s * 1.28)) ** 2 + ((pt[1] - y * s) / (r * s * 1.1)) ** 2 + ((pt[2] - z * s) / (r * s * 1.28)) ** 2 <= 1
                                       for (x, y, z, r) in OAK_BLOBS)

    for lite in (False, True):
        rnd = random.Random(7100 + seed * 17 + (5 if lite else 0))
        for i, (x, y, z, r) in enumerate(OAK_BLOBS):
            R = r * s * .8
            puff(m, rnd, lite, (x * s, y * s, z * s), (R, R * .84, R), round(46 * r * r), (.5 + .22 * r) * s, (.8 + .3 * r) * s, kinds=(1, 3, 1, 0, 3, 2),
                 tint=OAK_TINT[(i + seed) % 2], ao=.52, gain=1.0, skip=inside_other(i), min_y=2.2 * s, fit=in_canopy)
    return m


def tree_pine():
    """Pine: a slim trunk and five tiers of drooping boughs (leaf cards spread around and over each tier), 3.6 m wide, 8 m tall."""
    m = MeshData()
    _trunk(m, 2.6, .24, .14, 8)
    tiers = ((2.25, 1.35, 1.55), (3.3, 1.2, 1.4), (4.35, 1.05, 1.3), (5.35, .85, 1.2), (6.3, .65, 1.1))
    for (y, r, h) in tiers:
        # the opaque core is a narrow cone well inside the boughs, so it never shows as a cylinder
        m.cylinder((0, y + .05, 0), r * .5, h * 1.3, 'leaf_core', segments=9, radius_top=.03, caps=(True, True))
    m.cylinder((0, 6.9, 0), .06, 1.1, 'leaf_core', segments=6, radius_top=.0, caps=(False, False))
    tint = (0.66, 0.92, 0.86)

    def in_cone(pt):
        """Inside the tree's cone (1.9 m radius at the lowest tier, tapering to the leader): 3.6 m wide, 8 m tall."""
        return 2.0 <= pt[1] <= 8.05 and math.hypot(pt[0], pt[2]) <= 1.95 * max(0.0, 1 - (pt[1] - 2.2) / 5.4) + .12

    for lite in (False, True):
        rnd = random.Random(7300 + (5 if lite else 0))
        for ti, (y, r, h) in enumerate(tiers):
            n = card_count(15 - ti * 2, lite)
            off = rnd.uniform(0, 6.28)
            for i in range(n):
                a = off + i * GOLDEN + rnd.uniform(-.2, .2)
                e = rnd.uniform(-.62, .1) if ti < 4 else rnd.uniform(-.4, .3)       # boughs droop, the highest tiers are stiffer
                d = (math.cos(a) * math.cos(e), math.sin(e), math.sin(a) * math.cos(e))
                rc = r * .22
                base = (math.cos(a) * rc, y + h * (.52 + rnd.uniform(-.12, .1)), math.sin(a) * rc)
                length = r * 1.45 * (LITE_SIZE if lite else 1.0) * rnd.uniform(.85, 1.12)
                roll = ((i * .6180339887) % 1.0) * math.pi + rnd.uniform(-.2, .2)
                card(m, 'leaf_bush_lite' if lite else 'leaf_bush', base, d, (d[0], .6, d[2]), roll, length, length * 1.0, (1, 3, 1, 0)[i % 4], rnd,
                     ao=.5, gain=.95, tint=(tint[0] * rnd.uniform(.94, 1.06), tint[1] * rnd.uniform(.95, 1.05), tint[2] * rnd.uniform(.94, 1.06)), fit=in_cone)
            # the tier's body: shingled cards over a squat ellipsoid fill the space between and above the boughs
            puff(m, rnd, lite, (0, y + h * .45, 0), (r * 1.15, h * .5, r * 1.15), round(30 * r * r), r * .55, r * .9, kinds=(1, 3, 1, 0), tint=tint, ao=.5,
                 gain=1.0, droop_limit=-.2, fit=in_cone, min_y=2.0)
        # the leader
        puff(m, rnd, lite, (0, 6.95, 0), (.12, .5, .12), 8, .45, .7, kinds=(0, 2, 1), tint=tint, ao=.55, droop_limit=-.1, fit=in_cone)
    return m


def bush():
    """A shrub about 1.4 x 1.2 m and 0.95 m tall: a dark core, a few woody stems and leaf cards growing out in every direction."""
    m = MeshData()
    for (x, z, r) in ((0, 0, .27), (.2, .1, .2), (-.22, -.08, .19)):
        ellipsoid(m, (x, r * 1.05 + .06, z), (r, r * .8, r), 'leaf_core', rings=3, segments=7)
    rnd0 = random.Random(404)
    for i in range(6):
        a = i * 1.047 + rnd0.uniform(-.2, .2)
        m.tube((0, 0, 0), (math.cos(a) * .2, .3 + rnd0.uniform(0, .1), math.sin(a) * .18), .014, 'bark', segments=4)
    for lite in (False, True):
        rnd = random.Random(404 + (9 if lite else 0))
        puff(m, rnd, lite, (0, .36, 0), (.6, .46, .52), 110, .3, .5, kinds=(1, 3, 0, 1, 2, 3), tint=(1.0, 1.0, 1.0), ao=.5, gain=1.0, min_y=.05,
             fit=lambda pt: pt[1] >= 0.0 and (pt[0] / .92) ** 2 + (pt[2] / .8) ** 2 + (max(0.0, pt[1] - .02) / 1.15) ** 2 <= 1.0)
    return m


# Hedgerows: a row of sections (about a metre long each) with their own height, thickness and density, so no two hedges, and
# no two parts of one hedge, are the same shape. Tops are uneven (small steps and swells), the ends are rounded or squared,
# some parts are thinner and a few have a small gap in the leaf cover (the opaque core stays, so nothing becomes see-through
# or walkable). `L x H x T` is the envelope: the colliders in catalog.py are these numbers.
def _walk(rnd, n, lo, hi, step, jump):
    v, out = rnd.uniform(lo + (hi - lo) * .5, hi), []
    for _ in range(n):
        v += rnd.uniform(-step, step)
        if rnd.random() < jump:
            v += rnd.choice((-1, 1)) * rnd.uniform(step, step * 1.6)
        v = min(hi, max(lo, v))
        out.append(v)
    return out


def hedge(L, H, T, seed):
    rnd = random.Random(seed)
    n = max(3, round(L / .95))
    seg = L / n
    heights = _walk(rnd, n, .8, 1.0, .06, .3)
    top = max(heights)
    heights = [H * v / top for v in heights]                 # the tallest section is exactly H
    low = rnd.choice([i for i, v in enumerate(heights) if v < H] or [0])
    heights[low] = H * rnd.uniform(.74, .84)                 # and at least one section is clearly lower: never a flat top
    thick = _walk(rnd, n, .8, 1.0, .06, .22)
    tmax = max(thick)
    thick = [T * v / tmax for v in thick]
    dens = [rnd.uniform(.62, 1.12) for _ in range(n)]
    gaps = [(0 < i < n - 1 and rnd.random() < .22) for i in range(n)]
    rounded = [rnd.random() < .6, rnd.random() < .6]         # each end rounded or squared
    m = MeshData()
    stems = max(3, round(L / .55))
    for i in range(stems):
        m.cylinder((-L / 2 + (i + .5) * L / stems, 0, rnd.uniform(-.1, .1) * T), .05, rnd.uniform(.3, .55), 'bark', segments=5, caps=(False, False))
    secs = []
    for i in range(n):
        x = -L / 2 + (i + .5) * seg
        h, t = heights[i], thick[i]
        endl, endr = i == 0, i == n - 1
        secs.append((x, h, t, endl, endr))
        # opaque lumpy core: a lower and an upper mass per section, about 60% of the thickness, a little below the leaf cover
        for fy, ry in ((.33, .3), (.64, .26)):
            ellipsoid(m, (x + rnd.uniform(-.06, .06), h * fy, rnd.uniform(-.04, .04) * T), (seg * .72, h * ry, t * .5 * .62), 'leaf_core', rings=3, segments=7)
    for lite in (False, True):
        rr = random.Random(seed * 31 + (7 if lite else 0))
        for i, (x, h, t, endl, endr) in enumerate(secs):
            faces = ['py', 'pz', 'nz']
            ex = 0.0
            if endl and rounded[0] or endl and not rounded[0]:
                faces.append('nx')
            if endr:
                faces.append('px')
            # card length: a bit more than a third of the thickness at the thinnest, never more than half a metre
            hmin, hmax = max(.38, min(.5, .3 + t * .15)), max(.55, min(.8, .45 + t * .2))
            half = (seg * .5 + (.12 if (endl or endr) else .0), h * .5, t * .5)
            area = 4 * half[0] * half[2] + 8 * half[0] * half[1] + (4 * half[2] * half[1] * ((1 if endl else 0) + (1 if endr else 0)))
            count = max(8, round(area * 20 * dens[i]))
            ndir = card_count(count, lite)
            dirs = box_dirs(ndir, half, rr, tuple(faces))
            g = None
            if gaps[i]:
                gv = unit((rr.uniform(-.4, .4), rr.uniform(.2, 1.0), rr.choice((-1, 1)) * rr.uniform(.4, 1.0)))
                g = lambda v, nrm, gv=gv, rg=rr: dot(v, gv) > .82 and rg.random() < .85
            R = (half[0] * .9, half[1] * .9, half[2] * .9)           # shingle cards root on the surface itself
            def fit(pt, h=h, t=t, x0=(-L / 2 - .2) if endl else x - seg / 2 - .1, x1=(L / 2 + .2) if endr else x + seg / 2 + .1):
                """The hedge envelope: this section's own length, height and thickness plus the leafy fuzz (up to 20 cm). Cards of a tall section never
                bridge over a lower neighbour, so the steps in the top stay visible."""
                return x0 <= pt[0] <= x1 and 0.0 <= pt[1] <= h + .2 and abs(pt[2]) <= t / 2 + .2
            puff(m, rr, lite, (x, h / 2, 0), R, count, hmin, hmax, kinds=(1, 3, 0, 1, 2, 3), tint=OAK_TINT[(i + seed) % 2],
                 ao=.5, gain=1.0, p=3.4, skip=g, min_y=.05, dirs=dirs, outward=.82, droop_limit=-.15, fit=fit)
    return m


HEDGE_VARIANTS = {
    # name: (length, height, thickness, seed) of the dense envelope in metres
    'hedge_long': (3.8, 2.9, .95, 101),
    'hedge_tall': (3.4, 3.7, 1.05, 202),
    'hedge_low': (3.9, 2.35, .9, 303),
    'hedge_wide': (4.2, 2.8, 1.5, 404),
    'hedge_thin': (3.2, 2.7, .7, 505),
    'hedge_short': (2.6, 2.6, .95, 606),
    'hedge_block': (4.2, 3.1, 1.9, 707),
    'hedge_run': (4.7, 2.6, 1.0, 808),
}


def hedge_long():
    return hedge(*HEDGE_VARIANTS['hedge_long'])


FOLIAGE_BUILDERS = {name: (lambda a=spec: hedge(*a)) for name, spec in HEDGE_VARIANTS.items()}


def hay_bale(rotated=False):
    """Rectangular hay bale (1.1 x 0.5 x 0.55 m) bound by two twine strands."""
    m = MeshData()
    m.box(-.55, 0, -.275, .55, .5, .275, 'hay')
    for x in (-.28, .28):
        m.box(x - .012, 0, -.28, x + .012, .5, .28, 'rope', skip=('ny',))
        m.box(x - .013, .5, -.285, x + .013, .504, .285, 'rope')
    return m


def hay_stack():
    """Three bales stacked as a pyramid (2.2 x 1.0 x 0.55 m)."""
    m = MeshData()
    for x in (-.56, .56):
        m.box(x - .55, 0, -.275, x + .55, .5, .275, 'hay')
    m.box(-.55, .5, -.275, .55, 1.0, .275, 'hay')
    for x in (-.84, -.28, .28, .84):
        m.box(x - .012, 0, -.28, x + .012, .5, .28, 'rope', skip=('ny',))
    for x in (-.28, .28):
        m.box(x - .012, .5, -.28, x + .012, 1.0, .28, 'rope')
    return m


def water_trough():
    """Galvanised stock trough on wooden legs (2.2 x 0.65 x 0.7 m) with a water surface."""
    m = MeshData()
    m.box(-1.1, .25, -.35, 1.1, .65, .35, 'galvanized', skip=('py',))
    m.box(-1.04, .6, -.29, 1.04, .62, .29, 'water')
    for x in (-.9, .9):
        m.box(x - .07, 0, -.3, x + .07, .27, .3, 'wood_weathered')
    m.box(-1.12, .62, -.37, 1.12, .66, .37, 'iron', skip=('py', 'ny'))
    return m


def wheelbarrow():
    m = MeshData()
    m.box(-.35, .28, -.28, .45, .5, .28, 'iron_rusty')
    m.face_toward([(.45, .5, -.28), (.45, .5, .28), (.45, .28, .28), (.45, .28, -.28)], 'iron_rusty', (1, 0, 0))
    m.box(-.3, .5, -.25, .4, .53, .25, 'soil')
    m.tube((.55, .5, 0), (.62, .2, 0), .02, 'iron', segments=4)
    m.tube((-.32, .4, -.18), (-.95, .72, -.28), .025, 'wood_dark', segments=6)
    m.tube((-.32, .4, .18), (-.95, .72, .28), .025, 'wood_dark', segments=6)
    m.tube((.6, .33, 0), (.6, .33, 0), .001, 'iron', segments=3)
    m.cylinder((.62, .2, -.04), .2, .08, 'rubber', segments=12, caps=(True, True))
    m.box(-.35, 0, -.22, -.3, .3, -.18, 'wood_dark')
    m.box(-.35, 0, .18, -.3, .3, .22, 'wood_dark')
    return m


def firewood_stack():
    """Stacked split logs between two posts (1.8 x 1.2 x 0.7 m)."""
    m = MeshData()
    for x in (-.88, .88):
        m.box(x - .05, 0, -.3, x + .05, 1.2, .3, 'wood_dark')
    for row in range(8):
        y = .05 + row * .14
        for k in range(9):
            off = .09 if row % 2 else 0
            x = -.78 + k * .19 + off
            if x > .8:
                continue
            m.cylinder((x, y, -.28), .075, .56, 'wood_crate', segments=6, caps=(False, False))
            m.cylinder((x, y, -.28), .075, .56, 'wood_crate', segments=6, caps=(False, False))
    return m


def sofa():
    """Three-seat fabric sofa (2.0 x 0.85 x 0.9 m), front toward -z."""
    m = MeshData()
    m.box(-1, .12, -.45, 1, .45, .45, 'cloth_blue')
    m.box(-1, .45, .22, 1, .85, .45, 'cloth_blue')
    for x0, x1 in ((-1, -.86), (.86, 1)):
        m.box(x0, .45, -.45, x1, .66, .45, 'cloth_blue')
    for x in (-.5, .5):
        m.box(x - .42, .45, -.42, x + .42, .56, .22, 'cloth_blue_light')
    for x in (-1, .86):
        m.box(x, 0, -.42, x + .14, .12, -.28, 'wood_dark')
        m.box(x, 0, .28, x + .14, .12, .42, 'wood_dark')
    return m


def bed():
    """Double bed (2.0 x 0.95 x 1.5 m): timber frame, mattress, pillows, quilt; headboard on +z."""
    m = MeshData()
    m.box(-1, .18, -.75, 1, .38, .75, 'wood_dark')
    m.box(-.96, .38, -.71, .96, .62, .71, 'cloth_tan')
    m.box(-.96, .62, -.71, .5, .66, .71, 'cloth_red')
    m.box(.55, .62, -.6, .9, .74, -.1, 'canvas_cream')
    m.box(.55, .62, .1, .9, .74, .6, 'canvas_cream')
    m.box(.96, .18, -.78, 1.04, .95, .78, 'wood_dark')
    for x in (-1, .96):
        for z in (-.75, .71):
            m.box(x, 0, z, x + .04, .18, z + .04, 'wood_dark')
    return m


def wardrobe():
    m = MeshData()
    m.box(-.6, 0, -.3, .6, 2.0, .3, 'wood_dark')
    m.box(-.57, .06, -.315, -.02, 1.94, -.3, 'wood_weathered')
    m.box(.02, .06, -.315, .57, 1.94, -.3, 'wood_weathered')
    for x in (-.08, .08):
        m.box(x - .01, .95, -.33, x + .01, 1.1, -.315, 'brass')
    m.box(-.63, 2.0, -.33, .63, 2.06, .33, 'wood_dark')
    return m


def bookshelf():
    m = MeshData()
    m.box(-.8, 0, -.18, -.76, 1.9, .18, 'wood_dark')
    m.box(.76, 0, -.18, .8, 1.9, .18, 'wood_dark')
    m.box(-.8, 1.86, -.18, .8, 1.9, .18, 'wood_dark')
    m.box(-.8, 0, .14, .8, 1.9, .18, 'wood_weathered')
    cols = ('plastic_blue', 'plastic_orange', 'plastic_green', 'cloth_red', 'cardboard')
    for r in range(5):
        y = .05 + r * .36
        m.box(-.8, y, -.18, .8, y + .03, .18, 'wood_dark')
        x = -.72
        k = 0
        while x < .68:
            w = .05 + .02 * ((k * 3 + r) % 3)
            hgt = .22 + .05 * ((k + r) % 3)
            m.box(x, y + .03, -.12, x + w, y + .03 + hgt, .12, cols[(k + r) % len(cols)])
            x += w + .004
            k += 1
    return m


def kitchen_counter():
    """Kitchen run (2.4 x 0.92 x 0.65 m): cabinets, worktop, sink and hob; front toward -z."""
    m = MeshData()
    m.box(-1.2, 0, -.3, 1.2, .1, .325, 'wood_dark')
    m.box(-1.2, .1, -.3, 1.2, .86, .325, 'wood_weathered')
    for x in (-.6, 0, .6):
        m.box(x - .28, .16, -.315, x + .28, .8, -.3, 'wood_dark')
        m.box(x - .05, .62, -.33, x + .05, .65, -.315, 'iron')
    m.box(-1.22, .86, -.34, 1.22, .92, .34, 'granite')
    m.box(-.9, .87, -.2, -.3, .875, .2, 'galvanized')
    m.tube((-.6, .92, .22), (-.6, 1.12, .22), .015, 'galvanized', segments=5)
    m.tube((-.6, 1.12, .22), (-.6, 1.12, .1), .015, 'galvanized', segments=5)
    for x in (.45, .85):
        for z in (-.08, .12):
            m.cylinder((x, .92, z), .09, .012, 'iron', segments=10)
    return m


def fridge():
    m = MeshData()
    m.box(-.4, 0, -.36, .4, 1.8, .36, 'plastic_white')
    m.box(-.4, 1.12, -.37, .4, 1.14, -.36, 'plastic_grey')
    m.box(.3, 1.2, -.395, .34, 1.7, -.36, 'aluminium')
    m.box(.3, .5, -.395, .34, 1.0, -.36, 'aluminium')
    return m


def dining_table():
    """Farmhouse table with six chairs (2.6 x 0.9 x 1.7 m); the collider covers the table only."""
    m = MeshData()
    m.box(-1.2, .72, -.5, 1.2, .78, .5, 'wood_weathered')
    for x in (-1.1, 1.1):
        for z in (-.4, .4):
            m.box(x - .05, 0, z - .05, x + .05, .72, z + .05, 'wood_dark')
    for x in (-.7, 0, .7):
        for z, f in ((-.78, 1), (.78, -1)):
            m.box(x - .2, .42, z - .2, x + .2, .46, z + .2, 'wood_dark')
            for dx in (-.18, .18):
                for dz in (-.18, .18):
                    m.box(x + dx - .02, 0, z + dz - .02, x + dx + .02, .42, z + dz + .02, 'wood_dark')
            zb = z + .2 * f
            m.box(x - .2, .46, zb - .02 if f > 0 else zb - .02, x + .2, .9, zb + .02, 'wood_dark')
    m.box(-.3, .78, -.12, .3, .8, .12, 'canvas_cream')
    return m


def feed_sacks():
    """Stack of burlap feed sacks (0.9 x 0.65 x 0.7 m)."""
    m = MeshData()
    for i, (x, y, z) in enumerate(((-.2, 0, 0), (.25, 0, .05), (0, .24, 0))):
        m.box(x - .22, y, z - .3, x + .22, y + .24, z + .3, 'burlap')
        m.sphere((x, y + .24, z - .28), .06, 'burlap', rings=3, segments=5)
    return m


def storage_shelf():
    """Heavy timber shelving for the shelter (2.0 x 1.9 x 0.5 m) loaded with jars, tins and boxes."""
    m = MeshData()
    for x in (-1, .96):
        m.box(x, 0, -.25, x + .04, 1.9, .25, 'wood_dark')
    m.box(-1, 0, .21, 1, 1.9, .25, 'wood_weathered')
    cols = ('plastic_orange', 'plastic_green', 'copper', 'cardboard', 'plastic_blue', 'paint_yellow')
    for r in range(5):
        y = .08 + r * .42
        m.box(-.98, y, -.25, .98, y + .035, .21, 'wood_weathered')
        x = -.92
        k = 0
        while x < .84:
            w = .14 + .05 * ((k + r) % 3)
            hgt = .18 + .06 * ((k * 2 + r) % 3)
            if (k + r) % 3:
                m.cylinder((x + w / 2, y + .035, -.02), w / 2, hgt, cols[(k + r) % len(cols)], segments=7)
            else:
                m.box(x, y + .035, -.2, x + w, y + .035 + hgt, .16, cols[(k + r) % len(cols)])
            x += w + .05
            k += 1
    return m


def bunk_bed():
    """Steel bunk bed (2.0 x 1.9 x 0.95 m) with thin mattresses."""
    m = MeshData()
    for x in (-1, .96):
        for z in (-.47, .43):
            m.box(x, 0, z, x + .04, 1.9, z + .04, 'steel_dark')
    for y in (.32, 1.15):
        m.box(-1, y, -.47, 1, y + .04, .47, 'steel_dark')
        m.box(-.96, y + .04, -.45, .96, y + .15, .45, 'cloth_green')
        m.box(.6, y + .15, -.3, .92, y + .22, .3, 'canvas_cream')
        for z in (-.47, .43):
            m.box(-1, y + .04, z, 1, y + .3, z + .04, 'steel_dark', skip=('px', 'nx', 'ny'))
    m.tube((-.98, 1.19, -.5), (-.98, 1.19, .5), .015, 'steel_dark', segments=4)
    m.box(.97, .32, .43, 1.0, 1.15, .47, 'steel_dark')
    return m


def tractor():
    """Small red farm tractor (2.0 x 2.4 x 3.6 m): engine hood, open cab with roll frame, big rear wheels."""
    m = MeshData()
    m.box(-.45, .6, -1.7, .45, 1.35, -.1, 'tractor_red')
    m.box(-.42, 1.35, -1.6, .42, 1.42, -.2, 'steel_dark')
    m.box(-.3, 1.42, -.85, -.22, 2.0, -.75, 'iron')
    m.box(-.45, .3, -1.75, .45, .62, 1.0, 'steel_dark')
    m.box(-.55, .85, -.05, .55, 1.0, 1.05, 'tractor_red')
    m.box(-.3, 1.0, .35, .3, 1.08, .85, 'iron_rusty')
    m.tube((.2, 1.05, .6), (.15, 1.55, .3), .02, 'iron', segments=5)
    m.cylinder((.15, 1.55, .3), .17, .04, 'rubber', segments=10)
    for sx in (-1, 1):
        for z, r, w in ((.7, .85, .5), (-1.15, .52, .3)):
            x = sx * (.9 if r > .6 else .8)
            # Wheels lie on their side: a tube along x, with a smaller hub tube proud of the tyre.
            m.tube((x - w / 2, r, z), (x + w / 2, r, z), r, 'rubber', segments=14)
            m.tube((x - w / 2 - .012, r, z), (x + w / 2 + .012, r, z), r * .52, 'tractor_hub', segments=12)
    m.tube((-.9, .85, .7), (.9, .85, .7), .06, 'iron', segments=6)
    m.tube((-.8, .52, -1.15), (.8, .52, -1.15), .05, 'iron', segments=6)
    # open roll frame over the seat
    for x in (-.55, .55):
        for z in (.2, .95):
            m.box(x - .03, 1.0, z - .03, x + .03, 2.35, z + .03, 'steel_dark')
    m.box(-.6, 2.35, .15, .6, 2.41, 1.0, 'steel_dark')
    m.box(-.35, .95, -.12, .35, 1.05, .12, 'tractor_red')
    m.tube((0, 1.42, -1.55), (0, 2.0, -1.55), .035, 'iron', segments=6)  # exhaust stack
    return m


FARM_BUILDERS = {
    **FOLIAGE_BUILDERS,
    'tree_oak': lambda: tree_oak(1.0, 0),
    'tree_oak_small': lambda: tree_oak(.74, 1),
    'tree_pine': tree_pine,
    'bush': bush,
    'hay_bale': hay_bale,
    'hay_stack': hay_stack,
    'water_trough': water_trough,
    'wheelbarrow': wheelbarrow,
    'firewood_stack': firewood_stack,
    'sofa': sofa,
    'bed': bed,
    'wardrobe': wardrobe,
    'bookshelf': bookshelf,
    'kitchen_counter': kitchen_counter,
    'fridge': fridge,
    'dining_table': dining_table,
    'feed_sacks': feed_sacks,
    'storage_shelf': storage_shelf,
    'bunk_bed': bunk_bed,
    'tractor': tractor,
}
