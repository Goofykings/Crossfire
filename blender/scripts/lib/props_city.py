"""Modern City props: street furniture, signage, utility poles, bins and parked vehicles.

Same conventions as props.py: origin at the centre of the footprint on the ground, front facing north (-z), sizes and
colliders in catalog.PROPS.
"""
from __future__ import annotations

import math
import random

from meshkit import MeshData, Transform, grime_fn
from props_industrial import bollard


def _stable(text: str) -> int:
    """Deterministic small hash (Python's hash() of a str changes between runs)."""
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h

SIGN_CELLS = {"stop": 0, "one_way": 1, "no_parking": 2, "crossing": 3}


def _atlas_uv(cell: int):
    """UV rectangle of a 256 px cell in the 4x2 street_signs atlas (cells 0-3 top row, 4-7 bottom)."""
    u0 = (cell % 4) * 0.25
    v0 = 0.5 if cell < 4 else 0.0
    return u0, v0, u0 + 0.25, v0 + 0.5


def _plate(md: MeshData, cell: int, cx: float, cy: float, cz: float, w: float, h: float, facing: int = -1,
           uv=None) -> None:
    """Sign plate: printed face toward `facing` z, aluminium back 6 mm behind it (plates are alpha-tested)."""
    u0, v0, u1, v1 = uv or _atlas_uv(cell)
    z = cz + 0.004 * facing
    pts = [(cx - w / 2, cy - h / 2, z), (cx + w / 2, cy - h / 2, z), (cx + w / 2, cy + h / 2, z), (cx - w / 2, cy + h / 2, z)]
    if facing < 0:
        # viewer looks toward +z: u increases toward -x... keep text readable: left of the viewer is +x
        uvs = [(u1, v0), (u0, v0), (u0, v1), (u1, v1)]
    else:
        uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    md.face_toward(pts, "street_signs", (0, 0, facing), uv=uvs)
    # the back: same alpha shape at the same place (same UV per corner), printed in plain grey metal
    back = [(x, y, cz - 0.002 * facing) for (x, y, _) in pts]
    md.face_toward(back, "sign_back", (0, 0, -facing), uv=list(uvs))


def dumpster(body: str = "steel_green") -> MeshData:
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 1.3, 0.3))
    W, D0, D1, H = 1.0, 0.5, 0.58, 1.12
    # body tapers outward toward the top
    bot = [(-W + 0.05, -D0), (W - 0.05, -D0), (W - 0.05, D0), (-W + 0.05, D0)]
    top = [(-W, -D1), (W, -D1), (W, D1), (-W, D1)]
    for i in range(4):
        a, b = bot[i], bot[(i + 1) % 4]
        c, d = top[(i + 1) % 4], top[i]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        md.face_toward([(a[0], 0.16, a[1]), (b[0], 0.16, b[1]), (c[0], H, c[1]), (d[0], H, d[1])], body, (mid[0], 0, mid[1]))
    md.face_toward([(x, 0.16, z) for (x, z) in bot], body, (0, -1, 0))
    # rim and fork pockets
    md.box(-W - 0.03, H - 0.08, -D1 - 0.03, W + 0.03, H, D1 + 0.03, body)
    for x in (-0.55, 0.55):
        md.box(x - 0.16, 0.45, -D0 - 0.07, x + 0.16, 0.6, D0 + 0.07, "steel_dark")
    # two lids, one slightly propped open
    for k, (x0, x1) in enumerate(((-W, -0.01), (0.01, W))):
        lid = MeshData()
        lid.box(x0, 0.0, -D1 - 0.04, x1, 0.05, D1 + 0.06, "plastic_black")
        lid.box(x0 + 0.04, 0.05, -D1 + 0.1, x1 - 0.04, 0.09, D1 - 0.1, "plastic_black", skip=("ny",))
        if k == 1:
            # propped open about the rear hinge: the front edge lifts
            a = math.radians(-12)
            lid.verts = [(x, (y * math.cos(a) + (z - (D1 + 0.06)) * math.sin(a)), (z - (D1 + 0.06)) * math.cos(a) - y * math.sin(a) + D1 + 0.06)
                         for (x, y, z) in lid.verts]
        md.merge(lid, Transform(0, H, 0))
    for x in (-0.8, 0.8):
        for z in (-0.38, 0.38):
            md.box(x - 0.04, 0.02, z - 0.04, x + 0.04, 0.16, z + 0.04, "steel_dark")
            md.tube((x - 0.03, 0.06, z), (x + 0.03, 0.06, z), 0.06, "rubber", segments=8)
    return md


