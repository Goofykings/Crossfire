"""Neon Backstreets visual layer (2026-11): signs, neon tubes, glow cards, lit windows, shop displays, lanterns,
cables, pipes, graffiti, billboards, the distant skyline and the vistas beyond the fences; plus the vertex-colour
light bake for the structures and the ground. Pure Python on MeshData (no bpy); everything here is visual only.

How the glow works without a lighting budget (Babylon gives each material four real lights):
  * self-lit `unlit` materials: neon tubes (hue in vertex colours, tint > 1 so the core tone-maps toward white and
    feeds bloom on Medium and up), lit sign atlases, windows and the skyline;
  * `additive` glow cards (no depth write, no fog): a halo in front of every sign, a wash of coloured light on the wall
    around it, a pool on the pavement under it and a rippled wet-ground reflection streak; ribbons along every tube;
  * baked light pools: `bake()` subdivides lit surfaces near each source and tints their vertex colours, with simple
    contact darkening at wall feet and under ceilings. Interior lights reach only their room.
Only three real point lights remain (layout `lights`), at the brightest signs, so characters pick up neon colour.
"""
from __future__ import annotations

import math

import farmstead
import neon_art as art
from meshkit import MeshData

UNLIT = {'neon_tube', 'neon_signs', 'neon_panels', 'neon_windows', 'neon_skyline', 'neon_glow', 'neon_wet', 'neon_beam'}
NO_BAKE = UNLIT | {'neon_graffiti', 'neon_puddle', 'glass_store', 'chainlink', 'paint_white', 'paint_yellow', 'oil_stain', 'posters_fun'}
AMBIENT = 0.7


