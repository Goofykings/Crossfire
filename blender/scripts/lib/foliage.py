"""Leaf-card foliage for the Farmstead (2026-11): bushes, hedgerows, tree canopies and wall ivy.

Pure Python on MeshData (no bpy). Foliage is *volumes* of alpha-cut leaf cards, never a single sheet or a stack of
cylinders: every card grows out of the inside of a puff (an ellipsoid or box-like superellipsoid) in a direction
spread over the whole sphere, with its plane rolled by a stratified angle, so from any viewing direction a good share
of the cards face the camera and the silhouette stays leafy at the top, the sides and the corners. A small opaque
`leaf_core` mass sits inside each puff: it blocks bullets and shows through gaps as dark leaf mass, never as a tube.

Materials are alpha-cut and double sided (materials.py): `leaf_bush` (bush_leaves.png atlas) and `leaf_ivy` (ivy_leaves.png).
Each prop is built twice, a detailed set and a lite twin (`*_lite`: 40% of the cards, 50% larger). The static
batcher keeps the two in separate batches and src/maps/FoliageLod.ts draws one of them (Chromebook mode and distance).
Atlas cells are 2 x 2 (row 0 = top); every cell stands on its bottom centre.
"""
from __future__ import annotations

import math
import random

from meshkit import MeshData

GOLDEN = 2.399963229728653
LITE_SHARE = 0.4        # lite sets carry 40% of the cards ...  (a third left the cores showing in Chromebook mode)
LITE_SIZE = 1.5         # ... each 50% larger, so the coverage stays close to the detailed set


def unit(v):
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def rotate(v, axis, ang):
    """Rodrigues rotation of v about the unit axis."""
    c, s = math.cos(ang), math.sin(ang)
    k = cross(axis, v)
    d = dot(axis, v) * (1 - c)
    return (v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d)


def card(m: MeshData, mat: str, base, d, hint, roll: float, h: float, w: float, kind: int, rnd: random.Random,
         ao: float = .5, gain: float = 1.0, tint=(1.0, 1.0, 1.0), fit=None) -> bool:
    """One leaf card standing on `base`, growing along the unit vector `d`, its plane facing about `hint` rotated by `roll`.
    The base is shaded dark (the inside of the volume) and the tip light, so the foliage reads as a volume without lights."""
    n0 = unit((hint[0] - d[0] * dot(hint, d), hint[1] - d[1] * dot(hint, d), hint[2] - d[2] * dot(hint, d)))
    if abs(dot(hint, d)) > .97:
        n0 = unit(cross(d, (1, 0, 0)))
    n = rotate(n0, d, roll)
    t = unit(cross(d, n))
    col, row = kind % 2, kind // 2
    u0, u1 = col / 2 + .004, (col + 1) / 2 - .004
    v0, v1 = 1 - (row + 1) / 2 + .004, 1 - row / 2 - .004
    if fit is not None:
        # Keep every corner inside the prop envelope (what the collider and the catalogue promise): shrink the card, else drop it.
        for _ in range(8):
            corners = [(base[0] + sx * t[0] * w / 2 + d[0] * hh, base[1] + sx * t[1] * w / 2 + d[1] * hh, base[2] + sx * t[2] * w / 2 + d[2] * hh)
                       for sx in (-1, 1) for hh in (0.0, h)]
            if all(fit(c) for c in corners):
                break
            h, w = h * .86, w * .86
        else:
            return False
    top = max(0.0, n[1]) * .25 + max(0.0, d[1]) * .15
    lo = ao * rnd.uniform(.9, 1.12)
    hi = min(1.18, (.9 + top) * gain * rnd.uniform(.9, 1.1))
    pts = [(base[0] - t[0] * w / 2, base[1] - t[1] * w / 2, base[2] - t[2] * w / 2),
           (base[0] + t[0] * w / 2, base[1] + t[1] * w / 2, base[2] + t[2] * w / 2),
           (base[0] + t[0] * w / 2 + d[0] * h, base[1] + t[1] * w / 2 + d[1] * h, base[2] + t[2] * w / 2 + d[2] * h),
           (base[0] - t[0] * w / 2 + d[0] * h, base[1] - t[1] * w / 2 + d[1] * h, base[2] - t[2] * w / 2 + d[2] * h)]
    tr, tg, tb = tint
    cols = [(lo * tr, lo * tg, lo * tb * .96, 1.0)] * 2 + [(hi * tr, hi * tg, hi * tb * .93, 1.0)] * 2
    m.face(pts, mat, uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)], col=cols)
    return True