def trash_bin(body: str = "plastic_green") -> MeshData:
    md = MeshData()
    w0, w1, d0, d1, H = 0.24, 0.29, 0.28, 0.33, 0.98
    bot = [(-w0, -d0), (w0, -d0), (w0, d0), (-w0, d0)]
    top = [(-w1, -d1), (w1, -d1), (w1, d1), (-w1, d1)]
    for i in range(4):
        a, b = bot[i], bot[(i + 1) % 4]
        c, d = top[(i + 1) % 4], top[i]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        md.face_toward([(a[0], 0.05, a[1]), (b[0], 0.05, b[1]), (c[0], H, c[1]), (d[0], H, d[1])], body, (mid[0], 0, mid[1]))
    md.face_toward([(x, 0.05, z) for (x, z) in bot], body, (0, -1, 0))
    md.box(-w1 - 0.02, H, -d1 - 0.02, w1 + 0.02, H + 0.05, d1 + 0.04, body)
    md.box(-w1, H - 0.08, d1, w1, H - 0.03, d1 + 0.08, "plastic_black")
    for x in (-w0, w0):
        md.tube((x - 0.07 * (1 if x > 0 else -1), 0.1, d0 + 0.04), (x + 0.0, 0.1, d0 + 0.04), 0.1, "plastic_black", segments=10)
    return md


def bench_modern() -> MeshData:
    md = MeshData()
    L = 0.9
    for x in (-L + 0.15, L - 0.15):
        md.box(x - 0.03, 0.0, -0.25, x + 0.03, 0.44, -0.19, "steel_dark")
        md.box(x - 0.03, 0.0, 0.17, x + 0.03, 0.44, 0.23, "steel_dark")
        md.box(x - 0.03, 0.4, -0.25, x + 0.03, 0.44, 0.23, "steel_dark", skip=("ny",))
        md.box(x - 0.03, 0.44, 0.17, x + 0.03, 0.85, 0.23, "steel_dark")
    for k in range(5):
        z = -0.24 + k * 0.095
        md.box(-L, 0.44, z, L, 0.48, z + 0.08, "wood_dark", skip=("ny",))
    for k in range(3):
        y = 0.52 + k * 0.1
        md.box(-L, y, 0.23, L, y + 0.08, 0.26, "wood_dark")
    return md


def planter(L: float = 1.6) -> MeshData:
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 0.6, 0.35))
    W, D, H = L / 2, 0.4, 0.55
    m = "concrete_smooth_light"
    md.box(-W, 0.0, -D, W, H, -D + 0.08, m)
    md.box(-W, 0.0, D - 0.08, W, H, D, m)
    md.box(-W, 0.0, -D + 0.08, -W + 0.08, H, D - 0.08, m, skip=("nz", "pz"))
    md.box(W - 0.08, 0.0, -D + 0.08, W, H, D - 0.08, m, skip=("nz", "pz"))
    md.face_toward([(-W + 0.08, H - 0.08, -D + 0.08), (W - 0.08, H - 0.08, -D + 0.08), (W - 0.08, H - 0.08, D - 0.08),
                    (-W + 0.08, H - 0.08, D - 0.08)], "soil", (0, 1, 0))
    import props as base
    n = max(1, int(L / 0.6))
    for i in range(n):
        x = -W + (i + 0.5) * (2 * W / n)
        base._bush(md, x, H - 0.1, 0.0, 0.32, seed=i + int(L * 10), phase=i * 0.37)
    return md


