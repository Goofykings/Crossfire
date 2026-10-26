"""Industrial Complex props: containers, pallets, drums, barriers, lighting, plant and vehicles.

Same conventions as props.py: origin at the centre of the footprint on the ground, front facing north (-z), sizes and
colliders listed in catalog.PROPS. Pieces that touch keep their faces off each other's planes (no z-fighting): ribs and
bars skip the face they would share with the panel behind them, and parts stop where a frame member begins.
"""
from __future__ import annotations

import math
import random

from meshkit import MeshData, Transform, grime_fn

def disc(md: MeshData, cx: float, y: float, cz: float, r: float, mat: str, up: bool = True, segments: int = 16) -> None:
    pts = [(cx + math.cos(2 * math.pi * k / segments) * r, y, cz - math.sin(2 * math.pi * k / segments) * r) for k in range(segments)]
    md.face_toward(pts, mat, (0, 1 if up else -1, 0))


# --- shipping containers ---------------------------------------------------------------------------
C_LEN, C_HGT, C_WID = 6.06, 2.59, 2.44
RIB_PITCH = 0.28
RIB_DEPTH = 0.035


def _corrugated(md: MeshData, along: str, a0: float, a1: float, plane: float, outward: int, y0: float, y1: float,
                mat: str) -> None:
    """Trapezoid-corrugated panel between a0..a1 along `along` ('x' or 'z'), standing on the plane `plane` of the other
    horizontal axis, ribs pressed `outward` (+1/-1). Built as one strip of quads so it never overlaps the frame."""
    n = max(1, int(round((a1 - a0) / RIB_PITCH)))
    step = (a1 - a0) / n
    prof = []
    for i in range(n):
        s = a0 + i * step
        # flat (inner) - ramp - flat (outer) - ramp
        prof += [(s, 0.0), (s + step * 0.18, 0.0), (s + step * 0.32, RIB_DEPTH), (s + step * 0.68, RIB_DEPTH),
                 (s + step * 0.82, 0.0)]
    prof.append((a1, 0.0))

    def P(s, d, y):
        off = plane + outward * d
        return (s, y, off) if along == "x" else (off, y, s)

    toward = (0, 0, outward) if along == "x" else (outward, 0, 0)
    for (sa, da), (sb, db) in zip(prof, prof[1:]):
        md.face_toward([P(sa, da, y0), P(sb, db, y0), P(sb, db, y1), P(sa, da, y1)], mat, toward)