def _h(*v):
    """Deterministic hash in [0, 1)."""
    n = 2166136261
    for x in v:
        n = ((n ^ (int(x * 1000) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    n ^= n >> 13
    n = (n * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536.0


def _c(col, k=1.0, a=1.0):
    return (min(1.0, col[0] * k), min(1.0, col[1] * k), min(1.0, col[2] * k), a)


def _core(col):
    """Tube core colour: the hue lifted toward white (the unlit tint > 1 does the rest)."""
    return _c([c * .62 + .38 for c in col])


def right_of(n):
    """Viewer's right on a face with outward normal (nx, nz): u increases this way (see CLAUDE.md, text on quads)."""
    return (n[1], -n[0])


def wall_quad(md, c, n, w, h, mat, off, uv=None, col=None, y0=None):
    """Quad on the plane of a wall: centred at c (or bottom at y0), offset `off` along the normal."""
    nx, nz = n
    rx, rz = right_of(n)
    cx, cy, cz = c[0] + nx * off, c[1], c[2] + nz * off
    b = cy - h / 2 if y0 is None else y0
    t = b + h
    pts = [(cx - rx * w / 2, b, cz - rz * w / 2), (cx + rx * w / 2, b, cz + rz * w / 2),
           (cx + rx * w / 2, t, cz + rz * w / 2), (cx - rx * w / 2, t, cz - rz * w / 2)]
    if uv is not None:
        u0, v0, u1, v1 = uv
        uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    md.face_toward(pts, mat, (nx, 0.0, nz), uv=uv, col=col)


def ground_card(md, x0, z0, x1, z1, y, mat, col, uv=None, along=None):
    """Horizontal card facing up. `along` = 'z+'... picks which edge is the uv top (v = 1)."""
    pts = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]
    if uv is None:
        uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
    md.face_toward(pts, mat, (0, 1, 0), uv=uv, col=col)


# --- signs ----------------------------------------------------------------------------------------------------------
def sign(md, s, floor):
    mat, uv = art.art_uv(s['art'])
    c, n, w, h, d = s['c'], s['n'], s['w'], s['h'], s['depth']
    nx, nz = n
    if d > .025:
        # back box (steel housing) from the wall plane out to the face
        rx, rz = right_of(n)
        ax = abs(rx) > .5
        if ax:
            x0, x1 = c[0] - w / 2 - .03, c[0] + w / 2 + .03
            z0, z1 = sorted((c[2], c[2] + nz * d))
        else:
            z0, z1 = c[2] - w / 2 - .03, c[2] + w / 2 + .03
            x0, x1 = sorted((c[0], c[0] + nx * d))
        md.box(x0, c[1] - h / 2 - .03, z0, x1, c[1] + h / 2 + .03, z1, 'steel_dark', skip=('nz', 'pz') if abs(nz) > .5 else ('nx', 'px'))
        wall_quad(md, c, n, w + .06, h + .06, 'steel_dark', d - .001)
    wall_quad(md, c, n, w, h, mat, d + .002, uv=uv)
    glow = s['glow']
    if s.get('halo', 1) > 0:
        k = s.get('halo', 1)
        wall_quad(md, c, n, (w * 1.6 + .9) * k, (h * 2.1 + .9) * k, 'neon_glow', d + .035, uv=(0, 0, 1, 1), col=_c(glow, .8 * min(1, k + .2)))
    if s.get('wash', True):
        bottom = floor(c[0] + nx * .3, c[2] + nz * .3)
        top = c[1] + h / 2 + .9
        low = max(bottom + .02, c[1] - h / 2 - 2.8)
        wall_quad(md, (c[0], 0, c[2]), n, w * 1.8 + 2.2, top - low, 'neon_glow', .024, uv=(0, 0, 1, 1), col=_c(glow, .5), y0=low)
    if s.get('pool', True) and c[1] - h / 2 < 4.6:
        pool(md, c, n, w, glow, floor, s.get('halo', 1))


def pool(md, c, n, w, glow, floor, k=1.0):
    """Coloured light on the pavement in front of a sign and its rippled wet reflection (two streaks: a bright core and a
    longer, fainter one that reaches across the street)."""
    nx, nz = n
    rx, rz = right_of(n)
    length = 2.4 + c[1] * .6
    width = w * 1.05 + .5

    def streak(L, W, kk, shift, dy):
        steps = max(2, int(L / .4))
        for i in range(steps):
            a, b = i / steps * L, (i + 1) / steps * L
            mx, mz = c[0] + nx * (a + b) / 2 + rx * shift, c[2] + nz * (a + b) / 2 + rz * shift
            y = floor(mx, mz) + dy
            p = [(c[0] + nx * a + rx * (shift - W / 2), c[2] + nz * a + rz * (shift - W / 2)),
                 (c[0] + nx * a + rx * (shift + W / 2), c[2] + nz * a + rz * (shift + W / 2)),
                 (c[0] + nx * b + rx * (shift + W / 2), c[2] + nz * b + rz * (shift + W / 2)),
                 (c[0] + nx * b + rx * (shift - W / 2), c[2] + nz * b + rz * (shift - W / 2))]
            va, vb = 1 - a / L, 1 - b / L
            md.face_toward([(p[0][0], y, p[0][1]), (p[1][0], y, p[1][1]), (p[2][0], y, p[2][1]), (p[3][0], y, p[3][1])], 'neon_wet', (0, 1, 0),
                           uv=[(0, va), (1, va), (1, vb), (0, vb)], col=_c(glow, kk))
    streak(length, width, 1.0 * k, 0.0, .03)
    streak(length * 1.7, width * .55, .62 * k, width * .22, .0235)
    # soft spill at the foot of the wall
    sx, sz = c[0] + nx * .9, c[2] + nz * .9
    y = floor(sx, sz) + .026
    r = w * .7 + 1.5
    ground_card(md, sx - r, sz - r, sx + r, sz + r, y, 'neon_glow', _c(glow, .44 * k))


def blade(md, b):
    """Double-sided board standing out from the wall, with brackets and halos on both faces."""
    mat, uv = art.art_uv(b['art'])
    c, n, w, h = b['c'], b['n'], b['w'], b['h']
    nx, nz = n
    t = .1
    off0, off1 = .12, .12 + w
    mid = (off0 + off1) / 2
    cx, cz = c[0] + nx * mid, c[2] + nz * mid
    rx, rz = right_of(n)
    hx = abs(nx) * w / 2 + abs(rx) * t / 2
    hz = abs(nz) * w / 2 + abs(rz) * t / 2
    md.box(cx - hx - .02 * abs(nx), c[1] - h / 2 - .04, cz - hz - .02 * abs(nz), cx + hx + .02 * abs(nx), c[1] + h / 2 + .04, cz + hz + .02 * abs(nz), 'steel_dark')
    for y in (c[1] + h / 2 - .2, c[1] - h / 2 + .2):
        bx, bz = c[0] + nx * off0 / 2, c[2] + nz * off0 / 2
        md.box(bx - abs(nx) * off0 / 2 - abs(rx) * .03, y - .03, bz - abs(nz) * off0 / 2 - abs(rz) * .03,
               bx + abs(nx) * off0 / 2 + abs(rx) * .03, y + .03, bz + abs(nz) * off0 / 2 + abs(rz) * .03, 'steel_dark')
    for sgn in (1, -1):
        fn = (rx * sgn, rz * sgn)
        fc = (cx, c[1], cz)
        wall_quad(md, fc, fn, w - .04, h - .04, mat, t / 2 + .003, uv=uv)
        wall_quad(md, fc, fn, w * 1.6 + .6, h * 1.25 + .6, 'neon_glow', t / 2 + .04, uv=(0, 0, 1, 1), col=_c(b['glow'], .45))
    # light on the facade around the blade
    wall_quad(md, (c[0], c[1], c[2]), n, 2.2 + w, h + 1.6, 'neon_glow', .024, uv=(0, 0, 1, 1), col=_c(b['glow'], .32))


def billboard(md, b):
    mat, uv = art.art_uv(b['art'])
    c, n, w, h = b['c'], b['n'], b['w'], b['h']
    nx, nz = n
    rx, rz = right_of(n)
    base = b['base']
    bottom = c[1] - h / 2
    # two legs and a back frame, set back 0.6 m from the face
    for s in (-.38, .38):
        lx, lz = c[0] + rx * w * s - nx * .6, c[2] + rz * w * s - nz * .6
        md.box(lx - .1, base, lz - .1, lx + .1, c[1] + h / 2, lz + .1, 'steel_dark')
        md.tube((lx, bottom, lz), (lx + nx * .6, bottom - .1, lz + nz * .6), .05, 'steel_dark', segments=5)
    hx = abs(rx) * (w / 2 + .1) + abs(nx) * .15
    hz = abs(rz) * (w / 2 + .1) + abs(nz) * .15
    fx, fz = c[0] - nx * .15, c[2] - nz * .15
    md.box(fx - hx, bottom - .12, fz - hz, fx + hx, c[1] + h / 2 + .12, fz + hz, 'steel_dark')
    wall_quad(md, c, n, w, h, mat, .003, uv=uv)
    # catwalk and lamp arms
    for s in (-.3, 0, .3):
        ax, az = c[0] + rx * w * s, c[2] + rz * w * s
        md.tube((ax, bottom - .05, az), (ax + nx * .8, bottom - .25, az + nz * .8), .025, 'steel_dark', segments=4)
        md.box(ax + nx * .8 - .1, bottom - .35, az + nz * .8 - .1, ax + nx * .8 + .1, bottom - .22, az + nz * .8 + .1, 'neon_tube', col=_c((1, .95, .85), .8))
    wall_quad(md, c, n, w * 1.25 + 1.2, h * 1.5 + 1.2, 'neon_glow', .05, uv=(0, 0, 1, 1), col=_c(b['glow'], .35))


# --- tubes, lanterns, cables -------------------------------------------------------------------------------------------
def tube_line(md, pts, col, n, radius=.024):
    core = _core(col)
    nx, nz = n
    for a, b in zip(pts, pts[1:]):
        md.tube(tuple(a), tuple(b), radius, 'neon_tube', segments=6, col=core)
        # brackets every 0.8 m
        L = math.dist(a, b)
        for i in range(1, int(L / .8) + 1):
            t = i * .8 / L
            p = [a[k] + (b[k] - a[k]) * t for k in range(3)]
            md.tube((p[0], p[1], p[2]), (p[0] - nx * .04, p[1], p[2] - nz * .04), .008, 'steel_dark', segments=3, caps=False)
        ribbon(md, a, b, n, col)
    for p in pts:
        md.sphere(tuple(p), radius * 1.05, 'neon_tube', rings=3, segments=6, col=core)


def ribbon(md, a, b, n, col, half=.24, k=.55):
    """A glow card along a segment, in the plane facing n; uv keeps u at the texture's centre column."""
    dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    L = math.sqrt(dx * dx + dy * dy + dz * dz) or 1
    d = (dx / L, dy / L, dz / L)
    nn = (n[0], 0.0, n[1])
    p = (d[1] * nn[2] - d[2] * nn[1], d[2] * nn[0] - d[0] * nn[2], d[0] * nn[1] - d[1] * nn[0])
    pl = math.sqrt(sum(v * v for v in p)) or 1
    p = tuple(v / pl * half for v in p)
    e = .2
    A = [a[i] - d[i] * e + nn[i] * .03 for i in range(3)]
    B = [b[i] + d[i] * e + nn[i] * .03 for i in range(3)]
    pts = [tuple(A[i] - p[i] for i in range(3)), tuple(B[i] - p[i] for i in range(3)), tuple(B[i] + p[i] for i in range(3)), tuple(A[i] + p[i] for i in range(3))]
    md.face_toward(pts, 'neon_glow', nn, uv=[(.5, 0), (.5, 0), (.5, 1), (.5, 1)], col=_c(col, k))


def catenary(a, b, sag, n):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t))
    return out


def cable(md, a, b, sag, r=.011, mat='rubber'):
    pts = catenary(a, b, sag, 10)
    for p, q in zip(pts, pts[1:]):
        md.tube(p, q, r, mat, segments=4, caps=False)
    return pts


def crossed_glow(md, p, size, col, k):
    for n in ((1, 0), (0, 1)):
        wall_quad(md, (p[0], p[1], p[2]), n, size, size, 'neon_glow', 0, uv=(0, 0, 1, 1), col=_c(col, k))


def lantern_string(md, l):
    cable(md, l['a'], l['b'], l['sag'], .008)
    n = l['n']
    for i in range(n):
        t = (i + .5) / n
        a, b = l['a'], l['b']
        x = a[0] + (b[0] - a[0]) * t
        z = a[2] + (b[2] - a[2]) * t
        y = a[1] + (b[1] - a[1]) * t - l['sag'] * 4 * t * (1 - t)
        if l['kind'] == 'lantern':
            md.tube((x, y, z), (x, y - .12, z), .005, 'steel_dark', segments=3, caps=False)
            c = (x, y - .34, z)
            md.sphere(c, .17, 'neon_tube', rings=6, segments=10, squash=1.3, col=_c(l['col'], .78))
            md.cylinder((x, y - .14, z), .07, .04, 'steel_dark', segments=8)
            md.cylinder((x, y - .58, z), .06, .04, 'steel_dark', segments=8)
            crossed_glow(md, c, 1.0, l['col'], .45)
        else:
            c = (x, y - .06, z)
            md.sphere(c, .045, 'neon_tube', rings=3, segments=6, col=_c(l['col'], .95))
            if i % 2 == 0:
                crossed_glow(md, c, .55, l['col'], .4)


def pipe(md, p):
    x, z, top = p['x'], p['z'], p['top']
    md.tube((x, 0.0, z), (x, top, z), .055, 'galvanized', segments=8)
    md.tube((x, .0, z), (x + p['n'][0] * .18, .0, z + p['n'][1] * .18), .06, 'galvanized', segments=8)
    y = 1.2
    while y < top:
        md.box(x - .07, y, z - .07, x + .07, y + .05, z + .07, 'steel_dark')
        y += 2.1


# --- lamps -----------------------------------------------------------------------------------------------------------
def lamps(md, spec):
    for x0, z0, x1, z1, y in spec['ceiling']:
        md.box(x0 - .04, y - .05, z0 - .04, x1 + .04, y, z1 + .04, 'steel_white')
        md.box(x0, y - .065, z0, x1, y - .05, z1, 'neon_tube', col=_c((.95, .97, 1.0), .85))
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        r = max(x1 - x0, z1 - z0) / 2 + .45
        md.face_toward([(cx - r, y - .09, cz - r), (cx + r, y - .09, cz - r), (cx + r, y - .09, cz + r), (cx - r, y - .09, cz + r)], 'neon_glow',
                       (0, -1, 0), uv=[(0, 0), (1, 0), (1, 1), (0, 1)], col=_c((1, 1, 1), .22))
    for x, y, z, nx, nz in spec['wall']:
        rx, rz = right_of((nx, nz))
        cx, cz = x + nx * .07, z + nz * .07
        md.box(cx - abs(rx) * .13 - abs(nx) * .07, y - .1, cz - abs(rz) * .13 - abs(nz) * .07,
               cx + abs(rx) * .13 + abs(nx) * .07, y + .1, cz + abs(rz) * .13 + abs(nz) * .07, 'steel_dark')
        bx, bz = x + nx * .15, z + nz * .15
        md.box(bx - .06, y - .07, bz - .06, bx + .06, y + .07, bz + .06, 'neon_tube', col=_c((1, .82, .55), .9))
        wall_quad(md, (x, y - .3, z), (nx, nz), 2.2, 2.6, 'neon_glow', .024, uv=(0, 0, 1, 1), col=_c((1, .75, .45), .35))
        crossed_glow(md, (bx, y, bz), .7, (1, .8, .5), .4)



# --- polish pass (2026-11-14): light shafts, prop glows, grime, cracks, fire escapes, noren -------------------------------------
def beam(md, b):
    """A soft light shaft: two crossed vertical cards, narrow at the source and wide at the bottom."""
    x, y, z = b['p']
    y0 = b.get('y0', .15)
    w0, w1 = b.get('w0', .4), b.get('w1', 2.6)
    col = _c(b['col'], b.get('k', .35))
    for dx, dz in ((1, 0), (0, 1)):
        bl = (x - dx * w1 / 2, y0, z - dz * w1 / 2)
        br = (x + dx * w1 / 2, y0, z + dz * w1 / 2)
        tr = (x + dx * w0 / 2, y, z + dz * w0 / 2)
        tl = (x - dx * w0 / 2, y, z - dz * w0 / 2)
        md.face_toward([bl, br, tr, tl], 'neon_beam', (dz, 0, -dx), uv=[(0, 0), (1, 0), (1, 1), (0, 1)], col=col)
    r = b.get('pool', 0)
    if r:
        ground_card(md, x - r, z - r, x + r, z + r, y0 - .059, 'neon_glow', _c(b['col'], .5))


def prop_glow(md, g, floor):
    """Light from a lit prop (vending machine, phone booth, gacha bank, lamp): a halo over the lit face and the pavement pool
    with its wet reflection in front of it."""
    x, z = g['pos']
    nx, nz = g['n']
    col, k = g['col'], g.get('k', 1.0)
    wall_quad(md, (x + nx * .55, g.get('y', 1.2), z + nz * .55), (nx, nz), g.get('w', 1.4), g.get('h', 1.9), 'neon_glow', 0, uv=(0, 0, 1, 1),
              col=_c(col, .34 * k))
    pool(md, (x + nx * .45, g.get('y', 1.2), z + nz * .45), (nx, nz), g.get('w', 1.0) * .9, col, floor, .8 * k)


def grime(md, g):
    """Rain streaks, rust or stickers pasted on a wall (alpha-cut decal, 12 mm proud so it never shares a plane with tags)."""
    wall_quad(md, g['c'], g['n'], g['w'], g['h'], 'neon_graffiti', .012, uv=art.graffiti_uv(g['cell']))


def crack(md, g, floor):
    """Cracked pavement: a rotated alpha-cut card lying 7.5 mm over the ground."""
    cx, cz = g['c']
    w, h = g['w'], g['h']
    a = math.radians(g.get('rot', 0))
    ca, sa = math.cos(a), math.sin(a)
    y = floor(cx, cz) + .0075
    pts = []
    for lx, lz in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        pts.append((cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca))
    u0, v0, u1, v1 = art.graffiti_uv(g.get('cell', 10))
    md.face_toward(pts, 'neon_graffiti', (0, 1, 0), uv=[(u0, v1), (u1, v1), (u1, v0), (u0, v0)])


def noren(md, g):
    """Red cloth door curtain with a brushed glyph on each flap, lit by the lanterns beside it (unlit panel, kept dim)."""
    wall_quad(md, g['c'], g['n'], g['w'], g['w'] * .5, 'neon_panels', .1, uv=art.panel_uv('noren'), col=_c((.8, .8, .8)), y0=g['y0'])
    # the cloth's back (seen from inside the shop): the same art mirrored, on the same plane facing the other way
    u0, v0, u1, v1 = art.panel_uv('noren')
    nx, nz = g['n']
    wall_quad(md, g['c'], (-nx, -nz), g['w'], g['w'] * .5, 'neon_panels', -.09, uv=(u1, v0, u0, v1), col=_c((.5, .5, .5)), y0=g['y0'])


def fire_escape(md, f):
    """A visual-only fire escape on a facade: grated landings with railings, zig-zag flights and a drop ladder. Everything
    sits above 3.6 m (the ladder ends at 2.7 m), well away from the decks, so it can never be reached or stood on."""
    nx, nz = f['n']
    rx, rz = right_of(f['n'])
    px, pz = f['p']                       # wall plane point at the landing's centre
    w, d = f.get('w', 1.7), f.get('d', 1.0)
    y0, floors, rise = f.get('y0', 4.5), f.get('floors', 2), f.get('rise', 3.2)

    def pt(a, o, y):
        """a along the wall (viewer's right), o out from the wall, y height."""
        o += .08       # stands 8 cm off the facade: clear of window frames, sills and the wall plane
        return (px + rx * a + nx * o, y, pz + rz * a + nz * o)

    def slab_box(a0, a1, o0, o1, ya, yb, mat):
        p, q = pt(a0, o0, ya), pt(a1, o1, yb)
        md.box(min(p[0], q[0]), ya, min(p[2], q[2]), max(p[0], q[0]), yb, max(p[2], q[2]), mat)

    def rail_run(a0, o0, a1, o1, y, h=1.0):
        p, q = pt(a0, o0, y + h), pt(a1, o1, y + h)
        md.tube(p, q, .02, 'steel_dark', segments=4)
        n = max(2, int(math.dist((p[0], p[2]), (q[0], q[2])) / .28))
        for i in range(n + 1):
            t = i / n
            a, o = a0 + (a1 - a0) * t, o0 + (o1 - o0) * t
            md.tube(pt(a, o, y), pt(a, o, y + h), .01, 'steel_dark', segments=3, caps=False)
    for fl in range(floors):
        y = y0 + fl * rise
        slab_box(-w / 2, w / 2, .03, d, y - .05, y, 'galvanized')
        for i in range(-3, 4):                                     # grating slats
            slab_box(i * w / 7 - .02, i * w / 7 + .02, .05, d - .02, y, y + .012, 'steel_dark')
        rail_run(-w / 2, d, w / 2, d, y)
        rail_run(-w / 2, .04, -w / 2, d, y)
        rail_run(w / 2, .04, w / 2, d, y)
        for a in (-w / 2 + .1, w / 2 - .1):                        # support brackets back to the wall
            md.tube(pt(a, d - .05, y - .05), pt(a, .05, y - .55), .02, 'steel_dark', segments=4)
        if fl + 1 < floors:
            # a flight up to the next landing, treads stepping along the wall from one side to the other
            n = 9
            a_from, a_to = (-w / 2 + .1, w / 2 - .1) if fl % 2 == 0 else (w / 2 - .1, -w / 2 + .1)
            for i in range(n):
                t = (i + .5) / n
                a = a_from + (a_to - a_from) * t
                slab_box(a - .13, a + .13, .14, d - .12, y + t * rise - .02, y + t * rise + .02, 'galvanized')
            for o in (.14, d - .12):
                md.tube(pt(a_from, o, y), pt(a_to, o, y + rise), .02, 'steel_dark', segments=4)
    # drop ladder from the lowest landing, ending 2.7 m above the ground
    a = -w / 2 + .35
    for side in (-.2, .2):
        md.tube(pt(a + side, .32, y0 - .05), pt(a + side, .32, 2.7), .018, 'steel_dark', segments=4)
    yy = 2.85
    while yy < y0 - .1:
        md.tube(pt(a - .2, .3, yy), pt(a + .2, .3, yy), .012, 'steel_dark', segments=3, caps=False)
        yy += .3



def span(md, sp):
    """A big neon sign hung on cables across a lane between two facades: double-sided (the back reads correctly too), with
    halos and a soft pool of its colour on the street underneath. c = centre (x, y, z); the board lies in the plane x = c.x."""
    mat, uv = art.art_uv(sp['art'])
    x, y, z = sp['c']
    w, h = sp['w'], sp['h']
    col = sp['glow']
    t = .12
    md.box(x - t / 2, y - h / 2 - .06, z - w / 2 - .06, x + t / 2, y + h / 2 + .06, z + w / 2 + .06, 'steel_dark')
    u0, v0, u1, v1 = uv
    for sgn in (1, -1):
        nrm = (sgn, 0)
        # u grows toward the viewer's right: for the +x face that is -z... wall_quad handles it from the normal
        wall_quad(md, (x, y, z), nrm, w, h, mat, t / 2 + .004, uv=uv if sgn > 0 else uv)
        wall_quad(md, (x, y, z), nrm, w * 1.35 + 1.2, h * 2.2 + 1.2, 'neon_glow', t / 2 + .04, uv=(0, 0, 1, 1), col=_c(col, .55))
    # hanging cables up to the two facades, and the pool below
    za, zb = sp['anchors']
    for zz, ze in ((z - w / 2 + .3, za), (z + w / 2 - .3, zb)):
        md.tube((x, y + h / 2 + .06, zz), (x, y + h / 2 + 1.0, ze), .02, 'steel_dark', segments=4)
    ground_card(md, x - 3.0, z - w * .6, x + 3.0, z + w * .6, sp.get('floor', 0.0) + .045, 'neon_glow', _c(col, .38))


def rooftops(md, roofs):
    """Visual clutter on the flat roofs (seen from the decks and from far away): a water tank on legs, vent stacks, AC boxes,
    an antenna mast with a red aviation lamp. roofs = [(x0, z0, x1, z1, y)] inside each parapet."""
    for i, (x0, z0, x1, z1, y) in enumerate(roofs):
        w, d = x1 - x0, z1 - z0
        # water tank
        tx, tz = x0 + w * (.25 + .5 * _h(i, 1)), z0 + d * (.25 + .5 * _h(i, 2))
        for dx, dz in ((-.45, -.45), (.45, -.45), (.45, .45), (-.45, .45)):
            md.box(tx + dx - .05, y, tz + dz - .05, tx + dx + .05, y + 1.1, tz + dz + .05, 'steel_dark')
        md.cylinder((tx, y + 1.1, tz), .7, 1.5, 'galvanized', segments=12)
        md.cylinder((tx, y + 2.6, tz), .74, .08, 'steel_dark', segments=12)
        # vent stacks
        for k in range(3):
            vx, vz = x0 + w * (.15 + .7 * _h(i, 3 + k)), z0 + d * (.15 + .7 * _h(i, 8 + k))
            md.cylinder((vx, y, vz), .16, 1.0 + .5 * k, 'galvanized', segments=8)
            md.cylinder((vx, y + 1.0 + .5 * k, vz), .24, .06, 'steel_dark', segments=8)
        # AC boxes
        for k in range(2):
            ax, az = x0 + w * (.2 + .6 * _h(i, 15 + k)), z0 + d * (.2 + .6 * _h(i, 20 + k))
            md.box(ax - .6, y + .06, az - .45, ax + .6, y + .8, az + .45, 'plastic_white')
            for fx in (-.5, .5):
                md.box(ax + fx - .05, y, az - .35, ax + fx + .05, y + .06, az + .35, 'steel_dark')
            md.box(ax - .45, y + .8, az - .3, ax + .45, y + .86, az + .3, 'steel_dark')
        # antenna mast with an aviation lamp
        mx, mz = x0 + w * (.7 + .2 * _h(i, 25)), z0 + d * (.15 + .2 * _h(i, 26))
        md.tube((mx, y, mz), (mx, y + 4.2, mz), .03, 'steel_dark', segments=5)
        md.tube((mx - .5, y + 3.6, mz), (mx + .5, y + 3.6, mz), .02, 'steel_dark', segments=4)
        md.box(mx - .06, y + 4.2, mz - .06, mx + .06, y + 4.3, mz + .06, 'neon_tube', col=_c((1, .12, .1), .9))
        crossed_glow(md, (mx, y + 4.25, mz), 1.2, (1, .1, .08), .4)


# --- interior fill: shop light as additive cards on the floor and the inner walls (real lights are budgeted) ------------
def room_glow(md, r):
    x0, z0, x1, z1 = r['rect']
    y, col, k, top = r['y'], r['col'], r['k'], r['top']
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    ground_card(md, x0 - .4, z0 - .4, x1 + .4, z1 + .4, y + .035, 'neon_glow', _c(col, .55 * k))
    ground_card(md, cx - (x1 - x0) * .3, cz - (z1 - z0) * .3, cx + (x1 - x0) * .3, cz + (z1 - z0) * .3, y + .04, 'neon_glow', _c(col, .35 * k))
    # light bouncing off the floor onto the lower walls (kept below the window sills: no veil over the view out)
    for n, c, w in (((0, 1), (cx, 0, z0), x1 - x0), ((0, -1), (cx, 0, z1), x1 - x0), ((1, 0), (x0, 0, cz), z1 - z0), ((-1, 0), (x1, 0, cz), z1 - z0)):
        wall_quad(md, c, n, w * 1.1, 1.3, 'neon_glow', .03, uv=(0, .5, 1, 1), col=_c(col, .4 * k), y0=y)
    md.face_toward([(x0, top - .03, z0), (x1, top - .03, z0), (x1, top - .03, z1), (x0, top - .03, z1)], 'neon_glow', (0, -1, 0),
                   uv=[(0, 0), (1, 0), (1, 1), (0, 1)], col=_c(col, .3 * k))


# --- shop displays behind the perimeter glass ----------------------------------------------------------------------------
OUTWARD = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}


