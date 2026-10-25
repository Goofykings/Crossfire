"""Derived building dimensions shared by the visual generator (building.py) and collision_gen.py.

Pure Python (no bpy). Coordinates are game/map space: x east, y up, z south.
Rects are (x0, z0, x1, z1).
"""
from __future__ import annotations

import math

from catalog import FLOOR_HEIGHT_GROUND, FLOOR_HEIGHT_UPPER

WALL_T = 0.32          # visual wall thickness used for window reveals and interior room walls
CORNICE = 0.35         # cornice band above the top floor
ARCH_RISE = 0.85       # segmental arch rise for "arch" style openings
LINTEL_CLEAR = 2.9     # clear height under flat timber lintels
ROOM_DOOR_W = 1.6
ROOM_DOOR_H = 2.5
GATE_CLEAR = 2.9


def eave_height(b: dict) -> float:
    return FLOOR_HEIGHT_GROUND + FLOOR_HEIGHT_UPPER * (b["floors"] - 1) + CORNICE


def floor_base(b: dict, floor: int) -> float:
    """Height of the floor level `floor` (0 = ground)."""
    return 0.0 if floor == 0 else FLOOR_HEIGHT_GROUND + FLOOR_HEIGHT_UPPER * (floor - 1)


def roof_pitch(b: dict) -> float:
    return math.radians(32 + (b["seed"] % 5))


def side_length(b: dict, side: str) -> float:
    x0, z0, x1, z1 = b["rect"]
    return (x1 - x0) if side in ("n", "s") else (z1 - z0)


def side_point(b: dict, side: str, at: float, out: float = 0.0):
    """Point on a facade: `at` metres along the side from its min corner, `out` metres outward."""
    x0, z0, x1, z1 = b["rect"]
    if side == "n":
        return x0 + at, z0 - out
    if side == "s":
        return x0 + at, z1 + out
    if side == "w":
        return x0 - out, z0 + at
    return x1 + out, z0 + at


def passage_profile(p: dict):
    """(springing, apex, collision_clear) for a passage or gate opening."""
    x0, z0, x1, z1 = p["rect"]
    span = min(x1 - x0, z1 - z0) if p.get("axis") is None else None
    if p.get("style", "arch") == "lintel":
        return LINTEL_CLEAR, LINTEL_CLEAR, LINTEL_CLEAR
    apex = p.get("clear", 3.2)
    springing = apex - ARCH_RISE
    return springing, apex, springing + 0.25


def passage_axis(b: dict, p: dict) -> str:
    """Direction of travel through a passage: 'x' or 'z' (the axis along which it pierces the building)."""
    bx0, bz0, bx1, bz1 = b["rect"]
    x0, z0, x1, z1 = p["rect"]
    through_x = x0 <= bx0 + 1e-6 and x1 >= bx1 - 1e-6
    through_z = z0 <= bz0 + 1e-6 and z1 >= bz1 - 1e-6
    if through_x and not through_z:
        return "x"
    if through_z and not through_x:
        return "z"
    # bridge buildings: travel along the longer passage dimension
    return "x" if (x1 - x0) >= (z1 - z0) else "z"


def room_layout(b: dict, room: dict):
    """Interior cavity rect + doorway rects for a walk-through ground-floor room.

    Ends of the room that coincide with the building edge get an exterior wall (WALL_T) with a
    centred doorway; the cavity itself is the room rect minus those walls.
    """
    bx0, bz0, bx1, bz1 = b["rect"]
    x0, z0, x1, z1 = room["rect"]
    cx0, cz0, cx1, cz1 = x0, z0, x1, z1
    doors = []
    if abs(x0 - bx0) < 1e-6:
        cx0 = x0 + WALL_T
        zc = (z0 + z1) / 2
        doors.append(("w", (x0 - 0.05, zc - ROOM_DOOR_W / 2, x0 + WALL_T + 0.05, zc + ROOM_DOOR_W / 2)))
    if abs(x1 - bx1) < 1e-6:
        cx1 = x1 - WALL_T
        zc = (z0 + z1) / 2
        doors.append(("e", (x1 - WALL_T - 0.05, zc - ROOM_DOOR_W / 2, x1 + 0.05, zc + ROOM_DOOR_W / 2)))
    if abs(z0 - bz0) < 1e-6:
        cz0 = z0 + WALL_T
        xc = (x0 + x1) / 2
        doors.append(("n", (xc - ROOM_DOOR_W / 2, z0 - 0.05, xc + ROOM_DOOR_W / 2, z0 + WALL_T + 0.05)))
    if abs(z1 - bz1) < 1e-6:
        cz1 = z1 - WALL_T
        xc = (x0 + x1) / 2
        doors.append(("s", (xc - ROOM_DOOR_W / 2, z1 - WALL_T - 0.05, xc + ROOM_DOOR_W / 2, z1 + 0.05)))
    # interior side walls (room long sides inside the building mass)
    return (cx0, cz0, cx1, cz1), doors


def chamfer_triangle(b: dict):
    """Return (corner, size, p_a, p_b) where p_a/p_b are the chamfer line end points, or None."""
    ch = b.get("chamfer")
    if not ch:
        return None
    x0, z0, x1, z1 = b["rect"]
    c = ch["size"]
    k = ch["corner"]
    if k == "nw":
        return k, c, (x0, z0 + c), (x0 + c, z0)
    if k == "ne":
        return k, c, (x1 - c, z0), (x1, z0 + c)
    if k == "se":
        return k, c, (x1, z1 - c), (x1 - c, z1)
    return k, c, (x0 + c, z1), (x0, z1 - c)


def footprint_polygon(b: dict):
    """Counter-clockwise (viewed from +y... i.e. on the plan with +z down this reads clockwise) outline."""
    x0, z0, x1, z1 = b["rect"]
    pts = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
    ch = chamfer_triangle(b)
    if not ch:
        return pts
    k, c, pa, pb = ch
    idx = {"nw": 0, "ne": 1, "se": 2, "sw": 3}[k]
    corner = pts[idx]
    # replace corner with the two chamfer points, ordered along the outline
    prev_pt = pts[idx - 1]
    a, bb = (pa, pb)
    # the chamfer point closer to the previous vertex comes first
    if (a[0] - prev_pt[0]) ** 2 + (a[1] - prev_pt[1]) ** 2 > (bb[0] - prev_pt[0]) ** 2 + (bb[1] - prev_pt[1]) ** 2:
        a, bb = bb, a
    out = pts[:idx] + [a, bb] + pts[idx + 1:]
    assert corner not in out
    return out


def door_center(b: dict, door: dict):
    return side_point(b, door["side"], door["at"])


def balcony_spec(b: dict):
    bal = b.get("balcony")
    if not bal:
        return None
    side = bal["side"]
    length = side_length(b, side)
    at = next((d["at"] for d in b.get("doors", []) if d["side"] == side), length / 2)
    width = min(3.0, length - 1.4)
    at = min(max(at, width / 2 + 0.7), length - width / 2 - 0.7)
    y = floor_base(b, bal.get("floor", 1))
    return {"side": side, "at": at, "width": width, "depth": 0.95, "y": y, "floor": bal.get("floor", 1)}


def shopfront_spec(b: dict):
    sf = b.get("shopfront")
    if not sf:
        return None
    side = sf["side"]
    length = side_length(b, side)
    at = next((d["at"] for d in b.get("doors", []) if d["side"] == side), length / 2)
    width = min(4.6, length - 1.2)
    at = min(max(at, width / 2 + 0.6), length - width / 2 - 0.6)
    return {"side": side, "at": at, "width": width, "awning_y": 2.75, "awning_depth": 1.1}