def streetlight(h: float = 6.5) -> MeshData:
    md = MeshData()
    md.cylinder((0, 0.0, 0), 0.14, 0.5, "galvanized", segments=10, caps=(False, True))
    md.cylinder((0, 0.5, 0), 0.085, h - 0.5, "galvanized", segments=10, radius_top=0.06, caps=(False, False))
    # arm curving out toward -z
    pts = [(0.0, h - 0.4 + 0.3 * math.sin(t * math.pi / 2), -1.5 * (1 - math.cos(t * math.pi / 2)) - 0.0) for t in (0, 0.25, 0.5, 0.75, 1.0)]
    for a, b in zip(pts, pts[1:]):
        md.tube(a, b, 0.05, "galvanized", segments=8)
    hx, hy, hz = pts[-1]
    md.box(-0.16, hy - 0.08, hz - 0.5, 0.16, hy + 0.04, hz + 0.05, "steel_dark")
    md.box(-0.12, hy - 0.085, hz - 0.45, 0.12, hy - 0.08, hz, "lamp_led", skip=("py",))
    md.box(-0.08, 1.0, 0.075, 0.08, 1.4, 0.095, "steel_dark", skip=("nz",))
    return md


def utility_pole(h: float = 9.0) -> MeshData:
    md = MeshData()
    md.cylinder((0, 0, 0), 0.16, h, "wood_pole", segments=10, radius_top=0.12)
    md.box(-1.1, h - 0.7, -0.06, 1.1, h - 0.58, 0.06, "wood_pole")
    for x in (-0.95, -0.35, 0.35, 0.95):
        md.cylinder((x, h - 0.58, 0), 0.025, 0.08, "galvanized", segments=6)
        for k in range(3):
            md.cylinder((x, h - 0.5 + k * 0.05, 0), 0.06 - k * 0.012, 0.04, "ceramic", segments=8)
    # braces
    md.tube((-0.7, h - 0.7, 0.0), (0.0, h - 1.3, 0.0), 0.02, "galvanized", segments=5)
    md.tube((0.7, h - 0.7, 0.0), (0.0, h - 1.3, 0.0), 0.02, "galvanized", segments=5)
    # pole-mounted transformer can facing the street (-z)
    md.box(-0.06, h - 2.6, -0.2, 0.06, h - 2.2, -0.14, "galvanized")
    md.cylinder((0, h - 3.0, -0.42), 0.26, 0.9, "steel_grey", segments=12)
    md.cylinder((0, h - 2.1, -0.42), 0.27, 0.06, "steel_grey", segments=12, radius_top=0.2)
    md.tube((0, h - 2.05, -0.42), (0, h - 0.7, -0.08), 0.012, "steel_dark", segments=4)
    # step bolts and a ground wire guard
    for k in range(8):
        y = 2.4 + k * 0.38
        side = 1 if k % 2 else -1
        md.tube((side * 0.13, y, 0.0), (side * 0.3, y, 0.0), 0.012, "galvanized", segments=4)
    md.box(0.1, 0.0, -0.04, 0.17, 2.4, 0.04, "plastic_grey")
    return md


def street_sign(kind: str) -> MeshData:
    md = MeshData()
    md.cylinder((0, 0, 0), 0.032, 2.9, "galvanized", segments=8)
    if kind == "stop":
        _plate(md, SIGN_CELLS["stop"], 0.0, 2.35, -0.04, 0.72, 0.72)
    elif kind == "crossing":
        _plate(md, SIGN_CELLS["crossing"], 0.0, 2.35, -0.04, 0.72, 0.72)
    elif kind == "no_parking":
        _plate(md, SIGN_CELLS["no_parking"], 0.0, 2.2, -0.04, 0.55, 0.55)
    else:
        # name plates crossed at the top + a one-way sign below
        u0, v0, u1, v1 = _atlas_uv(4 + (_stable(kind) % 4))
        _plate(md, 0, 0.0, 2.8, -0.035, 0.9, 0.42, uv=(u0, v0 + 0.14, u1, v1 - 0.14))
        u0, v0, u1, v1 = _atlas_uv(4 + (_stable(kind + "x") % 4))
        plate = MeshData()
        _plate(plate, 0, 0.0, 0.0, -0.035, 0.9, 0.42, uv=(u0, v0 + 0.14, u1, v1 - 0.14))
        md.merge(plate, Transform(0.0, 2.55, 0.0, math.pi / 2))
        # the one-way board fills cell 1 between pixel rows 78 and 178
        _plate(md, SIGN_CELLS["one_way"], 0.0, 2.05, -0.035, 0.8, 0.33, uv=(0.25 + 8 / 1024, 1 - 178 / 512, 0.5 - 8 / 1024, 1 - 78 / 512))
    return md