def displays(md, layout, mapping):
    for s in farmstead.farm(layout)['structures']:
        cell = mapping.get(s['id'])
        if not cell:
            continue
        side = s['id'][0]
        ox, oz = OUTWARD[side]
        for el in s['elements']:
            if el.get('kind') != 'glass':
                continue
            x0, y0, z0, x1, y1, z1 = el['box']
            depth = 2.2
            top = y1 + .25
            # the room: floor, ceiling, two sides, back wall (art); the glass is at the reveal's back
            # the room starts at the facade's outer face (the reveal covers the strip between it and the glass)
            if side in 'ns':
                g = (s['rect'][1] if side == 'n' else s['rect'][3]) + oz * .05     # past the frame boards on the outer face
                zb = g + oz * depth
                za, zc = sorted((g, zb))
                md.box(x0, 0.0, za, x1, .02, zc, 'interior_floor', skip=('ny', 'nx', 'px', 'nz', 'pz'))
                md.face_toward([(x0, top, za), (x1, top, za), (x1, top, zc), (x0, top, zc)], 'plaster', (0, -1, 0))
                for xx, sg in ((x0, 1), (x1, -1)):
                    md.face_toward([(xx, 0, za), (xx, 0, zc), (xx, top, zc), (xx, top, za)], 'interior_plaster', (sg, 0, 0))
                wall_quad(md, ((x0 + x1) / 2, 0, zb), (0, -oz), x1 - x0, top, 'neon_panels', 0, uv=art.panel_uv(cell), y0=0)
                md.box(x0 + .2, top - .05, za + .3, x1 - .2, top, za + .45, 'neon_tube', col=_c((1, .95, .9), .8))
            else:
                g = (s['rect'][0] if side == 'w' else s['rect'][2]) + ox * .05
                xb = g + ox * depth
                xa, xc = sorted((g, xb))
                md.box(xa, 0.0, z0, xc, .02, z1, 'interior_floor', skip=('ny', 'nx', 'px', 'nz', 'pz'))
                md.face_toward([(xa, top, z0), (xc, top, z0), (xc, top, z1), (xa, top, z1)], 'plaster', (0, -1, 0))
                for zz, sg in ((z0, 1), (z1, -1)):
                    md.face_toward([(xa, 0, zz), (xc, 0, zz), (xc, top, zz), (xa, top, zz)], 'interior_plaster', (0, 0, sg))
                wall_quad(md, (xb, 0, (z0 + z1) / 2), (-ox, 0), z1 - z0, top, 'neon_panels', 0, uv=art.panel_uv(cell), y0=0)
            # light spilling out of the window onto the pavement
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            w = (x1 - x0) if side in 'ns' else (z1 - z0)
            wall_quad(md, (cx, (y0 + y1) / 2, cz), (-ox, -oz), w + .6, y1 - y0 + .6, 'neon_glow', .5, uv=(0, 0, 1, 1),
                      col=_c((1, .9, .8), .18))