def container(mat: str, doors_open: bool = False) -> MeshData:
    """ISO 20 ft container: corrugated walls, frame rails and posts, corner castings, door end with locking bars.
    Long axis along x, doors at the +x end."""
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, C_HGT, 0.22))
    L, H, W = C_LEN / 2, C_HGT, C_WID / 2
    post, rail_b, rail_t = 0.16, 0.16, 0.1
    frame = mat
    # bottom and top side rails (long sides)
    for zs in (-1, 1):
        z0, z1 = (zs * W - 0.0, zs * W - zs * 0.12)
        md.box(-L + post, 0.0, min(z0, z1), L - post, rail_b, max(z0, z1), frame, skip=("nx", "px"))
        md.box(-L + post, H - rail_t, min(z0, z1), L - post, H, max(z0, z1), frame, skip=("nx", "px"))
    # end rails (top/bottom across the ends)
    for xs in (-1, 1):
        x0, x1 = sorted((xs * L, xs * L - xs * 0.12))
        md.box(x0, 0.0, -W + post, x1, rail_b + 0.06, W - post, frame, skip=("nz", "pz"))
        md.box(x0, H - rail_t - 0.08, -W + post, x1, H, W - post, frame, skip=("nz", "pz"))
    # corner posts and castings
    for xs in (-1, 1):
        for zs in (-1, 1):
            x0, x1 = sorted((xs * L, xs * (L - post)))
            z0, z1 = sorted((zs * W, zs * (W - post)))
            md.box(x0, 0.18, z0, x1, H - 0.18, z1, frame)
            for y0 in (0.0, H - 0.18):
                cx0, cx1 = sorted((xs * (L + 0.004), xs * (L - 0.178)))
                cz0, cz1 = sorted((zs * (W + 0.004), zs * (W - 0.178)))
                md.box(cx0, y0 + (0.0 if y0 == 0 else 0.004), cz0, cx1, y0 + 0.176, cz1, "steel_dark")
    # long walls: corrugated, set in 4 cm from the rails' outer face
    for zs in (-1, 1):
        _corrugated(md, "x", -L + post, L - post, zs * (W - 0.05), zs, rail_b, H - rail_t, mat)
    # closed end (-x): corrugated across z
    _corrugated(md, "z", -W + post, W - post, -(L - 0.05), -1, rail_b + 0.06, H - rail_t - 0.08, mat)
    # roof panel just below the top rails, floor underside
    md.face_toward([(-L + 0.12, H - 0.03, -W + 0.12), (L - 0.12, H - 0.03, -W + 0.12), (L - 0.12, H - 0.03, W - 0.12),
                    (-L + 0.12, H - 0.03, W - 0.12)], mat, (0, 1, 0))
    md.face_toward([(-L, 0.02, -W), (L, 0.02, -W), (L, 0.02, W), (-L, 0.02, W)], "steel_dark", (0, -1, 0))
    # door end (+x): two leaves with vertical stiffeners, 4 locking bars with handles
    xd = L - 0.06
    for k, (za, zb) in enumerate(((-W + post, -0.008), (0.008, W - post))):
        md.box(xd - 0.03, rail_b + 0.06, za, xd, H - rail_t - 0.08, zb, mat, skip=("nx",))
        for t in (0.25, 0.75):
            zz = za + (zb - za) * t
            md.box(xd, rail_b + 0.1, zz - 0.04, xd + 0.025, H - rail_t - 0.12, zz + 0.04, mat, skip=("nx",))
        for t in (0.12, 0.38) if k == 0 else (0.62, 0.88):
            zz = -W + post + (2 * (W - post)) * t
            md.tube((xd + 0.06, 0.22, zz), (xd + 0.06, H - 0.2, zz), 0.022, "galvanized", segments=6)
            for y in (0.32, H - 0.3):
                md.box(xd + 0.025, y - 0.04, zz - 0.05, xd + 0.09, y + 0.04, zz + 0.05, "steel_dark", skip=("nx",))
            ha, hb = sorted((zz - 0.02 * (1 if k == 0 else -1), zz + (0.18 if k == 0 else -0.18)))
            md.box(xd + 0.03, 1.1, ha, xd + 0.11, 1.16, hb, "galvanized", skip=("nx",))
    del doors_open
    return md


def container_stack(bottom: str, top: str) -> MeshData:
    md = MeshData()
    md.merge(container(bottom))
    md.merge(container(top), Transform(0.12, C_HGT + 0.002, -0.03, 0.015))
    return md


# --- pallets and goods ------------------------------------------------------------------------------
def pallet(seed: int = 0) -> MeshData:
    """EUR pallet (1.2 x 0.8 m): 9 blocks, 3 stringer boards, 5 deck boards."""
    md = MeshData()
    rnd = random.Random(seed)
    m = "wood_pallet"
    W, D = 0.6, 0.4
    for x in (-W + 0.05, 0.0, W - 0.05):
        for z in (-D + 0.05, 0.0, D - 0.05):
            md.box(x - 0.072, 0.0, z - 0.05, x + 0.072, 0.078, z + 0.05, "wood_crate")
    for z in (-D + 0.05, 0.0, D - 0.05):
        md.box(-W, 0.078, z - 0.05, W, 0.1, z + 0.05, m, skip=("ny",))
    for i in range(5):
        z = -D + 0.05 + i * (2 * D - 0.1) / 4
        dx = rnd.uniform(-0.004, 0.004)
        md.box(-W + dx, 0.1, z - 0.048, W + dx, 0.122, z + 0.048, m, skip=("ny",))
    return md


def pallet_stack(n: int = 6) -> MeshData:
    md = MeshData()
    rnd = random.Random(n)
    for i in range(n):
        md.merge(pallet(i), Transform(rnd.uniform(-0.03, 0.03), i * 0.1225, rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03)))
    return md


def _carton(md: MeshData, x0, y0, z0, x1, y1, z1) -> None:
    md.box(x0, y0, z0, x1, y1, z1, "cardboard")
    # packing tape across the top
    cx = (x0 + x1) / 2
    md.box(cx - 0.025, y1, z0 - 0.002, cx + 0.025, y1 + 0.003, z1 + 0.002, "plastic_wrap", skip=("ny",))