def sphere_dirs(n: int, rnd: random.Random, jitter: float = .35):
    """n directions spread over the whole sphere (golden spiral, jittered): coverage without clumps or poles."""
    out = []
    off = rnd.uniform(0, 6.283)
    for i in range(n):
        y = 1 - 2 * (i + .5) / n
        r = math.sqrt(max(0.0, 1 - y * y))
        a = i * GOLDEN + off + rnd.uniform(-jitter, jitter)
        out.append(unit((math.cos(a) * r + rnd.uniform(-.08, .08), y + rnd.uniform(-.08, .08), math.sin(a) * r + rnd.uniform(-.08, .08))))
    return out


def card_count(count: int, lite: bool) -> int:
    """Cards in the detailed set (`count`) or in its lite twin."""
    return max(3, round(count * LITE_SHARE)) if lite else count


def box_dirs(n: int, half, rnd: random.Random, faces=('py', 'pz', 'nz', 'px', 'nx')):
    """n directions from a box's centre to points spread over the chosen faces (area-weighted, low-discrepancy), so a long thin
    hedge section gets cards on its big sides and its top in proportion to their area. `half` = (hx, hy, hz)."""
    hx, hy, hz = half
    area = {'py': 4 * hx * hz, 'pz': 4 * hx * hy, 'nz': 4 * hx * hy, 'px': 4 * hz * hy, 'nx': 4 * hz * hy}
    total = sum(area[f] for f in faces)
    out = []
    for f in faces:
        k = max(1, round(n * area[f] / total))
        o1, o2 = rnd.random(), rnd.random()
        for i in range(k):
            u = ((i * .6180339887 + o1) % 1.0) * 2 - 1
            w = ((i * .7548776662 + o2) % 1.0) * 2 - 1
            u += rnd.uniform(-.04, .04)
            w += rnd.uniform(-.04, .04)
            pt = {'py': (u * hx, hy, w * hz), 'pz': (u * hx, w * hy, hz), 'nz': (u * hx, w * hy, -hz),
                  'px': (hx, w * hy, u * hz), 'nx': (-hx, w * hy, u * hz)}[f]
            out.append(unit(pt))
    return out


def surface(v, radii, p: float):
    """Point of the superellipsoid |x/rx|^p + |y/ry|^p + |z/rz|^p = 1 in direction v, and its outward unit normal.
    p = 2 is an ellipsoid; p around 3.5 is a rounded box (hedge sections)."""
    s = sum(abs(v[i] / radii[i]) ** p for i in range(3)) ** (1 / p)
    q = tuple(v[i] / s for i in range(3))
    g = tuple(math.copysign(abs(q[i] / radii[i]) ** (p - 1), q[i]) / radii[i] for i in range(3))
    return q, unit(g)


def ellipsoid(m: MeshData, center, radii, mat: str, rings: int = 4, segments: int = 8, **kw) -> None:
    """Opaque lumpy mass (the core inside a puff). Built like MeshData.sphere, with a radius per axis."""
    cx, cy, cz = center
    rx, ry, rz = radii
    pts = []
    for r in range(rings + 1):
        phi = math.pi * r / rings
        pts.append([(cx + math.sin(phi) * math.cos(2 * math.pi * s / segments) * rx, cy + math.cos(phi) * ry,
                     cz - math.sin(phi) * math.sin(2 * math.pi * s / segments) * rz) for s in range(segments)])
    for r in range(rings):
        for s in range(segments):
            t = (s + 1) % segments
            a, b, c, d = pts[r][s], pts[r + 1][s], pts[r + 1][t], pts[r][t]
            if r == 0:
                m.face([a, b, c], mat, **kw)
            elif r == rings - 1:
                m.face([a, b, d], mat, **kw)
            else:
                m.face([a, b, c, d], mat, **kw)