# --- decorative windows, AC units ----------------------------------------------------------------------------------------
def _faces(layout, extra=()):
    """(rect, side, y0, y1, openings, struct id) of every exterior wall face that rises above the ground storey."""
    for s in list(farmstead.farm(layout)['structures']) + list(extra):
        for el in s['elements']:
            if el['t'] != 'wall' or not el.get('outside') or el['y'][1] < 6.0:
                continue
            yield el, s['id']


def windows(md, layout, avoid, extra=()):
    for el, sid in _faces(layout, extra):
        x0, z0, x1, z1 = el['rect']
        side = el['outside']
        n = OUTWARD[side]
        if side in 'ns':
            lo, hi = x0, x1
            plane = z0 if side == 'n' else z1
        else:
            lo, hi = z0, z1
            plane = x0 if side == 'w' else x1
        y0, y1 = el['y']
        first = y0 + .95 if y0 > 2 else 4.5
        storey = 3.2
        L = hi - lo
        bays = max(1, int((L - 1.2) / 2.7))
        span = L / bays
        opens = [(o['a'][0] - .35, o['a'][1] + .35, y0 + o.get('sill', 0) - .3, y0 + o['top'] + .3) for o in el.get('open', [])]
        y = first
        row = 0
        while y + 1.55 < y1 - .8:
            for b in range(bays):
                a = lo + span * (b + .5)
                w = min(1.35, span - .9)
                if w < .7:
                    continue
                rect = (a - w / 2, a + w / 2, y, y + 1.55)
                if any(r[0] < rect[1] and r[1] > rect[0] and r[2] < rect[3] and r[3] > rect[2] for r in opens):
                    continue
                if any(f == (side, round(plane, 2)) and r[0] < rect[1] + .3 and r[1] > rect[0] - .3 and r[2] < rect[3] + .3 and r[3] > rect[2] - .3
                       for f, r in avoid):
                    continue
                cx, cz = (a, plane) if side in 'ns' else (plane, a)
                c = (cx, y + .775, cz)
                hsh = _h(cx, y, cz, len(sid))
                wall_quad(md, c, n, w + .16, 1.55 + .16, 'concrete_trim', .03)
                md.box(*_proud_box(c, n, w + .3, .07, .09, y - .1), 'concrete_trim')
                cell = int(hsh * 16)
                lit = cell < 12
                bright = .55 + .45 * _h(cx * 3, y, cz) if lit else .7
                wall_quad(md, c, n, w, 1.55, 'neon_windows', .045, uv=art.window_uv(cell), col=_c((1, 1, 1), bright))
                if _h(cz, y * 7, cx) < .22 and y < 12:
                    # an AC unit hanging under the sill
                    ac = (cx, y - .55, cz)
                    md.box(*_proud_box(ac, n, .8, .42, .5, y - .8), 'plastic_white')
                    wall_quad(md, (ac[0] + n[0] * .42, ac[1], ac[2] + n[1] * .42), n, .5, .38, 'steel_dark', .012, y0=y - .76)
            y += storey
            row += 1


