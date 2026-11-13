"""Creeping vines, ivy and weeds on the Farmstead perimeter wall (2026-11-12 rewrite: thin stems with small leaves, see foliage.py).

Pure Python. Everything grows on the INNER face, the face players see, along a closed loop that follows the wall exactly: the wall runs,
the three faces of every pier and the two faces of every corner pier. A vine is a path in (s, y) = (distance along the loop, height).
It starts at the ground, climbs with a wandering heading, forks into thinner branches and, if it reaches the coping, spills a few
leaves over it. Because the path lives on the loop, vines wrap around pier corners and the corners of the yard by construction.

What is drawn (one alpha-cut atlas, `leaf_ivy`, cells: 0 ivy leaf, 1 paler leaf, 2 sprig, 3 weed tuft + a bark-brown texel):
  * stems    thin ribbons along the vine paths (2.6 cm at the foot of a main vine, 0.6 cm at a branch tip), 2 to 6 cm off the stone;
  * leaves   small single leaves (5 to 10 cm) on both sides of every stem, flat against the wall, bigger and denser toward the ground;
  * clumps   now and then a modest cluster of leaves (and a sprig) around a point on a vine, a little proud of the stone;
  * weeds    thin grass tufts at the foot, on the plinth, in a few cracks and on the coping.
Cover is patchy by a noise field: long stretches of bare stone, heavier growth near the ground, at piers and at corners.
Two sets are written, `leaf_ivy` (everything) and `leaf_ivy_lite` (a third of the leaves, the main stems, everything 50% larger).
"""
from __future__ import annotations

import math
import random

import perimeter as P
from foliage import card, unit, cross, LITE_SIZE

STEM_UV = (0.5156, 0.484)      # centre of the bark-brown block in the top-left corner of atlas cell 3
LEAF_LEN = .74                 # the leaf drawn in cells 0 and 1 fills this share of the cell height ...
LEAF_BASE = .18                # ... starting this share above the bottom, so the card is shifted down to put the leaf's base on the point


class Loop:
    """The inner face as a closed polyline with a normal pointing into the yard and the wall's top height per segment."""

    def __init__(self, spec):
        inner = spec['inner']
        self.spec = spec
        self.segs = []      # (x0, z0, x1, z1, nx, nz, top)
        cw = P.CORNER_IN
        for side in P.SIDES:
            (_, t, n, length) = P.frame(inner, side)
            items = [(s['a'][0], s['a'][1], 'wall', s['top']) for s in spec['sections'] if s['side'] == side]
            items += [(p['a'][0], p['a'][1], 'pier', p['top']) for p in spec['piers'] if p['side'] == side]
            items.sort()
            for a0, a1, kind, top in items:
                if kind == 'wall':
                    self._seg(inner, side, a0, 0.0, a1, 0.0, n, top)
                else:
                    self._seg(inner, side, a0, 0.0, a0, P.PIER_IN, (-t[0], -t[1]), top)
                    self._seg(inner, side, a0, P.PIER_IN, a1, P.PIER_IN, n, top)
                    self._seg(inner, side, a1, P.PIER_IN, a1, 0.0, t, top)
            # the corner pier at the END of this side: its face toward this side, then its face toward the yard
            self._seg(inner, side, length - cw, 0.0, length - cw, cw, (-t[0], -t[1]), P.PIER_TOP)
            self._seg(inner, side, length - cw, cw, length, cw, n, P.PIER_TOP)
        self.cum = [0.0]
        for sg in self.segs:
            self.cum.append(self.cum[-1] + math.hypot(sg[2] - sg[0], sg[3] - sg[1]))
        self.length = self.cum[-1]

    def _seg(self, inner, side, a0, e0, a1, e1, n_in, top):
        p, q = P.pt(inner, side, a0, e0), P.pt(inner, side, a1, e1)
        self.segs.append((p[0], p[2], q[0], q[2], n_in[0], n_in[1], top))

    def at(self, s):
        """(x, z, nx, nz, tx, tz, top) at loop distance s (wraps). The normal turns smoothly across the last 0.2 m of a corner."""
        s %= self.length
        lo, hi = 0, len(self.segs) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid - 1
        x0, z0, x1, z1, nx, nz, top = self.segs[lo]
        ln = self.cum[lo + 1] - self.cum[lo]
        f = (s - self.cum[lo]) / ln if ln else 0.0
        tx, tz = (x1 - x0) / ln, (z1 - z0) / ln
        x, z = x0 + (x1 - x0) * f, z0 + (z1 - z0) * f
        # blend toward the neighbour's normal near either end
        blend = .2
        d0, d1 = s - self.cum[lo], self.cum[lo + 1] - s
        if d0 < blend:
            o = self.segs[lo - 1]
            w = .5 * (1 - d0 / blend)
            nx, nz = nx * (1 - w) + o[4] * w, nz * (1 - w) + o[5] * w
        elif d1 < blend:
            o = self.segs[(lo + 1) % len(self.segs)]
            w = .5 * (1 - d1 / blend)
            nx, nz = nx * (1 - w) + o[4] * w, nz * (1 - w) + o[5] * w
        k = math.hypot(nx, nz) or 1.0
        return x, z, nx / k, nz / k, tx, tz, top


