"""Underground passages: town cellars and city pedestrian underpasses (pure Python, no bpy).

A passage is a set of axis-aligned clear rectangles at one floor level below the street
(`segments`), reached from the street by stair `entrances`. The same closed solids feed the
GLB export and the authoritative collision. The street-level ground slab stays solid above
the passage and is opened only over each stairwell, so a tunnel can run beneath streets,
squares and houses without changing what stands on top.

Entrance types (each in its own outer footprint `rect`, entered from `side`):
  dogleg    an enclosed stone portal: two flights of eight risers turning on a far landing.
            The passage leaves below the entry, from the second flight's half (`hand`).
  straight  an open stairwell of sixteen risers with guards on three sides; the passage
            continues beyond its far end.

Lighting is baked into vertex colours around authored lamps: the renderer's four-light
budget is already taken by the sun, the Chromebook ambient and the interior fixtures.
"""
from __future__ import annotations

import math

T = 0.3           # wall and slab thickness
FLOOR = -2.6      # walkable floor of every passage
CEIL = -0.3       # underside of the street slab above the passage
RISE = -FLOOR / 16
RUN = 0.3
EAVE = 2.6        # portal wall top above the street
LANDING = 0.6     # street-level landing inside an entrance before the first riser
BOTTOM = 1.2      # open landing at the foot of a straight stair, so a long gun clears the lintel

STYLES = {
    'cellar': {'wall': 'brick', 'floor': 'slabs', 'ceiling': 'plaster_worn', 'stair': 'stone_blocks',
               'portal': 'stone_blocks', 'roof': 'roof_tiles', 'trim': 'stone_trim', 'beam': 'wood_beam',
               'metal': 'iron', 'lamp': 'lantern_glass', 'pier': 'stone_blocks', 'base': .30},
    'metro': {'wall': 'facade_tiles_light', 'floor': 'pavers', 'ceiling': 'concrete_smooth_light', 'stair': 'granite',
              'portal': 'concrete_smooth_light', 'roof': 'concrete_floor', 'trim': 'concrete_trim', 'beam': None,
              'metal': 'aluminium', 'lamp': 'lamp_led', 'pier': 'concrete_smooth_light', 'base': .42},
}


# --- entrance frames ---------------------------------------------------------------------------
def frame(e):
    """Outer width W (across), length L (inward from the entry) and a local->world mapper."""
    x0, z0, x1, z1 = e['rect']
    side = e['side']
    if side in ('n', 's'):
        W, L = x1 - x0, z1 - z0
    else:
        W, L = z1 - z0, x1 - x0
    def world(u, y, v):
        if side == 's':
            return (x0 + u, y, z1 - v)
        if side == 'n':
            return (x1 - u, y, z0 + v)
        if side == 'e':
            return (x1 - v, y, z1 - u)
        return (x0 + v, y, z0 + u)
    return W, L, world


def local_box(world, b):
    a, c = world(b[0], b[1], b[2]), world(b[3], b[4], b[5])
    return [min(a[0], c[0]), min(a[1], c[1]), min(a[2], c[2]), max(a[0], c[0]), max(a[1], c[1]), max(a[2], c[2])]


def halves(e):
    W, _, _ = frame(e)
    left, right = (T, W / 2 - .1), (W / 2 + .1, W - T)
    return (left, right) if e.get('hand', 'left') == 'left' else (right, left)