def _proud_box(c, n, w, depth, h, bottom):
    """Box args (x0, y0, z0, x1, y1, z1) for something of width w standing `depth` out from a wall plane at c."""
    nx, nz = n
    if abs(nz) > .5:
        za, zb = sorted((c[2], c[2] + nz * depth))
        return (c[0] - w / 2, bottom, za, c[0] + w / 2, bottom + h, zb)
    xa, xb = sorted((c[0], c[0] + nx * depth))
    return (xa, bottom, c[2] - w / 2, xb, bottom + h, c[2] + w / 2)


def _avoid(spec):
    """Face rects (side, plane) -> (a0, a1, y0, y1) taken by signs, blades and tubes: windows keep clear of them."""
    out = []
    side_of = {(0, -1): 'n', (0, 1): 's', (-1, 0): 'w', (1, 0): 'e'}
    for s in spec['signs'] + spec['blades'] + spec.get('vista_signs', []):
        side = side_of[tuple(s['n'])]
        plane = s['c'][2] if side in 'ns' else s['c'][0]
        a = s['c'][0] if side in 'ns' else s['c'][2]
        w = s['w'] if 'depth' in s else .5
        out.append(((side, round(plane, 2)), (a - w / 2, a + w / 2, s['c'][1] - s['h'] / 2, s['c'][1] + s['h'] / 2)))
    for t in spec['tubes']:
        side = side_of[tuple(t['n'])]
        xs = [p[0] for p in t['pts']]
        zs = [p[2] for p in t['pts']]
        ys = [p[1] for p in t['pts']]
        plane = round(sum(zs) / len(zs) if side in 'ns' else sum(xs) / len(xs), 0)
        a0, a1 = (min(xs), max(xs)) if side in 'ns' else (min(zs), max(zs))
        for pl in (plane - .5, plane, plane + .5):
            out.append(((side, round(pl, 2)), (a0, a1, min(ys), max(ys))))
    # snap planes to the nearest wall plane value used by _faces (signs sit on the plane they name)
    return out