def fire_hydrant() -> MeshData:
    md = MeshData()
    r = "steel_red"
    md.cylinder((0, 0, 0), 0.16, 0.06, r, segments=12)
    md.cylinder((0, 0.06, 0), 0.12, 0.5, r, segments=12, caps=(False, False))
    md.cylinder((0, 0.56, 0), 0.14, 0.05, r, segments=12)
    md.sphere((0, 0.61, 0), 0.12, r, rings=4, segments=12, squash=0.6)
    md.cylinder((0, 0.68, 0), 0.03, 0.06, "steel_dark", segments=6)
    for a in (0, math.pi):
        x, z = math.cos(a) * 0.12, -math.sin(a) * 0.12
        md.tube((x * 0.8, 0.42, z * 0.8), (x * 1.6, 0.42, z * 1.6), 0.045, r, segments=8)
        md.tube((x * 1.6, 0.42, z * 1.6), (x * 1.75, 0.42, z * 1.75), 0.05, "steel_dark", segments=8)
    md.tube((0, 0.38, -0.1), (0, 0.38, -0.22), 0.06, r, segments=10)
    md.tube((0, 0.38, -0.22), (0, 0.38, -0.25), 0.065, "steel_dark", segments=10)
    return md


def newspaper_box() -> MeshData:
    md = MeshData()
    md.box(-0.22, 0.0, -0.2, 0.22, 0.25, 0.2, "steel_dark")
    md.box(-0.25, 0.25, -0.22, 0.25, 1.0, 0.22, "steel_blue")
    md.box(-0.18, 0.55, -0.232, 0.18, 0.88, -0.22, "glass_store", skip=("pz",))
    md.box(-0.12, 0.62, -0.24, 0.12, 0.84, -0.232, "posters", skip=("pz",))
    md.box(-0.26, 1.0, -0.23, 0.26, 1.04, 0.23, "steel_blue")
    return md


def bike_rack() -> MeshData:
    md = MeshData()
    for x in (-0.75, -0.25, 0.25, 0.75):
        # inverted U: up one leg, over the top, down the other
        arc = [(x, 0.55 + 0.3 * math.sin(t), 0.3 * math.cos(t)) for t in (math.pi, 0.75 * math.pi, 0.5 * math.pi, 0.25 * math.pi, 0.0)]
        pts = [(x, 0.0, -0.3)] + arc + [(x, 0.0, 0.3)]
        for a, b in zip(pts, pts[1:]):
            md.tube(a, b, 0.024, "galvanized", segments=6)
    return md


def traffic_cone() -> MeshData:
    md = MeshData()
    md.box(-0.18, 0.0, -0.18, 0.18, 0.03, 0.18, "plastic_black")
    md.cylinder((0, 0.03, 0), 0.13, 0.62, "plastic_orange", segments=12, radius_top=0.025)
    md.cylinder((0, 0.36, 0), 0.077, 0.1, "plastic_white", segments=12, radius_top=0.065, caps=(False, False))
    return md


def ac_condenser() -> MeshData:
    """Ground-standing air-conditioning condenser (alleys, back yards)."""
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 0.8, 0.3))
    md.box(-0.5, 0.0, -0.22, 0.5, 0.08, 0.22, "concrete_trim", skip=("ny",))
    md.box(-0.45, 0.08, -0.18, 0.45, 0.78, 0.18, "steel_white")
    fan = [(0.1 + math.cos(2 * math.pi * k / 16) * 0.25, 0.43 + math.sin(2 * math.pi * k / 16) * 0.25, -0.188) for k in range(16)]
    md.face_toward(fan, "steel_dark", (0, 0, -1))
    for k in range(5):
        y = 0.2 + k * 0.1
        md.box(-0.44, y, 0.18, 0.44, y + 0.03, 0.19, "steel_dark", skip=("nz",))
    md.tube((-0.45, 0.3, 0.1), (-0.6, 0.3, 0.1), 0.02, "copper", segments=6)
    md.tube((-0.6, 0.3, 0.1), (-0.6, 1.4, 0.1), 0.02, "copper", segments=6)
    return md