def pallet_goods(seed: int = 3) -> MeshData:
    """Pallet with three layers of cartons (cover up to chest height)."""
    md = pallet(seed)
    rnd = random.Random(seed)
    y = 0.122
    for layer in range(3):
        h = rnd.choice((0.3, 0.36, 0.42))
        for i in range(3):
            for j in range(2):
                x0 = -0.6 + i * 0.4 + 0.006
                z0 = -0.4 + j * 0.4 + 0.006
                if layer == 2 and rnd.random() < 0.25:
                    continue
                _carton(md, x0, y, z0, x0 + 0.388, y + h - 0.004, z0 + 0.388)
        y += h
    return md


def pallet_wrapped(seed: int = 5) -> MeshData:
    """Pallet load shrink-wrapped into a block."""
    md = pallet(seed)
    md.box(-0.59, 0.122, -0.39, 0.59, 1.32, 0.39, "plastic_wrap")
    for y in (0.4, 0.85):
        md.box(-0.596, y, -0.396, 0.596, y + 0.05, 0.396, "plastic_black", skip=("ny", "py"))
    return md


def crate_large(w: float = 1.6, h: float = 1.3, d: float = 1.2) -> MeshData:
    md = MeshData()
    b = 0.09
    x, z = w / 2, d / 2
    inset = 0.014
    md.box(-x + inset, 0.06, -z + inset, x - inset, h - inset, z - inset, "wood_crate")
    for (px, pz) in ((-x, -z), (x - b, -z), (-x, z - b), (x - b, z - b)):
        md.box(px, 0.0, pz, px + b, h, pz + b, "wood_dark")
    for y in (0.0, h - b):
        md.box(-x + b, y, -z, x - b, y + b, -z + b, "wood_dark")
        md.box(-x + b, y, z - b, x - b, y + b, z, "wood_dark")
        md.box(-x, y, -z + b, -x + b, y + b, z - b, "wood_dark")
        md.box(x - b, y, -z + b, x, y + b, z - b, "wood_dark")
    # skids
    for zz in (-z + 0.2, z - 0.2):
        md.box(-x, 0.0, zz - 0.05, x, 0.06, zz + 0.05, "wood_dark", skip=("nx", "px"))
    # stencil board on the front
    md.box(-0.35, h * 0.45, -z - 0.012, 0.35, h * 0.45 + 0.2, -z + inset, "wood_pallet", skip=("pz",))
    return md


# --- drums, tanks, cylinders ------------------------------------------------------------------------
def oil_drum(mat: str = "steel_blue") -> MeshData:
    md = MeshData()
    r, h = 0.29, 0.88
    md.cylinder((0, 0, 0), r, h, mat, segments=16, caps=(False, False))
    # lid recessed below the chime, bottom just above the ground
    disc(md, 0, h - 0.012, 0, r - 0.002, "galvanized")
    disc(md, 0, 0.004, 0, r - 0.002, mat, up=False)
    # chimes and rolling hoops, just proud of the shell
    for y, hh in ((0.0, 0.025), (h - 0.025, 0.025), (h * 0.33, 0.02), (h * 0.66, 0.02)):
        md.cylinder((0, y, 0), r + 0.008, hh, mat, segments=16, caps=(False, False))
    md.cylinder((0.14, h - 0.012, 0.05), 0.03, 0.015, "steel_dark", segments=8, caps=(False, True))
    return md


def drum_group() -> MeshData:
    md = pallet(7)
    mats = ("steel_blue", "steel_red", "steel_blue", "steel_yellow")
    for (x, z), m in zip(((-0.3, -0.2), (0.3, -0.2), (-0.3, 0.22), (0.3, 0.22)), mats):
        md.merge(oil_drum(m), Transform(x, 0.122, z, x * z * 3.0))
    return md


