"""First-person hands: gloved right and left hands and a sleeve forearm.

Each hand is modelled closed around a grip: the grip axis is local +y through the origin, the palm wraps the grip's
rear and outer side and the fingers curl around its front. Right hand: back of the hand toward +x, fingertips end
on the -x side, thumb over the top on the -x side; local +z points back toward the shooter. The left hand is its
mirror image. The runtime places a hand by putting its origin on a weapon's grip anchor (see WeaponView).

The forearm is a separate unit-length sleeve along +z from the wrist (z = 0) to the elbow (z = 1); the runtime
scales and aims it from the hand's `wrist` point toward an elbow position, so arms follow the hands through reloads.
"""
from __future__ import annotations

import math

from meshkit import MeshData

GRIP_RX = 0.016   # half-width of the grip the fingers close around (x)
GRIP_RZ = 0.024   # half-depth (z)
FINGER_R = 0.0088
WRIST = (0.024, -0.036, 0.062)  # where the forearm starts (right hand)

# (height of the finger's centre line, width scale, phalanx lengths)
FINGERS = [
    (0.027, 0.97, (0.040, 0.025, 0.021)),   # index
    (0.006, 1.0, (0.044, 0.028, 0.022)),    # middle
    (-0.015, 0.95, (0.041, 0.026, 0.021)),  # ring
    (-0.035, 0.85, (0.033, 0.021, 0.019)),  # little
]


def _ell(phi: float, y: float, grow: float = 0.0):
    """Point on the ellipse around the grip, `grow` metres outside the finger centre line.
    phi = 0 on the +x side, 90 deg at the front (-z), 180 deg on the -x side, -90 deg at the back (+z)."""
    ax, az = GRIP_RX + FINGER_R + grow, GRIP_RZ + FINGER_R + grow
    return (ax * math.cos(phi), y, -az * math.sin(phi))


def _arc_length(phi0: float, phi1: float, y: float, steps: int = 24) -> float:
    total, prev = 0.0, _ell(phi0, y)
    for i in range(1, steps + 1):
        p = _ell(phi0 + (phi1 - phi0) * i / steps, y)
        total += math.dist(prev, p)
        prev = p
    return total


def _phi_after(phi0: float, length: float, y: float) -> float:
    """Angle reached after walking `length` metres along the finger line from phi0."""
    phi, walked, d = phi0, 0.0, math.radians(0.5)
    while walked < length and phi < math.radians(260):
        walked += math.dist(_ell(phi, y), _ell(phi + d, y))
        phi += d
    return phi


