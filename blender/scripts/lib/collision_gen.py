"""Simplified collision geometry for a map layout (pure Python, no bpy).

Produces a list of oriented boxes (rotation about +Y only). The Blender pipeline turns each box
into a COL_* object (for inspection / debug GLB) and writes them to collision.json, which the
runtime CollisionWorld loads. Props are NOT included here: the runtime adds prop colliders from
the asset manifest so props can be moved without re-running Blender.

Box format: {"c": [cx, cy, cz], "h": [hx, hy, hz], "yaw": radians, "tag": "kind:id"}
"""
from __future__ import annotations

import json
import math

import building_spec as bs

EPS = 1e-6


def aabb(x0, y0, z0, x1, y1, z1):
    return [min(x0, x1), min(y0, y1), min(z0, z1), max(x0, x1), max(y0, y1), max(z0, z1)]


def subtract(box, hole):
    """AABB minus AABB -> list of up to 6 AABBs covering box \\ hole."""
    bx0, by0, bz0, bx1, by1, bz1 = box
    hx0, hy0, hz0, hx1, hy1, hz1 = hole
    if hx0 >= bx1 or hx1 <= bx0 or hy0 >= by1 or hy1 <= by0 or hz0 >= bz1 or hz1 <= bz0:
        return [box]
    out = []
    # slabs along x
    if hx0 > bx0:
        out.append([bx0, by0, bz0, hx0, by1, bz1])
    if hx1 < bx1:
        out.append([hx1, by0, bz0, bx1, by1, bz1])
    cx0, cx1 = max(bx0, hx0), min(bx1, hx1)
    # slabs along z within the remaining x band
    if hz0 > bz0:
        out.append([cx0, by0, bz0, cx1, by1, hz0])
    if hz1 < bz1:
        out.append([cx0, by0, hz1, cx1, by1, bz1])
    cz0, cz1 = max(bz0, hz0), min(bz1, hz1)
    # slabs along y within the remaining x/z column
    if hy0 > by0:
        out.append([cx0, by0, cz0, cx1, hy0, cz1])
    if hy1 < by1:
        out.append([cx0, hy1, cz0, cx1, by1, cz1])
    return [b for b in out if b[3] - b[0] > EPS and b[4] - b[1] > EPS and b[5] - b[2] > EPS]


def subtract_all(boxes, holes):
    for h in holes:
        nxt = []
        for b in boxes:
            nxt.extend(subtract(b, h))
        boxes = nxt
    return boxes


def to_obb(b, tag, yaw=0.0):
    x0, y0, z0, x1, y1, z1 = b
    return {"c": [round((x0 + x1) / 2, 4), round((y0 + y1) / 2, 4), round((z0 + z1) / 2, 4)],
            "h": [round((x1 - x0) / 2, 4), round((y1 - y0) / 2, 4), round((z1 - z0) / 2, 4)],
            "yaw": round(yaw, 6), "tag": tag}