def ibc_tank() -> MeshData:
    """1000 l intermediate bulk container: white tank in a galvanised cage on a steel pallet."""
    md = MeshData()
    W, D, H = 0.6, 0.5, 1.16
    md.box(-W, 0.0, -D, W, 0.14, D, "steel_dark")
    md.box(-W + 0.05, 0.14, -D + 0.05, W - 0.05, H - 0.06, D - 0.05, "plastic_white")
    md.cylinder((0.0, H - 0.06, 0.0), 0.12, 0.06, "plastic_black", segments=10)
    md.tube((0.0, 0.25, -D + 0.08), (0.0, 0.25, -D - 0.12), 0.035, "plastic_black", segments=8)
    # cage: vertical and horizontal bars
    g = "galvanized"
    for x in [-W + 0.02 + i * (2 * W - 0.04) / 6 for i in range(7)]:
        for z in (-D + 0.02, D - 0.02):
            md.tube((x, 0.14, z), (x, H, z), 0.012, g, segments=5, caps=False)
    for z in [-D + 0.02 + i * (2 * D - 0.04) / 5 for i in range(1, 5)]:
        for x in (-W + 0.02, W - 0.02):
            md.tube((x, 0.14, z), (x, H, z), 0.012, g, segments=5, caps=False)
    for y in (0.5, 0.85, H - 0.01):
        for (a, b) in (((-W + 0.02, y, -D + 0.02), (W - 0.02, y, -D + 0.02)), ((-W + 0.02, y, D - 0.02), (W - 0.02, y, D - 0.02)),
                       ((-W + 0.02, y, -D + 0.02), (-W + 0.02, y, D - 0.02)), ((W - 0.02, y, -D + 0.02), (W - 0.02, y, D - 0.02))):
            md.tube(a, b, 0.012, g, segments=5, caps=False)
    return md


def gas_cage() -> MeshData:
    """Gas cylinder store: steel frame with mesh panels, a sloped roof and six cylinders."""
    md = MeshData()
    W, D, H = 0.8, 0.4, 2.0
    s = "steel_grey"
    for (x, z) in ((-W, -D), (W, -D), (-W, D), (W, D)):
        md.box(x - 0.03, 0.0, z - 0.03, x + 0.03, H, z + 0.03, s)
    # mesh on three sides (back and ends), open-looking front with a mesh door
    for (pts, toward) in (([(-W + 0.03, 0.05, D), (W - 0.03, 0.05, D), (W - 0.03, H - 0.05, D), (-W + 0.03, H - 0.05, D)], (0, 0, 1)),
                          ([(-W, 0.05, -D + 0.03), (-W, 0.05, D - 0.03), (-W, H - 0.05, D - 0.03), (-W, H - 0.05, -D + 0.03)], (-1, 0, 0)),
                          ([(W, 0.05, -D + 0.03), (W, 0.05, D - 0.03), (W, H - 0.05, D - 0.03), (W, H - 0.05, -D + 0.03)], (1, 0, 0)),
                          ([(-W + 0.03, 0.05, -D), (W - 0.03, 0.05, -D), (W - 0.03, H - 0.25, -D), (-W + 0.03, H - 0.25, -D)], (0, 0, -1))):
        md.face_toward(pts, "chainlink", toward)
    md.box(-W - 0.08, H, -D - 0.12, W + 0.08, H + 0.04, D + 0.06, "cladding_grey")
    md.box(-W + 0.03, H - 0.25, -D - 0.02, W - 0.03, H - 0.18, -D + 0.02, s)
    cols = ("steel_green", "steel_grey", "steel_red", "steel_green", "steel_blue", "steel_grey")
    for i, c in enumerate(cols):
        x = -W + 0.2 + i * (2 * W - 0.4) / 5
        md.cylinder((x, 0.0, 0.05), 0.11, 1.35, c, segments=10, caps=(False, False))
        md.cylinder((x, 1.35, 0.05), 0.11, 0.12, c, segments=10, radius_top=0.05, caps=(False, True))
        md.cylinder((x, 1.47, 0.05), 0.035, 0.08, "galvanized", segments=6)
    md.tube((-W, 1.0, -0.1), (W, 1.0, -0.1), 0.012, "steel_dark", segments=4)
    return md


def cable_reel() -> MeshData:
    """Wooden cable drum standing on its rims (axis along x)."""
    md = MeshData()
    R, w = 0.7, 0.5
    for x in (-w, w - 0.06):
        md.tube((x, R, 0), (x + 0.06, R, 0), R, "wood_pallet", segments=16)
    md.tube((-w + 0.06, R, 0), (w - 0.06, R, 0), 0.5, "plastic_black", segments=16, caps=False)
    md.tube((-w - 0.02, R, 0), (w + 0.02, R, 0), 0.08, "galvanized", segments=8)
    return md


