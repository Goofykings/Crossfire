"""Farmstead props (2026-11): trees, hay, farm tools and rural furniture.

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


def _ellipsoid_area(r):
    """Knud Thomsen's approximation of an ellipsoid's surface area."""
    p = 1.6075
    return 4 * math.pi * (((r[0] * r[1]) ** p + (r[0] * r[2]) ** p + (r[1] * r[2]) ** p) / 3) ** (1 / p)


def lumps(m, seed, parts, density=26.0, fit=None, hmin=.3, hmax=.5, tint=(1.0, 1.0, 1.0), kinds=(1, 3, 0, 1, 2, 3), core=.46, min_y=.05, inset=.15, ao=.58, low_boost=.85, ground=0.0):
    """Foliage as a union of rounded lumps, so the outline is organic from every side: `parts` is a list of (centre, radii) ellipsoids.
    Each lump gets an opaque dark core (bullets stop on it) and shingled leaf cards on every part of its surface that is not buried
    inside a neighbouring lump. Both the detailed and the lite set are written. Cards near the ground are skipped (min_y).

    2026-11-13 coverage fixes: `ground` stretches every lump whose underside is within that many metres of the ground down to the
    ground (the top stays put), so no core floats with a gap beneath it; `low_boost` adds that share of extra cards on the lower part
    of each lump (sides and underside, where a viewer at eye level or below sees the cards edge-on and through their cut-outs)."""
    from foliage import surface, sphere_dirs
    # the cards stand on the lump's surface and reach about `inset` beyond it, so the lumps are drawn that much inside the envelope
    parts = [(c, tuple(max(.12, v - inset) for v in r)) for c, r in parts]
    if ground:
        stretched = []
        for c, r in parts:
            bottom = c[1] - r[1]
            if 0.0 < bottom < ground:
                d = (bottom - .02) / 2
                c, r = (c[0], c[1] - d, c[2]), (r[0], r[1] + d, r[2])
            stretched.append((c, r))
        parts = stretched
    for c, r in parts:
        ellipsoid(m, c, (r[0] * core, r[1] * core, r[2] * core), 'leaf_core', rings=5, segments=10)

    def buried(pt, me):
        for j, (c, r) in enumerate(parts):
            if j != me and sum(((pt[k] - c[k]) / r[k]) ** 2 for k in range(3)) < .86:
                return True
        return False

    for lite in (False, True):
        rr = random.Random(seed * 17 + (5 if lite else 0))
        for i, (c, r) in enumerate(parts):
            n = max(10, round(_ellipsoid_area(r) * density))
            dirs = sphere_dirs(card_count(n, lite), rr, .4)

            def skip(v, nrm, c=c, r=r, i=i):
                q, _ = surface(v, r, 2.0)
                return buried((c[0] + q[0] * .96, c[1] + q[1] * .96, c[2] + q[2] * .96), i)
            puff(m, rr, lite, c, r, n, hmin, hmax, kinds=kinds, tint=tint, ao=ao, gain=1.0, p=2.0, skip=skip, min_y=min_y, dirs=dirs,
                 outward=.8, droop_limit=-.3, fit=fit, spray=.4)
            if low_boost:
                low = [v for v in sphere_dirs(card_count(max(10, int(n * low_boost * 2)), lite), rr, .4) if v[1] < .15]
                puff(m, rr, lite, c, r, n, hmin * .9, hmax * .9, kinds=kinds, tint=tint, ao=ao * 1.1, gain=1.0, p=2.0, skip=skip, min_y=min_y, dirs=low,
                     outward=.8, droop_limit=-.6, fit=fit, spray=.3)


def bush(seed=404):
    """A shrub about 1.7 x 1.1 m and 1.0 m tall: a mound of overlapping rounded lumps (wide low ones, a few smaller ones on top), a dark core
    in each and shingled leaf cards over the whole outline, leaves down to the ground; a few woody stems show at the foot."""
    m = MeshData()
    rnd = random.Random(seed)
    for i in range(5):
        a = i * 1.2566 + rnd.uniform(-.2, .2)
        m.tube((0, 0, 0), (math.cos(a) * .26, .26 + rnd.uniform(0, .1), math.sin(a) * .22), .016, 'bark', segments=4)
    parts = [((0.0, .38, 0.0), (.62, .38, .54)),
             ((-.42, .31, .1), (.42, .3, .4)), ((.4, .3, -.1), (.44, .31, .4)),
             ((.05, .31, .38), (.4, .28, .34)), ((-.08, .3, -.4), (.42, .29, .32)),
             ((-.12, .66, .02), (.4, .27, .36)), ((.3, .6, .12), (.3, .22, .3)), ((-.4, .56, -.1), (.26, .2, .27))]
    fit = lambda pt: pt[1] >= 0.0 and (pt[0] / 1.0) ** 2 + (pt[2] / .9) ** 2 + (max(0.0, pt[1] - .02) / 1.12) ** 2 <= 1.0
    lumps(m, seed, parts, density=40.0, hmin=.22, hmax=.34, fit=fit, min_y=.03, inset=.1, ground=.45)
    return m


# Hedgerows: a row of sections (about a metre long each) with their own height, thickness and density, so no two hedges, and
# no two parts of one hedge, are the same shape. Each section is two or three overlapping rounded lumps (see `lumps`), so the sides bulge,
# the top is a row of domes of different heights, and the ends are rounded: no flat faces and no boxes. `L x H x T` is the envelope:
# the colliders in catalog.py are these numbers (the lumps stay inside it, plus a few centimetres of leafy fuzz).
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
    m = MeshData()
    stems = max(3, round(L / .55))
    for i in range(stems):
        m.cylinder((-L / 2 + (i + .5) * L / stems, 0, rnd.uniform(-.1, .1) * T), .035, rnd.uniform(.18, .32), 'bark', segments=5, caps=(False, False))
    parts = []
    reach = .17                                            # leaf cards stand on a lump and reach about this far beyond it
    for i in range(n):
        x = -L / 2 + (i + .5) * seg
        h, t = heights[i], thick[i]
        endl, endr = i == 0, i == n - 1
        rz = max(.2, t * .5 - reach)
        # a broad low lump that touches the ground and a domed upper one whose top is the section's height (less the card reach)
        ry_low = max(.4, h * .38)
        rx = seg * .72 - .02
        cx = x + rnd.uniform(-.06, .06)
        if endl or endr:                                   # the end lumps stop where the envelope does (plus the card reach)
            rx = seg * .72 + .04
            cx = (-L / 2 + rx + .03) if endl else (L / 2 - rx - .03)
        parts.append(((cx, ry_low + .05, rnd.uniform(-.04, .04) * t), (rx, ry_low, rz)))
        ry_up = max(.3, h * .27)
        parts.append(((x + rnd.uniform(-.12, .12), h - reach - ry_up, rnd.uniform(-.05, .05) * t), (seg * .6, ry_up, max(.18, t * .42 - reach))))
        if rnd.random() < .55 and h > 1.8:                 # a smaller bulge on the shoulder, to one side
            side = rnd.choice((-1, 1))
            parts.append(((x + rnd.uniform(-.3, .3), h * rnd.uniform(.45, .62), side * max(.05, t * .5 - reach - .18)), (seg * .4, h * .17, max(.16, t * .26))))
    fit = lambda pt: -L / 2 - .16 <= pt[0] <= L / 2 + .16 and 0.0 <= pt[1] <= H + .16 and abs(pt[2]) <= T / 2 + .16
    lumps(m, seed, parts, density=30.0, fit=fit, hmin=max(.32, min(.44, .26 + T * .1)), hmax=max(.48, min(.7, .4 + T * .15)),
          tint=OAK_TINT[seed % 2], core=.54, min_y=.05, inset=0.0)
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


def hay_bale_round():
    """A large round bale lying on its side (1.5 m long, 1.12 m across; numbers in catalog.ROUND_BALE_*): a 28-sided barrel with a
    slight belly, shoulders that roll in toward each flat end, a flat contact patch on the ground and two loops of twine. The barrel
    has its own straw texture (UV u = turns of the circumference, v = metres along the axis) and each end shows the rolled spiral.
    Origin at the centre of the footprint, axis along x."""
    import catalog as C
    R, L, sag = C.ROUND_BALE_R, C.ROUND_BALE_L, C.ROUND_BALE_SAG
    cy = R - sag
    SEG = 28
    m = MeshData()
    # (x, radius factor): the belly is a little fuller than the shoulders; the end face is a disc at 0.88 R
    half = L / 2
    stations = [(-half, .88), (-half + .03, .965), (-half + .08, .99), (-half + .2, 1.0), (0.0, 1.012),
                (half - .2, 1.0), (half - .08, .99), (half - .03, .965), (half, .88)]
    turns = round(2 * math.pi * R)                    # whole texture repeats round the barrel: no seam

    def ring(k, grow=0.0):
        pts = []
        for j in range(SEG):
            a = 2 * math.pi * j / SEG
            pts.append((math.cos(a) * (R * k + grow), max(cy + math.sin(a) * (R * k + grow), 0.0)))
        return pts                                    # (z, y)

    def col_at(y, shade):
        t = max(0.0, min(1.0, y / (2 * R)))
        v = shade * (.62 + .38 * math.sqrt(t))        # darker toward the ground where the bales shade each other
        return (v, v * .97, v * .9, 1.0)

    rings = [ring(k) for _, k in stations]
    for i in range(len(stations) - 1):
        x0, x1 = stations[i][0], stations[i + 1][0]
        for j in range(SEG):
            j1 = (j + 1) % SEG
            q = [(x0,) + (rings[i][j][1], rings[i][j][0]), (x1,) + (rings[i + 1][j][1], rings[i + 1][j][0]),
                 (x1,) + (rings[i + 1][j1][1], rings[i + 1][j1][0]), (x0,) + (rings[i][j1][1], rings[i][j1][0])]
            q = [(x, y, z) for (x, y, z) in q]
            uv = [(j / SEG * turns, x0 + half), (j / SEG * turns, x1 + half), ((j + 1) / SEG * turns, x1 + half), ((j + 1) / SEG * turns, x0 + half)]
            my = sum(p[1] for p in q) / 4 - cy
            mz = sum(p[2] for p in q) / 4
            ym = sum(p[1] for p in q) / 4
            m.face_toward(q, 'hay_roll', (0, my, mz), uv=uv, col=[col_at(p[1], .96 + .05 * math.sin(j * 1.7 + i)) for p in q])
    for idx, sgn in ((0, -1), (len(stations) - 1, 1)):
        x = stations[idx][0]
        pts = [(x, y, z) for (z, y) in rings[idx]]
        uv = [(.5 + z / (2 * R), .5 + (y - cy) / (2 * R)) for (z, y) in rings[idx]]
        m.face_toward(pts, 'hay_end', (sgn, 0, 0), uv=uv, col=[col_at(y, .92) for (z, y) in rings[idx]])
    # twine: a 3 cm ribbon round the belly, 1 cm proud of the straw
    for x in (-.4, .4):
        outer = ring(1.0, .0)                         # radius at |x| = 0.4 is 1.003 R at most: sit 1.1 cm above that
        rb = ring(1.003, .011)
        for j in range(SEG):
            j1 = (j + 1) % SEG
            quad = []
            for (z, y), side in ((rb[j], -1), (rb[j], 1), (rb[j1], 1), (rb[j1], -1)):
                quad.append((x + side * .015, max(y, .006), z))
            my = (rb[j][1] + rb[j1][1]) / 2 - cy
            mz = (rb[j][0] + rb[j1][0]) / 2
            m.face_toward(quad, 'rope', (0, my, mz), col=(.62, .56, .46, 1.0))
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
    'hay_bale_round': hay_bale_round,
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