def building_boxes(b):
    x0, z0, x1, z1 = b["rect"]
    top = bs.eave_height(b)
    tag = f"building:{b['id']}"
    boxes = [aabb(x0, 0.0, z0, x1, top, z1)]
    holes = []
    for p in b.get("passages", []):
        px0, pz0, px1, pz1 = p["rect"]
        axis = bs.passage_axis(b, p)
        _, _, clear = bs.passage_profile(p)
        if axis == "x":
            holes.append(aabb(px0 - 0.1, -1.0, pz0, px1 + 0.1, clear, pz1))
        else:
            holes.append(aabb(px0, -1.0, pz0 - 0.1, px1, clear, pz1 + 0.1))
    for room in b.get("rooms", []):
        (cx0, cz0, cx1, cz1), doors = bs.room_layout(b, room)
        holes.append(aabb(cx0, -1.0, cz0, cx1, room.get("clear", 3.0), cz1))
        for _, (dx0, dz0, dx1, dz1) in doors:
            holes.append(aabb(dx0, -1.0, dz0, dx1, bs.ROOM_DOOR_H, dz1))
    for interior in b.get("interiors", []):
        for (rx0, rz0, rx1, rz1), clear in bs.interior_openings(interior):
            holes.append(aabb(rx0, -1.0, rz0, rx1, clear, rz1))
    ch = bs.chamfer_triangle(b)
    if ch:
        k, c, pa, pb = ch
        cxr = (x0, x0 + c) if "w" in k else (x1 - c, x1)
        czr = (z0, z0 + c) if "n" in k else (z1 - c, z1)
        holes.append(aabb(cxr[0], -1.0, czr[0], cxr[1], top + 1, czr[1]))
    boxes = subtract_all(boxes, holes)
    out = [to_obb(bx, tag) for bx in boxes]
    if ch:
        k, c, pa, pb = ch
        # 45-degree box whose outer face lies on the chamfer line, reaching inward
        mx, mz = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
        inward = {"nw": (1, 1), "ne": (-1, 1), "se": (-1, -1), "sw": (1, -1)}[k]
        n = math.sqrt(2)
        depth = c / n
        cx = mx + inward[0] / n * depth / 2
        cz = mz + inward[1] / n * depth / 2
        # local +x runs along the chamfer line; yaw is a rotation about +Y (right-handed)
        lx, lz = pb[0] - pa[0], pb[1] - pa[1]
        yaw = math.atan2(-lz, lx)
        out.append({"c": [round(cx, 4), round(top / 2, 4), round(cz, 4)],
                    "h": [round(c * n / 2, 4), round(top / 2, 4), round(depth / 2, 4)],
                    "yaw": round(yaw, 6), "tag": tag})
    bal = bs.balcony_spec(b)
    if bal:
        sx, sz = bs.side_point(b, bal["side"], bal["at"], bal["depth"] / 2)
        hw, hd = bal["width"] / 2, bal["depth"] / 2
        if bal["side"] in ("n", "s"):
            out.append(to_obb(aabb(sx - hw, bal["y"] - 0.12, sz - hd, sx + hw, bal["y"] + 1.05, sz + hd), tag))
        else:
            out.append(to_obb(aabb(sx - hd, bal["y"] - 0.12, sz - hw, sx + hd, bal["y"] + 1.05, sz + hw), tag))
    sf = bs.shopfront_spec(b)
    if sf:
        sx, sz = bs.side_point(b, sf["side"], sf["at"], sf["awning_depth"] / 2)
        hw, hd = sf["width"] / 2, sf["awning_depth"] / 2
        y = sf["awning_y"]
        if sf["side"] in ("n", "s"):
            out.append(to_obb(aabb(sx - hw, y - 0.15, sz - hd, sx + hw, y + 0.35, sz + hd), tag))
        else:
            out.append(to_obb(aabb(sx - hd, y - 0.15, sz - hw, sx + hd, y + 0.35, sz + hw), tag))
    return out


def wall_boxes(w):
    x0, z0, x1, z1 = w["rect"]
    tag = f"wall:{w['id']}"
    boxes = [aabb(x0, 0.0, z0, x1, w["height"], z1)]
    holes = []
    for g in w.get("gates", []):
        gx0, gz0, gx1, gz1 = g["rect"]
        holes.append(aabb(gx0 - 0.05, -1.0, gz0 - 0.05, gx1 + 0.05, bs.GATE_CLEAR, gz1 + 0.05))
    return [to_obb(b, tag) for b in subtract_all(boxes, holes)]


def stair_rects(t):
    """Yield (step_index 1..n, rect, top_height) for every step of every stair run of a terrace."""
    x0, z0, x1, z1 = t["rect"]
    for st in t["stairs"]:
        n, run, rise = st["steps"], st["run"], st["rise"]
        a, b = st["from"], st["to"]
        for k in range(1, n + 1):
            lo, hi = run * (k - 1), run * k
            if st["side"] == "w":
                r = (x0 + lo, a, x0 + hi, b)
            elif st["side"] == "e":
                r = (x1 - hi, a, x1 - lo, b)
            elif st["side"] == "n":
                r = (a, z0 + lo, b, z0 + hi)
            else:
                r = (a, z1 - hi, b, z1 - lo)
            yield st, k, r, rise * k


