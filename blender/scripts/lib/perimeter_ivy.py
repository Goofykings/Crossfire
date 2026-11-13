"""Vines, ivy, moss and weeds growing over the Farmstead perimeter wall (leaf cards, see foliage.py).

Pure Python. Everything grows on the INNER face, the face players see, along a closed loop that follows the wall exactly:
the wall runs, the three faces of every pier and the two faces of every corner pier. A vine is a path in (s, y) = (distance along
the loop, height) that climbs with a wandering heading, branches now and then and, when it reaches the top, spills over the
coping and hangs down. Because the path lives on the loop, vines wrap around pier corners and corners of the yard by
construction. Cover is patchy by design: a coverage field leaves long stretches of bare stone, corners and piers are heavier.

Cards hug the wall (their planes stay within about 25 degrees of it, 3 to 9 cm off the stone, each layer a few millimetres
apart so alpha-cut cards never z-fight); nothing floats. Atlas cells (ivy_leaves.png): 0 vine strand, 1 dense patch, 2 weed tuft,
3 moss tuft. Two sets are written, `leaf_ivy` (every card) and `leaf_ivy_lite` (about a third of them, 45% larger).
"""
from __future__ import annotations

import math
import random

import perimeter as P
from foliage import card, unit, LITE_SIZE


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
    """Every card as a dict; the caller writes them out for the detailed and the lite set."""
    rnd = random.Random(seed)
    loop = Loop(spec)
    L = loop.length
    cards = []
    layer = [0]

    def cover(s, y):
        """Cover field 0..1: broad patches along the wall, bare stretches between them, richer toward the ground."""
        a = P.vnoise(s * .075, 1.3, 31) * .5 + P.vnoise(s * .21, y * .22, 33) * .22 + .5
        a += .18 * (1 - min(1.0, y / 3.0))
        return max(0.0, min(1.0, (a - .42) / .32))

    def place(kind, s, y, off, heading, h, w, role, ao=.62, gain=1.0, roll=.35, tilt=.18, tint=(1, 1, 1), hang=False):
        x, z, nx, nz, tx, tz, top = loop.at(s)
        layer[0] += 1
        o = .03 + .0045 * (layer[0] % 11) + rnd.uniform(0, .012) + off
        base = (x + nx * o, y, z + nz * o)
        if hang:
            d = unit((nx * .1, -1.0, nz * .1))
        else:
            ch, sh = math.cos(heading), math.sin(heading)
            d = unit((tx * sh + nx * tilt, ch, tz * sh + nz * tilt))
        cards.append({'kind': kind, 'base': base, 'd': d, 'hint': (nx, 0.0, nz), 'roll': rnd.uniform(-roll, roll), 'h': h, 'w': w, 'role': role,
                      'ao': ao * rnd.uniform(.9, 1.15), 'gain': gain, 'tint': tint, 'top': top})

    # --- vines --------------------------------------------------------------------------------------------------------
    seeds = []
    s = rnd.uniform(0, 4)
    while s < L:
        c = cover(s, 0.4)
        if rnd.random() < .12 + .85 * c:
            seeds.append((s, rnd.uniform(.6, 1.0) * (1 + c)))
        s += rnd.uniform(3.2, 8.5)
    # corners and piers: always a heavy vine (cw wraps around them by construction)
    for i, sg in enumerate(loop.segs):
        ln = loop.cum[i + 1] - loop.cum[i]
        if ln < 1.2 and sg[6] >= P.PIER_TOP - .01:
            if rnd.random() < .85:
                seeds.append((loop.cum[i] + ln / 2 + rnd.uniform(-.4, .4), 1.6))
    stack = [(s0, .05, rnd.gauss(0, .2), rnd.uniform(1.4, 3.2 + 1.6 * w) * (1 if w < 1.3 else 1.3), w) for s0, w in seeds]
    for k in range(len(stack)):                       # some vines reach the top and go over
        if rnd.random() < .4:
            s0, y0, hd, reach, w = stack[k]
            top = loop.at(s0)[6]
            stack[k] = (s0, y0, hd, top + rnd.uniform(.1, .9), w)
    while stack:
        s0, y0, hd, reach, w = stack.pop()
        s, y, heading = s0, y0, hd
        steps = 0
        while y < reach and steps < 60:
            steps += 1
            top = loop.at(s)[6]
            h = rnd.uniform(.72, 1.0)
            place(0, s, y, 0.0, heading, h, h * .92, 'strand', ao=.58, gain=1.0, roll=.3, tilt=.2)
            # dense patches around the stem, more where the vine is heavy
            for _ in range(1 + int(w * rnd.uniform(.3, 1.1))):
                ps = s + rnd.uniform(-.45, .45) * w
                py = y + rnd.uniform(-.1, .5)
                if py < top + .1:
                    hh = rnd.uniform(.5, .85)
                    place(1, ps, py, 0.0, rnd.uniform(-.8, .8), hh, hh * 1.02, 'patch', ao=.6, roll=.4, tilt=.22)
            step = rnd.uniform(.24, .34)
            heading += rnd.gauss(0, .22) - heading * .16
            y += math.cos(heading) * step
            s += math.sin(heading) * step
            if y > top - .04 and not (reach > top):
                break
            if rnd.random() < .09 and reach - y > .7:
                stack.append((s, y, heading + rnd.choice((-1, 1)) * rnd.uniform(.7, 1.3), y + rnd.uniform(.7, 1.9), w * .6))
            if y > top + .05:
                break
        else:
            pass
        if y > loop.at(s)[6] - .06 or reach > loop.at(s0)[6]:
            # over the top: leaves growing up and inward on the coping, and curtains hanging down the face
            top = loop.at(s)[6]
            for _ in range(rnd.randint(3, 7)):
                ps = s + rnd.uniform(-.9, .9)
                top_p = loop.at(ps)[6]
                hh = rnd.uniform(.7, 1.4)
                place(0, ps, top_p + .03, rnd.uniform(.0, .22), 0.0, hh, hh * .9, 'drape', ao=.5, gain=.88, roll=.5, hang=True)
            for _ in range(rnd.randint(2, 4)):
                ps = s + rnd.uniform(-.7, .7)
                top_p = loop.at(ps)[6]
                hh = rnd.uniform(.45, .8)
                x, z, nx, nz, tx, tz, _t = loop.at(ps)
                layer[0] += 1
                cards.append({'kind': 1, 'base': (x - nx * rnd.uniform(.1, .5), top_p + .02, z - nz * rnd.uniform(.1, .5)),
                              'd': unit((nx * rnd.uniform(.1, .6), rnd.uniform(.5, 1.0), nz * rnd.uniform(.1, .6))), 'hint': (nx, .3, nz),
                              'roll': rnd.uniform(-1.2, 1.2), 'h': hh, 'w': hh * 1.05, 'role': 'crown', 'ao': .7, 'gain': 1.05, 'tint': (1, 1, 1), 'top': top_p})
    # --- curtains along the top edge where the cover is rich ------------------------------------------------------------
    s = rnd.uniform(0, 2)
    while s < L:
        top = loop.at(s)[6]
        c = cover(s, top)
        if top < P.PIER_TOP - .01 and c > .3 and rnd.random() < .2 + .45 * c:
            for _ in range(rnd.randint(1, 3)):
                hh = rnd.uniform(.4, 1.1) * (.6 + c)
                place(0, s + rnd.uniform(-.4, .4), top + .03, rnd.uniform(.02, .2), 0.0, hh, hh * .9, 'drape', ao=.5, gain=.88, roll=.5, hang=True)
        s += rnd.uniform(.9, 1.8)
    # --- weeds in the cracks, moss and weeds on the plinth and on the coping ------------------------------------------------
    n_tuft = int(L * 1.6)
    for _ in range(n_tuft):
        s = rnd.uniform(0, L)
        top = loop.at(s)[6]
        y = rnd.uniform(.7, top - .5)
        c = cover(s, y)
        if rnd.random() < .25 + .35 * c:
            hh = rnd.uniform(.22, .42)
            place(rnd.choice((2, 3, 3)), s, y, 0.0, rnd.gauss(0, .4), hh, hh * 1.1, 'tuft', ao=.7, gain=1.0, roll=.5, tilt=.8)
    for _ in range(int(L * .55)):
        s = rnd.uniform(0, L)
        hh = rnd.uniform(.3, .55)
        x, z, nx, nz, tx, tz, top = loop.at(s)
        if top > P.SECTION_TOPS[-1] + .01:
            continue
        layer[0] += 1
        o = rnd.uniform(.02, .09)
        cards.append({'kind': rnd.choice((2, 3, 3)), 'base': (x + nx * o, P.PLINTH_H, z + nz * o), 'd': unit((nx * .15, 1.0, nz * .15)), 'hint': (nx, .3, nz),
                      'roll': rnd.uniform(-1.2, 1.2), 'h': hh, 'w': hh * 1.15, 'role': 'plinth', 'ao': .75, 'gain': 1.0, 'tint': (1, 1, 1), 'top': top})
    for _ in range(int(L * .35)):                      # on the ground along the foot
        s = rnd.uniform(0, L)
        hh = rnd.uniform(.3, .6)
        x, z, nx, nz, tx, tz, top = loop.at(s)
        o = rnd.uniform(.12, .3)
        layer[0] += 1
        cards.append({'kind': rnd.choice((2, 3, 2)), 'base': (x + nx * o, 0.0, z + nz * o), 'd': unit((nx * .25, 1.0, nz * .25)), 'hint': (nx, .3, nz),
                      'roll': rnd.uniform(-1.2, 1.2), 'h': hh, 'w': hh * 1.15, 'role': 'plinth', 'ao': .75, 'gain': 1.0, 'tint': (1, 1, 1), 'top': top})
    for _ in range(int(L * .5)):                       # moss and grass tufts on the coping
        s = rnd.uniform(0, L)
        x, z, nx, nz, tx, tz, top = loop.at(s)
        if top > P.SECTION_TOPS[-1] + .01:
            continue
        hh = rnd.uniform(.25, .5)
        layer[0] += 1
        cards.append({'kind': rnd.choice((3, 2, 3)), 'base': (x - nx * rnd.uniform(.15, .75), top - rnd.uniform(0, .05), z - nz * rnd.uniform(.15, .75)),
                      'd': unit((rnd.uniform(-.3, .3), 1.0, rnd.uniform(-.3, .3))), 'hint': (nx, .3, nz), 'roll': rnd.uniform(-1.2, 1.2), 'h': hh,
                      'w': hh * 1.15, 'role': 'crown', 'ao': .8, 'gain': 1.0, 'tint': (1, 1, 1), 'top': top})
    return cards


