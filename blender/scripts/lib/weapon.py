"""First-person firearms: an assault rifle, a pump shotgun and a bolt-action sniper rifle.

Local space (game coordinates): origin at the centre of the pistol grip where the right hand closes, barrel toward -z,
up +y, right +x. Each weapon is a dict of parts (MeshData): `body` plus the pieces that move during animations
(`mag`, `pump`, `bolt`), all in the same space so their rest transform is the identity. Anchors (exported as empties):

  muzzle   flash and tracer origin            sight    eye point for aiming down sights (optical axis)
  eject    ejection port                      grip_r   right hand          grip_l   left (support) hand
  mag_grip where the left hand takes the mag  port     shotgun loading port
  bolt_grip  sniper bolt knob (right hand during the bolt cycle)

Materials: gun_black (anodised aluminium), gun_steel (blued / parkerised steel), gun_polymer, gun_fde (tan polymer),
gun_wood (walnut), gun_rubber, gun_glass (optic windows), gun_lens (scope lenses), reticle_holo (holographic reticle,
replaced by an additive emissive material at runtime), sight_dot, brass, shell_red.
"""
from __future__ import annotations

import math

from meshkit import MeshData


def extrude(md: MeshData, profile, x0: float, x1: float, mat: str, bevel: float = 0.003, side_mat: str | None = None):
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


def solid(md: MeshData, profile, x0: float, x1: float, mat: str, bevel: float = 0.003, side_mat: str | None = None):
    """A convex extruded part with outward faces."""
    start = len(md.faces)
    extrude(md, profile, x0, x1, mat, bevel, side_mat)
    cz = sum(p[0] for p in profile) / len(profile)
    cy = sum(p[1] for p in profile) / len(profile)
    _fix_winding(md, start, ((x0 + x1) / 2, cy, cz))


def box(md: MeshData, x0, y0, z0, x1, y1, z1, mat: str):
    md.box(min(x0, x1), min(y0, y1), min(z0, z1), max(x0, x1), max(y0, y1), max(z0, z1), mat)


def ztube(md: MeshData, z0: float, z1: float, y: float, r0: float, mat: str, sides: int = 12, r1: float | None = None,
          x: float = 0.0, caps: tuple[bool, bool] = (True, True), cap_mat: str | None = None, phase: float = 0.0):
    """Tube (or cone) along z from z0 to z1 (z0 > z1 or z0 < z1), outward faces, optional end caps."""
    r1 = r0 if r1 is None else r1
    ring0, ring1 = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides + phase
        ring0.append((x + math.cos(a) * r0, y + math.sin(a) * r0, z0))
        ring1.append((x + math.cos(a) * r1, y + math.sin(a) * r1, z1))
    for i in range(sides):
        j = (i + 1) % sides
        a = 2 * math.pi * (i + 0.5) / sides + phase
        md.face_toward([ring0[i], ring0[j], ring1[j], ring1[i]], mat, (math.cos(a), math.sin(a), 0.0))
    d = 1.0 if z1 > z0 else -1.0
    if caps[0]:
        md.face_toward(ring0, cap_mat or mat, (0.0, 0.0, -d))
    if caps[1]:
        md.face_toward(ring1, cap_mat or mat, (0.0, 0.0, d))


def xtube(md: MeshData, x0: float, x1: float, y: float, z: float, r: float, mat: str, sides: int = 10):
    """Tube along x (buttons, battery caps, turrets on the side)."""
    ring0, ring1 = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        ring0.append((x0, y + math.cos(a) * r, z + math.sin(a) * r))
        ring1.append((x1, y + math.cos(a) * r, z + math.sin(a) * r))
    for i in range(sides):
        j = (i + 1) % sides
        a = 2 * math.pi * (i + 0.5) / sides
        md.face_toward([ring0[i], ring0[j], ring1[j], ring1[i]], mat, (0.0, math.cos(a), math.sin(a)))
    md.face_toward(ring0, mat, (-1.0 if x1 > x0 else 1.0, 0.0, 0.0))
    md.face_toward(ring1, mat, (1.0 if x1 > x0 else -1.0, 0.0, 0.0))


