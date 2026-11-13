"""Farmstead perimeter wall (2026-11): an old, overgrown fieldstone wall around the whole playable yard.

Pure Python (no bpy; MeshData is used for the mesh). One *spec* (a dict stored in layout.json under `farm.perimeter`)
feeds the visible stonework, the vines and the authoritative collision boxes, so the wall players see, shoot and bump
into is one thing:

  inner      [x0, z0, x1, z1]  the inner face of the wall: where the old invisible boundary stood
  thickness  0.9 m, so the wall occupies a ring outside `inner`
  piers      buttress piers (1.3 m wide, 0.4 m proud on both faces, taller than the wall, with a cap) every 9 to 12 m,
             kept clear of hedges and trees; `corners` are the four larger corner piers (2.1 m squares)
  sections   the wall between two piers, each with its own height (3.1 to 3.45 m: a little lower than the house, cabin and
             barn walls), a plinth 0.1 m proud (0.55 m high) and a coping of separate stones with chipped tops

Frames. Each side has `a` running clockwise along the inner face (north: +x, east: +z, south: -x, west: -z) and `e`, the
distance into the yard (so the wall body is e in [-thickness, 0]). Solid boxes are exact: the body, plinth and pier shafts are
the faces players see; the stone relief on top (coping, pier caps) never reaches past the body's inner face, so a bullet hits
what is drawn.
"""
from __future__ import annotations

import math
import random

THICK = 0.9
PLINTH_H = 0.55
PLINTH_OUT = 0.1
PIER_W = 1.3
PIER_IN = 0.4
PIER_OUT = 0.4
CORNER_IN = 0.8           # a corner pier reaches this far into the yard from the inner faces
CORNER_OUT = 0.4          # ... and this far past the outer faces
SECTION_TOPS = (3.1, 3.18, 3.26, 3.34, 3.42)
PIER_TOP = 3.62
CAP_H = 0.22
COPING_OVER = 0.12        # the coping overhangs the OUTER face only
BELOW = 0.25              # visible stone continues this far below the ground, so no seam shows
MAT = 'stone_wall_old'

SIDES = ('n', 'e', 's', 'w')


def frame(inner, side):
    """(origin, t, n_in, length) of a side: origin is the room corner where the side starts."""
    x0, z0, x1, z1 = inner
    return {'n': ((x0, z0), (1, 0), (0, 1), x1 - x0), 'e': ((x1, z0), (0, 1), (-1, 0), z1 - z0),
            's': ((x1, z1), (-1, 0), (0, -1), x1 - x0), 'w': ((x0, z1), (0, -1), (1, 0), z1 - z0)}[side]


def pt(inner, side, a, e, y=0.0):
    (ox, oz), t, n, _ = frame(inner, side)
    return (ox + t[0] * a + n[0] * e, y, oz + t[1] * a + n[1] * e)


def rect(inner, side, a0, a1, e0, e1):
    """World rect [x0, z0, x1, z1] of a range in a side's frame."""
    p, q = pt(inner, side, a0, e0), pt(inner, side, a1, e1)
    return [round(min(p[0], q[0]), 4), round(min(p[2], q[2]), 4), round(max(p[0], q[0]), 4), round(max(p[2], q[2]), 4)]