def puff(m: MeshData, rnd: random.Random, lite: bool, center, radii, count: int, hmin: float, hmax: float, kinds=(1, 3, 0, 2),
         weights=None, mats=('leaf_bush', 'leaf_bush_lite'), tint=(1.0, 1.0, 1.0), ao: float = .5, gain: float = 1.0, p: float = 2.0,
         skip=None, min_y: float = .04, outward: float = .75, droop_limit: float = -.45, width: float = 1.05, dirs=None, fit=None, shingle: bool = True,
         spray: float = .28) -> int:
    """A volume of leaf cards around `center` with per-axis `radii` (superellipsoid exponent `p`).

    `count` is the detailed-set card count; the lite set takes 40% of them, 50% larger (`dirs`, when given, replaces the
    sphere directions: the caller sizes it with card_count). `skip(direction, normal)` may
    reject a direction (inner faces between hedge sections, a small gap). Cards never start below `min_y` or point
    steeper down than `droop_limit`, and their tips are clipped to `min_y`. Returns the number of cards added.

    `shingle` (default) roots each card on the surface and lays it along it, tilted 20 to 50 degrees outward and biased up the
    surface, so cards overlap like shingles and cover the surface with far fewer cards than spikes growing straight out; a
    share `spray` of the cards roll up to 80 degrees off the surface and stick out as leafy fuzz at the edges and corners."""
    n = card_count(count, lite)
    scale = LITE_SIZE if lite else 1.0
    mat = mats[1] if lite else mats[0]
    wsum = sum(weights or kinds) if weights else len(kinds)
    added = 0
    for i, v in enumerate(dirs if dirs is not None else sphere_dirs(n, rnd)):
        q, nrm = surface(v, radii, p)
        if skip and skip(v, nrm):
            continue
        if shingle:
            k = rnd.uniform(.9, .985)
            base = (center[0] + q[0] * k, center[1] + q[1] * k, center[2] + q[2] * k)
            upt = (-nrm[0] * nrm[1], 1 - nrm[1] * nrm[1], -nrm[2] * nrm[1])          # world up projected onto the tangent plane
            rt = unit(cross(nrm, unit((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))))
            ul = math.sqrt(dot(upt, upt))
            if ul > .3:
                tg = unit((upt[0] / ul * .62 + rt[0] * .38, upt[1] / ul * .62 + rt[1] * .38, upt[2] / ul * .62 + rt[2] * .38))
            else:
                tg = rt
            phi = rnd.uniform(.35, .85)
            c, s_ = math.cos(phi), math.sin(phi)
            d = unit((tg[0] * c + nrm[0] * s_, tg[1] * c + nrm[1] * s_, tg[2] * c + nrm[2] * s_))
        else:
            k = rnd.uniform(.5, .95)                                 # how deep inside the surface the card is rooted
            base = (center[0] + q[0] * k, center[1] + q[1] * k, center[2] + q[2] * k)
            d = unit((nrm[0] * outward + v[0] * (1 - outward) + rnd.uniform(-.28, .28), nrm[1] * outward + v[1] * (1 - outward) + rnd.uniform(-.2, .28),
                      nrm[2] * outward + v[2] * (1 - outward) + rnd.uniform(-.28, .28)))
        if base[1] < min_y:
            base = (base[0], min_y + rnd.uniform(0, .05), base[2])
        if d[1] < droop_limit:
            d = unit((d[0], droop_limit, d[2]))
        h = rnd.uniform(hmin, hmax) * scale
        if d[1] < -1e-3 and base[1] + d[1] * h < min_y:
            h = max(.05, (min_y - base[1]) / d[1])
        kind = kinds[i % len(kinds)] if not weights else _pick(kinds, weights, wsum, rnd)
        if shingle:
            roll = rnd.uniform(-.55, .55) if rnd.random() > spray else rnd.uniform(-1.4, 1.4)
            hint = nrm
        else:
            # stratified roll: neighbouring cards in the spiral get planes that are spread over 180 degrees
            roll = ((i * .6180339887) % 1.0) * math.pi + rnd.uniform(-.2, .2)
            hint = (v[0], .3 + .7 * abs(v[1]), v[2])
        t = (tint[0] * rnd.uniform(.94, 1.06), tint[1] * rnd.uniform(.95, 1.05), tint[2] * rnd.uniform(.92, 1.08))
        if card(m, mat, base, d, hint, roll, h, h * width * (1.0 if kind in (1, 3) else .95), kind, rnd,
                ao=ao * rnd.uniform(.9, 1.1), gain=gain, tint=t, fit=fit):
            added += 1
    return added


def _pick(kinds, weights, wsum, rnd):
    r = rnd.uniform(0, wsum)
    for k, w in zip(kinds, weights):
        r -= w
        if r <= 0:
            return k
    return kinds[-1]