def _sample(spec, seed=818):
    """Every leaf, tuft and stem of the wall as plain data; `add` writes them for the detailed and the lite set."""
    rnd = random.Random(seed)
    loop = Loop(spec)
    L = loop.length
    cards = []              # leaves, sprigs and tufts
    stems = []              # {'pts': [(x, y, z)], 'w': [width per point], 'n': (nx, nz)}
    layer = [0]

    def cover(s, y):
        """Cover field 0..1: broad patches along the wall, bare stretches between them, richer toward the ground."""
        a = P.vnoise(s * .075, 1.3, 31) * .5 + P.vnoise(s * .21, y * .22, 33) * .22 + .5
        a += .2 * (1 - min(1.0, y / 3.0))
        return max(.08, min(1.0, (a - .42) / .3))

    def world(s, y, off):
        x, z, nx, nz, tx, tz, top = loop.at(s)
        return (x + nx * off, y, z + nz * off), (nx, nz), (tx, tz), top

    def leaf(s, y, off, ang, length, kind=None, tilt=.3, role='leaf', ao=.7, gain=1.0, tint=None, roll=.35):
        """A single leaf standing on the wall point (s, y, off), pointing along `ang` (radians from straight up, positive toward +s)."""
        (px, py, pz), (nx, nz), (tx, tz), top = world(s, y, off)
        layer[0] += 1
        o = .0045 * (layer[0] % 9) + rnd.uniform(0, .01)
        ca, sa = math.cos(ang), math.sin(ang)
        d = unit((tx * sa + nx * tilt, ca, tz * sa + nz * tilt))
        h = length / LEAF_LEN
        base = (px + nx * o - d[0] * h * LEAF_BASE, py - d[1] * h * LEAF_BASE, pz + nz * o - d[2] * h * LEAF_BASE)
        if kind is None:
            kind = 0
        cards.append({'kind': kind, 'base': base, 'd': d, 'hint': (nx, 0.0, nz), 'roll': rnd.uniform(-roll, roll), 'h': h, 'w': h, 'role': role,
                      'ao': ao * rnd.uniform(.9, 1.15), 'gain': gain, 'tint': tint or (rnd.uniform(.9, 1.05), rnd.uniform(.94, 1.06), rnd.uniform(.88, 1.04)), 'top': top})

    def clump(s, y, off, size, count, sprig):
        """A modest cluster of leaves fanning out around a point, a few centimetres proud of the stone."""
        for k in range(count):
            a = rnd.uniform(0, 6.283)
            r = rnd.uniform(.0, size)
            ds, dy = math.cos(a) * r * .9, math.sin(a) * r
            leaf(s + ds, y + dy, off + rnd.uniform(.0, .045), math.atan2(ds, dy) + rnd.gauss(0, .45), rnd.uniform(.05, .085), tilt=rnd.uniform(.3, .65),
                 role='clump', ao=.66, roll=.6)
        if sprig:
            (px, py, pz), (nx, nz), (tx, tz), top = world(s, y, off + .03)
            ang = rnd.uniform(-.7, .7)
            d = unit((tx * math.sin(ang) + nx * .3, math.cos(ang), tz * math.sin(ang) + nz * .3))
            h = rnd.uniform(.17, .26)
            layer[0] += 1
            cards.append({'kind': 2, 'base': (px, py, pz), 'd': d, 'hint': (nx, 0.0, nz), 'roll': rnd.uniform(-.3, .3), 'h': h, 'w': h * .8, 'role': 'clump',
                          'ao': .66, 'gain': 1.0, 'tint': (1, 1, 1), 'top': top})

    def sprig(s, y, off, ang):
        (px, py, pz), (nx, nz), (tx, tz), top = world(s, y, off)
        d = unit((tx * math.sin(ang) + nx * .25, math.cos(ang), tz * math.sin(ang) + nz * .25))
        h = rnd.uniform(.17, .26)
        layer[0] += 1
        cards.append({'kind': 2, 'base': (px, py, pz), 'd': d, 'hint': (nx, 0.0, nz), 'roll': rnd.uniform(-.3, .3), 'h': h, 'w': h * .8, 'role': 'sprig',
                      'ao': .68, 'gain': 1.0, 'tint': (rnd.uniform(.92, 1.05), rnd.uniform(.95, 1.05), rnd.uniform(.9, 1.04)), 'top': top})

    def mat(s, y, off, size, tilt=.2, role='mat', ao=.62):
        """A card of about 14 small overlapping leaves (atlas cell 1), `size` metres tall, lying nearly flat on the wall."""
        (px, py, pz), (nx, nz), (tx, tz), top = world(s, y, off)
        layer[0] += 1
        o = .0045 * (layer[0] % 9) + rnd.uniform(0, .01)
        ang = rnd.uniform(-.5, .5)
        d = unit((tx * math.sin(ang) + nx * tilt, math.cos(ang), tz * math.sin(ang) + nz * tilt))
        cards.append({'kind': 1, 'base': (px + nx * o, py, pz + nz * o), 'd': d, 'hint': (nx, 0.0, nz), 'roll': rnd.uniform(-.3, .3), 'h': size, 'w': size,
                      'role': role, 'ao': ao * rnd.uniform(.9, 1.12), 'gain': 1.0, 'tint': (rnd.uniform(.9, 1.05), rnd.uniform(.94, 1.06), rnd.uniform(.88, 1.04)), 'top': top})

    def blanket(s0, y0, width, height, n):
        """Ivy growing as a dense mat at the foot of the wall: leaves and sprigs in a patch about `width` wide and `height` tall, thickest at the
        bottom, flush against the stone in layers (the leaves of a real ivy mat all lie in the wall plane)."""
        for _ in range(n):
            u = rnd.random()
            s = s0 + rnd.gauss(0, width * .32)
            y = y0 + height * u ** 1.6 * (1.0 - .35 * abs(s - s0) / (width * .5 + .01))
            if y > loop.at(s)[6] - .4:
                continue
            r = rnd.random()
            if r < .5:
                mat(s, y, .02 + rnd.uniform(0, .03), rnd.uniform(.28, .5) * (1.0 - .3 * u), role='mat', ao=.62 + .1 * u)
            elif r < .6:
                sprig(s, y, .02 + rnd.uniform(0, .03), rnd.uniform(-1.2, 1.2))
            else:
                leaf(s, y, .02 + rnd.uniform(0, .035), rnd.uniform(-1.5, 1.5), (.085 + .05 * (1 - u)) * rnd.uniform(.8, 1.15), tilt=rnd.uniform(.1, .4), role='leaf', ao=.62 + .12 * u)

    def grow(s0, y0, heading, reach, width, depth, w_tip):
        """Climb one vine from (s0, y0): record its stem, leaves, clumps and branches. `depth` 0 is a main vine."""
        s, y, hd = s0, y0, heading
        pts, ws = [], []
        off0 = .02 + .0045 * (layer[0] % 7) + (.012 if depth else 0.0)
        steps = 0
        top0 = loop.at(s0)[6]
        over = reach > top0
        while steps < 90:
            (px, py, pz), _n, _t, top = world(s, y, off0)
            pts.append((px, py, pz))
            f = steps / max(1, (reach - y0) / .25)
            ws.append(max(w_tip, width * (1 - min(1.0, f) * .78)))
            c = cover(s, y)
            low = max(0.0, 1.0 - y / 2.6)
            dens = (.3 + .9 * c) * (.5 + 1.2 * low ** 1.3)
            # leaves on both sides of the stem: bigger and more of them near the ground, smaller toward the tip
            size = (.075 + .058 * low ** .8) * (1.0 - .28 * min(1.0, f)) * (1.0 if depth == 0 else .88)
            n_leaf = int(dens * .75 + rnd.random())
            for _ in range(n_leaf):
                side = rnd.choice((-1, 1))
                ang = hd + side * rnd.uniform(.55, 1.35) + rnd.gauss(0, .2)
                leaf(s + rnd.uniform(-.03, .03), y + rnd.uniform(-.03, .05), off0 + .006 + rnd.uniform(0, .02), ang, size * rnd.uniform(.8, 1.2),
                     tilt=rnd.uniform(.15, .45), ao=.7)
            # leaves growing up the stem's line, covering it where it is leafy
            if rnd.random() < dens * .35:
                leaf(s, y + .03, off0 + .02, hd + rnd.gauss(0, .3), size * 1.05, tilt=.25, ao=.72)
            if rnd.random() < (.01 + .03 * low) * (.4 + c) and y < top - .3:
                clump(s, y, off0 + .01, rnd.uniform(.1, .16), rnd.randint(5, 8), False)
            # a flat mat of leaves now and then along the vine, up the wall as well
            if rnd.random() < (.13 + .15 * low) * (.3 + c) and y < top - .3:
                mat(s + rnd.uniform(-.06, .06), y, off0 + .015, rnd.uniform(.22, .36), role='mat')
            # a sprig of small leaves on a twig: much leaf area for one card
            if rnd.random() < (.16 + .7 * low ** 1.2) * (.3 + c) and y < top - .25:
                sprig(s + rnd.uniform(-.05, .05), y, off0 + .02 + rnd.uniform(0, .03), hd + rnd.choice((-1, 1)) * rnd.uniform(.2, 1.1))
            step = rnd.uniform(.2, .3)
            hd += rnd.gauss(0, .2) - hd * .13
            hd = max(-1.45, min(1.45, hd))
            y += math.cos(hd) * step
            s += math.sin(hd) * step
            steps += 1
            # forks: thinner, set off sideways, shorter
            if depth < 3 and rnd.random() < (.1 if depth == 0 else .06) * (.5 + .9 * low + .4 * c) and reach - y > .45:
                bh = hd + rnd.choice((-1, 1)) * rnd.uniform(.45, 1.15)
                bh = max(-1.5, min(1.5, bh))
                grow(s, y, bh, min(reach, y + rnd.uniform(.4, 1.5 - .3 * depth)), width * .55, depth + 1, w_tip * .9)
            if y >= reach or y > top + .05:
                break
        if len(pts) > 1 and (depth < 2 or ws[0] > .008):
            stems.append({'pts': pts, 'w': ws, 'main': depth == 0})
        if over or y > loop.at(s)[6] - .08:
            top = loop.at(s)[6]
            if y > top - .4:
                # over the top: a few leaves on the coping and a short trailing strand down the face
                for _ in range(rnd.randint(3, 6)):
                    ps = s + rnd.uniform(-.5, .5)
                    leaf(ps, loop.at(ps)[6] - rnd.uniform(.05, .55), .04 + rnd.uniform(0, .03), math.pi + rnd.uniform(-.5, .5) - 0.0, rnd.uniform(.055, .085),
                         tilt=.2, role='drape', ao=.6)

    # --- vines --------------------------------------------------------------------------------------------------------
    s = rnd.uniform(0, 1)
    while s < L:
        c = cover(s, .3)
        if rnd.random() < .05 + .95 * c:
            if rnd.random() < .12 + .85 * c:
                blanket(s + rnd.uniform(-.3, .3), 0.0, rnd.uniform(1.0, 2.0) * (.7 + .5 * c), rnd.uniform(.8, 1.7) * (.55 + .6 * c), int(rnd.uniform(16, 30) * (.5 + c)))
            kind = rnd.random()
            if kind < .3:
                reach = rnd.uniform(.8, 1.9)
            elif kind < .62:
                reach = rnd.uniform(1.9, 3.4)
            else:
                reach = loop.at(s)[6] + rnd.uniform(.05, .6) if rnd.random() < .5 else rnd.uniform(3.0, 4.2)
            width = rnd.uniform(.016, .026) * (.8 + .4 * c)
            grow(s, rnd.uniform(0, .12), rnd.gauss(0, .2), reach, width, 0, .006)
            # a root flare: two or three short strands fan out at the foot, so the base is dense
            for _ in range(rnd.randint(1, 2)):
                grow(s + rnd.uniform(-.08, .08), rnd.uniform(0, .1), rnd.choice((-1, 1)) * rnd.uniform(.5, 1.05), rnd.uniform(.35, .9), width * .5, 1, .005)
        s += rnd.uniform(1.0, 2.2)
    # corners and piers: always a heavy vine (cw wraps around them by construction)
    for i, sg in enumerate(loop.segs):
        ln = loop.cum[i + 1] - loop.cum[i]
        if ln < 1.2 and sg[6] >= P.PIER_TOP - .01 and rnd.random() < .85:
            s = loop.cum[i] + ln / 2 + rnd.uniform(-.3, .3)
            grow(s, 0.0, rnd.gauss(0, .15), rnd.uniform(2.6, 4.2), .028, 0, .007)
    # --- weeds at the foot, on the plinth, in a few cracks and on the coping -----------------------------------------------
    def tuft(s, y, off, height, role, up=(0.0, 1.0)):
        (px, py, pz), (nx, nz), (tx, tz), top = world(s, y, off)
        layer[0] += 1
        cards.append({'kind': 3, 'base': (px, py, pz), 'd': unit((nx * .25, 1.0, nz * .25)), 'hint': (nx, .3, nz), 'roll': rnd.uniform(-1.2, 1.2),
                      'h': height, 'w': height * 1.1, 'role': role, 'ao': .75, 'gain': 1.0, 'tint': (1, 1, 1), 'top': top})

    for _ in range(int(L * .5)):                                  # on the ground along the foot
        s = rnd.uniform(0, L)
        if rnd.random() < .35 + .5 * cover(s, 0):
            tuft(s, 0.0, rnd.uniform(.13, .3), rnd.uniform(.22, .42), 'tuft')
    for _ in range(int(L * .22)):                                 # on the plinth
        s = rnd.uniform(0, L)
        top = loop.at(s)[6]
        if top <= P.SECTION_TOPS[-1] + .01:
            tuft(s, P.PLINTH_H, rnd.uniform(.02, .09), rnd.uniform(.2, .38), 'tuft')
    for _ in range(int(L * .25)):                                 # in cracks
        s = rnd.uniform(0, L)
        y = rnd.uniform(.9, loop.at(s)[6] - .6)
        if rnd.random() < .15 + .3 * cover(s, y):
            tuft(s, y, .02, rnd.uniform(.14, .26), 'tuft')
    for _ in range(int(L * .25)):                                 # on the coping
        s = rnd.uniform(0, L)
        x, z, nx, nz, tx, tz, top = loop.at(s)
        if top > P.SECTION_TOPS[-1] + .01:
            continue
        o = -rnd.uniform(.15, .75)
        tuft(s, top - rnd.uniform(0, .05), o, rnd.uniform(.2, .4), 'crown')
    return cards, stems