# --- spec ------------------------------------------------------------------------------------------------------
def build_spec(play, boxes=(), seed: int = 2611) -> dict:
    """The perimeter around the playable rect `play` (inner face half a metre beyond it, where the old boundary stood).
    `boxes` are [x0, z0, x1, z1] footprints of props that stand near the wall: piers keep clear of them."""
    rnd = random.Random(seed)
    inner = [play[0] - 0.5, play[1] - 0.5, play[2] + 0.5, play[3] + 0.5]
    spec = {'version': 1, 'inner': [round(v, 3) for v in inner], 'thickness': THICK, 'plinth': [PLINTH_H, PLINTH_OUT],
            'material': MAT, 'corners': [], 'piers': [], 'sections': []}
    for side in SIDES:
        _, _, _, length = frame(inner, side)
        cw = CORNER_IN
        # corner pier at the start of this side (in this side's frame)
        spec['corners'].append({'id': f'c{side}', 'side': side, 'rect': rect(inner, side, -(THICK + CORNER_OUT), cw, -(THICK + CORNER_OUT), cw), 'top': PIER_TOP})
        lo, hi = cw + PIER_W / 2 + .3, length - cw - PIER_W / 2 - .3
        k = max(1, round((hi - lo) / 10.5))
        near = []        # a-ranges of props within 1.3 m of this face: a pier would grow into them
        for b in boxes:
            q0 = pt(inner, side, 0, 0)
            (_, t, n, _) = frame(inner, side)
            # project the box corners on the side's a and e axes
            pts = [(cx, cz) for cx in (b[0], b[2]) for cz in (b[1], b[3])]
            av = [(p[0] - q0[0]) * t[0] + (p[1] - q0[2]) * t[1] for p in pts]
            ev = [(p[0] - q0[0]) * n[0] + (p[1] - q0[2]) * n[1] for p in pts]
            if min(ev) < 1.3 and max(ev) > -1.0:
                near.append((min(av) - .35 - PIER_W / 2, max(av) + .35 + PIER_W / 2))
        centres = []
        for i in range(k):
            c = lo + (hi - lo) * (i + .5) / k + rnd.uniform(-1.2, 1.2)
            c = min(hi, max(lo, c))
            # move out of any blocked range: nearest free centre within 4 m
            for off in [0.0] + [s * d for d in (.25 * j for j in range(1, 17)) for s in (1, -1)]:
                cc = c + off
                if lo <= cc <= hi and not any(r0 < cc < r1 for r0, r1 in near) and all(abs(cc - o) > PIER_W + 3.0 for o in centres):
                    c = cc
                    break
            else:
                continue
            centres.append(c)
        centres.sort()
        for i, c in enumerate(centres):
            a0, a1 = c - PIER_W / 2, c + PIER_W / 2
            spec['piers'].append({'id': f'p{side}{i}', 'side': side, 'a': [round(a0, 3), round(a1, 3)],
                                  'rect': rect(inner, side, a0, a1, -(THICK + PIER_OUT), PIER_IN), 'top': PIER_TOP})
        # sections between the corner piers and the piers
        edges = [cw] + [v for c in centres for v in (c - PIER_W / 2, c + PIER_W / 2)] + [length - cw]
        last = None
        for i in range(0, len(edges), 2):
            a0, a1 = edges[i], edges[i + 1]
            top = rnd.choice([t for t in SECTION_TOPS if t != last])
            last = top
            spec['sections'].append({'id': f's{side}{i // 2}', 'side': side, 'a': [round(a0, 3), round(a1, 3)], 'top': top,
                                     'rect': rect(inner, side, a0, a1, -THICK, 0.0), 'seed': rnd.randrange(1 << 20)})
    return spec


def boxes(spec) -> list:
    """[(aabb, tag)] of every solid of the wall, in the farmstead collision convention. Sections and piers overlap by 2 cm
    where they meet, so there is no seam to slip through; everything is sunk 2 m into the ground."""
    out = []
    inner = spec['inner']
    for s in spec['sections']:
        a0, a1 = s['a']
        r = rect(inner, s['side'], a0 - .02, a1 + .02, -THICK, 0.0)
        out.append(([r[0], -2.0, r[1], r[2], s['top'], r[3]], f"farm:perimeter:{s['id']}"))
        po = spec['plinth'][1]
        r = rect(inner, s['side'], a0 - .02, a1 + .02, -THICK - po, po)
        out.append(([r[0], -2.0, r[1], r[2], spec['plinth'][0], r[3]], f"farm:perimeter:plinth:{s['id']}"))
    for p in spec['piers'] + spec['corners']:
        r = p['rect']
        out.append(([r[0], -2.0, r[1], r[2], p['top'], r[3]], f"farm:perimeter:{p['id']}"))
    out += fence_boxes(spec)
    return out


