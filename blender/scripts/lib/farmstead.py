"""Farmstead structures (2026-11): house, barn, cabin, garage, shacks and the perimeter fence.

Pure Python (no bpy; MeshData is imported lazily). A structure is a list of *elements* stored in
layout.json under `farm.structures[*].elements`; the same elements feed the GLB export and the authoritative
collision boxes (`collision_boxes`), so the visible walls, openings, stairs and rails cannot disagree.

Element types (all coordinates are game metres; rects are [x0, z0, x1, z1]):

  wall    {t, rect, y:[y0,y1], open:[{a:[lo,hi], top, sill?, kind:'door'|'window', shutters?}],
           in, out, outside:'n'|'s'|'e'|'w'|None, base?, base_mat?, frame?}
          `a` is the opening's range along the wall's long axis. Every opening is a real hole in the
          collision; a door is an open entry (the map has no doors). Frames and sills are visual only.
  slab    {t, rect, y:[y0,y1], mat, under, holes?, kind}        ceilings, upper floors, decks (solid)
  stairs  {t, rect, dir:'n'|'s'|'e'|'w' (direction of ascent), y0, y1, n, mat, guard?:['l','r'], rail?}
  rail    {t, a:[x,z], b:[x,z], y, h, gaps?:[[lo,hi]], mat}     thin solid guard with posts and two rails
  post    {t, at:[x,z], y:[y0,y1], size, mat}
  box     {t, box:[x0,y0,z0,x1,y1,z1], mat, kind, solid?, mats?, skip?}
  roof    {t, kind:'gable'|'shed', rect, eave, axis:'x'|'z', pitch, over, mat, gable?, under?, high?:'n'|'s'|'e'|'w'}
          visual only: nobody can stand on a roof; ceilings carry the collision under it.

Solids are tagged `farm:<id>:<kind>`; `tests/farmstead.test.ts` walks every opening with the real controller.
"""
from __future__ import annotations

import math
from collections import namedtuple

EPS = 1e-6
FRAME = 0.045   # how far a frame board stands proud of the wall face

Part = namedtuple('Part', 'box mat kind solid mats skip')


def _part(box, mat, kind, solid=True, mats=None, skip=()):
    return Part([round(v, 4) for v in box], mat, kind, solid, mats or {}, tuple(skip))


# --- walls -------------------------------------------------------------------------------------
def _axis(rect):
    x0, z0, x1, z1 = rect
    return 'x' if (x1 - x0) >= (z1 - z0) else 'z'


def wall_pieces(el):
    """(a_lo, a_hi, y_lo, y_hi) solid pieces of a wall element, openings subtracted."""
    x0, z0, x1, z1 = el['rect']
    y0, y1 = el['y']
    lo, hi = (x0, x1) if _axis(el['rect']) == 'x' else (z0, z1)
    opens = sorted(el.get('open', []), key=lambda o: o['a'][0])
    out, cur = [], lo
    for o in opens:
        a0, a1 = o['a']
        assert a0 >= cur - EPS and a1 <= hi + EPS, f"opening {o} outside wall {el['rect']}"
        if a0 - cur > EPS:
            out.append((cur, a0, y0, y1))
        sill = o.get('sill', 0.0)
        if sill > EPS:
            out.append((a0, a1, y0, y0 + sill))
        if y0 + o['top'] < y1 - EPS:
            out.append((a0, a1, y0 + o['top'], y1))
        cur = a1
    if hi - cur > EPS:
        out.append((cur, hi, y0, y1))
    return out


def _wall_box(el, a0, a1, ya, yb):
    x0, z0, x1, z1 = el['rect']
    return [a0, ya, z0, a1, yb, z1] if _axis(el['rect']) == 'x' else [x0, ya, a0, x1, yb, a1]


def _face_mats(el):
    """Per-face materials of a wall: `out` on the exterior face, `in` elsewhere."""
    side = el.get('outside')
    inn, out = el['in'], el.get('out', el['in'])
    ax = _axis(el['rect'])
    m = {k: inn for k in ('nx', 'px', 'nz', 'pz', 'py', 'ny')}
    if side:
        m[{'n': 'nz', 's': 'pz', 'w': 'nx', 'e': 'px'}[side]] = out
        # the wall's ends and top read as exterior too (corners, parapets)
        for k in (('nx', 'px') if ax == 'x' else ('nz', 'pz')):
            m[k] = out
        m['py'] = out
    return m


