"""Industrial Complex layout designer.

Authors the walkable network (service roads, alleys, loading yards, docks, platforms, passages, walk-in warehouse
interiors) for the north half of the map, rotates it 180 degrees for the other half, decomposes the rest into
industrial lots and writes src/maps/industrial-complex/layout.json (the canonical, hand-editable map data).

Usage:
    python -I tools/layout_industrial.py           # metrics + plan image (docs/industrial-complex-plan.png)
    python -I tools/layout_industrial.py --write   # also (re)generate layout.json
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I does not add the script's folder
from layoutkit import SIDE_HEADING, SIDE_OUT, SIDES, Area, LayoutKit, covered_floor, ground_zones, inside, mirror_all  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_JSON = ROOT / "src" / "maps" / "industrial-complex" / "layout.json"
PLAN = ROOT / "docs" / "industrial-complex-plan.png"
sys.path.insert(0, str(ROOT / "blender" / "scripts" / "lib"))
from catalog import PROPS  # noqa: E402
from spawn_points import ffa_spawns  # noqa: E402

PLAY = 34
OUTER = 42
WALL = 0.3  # warehouse wall thickness: interiors are inset by this from the lot edge
DOCK_H = 1.1
PLATFORM_H = 3.0
GANTRY_H = 1.8

# ---------------------------------------------------------------------------------------------------------------------
# Walkable network, authored for the north half (z < 0) plus the west part of the centre band; everything is rotated
# 180 degrees about the origin for the other half. Designed from the written brief (the reference sheet in
# references/industrial-complex/ was found only later, see docs/LEVEL_DESIGN.md): three routes between the old spawn yards (north: dock lane -> North Hall -> container yard; middle: gate -> yard -> covered
# alley -> loading square; south: the north route rotated), cross-links forming loops, and set pieces along them.
# ---------------------------------------------------------------------------------------------------------------------
AREAS: list[Area] = [
    # blue spawn yard on the west edge: exits north (here), south (rotated red north exit) and east (gate passage)
    Area("spawn_blue", "spawn", -33, -6, -25, 6, team="blue"),
    Area("blue_exit_n", "street", -33, -12, -29, -6),
    Area("blue_gate", "passage", -25, -3, -21, 0),
    Area("blue_yard", "yard", -21, -5, -15, 5),
    Area("yard_passage", "passage", -19, -12, -16, -5),
    # west service road and the loop up to the north lane
    Area("w_road", "street", -33, -16, -16, -12),
    Area("nw_link", "alley", -26, -26, -23, -16),
    Area("n_lane_w", "street", -31, -31, -16, -26),
    # loading dock lane: a raised dock (stairs at its west end) above the ground lane
    Area("dock_n", "dock", -16, -31, -6, -28, height=DOCK_H, extra={"stairs": [("w", None)]}),
    Area("n_lane_mid", "street", -16, -28, -6, -24),
    # North Hall: walk-through warehouse (doors west, east and south)
    Area("hall_n", "interior", -6, -31, 4, -22),
    # container yard and the north-east lane down to the red spawn's north exit
    Area("cyard", "yard", 4, -31, 14, -20),
    Area("ne_lane", "street", 14, -24, 24, -20),
    Area("ne_link", "alley", 14, -20, 17, -16),
    Area("e_cross", "street", 14, -16, 29, -12),
    Area("red_exit_n", "street", 25, -12, 29, -6),
    # substation pocket in the north-east corner, looped back to the cross street
    Area("sub_gantry", "platform", 24, -28, 31, -25, height=GANTRY_H, extra={"stairs": [("s", (28, 31))]}),
    Area("substation", "yard", 24, -25, 31, -20),
    Area("sub_link", "alley", 29, -20, 31, -16),
    # cross-links toward the centre
    Area("cl_w", "alley", -16, -24, -13, -16),
    Area("w_cross", "street", -16, -16, -11, -12),
    Area("c_link_n", "alley", -4, -22, 0, -12),
    Area("e_link", "alley", 8, -20, 11, -12),
    Area("c_north", "street", -11, -12, 11, -8),
    Area("c_link_s", "alley", -4, -8, 0, -6),
    # small walk-through workshop between the north street and the west entry alley
    Area("w_shop", "interior", -11, -8, -7, 1),
    Area("w_entry", "alley", -15, 1, -6, 5),
    # loading square in the middle (self-symmetric), split by a container stack
    Area("centre", "yard", -6, -6, 6, 6, center=True),
]

# overhead covered walkways and pipe bridges: (id, rect, spring height, style); rotated copies are added
ARCHES = [
    ("cv_w_entry", (-14.5, 1, -11.5, 5), 3.6, "canopy"),
    ("cv_cl_w", (-16, -21, -13, -19), 3.6, "canopy"),
    ("pb_ne_lane", (19.4, -24, 20.6, -20), 5.0, "pipes"),

    ("pb_c_north", (5.4, -12, 6.6, -8), 5.4, "pipes"),
]

# hand-placed dressing for the north half: (type, (x, y, z), heading); rotated copies are added
MANUAL_PROPS = [
    ("container_stack_a", (0.0, 0, 0.0), 0),
    ("container_blue", (9.0, 0, -26.0), 90),
    ("container_stack_b", (11.6, 0, -23.0), 0),
    ("container_red", (6.4, 0, -21.6), 0),
    ("forklift", (-12.0, 0, -25.4), 90),
    ("pallet_goods", (-13.4, DOCK_H, -30.4), 0),
    ("pallet_wrapped", (-10.6, DOCK_H, -30.4), 0),
    ("pallet_goods", (-8.2, DOCK_H, -30.4), 0),
    ("skip_bin", (-29.5, 0, -21.0), 90),
    ("jersey_barrier", (-23.5, 0, -15.0), 0),
    ("transformer", (26.0, 0, -22.6), 0),
    ("electrical_cabinet", (30.3, 0, -22.5), 270),
    ("gas_cage", (-20.4, 0, -1.2), 90),
    ("drum_group", (-16.0, 0, 4.0), 0),
    ("cable_reel", (-20.0, 0, 4.2), 90),
    ("pipe_bundle", (22.5, 0, -23.3), 0),
    ("tire_stack", (-30.4, 0, -29.4), 0),
]

TARGETS = [
    ((-29.5, 0, -29.0), 90), ((-14.5, 0, -22.5), 0), ((-12.0, DOCK_H, -29.6), 180), ((-24.5, 0, -18.0), 0),
    ((-1.0, 0, -27.5), 90), ((0.0, 0, -14.0), 180), ((12.5, 0, -27.5), 270), ((25.5, 0, -26.5), 90),
    ((25.0, GANTRY_H, -26.5), 90), ((9.5, 0, -13.5), 180), ((-18.0, 0, 3.6), 90), ((-4.5, 0, -4.5), 135),
]



def material_of(a: Area) -> str:
    return {"street": "asphalt", "alley": "concrete_floor", "yard": "concrete_floor", "dock": "concrete_floor",
            "platform": "metal_plate", "spawn": "concrete_floor", "terrace": "concrete_floor"}.get(a.kind, "concrete_floor")


# ---------------------------------------------------------------------------------------------------------------------
# lots -> buildings
# ---------------------------------------------------------------------------------------------------------------------
PALETTES = {
    "warehouse": ["brick_red", "brick_soot", "concrete", "panel", "clad_blue", "clad_green", "brick_clad", "clad_red"],
    "workshop": ["brick_red", "brick_soot", "clad_cream", "rusty", "brick_clad"],
    "office": ["concrete", "panel", "brick_red", "brick_clad"],
    "shed": ["clad_blue", "clad_green", "rusty", "clad_cream", "clad_red"],
    "backdrop": ["concrete", "panel", "clad_blue", "brick_soot", "clad_green"],
}


def lot_side_length(r, side):
    return (r[2] - r[0]) if side in ("n", "s") else (r[3] - r[1])


def door_spots(kit: LayoutKit, info, side, count, width, avoid):
    """Centres (metres from the side's min corner) for `count` doors in the longest open run of a side."""
    run, start = info["runs"][side]
    if run < width + 1.2:
        return []
    out = []
    usable = run - 1.0
    n = min(count, max(1, int(usable // (width + 1.6))))
    for i in range(n):
        at = start + 0.5 + usable * (i + 0.5) / n
        if any(a0 - width / 2 - 0.4 < at < a1 + width / 2 + 0.4 for (a0, a1) in avoid):
            continue
        out.append(round(at * 2) / 2)
    return out


def faces_kind(info, side, kinds):
    return any(a is not None and a.kind in kinds for a in info["faces"][side])


def make_building(kit: LayoutKit, info, index: int):
    r = info["rect"]
    x0, z0, x1, z1 = r
    w, d = x1 - x0, z1 - z0
    h = info["hash"]
    covered = info["covered"]
    for a in covered:
        if not inside(a, r):
            print(f"LAYOUT PROBLEM: covered area {a.id} split by lot {r}")
    if min(w, d) <= 2 or w * d <= 6:
        style = "fence" if any(faces_kind(info, s, ("yard", "spawn")) for s in SIDES) else "concrete"
        if max(w, d) <= 2:
            style = "pillar"
        return "wall", {"rect": [x0, z0, x1, z1], "height": 2.6 if style == "fence" else 3.0, "style": style,
                        "gates": [{"rect": [a.x0, a.z0, a.x1, a.z1]} for a in covered]}
    area = w * d
    if info["backdrop"]:
        btype = "backdrop"
        if abs(w - d) <= 2 and area <= 64 and h % 3 == 0:
            btype = "chimney" if h % 2 else "tank"
    elif any(a.kind == "interior" for a in covered):
        btype = "warehouse"
    elif area >= 110:
        btype = "warehouse"
    elif area >= 48:
        btype = "office" if (faces_kind(info, info_front(info), ("street",)) and h % 3 == 0) else "workshop"
    else:
        btype = "shed" if h % 2 else "workshop"
    if btype == "chimney":
        height = 22.0 + (h % 7)
    elif btype == "tank":
        height = 8.0 + (h % 4)
    elif btype == "backdrop":
        height = 9.0 + (h % 5)
    elif btype == "warehouse":
        height = 7.6 + (h % 4) * 0.5
    elif btype == "workshop":
        height = 5.4 + (h % 3) * 0.4
    elif btype == "office":
        height = 7.6 if (h >> 3) % 2 else 10.6
    else:
        height = 4.0 + (h % 2) * 0.5
    if info["perimeter"] and btype in ("shed", "workshop"):
        height = max(height, 6.5)
    pals = PALETTES.get(btype, PALETTES["backdrop"])
    palette = pals[(h >> 4) % len(pals)]
    front = info_front(info)
    if btype in ("office", "chimney", "tank") or (btype == "backdrop" and h % 2):
        roof = {"type": "flat"}
    elif btype in ("shed",) or (btype == "workshop" and h % 2):
        roof = {"type": "shed", "low": front}
    else:
        roof = {"type": "gable", "ridge": "x" if w >= d else "z"}
    b = {"id": f"I{index:02d}", "type": btype, "rect": [x0, z0, x1, z1], "height": round(height, 2),
         "floors": 3 if (btype == "office" and height > 9) else 2 if btype == "office" else 1,
         "palette": palette, "seed": h % 9973, "roof": roof, "front": front, "doors": [], "sign": (h >> 6) % 16}
    if btype in ("backdrop", "chimney", "tank"):
        return "building", b
    # interiors: walk-in halls with explicit cavity and doorways
    interiors, avoid = [], {s: [] for s in SIDES}
    for a in covered:
        if a.kind != "interior":
            continue
        cav = [a.x0 + (WALL if a.x0 <= x0 else 0), a.z0 + (WALL if a.z0 <= z0 else 0),
               a.x1 - (WALL if a.x1 >= x1 else 0), a.z1 - (WALL if a.z1 >= z1 else 0)]
        doors = []
        for side in SIDES:
            on_edge = {"n": a.z0 <= z0, "s": a.z1 >= z1, "w": a.x0 <= x0, "e": a.x1 >= x1}[side]
            if not on_edge:
                continue
            lo, hi = (a.x0, a.x1) if side in ("n", "s") else (a.z0, a.z1)
            base = x0 if side in ("n", "s") else z0
            # find the open stretch of this edge facing walkable ground within the interior's span
            samples = kit.side_samples(r, side)
            best, cur, best_end = 0, 0, -1
            for i, (sx, sz) in enumerate(samples):
                pos = base + i
                k, outside = kit.classify(sx, sz)
                ok = lo <= pos < hi and k == "open" and outside.height < 0.05
                cur = cur + 1 if ok else 0
                if cur > best:
                    best, best_end = cur, i
            if best < 2:
                continue
            c = base + best_end - best + 1 + best / 2
            dw = 3.6 if best >= 5 else 1.6
            kind = "roller_open" if dw > 2 else "doorway"
            dh = 3.8 if dw > 2 else 2.4
            if side == "n":
                rect = [c - dw / 2, z0, c + dw / 2, cav[1]]
            elif side == "s":
                rect = [c - dw / 2, cav[3], c + dw / 2, z1]
            elif side == "w":
                rect = [x0, c - dw / 2, cav[0], c + dw / 2]
            else:
                rect = [cav[2], c - dw / 2, x1, c + dw / 2]
            doors.append({"side": side, "rect": [round(v, 3) for v in rect], "height": dh, "kind": kind})
            avoid[side].append((c - base - dw / 2, c - base + dw / 2))
        if len(doors) < 2:
            print(f"LAYOUT PROBLEM: interior {a.id} has {len(doors)} doorway(s); walk-throughs need two")
        interiors.append({"id": a.id, "rect": [round(v, 3) for v in cav], "clear": round(min(b["height"] - 1.6, 5.6), 2),
                          "doors": doors})
    if interiors:
        b["interiors"] = interiors
    passages = [a for a in covered if a.kind == "passage"]
    if passages:
        b["passages"] = [{"rect": [a.x0, a.z0, a.x1, a.z1], "style": "portal", "clear": 4.2} for a in passages]
        for a in passages:
            for side in SIDES:
                lo, hi = (a.x0 - x0, a.x1 - x0) if side in ("n", "s") else (a.z0 - z0, a.z1 - z0)
                avoid[side].append((lo, hi))
    # closed doors on the open frontage
    for side in sorted(SIDES, key=lambda s: -info["runs"][s][0]):
        if info["runs"][side][0] < 3:
            continue
        dock = faces_kind(info, side, ("dock",))
        if btype == "warehouse":
            for at in door_spots(kit, info, side, 3 if side == front else 2, 3.8, avoid[side]):
                b["doors"].append({"side": side, "at": at, "width": 3.8, "kind": "dock" if dock else "roller"})
                avoid[side].append((at - 1.9, at + 1.9))
        elif btype == "workshop":
            for at in door_spots(kit, info, side, 1, 3.2, avoid[side]):
                b["doors"].append({"side": side, "at": at, "width": 3.2, "kind": "dock" if dock else "roller"})
                avoid[side].append((at - 1.6, at + 1.6))
        elif btype == "shed" and side == front:
            for at in door_spots(kit, info, side, 1, 2.8, avoid[side]):
                b["doors"].append({"side": side, "at": at, "width": 2.8, "kind": "roller"})
                avoid[side].append((at - 1.4, at + 1.4))
        # personnel doors: on the front and on one more long side
        run, start = info["runs"][side]
        personnel = sum(1 for d in b["doors"] if d["kind"] in ("door", "double"))
        for cand in (start + 2.0, start + run - 2.0, start + run / 2):
            if personnel >= 2 or (side != front and run < 5):
                break
            if run >= 3 and all(not (a0 - 0.9 < cand < a1 + 0.9) for (a0, a1) in avoid[side]):
                kind = "double" if (btype == "office" and side == front) else "door"
                wd = 1.8 if kind == "double" else 1.0
                b["doors"].append({"side": side, "at": round(cand * 2) / 2, "width": wd, "kind": kind})
                avoid[side].append((cand - wd / 2 - 0.3, cand + wd / 2 + 0.3))
                break
        if len(b["doors"]) >= 6:
            break
    return "building", b


def info_front(info):
    return max(SIDES, key=lambda s: (info["runs"][s][0], s))


# ---------------------------------------------------------------------------------------------------------------------
# dressing
# ---------------------------------------------------------------------------------------------------------------------
def rot_pos(p):
    return (-p[0], p[1], -p[2])


def rot_heading(hd):
    return (hd + 180) % 360


def dress(kit: LayoutKit, areas, buildings, terraces):
    rnd = random.Random(2024)
    props = []
    occupied = []

    def free(x, z, rad):
        return all((x - ox) ** 2 + (z - oz) ** 2 >= (rad + orr) ** 2 for ox, oz, orr in occupied)

    def add(ptype, pos, heading, mirror=True):
        sx, _, sz = PROPS[ptype]["size"]
        props.append({"type": ptype, "pos": [round(pos[0], 3), round(pos[1], 3), round(pos[2], 3)], "heading": heading % 360})
        occupied.append((pos[0], pos[2], max(sx, sz) * 0.55))
        if mirror:
            rp = rot_pos(pos)
            props.append({"type": ptype, "pos": [round(rp[0], 3), round(rp[1], 3), round(rp[2], 3)], "heading": rot_heading(heading)})
            occupied.append((rp[0], rp[2], max(sx, sz) * 0.55))

    for ptype, pos, hd in MANUAL_PROPS:
        add(ptype, pos, hd, mirror=abs(pos[0]) + abs(pos[2]) > 0.1)

    # keep doorways, stairs and spawn exits clear
    for b in buildings:
        x0, z0, x1, z1 = b["rect"]
        for d in b.get("doors", []):
            side, at = d["side"], d["at"]
            px, pz = (x0 + at, z0 - 1.0) if side == "n" else (x0 + at, z1 + 1.0) if side == "s" else \
                (x0 - 1.0, z0 + at) if side == "w" else (x1 + 1.0, z0 + at)
            occupied.append((px, pz, d["width"] / 2 + 0.9))
        for it in b.get("interiors", []):
            for d in it["doors"]:
                rx0, rz0, rx1, rz1 = d["rect"]
                occupied.append(((rx0 + rx1) / 2, (rz0 + rz1) / 2, 2.6))
    for t in terraces:
        x0, z0, x1, z1 = t["rect"]
        for st in t["stairs"]:
            mid = (st["from"] + st["to"]) / 2
            cx, cz = {"n": (mid, z0 - 1.2), "s": (mid, z1 + 1.2), "w": (x0 - 1.2, mid), "e": (x1 + 1.2, mid)}[st["side"]]
            occupied.append((cx, cz, 2.2))

    # clutter along open facades: pallets, drums, IBCs next to doors and against walls
    clusters = [["pallet_stack"], ["pallet_goods", "pallet_wrapped"], ["drum_group"], ["oil_drum", "oil_drum_red"], ["ibc_tank"],
                ["crate_large"], ["tire_stack"], ["pallet_wrapped"], ["electrical_cabinet"]]
    for b in buildings:
        if b["type"] in ("backdrop", "chimney", "tank"):
            continue
        x0, z0, x1, z1 = b["rect"]
        for side in SIDES:
            samples = kit.side_samples(b["rect"], side)
            t = 1.5
            while t < len(samples) - 1.5:
                sx, sz = samples[int(t)]
                k, a = kit.classify(sx, sz)
                if k != "open" or a.kind in ("spawn",) or rnd.random() > 0.3:
                    t += 2.5
                    continue
                ox, oz = SIDE_OUT[side]
                clear = 0
                while clear < 7 and kit.classify(sx + ox * clear, sz + oz * clear)[0] == "open":
                    clear += 1
                if clear < 5:
                    t += 2.0
                    continue
                kind = rnd.choice(clusters)
                along_x, along_z = (1, 0) if side in ("n", "s") else (0, 1)
                base_x = (x0 + t) if side in ("n", "s") else (x0 if side == "w" else x1)
                base_z = (z0 if side == "n" else z1) if side in ("n", "s") else z0 + t
                cursor = 0.0
                placed = False
                for ptype in kind:
                    sxz = PROPS[ptype]["size"]
                    depth = sxz[2]
                    cx = base_x + along_x * cursor + ox * (depth / 2 + 0.05)
                    cz = base_z + along_z * cursor + oz * (depth / 2 + 0.05)
                    if not free(cx, cz, max(sxz[0], depth) * 0.55) or kit.classify(cx, cz)[0] != "open":
                        break
                    add(ptype, (cx, kit.ground(cx, cz), cz), SIDE_HEADING[side] + rnd.choice((0, 0, 4, -6, 90)), mirror=False)
                    cursor += sxz[0] * 0.5 + 0.5
                    placed = True
                t += 7.0 if placed else 2.5

    # warehouse interiors: racking along the long walls, goods and a forklift in the aisle
    for b in buildings:
        for it in b.get("interiors", []):
            cx0, cz0, cx1, cz1 = it["rect"]
            along_x = (cx1 - cx0) >= (cz1 - cz0)
            L = (cx1 - cx0) if along_x else (cz1 - cz0)
            n = int((L - 5.0) // 2.9)
            door_pos = [((d["rect"][0] + d["rect"][2]) / 2, (d["rect"][1] + d["rect"][3]) / 2) for d in it["doors"]]
            for i in range(n):
                s = (cx0 if along_x else cz0) + 2.5 + 1.45 + i * 2.9
                for wall_side in (0, 1):
                    if along_x:
                        z = cz0 + 0.6 if wall_side == 0 else cz1 - 0.6
                        pos, hd = (s, 0.0, z), 0
                    else:
                        x = cx0 + 0.6 if wall_side == 0 else cx1 - 0.6
                        pos, hd = (x, 0.0, s), 90
                    if any(math.hypot(pos[0] - dx, pos[2] - dz) < 3.2 for dx, dz in door_pos):
                        continue
                    if free(pos[0], pos[2], 1.2):
                        add("shelving_rack", pos, hd, mirror=False)
            mx, mz = (cx0 + cx1) / 2, (cz0 + cz1) / 2
            if free(mx, mz, 1.6):
                add("pallet_goods", (mx + (1.5 if along_x else 0), 0.0, mz + (0 if along_x else 1.5)), 0 if along_x else 90, mirror=False)

    # floodlight poles at yard corners
    for a in areas:
        if a.kind != "yard" or (a.x1 - a.x0) * (a.z1 - a.z0) < 60:
            continue
        for (x, z) in ((a.x0 + 0.6, a.z0 + 0.6), (a.x1 - 0.6, a.z1 - 0.6)):
            if free(x, z, 0.6) and kit.classify(x, z)[0] == "open":
                add("floodlight_pole", (x, a.height, z), 135 if x < 0 else 315, mirror=False)
                break

    targets = []
    for pos, hd in TARGETS:
        targets.append({"id": f"T{len(targets) + 1:02d}", "pos": list(pos), "heading": hd})
        targets.append({"id": f"T{len(targets) + 1:02d}", "pos": list(rot_pos(pos)), "heading": rot_heading(hd)})
    lights = []  # free-for-all: no team lights at the old spawn yards
    arches = []
    for aid, (x0, z0, x1, z1), spring, style in ARCHES:
        for suffix, rr in (("", (x0, z0, x1, z1)), ("r", (-x1, -z1, -x0, -z0))):
            arches.append({"id": aid + suffix, "rect": list(rr), "spring": spring, "style": style,
                           "axis": "x" if (rr[2] - rr[0]) > (rr[3] - rr[1]) else "z"})
    return {"props": props, "targets": targets, "lights": lights, "arches": arches, "obstacles": []}


def build():
    areas = mirror_all(AREAS)
    kit = LayoutKit(areas, PLAY, OUTER, lot_max=16)
    rects = kit.split_lots(kit.decompose())
    kit.set_lots(rects)
    order = sorted(range(len(rects)), key=lambda i: ((rects[i][1] + rects[i][3]) // 8, rects[i][0]))
    buildings, walls = [], []
    for i in order:
        kind, entry = make_building(kit, kit.lot_info(rects[i]), len(buildings) + 1)
        if kind == "wall":
            entry["id"] = f"W{len(walls) + 1:02d}"
            walls.append(entry)
        else:
            entry["id"] = f"I{len(buildings) + 1:02d}"
            buildings.append(entry)
    terraces = kit.terraces(rise=0.2, run=0.3, style_of=lambda a: {"dock": "dock", "platform": "platform"}.get(a.kind))
    covered = []
    for b in buildings:
        for it in b.get("interiors", []):
            covered.append({"id": it["id"], "kind": "interior", "rect": it["rect"]})
            for k, d in enumerate(it["doors"]):
                covered.append({"id": f"{it['id']}_door{k}", "kind": "doorway", "rect": d["rect"]})
    covered += [c for c in covered_floor(areas) if c["kind"] == "passage"]
    dressing = dress(kit, areas, buildings, terraces)
    layout = {
        "id": "industrial-complex", "name": "Industrial Complex", "version": 1, "style": "industrial",
        "units": "metres; +x east, +z south, +y up (glTF / Babylon right-handed). Rects are [x0, z0, x1, z1].",
        "playArea": [-PLAY, -PLAY, PLAY, PLAY], "outerLimit": OUTER,
        "ground": {"baseHeight": 0.0, "zones": ground_zones(areas, material_of), "covered": covered},
        "terraces": terraces, "buildings": buildings, "walls": walls, **dressing,
    }
    # free-for-all spawn points over the whole map (clear of the props and targets placed above)
    layout["spawns"] = ffa_spawns(layout, PROPS)
    return kit, layout


if __name__ == "__main__":
    kit, layout = build()
    print(json.dumps(kit.metrics(), indent=1))
    from collections import Counter
    print("buildings:", len(layout["buildings"]), dict(Counter(b["type"] for b in layout["buildings"])), "walls:", len(layout["walls"]))
    print("props:", len(layout["props"]), "targets:", len(layout["targets"]), "terraces:", len(layout["terraces"]))
    print("plan:", kit.render(PLAN, layout["buildings"], layout["walls"], layout["props"], layout["targets"], layout["terraces"]))
    if "--write" in sys.argv:
        LAYOUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        LAYOUT_JSON.write_text(json.dumps(layout, indent=1), encoding="utf-8")
        print("wrote", LAYOUT_JSON)
