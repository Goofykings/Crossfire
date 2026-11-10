"""Underground passages: town cellars and the city metro station (pure Python, no bpy).

A passage is a set of axis-aligned clear rectangles at one floor level below the street
(`segments`), reached from the street by stair `entrances`. The same closed solids feed the
GLB export and the authoritative collision. The street-level ground slab stays solid above
the passage and is opened only over each stairwell, so a tunnel can run beneath streets,
squares and houses without changing what stands on top.

Each style owns its depth: `floor` and the number of `risers` (so riser height stays near
0.175 m) come from STYLES; `prepare(p)` copies them onto the passage and every entrance, and
all geometry below reads them from there. The ceiling is always the underside of the street
slab, so a deeper floor is also a taller room (metro 3.9 m, cellar 3.2 m clear).

Entrance types (each in its own outer footprint `rect`, entered from `side`):
  dogleg    an enclosed stone portal: two flights of risers/2 turning on a far landing.
            The passage leaves below the entry, from the second flight's half (`hand`).
  straight  an open stairwell of `risers` steps with guards on three sides; the passage
            continues beyond its far end.

Interior furnishing (all optional, authored in tools/compact_layouts.py):
  piers   [x, z] or [x, z, size]: floor-to-ceiling columns with base and capital.
  blocks  solids inside the room: {rect, h, kind} (ticket gates, a kiosk, a cistern tank,
          partitions...). They are real collision boxes (tag `block` / `partition`).
  decor   wall, pier and block art (signs, posters, route maps) and utility doors, placed
          on actual surfaces and validated (nothing floats or crosses an opening).
  props   catalog props standing on the floor (benches, bins, vending machines...).

Lighting is baked into vertex colours around authored lamps: the renderer's four-light
budget is already taken by the sun, the Chromebook ambient and the interior fixtures.
"""
from __future__ import annotations

import math

T = 0.3           # wall and slab thickness
CEIL = -0.3       # underside of the street slab above the passage
EAVE = 2.6        # portal wall top above the street
LANDING = 0.6     # street-level landing inside an entrance before the first riser
BOTTOM = 1.2      # open landing at the foot of a straight stair, so a long gun clears the lintel

STYLES = {
    'cellar': {'wall': 'brick', 'floor': 'slabs', 'ceiling': 'plaster_worn', 'stair': 'stone_blocks',
               'portal': 'stone_blocks', 'roof': 'roof_tiles', 'trim': 'stone_trim', 'beam': 'wood_beam',
               'metal': 'iron', 'lamp': 'lantern_glass', 'pier': 'stone_blocks', 'base': .30,
               'floor_y': -3.5, 'risers': 20, 'run': .24, 'pier_size': .72, 'accent': 'stone_trim', 'door': 'wood_door'},
    # Farmstead storm shelter: poured concrete, a fieldstone portal under tin, timber joists, caged bulb lamps.
    'farm': {'wall': 'concrete_wall_stained', 'floor': 'concrete_floor', 'ceiling': 'concrete_wall', 'stair': 'concrete_floor',
             'portal': 'stone_stacked', 'roof': 'roof_barn', 'trim': 'trim_brown', 'beam': 'wood_beam',
             'metal': 'iron', 'lamp': 'lantern_glass', 'pier': 'concrete_wall', 'base': .19,
             'floor_y': -3.5, 'risers': 20, 'run': .24, 'pier_size': .72, 'accent': 'trim_brown', 'door': 'wood_door'},
    'metro': {'wall': 'facade_tiles_light', 'floor': 'pavers', 'ceiling': 'concrete_smooth_light', 'stair': 'granite',
              'portal': 'concrete_smooth_light', 'roof': 'concrete_floor', 'trim': 'concrete_trim', 'beam': None,
              'metal': 'aluminium', 'lamp': 'lamp_led', 'pier': 'facade_tiles_light', 'base': .72,
              'floor_y': -3.8, 'risers': 22, 'run': .28, 'pier_size': .8, 'accent': 'plastic_blue', 'door': 'steel_dark'},
}

# Texture atlases for wall art (cell grids; v grows upward, so row 0 is the top of the image).
ATLASES = {
    'signs': {'material': 'underground_signs', 'cols': 4, 'rows': 8},
    'poster': {'material': 'posters_fun', 'cols': 4, 'rows': 3},
}


def atlas_uv(art: str, cell: int, span: tuple[int, int] = (1, 1)):
    """UV rectangle (u0, v0, u1, v1) of a cell (or a span of cells) in an art atlas."""
    a = ATLASES[art]
    col, row = cell % a['cols'], cell // a['cols']
    return (col / a['cols'], 1 - (row + span[1]) / a['rows'], (col + span[0]) / a['cols'], 1 - row / a['rows'])


def prepare(p):
    """The passage as the layout stores it: depth fields copied onto passage and entrances."""
    s = STYLES[p['style']]
    out = {**p, 'floor': s['floor_y'], 'ceiling': CEIL}
    out['entrances'] = [{**e, 'floor': s['floor_y'], 'risers': s['risers'], 'run': s['run'], 'style': p['style']} for e in p['entrances']]
    xs = [v for r in list(p['segments']) + [e['rect'] for e in p['entrances']] for v in (r[0], r[2])]
    zs = [v for r in list(p['segments']) + [e['rect'] for e in p['entrances']] for v in (r[1], r[3])]
    out['rect'] = [min(xs), min(zs), max(xs), max(zs)]
    out['waypoints'] = waypoints(out)
    return out


def floor_of(e_or_p) -> float:
    return e_or_p['floor']


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


def stair_dims(e):
    """(floor, risers, riser height, risers per flight for a dogleg)."""
    fl, n = e['floor'], e['risers']
    return fl, n, -fl / n, n // 2


def dogleg_length(e):
    """Shortest portal length that fits both flights and a 1.8 m turning landing."""
    _, n, _, half = stair_dims(e)
    return T + LANDING + half * e['run'] + 1.75 + T