def tire_stack() -> MeshData:
    md = MeshData()
    for i in range(3):
        y = i * 0.26
        R, r = 0.42, 0.22
        seg = 16
        ring_o = [(math.cos(2 * math.pi * k / seg) * R, -math.sin(2 * math.pi * k / seg) * R) for k in range(seg)]
        ring_i = [(math.cos(2 * math.pi * k / seg) * r, -math.sin(2 * math.pi * k / seg) * r) for k in range(seg)]
        ox = (0.03 if i % 2 else -0.02)
        for k in range(seg):
            j = (k + 1) % seg
            (ax, az), (bx, bz) = ring_o[k], ring_o[j]
            (cx, cz), (dx, dz) = ring_i[k], ring_i[j]
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            md.face_toward([(ax + ox, y, az), (bx + ox, y, bz), (bx + ox, y + 0.25, bz), (ax + ox, y + 0.25, az)], "rubber", (mx, 0, mz))
            md.face_toward([(dx + ox, y, dz), (cx + ox, y, cz), (cx + ox, y + 0.25, cz), (dx + ox, y + 0.25, dz)], "rubber", (-mx, 0, -mz))
            md.face_toward([(ax + ox, y + 0.25, az), (bx + ox, y + 0.25, bz), (dx + ox, y + 0.25, dz), (cx + ox, y + 0.25, cz)],
                           "rubber", (0, 1, 0))
    return md


# --- barriers, bollards, lighting ---------------------------------------------------------------------
def jersey_barrier(L: float = 2.0) -> MeshData:
    """Concrete safety barrier (New Jersey profile) along x."""
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 0.8, 0.3))
    prof = [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.08), (0.2, 0.33), (0.08, 0.81), (-0.08, 0.81), (-0.2, 0.33), (-0.3, 0.08)]
    m = "concrete_wall_stained"
    x0, x1 = -L / 2, L / 2
    for (za, ya), (zb, yb) in zip(prof, prof[1:] + prof[:1]):
        if ya == 0 and yb == 0:
            continue
        nz, ny = (yb - ya), -(zb - za)
        md.face_toward([(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)], m, (0, ny, nz))
    for x, sgn in ((x0, -1), (x1, 1)):
        md.face_toward([(x, y, z) for (z, y) in prof], m, (sgn, 0, 0))
    return md


def bollard(mat: str = "steel_yellow") -> MeshData:
    md = MeshData()
    md.cylinder((0, 0, 0), 0.1, 0.95, mat, segments=12, caps=(False, False))
    md.sphere((0, 0.95, 0), 0.1, mat, rings=4, segments=12, squash=0.5)
    md.cylinder((0, 0.62, 0), 0.104, 0.08, "steel_dark", segments=12, caps=(False, False))
    md.cylinder((0, 0.78, 0), 0.104, 0.08, "steel_dark", segments=12, caps=(False, False))
    return md


def floodlight_pole(h: float = 8.0) -> MeshData:
    md = MeshData()
    md.box(-0.3, -0.05, -0.3, 0.3, 0.25, 0.3, "concrete_trim", skip=("ny",))
    md.cylinder((0, 0.25, 0), 0.12, h - 0.25, "galvanized", segments=10, radius_top=0.075, caps=(False, True))
    md.box(-0.06, 0.6, -0.125, 0.06, 1.0, -0.1, "galvanized", skip=("pz",))
    # head frame with three floods aimed down and forward (-z)
    md.box(-0.8, h - 0.06, -0.06, 0.8, h + 0.02, 0.06, "steel_dark")
    for x in (-0.6, 0.0, 0.6):
        md.tube((x, h - 0.02, 0.0), (x, h - 0.2, -0.12), 0.02, "steel_dark", segments=5)
        lamp = MeshData()
        lamp.box(-0.22, -0.1, -0.06, 0.22, 0.1, 0.1, "steel_dark")
        lamp.box(-0.19, -0.075, -0.07, 0.19, 0.075, -0.06, "lamp_led", skip=("pz",))
        for k in range(4):
            lamp.box(-0.2 + k * 0.13, -0.09, 0.1, -0.17 + k * 0.13, 0.09, 0.16, "steel_dark", skip=("nz",))
        # tilt about x by 35 degrees so the lens (local -z) looks down and forward
        a = math.radians(-35)
        lamp.verts = [(px, py * math.cos(a) - pz * math.sin(a), py * math.sin(a) + pz * math.cos(a)) for (px, py, pz) in lamp.verts]
        md.merge(lamp, Transform(x, h - 0.3, -0.18))
    return md


