"""Facade and roof kit for industrial buildings (warehouses, workshops, offices, sheds).

Same local space as kit.py: origin at the bottom centre of the opening on the wall's OUTER plane, +x along the wall,
+y up, outward = -z, into the wall = +z (the reveal runs from z = 0 to REVEAL). Every piece stays off the wall plane
(z = 0) except where it is glued to it with its back face left out, so nothing is coplanar with the facade.
"""
from __future__ import annotations

import math

from kit import REVEAL
from meshkit import MeshData


def roller_door(w: float, h: float, slats: str, frame: str = "steel_dark", open_: bool = False) -> MeshData:
    """Roller shutter in a reveal: guide rails, bottom rail, coil housing on the outside above the opening."""
    m = MeshData()
    x0, x1 = -w / 2, w / 2
    z = REVEAL * 0.5
    if not open_:
        m.face([(x1 - 0.05, 0.0, z), (x0 + 0.05, 0.0, z), (x0 + 0.05, h, z), (x1 - 0.05, h, z)], slats,
               uv=[(w, 0), (0, 0), (0, h), (w, h)])
        m.box(x0 + 0.05, 0.0, z - 0.04, x1 - 0.05, 0.08, z, frame, skip=("pz",))
        # handle and lock
        m.box(-0.12, 0.85, z - 0.03, 0.12, 0.9, z, "galvanized", skip=("pz",))
    for x in (x0, x1 - 0.07):
        m.box(x, 0.0, z - 0.05, x + 0.07, h, z + 0.05, frame)
    # angle frame on the wall face around the opening (proud of the wall, back face omitted)
    m.box(x0 - 0.1, 0.0, -0.03, x0, h, 0.0, frame, skip=("pz",))
    m.box(x1, 0.0, -0.03, x1 + 0.1, h, 0.0, frame, skip=("pz",))
    m.box(x0 - 0.1, h, -0.03, x1 + 0.1, h + 0.1, 0.0, frame, skip=("pz",))
    # coil housing
    m.box(x0 - 0.12, h + 0.1, -0.42, x1 + 0.12, h + 0.56, 0.0, slats, skip=("pz",))
    m.box(x0 - 0.14, h + 0.56, -0.44, x1 + 0.14, h + 0.6, 0.0, frame, skip=("pz",))
    return m