def roof_extensions(spec, roofs):
    """Fence only boundary runs reachable above the stone from a solid roof.

    Conservative ballistic envelope: full slide speed even in the air, a jump
    from the highest point of each roof, and 60 cm allowance at either end.
    A roof's bounding rectangle overestimates its ridge height at the eaves.
    """
    out = []
    for side in SIDES:
        length = frame(spec['inner'], side)[3]
        samples = []
        for a in range(math.ceil(length) + 1):
            x, _, z = pt(spec['inner'], side, min(a, length), 0)
            height = 0.0
            for r, top in roofs:
                distance = max(0, math.hypot(max(r[0]-x, 0, x-r[2]), max(r[1]-z, 0, z-r[3])) - .6)
                t = max(distance / 7.8, 6.6 / 20)
                height = max(height, top + 6.6*t - 10*t*t)
            samples.append(height)
        ranges = []
        for a, h in enumerate(samples):
            if h <= 3.0:
                continue
            lo, hi = max(0, a-2), min(length, a+3)
            if ranges and lo <= ranges[-1][1] + 2:
                ranges[-1][1] = hi
                ranges[-1][2] = max(ranges[-1][2], h)
            else:
                ranges.append([lo, hi, h])
        for i, (lo, hi, h) in enumerate(ranges):
            out.append({'id': f'{side}{i}', 'side': side, 'a': [lo, hi],
                        'base': 3.0, 'top': max(5.5, math.ceil((h+1.6)*2)/2)})
    return out


def fence_boxes(spec):
    """Real bars, not filled collision panels: bullets pass through visible gaps."""
    out = []
    def anchor(r):
        # Above the local coping/pier, not a coplanar face buried in its stone.
        parts=[(s['rect'],s['top']) for s in spec['sections']]
        for p in spec['piers']+spec['corners']:
            x0,z0,x1,z1=p['rect'];cx,cz=(x0+x1)/2,(z0+z1)/2;fw=min(x1-x0,z1-z0)*.32
            parts += [([x0-.09,z0-.09,x1+.09,z1+.09],p['top']),
                      ([cx-fw,cz-fw,cx+fw,cz+fw],p['top']+.2)]
        return max([3.0]+[top+.006 for b,top in parts if b[0]<r[2] and b[2]>r[0] and b[1]<r[3] and b[3]>r[1]])
    for f in spec.get('extensions', []):
        lo, hi = f['a']; base, top = f['base'], f['top']
        count = max(1, math.ceil((hi-lo)/.4))
        for i in range(count+1):
            a = lo+(hi-lo)*i/count
            r = rect(spec['inner'], f['side'], a-.04, a+.04, -.22, -.14)
            out.append(([r[0],anchor(r),r[1],r[2],top,r[3]], f"farm:perimeter-fence:{f['id']}:bar:{i}"))
        count = max(1, math.ceil((hi-lo)/3))
        for i in range(count+1):
            a = lo+(hi-lo)*i/count
            r = rect(spec['inner'], f['side'], a-.075, a+.075, -.255, -.105)
            out.append(([r[0],anchor(r),r[1],r[2],top+.08,r[3]], f"farm:perimeter-fence:{f['id']}:post:{i}"))
        r = rect(spec['inner'], f['side'], lo, hi, -.23, -.13)
        for name, y in [('top',top-.2)]:
            out.append(([r[0],y-.05,r[1],r[2],y+.05,r[3]], f"farm:perimeter-fence:{f['id']}:{name}"))
    return out


def solids(spec) -> list:
    """Footprints for the tactical map and Practice navigation: [{'id', 'kind', 'rect'}]."""
    out = []
    for s in spec['sections']:
        out.append({'id': 'perimeter', 'kind': 'wall', 'rect': rect(spec['inner'], s['side'], s['a'][0], s['a'][1], -THICK, spec['plinth'][1])})
    for p in spec['piers'] + spec['corners']:
        out.append({'id': 'perimeter', 'kind': 'pier', 'rect': p['rect']})
    return out


def section_at(spec, side, a):
    for s in spec['sections']:
        if s['side'] == side and s['a'][0] - 1e-6 <= a <= s['a'][1] + 1e-6:
            return s
    return None


# --- noise ----------------------------------------------------------------------------------------------------
def _h(ix, iz, seed=7):
    n = (ix * 374761393 + iz * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, z, seed=7):
    """Smooth value noise in [-1, 1]."""
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    fx, fz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a, b, c, d = _h(ix, iz, seed), _h(ix + 1, iz, seed), _h(ix, iz + 1, seed), _h(ix + 1, iz + 1, seed)
    return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * 2 - 1


