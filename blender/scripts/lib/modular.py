"""Generic modular kit pieces exported to models/shared/kit for building future maps.

European Town generates its streets/walls procedurally from the layout (terrain.py); these pieces
are the same vocabulary as standalone, grid-snappable modules. Origins sit on the ground at the
piece centre; dimensions are in the piece names.
"""
from __future__ import annotations

import math

import kit
from meshkit import MeshData


def road_cobble_4x4(drain: bool = False) -> MeshData:
    md = MeshData()
    s = 2.0
    if not drain:
        md.face([(-s, 0, -s), (-s, 0, s), (s, 0, s), (s, 0, -s)], "cobble")
    else:
        md.face([(-s, 0, -s), (-s, 0, s), (-0.3, 0, s), (-0.3, 0, -s)], "cobble")
        md.face([(0.3, 0, -s), (0.3, 0, s), (s, 0, s), (s, 0, -s)], "cobble")
        md.face([(-0.3, 0, -s), (-0.3, -0.04, -s), (-0.3, -0.04, s), (-0.3, 0, s)][::-1], "slabs")
        md.face([(0.3, 0, s), (0.3, -0.04, s), (0.3, -0.04, -s), (0.3, 0, -s)][::-1], "slabs")
        md.face([(-0.3, -0.04, -s), (-0.3, -0.04, s), (0.3, -0.04, s), (0.3, -0.04, -s)], "slabs")
    return md


def curb(length: float = 2.0) -> MeshData:
    md = MeshData()
    md.box(-length / 2, -0.05, -0.15, length / 2, 0.14, 0.15, "stone_trim", skip=("ny",))
    md.box(-length / 2, 0.12, -0.17, length / 2, 0.14, -0.15, "stone_trim", skip=("ny", "pz"))
    return md


def curb_corner() -> MeshData:
    md = MeshData()
    seg = 6
    r0, r1 = 0.7, 1.0
    for i in range(seg):
        a, b = math.pi / 2 * i / seg, math.pi / 2 * (i + 1) / seg
        p = [(math.cos(a) * r0, 0.14, -math.sin(a) * r0), (math.cos(a) * r1, 0.14, -math.sin(a) * r1),
             (math.cos(b) * r1, 0.14, -math.sin(b) * r1), (math.cos(b) * r0, 0.14, -math.sin(b) * r0)]
        md.face(p[::-1], "stone_trim")
        md.face([(math.cos(a) * r1, -0.05, -math.sin(a) * r1), (math.cos(b) * r1, -0.05, -math.sin(b) * r1),
                 (math.cos(b) * r1, 0.14, -math.sin(b) * r1), (math.cos(a) * r1, 0.14, -math.sin(a) * r1)][::-1], "stone_trim")
    return md


def sidewalk_2x2() -> MeshData:
    md = MeshData()
    md.box(-1, -0.05, -1, 1, 0.12, 1, "slabs", skip=("ny",))
    return md


def stone_wall_2m(height: float = 3.0) -> MeshData:
    md = MeshData()
    md.box(-1, -0.05, -0.3, 1, height, 0.3, "stone_rubble", skip=("ny",))
    md.box(-1.03, height, -0.36, 1.03, height + 0.15, 0.36, "stone_trim")
    return md


def stone_wall_pillar(height: float = 3.4) -> MeshData:
    md = MeshData()
    md.box(-0.45, -0.05, -0.45, 0.45, height, 0.45, "stone_blocks", skip=("ny",))
    md.box(-0.52, height, -0.52, 0.52, height + 0.18, 0.52, "stone_trim")
    md.cylinder((0, height + 0.18, 0), 0.22, 0.25, "stone_trim", segments=10, radius_top=0.05)
    return md


def archway_4m() -> MeshData:
    """Free-standing gate arch: two piers, a segmental arch and a tiled cap. Opening 3 m x 3.2 m."""
    md = MeshData()
    span, spring, rise, depth, top = 3.0, 2.4, 0.8, 0.7, 4.3
    for x0 in (-2.0, 1.5):
        md.box(x0, -0.05, -depth / 2, x0 + 0.5, top, depth / 2, "stone_blocks", skip=("ny",))
    R = (span * span / 4 + rise * rise) / (2 * rise)
    cy = spring + rise - R
    a0, a1 = math.atan2(spring - cy, -span / 2), math.atan2(spring - cy, span / 2)
    N = 12
    arc = [(R * math.cos(a0 + (a1 - a0) * i / N), cy + R * math.sin(a0 + (a1 - a0) * i / N)) for i in range(N + 1)]
    for z, sgn in ((-depth / 2, -1), (depth / 2, 1)):
        for i in range(N):
            (xa, ya), (xb, yb) = arc[i], arc[i + 1]
            corner = (-span / 2, top) if i < N // 2 else (span / 2, top)
            tri = [(xa, ya, z), (corner[0], corner[1], z), (xb, yb, z)]
            if sgn > 0:
                tri = tri[::-1]
            md.face(tri, "stone_blocks")
        crown = [(-span / 2, top, z), (0.0, spring + rise, z), (span / 2, top, z)]
        md.face(crown if sgn > 0 else crown[::-1], "stone_blocks")
    for i in range(N):
        (xa, ya), (xb, yb) = arc[i], arc[i + 1]
        md.face([(xa, ya, -depth / 2), (xb, yb, -depth / 2), (xb, yb, depth / 2), (xa, ya, depth / 2)][::-1], "stone_trim")
    md.box(-2.1, top, -0.5, 2.1, top + 0.15, 0.5, "stone_trim")
    return md


def stairs_stone_4(width: float = 3.0) -> MeshData:
    md = MeshData()
    for k in range(4):
        md.box(-width / 2, -0.05, -0.64 + k * 0.32, width / 2, 0.18 * (4 - k), 0.64, "stone_blocks", skip=("ny",))
    return md


def roof_vent() -> MeshData:
    md = MeshData()
    md.box(-0.2, 0, -0.2, 0.2, 0.25, 0.2, "iron_rusty")
    md.cylinder((0, 0.25, 0), 0.08, 0.35, "iron_rusty", segments=8)
    md.cylinder((0, 0.6, 0), 0.16, 0.08, "iron_rusty", segments=8, radius_top=0.02)
    return md


KIT_BUILDERS = {
    "road_cobble_4x4": lambda: road_cobble_4x4(False),
    "road_cobble_drain_4x4": lambda: road_cobble_4x4(True),
    "curb_2m": curb,
    "curb_corner": curb_corner,
    "sidewalk_2x2": sidewalk_2x2,
    "stone_wall_2m": stone_wall_2m,
    "stone_wall_pillar": stone_wall_pillar,
    "archway_4m": archway_4m,
    "door_wood_single": lambda: kit.door(1.1, 2.3, "door_stone_warm", False),
    "door_wood_double": lambda: kit.door(1.6, 2.6, "door_plaster_white", True),
    "stairs_stone_4": stairs_stone_4,
    "roof_vent": roof_vent,
    "window_box": lambda: kit.flower_box(1.0),
    "window_std_1x1.5": lambda: kit.window(1.0, 1.5, "frame_white"),
    "shutters_open_1x1.5": lambda: kit.shutters_open(1.0, 1.5, "shutter_plaster_white"),
    "balcony_3m": lambda: kit.balcony(3.0, 0.95),
}