def ytube(md: MeshData, y0: float, y1: float, x: float, z: float, r: float, mat: str, sides: int = 12, cap_mat=None):
    """Tube along y (turrets, knobs)."""
    ring0, ring1 = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        ring0.append((x + math.cos(a) * r, y0, z + math.sin(a) * r))
        ring1.append((x + math.cos(a) * r, y1, z + math.sin(a) * r))
    for i in range(sides):
        j = (i + 1) % sides
        a = 2 * math.pi * (i + 0.5) / sides
        md.face_toward([ring0[i], ring0[j], ring1[j], ring1[i]], mat, (math.cos(a), 0.0, math.sin(a)))
    md.face_toward(ring0, cap_mat or mat, (0.0, -1.0, 0.0))
    md.face_toward(ring1, cap_mat or mat, (0.0, 1.0, 0.0))


def rail(md: MeshData, z0: float, z1: float, y: float, half: float = 0.0105, mat: str = "gun_black"):
    """Picatinny rail from z0 (rear) to z1 (front, more negative) with its slots: top at y + 0.011."""
    box(md, -half, y, z1, half, y + 0.005, z0, mat)
    z = z0 - 0.004
    while z - 0.0052 > z1:
        box(md, -half - 0.0012, y + 0.005, z - 0.0052, half + 0.0012, y + 0.011, z, mat)
        z -= 0.01


def side_detail(md: MeshData, x: float, y0: float, y1: float, z0: float, z1: float, mat: str):
    """A panel 0.6 mm proud of a side face at |x| (slots, ports, logos): faces outward."""
    s = 1.0 if x > 0 else -1.0
    xx = x + s * 0.0006
    md.face_toward([(xx, y0, z0), (xx, y0, z1), (xx, y1, z1), (xx, y1, z0)], mat, (s, 0.0, 0.0))


# =====================================================================================================================
# Assault rifle (AR-pattern carbine with a holographic sight)
# =====================================================================================================================
RIFLE_BORE = 0.062