def hand_right() -> MeshData:
    md = MeshData()
    g, pad = "glove", "glove_pad"
    knuckle_phi = math.radians(-8)
    # --- fingers: three phalanges each, curled along the grip, knuckle spheres at the joints ----------------------
    for (y, ws, lengths) in FINGERS:
        r = FINGER_R * ws
        phi = knuckle_phi
        prev = _ell(phi, y)
        md.sphere(prev, r * 1.12, g, rings=5, segments=8)
        for k, L in enumerate(lengths):
            phi = _phi_after(phi, L, y)
            p = _ell(phi, y)
            md.tube(prev, p, r * (1.0 - 0.07 * k), g, segments=8, caps=False)
            md.sphere(p, r * (1.03 - 0.07 * k), g, rings=5, segments=8)
            prev = p
        # knuckle armour pad on the back of the hand
        kp = _ell(knuckle_phi - math.radians(4), y, grow=FINGER_R * 0.9)
        md.sphere(kp, r * 0.62, pad, rings=4, segments=6, squash=0.8)
    # --- palm: a curved slab around the rear and outer side of the grip ------------------------------------------
    y0, y1 = -0.05, 0.039
    phis = [math.radians(a) for a in range(-100, -2, 7)] + [knuckle_phi]
    inner, outer = -FINGER_R * 0.9, FINGER_R * 1.25
    rows = []
    for ph in phis:
        rows.append((_ell(ph, y0, inner), _ell(ph, y1, inner), _ell(ph, y1, outer), _ell(ph, y0, outer)))
    for (a, b, pa, pb) in zip(rows, rows[1:], phis, phis[1:]):
        pm = (pa + pb) / 2
        out = (math.cos(pm) / (GRIP_RX + FINGER_R), 0.0, -math.sin(pm) / (GRIP_RZ + FINGER_R))
        md.face_toward([a[3], b[3], b[2], a[2]], g, out)                    # back of the hand (outside)
        md.face_toward([a[1], b[1], b[0], a[0]], g, (-out[0], 0, -out[2]))  # palm side (against the grip)
        md.face_toward([a[2], b[2], b[1], a[1]], g, (0, 1, 0))              # top edge
        md.face_toward([a[0], b[0], b[3], a[3]], g, (0, -1, 0))             # bottom edge
    first = rows[0]
    back = (math.sin(phis[0]), 0.0, math.cos(phis[0]))  # against the direction of increasing phi
    md.face_toward([first[0], first[1], first[2], first[3]], g, back)
    # a rounded heel of the hand toward the wrist
    md.sphere(_ell(math.radians(-80), -0.03, 0.002), 0.019, g, rings=6, segments=10)
    # --- thumb: from the palm's upper rear, over the top of the grip, lying along the -x side --------------------
    t0 = _ell(math.radians(-95), 0.036, 0.0)
    t1 = (-0.012, 0.05, 0.022)
    t2 = (-0.028, 0.052, -0.004)
    t3 = (-0.03, 0.05, -0.026)
    md.sphere(t0, 0.0125, g, rings=5, segments=8)
    for a, b, r in ((t0, t1, 0.0118), (t1, t2, 0.0102), (t2, t3, 0.0094)):
        md.tube(a, b, r, g, segments=8, caps=False)
        md.sphere(b, r * 1.02, g, rings=5, segments=8)
    # --- wrist and cuff ---------------------------------------------------------------------------------------------
    w_in = _ell(math.radians(-60), -0.022, 0.008)
    md.tube(w_in, WRIST, 0.026, g, segments=10, caps=False)
    md.sphere(w_in, 0.026, g, rings=6, segments=10)
    cuff_dir = (WRIST[0] - w_in[0], WRIST[1] - w_in[1], WRIST[2] - w_in[2])
    L = math.sqrt(sum(c * c for c in cuff_dir))
    back = tuple(WRIST[i] + cuff_dir[i] / L * 0.03 for i in range(3))
    md.tube(WRIST, back, 0.031, pad, segments=12, caps=True)
    return md


def mirror_x(src: MeshData) -> MeshData:
    """Mirror image across the yz plane (right hand -> left hand), with face winding fixed."""
    md = MeshData()
    md.verts = [(-x, y, z) for (x, y, z) in src.verts]
    md.faces = [list(reversed(f)) for f in src.faces]
    md.face_mat = list(src.face_mat)
    md.face_uv = [list(reversed(uv)) for uv in src.face_uv]
    md.face_col = [list(reversed(c)) for c in src.face_col]
    return md


def hand_left() -> MeshData:
    return mirror_x(hand_right())


def forearm() -> MeshData:
    """Unit-length sleeve along +z (wrist at 0, elbow at 1): scaled along z at runtime."""
    md = MeshData()
    seg = 14
    rings = [(0.0, 0.028), (0.08, 0.031), (0.4, 0.037), (0.75, 0.041), (1.0, 0.042)]
    pts = []
    for z, r in rings:
        row = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            # slightly flattened, like a real forearm
            row.append((math.cos(a) * r * 1.08, math.sin(a) * r * 0.92, z))
        pts.append(row)
    for a, b in zip(pts, pts[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            # (angle increasing, then +z): the normal points outward
            md.face([a[i], a[j], b[j], b[i]], "sleeve")
    # a rolled cuff seam near the wrist
    for i in range(seg):
        j = (i + 1) % seg
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * j / seg
        r = 0.0325
        q = [(math.cos(a0) * r * 1.08, math.sin(a0) * r * 0.92, 0.1), (math.cos(a1) * r * 1.08, math.sin(a1) * r * 0.92, 0.1),
             (math.cos(a1) * r * 1.08, math.sin(a1) * r * 0.92, 0.13), (math.cos(a0) * r * 1.08, math.sin(a0) * r * 0.92, 0.13)]
        md.face(q, "sleeve_seam")
    return md