# --- skyline --------------------------------------------------------------------------------------------------------------
def skyline(md):
    """Distant towers around the block: dark storeys with lit windows, red aviation lights and a few big signs."""
    towers = []
    for i in range(30):
        a = i / 30 * 2 * math.pi + _h(i, 1) * .15
        r = 36 + _h(i, 2) * 26
        cx, cz = math.sin(a) * r, -math.cos(a) * r
        w = 7 + _h(i, 3) * 9
        d = 7 + _h(i, 4) * 9
        h = 18 + _h(i, 5) * 34
        towers.append((cx, cz, w, d, h))
    for i, (cx, cz, w, d, h) in enumerate(towers):
        k = .32 + .3 * _h(i, 6)
        md.box(cx - w / 2, 0, cz - d / 2, cx + w / 2, h, cz + d / 2, 'neon_skyline', skip=('ny', 'py'), col=_c((1, 1, 1), k))
        md.face_toward([(cx - w / 2, h, cz - d / 2), (cx + w / 2, h, cz - d / 2), (cx + w / 2, h, cz + d / 2), (cx - w / 2, h, cz + d / 2)],
                       'steel_dark', (0, 1, 0))
        if _h(i, 7) < .6:
            for sx, sz in ((-1, -1), (1, 1)):
                p = (cx + sx * (w / 2 - .4), h + .3, cz + sz * (d / 2 - .4))
                md.box(p[0] - .12, h, p[2] - .12, p[0] + .12, h + .35, p[2] + .12, 'neon_tube', col=_c((1, .12, .1), .9))
                crossed_glow(md, p, 1.6, (1, .1, .08), .45)
        if _h(i, 8) < .35:
            # a big sign on the face toward the block
            n = (0, 1) if cz < -20 and abs(cx) < abs(cz) else (0, -1) if cz > 20 and abs(cx) < abs(cz) else (1, 0) if cx < 0 else (-1, 0)
            name = ['billboard', 'billboard2', 'arcade', 'karaoke', 'hotel_v', 'hostel_v', 'ramen_v', 'pillar'][int(_h(i, 9) * 8)]
            asp = art.aspect(name)
            fw = min(w, d) * .8
            fh = fw / asp
            if fh > h * .6:
                fh = h * .5
                fw = fh * asp
            face_c = (cx + n[0] * w / 2, h - fh / 2 - 1.5, cz + n[1] * d / 2)
            mat, uv = art.art_uv(name)
            wall_quad(md, face_c, n, fw, fh, mat, .05, uv=uv)
            wall_quad(md, face_c, n, fw * 1.4 + 2, fh * 1.4 + 2, 'neon_glow', .2, uv=(0, 0, 1, 1), col=_c((1, .5, .9), .3))