# a lite set keeps every `STRIDE[role]`-th card of that role and enlarges what stays
STRIDE = {'strand': 2, 'patch': 3, 'drape': 2, 'tuft': 2, 'plinth': 2, 'crown': 2}


def add(md, spec, seed=818) -> dict:
    """Write both sets (`leaf_ivy`, `leaf_ivy_lite`) into md; returns the card counts."""
    cards = _sample(spec, seed)
    rnd = random.Random(seed + 1)
    count = {'detail': 0, 'lite': 0}
    seen = {}
    for c in cards:
        seen[c['role']] = seen.get(c['role'], 0) + 1
        nth = seen[c['role']]
        hint = c['hint']
        # hint's y component: wall cards keep a horizontal plane normal; drapes and crowns carry their own
        card(md, 'leaf_ivy', c['base'], c['d'], hint, c['roll'], c['h'], c['w'], c['kind'], rnd, ao=c['ao'], gain=c['gain'], tint=c['tint'])
        count['detail'] += 1
        if nth % STRIDE[c['role']] == 0:
            card(md, 'leaf_ivy_lite', c['base'], c['d'], hint, c['roll'], c['h'] * LITE_SIZE, c['w'] * LITE_SIZE, c['kind'], rnd, ao=c['ao'], gain=c['gain'], tint=c['tint'])
            count['lite'] += 1
    return count
