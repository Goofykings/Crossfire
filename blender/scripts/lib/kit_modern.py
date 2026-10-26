"""Facade and roof kit for Modern City buildings (apartments, offices, shops, garages).

Same local space as kit.py: origin at the bottom centre of the opening on the wall's OUTER plane, +x along the wall,
+y up, outward = -z, into the wall = +z (the reveal runs from z = 0 to REVEAL). Pieces glued to the wall leave out the
face they would share with it; printed layers (signs) stand at least 8 mm proud.
"""
from __future__ import annotations

import math

from kit import REVEAL
from meshkit import MeshData


def window_modern(w: float, h: float, glass: str = "glass_window", frame: str = "aluminium", split: bool = True) -> MeshData:
    """Aluminium window set deep in its reveal (recessed): frame, optional middle mullion, single glass sheet."""
    m = MeshData()
    zf, zb = REVEAL - 0.1, REVEAL - 0.03
    t = 0.055
    x0, x1 = -w / 2, w / 2
    m.box(x0, 0, zf, x0 + t, h, zb, frame, skip=("pz",))
    m.box(x1 - t, 0, zf, x1, h, zb, frame, skip=("pz",))
    m.box(x0 + t, h - t, zf, x1 - t, h, zb, frame, skip=("pz", "nx", "px"))
    m.box(x0 + t, 0, zf, x1 - t, t, zb, frame, skip=("pz", "nx", "px"))
    gz = zb - 0.012
    if split and w > 1.1:
        m.box(-0.025, t, zf + 0.01, 0.025, h - t, gz + 0.004, frame, skip=("pz", "ny", "py"))
    # blinds texture is one 0.5 x 1 m sheet: map it across the pane (UVs in metres, tile 1)
    # (u grows toward -x, the viewer's right)
    uv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] if glass == "window_blinds" else [(0, 0), (w, 0), (w, h), (0, h)]
    m.face([(x1 - t, t, gz), (x0 + t, t, gz), (x0 + t, h - t, gz), (x1 - t, h - t, gz)], glass, uv=uv)
    return m


def header(w: float, mat: str = "concrete_trim", depth: float = 0.04) -> MeshData:
    """Lintel band over a window, proud of the wall (back face omitted)."""
    m = MeshData()
    m.box(-w / 2 - 0.1, 0.0, -depth, w / 2 + 0.1, 0.2, 0.0, mat, skip=("pz",))
    return m