def trash_bags() -> MeshData:
    md = MeshData()
    rnd = random.Random(14)
    for i in range(6):
        x, z = rnd.uniform(-0.4, 0.4), rnd.uniform(-0.3, 0.3)
        r = rnd.uniform(0.2, 0.3)
        md.sphere((x, r * 0.82 + (0.2 if i > 3 else 0.0), z), r, "plastic_black", rings=5, segments=8, squash=0.8)
    return md


def traffic_light() -> MeshData:
    md = MeshData()
    md.cylinder((0, 0, 0), 0.1, 0.3, "steel_dark", segments=10)
    md.cylinder((0, 0.3, 0), 0.06, 3.0, "steel_dark", segments=10)
    md.box(-0.17, 3.3, -0.2, 0.17, 4.25, 0.05, "steel_dark")
    for k, mat in enumerate(("signal_off", "signal_off", "signal_green")):
        y = 4.08 - k * 0.3
        disc_pts = [(math.cos(2 * math.pi * j / 12) * 0.11, y + math.sin(2 * math.pi * j / 12) * 0.11, -0.204) for j in range(12)]
        md.face_toward(disc_pts, mat, (0, 0, -1))
        md.box(-0.14, y + 0.1, -0.32, 0.14, y + 0.13, -0.2, "steel_dark", skip=("pz",))
    md.box(-0.2, 1.1, -0.08, -0.06, 1.35, 0.0, "steel_dark")
    return md


def cafe_set() -> MeshData:
    md = MeshData()
    md.cylinder((0, 0, 0), 0.22, 0.03, "aluminium", segments=12)
    md.cylinder((0, 0.03, 0), 0.03, 0.7, "aluminium", segments=8, caps=(False, False))
    md.cylinder((0, 0.73, 0), 0.36, 0.03, "aluminium", segments=16)
    for a in (0.3, 0.3 + math.pi):
        cx, cz = math.cos(a) * 0.6, -math.sin(a) * 0.6
        chair = MeshData()
        for (x, z) in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
            chair.tube((x, 0.0, z), (x, 0.45, z), 0.015, "aluminium", segments=5)
        chair.box(-0.22, 0.45, -0.22, 0.22, 0.48, 0.22, "aluminium")
        chair.box(-0.22, 0.48, 0.2, 0.22, 0.85, 0.22, "aluminium")
        md.merge(chair, Transform(cx, 0, cz, a + math.pi / 2))
    md.tube((0, 0.76, 0), (0, 2.3, 0), 0.02, "aluminium", segments=6)
    for k in range(8):
        a, b = 2 * math.pi * k / 8, 2 * math.pi * (k + 1) / 8
        p0 = (0.0, 2.35, 0.0)
        p1 = (math.cos(a) * 1.2, 1.95, -math.sin(a) * 1.2)
        p2 = (math.cos(b) * 1.2, 1.95, -math.sin(b) * 1.2)
        md.face_toward([p0, p1, p2], "canvas_cream", (0, 1, 0))
        md.face_toward([p0, p2, p1], "canvas_cream", (0, -1, 0))
    return md


# --- vehicles ---------------------------------------------------------------------------------------------
def _extrude_x(md: MeshData, prof, x0: float, x1: float, mat: str, caps: bool = True) -> None:
    """Prism along x from a closed (z, y) profile wound counter-clockwise (z right, y up)."""
    for (za, ya), (zb, yb) in zip(prof, prof[1:] + prof[:1]):
        nz, ny = (yb - ya), -(zb - za)
        if abs(nz) + abs(ny) < 1e-9:
            continue
        md.face_toward([(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)], mat, (0, ny, nz))
    if caps:
        for x, sgn in ((x0, -1), (x1, 1)):
            md.face_toward([(x, y, z) for (z, y) in prof], mat, (sgn, 0, 0))


