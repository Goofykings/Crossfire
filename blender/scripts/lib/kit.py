"""Facade kit: reusable window / door / shopfront / balcony assemblies.

Local space for every piece: origin at the bottom-centre of the opening on the wall's OUTER plane,
+x along the wall, +y up, outward = -z, into the wall = +z (the reveal runs from z = 0 to REVEAL).
Buildings place pieces with a yaw so local -z matches the facade normal.

Each function returns MeshData that may use several materials; the exporter splits pieces into
single-material parts so the runtime can GPU-instance every part across the whole map.
"""
from __future__ import annotations

import math

from meshkit import MeshData

REVEAL = 0.24
# The sill's top face is the floor of the window opening for its first SILL_BACK metres; the facade generator ends its
# own reveal floor there so the two surfaces never overlap (they used to share one plane and z-fight).
SILL_BACK = REVEAL - 0.1
# Width of the stone frame around a door; the plinth beside a door stops where this frame begins.
SURROUND_B = 0.13


def window(w: float, h: float, frame: str, mullion: bool = True, transom: bool = True) -> MeshData:
    m = MeshData()
    t = 0.065  # frame width
    zb = REVEAL - 0.03  # frame back
    zf = REVEAL - 0.12  # frame front
    x0, x1 = -w / 2, w / 2
    # outer frame
    m.box(x0, 0, zf, x0 + t, h, zb, frame, skip=("pz",))
    m.box(x1 - t, 0, zf, x1, h, zb, frame, skip=("pz",))
    m.box(x0 + t, h - t, zf, x1 - t, h, zb, frame, skip=("pz", "nx", "px"))
    m.box(x0 + t, 0, zf, x1 - t, t * 1.2, zb, frame, skip=("pz", "nx", "px"))
    gz = REVEAL - 0.075
    if mullion:
        m.box(-0.025, t, zf + 0.02, 0.025, h - t, gz + 0.005, frame, skip=("pz", "py", "ny"))
    if transom:
        ty = h * 0.68
        m.box(x0 + t, ty - 0.025, zf + 0.02, x1 - t, ty + 0.025, gz + 0.005, frame, skip=("pz", "nx", "px"))
    m.face([(x1 - t, t * 1.2, gz), (x0 + t, t * 1.2, gz), (x0 + t, h - t, gz), (x1 - t, h - t, gz)], "glass",
           uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    return m


def sill(w: float, mat: str = "stone_trim") -> MeshData:
    m = MeshData()
    m.box(-w / 2 - 0.09, -0.08, -0.07, w / 2 + 0.09, 0.0, SILL_BACK, mat, skip=("pz",))
    return m


def surround(w: float, h: float, mat: str = "stone_trim", keystone: bool = True, depth: float = 0.035) -> MeshData:
    """Stone frame proud of the wall around an opening."""
    m = MeshData()
    b = SURROUND_B
    x0, x1 = -w / 2, w / 2
    m.box(x0 - b, 0, -depth, x0, h, 0, mat, skip=("pz",))
    m.box(x1, 0, -depth, x1 + b, h, 0, mat, skip=("pz",))
    m.box(x0 - b - 0.03, h, -depth - 0.01, x1 + b + 0.03, h + 0.2, 0, mat, skip=("pz",))
    if keystone:
        m.box(-0.11, h - 0.05, -depth - 0.03, 0.11, h + 0.27, 0, mat, skip=("pz",))
    return m


def _leaf(m: MeshData, x0: float, x1: float, h: float, z0: float, z1: float, mat: str, louvres: bool) -> None:
    m.box(x0, 0.02, z0, x1, h - 0.02, z1, mat)
    if louvres:
        n = max(4, int(h / 0.16))
        for i in range(n):
            y = 0.12 + i * (h - 0.24) / n
            m.box(x0 + 0.04, y, z0 - 0.018, x1 - 0.04, y + 0.06, z0, mat, skip=("pz",))
    else:
        for y in (h * 0.18, h * 0.82):
            m.box(x0 + 0.03, y - 0.04, z0 - 0.02, x1 - 0.03, y + 0.04, z0, mat, skip=("pz",))
        # diagonal brace
        mid = MeshData()
        L = math.hypot(x1 - x0 - 0.06, h * 0.64)
        mid.box(-L / 2, -0.035, -0.02, L / 2, 0.035, 0, mat, skip=("pz",))
        ang = math.atan2(h * 0.64, x1 - x0 - 0.06)
        rot = []
        for (x, y, z) in mid.verts:
            rot.append((x * math.cos(ang) - y * math.sin(ang) + (x0 + x1) / 2, x * math.sin(ang) + y * math.cos(ang) + h / 2,
                        z + z0))
        mid.verts = rot
        m.merge(mid)


def shutters_open(w: float, h: float, mat: str, louvres: bool = True) -> MeshData:
    """Two leaves folded back flat against the wall either side of the opening."""
    m = MeshData()
    lw = w / 2
    _leaf(m, -w / 2 - 0.05 - lw, -w / 2 - 0.05, h, -0.06, -0.02, mat, louvres)
    _leaf(m, w / 2 + 0.05, w / 2 + 0.05 + lw, h, -0.06, -0.02, mat, louvres)
    # iron hinges / tie-backs
    for x in (-w / 2 - 0.04, w / 2 + 0.04):
        for y in (h * 0.2, h * 0.8):
            m.box(x - 0.02, y - 0.02, -0.07, x + 0.02, y + 0.02, 0.0, "iron", skip=("pz",))
    return m


def shutters_closed(w: float, h: float, mat: str, louvres: bool = True) -> MeshData:
    m = MeshData()
    _leaf(m, -w / 2 + 0.01, -0.005, h, 0.03, 0.07, mat, louvres)
    _leaf(m, 0.005, w / 2 - 0.01, h, 0.03, 0.07, mat, louvres)
    return m


def flower_box(w: float, flowers: bool = True) -> MeshData:
    m = MeshData()
    L = w + 0.1
    m.box(-L / 2, -0.3, -0.26, L / 2, -0.09, -0.04, "terracotta")
    m.box(-L / 2 + 0.03, -0.12, -0.24, L / 2 - 0.03, -0.1, -0.06, "soil", skip=("ny", "nx", "px", "nz", "pz"))
    for x in (-L / 2 + 0.1, L / 2 - 0.1):
        m.box(x - 0.02, -0.34, -0.2, x + 0.02, -0.12, 0.0, "iron", skip=("pz",))
    if flowers:
        mat = "flowers"
        n = max(2, int(L / 0.35))
        for i in range(n):
            cx = -L / 2 + (i + 0.5) * L / n
            for ang in (0.35, -0.35 + math.pi / 2):
                c, s = math.cos(ang), math.sin(ang)
                r = 0.24
                p0 = (cx - c * r, -0.12, -0.15 + s * r)
                p1 = (cx + c * r, -0.12, -0.15 - s * r)
                m.face([p0, p1, (p1[0], 0.3, p1[2]), (p0[0], 0.3, p0[2])], mat,
                       uv=[(0.05 + 0.1 * (i % 3), 0.05), (0.95 - 0.1 * (i % 3), 0.05), (0.95, 0.55), (0.05, 0.55)])
    return m


def grille(w: float, h: float) -> MeshData:
    m = MeshData()
    n = max(3, int(w / 0.13))
    for i in range(n + 1):
        x = -w / 2 + 0.06 + i * (w - 0.12) / n
        m.box(x - 0.012, 0.0, 0.03, x + 0.012, h, 0.055, "iron")
    for y in (0.15, h * 0.5, h - 0.15):
        m.box(-w / 2 + 0.02, y - 0.015, 0.025, w / 2 - 0.02, y + 0.015, 0.06, "iron")
    return m


def door(w: float, h: float, leaf: str, double: bool = False, transom: bool = True) -> MeshData:
    m = MeshData()
    zb = REVEAL - 0.02
    zf = REVEAL - 0.1
    t = 0.08
    x0, x1 = -w / 2, w / 2
    th = h - (0.45 if transom else 0)
    m.box(x0, 0, zf - 0.02, x0 + t, h, zb, "frame_dark", skip=("pz",))
    m.box(x1 - t, 0, zf - 0.02, x1, h, zb, "frame_dark", skip=("pz",))
    m.box(x0 + t, h - t, zf - 0.02, x1 - t, h, zb, "frame_dark", skip=("pz", "nx", "px"))
    if transom:
        m.box(x0 + t, th, zf - 0.02, x1 - t, th + 0.07, zb, "frame_dark", skip=("pz", "nx", "px"))
        m.face([(x1 - t, th + 0.07, zf + 0.04), (x0 + t, th + 0.07, zf + 0.04), (x0 + t, h - t, zf + 0.04),
                (x1 - t, h - t, zf + 0.04)], "glass", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    leaves = [(x0 + t, x1 - t)] if not double else [(x0 + t, -0.005), (0.005, x1 - t)]
    for (a, b) in leaves:
        m.box(a, 0.0, zf, b, th, zb, leaf, skip=("pz",))
        # raised panels
        pw = (b - a) - 0.16
        for (py0, py1) in ((0.18, th * 0.45), (th * 0.52, th - 0.16)):
            m.box(a + 0.08, py0, zf - 0.025, a + 0.08 + pw, py1, zf, leaf, skip=("pz",))
        # strap hinges
        hx = a if (a < 0 or not double) else b
        for y in (0.3, th - 0.35):
            if not double or a < 0:
                m.box(a + 0.02, y - 0.025, zf - 0.035, a + 0.42, y + 0.025, zf, "iron", skip=("pz",))
            else:
                m.box(b - 0.42, y - 0.025, zf - 0.035, b - 0.02, y + 0.025, zf, "iron", skip=("pz",))
        del hx
    # handle(s)
    hxs = [x1 - t - 0.12] if not double else [-0.09, 0.09]
    for hx in hxs:
        m.box(hx - 0.02, 1.0, zf - 0.07, hx + 0.02, 1.08, zf - 0.025, "copper")
        m.box(hx - 0.035, 0.92, zf - 0.036, hx + 0.035, 1.16, zf, "iron", skip=("pz",))
    return m


def threshold(w: float, mat: str = "stone_blocks") -> MeshData:
    m = MeshData()
    m.box(-w / 2 - 0.12, 0.0, -0.32, w / 2 + 0.12, 0.12, REVEAL, mat, skip=("pz", "ny"))
    return m


def shopfront(w: float, h: float, sign_index: int, awning: str | None, frame: str = "frame_dark") -> MeshData:
    """Large display window with a central door, stall riser, fascia sign and optional awning.

    The opening is w x h; the sign board and awning sit above it on the wall.
    """
    m = MeshData()
    z = REVEAL - 0.12
    t = 0.09
    x0, x1 = -w / 2, w / 2
    dw = 1.1
    # frame
    m.box(x0, 0, z - 0.04, x0 + t, h, REVEAL, frame, skip=("pz",))
    m.box(x1 - t, 0, z - 0.04, x1, h, REVEAL, frame, skip=("pz",))
    m.box(x0 + t, h - t, z - 0.04, x1 - t, h, REVEAL, frame, skip=("pz", "nx", "px"))
    # door posts
    m.box(-dw / 2 - t, 0, z - 0.04, -dw / 2, h - t, REVEAL, frame, skip=("pz",))
    m.box(dw / 2, 0, z - 0.04, dw / 2 + t, h - t, REVEAL, frame, skip=("pz",))
    # stall risers + display glass either side
    for (a, b) in ((x0 + t, -dw / 2 - t), (dw / 2 + t, x1 - t)):
        m.box(a, 0, z - 0.03, b, 0.62, REVEAL, frame, skip=("pz",))
        m.box(a + 0.06, 0.12, z - 0.05, b - 0.06, 0.5, z - 0.03, frame, skip=("pz",))
        m.face([(b, 0.62, z + 0.03), (a, 0.62, z + 0.03), (a, h - t, z + 0.03), (b, h - t, z + 0.03)], "glass_shop",
               uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
        # glazing bars
        mid = (a + b) / 2
        m.box(mid - 0.025, 0.62, z - 0.01, mid + 0.025, h - t, z + 0.03, frame, skip=("pz",))
        m.box(a, h * 0.72, z - 0.01, b, h * 0.72 + 0.05, z + 0.03, frame, skip=("pz",))
    # door leaf with glazing
    m.box(-dw / 2, 0, z + 0.02, dw / 2, h - t - 0.4, REVEAL, frame, skip=("pz",))
    m.face([(dw / 2 - 0.12, 0.95, z + 0.012), (-dw / 2 + 0.12, 0.95, z + 0.012), (-dw / 2 + 0.12, h - t - 0.55, z + 0.012),
            (dw / 2 - 0.12, h - t - 0.55, z + 0.012)], "glass_shop", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    m.face([(dw / 2, h - t - 0.4, z + 0.03), (-dw / 2, h - t - 0.4, z + 0.03), (-dw / 2, h - t, z + 0.03),
            (dw / 2, h - t, z + 0.03)], "glass_shop", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # fascia sign board above the opening (uses a cell of the 2x4 sign atlas)
    sw = min(w + 0.2, 4.2)
    cu, cv = (sign_index % 2) * 0.5, 1.0 - (sign_index // 2 + 1) * 0.25
    m.box(-sw / 2 - 0.04, h + 0.08, -0.07, sw / 2 + 0.04, h + 0.62, 0.0, frame, skip=("pz",))
    m.face([(sw / 2, h + 0.12, -0.078), (-sw / 2, h + 0.12, -0.078), (-sw / 2, h + 0.58, -0.078), (sw / 2, h + 0.58, -0.078)],
           "shop_sign", uv=[(cu, cv), (cu + 0.5, cv), (cu + 0.5, cv + 0.25), (cu, cv + 0.25)])
    if awning:
        d = 1.1
        ay = h + 0.68
        drop = 0.42
        aw = w + 0.3
        m.face([(aw / 2, ay - drop, -d), (-aw / 2, ay - drop, -d), (-aw / 2, ay, -0.02), (aw / 2, ay, -0.02)], awning)
        m.face([(-aw / 2, ay - drop, -d), (aw / 2, ay - drop, -d), (aw / 2, ay, -0.02), (-aw / 2, ay, -0.02)], awning)
        # scalloped valance
        n = int(aw / 0.32)
        for i in range(n):
            a = -aw / 2 + i * aw / n
            b = a + aw / n
            m.face([(b, ay - drop, -d), (a, ay - drop, -d), ((a + b) / 2, ay - drop - 0.2, -d)], awning)
            m.face([(a, ay - drop, -d), (b, ay - drop, -d), ((a + b) / 2, ay - drop - 0.2, -d)], awning)
        # iron arms
        for x in (-aw / 2 + 0.05, aw / 2 - 0.05):
            m.tube((x, ay - 0.05, -0.02), (x, ay - drop - 0.02, -d + 0.02), 0.015, "iron", segments=5)
    return m


def balcony(w: float, depth: float) -> MeshData:
    """Stone slab on corbels with a wrought-iron railing. Origin = facade plane at floor level."""
    m = MeshData()
    x0, x1 = -w / 2, w / 2
    m.box(x0, -0.16, -depth, x1, 0.0, 0.0, "stone_trim", skip=("pz",))
    m.box(x0 + 0.04, -0.2, -depth + 0.04, x1 - 0.04, -0.16, 0.0, "stone_trim", skip=("pz", "py"))
    n_corbels = 2 if w < 2.4 else 3
    for i in range(n_corbels):
        cx = x0 + 0.3 + i * (w - 0.6) / max(1, n_corbels - 1)
        m.box(cx - 0.1, -0.55, -depth * 0.55, cx + 0.1, -0.2, 0.0, "stone_trim", skip=("pz", "py"))
        m.box(cx - 0.1, -0.38, -depth * 0.85, cx + 0.1, -0.2, -depth * 0.55, "stone_trim", skip=("py", "pz"))
    rh = 1.0
    zf = -depth + 0.05
    # rails
    m.box(x0 + 0.03, rh - 0.03, zf - 0.025, x1 - 0.03, rh + 0.02, zf + 0.025, "iron")
    m.box(x0 + 0.03, 0.08, zf - 0.015, x1 - 0.03, 0.12, zf + 0.015, "iron")
    for x in (x0 + 0.05, x1 - 0.05):
        m.box(x - 0.025, rh - 0.03, zf, x + 0.025, rh + 0.02, -0.02, "iron")
        m.box(x - 0.015, 0.08, zf, x + 0.015, 0.12, -0.02, "iron")
    # balusters with a twist in the middle
    n = max(4, int((w - 0.1) / 0.14))
    for i in range(n + 1):
        x = x0 + 0.05 + i * (w - 0.1) / n
        m.box(x - 0.011, 0.0, zf - 0.011, x + 0.011, rh, zf + 0.011, "iron")
        if i % 2 == 0:
            m.box(x - 0.03, rh * 0.45, zf - 0.03, x + 0.03, rh * 0.55, zf + 0.03, "iron")
    nside = max(2, int(depth / 0.14))
    for x in (x0 + 0.05, x1 - 0.05):
        for j in range(1, nside):
            zz = zf + j * (depth - 0.07) / nside
            m.box(x - 0.011, 0.0, zz - 0.011, x + 0.011, rh, zz + 0.011, "iron")
    # a couple of pots
    for px in (x0 + 0.35, x1 - 0.35):
        m.cylinder((px, 0.0, -0.28), 0.14, 0.26, "terracotta", segments=8, radius_top=0.18)
        for ang in (0.4, 0.4 + math.pi / 2):
            c, s = math.cos(ang), math.sin(ang)
            p0 = (px - c * 0.3, 0.2, -0.28 + s * 0.3)
            p1 = (px + c * 0.3, 0.2, -0.28 - s * 0.3)
            m.face([p0, p1, (p1[0], 0.75, p1[2]), (p0[0], 0.75, p0[2])], "foliage",
                   uv=[(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)])
    return m


def hanging_sign(index: int) -> MeshData:
    """Wrought-iron bracket projecting from the wall with a painted board. Origin at the wall bracket."""
    m = MeshData()
    m.box(-0.02, -0.02, -0.95, 0.02, 0.02, 0.0, "iron")
    m.tube((0.0, -0.55, 0.0), (0.0, 0.0, -0.62), 0.012, "iron", segments=5)
    m.box(-0.06, -0.12, -0.02, 0.06, 0.12, 0.0, "iron", skip=("pz",))
    cu, cv = (index % 2) * 0.5, 1.0 - (index // 2 + 1) * 0.25
    # board hangs perpendicular to the wall (visible from along the street)
    for side in (-1, 1):
        x = 0.022 * side
        if side > 0:
            pts = [(x, -0.62, -0.16), (x, -0.62, -0.9), (x, -0.08, -0.9), (x, -0.08, -0.16)]
        else:
            pts = [(x, -0.62, -0.9), (x, -0.62, -0.16), (x, -0.08, -0.16), (x, -0.08, -0.9)]
        uv = [(cu, cv), (cu + 0.5, cv), (cu + 0.5, cv + 0.25), (cu, cv + 0.25)]
        m.face(pts, "shop_sign", uv=uv)
    m.box(-0.02, -0.64, -0.92, 0.02, -0.06, -0.14, "frame_dark", skip=("nx", "px"))
    for zz in (-0.25, -0.8):
        m.box(-0.006, -0.08, zz - 0.006, 0.006, 0.0, zz + 0.006, "iron")
    return m


def wall_lantern() -> MeshData:
    """Bracket lantern; origin on the wall at the bracket, lantern hangs ~0.45 m out."""
    m = MeshData()
    m.box(-0.06, -0.12, -0.03, 0.06, 0.12, 0.0, "iron", skip=("pz",))
    m.tube((0.0, 0.0, -0.02), (0.0, 0.0, -0.48), 0.014, "iron", segments=6)
    m.tube((0.0, -0.18, -0.02), (0.0, -0.01, -0.3), 0.01, "iron", segments=5)
    cx, cz = 0.0, -0.46
    m.box(cx - 0.012, -0.12, cz - 0.012, cx + 0.012, 0.0, cz + 0.012, "iron")
    # cage
    top, bot = -0.12, -0.5
    m.cylinder((cx, top - 0.04, cz), 0.12, 0.05, "iron", segments=4, radius_top=0.05)
    m.cylinder((cx, bot, cz), 0.09, 0.04, "iron", segments=4)
    m.cylinder((cx, bot + 0.04, cz), 0.085, top - 0.04 - bot - 0.04, "lantern_glass", segments=4,
               radius_top=0.1, caps=(False, False))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, z = cx + math.cos(a) * 0.1, cz - math.sin(a) * 0.1
        m.box(x - 0.01, bot, z - 0.01, x + 0.01, top - 0.04, z + 0.01, "iron")
    return m
