"""Free-for-all spawn points spread over a layout (pure Python, shared by the layout tools).

`ffa_spawns(layout, props)` picks points on open, flat ground with room around them, away from props, practice
targets, doors and stairs, then spreads them out by farthest-point sampling without imposing symmetry.
Each spawn faces the longest clear
line of sight from its position, so nobody spawns staring at a wall.
"""
from __future__ import annotations

import math

import building_spec as bs
from layout_util import LayoutIndex

STEP = 0.5          # candidate grid (m)
CLEAR = 1.0         # free radius around a spawn (m)
PROP_GAP = 0.8      # extra distance from prop footprints (m)
TARGET_GAP = 2.5    # distance from practice targets (m)
DOOR_GAP = 1.4      # distance from door centres (m)
VIEW_RANGE = 30.0   # how far the facing search looks (m)


def _prop_boxes(layout: dict, props: dict):
    out = []
    # obstacles (the town well) are props the layout tool places itself
    for p in layout.get("props", []) + layout.get("obstacles", []):
        info = props.get(p["type"], {})
        col = info.get("collider")
        if not col:
            continue
        x, _, z = p["pos"]
        yaw = -math.radians(p.get("heading", 0))
        out.append((x, z, col[0] / 2, col[2] / 2, yaw))
    return out


def _near_box(x: float, z: float, box, gap: float) -> bool:
    bx, bz, hx, hz, yaw = box
    c, s = math.cos(yaw), math.sin(yaw)
    rx, rz = x - bx, z - bz
    lx, lz = rx * c - rz * s, rx * s + rz * c
    return abs(lx) < hx + gap and abs(lz) < hz + gap


def _walkable(idx: LayoutIndex, x: float, z: float) -> bool:
    return idx.classify(x, z)[0] == "open"


def ffa_spawns(layout: dict, props: dict, count: int = 16) -> list[dict]:
    idx = LayoutIndex(layout)
    p0x, p0z, p1x, p1z = layout["playArea"]
    boxes = _prop_boxes(layout, props)
    targets = [(t["pos"][0], t["pos"][2]) for t in layout.get("targets", [])]
    doors = []
    for b in layout["buildings"]:
        for d in b.get("doors", []):
            doors.append(bs.side_point(b, d["side"], d["at"], 0.5))
    stairs = [r for r, _ in idx.steps] + [r['rect'] for r in layout.get('upperRoutes', [])]
    ring = [(math.cos(a) * r, math.sin(a) * r) for r in (0.5, CLEAR) for a in (k * math.pi / 4 for k in range(8))]

    cands = []
    x = p0x + STEP
    while x < p1x - STEP / 2:
        z = p0z + STEP
        while z < p1z - STEP / 2:
            if not _walkable(idx, x, z):
                z += STEP
                continue
            g = idx.ground_at(x, z)
            ok = all(_walkable(idx, x + dx, z + dz) and abs(idx.ground_at(x + dx, z + dz) - g) < 0.05 for dx, dz in ring)
            ok = ok and not any(r[0] - 0.6 <= x <= r[2] + 0.6 and r[1] - 0.6 <= z <= r[3] + 0.6 for r in stairs)
            ok = ok and not any(_near_box(x, z, b, PROP_GAP) for b in boxes)
            ok = ok and all(math.hypot(x - tx, z - tz) >= TARGET_GAP for tx, tz in targets)
            ok = ok and all(math.hypot(x - dx, z - dz) >= DOOR_GAP for dx, dz in doors)
            if ok:
                # (+ 0.0 turns the -0.0 of rotated copies into 0.0)
                cands.append((round(x, 2) + 0.0, round(g, 3) + 0.0, round(z, 2) + 0.0))
            z += STEP
        x += STEP
    if not cands:
        raise ValueError("no spawn candidates")

    # Farthest-point sampling over the actual asymmetric walkable network.
    chosen = []
    first = min(cands, key=lambda c: math.hypot(c[0] - (p0x + 4), c[2]))
    chosen.append(first)
    dist = [min(math.hypot(c[0] - q[0], c[2] - q[2]) for q in chosen) for c in cands]
    while len(chosen) < count:
        i = max(range(len(cands)), key=lambda k: dist[k])
        c = cands[i]
        for q in (c,):
            chosen.append(q)
            for k, d in enumerate(cands):
                dist[k] = min(dist[k], math.hypot(d[0] - q[0], d[2] - q[2]))

    spawns = []
    for n, (x, g, z) in enumerate(chosen[:count]):
        spawns.append({"id": f"S{n + 1:02d}", "pos": [x, g, z], "heading": _open_heading(idx, boxes, x, z)})
    return spawns


def _open_heading(idx: LayoutIndex, boxes, x: float, z: float) -> int:
    """Compass heading (multiple of 15 degrees) with the longest clear run of open ground (props block it too)."""
    best, best_len = 0, -1.0
    for h in range(0, 360, 15):
        a = math.radians(h)
        dx, dz = math.sin(a), -math.cos(a)  # heading 0 looks north (-z)
        t = 0.0
        while t < VIEW_RANGE and idx.classify(x + dx * t, z + dz * t)[0] in ("open", "covered") and \
                not any(_near_box(x + dx * t, z + dz * t, b, 0.0) for b in boxes):
            t += 0.25
        if t > best_len + 1e-6:
            best, best_len = h, t
    return best