# --- vertex-colour light bake ------------------------------------------------------------------------------------------
def _subdivide(md, keep, size=1.0):
    """Split large quads whose material is lit into a grid of at most `size` m cells (bilinear pts/uv/col)."""
    out = MeshData()
    for f, m, uv, col in zip(md.faces, md.face_mat, md.face_uv, md.face_col):
        pts = [md.verts[i] for i in f]
        if m in NO_BAKE or len(pts) != 4 or not keep(pts):
            out.face(pts, m, uv=uv, col=col)
            continue
        lu = max(math.dist(pts[0], pts[1]), math.dist(pts[3], pts[2]))
        lv = max(math.dist(pts[0], pts[3]), math.dist(pts[1], pts[2]))
        nu, nv = min(14, max(1, math.ceil(lu / size))), min(14, max(1, math.ceil(lv / size)))
        if nu == 1 and nv == 1:
            out.face(pts, m, uv=uv, col=col)
            continue

        def lerp4(vals, s, t):
            a = [vals[0][k] + (vals[1][k] - vals[0][k]) * s for k in range(len(vals[0]))]
            b = [vals[3][k] + (vals[2][k] - vals[3][k]) * s for k in range(len(vals[0]))]
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(len(a)))
        for i in range(nu):
            for j in range(nv):
                corners = [(i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)]
                out.face([lerp4(pts, s, t) for s, t in corners], m, uv=[lerp4(uv, s, t) for s, t in corners],
                         col=[lerp4(col, s, t) for s, t in corners])
    return out