def steel_door(w: float, h: float, leaf: str, double: bool = False, vision: bool = True) -> MeshData:
    m = MeshData()
    zf = REVEAL - 0.08
    zb = REVEAL - 0.02
    t = 0.06
    x0, x1 = -w / 2, w / 2
    m.box(x0, 0, zf - 0.02, x0 + t, h, zb, "steel_dark", skip=("pz",))
    m.box(x1 - t, 0, zf - 0.02, x1, h, zb, "steel_dark", skip=("pz",))
    m.box(x0 + t, h - t, zf - 0.02, x1 - t, h, zb, "steel_dark", skip=("pz", "nx", "px"))
    leaves = [(x0 + t, x1 - t)] if not double else [(x0 + t, -0.004), (0.004, x1 - t)]
    for (a, b) in leaves:
        m.box(a, 0.0, zf, b, h - t, zb, leaf, skip=("pz",))
        # kick plate and push bar
        m.box(a + 0.04, 0.05, zf - 0.008, b - 0.04, 0.3, zf, "galvanized", skip=("pz",))
        hx = b - 0.1 if (not double or a < 0) else a + 0.1
        m.box(min(hx, (a + b) / 2) - 0.0, 1.0, zf - 0.06, max(hx, (a + b) / 2) + 0.0, 1.04, zf - 0.02, "galvanized")
        m.box(hx - 0.02, 0.98, zf - 0.02, hx + 0.02, 1.06, zf, "galvanized", skip=("pz",))
        if vision:
            cx = (a + b) / 2
            m.box(cx - 0.14, 1.35, zf - 0.012, cx + 0.14, 1.85, zf, "steel_dark", skip=("pz",))
            m.face([(cx + 0.11, 1.38, zf - 0.02), (cx - 0.11, 1.38, zf - 0.02), (cx - 0.11, 1.82, zf - 0.02), (cx + 0.11, 1.82, zf - 0.02)],
                   "glass_wired", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    return m


def door_frame(w: float, h: float, frame: str = "steel_dark", hazard: bool = True) -> MeshData:
    """Steel angle frame around an open doorway (the opening itself stays clear)."""
    m = MeshData()
    x0, x1 = -w / 2, w / 2
    m.box(x0 - 0.08, 0.0, -0.025, x0, h, 0.0, frame, skip=("pz",))
    m.box(x1, 0.0, -0.025, x1 + 0.08, h, 0.0, frame, skip=("pz",))
    m.box(x0 - 0.08, h, -0.025, x1 + 0.08, h + 0.08, 0.0, frame, skip=("pz",))
    if hazard:
        # hazard-striped protection on the lower jambs
        m.box(x0 - 0.1, 0.0, -0.05, x0 - 0.0, 1.0, -0.025, "hazard", skip=("pz",))
        m.box(x1 + 0.0, 0.0, -0.05, x1 + 0.1, 1.0, -0.025, "hazard", skip=("pz",))
    return m


def strip_window(w: float, h: float, pitch: float = 1.25) -> MeshData:
    """High-level ribbon glazing in a steel frame with vertical mullions."""
    m = MeshData()
    zf, zb = REVEAL - 0.12, REVEAL - 0.04
    x0, x1 = -w / 2, w / 2
    t = 0.05
    m.box(x0, 0, zf, x1, t, zb, "steel_dark", skip=("pz",))
    m.box(x0, h - t, zf, x1, h, zb, "steel_dark", skip=("pz",))
    n = max(1, round(w / pitch))
    for i in range(n + 1):
        x = x0 + i * w / n
        a, b = max(x0, x - t / 2), min(x1, x + t / 2)
        m.box(a, t, zf, b, h - t, zb, "steel_dark", skip=("pz", "ny", "py"))
    gz = zb - 0.01
    m.face([(x1, t, gz), (x0, t, gz), (x0, h - t, gz), (x1, h - t, gz)], "glass_wired", uv=[(w, 0), (0, 0), (0, h), (w, h)])
    # pressed-metal sill below
    m.box(x0 - 0.04, -0.05, -0.06, x1 + 0.04, 0.0, REVEAL - 0.12, "galvanized", skip=("pz",))
    return m


def factory_window(w: float, h: float, frame: str = "steel_dark") -> MeshData:
    """Multi-pane steel window (small glazing bars on a grid) with a concrete sill and lintel."""
    m = MeshData()
    zf, zb = REVEAL - 0.11, REVEAL - 0.05
    x0, x1 = -w / 2, w / 2
    t = 0.05
    for (a, b) in ((x0, x0 + t), (x1 - t, x1)):
        m.box(a, 0, zf, b, h, zb, frame, skip=("pz",))
    m.box(x0 + t, 0, zf, x1 - t, t, zb, frame, skip=("pz", "nx", "px"))
    m.box(x0 + t, h - t, zf, x1 - t, h, zb, frame, skip=("pz", "nx", "px"))
    cols = max(2, round(w / 0.42))
    rows = max(3, round(h / 0.4))
    bar = 0.022
    for i in range(1, cols):
        x = x0 + t + i * (w - 2 * t) / cols
        m.box(x - bar / 2, t, zf + 0.01, x + bar / 2, h - t, zb - 0.015, frame, skip=("pz", "ny", "py"))
    for j in range(1, rows):
        y = t + j * (h - 2 * t) / rows
        m.box(x0 + t, y - bar / 2, zf + 0.01, x1 - t, y + bar / 2, zb - 0.015, frame, skip=("pz", "nx", "px"))
    gz = zb - 0.012
    m.face([(x1 - t, t, gz), (x0 + t, t, gz), (x0 + t, h - t, gz), (x1 - t, h - t, gz)], "glass_wired",
           uv=[(w, 0), (0, 0), (0, h), (w, h)])
    # a couple of panes tilted open on pivots
    return m


def sill_lintel(w: float, h: float, mat: str = "concrete_trim") -> MeshData:
    m = MeshData()
    m.box(-w / 2 - 0.06, -0.07, -0.06, w / 2 + 0.06, 0.0, 0.1, mat, skip=("pz",))
    m.box(-w / 2 - 0.12, h, -0.03, w / 2 + 0.12, h + 0.22, 0.0, mat, skip=("pz",))
    return m


def louvre(w: float, h: float, mat: str = "galvanized") -> MeshData:
    m = MeshData()
    m.box(-w / 2, 0, REVEAL - 0.1, w / 2, h, REVEAL - 0.04, "steel_dark", skip=("pz",))
    n = max(3, int(h / 0.09))
    for i in range(n):
        y = 0.05 + i * (h - 0.1) / n
        blade = [(w / 2 - 0.03, y, REVEAL - 0.11), (-w / 2 + 0.03, y, REVEAL - 0.11), (-w / 2 + 0.03, y + 0.06, REVEAL - 0.16),
                 (w / 2 - 0.03, y + 0.06, REVEAL - 0.16)]
        m.face_toward(blade, mat, (0, 0.7, -0.7))
    return m


def bulkhead_light(mat: str = "lamp_sodium") -> MeshData:
    """Wall-mounted industrial lamp: bracket arm and a shade; origin on the wall at the bracket."""
    m = MeshData()
    m.box(-0.07, -0.1, -0.03, 0.07, 0.1, 0.0, "steel_dark", skip=("pz",))
    m.tube((0.0, 0.0, -0.03), (0.0, 0.05, -0.45), 0.02, "steel_dark", segments=6)
    m.cylinder((0.0, -0.08, -0.5), 0.2, 0.13, "steel_green", segments=10, radius_top=0.05, caps=(False, True))
    lens = [(math.cos(2 * math.pi * k / 10) * 0.16, -0.085, -0.5 - math.sin(2 * math.pi * k / 10) * 0.16) for k in range(10)]
    m.face_toward(lens, mat, (0, -1, 0))
    return m


def floodlight_wall() -> MeshData:
    m = MeshData()
    m.box(-0.05, -0.1, -0.08, 0.05, 0.1, 0.0, "steel_dark", skip=("pz",))
    head = MeshData()
    head.box(-0.2, -0.13, -0.1, 0.2, 0.13, 0.04, "steel_dark")
    head.box(-0.17, -0.1, -0.11, 0.17, 0.1, -0.1, "lamp_led", skip=("pz",))
    a = math.radians(-40)
    head.verts = [(x, y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a) - 0.2) for (x, y, z) in head.verts]
    m.merge(head)
    return m