def rifle():
    body = MeshData()
    B = RIFLE_BORE
    # lower receiver and magazine well
    solid(body, [(0.075, 0.0), (0.075, 0.046), (-0.105, 0.046), (-0.105, -0.004), (-0.04, -0.004), (0.012, 0.0)],
          -0.0115, 0.0115, "gun_black")
    solid(body, [(-0.038, -0.036), (-0.11, -0.036), (-0.106, 0.0), (-0.041, 0.0)], -0.0158, 0.0158, "gun_black", 0.002)
    # magwell bevel + bolt catch paddle (left side) + magazine release (right)
    box(body, -0.0168, 0.016, -0.046, -0.0155, 0.03, -0.034, "gun_steel")
    xtube(body, 0.0115, 0.0158, 0.018, -0.03, 0.004, "gun_steel")
    # trigger guard and trigger
    box(body, -0.004, -0.034, -0.04, 0.004, -0.028, -0.002, "gun_black")
    box(body, -0.003, -0.018, -0.027, 0.003, -0.002, -0.021, "gun_steel")
    box(body, -0.003, -0.027, -0.024, 0.003, -0.018, -0.018, "gun_steel")
    # safety selector (left side)
    xtube(body, -0.016, -0.0115, 0.03, 0.04, 0.0055, "gun_steel", sides=8)
    box(body, -0.018, 0.028, 0.034, -0.016, 0.032, 0.052, "gun_steel")
    # upper receiver with a forward assist, brass deflector and dust cover over the ejection port
    solid(body, [(0.075, 0.046), (0.075, 0.08), (-0.205, 0.08), (-0.205, 0.046)], -0.0128, 0.0128, "gun_black")
    side_detail(body, 0.0128, 0.052, 0.073, -0.088, -0.022, "gun_steel")
    side_detail(body, 0.0128, 0.071, 0.073, -0.088, -0.022, "gun_black")
    ztube(body, 0.022, 0.05, 0.071, 0.0058, "gun_black", sides=8, x=0.0155)
    box(body, 0.0128, 0.05, -0.006, 0.019, 0.076, 0.012, "gun_black")
    rail(body, 0.075, -0.205, 0.08)
    # charging handle (T-handle at the rear of the upper)
    box(body, -0.005, 0.074, 0.075, 0.005, 0.082, 0.096, "gun_black")
    box(body, -0.021, 0.073, 0.088, 0.021, 0.083, 0.098, "gun_black")
    # free-float handguard: octagonal tube with M-LOK slots, rail on top
    ztube(body, -0.205, -0.47, B, 0.0235, "gun_black", sides=8, phase=math.pi / 8)
    for k in range(5):
        z = -0.24 - k * 0.045
        for sx in (-1, 1):
            side_detail(body, sx * 0.0218, B - 0.004, B + 0.004, z, z - 0.03, "gun_polymer")
        body.face_toward([(-0.0045, B - 0.0221, z), (0.0045, B - 0.0221, z), (0.0045, B - 0.0221, z - 0.03),
                          (-0.0045, B - 0.0221, z - 0.03)], "gun_polymer", (0, -1, 0))
    rail(body, -0.205, -0.468, B + 0.0217)
    ztube(body, -0.468, -0.474, B, 0.0245, "gun_black", sides=8, phase=math.pi / 8)
    # barrel, gas block, muzzle device (birdcage) with slots
    ztube(body, -0.474, -0.6, B, 0.0086, "gun_steel")
    ztube(body, -0.6, -0.656, B, 0.0112, "gun_steel", sides=12)
    for k in range(6):
        a = 2 * math.pi * k / 6 + math.pi / 2
        if k == 3:
            continue  # closed at the bottom
        cx, cy = math.cos(a) * 0.0114, math.sin(a) * 0.0114
        n = (math.cos(a), math.sin(a), 0)
        t = (-math.sin(a) * 0.0024, math.cos(a) * 0.0024)
        body.face_toward([(cx - t[0], B + cy - t[1], -0.61), (cx + t[0], B + cy + t[1], -0.61),
                          (cx + t[0], B + cy + t[1], -0.646), (cx - t[0], B + cy - t[1], -0.646)], "gun_polymer", n)
    # buffer tube and adjustable stock (tan), rubber butt pad
    ztube(body, 0.075, 0.25, B - 0.002, 0.0148, "gun_black", sides=12)
    solid(body, [(0.17, 0.088), (0.33, 0.09), (0.338, 0.082), (0.338, 0.002), (0.31, -0.036), (0.27, -0.036),
                 (0.2, 0.034), (0.17, 0.04)], -0.021, 0.021, "gun_fde", 0.004)
    box(body, -0.022, -0.038, 0.336, 0.022, 0.091, 0.348, "gun_rubber")
    box(body, -0.0075, 0.04, 0.18, 0.0075, 0.048, 0.27, "gun_black")  # stock release lever
    # pistol grip (tan) with finger grooves on its front edge
    solid(body, [(0.004, 0.0), (0.038, 0.0), (0.072, -0.112), (0.058, -0.123), (0.027, -0.12), (0.01, -0.03)],
          -0.0128, 0.0128, "gun_fde", 0.004)
    for k in range(3):
        y = -0.045 - k * 0.025
        zf = 0.012 + (-y - 0.03) * 0.18
        body.sphere((0.0, y, zf), 0.0088, "gun_fde", rings=5, segments=8, squash=1.2)
    # holographic sight: low base with the electronics, a thin hood around a big window, battery cap and buttons
    OY = 0.1375
    WX, WY0, WY1 = 0.0215, 0.115, 0.161   # window half-width and bottom/top
    box(body, -0.0185, 0.091, -0.142, 0.0185, 0.104, -0.028, "gun_black")
    box(body, -0.0245, 0.104, -0.136, 0.0245, WY0, -0.042, "gun_black")
    for sx in (-1, 1):
        # hood sides: thin, and slanted back at the top like the real thing
        x0, x1 = sorted((sx * WX, sx * (WX + 0.0028)))
        solid(body, [(-0.044, WY0), (-0.134, WY0), (-0.128, WY1 + 0.004), (-0.052, WY1 + 0.004)], x0, x1, "gun_black", 0.0008)
    solid(body, [(-0.052, WY1), (-0.128, WY1), (-0.126, WY1 + 0.004), (-0.054, WY1 + 0.004)], -WX - 0.0028, WX + 0.0028,
          "gun_black", 0.0008)
    # anti-reflection lip at the front and a brightness rocker at the back
    box(body, -WX, WY0, -0.136, WX, WY0 + 0.003, -0.13, "gun_black")
    xtube(body, 0.0245, 0.033, 0.11, -0.1, 0.0058, "gun_steel")
    for k, z in enumerate((-0.049, -0.06)):
        box(body, 0.005 + k * 0.009, 0.104, z - 0.0045, 0.012 + k * 0.009, 0.1095, z + 0.0005, "gun_rubber")
    for z in (-0.049, -0.127):
        body.face_toward([(-WX, WY0, z), (WX, WY0, z), (WX, WY1, z), (-WX, WY1, z)], "gun_glass", (0, 0, 1))
    # reticle projected on the front window (u to the viewer's right = +x when seen from behind, +z)
    r = 0.0115
    zr = -0.1262
    body.face_toward([(-r, OY - r, zr), (r, OY - r, zr), (r, OY + r, zr), (-r, OY + r, zr)], "reticle_holo", (0, 0, 1),
                     uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # folding rear sight (down) at the back of the rail
    box(body, -0.0095, 0.091, 0.04, 0.0095, 0.099, 0.068, "gun_black")
    # magazine (PMAG style, tan) with ribs, base plate and a round showing at the top
    mag = MeshData()
    solid(mag, [(-0.044, 0.012), (-0.1, 0.012), (-0.104, -0.07), (-0.05, -0.07)], -0.0114, 0.0114, "gun_fde", 0.002)
    solid(mag, [(-0.05, -0.07), (-0.104, -0.07), (-0.121, -0.182), (-0.068, -0.188)], -0.0114, 0.0114, "gun_fde", 0.002)
    for k in range(4):
        y = -0.085 - k * 0.022
        zf, zb = -0.106 - k * 0.0035, -0.052 - k * 0.0038
        for sx in (-1, 1):
            side_detail(mag, sx * 0.0114, y - 0.003, y + 0.003, zb, zf, "gun_polymer")
    solid(mag, [(-0.064, -0.186), (-0.126, -0.18), (-0.128, -0.192), (-0.064, -0.198)], -0.0125, 0.0125, "gun_polymer", 0.002)
    ztube(mag, -0.052, -0.09, 0.016, 0.0048, "brass", sides=8)
    # anchors
    anchors = {
        "muzzle": (0.0, B, -0.66), "sight": (0.0, OY, -0.049), "eject": (0.016, 0.064, -0.055),
        "grip_r": (0.0, -0.05, 0.03), "grip_l": (0.0, B - 0.03, -0.33), "mag_grip": (0.0, -0.12, -0.085),
    }
    return {"body": body, "mag": mag}, anchors


# =====================================================================================================================
# Pump shotgun (walnut furniture, ghost-ring sights, tube magazine)
# =====================================================================================================================
SHOT_BORE = 0.058


def shotgun():
    body = MeshData()
    B = SHOT_BORE
    # receiver (blued steel) with the ejection port on the right and the loading port underneath
    solid(body, [(0.03, 0.0), (0.03, 0.074), (-0.012, 0.079), (-0.215, 0.079), (-0.215, 0.012), (-0.1, 0.0)],
          -0.0165, 0.0165, "gun_steel", 0.003)
    side_detail(body, 0.0165, 0.036, 0.064, -0.172, -0.098, "gun_polymer")
    body.face_toward([(-0.011, -0.0006, -0.2), (0.011, -0.0006, -0.2), (0.011, -0.0006, -0.105), (-0.011, -0.0006, -0.105)],
                     "gun_polymer", (0, -1, 0))
    # trigger group, guard and trigger, safety button
    solid(body, [(0.035, -0.012), (0.035, 0.0), (-0.1, 0.0), (-0.1, -0.012)], -0.012, 0.012, "gun_black", 0.002)
    box(body, -0.004, -0.04, -0.058, 0.004, -0.034, 0.008, "gun_black")
    box(body, -0.004, -0.04, -0.062, 0.004, -0.012, -0.056, "gun_black")
    box(body, -0.003, -0.03, -0.03, 0.003, -0.012, -0.024, "gun_steel")
    xtube(body, -0.016, 0.016, -0.006, 0.012, 0.0035, "gun_steel", sides=8)
    # ghost-ring rear sight on the receiver
    GY = 0.087
    box(body, -0.012, 0.079, -0.03, 0.012, 0.084, 0.004, "gun_black")
    for sx in (-1, 1):
        box(body, sx * 0.008, 0.084, -0.016, sx * 0.0115, 0.094, -0.01, "gun_black")
    seg = 14
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        ro, ri = 0.0068, 0.0042
        p = [(math.cos(a0) * ro, GY + math.sin(a0) * ro), (math.cos(a1) * ro, GY + math.sin(a1) * ro),
             (math.cos(a1) * ri, GY + math.sin(a1) * ri), (math.cos(a0) * ri, GY + math.sin(a0) * ri)]
        body.face_toward([(x, y, -0.011) for x, y in p], "gun_black", (0, 0, 1))
        body.face_toward([(x, y, -0.015) for x, y in p], "gun_black", (0, 0, -1))
    # barrel with a vent rib, front sight post with a fibre dot
    ztube(body, -0.215, -0.665, B, 0.0108, "gun_steel", sides=14)
    box(body, -0.004, B + 0.0105, -0.665, 0.004, B + 0.0135, -0.24, "gun_steel")
    box(body, -0.0022, B + 0.0135, -0.655, 0.0022, GY - 0.0028, -0.643, "gun_black")
    ztube(body, -0.6485, -0.6495, GY - 0.0018, 0.0022, "sight_dot", sides=8, caps=(True, True))
    # tube magazine, end cap and barrel clamp
    ztube(body, -0.215, -0.6, 0.029, 0.0104, "gun_steel", sides=12)
    ztube(body, -0.6, -0.618, 0.029, 0.0118, "gun_black", sides=12)
    box(body, -0.011, 0.024, -0.585, 0.011, B + 0.006, -0.565, "gun_black")
    # pistol grip and buttstock (walnut) with a rubber recoil pad
    solid(body, [(0.008, 0.0), (0.042, 0.0), (0.076, -0.108), (0.062, -0.12), (0.03, -0.118), (0.014, -0.03)],
          -0.0135, 0.0135, "gun_wood", 0.004)
    solid(body, [(0.03, 0.074), (0.36, 0.062), (0.37, 0.05), (0.37, -0.065), (0.3, -0.06), (0.1, 0.01), (0.03, 0.0)],
          -0.0185, 0.0185, "gun_wood", 0.005)
    box(body, -0.02, -0.068, 0.368, 0.02, 0.064, 0.384, "gun_rubber")
    # sling swivel stud
    ytube(body, -0.067, -0.061, 0.0, 0.33, 0.004, "gun_steel", sides=8)
    # pump forend (walnut, grooved) and the action bars that run back into the receiver
    pump = MeshData()
    solid(pump, [(-0.25, 0.008), (-0.25, 0.05), (-0.42, 0.05), (-0.42, 0.008)], -0.0235, 0.0235, "gun_wood", 0.006)
    for k in range(9):
        z = -0.268 - k * 0.017
        for sx in (-1, 1):
            side_detail(pump, sx * 0.0235, 0.014, 0.044, z, z - 0.006, "gun_polymer")
    for sx in (-1, 1):
        box(pump, sx * 0.0122, 0.017, -0.25, sx * 0.0148, 0.024, -0.17, "gun_steel")
    # a shell for the hand during reloads (12 gauge, red hull, brass head), modelled at the loading port
    shell = MeshData()
    ztube(shell, 0.0, -0.052, 0.0, 0.0104, "shell_red", sides=12)
    ztube(shell, 0.014, 0.0, 0.0, 0.0108, "brass", sides=12)
    ztube(shell, 0.0155, 0.014, 0.0, 0.0118, "brass", sides=12)
    anchors = {
        "muzzle": (0.0, B, -0.67), "sight": (0.0, GY, -0.012), "eject": (0.018, 0.05, -0.135),
        "grip_r": (0.0, -0.05, 0.034), "grip_l": (0.0, 0.008, -0.335), "port": (0.0, -0.004, -0.15),
    }
    return {"body": body, "pump": pump, "shell": shell}, anchors


# =====================================================================================================================
# Bolt-action sniper rifle (chassis stock, heavy barrel, 5-25x scope)
# =====================================================================================================================
SNIPER_BORE = 0.062


def sniper():
    body = MeshData()
    B = SNIPER_BORE
    # chassis: forend with lightening slots, action bed, pistol grip, buttstock with cheek riser
    solid(body, [(-0.06, 0.0), (-0.06, 0.05), (-0.44, 0.05), (-0.45, 0.04), (-0.45, 0.006), (-0.44, 0.0)],
          -0.022, 0.022, "gun_black", 0.004)
    for k in range(4):
        z = -0.17 - k * 0.065
        for sx in (-1, 1):
            side_detail(body, sx * 0.022, 0.016, 0.034, z, z - 0.045, "gun_polymer")
    solid(body, [(0.06, 0.0), (0.06, 0.05), (-0.06, 0.05), (-0.06, 0.0)], -0.02, 0.02, "gun_black", 0.003)
    solid(body, [(0.004, 0.0), (0.04, 0.0), (0.074, -0.11), (0.06, -0.122), (0.028, -0.119), (0.01, -0.03)],
          -0.0135, 0.0135, "gun_polymer", 0.004)
    for k in range(3):
        y = -0.045 - k * 0.025
        zf = 0.013 + (-y - 0.03) * 0.18
        body.sphere((0.0, y, zf), 0.0092, "gun_polymer", rings=5, segments=8, squash=1.2)
    box(body, -0.004, -0.036, -0.044, 0.004, -0.03, -0.0, "gun_black")
    box(body, -0.003, -0.02, -0.028, 0.003, -0.002, -0.022, "gun_steel")
    solid(body, [(0.06, 0.04), (0.39, 0.05), (0.4, 0.04), (0.4, -0.07), (0.34, -0.07), (0.16, -0.012), (0.06, 0.0)],
          -0.019, 0.019, "gun_black", 0.004)
    solid(body, [(0.16, 0.05), (0.33, 0.054), (0.33, 0.07), (0.17, 0.068)], -0.016, 0.016, "gun_polymer", 0.003)
    box(body, -0.021, -0.072, 0.395, 0.021, 0.053, 0.41, "gun_rubber")
    # monopod knob under the butt
    ytube(body, -0.09, -0.07, 0.0, 0.33, 0.007, "gun_steel")
    # round receiver, recoil lug, rail and scope rings
    ztube(body, 0.035, -0.2, B, 0.0172, "gun_steel", sides=16)
    rail(body, 0.025, -0.2, B + 0.0155, half=0.0105)
    # heavy fluted barrel with a muzzle brake
    ztube(body, -0.2, -0.79, B, 0.0128, "gun_steel", sides=12, r1=0.0098)
    for k in range(6):
        a = 2 * math.pi * k / 6
        cx, cy = math.cos(a) * 0.0114, math.sin(a) * 0.0114
        n = (math.cos(a), math.sin(a), 0)
        t = (-math.sin(a) * 0.0017, math.cos(a) * 0.0017)
        body.face_toward([(cx - t[0], B + cy - t[1], -0.47), (cx + t[0], B + cy + t[1], -0.47),
                          (cx + t[0] * 0.8, B + cy * 0.86 + t[1] * 0.8, -0.74), (cx - t[0] * 0.8, B + cy * 0.86 - t[1] * 0.8, -0.74)],
                         "gun_black", n)
    ztube(body, -0.79, -0.852, B, 0.0138, "gun_black", sides=10)
    for z in (-0.806, -0.822, -0.838):
        for sx in (-1, 1):
            side_detail(body, sx * 0.0136, B - 0.006, B + 0.006, z, z - 0.008, "gun_polymer")
    # folded bipod under the forend tip
    for sx in (-1, 1):
        ztube(body, -0.42, -0.24, -0.004, 0.0045, "gun_black", sides=6, x=sx * 0.012)
    box(body, -0.018, -0.006, -0.445, 0.018, 0.004, -0.415, "gun_black")
    # scope: rings, tube, objective bell, eyepiece, turrets, lenses
    SY = B + 0.06
    for z in (-0.035, -0.155):
        box(body, -0.0125, B + 0.0265, z - 0.009, 0.0125, SY - 0.005, z + 0.009, "gun_black")
        ztube(body, z + 0.009, z - 0.009, SY, 0.0178, "gun_black", sides=16)
    ztube(body, 0.03, -0.235, SY, 0.0152, "gun_black", sides=18)
    ztube(body, -0.235, -0.275, SY, 0.0152, "gun_black", sides=18, r1=0.0262, caps=(False, False))
    ztube(body, -0.275, -0.335, SY, 0.0262, "gun_black", sides=18, caps=(False, True), cap_mat="gun_lens")
    ztube(body, -0.335, -0.339, SY, 0.0245, "gun_lens", sides=18, caps=(False, False))
    ztube(body, 0.03, 0.06, SY, 0.0152, "gun_black", sides=18, r1=0.0188, caps=(False, False))
    ztube(body, 0.06, 0.105, SY, 0.0188, "gun_black", sides=18, caps=(False, True), cap_mat="gun_lens")
    ztube(body, 0.07, 0.078, SY, 0.0196, "gun_rubber", sides=18, caps=(False, False))
    ytube(body, SY + 0.0145, SY + 0.034, 0.0, -0.1, 0.0115, "gun_black", sides=14)
    ytube(body, SY + 0.034, SY + 0.037, 0.0, -0.1, 0.0098, "gun_steel", sides=14)
    xtube(body, 0.0145, 0.03, SY, -0.1, 0.0105, "gun_black", sides=14)
    xtube(body, -0.03, -0.0145, SY, -0.1, 0.0105, "gun_black", sides=14)
    # bolt: body visible at the back of the receiver, shroud, handle arm and knob (moves as one piece)
    bolt = MeshData()
    ztube(bolt, 0.035, 0.06, B, 0.0095, "gun_steel", sides=12)
    ztube(bolt, 0.06, 0.072, B, 0.0125, "gun_black", sides=10)
    knob = (0.052, B - 0.024, 0.032)
    bolt.tube((0.0, B, 0.03), knob, 0.0042, "gun_steel", segments=8)
    bolt.sphere(knob, 0.0108, "gun_polymer", rings=6, segments=10)
    # detachable box magazine
    mag = MeshData()
    solid(mag, [(-0.06, 0.03), (-0.128, 0.03), (-0.128, -0.042), (-0.06, -0.042)], -0.0138, 0.0138, "gun_black", 0.002)
    solid(mag, [(-0.056, -0.042), (-0.132, -0.042), (-0.132, -0.052), (-0.056, -0.052)], -0.015, 0.015, "gun_polymer", 0.002)
    ztube(mag, -0.068, -0.12, 0.038, 0.0062, "brass", sides=8)
    anchors = {
        "muzzle": (0.0, B, -0.855), "sight": (0.0, SY, 0.106), "eject": (0.018, B + 0.008, -0.07),
        "grip_r": (0.0, -0.05, 0.032), "grip_l": (0.0, -0.004, -0.27), "mag_grip": (0.0, -0.03, -0.094),
        "bolt_grip": knob,
    }
    return {"body": body, "bolt": bolt, "mag": mag}, anchors


def casings():
    """Ejected cases: rifle (5.56), sniper (.338) and a spent 12-gauge shell, each along +z from its base."""
    rifle_c = MeshData()
    ztube(rifle_c, 0.0, 0.034, 0.0, 0.0048, "brass", sides=8)
    ztube(rifle_c, 0.034, 0.04, 0.0, 0.0048, "brass", sides=8, r1=0.0032, caps=(False, False))
    ztube(rifle_c, 0.04, 0.046, 0.0, 0.0032, "brass", sides=8)
    sniper_c = MeshData()
    ztube(sniper_c, 0.0, 0.054, 0.0, 0.0072, "brass", sides=10)
    ztube(sniper_c, 0.054, 0.062, 0.0, 0.0072, "brass", sides=10, r1=0.0046, caps=(False, False))
    ztube(sniper_c, 0.062, 0.072, 0.0, 0.0046, "brass", sides=10)
    shell = MeshData()
    ztube(shell, 0.0, 0.014, 0.0, 0.0108, "brass", sides=12)
    ztube(shell, 0.014, 0.066, 0.0, 0.0104, "shell_red", sides=12)
    return {"casing_rifle": rifle_c, "casing_sniper": sniper_c, "casing_shell": shell}


def smg():
    """Original compact blowback design; same anchor convention as existing guns."""
    body, mag = MeshData(), MeshData()
    solid(body, [(0.06, 0.02), (0.06, 0.10), (-0.26, 0.10), (-0.29, 0.075), (-0.29, 0.025)],
          -0.027, 0.027, 'gun_black', 0.004)
    solid(body, [(0.03, 0.025), (-0.015, 0.025), (0.005, -0.10), (0.045, -0.10), (0.06, -0.075)],
          -0.014, 0.014, 'gun_polymer', 0.004)
    box(body, -0.006, -0.025, -0.075, 0.006, -0.019, -0.018, 'gun_steel')
    box(body, -0.004, -0.019, -0.048, 0.004, 0.014, -0.041, 'gun_steel')
    solid(body, [(-0.13, 0.025), (-0.27, 0.025), (-0.27, -0.012), (-0.14, -0.012)],
          -0.031, 0.031, 'gun_polymer', 0.004)
    for k in range(5):
        z = -0.155 - k * 0.022
        for sx in (-1, 1):
            side_detail(body, sx * 0.031, 0.0, 0.018, z, z - 0.009, 'gun_steel')
    ztube(body, -0.29, -0.39, 0.065, 0.012, 'gun_steel', sides=16)
    ztube(body, -0.39, -0.418, 0.065, 0.016, 'gun_black', sides=12)
    # Skeleton stock, compact irons and charging handle.
    for y in (0.035, 0.083):
        box(body, -0.009, y, 0.06, 0.009, y + 0.009, 0.23, 'gun_steel')
    box(body, -0.018, -0.045, 0.225, 0.018, 0.096, 0.24, 'gun_rubber')
    for z in (0.025, -0.265):
        for sx in (-1, 1):
            box(body, sx * 0.008, 0.10, z - 0.008, sx * 0.013, 0.134, z + 0.008, 'gun_black')
    box(body, -0.002, 0.10, -0.27, 0.002, 0.125, -0.26, 'sight_dot')
    box(body, 0.027, 0.072, -0.10, 0.053, 0.082, -0.085, 'gun_steel')
    solid(mag, [(-0.08, 0.025), (-0.12, 0.025), (-0.14, -0.18), (-0.095, -0.18)],
          -0.012, 0.012, 'gun_steel', 0.002)
    box(mag, -0.014, -0.185, -0.142, 0.014, -0.174, -0.092, 'gun_polymer')
    return {'body': body, 'mag': mag}, {
        'muzzle': (0, 0.065, -0.42), 'sight': (0, 0.125, 0.026), 'eject': (0.029, 0.078, -0.08),
        'grip_r': (0, -0.04, 0.02), 'grip_l': (0, -0.005, -0.21), 'mag_grip': (0, -0.09, -0.11),
    }


WEAPONS = {"rifle": rifle, "shotgun": shotgun, "sniper": sniper, "smg": smg}
