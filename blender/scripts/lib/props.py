"""Street props. Each builder returns MeshData with the origin at the centre of the footprint on the
ground and the prop's front facing north (-z), matching catalog.PROPS sizes and colliders.

Special cases
  * wall_lantern / sign_*: origin on the wall surface, the object projects toward -z.
  * target: returns two parts ("base", "plate"); the plate's origin is its bottom hinge so the
    runtime can tip it backwards when hit.
"""
from __future__ import annotations

import math
import random

import kit
from meshkit import MeshData, Transform


def _cards(md: MeshData, cx, y0, cz, w, h, mat, count=2, rot=0.3, uv=(0.05, 0.05, 0.95, 0.95)):
    """Crossed alpha-tested cards for foliage."""
    for i in range(count):
        a = rot + i * math.pi / count
        c, s = math.cos(a), math.sin(a)
        p0 = (cx - c * w / 2, y0, cz + s * w / 2)
        p1 = (cx + c * w / 2, y0, cz - s * w / 2)
        md.face([p0, p1, (p1[0], y0 + h, p1[2]), (p0[0], y0 + h, p0[2])], mat,
                uv=[(uv[0], uv[1]), (uv[2], uv[1]), (uv[2], uv[3]), (uv[0], uv[3])])


def _bush(md: MeshData, cx, y0, cz, r, mat="foliage", seed=0, phase=0.0):
    rnd = random.Random(seed)
    for i in range(7):
        # evenly fanned (with jitter): a foliage bush and a flower bush with a half-step `phase` never get two cards
        # lying in nearly the same plane, which would flicker where both are opaque
        a = phase + i * math.pi / 7 + rnd.uniform(-0.04, 0.04)
        h = r * rnd.uniform(1.4, 2.0)
        ox, oz = rnd.uniform(-r * 0.3, r * 0.3), rnd.uniform(-r * 0.3, r * 0.3)
        _cards(md, cx + ox, y0 + rnd.uniform(0, r * 0.4), cz + oz, r * 2 * rnd.uniform(0.8, 1.1), h, mat, 1, a)
    # horizontal cap card
    md.face([(cx - r, y0 + r * 1.3, cz - r), (cx - r, y0 + r * 1.3, cz + r), (cx + r, y0 + r * 1.3, cz + r),
             (cx + r, y0 + r * 1.3, cz - r)], mat, uv=[(0.1, 0.1), (0.1, 0.9), (0.9, 0.9), (0.9, 0.1)])


def crate(size=0.8, seed=0) -> MeshData:
    md = MeshData()
    s = size / 2
    b = size * 0.085  # frame thickness
    m = "wood_crate"
    inset = 0.012
    # panels (slightly inset) with plank seams via texture; the lid sits just below the frame's top plane (a body
    # that ends flush with the frame posts shared their top faces and z-fought)
    md.box(-s + inset, 0.004, -s + inset, s - inset, size - inset, s - inset, m)
    # frame along the 12 edges
    for (x, z) in ((-s, -s), (s - b, -s), (-s, s - b), (s - b, s - b)):
        md.box(x, 0, z, x + b, size, z + b, "wood_dark")
    for y in (0, size - b):
        md.box(-s, y, -s, s, y + b, -s + b, "wood_dark")
        md.box(-s, y, s - b, s, y + b, s, "wood_dark")
        md.box(-s, y, -s + b, -s + b, y + b, s - b, "wood_dark")
        md.box(s - b, y, -s + b, s, y + b, s - b, "wood_dark")
    # diagonal braces on two faces
    rnd = random.Random(seed)
    for face_z in (-s - 0.004, s + 0.004):
        brace = MeshData()
        L = math.hypot(size - 2 * b, size - 2 * b)
        brace.box(-L / 2, -b * 0.45, -0.012, L / 2, b * 0.45, 0.012, "wood_dark")
        ang = math.pi / 4 * (1 if rnd.random() < 0.5 else -1)
        brace.verts = [(x * math.cos(ang) - y * math.sin(ang), x * math.sin(ang) + y * math.cos(ang) + size / 2,
                        z + face_z) for (x, y, z) in brace.verts]
        md.merge(brace)
    return md