def wall_parts(el):
    mats = _face_mats(el)
    kind = el.get('kind', 'wall')
    base = el.get('base', 0.0)
    y0 = el['y'][0]
    for a0, a1, ya, yb in wall_pieces(el):
        box = _wall_box(el, a0, a1, ya, yb)
        if base > EPS and ya < y0 + base - EPS and yb > y0 + base + EPS:
            cut = y0 + base
            low = dict(mats)
            side = el.get('outside')
            if side:
                low[{'n': 'nz', 's': 'pz', 'w': 'nx', 'e': 'px'}[side]] = el['base_mat']
            yield _part(_wall_box(el, a0, a1, ya, cut), el['in'], kind, True, low)
            yield _part(_wall_box(el, a0, a1, cut, yb), el['in'], kind, True, mats)
        elif base > EPS and yb <= y0 + base + EPS:
            low = dict(mats)
            side = el.get('outside')
            if side:
                low[{'n': 'nz', 's': 'pz', 'w': 'nx', 'e': 'px'}[side]] = el['base_mat']
            yield _part(box, el['in'], kind, True, low)
        else:
            yield _part(box, el['in'], kind, True, mats)
    yield from frame_parts(el)


def frame_parts(el):
    """Visual boards around every opening, on both wall faces (they never overlap the wall volume)."""
    trim = el.get('frame')
    if not trim:
        return
    x0, z0, x1, z1 = el['rect']
    ax = _axis(el['rect'])
    c0, c1 = (z0, z1) if ax == 'x' else (x0, x1)
    y0 = el['y'][0]
    bw = 0.13
    for o in el.get('open', []):
        a0, a1 = o['a']
        sill = o.get('sill', 0.0)
        top = y0 + o['top']
        bot = y0 + sill
        for lo_c, hi_c in ((c1, c1 + FRAME), (c0 - FRAME, c0)):
            def put(a_lo, a_hi, ya, yb):
                b = [a_lo, ya, lo_c, a_hi, yb, hi_c] if ax == 'x' else [lo_c, ya, a_lo, hi_c, yb, a_hi]
                return _part(b, trim, 'trim', False)
            yield put(a0 - bw, a0, bot - (bw if sill > EPS else 0), top + bw)
            yield put(a1, a1 + bw, bot - (bw if sill > EPS else 0), top + bw)
            yield put(a0, a1, top, top + bw)
            if sill > EPS:
                yield put(a0, a1, bot - bw, bot)
        if o.get('shutters'):
            for lo_c, hi_c, sgn in ((c1, c1 + .06, 1), (c0 - .06, c0, -1)):
                if el.get('outside') and ((ax == 'x' and el['outside'] == ('s' if sgn > 0 else 'n')) or
                                          (ax == 'z' and el['outside'] == ('e' if sgn > 0 else 'w'))):
                    for a_lo, a_hi in ((a0 - bw - .5, a0 - bw - .02), (a1 + bw + .02, a1 + bw + .5)):
                        b = [a_lo, bot - .06, lo_c, a_hi, top + .06, hi_c] if ax == 'x' else [lo_c, bot - .06, a_lo, hi_c, top + .06, a_hi]
                        yield _part(b, o['shutters'], 'trim', False)


# --- slabs, stairs, rails, posts -------------------------------------------------------------
def slab_parts(el):
    from collision_gen import subtract_all
    x0, z0, x1, z1 = el['rect']
    y0, y1 = el['y']
    holes = [[h[0], y0 - 1, h[1], h[2], y1 + 1, h[3]] for h in el.get('holes', [])]
    boxes = subtract_all([[x0, y0, z0, x1, y1, z1]], holes)
    mats = {'ny': el.get('under', el['mat'])}
    for b in boxes:
        yield _part(b, el['mat'], el.get('kind', 'slab'), True, mats, ())


def stair_steps(el):
    """(k, rect, top_y) for every step of a stairs element (step n tops out at y1)."""
    x0, z0, x1, z1 = el['rect']
    n = el['n']
    y0, y1 = el['y0'], el['y1']
    d = el['dir']
    length = (z1 - z0) if d in ('n', 's') else (x1 - x0)
    run = length / n
    for k in range(1, n + 1):
        lo, hi = run * (k - 1), run * k
        if d == 'n':
            r = (x0, z1 - hi, x1, z1 - lo)
        elif d == 's':
            r = (x0, z0 + lo, x1, z0 + hi)
        elif d == 'w':
            r = (x1 - hi, z0, x1 - lo, z1)
        else:
            r = (x0 + lo, z0, x0 + hi, z1)
        yield k, r, y0 + (y1 - y0) * k / n


