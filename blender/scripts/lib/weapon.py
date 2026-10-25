"""Stylised sci-fi blaster ("VK-7 Pulse Carbine") built from extruded, bevelled side profiles.

Local space: origin at the top of the grip (where the hand sits), barrel toward -z, up +y, right +x.
Empties exported alongside: `muzzle` (beam origin) and `sight` (optical centre of the holo sight,
used to align aim-down-sights).

Palette: gunmetal frame (weapon_dark), off-white armour panels (weapon_panel), mid-grey machined
parts (weapon_body), rubber grip, orange accents and cyan energy glow.
"""
from __future__ import annotations

import math

from meshkit import MeshData

MUZZLE = (0.0, 0.07, -0.64)
SIGHT = (0.0, 0.186, -0.12)


def extrude(md: MeshData, profile, x0: float, x1: float, mat: str, bevel: float = 0.006, side_mat: str | None = None):
    """Extrude a side profile [(z, y), ...] between x0 and x1 with chamfered edges."""
    n = len(profile)
    cz = sum(p[0] for p in profile) / n
    cy = sum(p[1] for p in profile) / n

    def inset(p, d):
        dz, dy = p[0] - cz, p[1] - cy
        L = math.hypot(dz, dy) or 1.0
        return (p[0] - dz / L * d, p[1] - dy / L * d)

    inner = [inset(p, bevel) for p in profile]
    xa, xb = x0 + bevel, x1 - bevel
    sm = side_mat or mat
    md.face([(xb, y, z) for (z, y) in inner], sm)
    md.face([(xa, y, z) for (z, y) in reversed(inner)], sm)
    for i in range(n):
        (z0, y0), (z1, y1) = profile[i], profile[(i + 1) % n]
        (iz0, iy0), (iz1, iy1) = inner[i], inner[(i + 1) % n]
        md.face([(xa, y0, z0), (xb, y0, z0), (xb, y1, z1), (xa, y1, z1)][::-1], mat)
        md.face([(xb, y0, z0), (xb, iy0, iz0), (xb, iy1, iz1), (xb, y1, z1)], mat)
        md.face([(xa, y1, z1), (xa, iy1, iz1), (xa, iy0, iz0), (xa, y0, z0)], mat)


