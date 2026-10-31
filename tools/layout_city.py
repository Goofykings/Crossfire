"""Modern City layout designer.

Authors the walkable network (narrow roads, sidewalks, back alleys, courtyards, a small plaza, lobby passages and
walk-through shops) as asymmetric loops for small matches, decomposes the rest into
city lots and writes src/maps/modern-city/layout.json (the canonical, hand-editable map data).

Roads are authored full width; sidewalks (raised 0.15 m) are added automatically along the stretches of each road edge
that face buildings, so junctions and alley mouths stay open and get curbs at the strip ends.

Usage:
    python -I tools/layout_city.py           # metrics + plan image (docs/modern-city-plan.png)
    python -I tools/layout_city.py --write   # also (re)generate layout.json
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I does not add the script's folder
from layoutkit import SIDE_OUT, SIDES, Area, LayoutKit, covered_floor, ground_zones, inside  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LAYOUT_JSON = ROOT / "src" / "maps" / "modern-city" / "layout.json"
PLAN = ROOT / "docs" / "modern-city-plan.png"
sys.path.insert(0, str(ROOT / "blender" / "scripts" / "lib"))
import building_spec as bs  # noqa: E402
from catalog import PROPS  # noqa: E402
from spawn_points import ffa_spawns  # noqa: E402

PLAY = 27
OUTER = 36
WALL = 0.3
SIDEWALK = 1.6
CURB_H = 0.15

# ---------------------------------------------------------------------------------------------------------------------
# Compact, asymmetric walkable network (normal metre-scale streets and lots).
from compact_layouts import city as authored_routes

AREAS = authored_routes(Area)

# overhead canopies across alleys: (id, rect, spring height, style); rotated copies are added
ARCHES = [
    ("court_canopy", (16,-11,19,-10),3.6,"canopy"),
]

# (type, (x, y, z), heading) at authored landmarks, without mirroring.
MANUAL_PROPS = [
    ("planter_long", (0,0,-4.7),0),
    ("bench_modern", (0,0,-3.65),180),
    ("cafe_set", (-4.5,0,3.5),0),
    ("bench_modern", (4.8,0,3.6),270),
    ("cafe_board", (14.4,0,-7.8),0),
    ("utility_box", (8.1,0,-13.3),0),
    ("dumpster_blue", (15,0,-13.6),0),
    ("trash_bags", (15,0,-11.5),0),
    # The old courtyard location crowded the walk-through shop entrance.
    ("bike_rack", (14,0,24),0),
    ("planter", (-7.5,0,10.5),90),
    ("trash_bin_grey", (-4,0,14),0),
    ("dumpster", (-20.1,0,-6),90),
    ("utility_box", (17.4,0,13.5),90),
    ("bench_modern", (7.4,0,16.4),90),
    ("planter", (12,0,16.6),0),
]




def material_of(a: Area) -> str:
    return {"street": "asphalt_fine", "alley": "concrete_floor", "court": "pavers", "plaza": "granite", "spawn": "pavers",
            "sidewalk": "pavers", "yard": "concrete_floor"}.get(a.kind, "concrete_floor")


# ---------------------------------------------------------------------------------------------------------------------
# sidewalks
# ---------------------------------------------------------------------------------------------------------------------
def add_sidewalks(areas: list[Area]) -> list[Area]:
    """Raised strips along road edges that face building mass (never across a junction or an alley mouth)."""
    kit = LayoutKit(areas, PLAY, OUTER)
    out = []
    for a in areas:
        sides = a.extra.get("sidewalks", "")
        if a.kind != "street" or not sides:
            continue
        r = (int(a.x0), int(a.z0), int(a.x1), int(a.z1))
        for side in sides:
            samples = kit.side_samples(r, side)
            base = r[0] if side in ("n", "s") else r[1]
            mass = [kit.area_at(x + 0.5, z + 0.5) is None for (x, z) in samples]
            i = 0
            k = 0
            while i < len(mass):
                if not mass[i]:
                    i += 1
                    continue
                j = i
                while j < len(mass) and mass[j]:
                    j += 1
                lo, hi = base + i, base + j
                if hi - lo >= 2:
                    rect = {"n": (lo, a.z0, hi, a.z0 + SIDEWALK), "s": (lo, a.z1 - SIDEWALK, hi, a.z1),
                            "w": (a.x0, lo, a.x0 + SIDEWALK, hi), "e": (a.x1 - SIDEWALK, lo, a.x1, hi)}[side]
                    # Covered routes take precedence over raised pavement. A strip over a
                    # lobby used to split its lot and put curbs across the doorway.
                    covered = [c for c in areas if c.kind in ('passage','interior','room')]
                    if not any(rect[0]<c.x1 and c.x0<rect[2] and rect[1]<c.z1 and c.z0<rect[3] for c in covered):
                        out.append(Area(f"{a.id}_sw{side}{k}", "sidewalk", *rect, height=CURB_H, material="pavers"))
                    k += 1
                i = j
    return areas + out


# ---------------------------------------------------------------------------------------------------------------------
# lots -> buildings
# ---------------------------------------------------------------------------------------------------------------------
PALETTES = {
    "apartment": ["brick_red", "brick_brown", "brick_pale", "brick_orange", "brick_dark", "stucco_cream"],
    "commercial": ["concrete", "concrete_warm", "clad_white", "clad_slate", "clad_sage", "tiles"],
    "storefront": ["stucco_cream", "stucco_peach", "stucco_sky", "stucco_olive", "brick_orange", "stucco_grey"],
    "corner": ["stucco_peach", "brick_red", "stucco_sky", "concrete_warm"],
    "garage": ["concrete", "brick_dark", "concrete_warm"],
    "backdrop": ["concrete", "concrete_warm", "brick_brown", "clad_slate", "brick_pale", "tiles"],
}
STREET_KINDS = ("street", "sidewalk", "plaza", "court", "spawn")


def info_front(info):
    """Side facing the most street / sidewalk / plaza frontage (alleys count less)."""
    def score(s):
        street = sum(1 for a in info["faces"][s] if a is not None and a.kind in STREET_KINDS)
        return (street, info["runs"][s][0], s)
    return max(SIDES, key=score)


def faces_kind(info, side, kinds):
    return any(a is not None and a.kind in kinds for a in info["faces"][side])


def door_spots(info, side, count, width, avoid):
    run, start = info["runs"][side]
    if run < width + 1.2:
        return []
    out = []
    usable = run - 1.0
    n = min(count, max(1, int(usable // (width + 1.4))))
    for i in range(n):
        at = start + 0.5 + usable * (i + 0.5) / n
        if any(a0 - width / 2 - 0.4 < at < a1 + width / 2 + 0.4 for (a0, a1) in avoid):
            continue
        out.append(round(at * 2) / 2)
    return out


def make_building(kit: LayoutKit, info, extra_zones: list):
    r = info["rect"]
    x0, z0, x1, z1 = r
    w, d = x1 - x0, z1 - z0
    h = info["hash"]
    covered = info["covered"]
    for a in covered:
        if not inside(a, r):
            print(f"LAYOUT PROBLEM: covered area {a.id} split by lot {r}")
    if min(w, d) <= 2 or w * d <= 6:
        style = "railing" if any(faces_kind(info, s, ("court", "plaza")) for s in SIDES) else "brick"
        if max(w, d) <= 2:
            style = "pillar"
        return "wall", {"rect": [x0, z0, x1, z1], "height": 1.4 if style == "railing" else 2.6, "style": style,
                        "gates": [{"rect": [a.x0, a.z0, a.x1, a.z1]} for a in covered]}
    front = info_front(info)
    street_front = faces_kind(info, front, STREET_KINDS)
    area = w * d
    if info["backdrop"]:
        btype = "backdrop"
    elif any(a.kind == "interior" for a in covered):
        btype = "storefront" if area < 90 else "commercial"
    elif any(a.kind == "passage" for a in covered):
        btype = "apartment"
    elif not street_front:
        btype = "garage" if area < 110 and h % 3 != 0 else "apartment"
    else:
        def in_play(k):
            cx = x0 if "w" in k else x1
            cz = z0 if "n" in k else z1
            return -PLAY < cx < PLAY and -PLAY < cz < PLAY

        corners_on_street = [k for k, a in info["corners"].items() if a is not None and a.kind in ("sidewalk", "street") and in_play(k)]
        if corners_on_street and area >= 40 and h % 3 == 0:
            btype = "corner"
        elif area >= 120:
            btype = "commercial" if h % 2 else "apartment"
        elif area >= 50:
            btype = ("apartment", "apartment", "storefront", "commercial")[h % 4]
        else:
            btype = "storefront"
    floors = {"backdrop": 6 + h % 5, "apartment": 3 + h % 3, "commercial": 3 + h % 2, "storefront": 2 + h % 2, "corner": 3 + h % 2,
              "garage": 1}[btype]
    if info["perimeter"] and btype in ("storefront", "garage"):
        btype, floors = "apartment", 4
    height = 4.2 if btype == "garage" else bs.city_height(floors)
    pals = PALETTES[btype]
    b = {"id": "", "type": btype, "rect": [x0, z0, x1, z1], "height": round(height, 2), "floors": floors,
         "palette": pals[(h >> 4) % len(pals)], "seed": h % 9973, "roof": {"type": "flat"}, "front": front, "doors": []}
    if btype == "backdrop":
        return "building", b
    if btype == "corner":
        k = corners_on_street[0]
        b["chamfer"] = {"corner": k, "size": 3.0}
        # keep the cut-off corner at sidewalk level (it would otherwise be a pit at road level beside the curb)
        cx0 = x0 if "w" in k else x1 - 3
        cz0 = z0 if "n" in k else z1 - 3
        extra_zones.append(Area(f"chamfer_{x0}_{z0}", "sidewalk", cx0, cz0, cx0 + 3, cz0 + 3, height=CURB_H, material="pavers"))
    avoid = {s: [] for s in SIDES}
    interiors = []
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
            best, cur, best_end = 0, 0, -1
            for i, (sx, sz) in enumerate(kit.side_samples(r, side)):
                pos = base + i
                k, outside = kit.classify(sx, sz)
                # Covered alleys/interiors are valid approaches too. Ignoring
                # them sealed the west shop passage against an uncut wall.
                ok = lo <= pos < hi and k in ("open", "covered") and outside.height <= CURB_H + 0.01
                cur = cur + 1 if ok else 0
                if cur > best:
                    best, best_end = cur, i
            if best < 2:
                continue
            c = base + best_end - best + 1 + best / 2
            dw = 1.8
            rect = {"n": [c - dw / 2, z0, c + dw / 2, cav[1]], "s": [c - dw / 2, cav[3], c + dw / 2, z1],
                    "w": [x0, c - dw / 2, cav[0], c + dw / 2], "e": [cav[2], c - dw / 2, x1, c + dw / 2]}[side]
            doors.append({"side": side, "rect": [round(v, 3) for v in rect], "height": 2.6, "kind": "doorway"})
            avoid[side].append((c - base - dw / 2, c - base + dw / 2))
        if len(doors) < 2:
            print(f"LAYOUT PROBLEM: interior {a.id} has {len(doors)} doorway(s); walk-throughs need two")
        interiors.append({"id": a.id, "rect": [round(v, 3) for v in cav], "clear": 3.3, "doors": doors})
    if interiors:
        b["interiors"] = interiors
    passages = [a for a in covered if a.kind == "passage"]
    if passages:
        b["passages"] = [{"rect": [a.x0, a.z0, a.x1, a.z1], "style": "portal", "clear": 3.4} for a in passages]
        for a in passages:
            for side in SIDES:
                lo, hi = (a.x0 - x0, a.x1 - x0) if side in ("n", "s") else (a.z0 - z0, a.z1 - z0)
                avoid[side].append((lo, hi))
    for side in sorted(SIDES, key=lambda s: -info["runs"][s][0]):
        run, start = info["runs"][side]
        if run < 3:
            continue
        on_street = faces_kind(info, side, STREET_KINDS)
        if btype == "garage" and not on_street:
            for at in door_spots(info, side, 3, 2.8, avoid[side]):
                b["doors"].append({"side": side, "at": at, "width": 2.8, "kind": "garage"})
                avoid[side].append((at - 1.4, at + 1.4))
        elif on_street and btype in ("storefront", "commercial", "corner") or (on_street and btype == "apartment" and side == front):
            if btype != "apartment" or h % 2 == 0:
                for at in door_spots(info, side, 2 if run > 11 else 1, 3.8, avoid[side]):
                    b["doors"].append({"side": side, "at": at, "width": 3.8, "kind": "store"})
                    avoid[side].append((at - 1.9, at + 1.9))
            if btype in ("apartment", "commercial") and side == front:
                for at in door_spots(info, side, 1, 1.8, avoid[side]):
                    b["doors"].append({"side": side, "at": at, "width": 1.8, "kind": "entrance"})
                    avoid[side].append((at - 0.9, at + 0.9))
        elif not on_street and run >= 3:
            for at in door_spots(info, side, 1, 1.0, avoid[side]):
                b["doors"].append({"side": side, "at": at, "width": 1.0, "kind": "door"})
                avoid[side].append((at - 0.8, at + 0.8))
        if len(b["doors"]) >= 5:
            break
    return "building", b


# ---------------------------------------------------------------------------------------------------------------------
# dressing
# ---------------------------------------------------------------------------------------------------------------------
def rot_pos(p):
    return (-p[0], p[1], -p[2])


def rot_heading(hd):
    return (hd + 180) % 360


def dress(kit: LayoutKit, areas, buildings, terraces):
    rnd = random.Random(77)
    props, occupied, poles = [], [], []
    on_road = []  # parked cars only need to clear each other and props standing in the road

    def free(x, z, rad):
        return all((x - ox) ** 2 + (z - oz) ** 2 >= (rad + orr) ** 2 for ox, oz, orr in occupied)

    def road_free(x, z, rad):
        return all((x - ox) ** 2 + (z - oz) ** 2 >= (rad + orr) ** 2 for ox, oz, orr in on_road)

    def add(ptype, pos, heading, mirror=False):
        sx, _, sz = PROPS[ptype]["size"]
        props.append({"type": ptype, "pos": [round(pos[0], 3), round(pos[1], 3), round(pos[2], 3)], "heading": heading % 360})
        occupied.append((pos[0], pos[2], max(sx, sz) * 0.55))
        if mirror:
            rp = rot_pos(pos)
            props.append({"type": ptype, "pos": [round(rp[0], 3), round(rp[1], 3), round(rp[2], 3)], "heading": rot_heading(heading)})
            occupied.append((rp[0], rp[2], max(sx, sz) * 0.55))

    for b in buildings:
        x0, z0, x1, z1 = b["rect"]
        for dd in b.get("doors", []):
            side, at = dd["side"], dd["at"]
            # keep a strip about 1 m deep clear in front of the door (a row of small circles), not a big disc
            ox, oz = SIDE_OUT[side]
            n = max(2, int(dd["width"] / 0.7) + 1)
            for i in range(n):
                along = -dd["width"] / 2 + dd["width"] * i / (n - 1)
                bx, bz = (x0 + at + along, z0 if side == "n" else z1) if side in ("n", "s") else (x0 if side == "w" else x1, z0 + at + along)
                occupied.append((bx + ox * 0.55, bz + oz * 0.55, 0.5))
        for it in b.get("interiors", []):
            for dd in it["doors"]:
                rx0, rz0, rx1, rz1 = dd["rect"]
                occupied.append(((rx0 + rx1) / 2, (rz0 + rz1) / 2, 2.0))
    for t in terraces:
        x0, z0, x1, z1 = t["rect"]
        for st in t["stairs"]:
            mid = (st["from"] + st["to"]) / 2
            cx, cz = {"n": (mid, z0 - 1.2), "s": (mid, z1 + 1.2), "w": (x0 - 1.2, mid), "e": (x1 + 1.2, mid)}[st["side"]]
            occupied.append((cx, cz, 2.2))
    for ptype, pos, hd in MANUAL_PROPS:
        add(ptype, pos, hd, mirror=False)
        for q in ((pos[0], pos[2]), (-pos[0], -pos[2])):
            on_road.append((q[0], q[1], 1.5))

    # street furniture on sidewalks: lights and hydrants at the curb, bins and boxes against the wall
    for a in areas:
        if a.kind != "sidewalk":
            continue
        along_x = (a.x1 - a.x0) >= (a.z1 - a.z0)
        L = (a.x1 - a.x0) if along_x else (a.z1 - a.z0)
        if L < 4:
            continue
        # which long edge is the curb (faces the road)?
        if along_x:
            curb_n = kit.classify(a.x0 + L / 2, a.z0 - 0.5)[0] == "open" and (kit.area_at(a.x0 + L / 2, a.z0 - 0.5) or a).kind == "street"
            curb_z = a.z0 + 0.35 if curb_n else a.z1 - 0.35
            wall_z = a.z1 - 0.35 if curb_n else a.z0 + 0.35
            face = 0 if curb_n else 180
        else:
            curb_w = kit.classify(a.x0 - 0.5, a.z0 + L / 2)[0] == "open" and (kit.area_at(a.x0 - 0.5, a.z0 + L / 2) or a).kind == "street"
            curb_x = a.x0 + 0.35 if curb_w else a.x1 - 0.35
            wall_x = a.x1 - 0.35 if curb_w else a.x0 + 0.35
            face = 270 if curb_w else 90
        n = max(1, int(L // 11))
        for i in range(n):
            t = (i + 0.5) / n
            for shift in (0.0, 1.2, -1.2, 2.4, -2.4):
                s = min(max(L * t + shift, 0.5), L - 0.5)
                pos = (a.x0 + s, CURB_H, curb_z) if along_x else (curb_x, CURB_H, a.z0 + s)
                if free(pos[0], pos[2], 0.35):
                    add("streetlight", pos, face, mirror=False)
                    break
        for _ in range(int(L // 6)):
            s = rnd.uniform(0.8, L - 0.8)
            ptype = rnd.choice(("trash_bin", "newspaper_box", "trash_bin_grey", "fire_hydrant", "bike_rack", "planter"))
            if ptype in ("fire_hydrant",):
                pos = (a.x0 + s, CURB_H, curb_z) if along_x else (curb_x, CURB_H, a.z0 + s)
            else:
                pos = (a.x0 + s, CURB_H, wall_z) if along_x else (wall_x, CURB_H, a.z0 + s)
            rad = max(PROPS[ptype]["size"][0], PROPS[ptype]["size"][2]) * 0.55 + 0.3
            if free(pos[0], pos[2], rad):
                add(ptype, pos, face + (0 if along_x else 0) + 180, mirror=False)

    # parked cars along road curbs (one lane), leaving gaps at junctions
    cars = ("car_red", "car_blue", "car_silver", "car_black", "car_white", "van_white")
    for a in areas:
        if a.kind != "sidewalk" or not a.id.split("_sw")[0]:
            continue
        road = next((r for r in areas if r.id == a.id.split("_sw")[0]), None)
        if road is None or road.kind != "street":
            continue
        along_x = (a.x1 - a.x0) >= (a.z1 - a.z0)
        L = (a.x1 - a.x0) if along_x else (a.z1 - a.z0)
        rw = (road.z1 - road.z0) if along_x else (road.x1 - road.x0)
        if L < 6 or rw - SIDEWALK * len(road.extra.get("sidewalks", "")) < 4.4:
            continue  # no room for a parked car and a lane beside it
        # the curb is the strip's edge toward the road's middle
        if along_x:
            north = abs(a.z0 - road.z0) < 1e-6
            cz = a.z1 + 1.05 if north else a.z0 - 1.05
        else:
            west = abs(a.x0 - road.x0) < 1e-6
            cx = a.x1 + 1.05 if west else a.x0 - 1.05
        s = 1.5
        while s + 4.8 < L - 0.5:
            if rnd.random() < 0.6:
                ptype = rnd.choice(cars)
                if along_x:
                    pos, hd = (a.x0 + s + 2.4, 0.0, cz), (90 if north else 270)
                else:
                    pos, hd = (cx, 0.0, a.z0 + s + 2.4), (180 if west else 0)
                if road_free(pos[0], pos[2], 2.6):
                    add(ptype, pos, hd + rnd.choice((0, 0, 2, -3)), mirror=False)
                    on_road.append((pos[0], pos[2], 2.6))
                    s += 6.2
                    continue
            s += 2.5

    # alleys: dumpsters, bags, AC units, utility poles (with wires between consecutive poles)
    for a in areas:
        if a.kind != "alley":
            continue
        along_x = (a.x1 - a.x0) >= (a.z1 - a.z0)
        L = (a.x1 - a.x0) if along_x else (a.z1 - a.z0)
        width = (a.z1 - a.z0) if along_x else (a.x1 - a.x0)
        if L < 5:
            continue
        line = []
        n = max(1, int(L // 8) + (1 if L >= 8 else 0))
        for i in range(n):
            s = (i + 0.5) * L / n
            pos = (a.x0 + s, 0.0, a.z0 + 0.25) if along_x else (a.x0 + 0.25, 0.0, a.z0 + s)
            if free(pos[0], pos[2], 0.5):
                add("utility_pole", pos, 0 if along_x else 90, mirror=False)
                line.append(pos)
        for p, q in zip(line, line[1:]):
            poles.append({"a": [p[0], 8.4, p[2]], "b": [q[0], 8.4, q[2]], "sag": 0.5})
        if width >= 3.5:
            for _ in range(2):
                s = rnd.uniform(1.0, L - 1.0)
                ptype = rnd.choice(("dumpster", "trash_bags", "ac_condenser", "pallet_stack", "dumpster_blue"))
                sx, _, sz = PROPS[ptype]["size"]
                off = sz / 2 + 0.05
                pos = (a.x0 + s, 0.0, a.z1 - off) if along_x else (a.x1 - off, 0.0, a.z0 + s)
                if free(pos[0], pos[2], max(sx, sz) * 0.55 + 0.4):
                    add(ptype, pos, 180 if along_x else 90, mirror=False)

    # walk-through shops and the diner: tables and chairs along the walls, a planter, a bin by a door
    for b in buildings:
        for it in b.get("interiors", []):
            cx0, cz0, cx1, cz1 = it["rect"]
            if cx1 - cx0 < 3.6 or cz1 - cz0 < 3.6:
                continue
            spots = [(cx0 + 1.0, cz0 + 1.0), (cx1 - 1.0, cz1 - 1.0), (cx1 - 1.0, cz0 + 1.0), (cx0 + 1.0, cz1 - 1.0)]
            placed = 0
            for (x, z) in spots:
                if placed < 2 and free(x, z, 0.85):
                    add("cafe_set", (x, 0.0, z), rnd.choice((0, 30, 60)), mirror=False)
                    placed += 1
            for (x, z) in spots:
                if free(x, z, 0.5):
                    add("planter", (x, 0.0, z), 0 if (cx1 - cx0) > (cz1 - cz0) else 90, mirror=False)
                    break

    targets = []
    lights = []  # free-for-all: no team lights at the old spawn yards
    arches = []
    for aid, (x0, z0, x1, z1), spring, style in ARCHES:
        for suffix, rr in (("", (x0, z0, x1, z1)), ("r", (-x1, -z1, -x0, -z0))):
            arches.append({"id": aid + suffix, "rect": list(rr), "spring": spring, "style": style,
                           "axis": "x" if (rr[2] - rr[0]) > (rr[3] - rr[1]) else "z"})
    return {"props": props, "targets": targets, "lights": lights, "arches": arches, "obstacles": [], "wires": poles}


def build():
    areas = add_sidewalks(list(AREAS))
    kit = LayoutKit(areas, PLAY, OUTER, lot_max=14)
    rects = kit.split_lots(kit.decompose())
    kit.set_lots(rects)
    order = sorted(range(len(rects)), key=lambda i: ((rects[i][1] + rects[i][3]) // 8, rects[i][0]))
    buildings, walls, extra_zones = [], [], []
    for i in order:
        kind, entry = make_building(kit, kit.lot_info(rects[i]), extra_zones)
        if kind == "wall":
            entry["id"] = f"W{len(walls) + 1:02d}"
            walls.append(entry)
        else:
            entry["id"] = f"C{len(buildings) + 1:02d}"
            buildings.append(entry)
    all_areas = areas + extra_zones
    kit.areas = all_areas
    terraces = kit.terraces(rise=0.18, run=0.3, style_of=lambda a: "sidewalk" if a.kind == "sidewalk" else None)
    covered = []
    for b in buildings:
        for it in b.get("interiors", []):
            covered.append({"id": it["id"], "kind": "interior", "rect": it["rect"]})
            for k, dd in enumerate(it["doors"]):
                covered.append({"id": f"{it['id']}_door{k}", "kind": "doorway", "rect": dd["rect"]})
    covered += [c for c in covered_floor(all_areas) if c["kind"] == "passage"]
    dressing = dress(kit, all_areas, buildings, terraces)
    layout = {
        "id": "modern-city", "name": "Modern City", "version": 1, "style": "modern",
        "units": "metres; +x east, +z south, +y up (glTF / Babylon right-handed). Rects are [x0, z0, x1, z1].",
        "playArea": [-PLAY, -PLAY, PLAY, PLAY], "outerLimit": OUTER,
        "ground": {"baseHeight": 0.0, "zones": ground_zones(all_areas, material_of), "covered": covered},
        "terraces": terraces, "buildings": buildings, "walls": walls, **dressing,
    }
    # free-for-all spawn points over the whole map (clear of the props and targets placed above)
    from upper_routes import make_route
    from compact_dressing import finish_layout
    layout['upperRoutes'] = [make_route('second_floor_passage', [-14,5,-11,22], 'sky_passage')]
    finish_layout(layout, PROPS)
    layout["spawns"] = ffa_spawns(layout, PROPS)
    return kit, layout


if __name__ == "__main__":
    kit, layout = build()
    print(json.dumps(kit.metrics(), indent=1))
    from collections import Counter
    print("buildings:", len(layout["buildings"]), dict(Counter(b["type"] for b in layout["buildings"])), "walls:", len(layout["walls"]))
    print("props:", len(layout["props"]), "targets:", len(layout["targets"]), "terraces:", len(layout["terraces"]),
          "wires:", len(layout["wires"]))
    print("plan:", kit.render(PLAN, layout["buildings"], layout["walls"], layout["props"], layout["targets"], layout["terraces"]))
    if "--write" in sys.argv:
        LAYOUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        LAYOUT_JSON.write_text(json.dumps(layout, indent=1), encoding="utf-8")
        print("wrote", LAYOUT_JSON)