# --- plant and vehicles -------------------------------------------------------------------------------
def electrical_cabinet() -> MeshData:
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 1.6, 0.25))
    W, D, H = 0.6, 0.25, 1.55
    md.box(-W - 0.05, 0.0, -D - 0.05, W + 0.05, 0.12, D + 0.05, "concrete_trim", skip=("ny",))
    md.box(-W, 0.12, -D, W, H, D, "steel_grey")
    md.box(-W - 0.04, H, -D - 0.06, W + 0.04, H + 0.05, D + 0.04, "steel_grey")
    for x0, x1 in ((-W + 0.04, -0.01), (0.01, W - 0.04)):
        md.box(x0, 0.2, -D - 0.012, x1, H - 0.06, -D, "steel_grey", skip=("pz",))
        hx = x1 - 0.06 if x0 < 0 else x0 + 0.06
        md.box(hx - 0.012, 0.85, -D - 0.04, hx + 0.012, 0.95, -D - 0.012, "steel_dark", skip=("pz",))
    for k in range(5):
        y = 0.3 + k * 0.05
        md.box(0.12, y, -D - 0.02, 0.46, y + 0.02, -D - 0.012, "steel_dark", skip=("pz",))
    # warning triangle
    md.face_toward([(-0.42, 1.2, -D - 0.02), (-0.2, 1.2, -D - 0.02), (-0.31, 1.39, -D - 0.02)], "steel_yellow", (0, 0, -1))
    return md


def transformer() -> MeshData:
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 2.2, 0.3))
    W, D = 0.75, 0.55
    md.box(-1.0, -0.05, -0.8, 1.0, 0.2, 0.8, "concrete_trim", skip=("ny",))
    md.box(-W, 0.2, -D, W, 1.75, D, "steel_green")
    md.box(-W - 0.05, 1.75, -D - 0.05, W + 0.05, 1.85, D + 0.05, "steel_green")
    # radiator fins on both long sides
    for zs in (-1, 1):
        for i in range(9):
            x = -W + 0.12 + i * (2 * W - 0.24) / 8
            z0, z1 = sorted((zs * D, zs * (D + 0.22)))
            md.box(x - 0.012, 0.35, z0, x + 0.012, 1.6, z1, "steel_green", skip=("pz",) if zs < 0 else ("nz",))
    for x in (-0.45, 0.0, 0.45):
        md.cylinder((x, 1.85, 0.0), 0.06, 0.12, "steel_dark", segments=8)
        for k in range(4):
            md.cylinder((x, 1.97 + k * 0.07, 0.0), 0.075 - k * 0.004, 0.05, "ceramic", segments=10)
        md.cylinder((x, 2.25, 0.0), 0.02, 0.06, "galvanized", segments=6)
    md.box(-0.3, 0.9, -D - 0.01, 0.3, 1.3, -D, "steel_yellow", skip=("pz",))
    return md


def skip_bin() -> MeshData:
    """Open-top steel waste skip, tapered sides, lifting lugs, with rubble inside."""
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 1.5, 0.3))
    m = "steel_yellow"
    bx, bz, tx, tz, H = 1.3, 0.75, 1.8, 0.9, 1.4
    top = [(-tx, -tz), (tx, -tz), (tx, tz), (-tx, tz)]
    bot = [(-bx, -bz), (bx, -bz), (bx, bz), (-bx, bz)]
    for i in range(4):
        a, b = bot[i], bot[(i + 1) % 4]
        c, d = top[(i + 1) % 4], top[i]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        md.face_toward([(a[0], 0.05, a[1]), (b[0], 0.05, b[1]), (c[0], H, c[1]), (d[0], H, d[1])], m, (mid[0], 0, mid[1]))
        k = 0.92
        md.face_toward([(a[0] * k, 0.12, a[1] * k), (b[0] * k, 0.12, b[1] * k), (c[0] * k, H, c[1] * k), (d[0] * k, H, d[1] * k)], m,
                       (-mid[0], 0, -mid[1]))
        md.face_toward([(d[0], H, d[1]), (c[0], H, c[1]), (c[0] * k, H, c[1] * k), (d[0] * k, H, d[1] * k)], m, (0, 1, 0))
    md.box(-bx, 0.0, -bz, bx, 0.05, bz, "steel_dark", skip=("py",))
    md.face_toward([(-bx * 0.92, 0.12, -bz * 0.92), (bx * 0.92, 0.12, -bz * 0.92), (bx * 0.92, 0.12, bz * 0.92), (-bx * 0.92, 0.12, bz * 0.92)],
                   "steel_dark", (0, 1, 0))
    rnd = random.Random(4)
    for _ in range(9):
        x, z = rnd.uniform(-1.1, 1.1), rnd.uniform(-0.55, 0.55)
        w, h, d = rnd.uniform(0.2, 0.6), rnd.uniform(0.15, 0.5), rnd.uniform(0.2, 0.5)
        mat = rnd.choice(("wood_pallet", "concrete_trim", "cardboard", "plastic_black"))
        md.obox((x, 0.12 + h / 2 + rnd.uniform(0.2, 0.6), z), (w / 2, h / 2, d / 2), rnd.uniform(0, 3), mat)
    # lifting lugs on the long sides, standing off the sloped wall
    zw = bz + (tz - bz) * ((H - 0.4) / H)
    for x in (-1.2, 1.2):
        for zs in (-1, 1):
            z0, z1 = sorted((zs * (zw - 0.04), zs * (zw + 0.08)))
            md.box(x - 0.06, H - 0.5, z0, x + 0.06, H - 0.3, z1, "steel_dark")
    return md