def stain(x, y, z, outer=False):
    """Vertex colour of the stonework at a point: darker and greener toward the ground (damp, moss), vertical rain streaks,
    large soft blotches, a little bleached on top."""
    broad = vnoise(x * .11 + z * .07, y * .3, 3)
    streak = vnoise(x * 1.7 + z * 1.3, y * .08, 5)
    k = .9 + .08 * broad - .07 * max(0.0, streak - .25)
    r, g, b = k, k, k * .97
    low = max(0.0, 1.0 - max(0.0, y) / 1.5)
    moss = max(0.0, vnoise(x * .35 + z * .3, y * .5, 9) * .7 + .15) * (low * .9 + .12)
    r, g, b = r * (1 - .3 * moss), g * (1 - .02 * moss + .04 * moss), b * (1 - .42 * moss)
    d = low ** 1.6 * .22
    r, g, b = r * (1 - d), g * (1 - d), b * (1 - d)
    if outer:
        r, g, b = r * .9, g * .9, b * .9
    return (min(1.1, r), min(1.1, g), min(1.1, b), 1.0)


# --- stonework mesh -----------------------------------------------------------------------------------------------
def _grid(md, p0, du, dv, nu, nv, toward, outer=False, recess=0.0, rnd=None):
    """A wall face as a grid of quads from p0 along du and dv (full extents), shaded per vertex. Interior vertices are pushed back
    (into the wall, never out of it) by smooth noise so the plane is not a mirror; the border stays exact."""
    pts = {}
    for i in range(nu + 1):
        for j in range(nv + 1):
            x = p0[0] + du[0] * i / nu + dv[0] * j / nv
            y = p0[1] + du[1] * i / nu + dv[1] * j / nv
            z = p0[2] + du[2] * i / nu + dv[2] * j / nv
            if recess and 0 < i < nu and 0 < j < nv:
                k = recess * (.5 + .5 * vnoise(x * 1.3 + z * 1.1, y * 1.5, 13))
                x, z = x - toward[0] * k, z - toward[2] * k
            pts[i, j] = (x, y, z)
    # UVs come from the face's IDEAL plane (metres along the wall and up), never from each quad's own tilted normal: the 2.5 cm recess
    # tilts quads by about a degree, which would rotate their texture basis and shift the stones by metres between neighbours.
    tx, tz = toward[2], -toward[0]
    ou, ov = md.uv_offset
    for i in range(nu):
        for j in range(nv):
            q = [pts[i, j], pts[i + 1, j], pts[i + 1, j + 1], pts[i, j + 1]]
            uv = [(p[0] * tx + p[2] * tz + ou, p[1] + ov) for p in q]
            md.face_toward(q, MAT, toward, col=[stain(p[0], p[1], p[2], outer) for p in q], uv=uv)