def stair_parts(el):
    n = el['n']
    y0 = el['y0']
    guards = el.get('guard', [])
    x0, z0, x1, z1 = el['rect']
    d = el['dir']
    for k, r, top in stair_steps(el):
        yield _part([r[0], y0, r[1], r[2], top, r[3]], el['mat'], 'stair', True, {'py': el.get('tread', el['mat'])})
        for side in guards:
            t = .07
            # l/r are relative to the direction of ascent
            across = {('n', 'l'): 'w', ('n', 'r'): 'e', ('s', 'l'): 'e', ('s', 'r'): 'w',
                      ('e', 'l'): 'n', ('e', 'r'): 's', ('w', 'l'): 's', ('w', 'r'): 'n'}[(d, side)]
            if across == 'w':
                g = [r[0], top, r[1], r[0] + t, top + 1.0, r[3]]
            elif across == 'e':
                g = [r[2] - t, top, r[1], r[2], top + 1.0, r[3]]
            elif across == 'n':
                g = [r[0], top, r[1], r[2], top + 1.0, r[1] + t]
            else:
                g = [r[0], top, r[3] - t, r[2], top + 1.0, r[3]]
            yield _part(g, el.get('guard_mat', 'trim_brown'), 'guard', True)
    if el.get('rail'):
        yield from stair_rail_visual(el)


def stair_rail_visual(el):
    """Posts on the stair's open side (visual only; the stepped guards carry the collision)."""
    return []


def rail_parts(el):
    ax, az = el['a']
    bx, bz = el['b']
    y = el.get('y', 0.0)
    h = el.get('h', 1.05)
    mat = el.get('mat', 'wood_weathered')
    along_x = abs(bz - az) < EPS
    lo, hi = sorted((ax, bx)) if along_x else sorted((az, bz))
    line = az if along_x else ax
    gaps = sorted(el.get('gaps', []))
    spans, cur = [], lo
    for g0, g1 in gaps:
        if g0 - cur > EPS:
            spans.append((cur, g0))
        cur = g1
    if hi - cur > EPS:
        spans.append((cur, hi))
    t = .08

    def box(a0, a1, ya, yb, half):
        return [a0, ya, line - half, a1, yb, line + half] if along_x else [line - half, ya, a0, line + half, yb, a1]

    for a0, a1 in spans:
        yield _part(box(a0, a1, y, y + h, t / 2), mat, 'rail', True, {}, ())
        # posts every <= 1.8 m, two horizontal rails, all slightly proud of the collision body
        n = max(1, int(math.ceil((a1 - a0) / 1.8)))
        for i in range(n + 1):
            p = a0 + (a1 - a0) * i / n
            yield _part(box(p - .045, p + .045, y, y + h + .05, .075), mat, 'rail-post', False)
        for yy in (y + h - .1, y + h * .5):
            yield _part(box(a0, a1, yy, yy + .055, .05), mat, 'rail-bar', False)
    for g0, g1 in gaps:   # end posts either side of a drop-down gap
        for p in (g0, g1):
            yield _part(box(p - .06, p + .06, y, y + h + .08, .08), mat, 'rail-post', False)


def post_parts(el):
    x, z = el['at']
    s = el.get('size', .2) / 2
    y0, y1 = el['y']
    yield _part([x - s, y0, z - s, x + s, y1, z + s], el['mat'], el.get('kind', 'post'), el.get('solid', True))


def box_parts(el):
    yield _part(el['box'], el['mat'], el.get('kind', 'box'), el.get('solid', True), el.get('mats'), el.get('skip', ()))


def structure_parts(s):
    for el in s['elements']:
        t = el['t']
        if t == 'wall':
            yield from wall_parts(el)
        elif t == 'slab':
            yield from slab_parts(el)
        elif t == 'stairs':
            yield from stair_parts(el)
        elif t == 'rail':
            yield from rail_parts(el)
        elif t == 'post':
            yield from post_parts(el)
        elif t == 'box':
            yield from box_parts(el)