def terrace_boxes(t):
    x0, z0, x1, z1 = t["rect"]
    tag = f"terrace:{t['id']}"
    h = t["height"]
    top = [aabb(x0, -1.0, z0, x1, h, z1)]
    holes = []
    for st in t["stairs"]:
        depth = st["steps"] * st["run"]
        a, b = st["from"], st["to"]
        if st["side"] == "w":
            holes.append(aabb(x0 - 0.01, -2, a, x0 + depth, h + 1, b))
        elif st["side"] == "e":
            holes.append(aabb(x1 - depth, -2, a, x1 + 0.01, h + 1, b))
        elif st["side"] == "n":
            holes.append(aabb(a, -2, z0 - 0.01, b, h + 1, z0 + depth))
        else:
            holes.append(aabb(a, -2, z1 - depth, b, h + 1, z1 + 0.01))
    out = [to_obb(bx, tag) for bx in subtract_all(top, holes)]
    for st, k, r, top_y in stair_rects(t):
        out.append(to_obb(aabb(r[0], -1.0, r[1], r[2], top_y, r[3]), f"stairs:{t['id']}"))
    return out


def arch_boxes(a):
    x0, z0, x1, z1 = a["rect"]
    return [to_obb(aabb(x0, a["spring"], z0, x1, a["spring"] + 1.5, z1), f"arch:{a['id']}")]


def railing_boxes(t):
    """Guard rails along the open edges of a raised platform (layout terraces[].railings: [{side, from, to}])."""
    x0, z0, x1, z1 = t["rect"]
    h = t["height"]
    out = []
    for r in t.get("railings", []):
        a, b = r["from"], r["to"]
        if r["side"] == "n":
            box = aabb(a, h, z0, b, h + 1.05, z0 + 0.08)
        elif r["side"] == "s":
            box = aabb(a, h, z1 - 0.08, b, h + 1.05, z1)
        elif r["side"] == "w":
            box = aabb(x0, h, a, x0 + 0.08, h + 1.05, b)
        else:
            box = aabb(x1 - 0.08, h, a, x1, h + 1.05, b)
        out.append(to_obb(box, f"railing:{t['id']}"))
    return out


def map_collision(layout: dict) -> dict:
    boxes = []
    lim = layout["outerLimit"] + 1
    boxes.append(to_obb(aabb(-lim, -2.0, -lim, lim, 0.0, lim), "ground"))
    for b in layout["buildings"]:
        boxes.extend(building_boxes(b))
    for w in layout["walls"]:
        boxes.extend(wall_boxes(w))
    for t in layout["terraces"]:
        boxes.extend(terrace_boxes(t))
        boxes.extend(railing_boxes(t))
    for a in layout.get("arches", []):
        boxes.extend(arch_boxes(a))
    # invisible safety ring just outside the playable square
    p0, _, p1, _ = layout["playArea"]
    ring = 3.0
    for bx in (aabb(p0 - ring - 0.5, 0, p0 - ring, p0 - 0.5, 30, p1 + ring),
               aabb(p1 + 0.5, 0, p0 - ring, p1 + ring + 0.5, 30, p1 + ring),
               aabb(p0 - ring, 0, p0 - ring - 0.5, p1 + ring, 30, p0 - 0.5),
               aabb(p0 - ring, 0, p1 + 0.5, p1 + ring, 30, p1 + ring + 0.5)):
        boxes.append(to_obb(bx, "boundary"))
    return {"version": 1, "map": layout["id"], "boxes": boxes}


if __name__ == "__main__":
    import sys
    from pathlib import Path

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    data = map_collision(json.loads(src.read_text(encoding="utf-8")))
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"{len(data['boxes'])} collision boxes -> {dst}")