def _wheel(md: MeshData, x: float, z: float, r: float = 0.32, w: float = 0.22) -> None:
    """Tyre whose outer face stands 3 cm outside the body side `x` (never on the body plane), hub 8 mm beyond it."""
    sgn = 1 if x > 0 else -1
    outer = x + sgn * 0.03
    a, b = sorted((outer, outer - sgn * w))
    md.tube((a, r, z), (b, r, z), r, "rubber", segments=14)
    c, d = sorted((outer - sgn * 0.02, outer + sgn * 0.008))
    md.tube((c, r, z), (d, r, z), r * 0.62, "aluminium", segments=12)


def car_sedan(paint: str) -> MeshData:
    """Four-door saloon, 4.5 m long, front toward -z."""
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 1.5, 0.25))
    W = 0.88
    # lower body side profile (z along the car, y up), counter-clockwise with +z to the right
    body = [(-2.25, 0.32), (2.25, 0.32), (2.25, 0.62), (2.2, 0.85), (1.5, 0.92), (-1.3, 0.92), (-2.15, 0.82), (-2.25, 0.62)]
    _extrude_x(md, body, -W, W, paint)
    # cabin: narrower trapezoid; glass all round with pillars as thin strips of paint
    cw0, cw1 = W - 0.04, W - 0.16
    b0, b1, t0, t1, yb, yt = -1.25, 1.35, -0.45, 0.85, 0.92, 1.42
    corners_b = [(-cw0, b0), (cw0, b0), (cw0, b1), (-cw0, b1)]
    corners_t = [(-cw1, t0), (cw1, t0), (cw1, t1), (-cw1, t1)]
    for i in range(4):
        a, b = corners_b[i], corners_b[(i + 1) % 4]
        c, d = corners_t[(i + 1) % 4], corners_t[i]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        md.face_toward([(a[0], yb, a[1]), (b[0], yb, b[1]), (c[0], yt, c[1]), (d[0], yt, d[1])], "glass_window", (mid[0], 0.3, mid[1]))
    md.face_toward([(x, yt, z) for (x, z) in corners_t], paint, (0, 1, 0))
    # B pillars and roof rails (proud of the glass)
    for sx in (-1, 1):
        zb_, zt_ = 0.05, 0.25
        xb, xt = sx * (cw0 + 0.01), sx * (cw1 + 0.01)
        md.face_toward([(xb, yb, zb_ - 0.06), (xb, yb, zb_ + 0.06), (xt, yt - 0.02, zt_ + 0.05), (xt, yt - 0.02, zt_ - 0.05)], paint,
                       (sx, 0.3, 0))
    # wheels
    for z in (-1.4, 1.35):
        for x in (-W + 0.0, W - 0.0):
            _wheel(md, x, z)
    # bumpers, lights, plates, mirrors
    md.box(-W - 0.01, 0.3, -2.3, W + 0.01, 0.48, -2.2, "plastic_black")
    md.box(-W - 0.01, 0.3, 2.2, W + 0.01, 0.48, 2.3, "plastic_black")
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.5, sx * 0.8))
        md.box(x0, 0.64, -2.262, x1, 0.75, -2.24, "headlight", skip=("pz",))
        md.box(x0, 0.66, 2.24, x1, 0.76, 2.262, "taillight", skip=("nz",))
        m0, m1 = sorted((sx * (cw0 - 0.03), sx * (cw0 + 0.16)))
        md.box(m0, 0.98, -1.05, m1, 1.08, -0.95, paint)
    md.box(-0.25, 0.4, -2.312, 0.25, 0.52, -2.3, "plastic_white", skip=("pz",))
    md.box(-0.25, 0.5, 2.25, 0.25, 0.62, 2.262, "plastic_white", skip=("nz",))
    md.box(-0.35, 0.62, -2.255, 0.35, 0.72, -2.245, "steel_dark", skip=("pz",))
    return md