# --- roofs (visual only) ------------------------------------------------------------------------
def roof_mesh(md, el):
    """A gable or shed roof as closed slabs with fascia, gable fill and a ridge cap."""
    x0, z0, x1, z1 = el['rect']
    along = el['axis']          # the ridge runs along this axis
    o = el.get('over', .45)
    th = el.get('thick', .16)
    pitch = math.radians(el['pitch'])
    tp, cp = math.tan(pitch), math.cos(pitch)
    eave = el['eave']
    mat, under = el['mat'], el.get('under', el.get('gable', el['mat']))
    gable = el.get('gable', mat)
    # u across the ridge, v along it; world(u, y, v)
    if along == 'x':
        u0, u1, v0, v1 = z0, z1, x0, x1
        world = lambda u, y, v: (v, y, u)
    else:
        u0, u1, v0, v1 = x0, x1, z0, z1
        world = lambda u, y, v: (u, y, v)
    va, vb = v0 - o, v1 + o
    uc = (u0 + u1) / 2

    def slab(poly, fascia_out):
        """Extrude the (u, y) polygon along v: top/underside/end caps/fascia."""
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            if i == 1:      # ridge-side seam, hidden by the cap
                continue
            quad = [world(a[0], a[1], va), world(a[0], a[1], vb), world(b[0], b[1], vb), world(b[0], b[1], va)]
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            md.face_toward(quad, under if i == 2 else mat, _to3(world, _outward(poly, mid, a, b)))
        for v, sgn in ((va, -1), (vb, 1)):
            cap = [world(p[0], p[1], v) for p in poly]
            md.face_toward(cap, mat, _axis_vec(world, sgn))

    if el.get('kind', 'gable') == 'gable':
        hs = (u1 - u0) / 2 + o
        rise = hs * tp
        ridge = eave + rise
        d = th / cp
        left = [(uc - hs, eave), (uc, ridge), (uc, ridge - d), (uc - hs, eave - d)]
        right = [(uc + hs, eave), (uc, ridge), (uc, ridge - d), (uc + hs, eave - d)]
        slab(left, True)
        slab(right, True)
        # Ridge cap
        cap = el.get('cap', 'trim_brown')
        md.box(*(_wb(world, uc - .1, ridge - .02, va - .03) + _wb(world, uc + .1, ridge + .1, vb + .03)), cap)
        # Gable fill under the roof, flush with the wall ends
        half = (u1 - u0) / 2
        tri = [(u0, eave), (u1, eave), (uc, eave + half * tp)]
        for v, sgn in ((v0, -1), (v1, 1)):
            if el.get('ends', {'lo': True, 'hi': True}).get('lo' if sgn < 0 else 'hi', True):
                pts = [world(p[0], p[1], v) for p in tri]
                md.face_toward(pts, gable, _axis_vec(world, sgn))
    else:   # shed: slopes up toward `high`
        hi_side = el['high']
        # u runs across the slope; map the named side onto u (n/w are the low-coordinate sides)
        if (along == 'x' and hi_side in ('n', 's')) or (along == 'z' and hi_side in ('w', 'e')):
            span = (u1 - u0) + 2 * o
            rise = span * tp
            low_at_u0 = hi_side in ('s', 'e')
            ua, ub = u0 - o, u1 + o
            d = th / cp
            if low_at_u0:
                poly = [(ua, eave), (ub, eave + rise), (ub, eave + rise - d), (ua, eave - d)]
            else:
                poly = [(ub, eave), (ua, eave + rise), (ua, eave + rise - d), (ub, eave - d)]
            slab_shed(md, world, poly, va, vb, mat, under)


def slab_shed(md, world, poly, va, vb, mat, under):
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        quad = [world(a[0], a[1], va), world(a[0], a[1], vb), world(b[0], b[1], vb), world(b[0], b[1], va)]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        out = _outward(poly, mid, a, b)
        md.face_toward(quad, under if i == 2 else mat, _to3(world, out))
    for v, sgn in ((va, -1), (vb, 1)):
        md.face_toward([world(p[0], p[1], v) for p in poly], mat, _axis_vec(world, sgn))


def _outward(poly, mid, a, b):
    """Unit normal (u, y) of edge a->b pointing away from the polygon's centroid."""
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    ex, ey = b[0] - a[0], b[1] - a[1]
    nx, ny = ey, -ex
    if (mid[0] - cx) * nx + (mid[1] - cy) * ny < 0:
        nx, ny = -nx, -ny
    L = math.hypot(nx, ny) or 1
    return (nx / L, ny / L)


def _to3(world, n2):
    a = world(0, 0, 0)
    b = world(n2[0], n2[1], 0)
    return (b[0] - a[0], b[1] - a[1], b[2] - a[2])


def _axis_vec(world, sgn):
    a = world(0, 0, 0)
    b = world(0, 0, 1)
    return ((b[0] - a[0]) * sgn, (b[1] - a[1]) * sgn, (b[2] - a[2]) * sgn)


def _wb(world, u, y, v):
    p = world(u, y, v)
    return [p[0], p[1], p[2]]