def _fix_winding(md: MeshData, start: int, center):
    """Make faces added since `start` point away from `center` (convex-ish parts only)."""
    for fi in range(start, len(md.faces)):
        f = md.faces[fi]
        pts = [md.verts[i] for i in f]
        c = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
        a, b, cc = pts[0], pts[1], pts[2]
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (cc[0] - a[0], cc[1] - a[1], cc[2] - a[2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        out = (c[0] - center[0], c[1] - center[1], c[2] - center[2])
        if n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0:
            md.faces[fi] = list(reversed(f))
            md.face_uv[fi] = list(reversed(md.face_uv[fi]))
            md.face_col[fi] = list(reversed(md.face_col[fi]))


def part(md: MeshData, builder, center):
    start = len(md.faces)
    builder()
    _fix_winding(md, start, center)


def _ring_tube(md: MeshData, z0: float, z1: float, y: float, r: float, mat: str, sides: int = 6, r1: float | None = None):
    r1 = r if r1 is None else r1
    pts0, pts1 = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides + math.pi / sides
        pts0.append((math.cos(a) * r, y + math.sin(a) * r, z0))
        pts1.append((math.cos(a) * r1, y + math.sin(a) * r1, z1))
    for i in range(sides):
        j = (i + 1) % sides
        md.face([pts0[i], pts0[j], pts1[j], pts1[i]], mat)
    md.face(pts0, mat)
    md.face(list(reversed(pts1)), mat)


def blaster() -> MeshData:
    md = MeshData()
    # --- frame: dark lower receiver running the length of the gun -----------------------------
    lower = [(0.11, 0.0), (0.11, 0.058), (-0.36, 0.058), (-0.38, 0.03), (-0.36, 0.0), (-0.13, -0.014), (0.05, -0.014)]
    part(md, lambda: extrude(md, lower, -0.033, 0.033, "weapon_dark", 0.006), (0.0, 0.025, -0.13))
    # --- off-white upper armour shell with a sloped nose ---------------------------------------
    upper = [(0.1, 0.058), (0.1, 0.098), (0.05, 0.124), (-0.22, 0.124), (-0.33, 0.096), (-0.35, 0.058)]
    part(md, lambda: extrude(md, upper, -0.037, 0.037, "weapon_panel", 0.008), (0.0, 0.09, -0.12))
    # orange accent stripe along both sides of the shell + panel grooves
    for x in (-0.0372, 0.0372):
        s = 1 if x > 0 else -1
        md.face_toward([(x, 0.083, -0.31), (x, 0.083, 0.05), (x, 0.093, 0.05), (x, 0.093, -0.31)], "weapon_accent", (s, 0, 0))
        for z in (-0.12, 0.0):
            md.face_toward([(x, 0.062, z), (x, 0.062, z + 0.006), (x, 0.118, z + 0.006), (x, 0.118, z)], "weapon_dark", (s, 0, 0))
        # vents on the dark frame
        for k in range(5):
            z = -0.3 + k * 0.028
            md.face_toward([(x * 0.9, 0.014, z), (x * 0.9, 0.014, z + 0.016), (x * 0.9, 0.044, z + 0.016), (x * 0.9, 0.044, z)],
                           "weapon_glow", (s, 0, 0), col=(0.35, 0.35, 0.35, 1.0))
        # screw heads
        for (zz, yy) in ((0.07, 0.03), (-0.2, 0.03), (0.07, 0.108), (-0.2, 0.108)):
            d = 0.004 * s
            md.face_toward([(x + d, yy - 0.004, zz - 0.004), (x + d, yy - 0.004, zz + 0.004), (x + d, yy + 0.004, zz + 0.004),
                            (x + d, yy + 0.004, zz - 0.004)], "weapon_body", (s, 0, 0))
    # --- energy cell (angled magazine) with glowing core ---------------------------------------
    cell = [(-0.055, -0.012), (-0.135, -0.012), (-0.16, -0.15), (-0.085, -0.162)]
    part(md, lambda: extrude(md, cell, -0.024, 0.024, "weapon_dark", 0.005), (0.0, -0.09, -0.11))
    for x in (-0.0245, 0.0245):
        s = 1 if x > 0 else -1
        md.face_toward([(x, -0.04, -0.075), (x, -0.04, -0.12), (x, -0.125, -0.138), (x, -0.125, -0.093)], "weapon_glow", (s, 0, 0))
    part(md, lambda: md.box(-0.026, -0.165, -0.165, 0.026, -0.148, -0.08, "weapon_accent"), (0, -0.157, -0.12))
    # --- grip with finger grooves ---------------------------------------------------------------
    grip = [(0.0, -0.014), (0.06, -0.014), (0.094, -0.155), (0.09, -0.172), (0.034, -0.175), (0.026, -0.15)]
    part(md, lambda: extrude(md, grip, -0.024, 0.024, "weapon_grip", 0.007), (0.0, -0.09, 0.05))
    for k in range(3):
        y = -0.055 - k * 0.034
        zf = 0.022 + (y + 0.014) * -0.18
        part(md, lambda: md.box(-0.025, y - 0.007, zf - 0.007, 0.025, y + 0.004, zf + 0.003, "weapon_dark"), (0.0, y, zf))
    # trigger guard + trigger
    part(md, lambda: md.box(-0.008, -0.074, -0.065, 0.008, -0.066, 0.004, "weapon_dark"), (0, -0.07, -0.03))
    part(md, lambda: md.box(-0.008, -0.074, -0.07, 0.008, -0.014, -0.06, "weapon_dark"), (0, -0.044, -0.065))
    part(md, lambda: md.box(-0.0045, -0.052, -0.024, 0.0045, -0.014, -0.014, "weapon_accent"), (0, -0.033, -0.019))
    # --- handguard under the barrel with vent slots -------------------------------------------
    guard = [(-0.36, 0.058), (-0.36, 0.004), (-0.47, 0.012), (-0.5, 0.036), (-0.5, 0.058)]
    part(md, lambda: extrude(md, guard, -0.03, 0.03, "weapon_panel", 0.006), (0.0, 0.035, -0.43))
    for x in (-0.0305, 0.0305):
        s = 1 if x > 0 else -1
        for k in range(4):
            z = -0.38 - k * 0.028
            md.face_toward([(x, 0.02, z), (x, 0.02, z - 0.016), (x, 0.046, z - 0.016), (x, 0.046, z)], "weapon_dark", (s, 0, 0))
    # --- barrel shroud (hex) with cooling rings, then the emitter -------------------------------
    part(md, lambda: _ring_tube(md, -0.36, -0.56, 0.08, 0.03, "weapon_dark"), (0, 0.08, -0.46))
    for z in (-0.4, -0.43, -0.46, -0.49, -0.52):
        part(md, lambda: _ring_tube(md, z, z - 0.01, 0.08, 0.037, "weapon_body"), (0, 0.08, z - 0.005))
    part(md, lambda: _ring_tube(md, -0.56, -0.6, 0.075, 0.032, "weapon_body", sides=12, r1=0.028), (0, 0.075, -0.58))
    part(md, lambda: _ring_tube(md, -0.6, -0.615, 0.072, 0.022, "weapon_glow", sides=12), (0, 0.072, -0.607))
    # forked emitter prongs above and below the muzzle
    for sy in (1, -1):
        prong = [(-0.5, 0.0), (-0.64, 0.0), (-0.66, 0.012 * sy), (-0.52, 0.024 * sy)]
        yb = 0.072 + 0.03 * sy
        prof = [(z, yb + dy) for (z, dy) in prong]
        part(md, lambda prof=prof: extrude(md, prof if sy > 0 else list(reversed(prof)), -0.012, 0.012, "weapon_panel", 0.003),
             (0, yb + 0.01 * sy, -0.58))
        md.face_toward([(-0.0125, yb, -0.6), (0.0125, yb, -0.6), (0.0125, yb, -0.635), (-0.0125, yb, -0.635)], "weapon_glow",
                       (0, -sy, 0))
    # --- top rail + holo sight ------------------------------------------------------------------
    part(md, lambda: md.box(-0.016, 0.124, -0.27, 0.016, 0.134, 0.04, "weapon_dark"), (0, 0.129, -0.12))
    for i in range(9):
        z = -0.25 + i * 0.034
        part(md, lambda: md.box(-0.018, 0.134, z, 0.018, 0.14, z + 0.015, "weapon_dark"), (0, 0.137, z + 0.008))
    part(md, lambda: md.box(-0.024, 0.134, -0.17, 0.024, 0.15, -0.07, "weapon_body"), (0, 0.142, -0.12))
    # open frame: two posts and a hood around a glowing lens
    for (a, b) in ((-0.03, -0.022), (0.022, 0.03)):
        part(md, lambda a=a, b=b: md.box(a, 0.15, -0.155, b, 0.222, -0.085, "weapon_dark"), ((a + b) / 2, 0.186, -0.12))
    part(md, lambda: md.box(-0.03, 0.214, -0.16, 0.03, 0.224, -0.08, "weapon_dark"), (0, 0.219, -0.12))
    md.face_toward([(0.022, 0.152, -0.14), (-0.022, 0.152, -0.14), (-0.022, 0.213, -0.14), (0.022, 0.213, -0.14)], "weapon_lens",
                   (0, 0, 1))
    # reticle dot (seen through the lens when aiming)
    md.face_toward([(0.0025, 0.1835, -0.141), (-0.0025, 0.1835, -0.141), (-0.0025, 0.1885, -0.141), (0.0025, 0.1885, -0.141)],
                   "weapon_reticle", (0, 0, 1))
    # --- stock ----------------------------------------------------------------------------------
    stock = [(0.11, 0.09), (0.25, 0.078), (0.268, 0.052), (0.258, -0.02), (0.218, -0.032), (0.11, 0.01)]
    part(md, lambda: extrude(md, stock, -0.03, 0.03, "weapon_panel", 0.009), (0.0, 0.03, 0.19))
    part(md, lambda: md.box(-0.031, -0.032, 0.248, 0.031, 0.074, 0.272, "weapon_grip"), (0, 0.02, 0.26))
    part(md, lambda: md.box(-0.0305, 0.02, 0.13, 0.0305, 0.05, 0.2, "weapon_dark"), (0, 0.035, 0.165))
    # power conduit from the cell to the shroud
    md.tube((0.0, -0.02, -0.15), (0.0, 0.03, -0.355), 0.007, "weapon_glow", segments=5)
    return md