def crate_stack() -> MeshData:
    md = MeshData()
    md.merge(crate(0.8, 1), Transform(-0.32, 0, 0.0, 0.05))
    md.merge(crate(0.62, 2), Transform(0.42, 0, 0.08, -0.12))
    md.merge(crate(0.55, 3), Transform(-0.28, 0.8, 0.02, 0.3))
    return md


def barrel(height=0.9, radius=0.31, seed=0) -> MeshData:
    md = MeshData()
    seg = 16
    rings = 8
    profile = []
    for i in range(rings + 1):
        t = i / rings
        r = radius * (0.86 + 0.14 * math.sin(math.pi * t))
        profile.append((r, height * t))
    for i in range(rings):
        (r0, y0), (r1, y1) = profile[i], profile[i + 1]
        for s in range(seg):
            a, b = 2 * math.pi * s / seg, 2 * math.pi * (s + 1) / seg
            p = [(math.cos(a) * r0, y0, -math.sin(a) * r0), (math.cos(b) * r0, y0, -math.sin(b) * r0),
                 (math.cos(b) * r1, y1, -math.sin(b) * r1), (math.cos(a) * r1, y1, -math.sin(a) * r1)]
            u0, u1 = s / seg * 2.0, (s + 1) / seg * 2.0
            md.face(p, "wood_weathered", uv=[(u0, y0), (u1, y0), (u1, y1), (u0, y1)])
    # lid recessed
    top_r = profile[-1][0]
    md.cylinder((0, height - 0.03, 0), top_r * 0.94, 0.0, "wood_dark", segments=seg, caps=(False, True))
    md.cylinder((0, height - 0.03, 0), top_r, 0.03, "wood_dark", segments=seg, radius_top=top_r, caps=(False, False))
    # hoops
    for t in (0.08, 0.3, 0.7, 0.92):
        r = radius * (0.86 + 0.14 * math.sin(math.pi * t)) + 0.006
        md.cylinder((0, height * t - 0.02, 0), r, 0.045, "iron", segments=seg, caps=(False, False))
    return md


def barrel_group() -> MeshData:
    md = MeshData()
    md.merge(barrel(seed=1), Transform(-0.33, 0, -0.2, 0.3))
    md.merge(barrel(seed=2), Transform(0.33, 0, -0.18, 1.1))
    md.merge(barrel(0.8, 0.28, seed=3), Transform(0.0, 0, 0.32, 2.0))
    return md


def flower_pot(large=False, seed=0) -> MeshData:
    md = MeshData()
    r = 0.36 if large else 0.2
    h = 0.55 if large else 0.32
    md.cylinder((0, 0, 0), r * 0.75, h, "terracotta", segments=14, radius_top=r, caps=(True, False))
    md.cylinder((0, h, 0), r + 0.03, 0.06, "terracotta", segments=14, radius_top=r + 0.03)
    md.cylinder((0, h - 0.04, 0), r * 0.92, 0.0, "soil", segments=14, caps=(False, True))
    if large:
        _bush(md, 0, h, 0, 0.42, "foliage", seed)
        _bush(md, 0, h + 0.2, 0, 0.3, "flowers", seed + 1, phase=math.pi / 14)
    else:
        _cards(md, 0, h - 0.05, 0, 0.62, 0.55, "flowers", 3, seed * 0.7)
        _cards(md, 0, h - 0.02, 0, 0.5, 0.42, "foliage", 2, seed * 0.7 + 0.26)
    return md


def bench() -> MeshData:
    md = MeshData()
    L = 1.6
    for z, y in ((-0.12, 0.44), (0.0, 0.44), (0.12, 0.44)):
        md.box(-L / 2, y, z - 0.055, L / 2, y + 0.04, z + 0.055, "wood_weathered")
    for y in (0.62, 0.76):
        md.box(-L / 2, y, 0.2, L / 2, y + 0.09, 0.235, "wood_weathered")
    for x in (-L / 2 + 0.12, L / 2 - 0.12):
        md.box(x - 0.03, 0.0, -0.2, x + 0.03, 0.44, -0.15, "iron")
        md.box(x - 0.03, 0.0, 0.15, x + 0.03, 0.85, 0.2, "iron")
        md.box(x - 0.03, 0.4, -0.2, x + 0.03, 0.44, 0.2, "iron")
        md.box(x - 0.03, 0.62, 0.18, x + 0.03, 0.66, 0.22, "iron")
    return md