def bake(md, layout, sources, covered=()):
    """Vertex colours: ambient with contact darkening, plus coloured pools from every bake source."""
    rooms = [s['room'] for s in sources if s.get('room')]

    def in_rect(p, r, m=.05):
        return r[0] - m <= p[0] <= r[2] + m and r[1] - m <= p[2] <= r[3] + m

    def near(pts):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        zs = [p[2] for p in pts]
        for s in sources:
            x, y, z = s['pos']
            dx = max(min(xs) - x, 0, x - max(xs))
            dy = max(min(ys) - y, 0, y - max(ys))
            dz = max(min(zs) - z, 0, z - max(zs))
            if dx * dx + dy * dy + dz * dz < s['r'] * s['r']:
                return True
        return min(ys) < 1.2 and max(ys) - min(ys) > 1.5   # wall feet get the contact gradient
    sub = _subdivide(md, near)
    from meshkit import face_normal
    cols = []
    for f, m, col in zip(sub.faces, sub.face_mat, sub.face_col):
        pts = [sub.verts[i] for i in f]
        if m in NO_BAKE:
            cols.append(col)
            continue
        n = face_normal(pts)
        fc = []
        for p, c0 in zip(pts, col):
            amb = AMBIENT
            if abs(n[1]) < .5:
                amb *= .72 + .28 * min(1.0, max(0.0, p[1]) / .9)      # damp, dark wall feet
            elif n[1] < -.5:
                amb *= .78                                              # ceilings and undersides
            elif any(in_rect(p, r, -.02) for r in covered):
                amb *= .82                                              # ground under balconies and passages
            r, g, b = amb, amb, amb
            inside = [rr for rr in rooms if in_rect(p, rr)]
            for s in sources:
                room = s.get('room')
                if room is not None and not in_rect(p, room):
                    continue
                if room is None and inside:
                    continue
                lx, ly, lz = s['pos'][0] - p[0], s['pos'][1] - p[1], s['pos'][2] - p[2]
                d = math.sqrt(lx * lx + ly * ly + lz * lz)
                if d >= s['r']:
                    continue
                lam = (n[0] * lx + n[1] * ly + n[2] * lz) / max(d, 1e-3)
                if lam <= -.05:
                    continue
                k = s['i'] * (1 - d / s['r']) ** 2 * (.35 + .65 * max(0.0, lam))
                r, g, b = r + s['col'][0] * k * .7, g + s['col'][1] * k * .7, b + s['col'][2] * k * .7
            fc.append((min(1.0, r * c0[0]), min(1.0, g * c0[1]), min(1.0, b * c0[2]), 1.0))
        cols.append(fc)
    sub.face_col = cols
    return sub


# --- assembly ------------------------------------------------------------------------------------------------------------
def dressing(layout, floor):
    spec = layout['neon']
    md = MeshData()
    for s in spec['signs'] + spec.get('vista_signs', []):
        sign(md, s, floor)
    for b in spec['blades']:
        blade(md, b)
    for b in spec['billboards']:
        billboard(md, b)
    for t in spec['tubes']:
        tube_line(md, t['pts'], t['col'], t['n'])
    for l in spec['lanterns']:
        lantern_string(md, l)
    for c in spec['cables']:
        cable(md, c['a'], c['b'], c['sag'])
    for p in spec['pipes']:
        pipe(md, p)
    for g in spec['graffiti']:
        wall_quad(md, g['c'], g['n'], g['w'], g['h'], 'neon_graffiti', .008, uv=art.graffiti_uv(g['cell']))
    for g in spec.get('grime', []):
        grime(md, g)
    for g in spec.get('cracks', []):
        crack(md, g, floor)
    for g in spec.get('noren', []):
        noren(md, g)
    for g in spec.get('beams', []):
        beam(md, g)
    for g in spec.get('prop_glows', []):
        prop_glow(md, g, floor)
    for f in spec.get('fire_escapes', []):
        fire_escape(md, f)
    for sp in spec.get('spans', []):
        span(md, sp)
    rooftops(md, [tuple(r) for r in spec.get('rooftops', [])])
    lamps(md, spec['lamps'])
    for r in spec.get('rooms', []):
        room_glow(md, r)
    displays(md, layout, spec['displays'])
    skyline(md)
    return md


def vista_mesh(layout):
    md = MeshData()
    for s in layout['neon'].get('vista', []):
        for p in farmstead.structure_parts(s):
            md.box(*p.box, p.mat, skip=('ny',) if p.box[1] <= .001 else (), mats=p.mats or None)
    return md


def window_mesh(layout):
    md = MeshData()
    windows(md, layout, _avoid(layout['neon']), extra=layout['neon'].get('vista', []))
    return md