def pipe_bundle() -> MeshData:
    md = MeshData()
    for x in (-1.0, 1.0):
        md.box(x - 0.1, 0.0, -0.6, x + 0.1, 0.15, 0.6, "wood_pole")
    rows = [(0.0, [-0.45, -0.15, 0.15, 0.45]), (0.26, [-0.3, 0.0, 0.3])]
    for i, (dy, zs) in enumerate(rows):
        for z in zs:
            mat = "galvanized" if (i + int(z * 10)) % 2 else "steel_red"
            md.tube((-1.5, 0.28 + dy, z), (1.5, 0.28 + dy, z), 0.13, mat, segments=12)
    return md


def shelving_rack() -> MeshData:
    """Pallet racking bay (2.7 m) with three beam levels, loaded with goods."""
    md = MeshData()
    W, D, H = 1.35, 0.55, 4.0
    for x in (-W, W - 0.08):
        for z in (-D, D - 0.08):
            md.box(x, 0.0, z, x + 0.08, H, z + 0.08, "steel_blue")
        # frame bracing between the front and back uprights
        for y0 in (0.3, 1.5, 2.7):
            a = (x + 0.04, y0, -D + 0.08)
            b = (x + 0.04, y0 + 1.0, D - 0.08)
            md.tube(a, b, 0.015, "steel_blue", segments=4)
    for y in (0.0, 1.45, 2.85):
        for z in (-D, D - 0.06):
            md.box(-W + 0.08, y + 0.1, z, W - 0.08, y + 0.22, z + 0.06, "steel_orange", skip=("nx", "px"))
        if y > 0:
            md.box(-W + 0.08, y + 0.1, -D + 0.06, W - 0.08, y + 0.12, D - 0.06, "metal_plate", skip=("nz", "pz"))
    rnd = random.Random(11)
    for y in (0.12, 1.57, 2.97):
        for x in (-0.65, 0.65):
            if rnd.random() < 0.8:
                load = pallet_goods(rnd.randint(0, 99)) if rnd.random() < 0.6 else pallet_wrapped(rnd.randint(0, 99))
                load.verts = [(px * 0.95, py * 0.9, pz) for (px, py, pz) in load.verts]
                md.merge(load, Transform(x, y, 0.0, rnd.uniform(-0.03, 0.03)))
    return md


def workbench() -> MeshData:
    md = MeshData()
    W, D = 1.0, 0.4
    for x in (-W + 0.05, W - 0.05):
        for z in (-D + 0.05, D - 0.05):
            md.box(x - 0.03, 0.0, z - 0.03, x + 0.03, 0.88, z + 0.03, "steel_grey")
    md.box(-W, 0.88, -D, W, 0.94, D, "wood_dark")
    md.box(-W + 0.08, 0.15, -D + 0.08, W - 0.08, 0.18, D - 0.08, "steel_grey")
    md.box(0.2, 0.18, -D + 0.06, W - 0.1, 0.8, D - 0.06, "steel_red")
    for k in range(4):
        y = 0.24 + k * 0.14
        md.box(0.24, y, -D + 0.05, W - 0.14, y + 0.11, -D + 0.06, "steel_red", skip=("pz",))
        md.box(0.5, y + 0.04, -D + 0.03, 0.6, y + 0.07, -D + 0.05, "galvanized", skip=("pz",))
    md.box(-0.8, 0.94, -0.1, -0.55, 1.05, 0.1, "steel_dark")
    md.box(-0.3, 0.94, -0.3, 0.1, 0.98, -0.05, "steel_grey")
    return md