def entrance_parts(e, style):
    """Yield (local box [u0,y0,v0,u1,y1,v1], material, part, visible-faces) for one entrance."""
    W, L, _ = frame(e)
    s = STYLES[style]
    fl, n, rise, half = stair_dims(e)
    RUN = e['run']
    if e['type'] == 'dogleg':
        (a0, a1), (b0, b1) = halves(e)
        d0, d1 = min(a1, b1), max(a0, b0)
        top = T + LANDING
        landing_v = top + half * RUN
        assert landing_v + 1.75 <= L - T + 1e-9, f"{e['id']}: dogleg portal needs length {dogleg_length(e):.2f} m (has {L:.2f})"
        yield [a0, fl, T, a1, 0, top], s['stair'], 'top-landing', 'top'
        for k in range(1, half + 1):
            yield [a0, fl, top + (k - 1) * RUN, a1, -k * rise, top + k * RUN], s['stair'], 'stair', 'stepA'
        yield [T, fl, landing_v, W - T, -half * rise, L - T], s['stair'], 'turn-landing', 'landing'
        for k in range(1, half + 1):
            yield [b0, fl - T, landing_v - k * RUN, b1, -(half + k) * rise, landing_v - (k - 1) * RUN], s['stair'], 'stair', 'stepB'
        yield [b0, fl - T, 0, b1, fl, top], s['floor'], 'bottom-landing', 'top'
        # The divider guards the drop between the flights and stops at the landing.
        yield [d0, fl - T, T, d1, 1.0, landing_v], s['portal'], 'divider', 'all'
        walls = [[0, fl - T, 0, T, EAVE, L], [W - T, fl - T, 0, W, EAVE, L], [T, fl - T, L - T, W - T, EAVE, L]]
        # Entry wall: open over the first flight at the street and over the second below it.
        # The tunnel opening reaches the floor slab: no sill piece under the landing.
        holes = [[a0, -.01, -.1, a1, 2.25, T + .1], [b0, fl - T - .01, -.1, b1, CEIL, T + .1]]
        from collision_gen import subtract_all
        for b in subtract_all([[T, fl - T, 0, W - T, EAVE, T]], holes):
            yield b, s['portal'], 'wall', 'all'
        for b in walls:
            yield b, s['portal'], 'wall', 'all'
        yield [-.12, EAVE, -.12, W + .12, EAVE + .22, L + .12], s['trim'], 'roof', 'roof'
    else:
        top = LANDING
        bottom = top + n * RUN
        assert abs(bottom + BOTTOM - L) < 1e-6, f"{e['id']}: straight entrance length must be {bottom + BOTTOM}"
        yield [T, fl, 0, W - T, 0, top], s['stair'], 'top-landing', 'top'
        for k in range(1, n + 1):
            # Down to the floor slab: the last step's tread is the floor itself (no zero-height box).
            yield [T, fl - T, top + (k - 1) * RUN, W - T, -k * rise, top + k * RUN], s['stair'], 'stair', 'stepA'
        yield [T, fl - T, bottom, W - T, fl, L], s['floor'], 'bottom-landing', 'top'
        for u in (0, W - T):
            yield [u, fl - T, 0, u + T, 0, L], s['wall'], 'wall', 'inner'
        # Street guards: two long sides and the far end above the continuing passage.
        guard = e.get('guard') or (s['portal'] if style in ('cellar', 'farm') else s['metal'])
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
    fl, n, rise, half = stair_dims(e)
    RUN = e['run']
    if e['type'] == 'dogleg':
        (a0, a1), (b0, b1) = halves(e)
        a, b = (a0 + a1) / 2, (b0 + b1) / 2
        # Turn just past the last step: a player carrying the longest gun keeps clear of the far wall.
        turn = T + LANDING + half * RUN + .35
        pts = [(a, 0, -1.2), (a, 0, T + .3), (a, -half * rise, turn), (b, -half * rise, turn), (b, fl, T + .2), (b, fl, -1.0)]
    else:
        c = W / 2
        pts = [(c, 0, -1.2), (c, 0, .3), (c, fl, LANDING + n * RUN + .6), (c, fl, L + 1.0)]
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


def openers(p):
    # An entrance's own walls close a segment edge that runs along its footprint (no second,
    # coplanar tunnel wall); its connector opens the edge where the stair meets the passage.
    return [entrance_connector(e) for e in p['entrances']] + [list(e['rect']) for e in p['entrances']]


def edges(p):
    return boundary_edges(p['segments'], openers(p))


# --- furnishing --------------------------------------------------------------------------------
def pier_list(p):
    s = STYLES[p['style']]
    return [(q[0], q[1], q[2] if len(q) > 2 else s['pier_size']) for q in p.get('piers', [])]


def block_list(p):
    """Blocks with defaults filled in: rect, h (height above the floor), kind, material."""
    out = []
    for b in p.get('blocks', []):
        out.append({'rect': list(b['rect']), 'h': b.get('h', 1.1), 'kind': b.get('kind', 'block'),
                    'part': 'partition' if b.get('kind') == 'partition' else 'block'})
    return out