def mesh(md, spec) -> None:
    """Stonework: wall faces, plinth, coping stones, piers with caps, fallen stones at the foot."""
    inner = spec['inner']
    for box, _ in fence_boxes(spec):
        md.box(*box, 'iron_rusty')
    for s in spec['sections']:
        rnd = random.Random(s['seed'])
        side, (a0, a1), top = s['side'], s['a'], s['top']
        (_, t, n, _) = frame(inner, side)
        md.uv_offset = (rnd.uniform(0, 2.4), rnd.uniform(0, 2.4))
        body_top = top - .3
        ny = max(2, round((body_top + BELOW) / .85))
        nu = max(1, round((a1 - a0) / 1.2))
        for face, e, toward in (('in', 0.0, (n[0], 0.0, n[1])), ('out', -THICK, (-n[0], 0.0, -n[1]))):
            p0 = pt(inner, side, a0, e, -BELOW)
            du = (t[0] * (a1 - a0), 0.0, t[1] * (a1 - a0))
            _grid(md, p0, du, (0.0, body_top + BELOW, 0.0), nu, ny, toward, outer=face == 'out', recess=.025 if face == 'in' else 0.0)
        # the flat under the coping stones
        md.face_toward([pt(inner, side, a0, 0.0, body_top), pt(inner, side, a1, 0.0, body_top), pt(inner, side, a1, -THICK, body_top), pt(inner, side, a0, -THICK, body_top)],
                       MAT, (0, 1, 0), col=(.82, .82, .8, 1.0))
        # plinth: a broad foot, a little proud on both faces
        po = spec['plinth'][1]
        r = rect(inner, side, a0, a1, -THICK - po, po)
        md.uv_offset = (rnd.uniform(0, 2.4), rnd.uniform(0, 2.4))
        md.box(r[0], -BELOW, r[1], r[2], spec['plinth'][0], r[3], MAT, skip=('ny',), col=(.7, .7, .68, 1.0))
        # coping: separate stones, some chipped low, a few small; they overhang the outer face only
        a = a0 + rnd.uniform(0, .1)
        while a < a1 - .25:
            ln = min(a1 - a, rnd.uniform(.5, .95))
            if a1 - (a + ln) < .3:
                ln = a1 - a
            chip = 0.0 if rnd.random() < .55 else rnd.uniform(.02, .14)
            r = rect(inner, side, a + .012, a + ln - .012, -THICK - COPING_OVER, 0.0)
            tone = rnd.uniform(.78, 1.0)
            md.uv_offset = (rnd.uniform(0, 2.4), rnd.uniform(0, 2.4))
            md.box(r[0], top - .3, r[1], r[2], top - chip, r[3], MAT, col=(tone, tone * .99, tone * .95, 1.0))
            a += ln
    md.uv_offset = (0.0, 0.0)
    rnd = random.Random(99)
    for p in spec['piers'] + spec['corners']:
        x0, z0, x1, z1 = p['rect']
        top = p['top']
        md.uv_offset = (rnd.uniform(0, 2.4), rnd.uniform(0, 2.4))
        shaft = top - CAP_H
        ny = max(2, round((shaft + BELOW) / .85))
        faces = (('x', x0, -1), ('x', x1, 1), ('z', z0, -1), ('z', z1, 1))
        for axis, v, sgn in faces:
            nu = max(1, round(((z1 - z0) if axis == 'x' else (x1 - x0)) / 1.1))
            if axis == 'x':
                p0, du, toward = (v, -BELOW, z0), (0.0, 0.0, z1 - z0), (sgn, 0.0, 0.0)
            else:
                p0, du, toward = (x0, -BELOW, v), (x1 - x0, 0.0, 0.0), (0.0, 0.0, sgn)
            _grid(md, p0, du, (0.0, shaft + BELOW, 0.0), nu, ny, toward)
        # cap and finial
        c = .09
        md.box(x0 - c, shaft, z0 - c, x1 + c, top, z1 + c, MAT, col=(.92, .92, .9, 1.0))   # its underside overhangs the shaft: it must be closed
        fw = min(x1 - x0, z1 - z0) * .32
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        md.box(cx - fw, top, cz - fw, cx + fw, top + .2, cz + fw, MAT, skip=('ny',), col=(.88, .88, .86, 1.0))
    md.uv_offset = (0.0, 0.0)
    # fallen stones: a few blocks lying against the foot of the wall; they stay inside the plinth's 0.28 m, where nobody can stand
    rnd = random.Random(404)
    for s in spec['sections']:
        side, (a0, a1) = s['side'], s['a']
        for _ in range(max(1, round((a1 - a0) / 7))):
            if rnd.random() < .55:
                continue
            a = rnd.uniform(a0 + .4, a1 - .4)
            w, d, h = rnd.uniform(.22, .42), rnd.uniform(.14, .26), rnd.uniform(.1, .24)
            e = PLINTH_OUT + d / 2 - .04
            c = pt(inner, side, a, e, 0.0)
            tone = rnd.uniform(.62, .85)
            md.obox((c[0], h / 2 - .02, c[2]), (w / 2, h / 2 + .02, d / 2), rnd.uniform(-.3, .3) + (0 if side in 'ns' else math.pi / 2), MAT, skip=('ny',),
                    recolor=lambda p, col, tone=tone: (tone, tone, tone * .96, 1.0))