def forklift() -> MeshData:
    """Counterbalance forklift: body, overhead guard, mast with forks (front = -z), LPG bottle at the back."""
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 2.2, 0.3))
    y = "steel_yellow"
    # chassis and counterweight
    md.box(-0.55, 0.25, -0.75, 0.55, 0.95, 0.9, y)
    md.box(-0.58, 0.2, 0.55, 0.58, 1.15, 1.25, "steel_dark")
    md.box(-0.52, 0.95, 0.2, 0.52, 1.1, 0.95, y)
    # seat and steering
    md.box(-0.25, 1.1, 0.35, 0.25, 1.22, 0.75, "plastic_black")
    md.box(-0.25, 1.22, 0.68, 0.25, 1.65, 0.78, "plastic_black")
    md.tube((0.0, 0.95, -0.35), (0.0, 1.35, -0.2), 0.03, "steel_dark", segments=6)
    md.cylinder((0.0, 1.35, -0.2), 0.17, 0.03, "plastic_black", segments=12)
    # overhead guard
    g = "steel_dark"
    for x in (-0.5, 0.5):
        md.tube((x, 0.95, -0.55), (x, 2.15, -0.45), 0.035, g, segments=6)
        md.tube((x, 1.1, 0.85), (x, 2.15, 0.75), 0.035, g, segments=6)
        md.tube((x, 2.15, -0.45), (x, 2.15, 0.75), 0.035, g, segments=6)
    for z in (-0.3, -0.05, 0.2, 0.45, 0.7):
        md.box(-0.52, 2.12, z - 0.02, 0.52, 2.17, z + 0.02, g)
    # wheels (axis along x)
    for z, r in ((-0.55, 0.32), (0.9, 0.26)):
        for x in (-0.6, 0.6):
            x0, x1 = sorted((x, x + (0.22 if x > 0 else -0.22)))
            md.tube((x0, r, z), (x1, r, z), r, "rubber", segments=14)
            md.tube((x0 - 0.01, r, z), (x1 + 0.01, r, z), r * 0.45, "steel_grey", segments=10)
    # mast and forks
    for x in (-0.4, 0.4):
        md.box(x - 0.05, 0.1, -0.95, x + 0.05, 2.3, -0.85, g)
    md.box(-0.4, 0.15, -1.0, 0.4, 0.75, -0.95, g)
    for x in (-0.28, 0.28):
        md.box(x - 0.05, 0.1, -2.1, x + 0.05, 0.15, -0.98, g)
        md.box(x - 0.05, 0.15, -1.02, x + 0.05, 0.7, -0.98, g)
    md.box(-0.4, 2.2, -0.95, 0.4, 2.3, -0.85, g)
    # LPG bottle
    md.tube((-0.4, 1.4, 1.05), (0.4, 1.4, 1.05), 0.16, "steel_white", segments=12)
    # lights
    md.box(0.38, 1.98, -0.52, 0.48, 2.08, -0.48, "lamp_led")
    return md


INDUSTRIAL_BUILDERS = {
    "container_red": lambda: container("container_red"),
    "container_blue": lambda: container("container_blue"),
    "container_green": lambda: container("container_green"),
    "container_grey": lambda: container("container_grey"),
    "container_orange": lambda: container("container_orange"),
    "container_white": lambda: container("container_white"),
    "container_stack_a": lambda: container_stack("container_blue", "container_red"),
    "container_stack_b": lambda: container_stack("container_grey", "container_teal"),
    "pallet": pallet,
    "pallet_stack": pallet_stack,
    "pallet_goods": pallet_goods,
    "pallet_wrapped": pallet_wrapped,
    "crate_large": crate_large,
    "oil_drum": oil_drum,
    "oil_drum_red": lambda: oil_drum("steel_red"),
    "drum_group": drum_group,
    "ibc_tank": ibc_tank,
    "gas_cage": gas_cage,
    "cable_reel": cable_reel,
    "tire_stack": tire_stack,
    "jersey_barrier": jersey_barrier,
    "bollard_yellow": bollard,
    "floodlight_pole": floodlight_pole,
    "electrical_cabinet": electrical_cabinet,
    "transformer": transformer,
    "skip_bin": skip_bin,
    "pipe_bundle": pipe_bundle,
    "shelving_rack": shelving_rack,
    "workbench": workbench,
    "forklift": forklift,
}