def entrance_parts(e, style):
    """Yield (local box [u0,y0,v0,u1,y1,v1], material, part, visible-faces) for one entrance."""
    W, L, _ = frame(e)
    s = STYLES[style]
    if e['type'] == 'dogleg':
        (a0, a1), (b0, b1) = halves(e)
        d0, d1 = min(a1, b1), max(a0, b0)
        top = T + LANDING
        landing_v = top + 8 * RUN
        assert landing_v + 1.75 <= L - T, f"{e['id']}: dogleg portal too short for a 1.8 m turning landing"
        yield [a0, FLOOR, T, a1, 0, top], s['stair'], 'top-landing', 'top'
        for k in range(1, 9):
            yield [a0, FLOOR, top + (k - 1) * RUN, a1, -k * RISE, top + k * RUN], s['stair'], 'stair', 'stepA'
        yield [T, FLOOR, landing_v, W - T, -8 * RISE, L - T], s['stair'], 'turn-landing', 'landing'
        for k in range(1, 9):
            yield [b0, FLOOR - T, landing_v - k * RUN, b1, -(8 + k) * RISE, landing_v - (k - 1) * RUN], s['stair'], 'stair', 'stepB'
        yield [b0, FLOOR - T, 0, b1, FLOOR, top], s['floor'], 'bottom-landing', 'top'
        # The divider guards the 2.6 m drop between the flights and stops at the landing.
        yield [d0, FLOOR - T, T, d1, 1.0, landing_v], s['portal'], 'divider', 'all'
        walls = [[0, FLOOR - T, 0, T, EAVE, L], [W - T, FLOOR - T, 0, W, EAVE, L], [T, FLOOR - T, L - T, W - T, EAVE, L]]
        # Entry wall: open over the first flight at the street and over the second below it.
        # The tunnel opening reaches the floor slab: no sill piece under the landing.
        holes = [[a0, -.01, -.1, a1, 2.25, T + .1], [b0, FLOOR - T - .01, -.1, b1, CEIL, T + .1]]
        from collision_gen import subtract_all
        for b in subtract_all([[T, FLOOR - T, 0, W - T, EAVE, T]], holes):
            yield b, s['portal'], 'wall', 'all'
        for b in walls:
            yield b, s['portal'], 'wall', 'all'
        yield [-.12, EAVE, -.12, W + .12, EAVE + .22, L + .12], s['trim'], 'roof', 'roof'
    else:
        top = LANDING
        bottom = top + 16 * RUN
        assert abs(bottom + BOTTOM - L) < 1e-6, f"{e['id']}: straight entrance length must be {bottom + BOTTOM}"
        yield [T, FLOOR, 0, W - T, 0, top], s['stair'], 'top-landing', 'top'
        for k in range(1, 17):
            # Down to the floor slab: the last step's tread is the floor itself (no zero-height box).
            yield [T, FLOOR - T, top + (k - 1) * RUN, W - T, -k * RISE, top + k * RUN], s['stair'], 'stair', 'stepA'
        yield [T, FLOOR - T, bottom, W - T, FLOOR, L], s['floor'], 'bottom-landing', 'top'
        for u in (0, W - T):
            yield [u, FLOOR - T, 0, u + T, 0, L], s['wall'], 'wall', 'inner'
        # Street guards: two long sides and the far end above the continuing passage.
        guard = s['portal'] if style == 'cellar' else s['metal']
        for u in (0, W - T):
            yield [u, 0, 0, u + T, 1.0, L], guard, 'guard', 'guard'
        # The far guard also closes the street slab's edge above the passage mouth.
        yield [T, CEIL, L - T, W - T, 1.0, L], guard, 'guard', 'guard'


def entrance_opening(e):
    """Street ground removed over the stairwell (world AABB rect)."""
    W, L, world = frame(e)
    if e['type'] == 'dogleg':
        b = local_box(world, [T, 0, T, W - T, 0, L - T])
    else:
        b = local_box(world, [T, 0, LANDING, W - T, 0, L - T])
    return [b[0], b[2], b[3], b[5]]


def entrance_connector(e):
    """The passage-level opening where an entrance meets its segment (world rect)."""
    W, L, world = frame(e)
    if e['type'] == 'dogleg':
        _, (b0, b1) = halves(e)
        b = local_box(world, [b0, 0, -.6, b1, 0, .05])
    else:
        b = local_box(world, [T, 0, L - .05, W - T, 0, L + .6])
    return [b[0], b[2], b[3], b[5]]


def entrance_footprint(e):
    """Street-level area the entrance structure occupies (for dressing and spawn clearance)."""
    x0, z0, x1, z1 = e['rect']
    return [x0, z0, x1, z1]


def entrance_waypoints(e):
    """Walkable polyline from the street in front of the entry to the passage floor beyond."""
    W, L, world = frame(e)
    if e['type'] == 'dogleg':
        (a0, a1), (b0, b1) = halves(e)
        a, b = (a0 + a1) / 2, (b0 + b1) / 2
        # Turn just past the last step: a player carrying the longest gun keeps clear of the far wall.
        turn = T + LANDING + 8 * RUN + .35
        pts = [(a, 0, -1.2), (a, 0, T + .3), (a, -8 * RISE, turn), (b, -8 * RISE, turn), (b, FLOOR, T + .2), (b, FLOOR, -1.0)]
    else:
        c = W / 2
        pts = [(c, 0, -1.2), (c, 0, .3), (c, FLOOR, LANDING + 16 * RUN + .6), (c, FLOOR, L + 1.0)]
    return [[round(v, 4) for v in world(u, y, v)] for u, y, v in pts]