# the lite set keeps every `STRIDE[role]`-th card of that role and enlarges what stays
STRIDE = {'leaf': 4, 'mat': 3, 'clump': 2, 'sprig': 2, 'drape': 2, 'tuft': 2, 'crown': 2}


def _ribbon(md, mat, pts, widths, normal, col):
    """A thin strip along `pts` lying in the wall plane (it faces the yard), as one quad per step."""
    nx, nz = normal
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        across = unit(cross(d, (nx, 0.0, nz)))
        wa, wb = widths[i] / 2, widths[i + 1] / 2
        quad = [(a[0] - across[0] * wa, a[1] - across[1] * wa, a[2] - across[2] * wa), (a[0] + across[0] * wa, a[1] + across[1] * wa, a[2] + across[2] * wa),
                (b[0] + across[0] * wb, b[1] + across[1] * wb, b[2] + across[2] * wb), (b[0] - across[0] * wb, b[1] - across[1] * wb, b[2] - across[2] * wb)]
        md.face(quad, mat, uv=[STEM_UV] * 4, col=col)


def add(md, spec, seed=818) -> dict:
    """Write both sets (`leaf_ivy`, `leaf_ivy_lite`) into md; returns the counts."""
    cards, stems = _sample(spec, seed)
    rnd = random.Random(seed + 1)
    count = {'detail': 0, 'lite': 0, 'stems': 0}
    seen = {}
    for c in cards:
        seen[c['role']] = seen.get(c['role'], 0) + 1
        nth = seen[c['role']]
        card(md, 'leaf_ivy', c['base'], c['d'], c['hint'], c['roll'], c['h'], c['w'], c['kind'], rnd, ao=c['ao'], gain=c['gain'], tint=c['tint'])
        count['detail'] += 1
        if nth % STRIDE[c['role']] == 0:
            card(md, 'leaf_ivy_lite', c['base'], c['d'], c['hint'], c['roll'], c['h'] * LITE_SIZE, c['w'] * LITE_SIZE, c['kind'], rnd, ao=c['ao'], gain=c['gain'], tint=c['tint'])
            count['lite'] += 1
    loop = Loop(spec)
    for st in stems:
        # the wall normal at the stem's start is enough for a ribbon a few metres long
        x, z, nx, nz, *_ = loop.at(_nearest(loop, st['pts'][0]))
        shade = rnd.uniform(.62, .85)
        col = (shade, shade * .92, shade * .8, 1.0)
        _ribbon(md, 'leaf_ivy', st['pts'], st['w'], (nx, nz), col)
        count['stems'] += 1
        if st['main'] or st['w'][0] > .011:
            pts = st['pts'][::2] if len(st['pts']) > 3 else st['pts']
            ws = [w * 1.4 for w in st['w'][::2]] if len(st['pts']) > 3 else [w * 1.4 for w in st['w']]
            _ribbon(md, 'leaf_ivy_lite', pts, ws, (nx, nz), col)
    return count


def _nearest(loop, p):
    """Loop distance of the wall point closest to p (to recover a stem's wall normal)."""
    best, bs = 1e9, 0.0
    for i, sg in enumerate(loop.segs):
        x0, z0, x1, z1 = sg[:4]
        dx, dz = x1 - x0, z1 - z0
        ln2 = dx * dx + dz * dz or 1.0
        t = max(0.0, min(1.0, ((p[0] - x0) * dx + (p[2] - z0) * dz) / ln2))
        d = (x0 + dx * t - p[0]) ** 2 + (z0 + dz * t - p[2]) ** 2
        if d < best:
            best, bs = d, loop.cum[i] + t * math.sqrt(ln2)
    return bs