def sign_board(cell: int, w: float, h: float) -> MeshData:
    """A painted company/site board from the 2x8 sign_industrial atlas, on a steel frame 4 cm off the wall."""
    m = MeshData()
    u0, v0 = (cell % 2) * 0.5, 1.0 - (cell // 2 + 1) * 0.125
    m.box(-w / 2 - 0.03, -0.03, -0.04, w / 2 + 0.03, h + 0.03, 0.0, "steel_dark", skip=("pz",))
    m.face([(w / 2, 0, -0.048), (-w / 2, 0, -0.048), (-w / 2, h, -0.048), (w / 2, h, -0.048)], "sign_industrial",
           uv=[(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.125), (u0, v0 + 0.125)])
    return m


def wall_box(w: float = 0.5, h: float = 0.7) -> MeshData:
    """Wall-mounted electrical distribution box with a conduit running up out of it."""
    m = MeshData()
    m.box(-w / 2, 0.0, -0.22, w / 2, h, 0.0, "steel_grey", skip=("pz",))
    m.box(-w / 2 + 0.03, 0.03, -0.232, w / 2 - 0.03, h - 0.03, -0.22, "steel_grey", skip=("pz",))
    m.face_toward([(-0.08, h * 0.62, -0.24), (0.08, h * 0.62, -0.24), (0.0, h * 0.8, -0.24)], "steel_yellow", (0, 0, -1))
    m.tube((0.0, h, -0.1), (0.0, h + 1.4, -0.1), 0.025, "galvanized", segments=6)
    return m


def canopy(w: float, depth: float = 1.1) -> MeshData:
    """Steel door canopy (sits well above jump reach; no collision needed)."""
    m = MeshData()
    m.box(-w / 2, 0.0, -depth, w / 2, 0.12, 0.0, "steel_grey", skip=("pz",))
    m.box(-0.22, -0.03, -depth * 0.6, 0.22, 0.0, -depth * 0.35, "lamp_led", skip=("py",))
    for x in (-w / 2 + 0.05, w / 2 - 0.05):
        m.tube((x, 0.12, -depth + 0.1), (x, 0.9, -0.02), 0.02, "steel_dark", segments=5)
    return m


# --- rooftop plant ----------------------------------------------------------------------------------
def hvac_unit(w: float = 2.2, d: float = 1.4, h: float = 1.1) -> MeshData:
    m = MeshData()
    for x in (-w / 2 + 0.1, w / 2 - 0.1):
        m.box(x - 0.05, 0.0, -d / 2, x + 0.05, 0.15, d / 2, "steel_dark")
    m.box(-w / 2, 0.15, -d / 2, w / 2, h, d / 2, "steel_white")
    for k in range(2):
        cx = -w / 4 + k * w / 2
        m.cylinder((cx, h, 0.0), 0.36, 0.06, "steel_dark", segments=14)
        m.cylinder((cx, h + 0.06, 0.0), 0.3, 0.005, "galvanized", segments=14, caps=(False, True))
    for i in range(8):
        y = 0.3 + i * 0.08
        m.box(-w / 2 + 0.1, y, -d / 2 - 0.01, w / 2 - 0.1, y + 0.03, -d / 2, "steel_grey", skip=("pz",))
    m.box(w / 2 - 0.5, 0.4, d / 2, w / 2 - 0.1, 0.8, d / 2 + 0.6, "galvanized", skip=("nz",))
    return m


def extractor_fan(r: float = 0.45) -> MeshData:
    m = MeshData()
    m.box(-r - 0.1, 0.0, -r - 0.1, r + 0.1, 0.25, r + 0.1, "galvanized")
    m.cylinder((0, 0.25, 0), r, 0.55, "galvanized", segments=16, caps=(False, False))
    m.cylinder((0, 0.8, 0), r + 0.12, 0.1, "galvanized", segments=16, radius_top=0.1)
    return m


def roof_vent_stack(h: float = 1.4) -> MeshData:
    m = MeshData()
    m.cylinder((0, 0, 0), 0.12, h, "galvanized", segments=10, caps=(False, False))
    m.cylinder((0, h, 0), 0.22, 0.2, "galvanized", segments=10, radius_top=0.03)
    return m


def skylight(w: float, d: float) -> MeshData:
    """Raised roof light (upstand + glazing); sits on a flat roof or on the low-pitch plane."""
    m = MeshData()
    m.box(-w / 2, 0.0, -d / 2, w / 2, 0.25, d / 2, "galvanized", skip=("py",))
    m.face_toward([(-w / 2, 0.25, -d / 2), (w / 2, 0.25, -d / 2), (w / 2, 0.25, d / 2), (-w / 2, 0.25, d / 2)], "glass_skylight", (0, 1, 0))
    for i in range(1, max(2, int(w / 1.2))):
        x = -w / 2 + i * w / max(2, int(w / 1.2))
        m.box(x - 0.02, 0.25, -d / 2, x + 0.02, 0.29, d / 2, "galvanized", skip=("ny",))
    return m


def roof_ladder(h: float) -> MeshData:
    """Cat ladder fixed to a wall with a safety cage; origin at its foot on the wall."""
    m = MeshData()
    y0 = 2.6
    for x in (-0.22, 0.22):
        m.box(x - 0.025, y0, -0.2, x + 0.025, h + 1.0, -0.16, "galvanized")
        for y in (y0 + 0.2, h - 0.2):
            m.box(x - 0.02, y, -0.16, x + 0.02, y + 0.04, 0.0, "galvanized", skip=("pz",))
    y = y0 + 0.15
    while y < h + 0.9:
        m.tube((-0.2, y, -0.18), (0.2, y, -0.18), 0.012, "galvanized", segments=4, caps=False)
        y += 0.3
    y = y0 + 1.6
    while y < h + 0.9:
        pts = [(math.cos(a) * 0.36, y, -0.18 - 0.36 - math.sin(a) * 0.36 + 0.36) for a in [math.pi * k / 6 for k in range(7)]]
        for a, b in zip(pts, pts[1:]):
            m.tube(a, b, 0.012, "galvanized", segments=4, caps=False)
        y += 0.9
    return m