def van(paint: str = "carpaint_white") -> MeshData:
    """Delivery van, 5.2 m long, front toward -z."""
    md = MeshData(grime_fn((1, 1, 1, 1), 0.0, 2.4, 0.25))
    W = 0.98
    prof = [(-2.6, 0.38), (2.6, 0.38), (2.6, 2.25), (-1.25, 2.25), (-1.75, 1.35), (-2.55, 1.05), (-2.6, 0.75)]
    _extrude_x(md, prof, -W, W, paint)
    # windscreen on the sloped front, 8 mm off it along its outward normal; side windows 8 mm off the cab sides
    (az, ay), (bz, by) = (-1.75, 1.35), (-1.25, 2.25)
    L = math.hypot(bz - az, by - ay)
    nz, ny = -(by - ay) / L, (bz - az) / L
    sl = [(az + (bz - az) * t + nz * 0.008, ay + (by - ay) * t + ny * 0.008) for t in (0.08, 0.94)]
    md.face_toward([(-W + 0.08, sl[0][1], sl[0][0]), (W - 0.08, sl[0][1], sl[0][0]), (W - 0.08, sl[1][1], sl[1][0]),
                    (-W + 0.08, sl[1][1], sl[1][0])], "glass_window", (0, ny, nz))
    for sx in (-1, 1):
        x = sx * (W + 0.008)
        md.face_toward([(x, 1.35, -1.6), (x, 1.35, -0.75), (x, 2.05, -0.75), (x, 2.05, -1.2)], "glass_window", (sx, 0, 0))
        md.face_toward([(x, 0.6, -0.68), (x, 0.6, -0.65), (x, 2.1, -0.65), (x, 2.1, -0.68)], "plastic_black", (sx, 0, 0))
        md.face_toward([(x, 0.9, 1.0), (x, 0.9, 2.2), (x, 1.6, 2.2), (x, 1.6, 1.0)], "sign_city", (sx, 0, 0),
                       # u increases toward the viewer's right: -z when looking at the +x side, +z on the -x side
                       uv=[(0.5, 0.875), (0.0, 0.875), (0.0, 1.0), (0.5, 1.0)] if sx > 0 else [(0.0, 0.875), (0.5, 0.875), (0.5, 1.0), (0.0, 1.0)])
    for z in (-1.75, 1.65):
        for x in (-W, W):
            _wheel(md, x, z, 0.36, 0.24)
    md.box(-W - 0.01, 0.34, -2.66, W + 0.01, 0.55, -2.58, "plastic_black")
    md.box(-W - 0.01, 0.34, 2.58, W + 0.01, 0.55, 2.66, "plastic_black")
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.6, sx * 0.9))
        md.box(x0, 0.78, -2.612, x1, 0.92, -2.6, "headlight", skip=("pz",))
        md.box(x0, 0.6, 2.6, x1, 0.9, 2.612, "taillight", skip=("nz",))
    md.face_toward([(-0.01, 0.5, 2.608), (0.01, 0.5, 2.608), (0.01, 2.2, 2.608), (-0.01, 2.2, 2.608)], "plastic_black", (0, 0, 1))
    return md


CITY_BUILDERS = {
    "dumpster": dumpster,
    "dumpster_blue": lambda: dumpster("steel_blue"),
    "trash_bin": trash_bin,
    "trash_bin_grey": lambda: trash_bin("plastic_grey"),
    "bench_modern": bench_modern,
    "planter": planter,
    "planter_long": lambda: planter(3.0),
    "streetlight": streetlight,
    "utility_pole": utility_pole,
    "sign_stop": lambda: street_sign("stop"),
    "sign_crossing": lambda: street_sign("crossing"),
    "sign_no_parking": lambda: street_sign("no_parking"),
    "sign_street": lambda: street_sign("names"),
    "fire_hydrant": fire_hydrant,
    "newspaper_box": newspaper_box,
    "bike_rack": bike_rack,
    "bollard_steel": lambda: bollard("steel_dark"),
    "traffic_cone": traffic_cone,
    "ac_condenser": ac_condenser,
    "trash_bags": trash_bags,
    "traffic_light": traffic_light,
    "cafe_set": cafe_set,
    "car_red": lambda: car_sedan("carpaint_red"),
    "car_blue": lambda: car_sedan("carpaint_blue"),
    "car_silver": lambda: car_sedan("carpaint_silver"),
    "car_black": lambda: car_sedan("carpaint_black"),
    "car_white": lambda: car_sedan("carpaint_white"),
    "van_white": van,
}