def roof_box(world, ua, ya, va, ub, yb, vb):
    pa, pb = world(ua, ya, va), world(ub, yb, vb)
    return [min(pa[0], pb[0]), min(pa[1], pb[1]), min(pa[2], pb[2]), max(pa[0], pb[0]), max(pa[1], pb[1]), max(pa[2], pb[2])]


# --- fence ----------------------------------------------------------------------------------------
FENCE_H = 1.2
FENCE_T = 0.12


def fence_spans(f):
    """Solid spans [lo, hi] (along the fence axis) of one fence line, gaps removed."""
    (ax, az), (bx, bz) = f['a'], f['b']
    along_x = abs(bz - az) < EPS
    lo, hi = sorted((ax, bx)) if along_x else sorted((az, bz))
    cur, out = lo, []
    for g0, g1 in sorted(f.get('gaps', [])):
        if g0 - cur > EPS:
            out.append((cur, g0))
        cur = g1
    if hi - cur > EPS:
        out.append((cur, hi))
    return along_x, (az if along_x else ax), out


# --- aggregate ------------------------------------------------------------------------------------
def farm(layout):
    return layout.get('farm') or {'structures': [], 'fences': []}


def collision_boxes(layout):
    """[(aabb, tag)] of every solid part and the perimeter fence."""
    out = []
    for s in farm(layout)['structures']:
        for p in structure_parts(s):
            if p.solid:
                out.append((p.box, f"farm:{s['id']}:{p.kind}"))
    for f in farm(layout)['fences']:
        along_x, line, spans = fence_spans(f)
        for a0, a1 in spans:
            b = [a0, 0.0, line - FENCE_T / 2, a1, FENCE_H, line + FENCE_T / 2] if along_x else [line - FENCE_T / 2, 0.0, a0, line + FENCE_T / 2, FENCE_H, a1]
            out.append((b, f"farm:fence:{f['id']}"))
    return out


def footprints(layout):
    """Ground rects that structures occupy (spawn and dressing clearance)."""
    return [s['rect'] for s in farm(layout)['structures']]


def generate(layout):
    """MeshData of every structure (walls, slabs, stairs, rails, posts, roofs) and the fence."""
    from meshkit import MeshData
    md = MeshData()
    for s in farm(layout)['structures']:
        for p in structure_parts(s):
            # the underside of anything resting on the ground is never seen
            skip = p.skip + (('ny',) if p.box[1] <= 0.001 else ())
            md.box(*p.box, p.mat, skip=skip, mats=p.mats or None)
        for el in s['elements']:
            if el['t'] == 'roof':
                roof_mesh(md, el)
    fence_mesh(md, layout)
    poster_mesh(md, layout)
    return md


def posters(layout):
    return list(farm(layout).get('posters', []))


def poster_mesh(md, layout):
    """Pasted sheets from the shared posters_fun atlas (one material, no per-sheet texture)."""
    import underground
    for q in posters(layout):
        nx, nz = q['normal']
        rx, rz = nz, -nx
        w, h, y, x, z = q['w'], q['h'], q['y'], q['x'], q['z']
        pts = [(x - rx * w / 2, y, z - rz * w / 2), (x + rx * w / 2, y, z + rz * w / 2),
               (x + rx * w / 2, y + h, z + rz * w / 2), (x - rx * w / 2, y + h, z - rz * w / 2)]
        u0, v0, u1, v1 = underground.atlas_uv('poster', q['cell'])
        md.face_toward(pts, 'posters_fun', (nx, 0.0, nz), uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def fence_mesh(md, layout):
    for f in farm(layout)['fences']:
        along_x, line, spans = fence_spans(f)
        mat, post = f.get('mat', 'wood_weathered'), f.get('post', 'wood_dark')
        for a0, a1 in spans:
            n = max(1, int(round((a1 - a0) / 2.4)))
            for i in range(n + 1):
                p = a0 + (a1 - a0) * i / n
                end = i in (0, n)
                w = .085 if end else .065
                top = 1.32 if end else 1.22
                b = [p - w, 0, line - w, p + w, top, line + w] if along_x else [line - w, 0, p - w, line + w, top, p + w]
                md.box(*b, post, skip=('ny',))
            for yy in (.5, .92):
                # rails alternate faces so they read as nailed boards, not a solid wall
                for side in (-1, 1) if False else (1,):
                    b = [a0, yy, line - .07, a1, yy + .13, line + .07] if along_x else [line - .07, yy, a0, line + .07, yy + .13, a1]
                    md.box(*b, mat, skip=(('nx', 'px') if along_x else ('nz', 'pz')))