def storefront(w: float, h: float, sign: int, awning: str | None, shutter: float = 0.0, roller: str = "roller_grey",
               frame: str = "steel_dark") -> MeshData:
    """Shop window and door in a black frame, granite stall riser, fascia sign above, optional awning and a roll-down
    shutter drawn `shutter` (0..1) of the way down."""
    m = MeshData()
    z = REVEAL - 0.14
    t = 0.07
    x0, x1 = -w / 2, w / 2
    dw = 1.1
    dx = x0 + 0.9 + dw / 2 if w > 3.2 else 0.0
    m.box(x0, 0, z - 0.03, x0 + t, h, REVEAL, frame, skip=("pz",))
    m.box(x1 - t, 0, z - 0.03, x1, h, REVEAL, frame, skip=("pz",))
    m.box(x0 + t, h - t, z - 0.03, x1 - t, h, REVEAL, frame, skip=("pz", "nx", "px"))
    for px in (dx - dw / 2 - t, dx + dw / 2):
        m.box(px, 0, z - 0.03, px + t, h - t, REVEAL, frame, skip=("pz",))
    panes = [(x0 + t, dx - dw / 2 - t), (dx + dw / 2 + t, x1 - t)]
    for (a, b) in panes:
        if b - a < 0.2:
            continue
        m.box(a, 0, z - 0.02, b, 0.45, REVEAL, "granite", skip=("pz",))
        m.face([(b, 0.45, z + 0.02), (a, 0.45, z + 0.02), (a, h - t, z + 0.02), (b, h - t, z + 0.02)], "glass_store",
               uv=[(b, 0), (a, 0), (a, h), (b, h)])
        m.box(a, h - 0.5, z - 0.01, b, h - 0.45, z + 0.02, frame, skip=("pz",))
    # glass door with a push bar
    m.box(dx - dw / 2, 0.0, z + 0.03, dx + dw / 2, h - t - 0.4, REVEAL, frame, skip=("pz",))
    m.face([(dx + dw / 2 - 0.08, 0.15, z + 0.022), (dx - dw / 2 + 0.08, 0.15, z + 0.022), (dx - dw / 2 + 0.08, h - t - 0.48, z + 0.022),
            (dx + dw / 2 - 0.08, h - t - 0.48, z + 0.022)], "glass_store", uv=[(1, 0), (0, 0), (0, 2), (1, 2)])
    m.box(dx - dw / 2 + 0.12, 1.0, z - 0.03, dx + dw / 2 - 0.12, 1.04, z + 0.0, "aluminium")
    m.face([(dx + dw / 2, h - t - 0.4, z + 0.03), (dx - dw / 2, h - t - 0.4, z + 0.03), (dx - dw / 2, h - t, z + 0.03),
            (dx + dw / 2, h - t, z + 0.03)], "glass_store", uv=[(1, 0), (0, 0), (0, 0.4), (1, 0.4)])
    # fascia sign (sign_city atlas, 2 x 8 cells), on a frame 5 cm off the wall
    sw, sh = min(w + 0.3, 5.0), 0.7
    u0, v0 = (sign % 2) * 0.5, 1.0 - (sign // 2 + 1) * 0.125
    m.box(-sw / 2 - 0.05, h + 0.1, -0.05, sw / 2 + 0.05, h + 0.1 + sh + 0.1, 0.0, frame, skip=("pz",))
    m.face([(sw / 2, h + 0.15, -0.058), (-sw / 2, h + 0.15, -0.058), (-sw / 2, h + 0.15 + sh, -0.058), (sw / 2, h + 0.15 + sh, -0.058)],
           "sign_city", uv=[(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.125), (u0, v0 + 0.125)])
    if shutter > 0.01:
        sy = h - (h - 0.02) * shutter
        m.face([(x1 - 0.02, sy, -0.06), (x0 + 0.02, sy, -0.06), (x0 + 0.02, h, -0.06), (x1 - 0.02, h, -0.06)], roller,
               uv=[(w, sy), (0, sy), (0, h), (w, h)])
        m.box(x0 + 0.02, sy - 0.06, -0.09, x1 - 0.02, sy, -0.04, frame)
        for x in (x0 - 0.06, x1):
            m.box(x, 0.0, -0.08, x + 0.06, h, 0.0, frame, skip=("pz",))
    if awning:
        # hung between the opening and the fascia: mounted above the sign, it hid the lettering from the street
        d = 1.2
        ay = h + 0.06
        drop, valance = 0.4, 0.2
        aw = w + 0.2
        top = [(aw / 2, ay - drop, -d), (-aw / 2, ay - drop, -d), (-aw / 2, ay, -0.03), (aw / 2, ay, -0.03)]
        m.face(top, awning)
        m.face(list(reversed(top)), awning)
        lip = [(aw / 2, ay - drop, -d), (-aw / 2, ay - drop, -d), (-aw / 2, ay - drop - valance, -d), (aw / 2, ay - drop - valance, -d)]
        m.face_toward(lip, awning, (0, 0, -1))
        m.face_toward(lip, awning, (0, 0, 1))
        m.box(-aw / 2 - 0.02, ay - 0.04, -0.06, aw / 2 + 0.02, ay + 0.06, 0.0, frame, skip=("pz",))
    return m


def entrance(w: float, h: float, frame: str = "aluminium") -> MeshData:
    """Apartment entrance: glazed door with sidelight and transom, intercom panel and a house-number plate."""
    m = MeshData()
    z = REVEAL - 0.1
    t = 0.06
    x0, x1 = -w / 2, w / 2
    m.box(x0, 0, z - 0.02, x0 + t, h, REVEAL, frame, skip=("pz",))
    m.box(x1 - t, 0, z - 0.02, x1, h, REVEAL, frame, skip=("pz",))
    m.box(x0 + t, h - t, z - 0.02, x1 - t, h, REVEAL, frame, skip=("pz", "nx", "px"))
    dh = h - 0.55
    m.box(x0 + t, dh, z - 0.02, x1 - t, dh + t, REVEAL, frame, skip=("pz", "nx", "px"))
    dw = min(1.0, w - 0.5)
    dx = x0 + t + dw / 2
    m.box(dx + dw / 2, 0, z - 0.02, dx + dw / 2 + t, dh, REVEAL, frame, skip=("pz",))
    m.box(dx - dw / 2, 0, z + 0.02, dx + dw / 2, dh, REVEAL, "steel_dark", skip=("pz",))
    m.face([(dx + dw / 2 - 0.1, 0.4, z + 0.012), (dx - dw / 2 + 0.1, 0.4, z + 0.012), (dx - dw / 2 + 0.1, dh - 0.12, z + 0.012),
            (dx + dw / 2 - 0.1, dh - 0.12, z + 0.012)], "glass_window", uv=[(1, 0), (0, 0), (0, 2), (1, 2)])
    m.box(dx + dw / 2 - 0.12, 0.95, z - 0.06, dx + dw / 2 - 0.08, 1.35, z + 0.01, "aluminium")
    side_x0, side_x1 = dx + dw / 2 + t, x1 - t
    if side_x1 - side_x0 > 0.15:
        m.face([(side_x1, 0.1, z + 0.01), (side_x0, 0.1, z + 0.01), (side_x0, dh, z + 0.01), (side_x1, dh, z + 0.01)], "glass_window",
               uv=[(1, 0), (0, 0), (0, 2), (1, 2)])
    m.face([(x1 - t, dh + t, z + 0.01), (x0 + t, dh + t, z + 0.01), (x0 + t, h - t, z + 0.01), (x1 - t, h - t, z + 0.01)], "glass_window",
           uv=[(1, 0), (0, 0), (0, 0.4), (1, 0.4)])
    # intercom and number plate on the wall beside the door
    m.box(x1 + 0.12, 1.15, -0.03, x1 + 0.28, 1.5, 0.0, "aluminium", skip=("pz",))
    for k in range(4):
        m.box(x1 + 0.16, 1.2 + k * 0.07, -0.038, x1 + 0.24, 1.24 + k * 0.07, -0.03, "steel_dark", skip=("pz",))
    m.box(x1 + 0.1, 2.0, -0.02, x1 + 0.34, 2.2, 0.0, "steel_blue", skip=("pz",))
    return m


def garage_door(w: float, h: float, mat: str) -> MeshData:
    """Sectional garage door: four panels with grooves, frame, a lamp above."""
    m = MeshData()
    z = REVEAL * 0.5
    x0, x1 = -w / 2, w / 2
    n = 4
    for i in range(n):
        y0, y1 = i * h / n, (i + 1) * h / n
        m.face([(x1 - 0.04, y0 + 0.015, z), (x0 + 0.04, y0 + 0.015, z), (x0 + 0.04, y1 - 0.015, z), (x1 - 0.04, y1 - 0.015, z)], mat,
               uv=[(w, y0), (0, y0), (0, y1), (w, y1)])
        m.box(x0 + 0.04, y1 - 0.02, z + 0.0, x1 - 0.04, y1 + 0.02 if i < n - 1 else y1, z + 0.02, "steel_dark", skip=("nz",))
    for x in (x0, x1 - 0.04):
        m.box(x, 0.0, z - 0.02, x + 0.04, h, z + 0.04, "steel_dark")
    m.box(-0.1, 0.4, z - 0.03, 0.1, 0.44, z, "aluminium", skip=("pz",))
    m.box(x0 - 0.08, 0.0, -0.025, x0, h + 0.08, 0.0, "steel_dark", skip=("pz",))
    m.box(x1, 0.0, -0.025, x1 + 0.08, h + 0.08, 0.0, "steel_dark", skip=("pz",))
    m.box(x0 - 0.08, h, -0.025, x1 + 0.08, h + 0.08, 0.0, "steel_dark", skip=("pz",))
    m.box(-0.12, h + 0.3, -0.1, 0.12, h + 0.42, 0.0, "steel_dark", skip=("pz",))
    m.box(-0.1, h + 0.29, -0.09, 0.1, h + 0.3, -0.01, "lamp_led", skip=("py",))
    return m


def ac_window() -> MeshData:
    """Window air-conditioner hanging just below a sill (origin at the sill centre on the wall)."""
    m = MeshData()
    m.box(-0.33, -0.48, -0.5, 0.33, -0.1, 0.0, "plastic_white", skip=("pz",))
    for k in range(6):
        y = -0.42 + k * 0.05
        m.box(-0.28, y, -0.512, 0.28, y + 0.025, -0.5, "plastic_grey", skip=("pz",))
    for x in (-0.25, 0.25):
        m.tube((x, -0.48, -0.45), (x, -0.95, -0.02), 0.012, "steel_dark", segments=4)
    return m


def fire_escape(floors: int, w: float, first: float, fh: float) -> MeshData:
    """Steel fire escape: a landing at each upper floor, a stair between landings, a drop ladder below the first.

    Origin on the wall plane at the bottom centre; landings project 1.2 m outward (-z), the lowest at `first` m. Every
    part is well above jump reach, so it needs no collision.
    """
    m = MeshData()
    d = 1.2
    x0, x1 = -w / 2, w / 2
    for k in range(floors):
        y = first + k * fh
        m.box(x0, y - 0.05, -d, x1, y, -0.02, "metal_plate", skip=("pz",))
        m.box(x0, y - 0.15, -d, x1, y - 0.05, -d + 0.05, "steel_dark")
        for x in (x0 + 0.05, x1 - 0.05):
            m.tube((x, y - 0.1, -0.02), (x, y - 0.75, -0.02 - 0.0), 0.02, "steel_dark", segments=4)
            m.tube((x, y - 0.75, -0.02), (x, y - 0.1, -d + 0.1), 0.02, "steel_dark", segments=4)
        # railing
        for (a, b) in (((x0, -d + 0.02), (x1, -d + 0.02)), ((x0, -d + 0.02), (x0, -0.04)), ((x1, -d + 0.02), (x1, -0.04))):
            for yy in (y + 1.0, y + 0.5):
                m.tube((a[0], yy, a[1]), (b[0], yy, b[1]), 0.016, "steel_dark", segments=4)
        n = max(2, int(w / 0.5))
        for i in range(n + 1):
            x = x0 + i * w / n
            m.tube((x, y, -d + 0.02), (x, y + 1.0, -d + 0.02), 0.01, "steel_dark", segments=3, caps=False)
        # stair up to the next landing, running along the wall
        if k < floors - 1:
            sx0, sx1 = x0 + 0.3, x1 - 0.3
            steps = max(6, int(fh / 0.2))
            for j in range(steps):
                t = j / steps
                x = sx0 + (sx1 - sx0) * t
                yy = y + fh * t
                m.box(x - 0.11, yy, -d + 0.15, x + 0.11, yy + 0.03, -d + 0.75, "metal_plate")
            for zz in (-d + 0.13, -d + 0.77):
                m.tube((sx0, y, zz), (sx1, y + fh, zz), 0.03, "steel_dark", segments=4)
                m.tube((sx0, y + 0.9, zz - 0.0), (sx1, y + fh + 0.9, zz), 0.015, "steel_dark", segments=3)
    # drop ladder stowed under the first landing
    lx = x1 - 0.35
    for x in (lx - 0.2, lx + 0.2):
        m.tube((x, first - 1.6, -d + 0.15), (x, first, -d + 0.15), 0.018, "steel_dark", segments=4)
    y = first - 1.5
    while y < first:
        m.tube((lx - 0.2, y, -d + 0.15), (lx + 0.2, y, -d + 0.15), 0.01, "steel_dark", segments=3, caps=False)
        y += 0.3
    return m


def blade_sign(cell: int) -> MeshData:
    """Projecting sign board (sign_city atlas) on a bracket, perpendicular to the wall."""
    m = MeshData()
    m.box(-0.04, -0.05, -0.12, 0.04, 0.05, 0.0, "steel_dark", skip=("pz",))
    m.box(-0.025, -0.9, -1.05, 0.025, 0.05, -0.12, "steel_dark")
    u0, v0 = (cell % 2) * 0.5, 1.0 - (cell // 2 + 1) * 0.125
    for sgn in (-1, 1):
        x = sgn * 0.034
        pts = [(x, -0.86, -0.15), (x, -0.86, -1.02), (x, 0.0, -1.02), (x, 0.0, -0.15)]
        # viewers on +x see the board's -z end on their right: u grows toward -z there, toward +z on the other side
        uv = [(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.125), (u0, v0 + 0.125)] if sgn > 0 else \
            [(u0 + 0.5, v0), (u0, v0), (u0, v0 + 0.125), (u0 + 0.5, v0 + 0.125)]
        m.face_toward(pts, "sign_city", (sgn, 0, 0), uv=uv)
    return m


def poster_board(cell: int, w: float = 1.2, h: float = 1.7) -> MeshData:
    """A pasted-up poster on a blank wall (posters atlas, 2 x 2), 8 mm proud."""
    m = MeshData()
    u0, v0 = (cell % 2) * 0.5, 0.5 - (cell // 2) * 0.5
    m.face([(w / 2, 0, -0.008), (-w / 2, 0, -0.008), (-w / 2, h, -0.008), (w / 2, h, -0.008)], "posters",
           uv=[(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0, v0 + 0.5)])
    return m


# --- rooftop ---------------------------------------------------------------------------------------------
def water_tank() -> MeshData:
    """Timber water tank on a steel stand with a conical roof (classic city rooftop)."""
    m = MeshData()
    for (x, z) in ((-0.9, -0.9), (0.9, -0.9), (-0.9, 0.9), (0.9, 0.9)):
        m.box(x - 0.07, 0.0, z - 0.07, x + 0.07, 2.6, z + 0.07, "steel_dark")
    m.box(-1.1, 2.5, -1.1, 1.1, 2.65, 1.1, "steel_dark")
    m.cylinder((0, 2.65, 0), 1.25, 2.6, "wood_pole", segments=18, caps=(True, False))
    for y in (2.9, 3.6, 4.3, 5.0):
        m.cylinder((0, y, 0), 1.27, 0.06, "steel_dark", segments=18, caps=(False, False))
    m.cylinder((0, 5.25, 0), 1.35, 0.9, "wood_pole", segments=18, radius_top=0.08)
    m.cylinder((0, 6.15, 0), 0.08, 0.3, "steel_dark", segments=6)
    m.tube((0.9, 0.2, 0.9), (0.9, 2.5, 0.9), 0.06, "galvanized", segments=6)
    return m


def roof_hut(w: float = 2.6, d: float = 2.2, h: float = 2.6) -> MeshData:
    """Stair access hut with a steel door facing -z."""
    m = MeshData()
    m.box(-w / 2, 0.0, -d / 2, w / 2, h, d / 2, "concrete_smooth_light", skip=("ny",))
    m.box(-w / 2 - 0.06, h, -d / 2 - 0.06, w / 2 + 0.06, h + 0.12, d / 2 + 0.06, "concrete_trim")
    m.box(-0.45, 0.0, -d / 2 - 0.012, 0.45, 2.1, -d / 2, "steel_grey", skip=("pz",))
    m.box(0.25, 1.0, -d / 2 - 0.05, 0.35, 1.05, -d / 2 - 0.012, "aluminium", skip=("pz",))
    m.cylinder((w / 2 - 0.4, h + 0.12, 0.4), 0.06, 1.6, "galvanized", segments=6)
    return m


def satellite_dish() -> MeshData:
    m = MeshData()
    m.box(-0.2, 0.0, -0.2, 0.2, 0.05, 0.2, "steel_dark")
    m.tube((0, 0.05, 0), (0, 0.6, 0), 0.03, "steel_grey", segments=6)
    dish = MeshData()
    dish.cylinder((0, 0, 0), 0.38, 0.12, "plastic_white", segments=14, radius_top=0.42)
    a = math.radians(-55)  # bowl opening tilted up toward the -z side
    dish.verts = [(x, y * math.cos(a) - z * math.sin(a) + 0.6, y * math.sin(a) + z * math.cos(a) - 0.12) for (x, y, z) in dish.verts]
    m.merge(dish)
    return m