# --- passage boundary --------------------------------------------------------------------------
def boundary_edges(rects, openers):
    """Exposed edges of the union of `rects` (plus `openers` that only open walls).

    Returns (side, line, lo, hi) intervals: side is the outward direction of the wall."""
    every = list(rects) + list(openers)
    out = []
    for r in rects:
        x0, z0, x1, z1 = r
        for side, line, lo, hi in (('n', z0, x0, x1), ('s', z1, x0, x1), ('w', x0, z0, z1), ('e', x1, z0, z1)):
            covered = []
            for o in every:
                if o is r:
                    continue
                ox0, oz0, ox1, oz1 = o
                if side == 'n' and oz0 < line - 1e-6 and oz1 >= line - 1e-6:
                    covered.append((ox0, ox1))
                elif side == 's' and oz1 > line + 1e-6 and oz0 <= line + 1e-6:
                    covered.append((ox0, ox1))
                elif side == 'w' and ox0 < line - 1e-6 and ox1 >= line - 1e-6:
                    covered.append((oz0, oz1))
                elif side == 'e' and ox1 > line + 1e-6 and ox0 <= line + 1e-6:
                    covered.append((oz0, oz1))
            pieces = [(lo, hi)]
            for c0, c1 in covered:
                nxt = []
                for a, b in pieces:
                    if c1 <= a or c0 >= b:
                        nxt.append((a, b))
                        continue
                    if c0 > a:
                        nxt.append((a, c0))
                    if c1 < b:
                        nxt.append((c1, b))
                pieces = nxt
            out += [(side, line, a, b) for a, b in pieces if b - a > 1e-3]
    return out


def wall_box(side, line, a, b, y0, y1, inset=0.0):
    if side == 'n':
        return [a, y0, line - T, b, y1, line - inset]
    if side == 's':
        return [a, y0, line + inset, b, y1, line + T]
    if side == 'w':
        return [line - T, y0, a, line - inset, y1, b]
    return [line + inset, y0, a, line + T, y1, b]