def table() -> MeshData:
    md = MeshData()
    md.box(-0.8, 0.72, -0.4, 0.8, 0.78, 0.4, "wood_dark")
    for x in (-0.7, 0.7):
        for z in (-0.3, 0.3):
            md.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.72, z + 0.04, "wood_dark")
    md.box(-0.7, 0.15, -0.03, 0.7, 0.21, 0.03, "wood_dark")
    md.cylinder((0.3, 0.78, 0.1), 0.06, 0.2, "terracotta", segments=8, radius_top=0.04)
    md.cylinder((-0.35, 0.78, -0.05), 0.12, 0.02, "iron", segments=10)
    return md


def stool() -> MeshData:
    md = MeshData()
    md.cylinder((0, 0.42, 0), 0.18, 0.04, "wood_dark", segments=10)
    for k in range(3):
        a = k * 2 * math.pi / 3
        md.tube((math.cos(a) * 0.12, 0.42, -math.sin(a) * 0.12), (math.cos(a) * 0.17, 0.0, -math.sin(a) * 0.17), 0.02,
                "wood_dark", segments=5)
    return md


def market_stall(seed=0) -> MeshData:
    md = MeshData()
    w, d = 2.6, 1.6
    canvas = ("canvas_red", "canvas_green")[seed % 2]
    # posts
    for x in (-w / 2 + 0.05, w / 2 - 0.05):
        md.box(x - 0.05, 0, -d / 2, x + 0.05, 2.35, -d / 2 + 0.1, "wood_dark")
        md.box(x - 0.05, 0, d / 2 - 0.1, x + 0.05, 2.6, d / 2, "wood_dark")
    # counter with produce crates
    md.box(-w / 2 + 0.1, 0.0, -d / 2 + 0.05, w / 2 - 0.1, 0.85, -d / 2 + 0.75, "wood_weathered")
    for i in range(3):
        cx = -w / 2 + 0.5 + i * (w - 1.0) / 2
        md.box(cx - 0.36, 0.85, -d / 2 + 0.1, cx + 0.36, 1.02, -d / 2 + 0.7, "wood_crate")
        md.face([(cx - 0.33, 1.03, -d / 2 + 0.13), (cx - 0.33, 1.03, -d / 2 + 0.67), (cx + 0.33, 1.03, -d / 2 + 0.67),
                 (cx + 0.33, 1.03, -d / 2 + 0.13)], "produce",
                uv=[((i % 2) * 0.5, (i // 2) * 0.5), ((i % 2) * 0.5, (i // 2) * 0.5 + 0.5),
                    ((i % 2) * 0.5 + 0.5, (i // 2) * 0.5 + 0.5), ((i % 2) * 0.5 + 0.5, (i // 2) * 0.5)])
    # back shelf crates
    md.merge(crate(0.55, seed + 4), Transform(-0.7, 0, d / 2 - 0.35, 0.1))
    md.merge(barrel(0.7, 0.24, seed + 5), Transform(0.75, 0, d / 2 - 0.35))
    # sloped canvas roof (higher at the back) with valance
    y_front, y_back = 2.35, 2.6
    ov = 0.25
    md.face([(-w / 2 - 0.1, y_front, -d / 2 - ov), (-w / 2 - 0.1, y_back, d / 2 + 0.05), (w / 2 + 0.1, y_back, d / 2 + 0.05),
             (w / 2 + 0.1, y_front, -d / 2 - ov)], canvas)
    # A single sheet with a double-sided fabric material. Coincident reversed faces
    # are collapsed unpredictably by the shared vertex-welding/export step.
    n = 9
    for i in range(n):
        a = -w / 2 - 0.1 + i * (w + 0.2) / n
        b = a + (w + 0.2) / n
        z = -d / 2 - ov
        md.face([(b, y_front, z), (a, y_front, z), ((a + b) / 2, y_front - 0.22, z)], canvas)
    return md


def street_lantern() -> MeshData:
    md = MeshData()
    md.cylinder((0, 0, 0), 0.2, 0.12, "iron", segments=8, radius_top=0.16)
    md.cylinder((0, 0.12, 0), 0.12, 0.3, "iron", segments=8, radius_top=0.07)
    md.cylinder((0, 0.42, 0), 0.055, 2.55, "iron", segments=8, radius_top=0.045)
    for y in (0.5, 1.6, 2.9):
        md.cylinder((0, y, 0), 0.075, 0.05, "iron", segments=8)
    top = 2.97
    md.cylinder((0, top, 0), 0.09, 0.08, "iron", segments=6, radius_top=0.12)
    md.cylinder((0, top + 0.08, 0), 0.11, 0.38, "lantern_glass", segments=6, radius_top=0.15, caps=(True, False))
    for k in range(6):
        a = k * math.pi / 3
        md.tube((math.cos(a) * 0.115, top + 0.08, -math.sin(a) * 0.115),
                (math.cos(a) * 0.155, top + 0.46, -math.sin(a) * 0.155), 0.008, "iron", segments=4, caps=False)
    md.cylinder((0, top + 0.46, 0), 0.2, 0.1, "iron", segments=6, radius_top=0.05)
    md.cylinder((0, top + 0.56, 0), 0.03, 0.08, "iron", segments=6, radius_top=0.0)
    return md


def drain_grate() -> MeshData:
    md = MeshData()
    s = 0.3
    # Raised 12 mm so it clears the gutter inlay (6 mm) it is usually placed on; the water layer stays inside the frame.
    top = 0.024
    md.box(-s, 0, -s, s, top, -s + 0.05, "iron")
    md.box(-s, 0, s - 0.05, s, top, s, "iron")
    md.box(-s, 0, -s + 0.05, -s + 0.05, top, s - 0.05, "iron")
    md.box(s - 0.05, 0, -s + 0.05, s, top, s - 0.05, "iron")
    for i in range(7):
        x = -s + 0.075 + i * (2 * s - 0.15) / 6
        md.box(x - 0.012, 0, -s + 0.05, x + 0.012, top - 0.002, s - 0.05, "iron")
    md.face([(-s + 0.05, 0.013, -s + 0.05), (-s + 0.05, 0.013, s - 0.05), (s - 0.05, 0.013, s - 0.05),
             (s - 0.05, 0.013, -s + 0.05)], "water")
    return md


def railing(L=2.0) -> MeshData:
    md = MeshData()
    md.box(-L / 2, 0.95, -0.03, L / 2, 1.0, 0.03, "iron")
    md.box(-L / 2, 0.1, -0.015, L / 2, 0.13, 0.015, "iron")
    n = int(L / 0.13)
    for i in range(n + 1):
        x = -L / 2 + i * L / n
        md.box(x - 0.011, 0.0, -0.011, x + 0.011, 0.95, 0.011, "iron")
    for x in (-L / 2, L / 2):
        md.box(x - 0.025, 0.0, -0.025, x + 0.025, 1.02, 0.025, "iron")
    return md


def fence(L=2.0, gate=False) -> MeshData:
    md = MeshData()
    for x in (-L / 2 + 0.05, L / 2 - 0.05):
        md.box(x - 0.05, 0, -0.05, x + 0.05, 1.15, 0.05, "wood_weathered")
        md.box(x - 0.06, 1.15, -0.06, x + 0.06, 1.2, 0.06, "wood_weathered")
    for y in (0.3, 0.85):
        md.box(-L / 2 + 0.1, y, 0.0, L / 2 - 0.1, y + 0.07, 0.04, "wood_weathered")
    n = int((L - 0.2) / 0.16)
    gate_lo, gate_hi = (-0.5, 0.5) if gate else (99, 99)
    for i in range(n):
        x = -L / 2 + 0.18 + i * (L - 0.36) / max(1, n - 1)
        top = 1.0 + (0.06 if i % 2 else 0)
        if gate and gate_lo < x < gate_hi:
            top = 0.95
        md.box(x - 0.045, 0.05, -0.04, x + 0.045, top, 0.0, "wood_weathered")
        md.face([(x - 0.045, top, -0.04), (x + 0.045, top, -0.04), (x, top + 0.07, -0.04)], "wood_weathered")
    if gate:
        md.box(-0.52, 0.05, -0.08, -0.46, 1.0, -0.02, "wood_dark")
        md.box(0.46, 0.05, -0.08, 0.52, 1.0, -0.02, "wood_dark")
        md.box(0.3, 0.55, -0.1, 0.4, 0.6, -0.06, "iron")
    return md


def well() -> MeshData:
    md = MeshData()
    seg = 18
    r_out, r_in, h = 1.0, 0.78, 0.85
    for i in range(seg):
        a, b = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        co, so, cb, sb = math.cos(a), math.sin(a), math.cos(b), math.sin(b)
        # outer wall
        md.face([(co * r_out, 0, -so * r_out), (cb * r_out, 0, -sb * r_out), (cb * r_out, h, -sb * r_out),
                 (co * r_out, h, -so * r_out)], "stone_stacked", uv=[(i * 0.35, 0), ((i + 1) * 0.35, 0), ((i + 1) * 0.35, h), (i * 0.35, h)])
        # inner wall
        md.face([(cb * r_in, 0.2, -sb * r_in), (co * r_in, 0.2, -so * r_in), (co * r_in, h, -so * r_in),
                 (cb * r_in, h, -sb * r_in)], "stone_stacked", col=(0.55, 0.55, 0.55, 1.0))
        # coping
        md.face([(co * (r_in - 0.04), h + 0.1, -so * (r_in - 0.04)), (co * (r_out + 0.06), h + 0.1, -so * (r_out + 0.06)),
                 (cb * (r_out + 0.06), h + 0.1, -sb * (r_out + 0.06)), (cb * (r_in - 0.04), h + 0.1, -sb * (r_in - 0.04))],
                "stone_trim")
        # Close the underside of the coping overhang, at its actual lower height.
        md.face([(co * (r_in - 0.04), h, -so * (r_in - 0.04)), (co * (r_out + 0.06), h, -so * (r_out + 0.06)),
                 (cb * (r_out + 0.06), h, -sb * (r_out + 0.06)), (cb * (r_in - 0.04), h, -sb * (r_in - 0.04))][::-1],
                "stone_trim")
        md.face([(co * (r_out + 0.06), h, -so * (r_out + 0.06)), (cb * (r_out + 0.06), h, -sb * (r_out + 0.06)),
                 (cb * (r_out + 0.06), h + 0.1, -sb * (r_out + 0.06)), (co * (r_out + 0.06), h + 0.1, -so * (r_out + 0.06))],
                "stone_trim")
        md.face([(cb * (r_in - 0.04), h, -sb * (r_in - 0.04)), (co * (r_in - 0.04), h, -so * (r_in - 0.04)),
                 (co * (r_in - 0.04), h + 0.1, -so * (r_in - 0.04)), (cb * (r_in - 0.04), h + 0.1, -sb * (r_in - 0.04))],
                "stone_trim")
    md.face([(math.cos(2 * math.pi * i / seg) * r_in, 0.2, -math.sin(2 * math.pi * i / seg) * r_in)
             for i in range(seg)], "water")
    # posts, roof and windlass
    for x in (-0.95, 0.95):
        # The post feet are embedded in the coping: an internal bottom face would
        # coincide with its underside and add a hidden z-fight.
        md.box(x - 0.08, h, -0.08, x + 0.08, 2.35, 0.08, "wood_dark", skip=("ny",))
    md.box(-1.05, 2.3, -0.1, 1.05, 2.42, 0.1, "wood_dark")
    md.tube((-0.95, 1.55, 0), (0.95, 1.55, 0), 0.07, "wood_dark", segments=8)
    md.tube((0.95, 1.55, 0), (1.15, 1.55, 0), 0.02, "iron", segments=5)
    md.tube((1.15, 1.55, 0), (1.15, 1.3, 0), 0.02, "iron", segments=5)
    md.tube((0.0, 1.5, 0), (0.0, 1.0, 0), 0.012, "wood_beam", segments=4, caps=False)
    md.merge(barrel(0.3, 0.13, 7), Transform(0, 0.7, 0))
    for sgn in (-1, 1):
        slope = [(-1.3, 2.35, sgn * 1.0), (1.3, 2.35, sgn * 1.0), (1.3, 2.75, 0), (-1.3, 2.75, 0)]
        md.face_toward(slope, "roof_tiles", (0, 1, sgn * 0.8))
        md.face_toward([(x, y - 0.05, z) for (x, y, z) in slope], "wood_beam", (0, -1, -sgn * 0.8))
        md.face_toward([(-1.3, 2.3, sgn * 1.0), (1.3, 2.3, sgn * 1.0), (1.3, 2.35, sgn * 1.0), (-1.3, 2.35, sgn * 1.0)],
                       "wood_beam", (0, 0, sgn))
    for x in (-1.3, 1.3):
        md.face_toward([(x, 2.3, -1.0), (x, 2.3, 1.0), (x, 2.75, 0), (x, 2.7, 0)][:3], "wood_beam", (1 if x > 0 else -1, 0, 0))
    return md


def cart() -> MeshData:
    md = MeshData()
    # bed
    md.box(-0.62, 0.55, -1.0, 0.62, 0.62, 0.9, "wood_weathered")
    for x in (-0.62, 0.58):
        md.box(x, 0.62, -1.0, x + 0.04, 0.95, 0.9, "wood_weathered")
    md.box(-0.62, 0.62, 0.86, 0.62, 0.95, 0.9, "wood_weathered")
    md.box(-0.62, 0.62, -1.0, 0.62, 0.85, -0.96, "wood_weathered")
    # handles
    for x in (-0.5, 0.5):
        md.box(x - 0.03, 0.6, -1.65, x + 0.03, 0.66, -1.0, "wood_dark")
    md.box(-0.5, 0.6, -1.6, 0.5, 0.65, -1.56, "wood_dark")
    md.box(-0.06, 0.0, -1.5, 0.06, 0.6, -1.44, "wood_dark")
    # wheels
    for x in (-0.7, 0.7):
        seg = 16
        r = 0.48
        for i in range(seg):
            a, b = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            for (ra, rb) in ((r, r - 0.06),):
                p = [(x - 0.04, r + math.sin(a) * ra, 0.2 + math.cos(a) * ra), (x - 0.04, r + math.sin(b) * ra, 0.2 + math.cos(b) * ra),
                     (x + 0.04, r + math.sin(b) * ra, 0.2 + math.cos(b) * ra), (x + 0.04, r + math.sin(a) * ra, 0.2 + math.cos(a) * ra)]
                md.face(p, "wood_dark")
                q = [(x - 0.04, r + math.sin(a) * rb, 0.2 + math.cos(a) * rb), (x + 0.04, r + math.sin(a) * rb, 0.2 + math.cos(a) * rb),
                     (x + 0.04, r + math.sin(b) * rb, 0.2 + math.cos(b) * rb), (x - 0.04, r + math.sin(b) * rb, 0.2 + math.cos(b) * rb)]
                md.face(q, "wood_dark")
            for side in (-0.04, 0.04):
                ring = [(x + side, r + math.sin(a) * r, 0.2 + math.cos(a) * r), (x + side, r + math.sin(b) * r, 0.2 + math.cos(b) * r),
                        (x + side, r + math.sin(b) * (r - 0.06), 0.2 + math.cos(b) * (r - 0.06)),
                        (x + side, r + math.sin(a) * (r - 0.06), 0.2 + math.cos(a) * (r - 0.06))]
                md.face(ring if side > 0 else ring[::-1], "wood_dark")
            if i % 2 == 0:
                md.tube((x, r, 0.2), (x, r + math.sin(a) * (r - 0.05), 0.2 + math.cos(a) * (r - 0.05)), 0.018, "wood_dark",
                        segments=4, caps=False)
        md.tube((x - 0.08, r, 0.2), (x + 0.08, r, 0.2), 0.07, "iron", segments=8)
    md.tube((-0.72, 0.48, 0.2), (0.72, 0.48, 0.2), 0.035, "iron", segments=6)
    md.merge(crate(0.5, 9), Transform(-0.25, 0.62, 0.2, 0.2))
    md.merge(barrel(0.55, 0.2, 9), Transform(0.28, 0.62, -0.4))
    return md


def sign(team: str) -> MeshData:
    """Team safe-zone sign mounted flat on a wall (origin on the wall at the sign centre)."""
    md = MeshData()
    w, h = 1.4, 0.875
    mat = "sign_blue" if team == "blue" else "sign_red"
    md.box(-w / 2 - 0.05, -h / 2 - 0.05, -0.06, w / 2 + 0.05, h / 2 + 0.05, 0.0, "iron", skip=("pz",))
    md.face([(w / 2, -h / 2, -0.065), (-w / 2, -h / 2, -0.065), (-w / 2, h / 2, -0.065), (w / 2, h / 2, -0.065)], mat,
            uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    glow = "team_blue_glow" if team == "blue" else "team_red_glow"
    md.box(-w / 2 - 0.05, -h / 2 - 0.12, -0.08, w / 2 + 0.05, -h / 2 - 0.07, 0.0, glow, skip=("pz",))
    return md


# Practice target: a steel silhouette (torso and head) on a hinged stand. Heights are above the hinge, which sits 0.92 m
# above the base, so the head centre is at 1.645 m (eye height). src/game/Targets.ts uses the same numbers for the
# head and body hit boxes.
TARGET_HEAD = (0.725, 0.105, 0.13)   # centre height, half-width, half-height
TARGET_BODY = (0.03, 0.555, 0.245)   # bottom, top of the shoulders, half-width at the shoulders
TARGET_UV = (0.25, 0.03, 0.5, 0.83)  # x of u = 0, y of v = 0, width and height mapped onto the face texture


def target_outline() -> list[tuple[float, float]]:
    """Silhouette outline (x, y), counter-clockwise with +x right and +y up (the target's back view)."""
    right = [(0.21, 0.03), (0.232, 0.3), (0.245, 0.415), (0.236, 0.47), (0.205, 0.51), (0.15, 0.538), (0.085, 0.552),
             (0.056, 0.572), (0.046, 0.6)]
    hy, hx, hh = TARGET_HEAD
    head = [(hx * math.cos(math.radians(t)), hy + hh * math.sin(math.radians(t))) for t in range(-62, 243, 9)]
    left = [(-x, y) for (x, y) in reversed(right)]
    return right + head + left


def target_parts() -> dict[str, MeshData]:
    base = MeshData()
    base.box(-0.45, 0.0, -0.3, 0.45, 0.08, 0.3, "target_frame")
    base.box(-0.06, 0.08, -0.06, 0.06, 0.95, 0.06, "target_frame")
    base.box(-0.3, 0.88, -0.07, 0.3, 0.96, 0.07, "target_frame")
    base.box(-0.4, 0.0, -0.06, 0.4, 0.05, 0.06, "weapon_accent")
    plate = MeshData()
    poly = target_outline()
    t = 0.012
    u0, v0, uw, vh = TARGET_UV
    # front (faces -z, toward the shooter): u grows toward local -x (the viewer's right), v up
    front = [(x, y, -t) for (x, y) in poly]
    plate.face_toward(front, "target_face", (0, 0, -1), uv=[((u0 - x) / uw, (y - v0) / vh) for (x, y) in poly])
    plate.face_toward([(x, y, 0.0) for (x, y) in poly], "target_frame", (0, 0, 1))
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        out = (by - ay, -(bx - ax), 0.0)  # right-hand normal of a counter-clockwise outline points outward
        plate.face_toward([(ax, ay, -t), (bx, by, -t), (bx, by, 0.0), (ax, ay, 0.0)], "target_frame", out)
    # hinge bracket and a stiffening rib on the back
    plate.box(-0.05, -0.02, -0.004, 0.05, 0.1, 0.03, "target_frame")
    plate.box(-0.02, 0.1, 0.0, 0.02, 0.5, 0.018, "target_frame")
    return {"base": base, "plate": plate}


PROP_BUILDERS = {
    "crate": lambda: crate(0.8, 1),
    "crate_small": lambda: crate(0.55, 2),
    "crate_stack": crate_stack,
    "barrel": barrel,
    "barrel_group": barrel_group,
    "flower_pot": lambda: flower_pot(False, 3),
    "flower_pot_large": lambda: flower_pot(True, 4),
    "bench": bench,
    "market_stall": market_stall,
    "street_lantern": street_lantern,
    "wall_lantern": kit.wall_lantern,
    "drain_grate": drain_grate,
    "railing": railing,
    "fence": fence,
    "fence_gate": lambda: fence(2.0, True),
    "well": well,
    "cart": cart,
    "sign_blue": lambda: sign("blue"),
    "sign_red": lambda: sign("red"),
    "table": table,
    "stool": stool,
}

# props of the two newer maps live in their own modules
from props_industrial import INDUSTRIAL_BUILDERS  # noqa: E402
from props_city import CITY_BUILDERS  # noqa: E402

PROP_BUILDERS.update(INDUSTRIAL_BUILDERS)
PROP_BUILDERS.update(CITY_BUILDERS)