def lamp_positions(p):
    """Light fixtures: ((x, y, z), facing). Wall lamps (facing n/s/e/w) sit along each segment's
    longer walls about 5 m apart; ceiling fixtures (facing 'd', long axis in the 4th item) form a
    grid under the slab in the metro."""
    fl = STYLES[p['style']]['floor_y']
    lamps = []
    if p['style'] == 'metro':
        for r in p['segments']:
            x0, z0, x1, z1 = r
            w, d = x1 - x0, z1 - z0
            nx, nz = max(1, int(w // 4.2)), max(1, int(d // 3.4))
            for i in range(nx):
                for j in range(nz):
                    x, z = x0 + (i + .5) * w / nx, z0 + (j + .5) * d / nz
                    lamps.append(((x, CEIL - .14, z), 'd'))
        return lamps
    for r in p['segments']:
        x0, z0, x1, z1 = r
        along_x = x1 - x0 >= z1 - z0
        length = (x1 - x0) if along_x else (z1 - z0)
        n = max(1, int(length // 5))
        for i in range(n):
            t = (i + .5) / n
            y = fl + 1.95
            if along_x:
                x, side = x0 + (x1 - x0) * t, i % 2
                lamps.append(((x, y, z0 + .12) if side == 0 else (x, y, z1 - .12), 's' if side == 0 else 'n'))
            else:
                z, side = z0 + (z1 - z0) * t, i % 2
                lamps.append(((x0 + .12, y, z) if side == 0 else (x1 - .12, y, z), 'e' if side == 0 else 'w'))
    return lamps


def passage_parts(p):
    """All solids for one passage: (world box [x0,y0,z0,x1,y1,z1], material, part)."""
    s = STYLES[p['style']]
    fl = p['floor']
    for r in p['segments']:
        x0, z0, x1, z1 = r
        yield [x0, fl - T, z0, x1, fl, z1], s['floor'], 'floor'
    for side, line, a, b in edges(p):
        yield wall_box(side, line, a, b, fl - T, 0.0), s['wall'], 'wall'
    for x, z, size in pier_list(p):
        yield [x - size / 2, fl, z - size / 2, x + size / 2, CEIL, z + size / 2], s['pier'], 'pier'
    for b in block_list(p):
        x0, z0, x1, z1 = b['rect']
        yield [x0, fl, z0, x1, fl + b['h'], z1], s['trim'], b['part']
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
    return min([p['floor'] for p in layout.get('underground', [])] or [0.0])


def waypoints(p):
    """Through route: first entrance (street to floor), authored floor polyline, last entrance reversed."""
    first, last = p['entrances'][0], p['entrances'][-1]
    fl = p['floor']
    route = entrance_waypoints(first)
    route += [[x, fl, z] for x, z in p.get('route', [])]
    route += list(reversed(entrance_waypoints(last)))
    return route


# --- decor -------------------------------------------------------------------------------------
NORMALS = {'n': (0, 1), 's': (0, -1), 'w': (1, 0), 'e': (-1, 0)}  # room-side normal of a wall on that side


def _surface(p, item):
    """(origin x, z of the item's centre on its surface, room-side normal (nx, nz), half span
    available along the surface, wall interval) for a decor item. Raises if the host is wrong."""
    host = item.get('host', 'wall')
    if host == 'wall':
        side, pos = item['side'], item['pos']
        cands = [(s, line, a, b) for s, line, a, b in edges(p) if s == side and a + .1 <= pos - item['w'] / 2 and pos + item['w'] / 2 <= b - .1
                 and ('line' not in item or abs(line - item['line']) < 1e-6)]
        if len(cands) != 1:
            raise ValueError(f"{p['id']}: decor {item} fits {len(cands)} wall edges (need exactly 1)")
        _, line, a, b = cands[0]
        nx, nz = NORMALS[side]
        return ((pos, line) if side in 'ns' else (line, pos)), (nx, nz)
    if host == 'pier':
        x, z, size = pier_list(p)[item['index']]
        nx, nz = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[item['face']]
        if item['w'] > size - .06:
            raise ValueError(f"{p['id']}: decor {item} wider than its pier")
        return (x + nx * size / 2, z + nz * size / 2), (nx, nz)
    b = block_list(p)[item['index']]['rect']
    nx, nz = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[item['face']]
    cx, cz = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return ((cx if nx == 0 else (b[2] if nx > 0 else b[0])), (cz if nz == 0 else (b[3] if nz > 0 else b[1]))), (nx, nz)


def decor_quads(p):
    """Every decor item as (corners [4 points, bottom-left first as seen by a viewer], normal, item)."""
    out = []
    fl = p['floor']
    for item in p.get('decor', []):
        (x, z), (nx, nz) = _surface(p, item)
        # A viewer in the room looks against the normal; their right-hand side is (nz, -nx).
        rx, rz = nz, -nx
        off = item.get('off', .012)
        cx, cz = x + nx * off, z + nz * off
        w, h, y = item['w'], item['h'], fl + item['y']
        assert fl + .02 <= y - h / 2 and y + h / 2 <= CEIL - .02, f"{p['id']}: decor {item} leaves the wall"
        pts = [(cx - rx * w / 2, y - h / 2, cz - rz * w / 2), (cx + rx * w / 2, y - h / 2, cz + rz * w / 2),
               (cx + rx * w / 2, y + h / 2, cz + rz * w / 2), (cx - rx * w / 2, y + h / 2, cz - rz * w / 2)]
        out.append((pts, (nx, 0.0, nz), item))
    return out


def decor_items_overlap(p):
    """Pairs of decor items on the same surface that overlap (a test and generator guard)."""
    quads = decor_quads(p)
    bad = []
    for i, (a, na, ia) in enumerate(quads):
        for b, nb, ib in quads[i + 1:]:
            if na != nb:
                continue
            xs_a, xs_b = [q[0] for q in a], [q[0] for q in b]
            zs_a, zs_b = [q[2] for q in a], [q[2] for q in b]
            ys_a, ys_b = [q[1] for q in a], [q[1] for q in b]
            if (min(xs_a) < max(xs_b) - 1e-6 and min(xs_b) < max(xs_a) - 1e-6 and min(zs_a) < max(zs_b) - 1e-6
                    and min(zs_b) < max(zs_a) - 1e-6 and min(ys_a) < max(ys_b) - 1e-6 and min(ys_b) < max(ys_a) - 1e-6):
                # Same wall plane only (equal offset along the normal).
                if abs((a[0][0] - b[0][0]) * na[0] + (a[0][2] - b[0][2]) * na[2]) < 1e-6:
                    bad.append((ia, ib))
    return bad


# --- farm shelter atmosphere (2026-11): hanging chain lamps, grime and puddles -----------------------------------
# Baked like every other passage (vertex colours, no scene lights), but with an uneven pattern: lamps hang from the joists
# on short chains, a few are dead, some are cold, and the concrete is darker and stained. Puddles are low irregular
# polygons (material `puddle`, reflective at higher presets in src/rendering/PuddleReflections.ts) inside a darker
# `concrete_wet` halo; neither has collision.
import random as _random


def _hash(ix, iz, seed):
    n = (ix * 374761393 + iz * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def _vnoise(x, z, seed=0):
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    fx, fz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a, b = _hash(ix, iz, seed), _hash(ix + 1, iz, seed)
    c, d = _hash(ix, iz + 1, seed), _hash(ix + 1, iz + 1, seed)
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz


def _in_rects(x, z, rects, m=0.0):
    return any(r[0] - m < x < r[2] + m and r[1] - m < z < r[3] + m for r in rects)


def _joists(r):
    """Axis and positions of the timber joists of one segment (see generate): they run across the long axis."""
    x0, z0, x1, z1 = r
    along_x = x1 - x0 >= z1 - z0
    span = (x1 - x0) if along_x else (z1 - z0)
    n = int(span // 1.25)
    base = x0 if along_x else z0
    return ('x' if along_x else 'z'), [base + i * span / (n + 1) for i in range(1, n + 1)]


def farm_lamps(p):
    """Hanging lamps: dicts {pos (x, z), top (attachment y), kind warm|cold|dead, k (brightness), chain (m)}. Rooms get a loose
    grid about 5.4 m apart, tunnels a lamp every ~4.6 m on the centre line; each snaps to a joist and keeps clear of piers."""
    rnd = _random.Random(2611)
    piers = [(q[0], q[1]) for q in p.get('piers', [])]
    pts = []
    for r in p['segments']:
        x0, z0, x1, z1 = r
        w, d = x1 - x0, z1 - z0
        along_x = w >= d
        long, short = (w, d) if along_x else (d, w)
        if short < 3.2:
            n = max(1, round(long / 4.6))
            for i in range(n):
                t = (i + .5) / n * long
                pts.append((x0 + t, (z0 + z1) / 2, r) if along_x else ((x0 + x1) / 2, z0 + t, r))
        else:
            nl, ns = max(1, round(long / 5.4)), max(1, round(short / 5.4))
            for i in range(nl):
                for j in range(ns):
                    a, b = (i + .5) / nl * long, (j + .5) / ns * short
                    jit = (rnd.uniform(-.55, .55), rnd.uniform(-.55, .55))
                    pts.append((x0 + a + jit[0], z0 + b + jit[1], r) if along_x else (x0 + b + jit[1], z0 + a + jit[0], r))
    lamps = []
    for x, z, r in pts:
        axis, js = _joists(r)
        if js:
            if axis == 'x':
                x = min(js, key=lambda v: abs(v - x))
            else:
                z = min(js, key=lambda v: abs(v - z))
        top = CEIL - (.162 if js else .0)
        if any(math.hypot(x - q[0], z - q[1]) < .8 for q in piers) or any(math.hypot(x - l['pos'][0], z - l['pos'][1]) < 2.6 for l in lamps):
            continue
        roll = rnd.random()
        kind = 'dead' if roll < .13 else 'cold' if roll < .38 else 'warm'
        lamps.append({'pos': (round(x, 3), round(z, 3)), 'top': top, 'kind': kind, 'k': rnd.uniform(.82, 1.18), 'chain': rnd.uniform(.36, .5)})
    return lamps


def lamp_bulb_y(l):
    return l['top'] - .022 - l['chain'] - .155


def farm_puddles(p):
    """Irregular puddles: dicts {c (x, z), pts [(x, z)...], r}. Placed on the open floor, never under a pier, block or prop,
    never in a stair's foot, and kept apart (small satellites excepted)."""
    rnd = _random.Random(1103)
    segs = list(p['segments'])
    keep_out = [[q[0] - q[2] / 2 - .25, q[1] - q[2] / 2 - .25, q[0] + q[2] / 2 + .25, q[1] + q[2] / 2 + .25] for q in pier_list(p)]
    keep_out += [[b['rect'][0] - .35, b['rect'][1] - .35, b['rect'][2] + .35, b['rect'][3] + .35] for b in block_list(p)]
    keep_out += [[r[0] - .15, r[1] - .15, r[2] + .15, r[3] + .15] for r in p.get('propRects', [])]
    keep_out += [[o[0] - 1.6, o[1] - 1.6, o[2] + 1.6, o[3] + 1.6] for o in (entrance_opening(e) for e in p['entrances'])]
    keep_out += [[o[0] - 1.6, o[1] - 1.6, o[2] + 1.6, o[3] + 1.6] for o in (entrance_connector(e) for e in p['entrances'])]
    floor_rects = [[r[0] + .22, r[1] + .22, r[2] - .22, r[3] - .22] for r in segs]
    areas = [(r[2] - r[0]) * (r[3] - r[1]) for r in segs]

    def shape(cx, cz, r0):
        k = rnd.randint(18, 24)
        ph = [rnd.uniform(0, 6.28) for _ in range(3)]
        amp = (rnd.uniform(.14, .28), rnd.uniform(.08, .17), rnd.uniform(.04, .1))
        sx = rnd.uniform(.85, 1.6)
        rot = rnd.uniform(0, math.pi)
        out = []
        for i in range(k):
            a = 2 * math.pi * i / k
            rr = r0 * (1 + amp[0] * math.sin(2 * a + ph[0]) + amp[1] * math.sin(3 * a + ph[1]) + amp[2] * math.sin(5 * a + ph[2]))
            x, z = math.cos(a) * rr * sx, math.sin(a) * rr
            out.append((cx + x * math.cos(rot) - z * math.sin(rot), cz + x * math.sin(rot) + z * math.cos(rot)))
        return out

    def valid(pts):
        return all(_in_rects(x, z, floor_rects) and not _in_rects(x, z, keep_out) for x, z in pts)

    out = []
    tries = 0
    while len(out) < 30 and tries < 900:
        tries += 1
        seg = rnd.choices(segs, weights=areas)[0]
        x0, z0, x1, z1 = seg
        near_wall = rnd.random() < .4
        cx, cz = rnd.uniform(x0 + .9, x1 - .9), rnd.uniform(z0 + .9, z1 - .9)
        if near_wall:
            side = rnd.choice('nsew')
            cx, cz = {'n': (cx, z0 + rnd.uniform(.6, 1.1)), 's': (cx, z1 - rnd.uniform(.6, 1.1)),
                      'w': (x0 + rnd.uniform(.6, 1.1), cz), 'e': (x1 - rnd.uniform(.6, 1.1), cz)}[side]
        r0 = rnd.choice((.34, .42, .5, .6, .75, .9)) * (.8 if near_wall else 1.0)
        pts = shape(cx, cz, r0)
        if not valid(pts) or any(math.hypot(cx - o['c'][0], cz - o['c'][1]) < o['r'] * 1.9 + r0 * 1.9 + .6 for o in out):
            continue
        out.append({'c': (cx, cz), 'pts': pts, 'r': r0})
        for _ in range(rnd.choice((0, 1, 1, 2))):
            a = rnd.uniform(0, 6.28)
            d = r0 * rnd.uniform(1.7, 2.4)
            sx, sz = cx + math.cos(a) * d, cz + math.sin(a) * d
            r1 = rnd.uniform(.1, .2)
            sp = shape(sx, sz, r1)
            if valid(sp) and not any(math.hypot(sx - o['c'][0], sz - o['c'][1]) < o['r'] * 1.5 + r1 + .1 for o in out[:-1]):
                out.append({'c': (sx, sz), 'pts': sp, 'r': r1, 'satellite': True})
    return out


def light_farm(p, lamps, puddles):
    """Vertex colour of a point of the shelter: dark damp concrete, uneven stains, warm and cold lamp pools, daylight in the stairs."""
    base = STYLES[p['style']]['base']
    fl = p['floor']
    live = [(l['pos'][0], lamp_bulb_y(l), l['pos'][1], l['k'], l['kind']) for l in lamps if l['kind'] != 'dead']
    tints = {'warm': (1.0, .76, .46), 'cold': (.7, .86, 1.0)}
    wet = [(q['c'][0], q['c'][1], q['r']) for q in puddles if not q.get('satellite')]
    entrances = [entrance_opening(e) for e in p['entrances']]

    def colour(pt):
        x, y, z = pt
        if y > -.05:
            return (1.0, 1.0, 1.0, 1.0)  # street-level portal masonry: ordinary daylight
        h = y - fl                        # height above the floor
        # broad uneven coloration, finer mottling, and water stains running down the walls from the ceiling
        k0 = .6 + .55 * _vnoise(x * .22, z * .22, 3) + .2 * (_vnoise(x * 1.3, z * 1.3, 5) - .5)
        if 0.05 < h < 3.15:
            streak = _vnoise((x + z) * 2.1 + x * .6, 0.5, 9)
            k0 *= 1 - max(0.0, streak - .56) * 1.25 * (.45 + .55 * (h / 3.2))
            k0 *= 1 - .22 * max(0.0, 1 - h / .55)      # damp climbing from the floor
        r = base * k0
        g = base * k0 * .98
        b = base * k0 * 1.02
        for lx, ly, lz, k, kind in live:
            d = math.sqrt((x - lx) ** 2 + (y - ly) ** 2 * .55 + (z - lz) ** 2)
            f = max(0.0, 1 - d / 5.0) ** 2 * 2.3 * k
            tr, tg, tb = tints[kind]
            r += f * tr
            g += f * tg
            b += f * tb
        # the floor is darker and wetter near puddles
        if abs(h) < .02:
            for cx, cz, rr in wet:
                dd = math.hypot(x - cx, z - cz)
                if dd < rr * 2.3:
                    w = max(0.0, 1 - dd / (rr * 2.3)) ** 1.5
                    r, g, b = r * (1 - .42 * w), g * (1 - .4 * w), b * (1 - .36 * w)
        # Daylight reaches a little way down each stairwell.
        for o in entrances:
            cx, cz = min(max(x, o[0]), o[2]), min(max(z, o[1]), o[3])
            dd = math.hypot(x - cx, z - cz) + max(0.0, -y) * .45
            f = .5 * max(0.0, 1 - dd / 3.2)
            r, g, b = r + f, g + f, b + f
        lim = 1.0     # the exported colours are bytes: 1.0 is the ceiling
        return (max(.1, min(lim, r)), max(.1, min(lim, g)), max(.1, min(lim, b)), 1.0)
    return colour


def _grid_face(md, quad, mat, step):
    """A quad (wound as the caller wrote it) cut into ~`step` m cells, so per-vertex lighting and stains have detail."""
    a, b, c, d = quad
    nu, nv = max(1, round(math.dist(a, b) / step)), max(1, round(math.dist(a, d) / step))

    def pt(i, j):
        s_, t = i / nu, j / nv
        return tuple((a[k] * (1 - s_) + b[k] * s_) * (1 - t) + (d[k] * (1 - s_) + c[k] * s_) * t for k in range(3))
    for i in range(nu):
        for j in range(nv):
            md.face([pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], mat)


def _farm_lamp_mesh(md, l):
    """A caged shade on a short chain: ceiling plate, alternating links, cap, cone shade, bulb and guard ring. Visual only."""
    x, z = l['pos']
    top, chain = l['top'], l['chain']
    md.cylinder((x, top - .022, z), .055, .022, 'iron', segments=8, caps=(False, True))
    n = max(4, int(chain / .062))
    pitch = chain / n
    for i in range(n):
        yc = top - .022 - (i + .5) * pitch
        if i % 2:
            md.box(x - .007, yc - pitch * .62, z - .019, x + .007, yc + pitch * .62, z + .019, 'iron')
        else:
            md.box(x - .019, yc - pitch * .62, z - .007, x + .019, yc + pitch * .62, z + .007, 'iron')
    y0 = top - .022 - chain
    md.cylinder((x, y0 - .04, z), .03, .04, 'iron', segments=8)
    md.cylinder((x, y0 - .13, z), .17, .09, 'iron', segments=10, radius_top=.045, caps=(False, False))      # cone shade
    bulb = {'warm': 'bulb_warm', 'cold': 'bulb_cold', 'dead': 'bulb_dead'}[l['kind']]
    md.sphere((x, y0 - .155, z), .056, bulb, rings=3, segments=8, squash=1.1)
    md.cylinder((x, y0 - .215, z), .122, .012, 'iron', segments=10, caps=(False, False), radius_top=.122)   # guard ring


# --- visible mesh ------------------------------------------------------------------------------
def light_at(p, lamps):
    base = STYLES[p['style']]['base']
    fl = p['floor']
    def colour(pt):
        x, y, z = pt
        if y > -.05:
            return (1.0, 1.0, 1.0, 1.0)  # street-level portal masonry: ordinary daylight
        k = base
        for (lx, ly, lz), facing in lamps:
            if facing == 'd':
                d = math.sqrt((x - lx) ** 2 + (y - ly) ** 2 * .35 + (z - lz) ** 2)
                k += .62 * max(0.0, 1 - d / 7.0) ** 2
            else:
                d = math.sqrt((x - lx) ** 2 + (y - ly) ** 2 * .6 + (z - lz) ** 2)
                k += .78 * max(0.0, 1 - d / 4.2) ** 2
        # Daylight reaches a little way down each stairwell.
        for e in p['entrances']:
            o = entrance_opening(e)
            cx, cz = min(max(x, o[0]), o[2]), min(max(z, o[1]), o[3])
            d = math.hypot(x - cx, z - cz) + max(0.0, -y) * .45
            k += .55 * max(0.0, 1 - d / 3.2)
        k = max(.2, min(1.0, k))
        return (k, k * .97, k * .93, 1.0)
    return colour


def generate(p):
    """MeshData for one passage (walls, floors, ceilings, stairs, portals, lamps, furnishing)."""
    from meshkit import MeshData
    s = STYLES[p['style']]
    fl = p['floor']
    metro = p['style'] == 'metro'
    farm = p['style'] == 'farm'
    if farm:
        lamps = farm_lamps(p)
        puddles = farm_puddles(p)
        md = MeshData(color_fn=light_farm(p, lamps, puddles))
    else:
        lamps = lamp_positions(p)
        md = MeshData(color_fn=light_at(p, lamps))
    for x0, z0, x1, z1 in p['segments']:
        if farm:
            _grid_face(md, [(x0, fl, z0), (x0, fl, z1), (x1, fl, z1), (x1, fl, z0)], s['floor'], .5)
            _grid_face(md, [(x0, CEIL, z0), (x1, CEIL, z0), (x1, CEIL, z1), (x0, CEIL, z1)], s['ceiling'], 1.5)
        else:
            md.face([(x0, fl, z0), (x0, fl, z1), (x1, fl, z1), (x1, fl, z0)], s['floor'])
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
        elif metro:
            # Structural ceiling beams across the short span every ~4.2 m, above head height.
            along_x = x1 - x0 >= z1 - z0
            length, span = ((x1 - x0), (z1 - z0)) if along_x else ((z1 - z0), (x1 - x0))
            if span >= 5.0:
                n = max(1, int(length // 4.2))
                for i in range(n + 1):
                    t = (i + .0) * length / n
                    t = min(max(t, .22), length - .22)
                    if along_x:
                        md.box(x0 + t - .22, CEIL - .5, z0, x0 + t + .22, CEIL - .002, z1, s['trim'], skip=('py', 'nz', 'pz'))
                    else:
                        md.box(x0, CEIL - .5, z0 + t - .22, x1, CEIL - .002, z0 + t + .22, s['trim'], skip=('py', 'nx', 'px'))
    # Walls: tiled inner face, plinth course, accent stripe and ceiling cornice.
    for side, line, a, b in edges(p):
        # Inner face only (normal toward the passage): the outside is buried.
        wall_face = (lambda q: _grid_face(md, q, s['wall'], .7)) if farm else (lambda q: md.face(q, s['wall']))
        if side == 'n':
            wall_face([(b, fl, line), (b, CEIL, line), (a, CEIL, line), (a, fl, line)])
        elif side == 's':
            wall_face([(a, fl, line), (a, CEIL, line), (b, CEIL, line), (b, fl, line)])
        elif side == 'w':
            wall_face([(line, fl, a), (line, CEIL, a), (line, CEIL, b), (line, fl, b)])
        else:
            wall_face([(line, fl, b), (line, CEIL, b), (line, CEIL, a), (line, fl, a)])
        _wall_trim(md, s, side, line, a, b, fl, metro)
    for x, z, size in pier_list(p):
        _pier_mesh(md, s, x, z, size, fl, metro)
    for b in block_list(p):
        _block_mesh(md, s, b, fl)
    if farm:
        for l in lamps:
            _farm_lamp_mesh(md, l)
        for q in puddles:
            ring = [(x, fl + .006, z) for x, z in q['pts']]
            cx, cz = q['c']
            k = 1.3 if q.get('satellite') else 1.5
            halo = [(cx + (x - cx) * k, fl + .003, cz + (z - cz) * k) for x, z in q['pts']]
            for pts, mat in ((halo, 'concrete_wet'), (ring, 'puddle')):
                for i in range(len(pts)):
                    md.face_toward([(cx, pts[0][1], cz), pts[i], pts[(i + 1) % len(pts)]], mat, (0, 1, 0))
    else:
        for (x, y, z), facing in lamps:
            _lamp_mesh(md, s, x, y, z, facing, p, metro)
    for pts, normal, item in decor_quads(p):
        _decor_mesh(md, pts, normal, item, s, p)
    for e in p['entrances']:
        _entrance_mesh(md, e, p['style'])
    return md


def _wall_trim(md, s, side, line, a, b, fl, metro):
    """A plinth course on the wall, plus (metro) an accent stripe and a ceiling cornice."""
    def strip(y0, y1, depth, mat, skip):
        if side == 'n':
            md.box(a, y0, line, b, y1, line + depth, mat, skip=skip)
        elif side == 's':
            md.box(a, y0, line - depth, b, y1, line, mat, skip=skip)
        elif side == 'w':
            md.box(line, y0, a, line + depth, y1, b, mat, skip=skip)
        else:
            md.box(line - depth, y0, a, line, y1, b, mat, skip=skip)
    ends = {'n': ('nz', 'nx', 'px'), 's': ('pz', 'nx', 'px'), 'w': ('nx', 'nz', 'pz'), 'e': ('px', 'nz', 'pz')}[side]
    skip = ('ny',) + ends
    strip(fl, fl + (.3 if not metro else .35), .04, s['trim'], skip)
    if metro:
        strip(fl + 1.45, fl + 1.58, .02, s['accent'], skip)
        strip(CEIL - .32, CEIL, .06, s['trim'], ('py',) + ends)


def _pier_mesh(md, s, x, z, size, fl, metro):
    h = size / 2
    md.box(x - h, fl, z - h, x + h, CEIL, z + h, s['pier'], skip=('ny', 'py'))
    if metro:
        md.box(x - h - .04, fl, z - h - .04, x + h + .04, fl + .38, z + h + .04, 'granite', skip=('ny',))
        md.box(x - h - .015, fl + 1.45, z - h - .015, x + h + .015, fl + 1.58, z + h + .015, s['accent'])
        md.box(x - h - .06, CEIL - .34, z - h - .06, x + h + .06, CEIL - .002, z + h + .06, s['trim'], skip=('py',))
    else:
        md.box(x - h - .05, fl, z - h - .05, x + h + .05, fl + .3, z + h + .05, s['trim'], skip=('ny',))
        md.box(x - h - .06, CEIL - .24, z - h - .06, x + h + .06, CEIL - .002, z + h + .06, s['trim'], skip=('py',))


def _block_mesh(md, s, b, fl):
    x0, z0, x1, z1 = b['rect']
    y1 = fl + b['h']
    kind = b['kind']
    if kind == 'gate':
        md.box(x0, fl, z0, x1, y1 - .06, z1, 'aluminium', skip=('ny',))
        md.box(x0 - .02, y1 - .06, z0 - .02, x1 + .02, y1, z1 + .02, 'steel_dark', skip=('ny',))
        # Validator screen on the top, and a lit status strip down each side.
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        md.box(cx - .08, y1, cz - .1, cx + .08, y1 + .12, cz + .1, 'team_blue_glow')
        long_z = (z1 - z0) >= (x1 - x0)
        for sgn in (-1, 1):
            if long_z:
                f = x0 if sgn < 0 else x1
                md.box(f + (-.012 if sgn < 0 else 0), fl + .5, z0 + .12, f + (0 if sgn < 0 else .012), fl + .56, z1 - .12, 'signal_green')
            else:
                f = z0 if sgn < 0 else z1
                md.box(x0 + .12, fl + .5, f + (-.012 if sgn < 0 else 0), x1 - .12, fl + .56, f + (0 if sgn < 0 else .012), 'signal_green')
    elif kind == 'kiosk':
        md.box(x0, fl, z0, x1, y1 - .08, z1, 'plastic_blue', skip=('ny',))
        md.box(x0 - .03, y1 - .08, z0 - .03, x1 + .03, y1, z1 + .03, 'aluminium', skip=('ny',))
        md.box(x0 + .1, fl, z0 + .1, x1 - .1, fl + .05, z1 - .1, 'steel_dark', skip=('ny', 'py'))
        long_z = (z1 - z0) >= (x1 - x0)
        length = (z1 - z0) if long_z else (x1 - x0)
        if b['h'] > 1.5:
            # A bank of ticket machines on both long faces: screen, keypad, card slot and tray.
            n = max(1, int(length // .8))
            for sgn in (-1, 1):
                for i in range(n):
                    t = (i + .5) / n * length
                    for (ya, yb, w, mat) in ((1.24, 1.62, .25, 'steel_dark'), (1.28, 1.58, .2, 'team_blue_glow'), (.92, 1.1, .12, 'steel_dark'), (.74, .8, .14, 'plastic_black'), (.4, .56, .2, 'steel_dark')):
                        depth = .02 if mat != 'team_blue_glow' else .03     # the screen stands a little proud of its bezel
                        # The face against the cabinet is never seen (and would coincide with the other parts' backs).
                        if long_z:
                            f = x0 if sgn < 0 else x1
                            c = z0 + t
                            md.box(f + (-depth if sgn < 0 else 0), fl + ya, c - w, f + (0 if sgn < 0 else depth), fl + yb, c + w, mat, skip=('px' if sgn < 0 else 'nx',))
                        else:
                            f = z0 if sgn < 0 else z1
                            c = x0 + t
                            md.box(c - w, fl + ya, f + (-depth if sgn < 0 else 0), c + w, fl + yb, f + (0 if sgn < 0 else depth), mat, skip=('pz' if sgn < 0 else 'nz',))
        else:
            # Ticket counter: two screens, a printer and a stack of leaflets on the worktop.
            for k, frac in enumerate((.25, .75)):
                c = (x0 + length * frac) if not long_z else (z0 + length * frac)
                if long_z:
                    md.box(x0 + .1, y1, c - .22, x0 + .16, y1 + .3, c + .22, 'steel_dark', skip=('ny',))
                    md.box(x0 + .1 - .004, y1 + .03, c - .19, x0 + .1, y1 + .27, c + .19, 'team_blue_glow')
                else:
                    md.box(c - .22, y1, z1 - .16, c + .22, y1 + .3, z1 - .1, 'steel_dark', skip=('ny',))
                    md.box(c - .19, y1 + .03, z1 - .1, c + .19, y1 + .27, z1 - .1 + .004, 'team_blue_glow')
            cx = (x0 + x1) / 2
            md.box(cx - .15, y1, z1 - .4, cx + .15, y1 + .09, z1 - .15, 'plastic_black', skip=('ny',))
    elif kind == 'tank':
        # A stone cistern tank: dressed walls, a dark water surface set below a stone rim.
        h = y1 - fl
        md.box(x0, fl, z0, x1, y1 - .14, z1, 'stone_blocks', skip=('ny', 'py'))
        rim = .26
        for rx0, rz0, rx1, rz1 in ((x0 - .05, z0 - .05, x1 + .05, z0 + rim), (x0 - .05, z1 - rim, x1 + .05, z1 + .05),
                                   (x0 - .05, z0 + rim, x0 + rim, z1 - rim), (x1 - rim, z0 + rim, x1 + .05, z1 - rim)):
            md.box(rx0, y1 - .14, rz0, rx1, y1, rz1, s['trim'], skip=('ny',))
        wy = y1 - .1
        md.face([(x0 + rim, wy, z0 + rim), (x0 + rim, wy, z1 - rim), (x1 - rim, wy, z1 - rim), (x1 - rim, wy, z0 + rim)], 'water')
        _ = h
    elif kind == 'partition':
        md.box(x0, fl, z0, x1, CEIL, z1, s['wall'], skip=('ny', 'py'))
        md.box(x0 - .03, fl, z0 - .03, x1 + .03, fl + .3, z1 + .03, s['trim'], skip=('ny',))
    else:
        md.box(x0, fl, z0, x1, y1, z1, s['trim'], skip=('ny',))


def _lamp_mesh(md, s, x, y, z, facing, p, metro):
    if facing == 'd':
        # Ceiling LED fixture along the longer span of its segment.
        seg = next(r for r in p['segments'] if r[0] <= x <= r[2] and r[1] <= z <= r[3])
        along_x = seg[2] - seg[0] >= seg[3] - seg[1]
        hx, hz = (.65, .1) if along_x else (.1, .65)
        md.box(x - hx - .03, y + .08, z - hz - .03, x + hx + .03, y + .12, z + hz + .03, s['metal'], skip=('py',))
        md.box(x - hx, y, z - hz, x + hx, y + .08, z + hz, s['lamp'], skip=('py',))
        return
    ox, oz = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[facing]
    md.box(x - .06 - abs(oz) * .04, y + .26, z - .06 - abs(ox) * .04, x + .06 + abs(oz) * .04, y + .3, z + .06 + abs(ox) * .04, s['metal'])
    md.tube((x - ox * .1, y + .28, z - oz * .1), (x + ox * .1, y + .28, z + oz * .1), .012, s['metal'], segments=5)
    lx, lz = x + ox * .12, z + oz * .12
    if p['style'] in ('cellar', 'farm'):
        md.cylinder((lx, y + .02, lz), .085, .2, s['lamp'], segments=8)
        md.cylinder((lx, y + .22, lz), .11, .05, s['metal'], segments=8, radius_top=.04)
        md.cylinder((lx, y - .01, lz), .1, .03, s['metal'], segments=8)
    else:
        md.box(lx - .25, y, lz - .05, lx + .25, y + .06, lz + .05, s['lamp']) if abs(oz) else \
            md.box(lx - .05, y, lz - .25, lx + .05, y + .06, lz + .25, s['lamp'])


def _decor_mesh(md, pts, normal, item, s, p):
    art = item.get('art')
    toward = (normal[0], 0.0, normal[2])
    if item.get('kind') == 'door':
        _door_mesh(md, pts, toward, item, s)
        return
    span = tuple(item.get('span', (1, 1)))
    u0, v0, u1, v1 = atlas_uv(art, item['cell'], span)
    uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    md.face_toward(pts, ATLASES[art]['material'], toward, uv=uv)
    # A thin frame around art that hangs on a wall (posters get a paper edge only).
    if item.get('frame'):
        _frame(md, pts, toward, .025, s['metal'])


def _frame(md, pts, toward, t, mat):
    """A thin round-bar frame just proud of art on a wall."""
    a, b, c, d = pts
    for p0, p1 in ((a, b), (b, c), (c, d), (d, a)):
        md.tube((p0[0] + toward[0] * .004, p0[1], p0[2] + toward[2] * .004), (p1[0] + toward[0] * .004, p1[1], p1[2] + toward[2] * .004),
                t / 2, mat, segments=4, caps=False)


def _slab(md, mat, across, y0, y1, plane, lo, hi, facing_z, skip=()):
    """A box on a wall: `across` = (min, max) along the wall, depth from the wall plane."""
    d0, d1 = (plane + lo, plane + hi) if lo <= hi else (plane + hi, plane + lo)
    if facing_z:
        md.box(across[0], y0, d0, across[1], y1, d1, mat, skip=skip)
    else:
        md.box(d0, y0, across[0], d1, y1, across[1], mat, skip=skip)


def _door_mesh(md, pts, toward, item, s):
    """A closed utility door: leaf, frame and push bar proud of the wall (visual only)."""
    a, b, c, d = pts
    nx, nz = toward[0], toward[2]
    facing_z = abs(nz) > .5
    sign = nz if facing_z else nx
    plane = (a[2] if facing_z else a[0]) - sign * .012          # the wall's own plane
    lo = (min(a[0], b[0]), max(a[0], b[0])) if facing_z else (min(a[2], b[2]), max(a[2], b[2]))
    y0, y1 = a[1], d[1]
    dep = lambda k0, k1: (sign * k0, sign * k1)
    skip = ('ny',)
    l0, l1 = dep(0, .05)
    _slab(md, s['door'], lo, y0, y1, plane, l0, l1, facing_z, skip)
    f0, f1 = dep(0, .085)
    _slab(md, 'concrete_trim', (lo[0] - .07, lo[0]), y0, y1 + .07, plane, f0, f1, facing_z, skip)
    _slab(md, 'concrete_trim', (lo[1], lo[1] + .07), y0, y1 + .07, plane, f0, f1, facing_z, skip)
    _slab(md, 'concrete_trim', (lo[0] - .07, lo[1] + .07), y1, y1 + .07, plane, f0, f1, facing_z, skip)
    # Push bar near the free edge, and a small plate above the door.
    bar = lo[1] - (lo[1] - lo[0]) * .18
    h0, h1 = dep(.07, .075)
    if facing_z:
        md.tube((bar, y0 + .95, plane + sign * .08), (bar, y0 + 1.25, plane + sign * .08), .014, 'aluminium', segments=6)
    else:
        md.tube((plane + sign * .08, y0 + .95, bar), (plane + sign * .08, y0 + 1.25, bar), .014, 'aluminium', segments=6)
    _ = (h0, h1)


def _entrance_mesh(md, e, style):
    s = STYLES[style]
    W, L, world = frame(e)
    fl, n, rise, half = stair_dims(e)
    RUN = e['run']

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
            prev = y1 + rise
            quad([(u1, y1, v0), (u0, y1, v0), (u0, prev, v0), (u1, prev, v0)], mat)
            md.box(*local_box(world, [u0, y1 - .04, v0 - .03, u1, y1 + .008, v0 + .03]), s['trim'], skip=('ny',))
        elif faces == 'stepB':
            prev = y1 + rise
            quad([(u0, y1, v1), (u1, y1, v1), (u1, prev, v1), (u0, prev, v1)], mat)
            md.box(*local_box(world, [u0, y1 - .04, v1 - .03, u1, y1 + .008, v1 + .03]), s['trim'], skip=('ny',))
        elif faces == 'landing':
            # Riser down to the second flight's first step (dogleg only).
            (b0, b1) = halves(e)[1]
            quad([(b0, y1 - rise, v0), (b1, y1 - rise, v0), (b1, y1, v0), (b0, y1, v0)], mat)
        elif faces == 'all':
            lbox(b, mat, skip=('ny',))
        elif faces == 'inner':
            lbox([b[0], b[1], b[2], b[3], b[4], b[5]], mat, skip=('ny', 'py'))
        elif faces == 'guard':
            if style in ('cellar', 'farm'):
                lbox(b, mat, skip=('ny',))
                lbox([b[0] - .04, b[4], b[2] - .04, b[3] + .04, b[4] + .07, b[5] + .04], s['trim'], skip=('ny',))
        elif faces == 'roof':
            _portal_roof(md, world, W, L, s)
    if e['type'] == 'straight':
        for u in (T + .06, W - T - .06):
            # Wall-mounted handrails follow the flight; posts carry the street guard rails.
            md.tube(world(u, .9, LANDING), world(u, .9 + fl, LANDING + (n - 1) * RUN), .025, s['metal'], segments=6)
        if style not in ('cellar', 'farm'):
            for b, mat, part, faces in steps:
                if faces != 'guard':
                    continue
                u0, y0, v0, u1, y1, v1 = b
                c = (u0 + u1) / 2 if u1 - u0 < v1 - v0 else None
                if c is not None:
                    md.tube(world(c, 1.0, v0), world(c, 1.0, v1), .03, s['metal'], segments=6)
                    md.tube(world(c, .5, v0), world(c, .5, v1), .018, s['metal'], segments=5)
                    k = max(2, int((v1 - v0) / 1.2))
                    for i in range(k + 1):
                        v = v0 + .05 + (v1 - v0 - .1) * i / k
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