def lamp_positions(p):
    """Wall lamps along each segment's longer walls, alternating sides, about 5 m apart."""
    lamps = []
    for r in p['segments']:
        x0, z0, x1, z1 = r
        along_x = x1 - x0 >= z1 - z0
        length = (x1 - x0) if along_x else (z1 - z0)
        n = max(1, int(length // 5))
        for i in range(n):
            t = (i + .5) / n
            if along_x:
                x, side = x0 + (x1 - x0) * t, i % 2
                lamps.append(((x, FLOOR + 1.95, z0 + .12) if side == 0 else (x, FLOOR + 1.95, z1 - .12), 's' if side == 0 else 'n'))
            else:
                z, side = z0 + (z1 - z0) * t, i % 2
                lamps.append(((x0 + .12, FLOOR + 1.95, z) if side == 0 else (x1 - .12, FLOOR + 1.95, z), 'e' if side == 0 else 'w'))
    return lamps


def passage_parts(p):
    """All solids for one passage: (world box [x0,y0,z0,x1,y1,z1], material, part)."""
    s = STYLES[p['style']]
    # An entrance's own walls close a segment edge that runs along its footprint (no second,
    # coplanar tunnel wall); its connector opens the edge where the stair meets the passage.
    openers = [entrance_connector(e) for e in p['entrances']] + [list(e['rect']) for e in p['entrances']]
    for r in p['segments']:
        x0, z0, x1, z1 = r
        yield [x0, FLOOR - T, z0, x1, FLOOR, z1], s['floor'], 'floor'
    for side, line, a, b in boundary_edges(p['segments'], openers):
        yield wall_box(side, line, a, b, FLOOR - T, 0.0), s['wall'], 'wall'
    for c in p.get('piers', []):
        x, z = c
        yield [x - .3, FLOOR, z - .3, x + .3, CEIL, z + .3], s['pier'], 'pier'
    for e in p['entrances']:
        _, _, world = frame(e)
        for b, mat, part, _ in entrance_parts(e, p['style']):
            yield local_box(world, b), mat, f"entrance-{part}"


def ground_holes(layout):
    """Volumes removed from the street ground slab (collision): passage interiors below the
    slab, and the full depth above each stairwell."""
    holes = []
    for p in layout.get('underground', []):
        for x0, z0, x1, z1 in p['segments']:
            holes.append([x0, -2.01, z0, x1, CEIL, z1])
        for e in p['entrances']:
            o = entrance_opening(e)
            holes.append([o[0], -2.01, o[1], o[2], .01, o[3]])
            holes.append(entrance_throat(e))
    return holes


def entrance_throat(e):
    """The passage-level gap through an entrance's end wall, where the stair's bottom landing
    meets its segment: the street slab must not close it from above."""
    W, L, world = frame(e)
    if e['type'] == 'dogleg':
        _, (b0, b1) = halves(e)
        return local_box(world, [b0, -2.01, -.05, b1, CEIL, T + .05])
    return local_box(world, [T, -2.01, L - T - .05, W - T, CEIL, L + .05])


def ground_openings(layout):
    """Street-level rects with no ground surface (terrain mesh)."""
    return [entrance_opening(e) for p in layout.get('underground', []) for e in p['entrances']]


def footprints(layout):
    return [entrance_footprint(e) for p in layout.get('underground', []) for e in p['entrances']]


def lowest_floor(layout):
    return min([FLOOR] if layout.get('underground') else [0.0])


def waypoints(p):
    """Through route: first entrance (street to floor), authored floor polyline, last entrance reversed."""
    first, last = p['entrances'][0], p['entrances'][-1]
    route = entrance_waypoints(first)
    route += [[x, FLOOR, z] for x, z in p.get('route', [])]
    route += list(reversed(entrance_waypoints(last)))
    return route


# --- visible mesh ------------------------------------------------------------------------------
def light_at(p, lamps):
    base = STYLES[p['style']]['base']
    def colour(pt):
        x, y, z = pt
        if y > -.05:
            return (1.0, 1.0, 1.0, 1.0)  # street-level portal masonry: ordinary daylight
        k = base
        for (lx, ly, lz), _ in lamps:
            d = math.sqrt((x - lx) ** 2 + (y - ly) ** 2 * .6 + (z - lz) ** 2)
            k += .78 * max(0.0, 1 - d / 4.2) ** 2
        # Daylight reaches a little way down each stairwell.
        for e in p['entrances']:
            o = entrance_opening(e)
            cx, cz = min(max(x, o[0]), o[2]), min(max(z, o[1]), o[3])
            d = math.hypot(x - cx, z - cz) + max(0.0, -y) * .45
            k += .55 * max(0.0, 1 - d / 3.2)
        k = max(.18, min(1.0, k))
        return (k, k * .97, k * .93, 1.0)
    return colour


def generate(p):
    """MeshData for one passage (walls, floors, ceilings, stairs, portals, lamps)."""
    from meshkit import MeshData
    s = STYLES[p['style']]
    lamps = lamp_positions(p)
    md = MeshData(color_fn=light_at(p, lamps))
    # An entrance's own walls close a segment edge that runs along its footprint (no second,
    # coplanar tunnel wall); its connector opens the edge where the stair meets the passage.
    openers = [entrance_connector(e) for e in p['entrances']] + [list(e['rect']) for e in p['entrances']]
    for x0, z0, x1, z1 in p['segments']:
        md.face([(x0, FLOOR, z0), (x0, FLOOR, z1), (x1, FLOOR, z1), (x1, FLOOR, z0)], s['floor'])
        md.face([(x0, CEIL, z0), (x1, CEIL, z0), (x1, CEIL, z1), (x0, CEIL, z1)], s['ceiling'])
        if s['beam']:
            along_x = x1 - x0 >= z1 - z0
            # Timber joists across the short span; above head height, no collision needed.
            span = (x1 - x0) if along_x else (z1 - z0)
            n = int(span // 1.25)
            for i in range(1, n + 1):
                t = i * span / (n + 1)
                if along_x:
                    md.box(x0 + t - .07, CEIL - .16, z0, x0 + t + .07, CEIL - .002, z1, s['beam'], skip=('py', 'nz', 'pz'))
                else:
                    md.box(x0, CEIL - .16, z0 + t - .07, x1, CEIL - .002, z0 + t + .07, s['beam'], skip=('py', 'nx', 'px'))
    for side, line, a, b in boundary_edges(p['segments'], openers):
        # Inner face only (normal toward the passage): the outside is buried.
        if side == 'n':
            md.face([(b, FLOOR, line), (b, CEIL, line), (a, CEIL, line), (a, FLOOR, line)], s['wall'])
        elif side == 's':
            md.face([(a, FLOOR, line), (a, CEIL, line), (b, CEIL, line), (b, FLOOR, line)], s['wall'])
        elif side == 'w':
            md.face([(line, FLOOR, a), (line, CEIL, a), (line, CEIL, b), (line, FLOOR, b)], s['wall'])
        else:
            md.face([(line, FLOOR, b), (line, CEIL, b), (line, CEIL, a), (line, FLOOR, a)], s['wall'])
        # A low plinth course where the wall meets the floor.
        y = FLOOR + .25
        if side == 'n':
            md.box(a, FLOOR, line, b, y, line + .04, s['trim'], skip=('ny', 'nz', 'nx', 'px'))
        elif side == 's':
            md.box(a, FLOOR, line - .04, b, y, line, s['trim'], skip=('ny', 'pz', 'nx', 'px'))
        elif side == 'w':
            md.box(line, FLOOR, a, line + .04, y, b, s['trim'], skip=('ny', 'nx', 'nz', 'pz'))
        else:
            md.box(line - .04, FLOOR, a, line, y, b, s['trim'], skip=('ny', 'px', 'nz', 'pz'))
    for x, z in p.get('piers', []):
        md.box(x - .3, FLOOR, z - .3, x + .3, CEIL, z + .3, s['pier'], skip=('ny', 'py'))
        md.box(x - .36, CEIL - .22, z - .36, x + .36, CEIL - .002, z + .36, s['trim'], skip=('py',))
    for (x, y, z), facing in lamps:
        ox, oz = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[facing]
        md.box(x - .06 - abs(oz) * .04, y + .26, z - .06 - abs(ox) * .04, x + .06 + abs(oz) * .04, y + .3, z + .06 + abs(ox) * .04, s['metal'])
        md.tube((x - ox * .1, y + .28, z - oz * .1), (x + ox * .1, y + .28, z + oz * .1), .012, s['metal'], segments=5)
        lx, lz = x + ox * .12, z + oz * .12
        if p['style'] == 'cellar':
            md.cylinder((lx, y + .02, lz), .085, .2, s['lamp'], segments=8)
            md.cylinder((lx, y + .22, lz), .11, .05, s['metal'], segments=8, radius_top=.04)
            md.cylinder((lx, y - .01, lz), .1, .03, s['metal'], segments=8)
        else:
            md.box(lx - .25 - abs(oz) * .0, y, lz - .05, lx + .25, y + .06, lz + .05, s['lamp']) if abs(oz) else \
                md.box(lx - .05, y, lz - .25, lx + .05, y + .06, lz + .25, s['lamp'])
    for e in p['entrances']:
        _entrance_mesh(md, e, p['style'])
    return md


def _entrance_mesh(md, e, style):
    s = STYLES[style]
    W, L, world = frame(e)

    def quad(pts, mat):
        md.face([world(*q) for q in pts], mat)

    def lbox(b, mat, skip=()):
        a = local_box(world, b)
        md.box(*a, mat, skip=skip)

    steps = [(b, mat, part, faces) for b, mat, part, faces in entrance_parts(e, style)]
    for b, mat, part, faces in steps:
        u0, y0, v0, u1, y1, v1 = b
        # A straight stair's top landing is the street surface itself (terrain owns that face).
        if faces in ('top', 'landing', 'stepA', 'stepB') and not (e['type'] == 'straight' and part == 'top-landing'):
            # Tread.
            quad([(u0, y1, v0), (u1, y1, v0), (u1, y1, v1), (u0, y1, v1)], mat)
        if faces == 'stepA':
            prev = y1 + RISE
            quad([(u1, y1, v0), (u0, y1, v0), (u0, prev, v0), (u1, prev, v0)], mat)
            md.box(*local_box(world, [u0, y1 - .04, v0 - .03, u1, y1 + .008, v0 + .03]), s['trim'], skip=('ny',))
        elif faces == 'stepB':
            prev = y1 + RISE
            quad([(u0, y1, v1), (u1, y1, v1), (u1, prev, v1), (u0, prev, v1)], mat)
            md.box(*local_box(world, [u0, y1 - .04, v1 - .03, u1, y1 + .008, v1 + .03]), s['trim'], skip=('ny',))
        elif faces == 'landing':
            # Riser down to the second flight's first step (dogleg only).
            (b0, b1) = halves(e)[1]
            quad([(b0, y1 - RISE, v0), (b1, y1 - RISE, v0), (b1, y1, v0), (b0, y1, v0)], mat)
        elif faces == 'all':
            lbox(b, mat, skip=('ny',))
        elif faces == 'inner':
            lbox([b[0], b[1], b[2], b[3], b[4], b[5]], mat, skip=('ny', 'py'))
        elif faces == 'guard':
            if style == 'cellar':
                lbox(b, mat, skip=('ny',))
                lbox([b[0] - .04, b[4], b[2] - .04, b[3] + .04, b[4] + .07, b[5] + .04], s['trim'], skip=('ny',))
        elif faces == 'roof':
            _portal_roof(md, world, W, L, s)
    if e['type'] == 'straight':
        for u in (T + .06, W - T - .06):
            # Wall-mounted handrails follow the flight; posts carry the street guard rails.
            md.tube(world(u, .9, LANDING), world(u, .9 + FLOOR, LANDING + 15 * RUN), .025, s['metal'], segments=6)
        if style != 'cellar':
            for b, mat, part, faces in steps:
                if faces != 'guard':
                    continue
                u0, y0, v0, u1, y1, v1 = b
                c = (u0 + u1) / 2 if u1 - u0 < v1 - v0 else None
                if c is not None:
                    md.tube(world(c, 1.0, v0), world(c, 1.0, v1), .03, s['metal'], segments=6)
                    md.tube(world(c, .5, v0), world(c, .5, v1), .018, s['metal'], segments=5)
                    n = max(2, int((v1 - v0) / 1.2))
                    for i in range(n + 1):
                        v = v0 + .05 + (v1 - v0 - .1) * i / n
                        md.tube(world(c, 0, v), world(c, 1.0, v), .025, s['metal'], segments=6)
                else:
                    c = (v0 + v1) / 2
                    md.tube(world(u0, 1.0, c), world(u1, 1.0, c), .03, s['metal'], segments=6)
                    md.tube(world(u0, .5, c), world(u1, .5, c), .018, s['metal'], segments=5)
                    for u in (u0 + .05, (u0 + u1) / 2, u1 - .05):
                        md.tube(world(u, 0, c), world(u, 1.0, c), .025, s['metal'], segments=6)
    else:
        # Lantern bracket above the entry and a timber lintel over the opening.
        (a0, a1), _ = halves(e)
        md.box(*local_box(world, [a0 - .05, 2.25, -.06, a1 + .05, 2.45, T + .02]), s['beam'] or s['trim'])
        c = (a0 + a1) / 2
        md.cylinder(world(c, 2.62, -.18), .08, .18, s['lamp'], segments=8)
        md.cylinder(world(c, 2.8, -.18), .1, .05, s['metal'], segments=8, radius_top=.04)
        md.tube(world(c, 2.84, -.18), world(c, 2.84, .02), .015, s['metal'], segments=5)


def _portal_roof(md, world, W, L, s):
    """A shallow gable over the portal; the ridge runs along the stair."""
    o = .18
    e0, ridge = EAVE + .22, EAVE + .22 + W * .3
    pts = {
        'l0': (-o, e0, -o), 'l1': (-o, e0, L + o), 'r0': (W + o, e0, -o), 'r1': (W + o, e0, L + o),
        'k0': (W / 2, ridge, -o), 'k1': (W / 2, ridge, L + o),
    }
    P = {k: world(*v) for k, v in pts.items()}
    for a, b, c, d in (('l0', 'l1', 'k1', 'k0'), ('r1', 'r0', 'k0', 'k1')):
        quad = [P[a], P[b], P[c], P[d]]
        # Orient upward.
        from meshkit import face_normal
        if face_normal(quad)[1] < 0:
            quad = list(reversed(quad))
        md.face(quad, s['roof'])
    # Soffit and gable infill (closed: no sky through the portal roof).
    for v, a, b in ((-o, 'l0', 'r0'), (L + o, 'l1', 'r1')):
        tri = [P[a], P[b], P['k0' if v < 0 else 'k1']]
        from meshkit import face_normal
        outward = world(W / 2, e0, -1 if v < 0 else L + 1)
        cen = [sum(p[i] for p in tri) / 3 for i in range(3)]
        n = face_normal(tri)
        if (outward[0] - cen[0]) * n[0] + (outward[2] - cen[2]) * n[2] < 0:
            tri = list(reversed(tri))
        md.face(tri, s['portal'])
    under = [world(-o, e0, -o), world(W + o, e0, -o), world(W + o, e0, L + o), world(-o, e0, L + o)]
    from meshkit import face_normal
    if face_normal(under)[1] > 0:
        under = list(reversed(under))
    md.face(under, s['trim'])
    rim = local_box(world, [-o, EAVE, -o, W + o, e0, L + o])
    md.box(*rim, s['trim'], skip=('py',))
