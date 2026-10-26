"""European Town layout bootstrapper.

Authors the walkable network (streets, yards, courtyards, passages, terraces) as rectangles,
mirrors it with 180-degree rotational symmetry so both spawns get equivalent routes, and
renders a top-down plan with gameplay metrics.

This is a design aid; the canonical, hand-editable map data is
src/maps/european-town/layout.json (written by `--write`).

Usage:
    python -I tools/layout_design.py                 # render plan + metrics only
    python -I tools/layout_design.py --write         # also (re)generate layout.json
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT_PNG = ROOT / "docs" / "european-town-plan.png"
LAYOUT_JSON = ROOT / "src" / "maps" / "european-town" / "layout.json"

HALF = 35  # map spans [-35, 35] on x and z (metres). +x = east, +z = south on the plan.


@dataclass
class Area:
    id: str
    kind: str  # street | yard | court | plaza | spawn | passage | terrace
    x0: float
    z0: float
    x1: float
    z1: float
    height: float = 0.0  # floor height for terraces
    team: str | None = None
    center: bool = False  # self-symmetric item, not rotated
    extra: dict = field(default_factory=dict)

    def rotated(self, suffix: str = "r") -> "Area":
        team = {"blue": "red", "red": "blue"}.get(self.team or "", self.team)
        return Area(self.id + suffix, self.kind, -self.x1, -self.z1, -self.x0, -self.z0, self.height, team,
                    False, dict(self.extra))


# ----------------------------------------------------------------------------------------------
# Walkable network, authored for the north half + west part of the centre band.
# Everything here is rotated 180 degrees about the origin to produce the other half.
# ----------------------------------------------------------------------------------------------
AREAS: list[Area] = [
    # Blue spawn yard (west edge). Rotation produces the red spawn on the east edge.
    Area("spawn_blue", "spawn", -33, -7, -25, 7, team="blue"),
    # Spawn exits (north exit on the west side; the south exit comes from rotating red's north exit)
    Area("blue_exit_n", "street", -33, -11, -29, -7),
    Area("blue_arch", "passage", -25, 0, -21, 3),
    # North-west loop
    Area("nw_a", "street", -33, -15, -25, -11),
    Area("nw_b", "street", -29, -27, -25, -11),
    Area("nw_c", "street", -33, -31, -14, -27),
    Area("nw_d", "street", -18, -27, -14, -15),
    Area("nw_e", "street", -21, -15, -6, -11),
    Area("cw_a", "street", -10, -11, -6, -5),
    # Blue gate yard behind the arch, with its north exit
    Area("blue_yard", "yard", -21, -5, -15, 4),
    Area("blue_yard_n", "street", -21, -11, -18, -5),
    Area("west_entry", "street", -15, -5, -5, -1),
    # North lane (raised terrace in the middle, reached by steps at both ends)
    Area("n_lane_mid", "terrace", -14, -27, 4, -23, height=0.72),
    Area("n_jog2", "street", 4, -31, 8, -23),
    Area("n_lane_e", "street", 8, -31, 20, -27),
    Area("n_jog3", "street", 16, -27, 20, -17),
    Area("ne_lane", "street", 20, -24, 29, -20),
    # Centre-north access into the plaza, plus a walk-through ground-floor hall
    Area("cn_a", "street", -4, -23, 0, -17),
    Area("cn_b", "street", -4, -17, 8, -13),
    Area("cn_c", "street", 1, -13, 5, -5),
    Area("cn_room", "room", -14, -21, -4, -18),
    Area("ne_link", "street", 8, -20, 12, -13),
    Area("ne_arch", "passage", 12, -20, 16, -17),
    # Red side north flank (becomes blue's south flank after rotation)
    Area("red_exit_n", "street", 25, -11, 29, -7),
    Area("e_edge", "street", 29, -24, 33, -9),
    Area("ne_mid", "street", 15, -13, 29, -9),
    Area("red_yard_n", "street", 15, -9, 18, -4),
    Area("ne_court", "court", 22, -32, 30, -26, height=0.54),
    Area("ne_court_gate_s", "passage", 24, -26, 27, -24),
    Area("ne_court_gate_w", "passage", 20, -30, 22, -28),
    # Centre plaza (self-symmetric)
    Area("plaza", "plaza", -5, -5, 5, 5, center=True),
]

# Decorative / gameplay obstacle in the plaza centre (well). Not walkable.
OBSTACLES = [(-1.2, -1.2, 1.2, 1.2)]


def all_areas() -> list[Area]:
    out: list[Area] = []
    for a in AREAS:
        out.append(a)
        if not a.center:
            out.append(a.rotated())
    return out


def rasterize(areas: list[Area]):
    n = HALF * 2
    grid = [[0] * n for _ in range(n)]  # 0 = building mass, 1 = walkable, 2 = passage(covered)
    kinds = [[None] * n for _ in range(n)]
    for a in areas:
        for zi in range(n):
            zc = zi - HALF + 0.5
            if not (a.z0 < zc < a.z1):
                continue
            for xi in range(n):
                xc = xi - HALF + 0.5
                if a.x0 < xc < a.x1:
                    grid[zi][xi] = 2 if a.kind in ("passage", "room") else 1
                    kinds[zi][xi] = a
    for (x0, z0, x1, z1) in OBSTACLES:
        for zi in range(n):
            for xi in range(n):
                xc, zc = xi - HALF + 0.5, zi - HALF + 0.5
                if x0 < xc < x1 and z0 < zc < z1:
                    grid[zi][xi] = 0
                    kinds[zi][xi] = None
    return grid, kinds


def metrics(grid):
    n = len(grid)
    walk = [[grid[z][x] > 0 for x in range(n)] for z in range(n)]
    # connectivity
    start = next((x, z) for z in range(n) for x in range(n) if walk[z][x])
    seen = {start}
    stack = [start]
    while stack:
        x, z = stack.pop()
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, nz = x + dx, z + dz
            if 0 <= nx < n and 0 <= nz < n and walk[nz][nx] and (nx, nz) not in seen:
                seen.add((nx, nz))
                stack.append((nx, nz))
    total = sum(sum(r) for r in walk)
    # corners: count 2x2 windows with exactly 1 or 3 walkable cells (convex/concave corners)
    corners = 0
    for z in range(n - 1):
        for x in range(n - 1):
            s = walk[z][x] + walk[z][x + 1] + walk[z + 1][x] + walk[z + 1][x + 1]
            if s in (1, 3):
                corners += 1
    # longest axis-aligned clear run
    longest = 0
    for z in range(n):
        run = 0
        for x in range(n):
            run = run + 1 if walk[z][x] else 0
            longest = max(longest, run)
    for x in range(n):
        run = 0
        for z in range(n):
            run = run + 1 if walk[z][x] else 0
            longest = max(longest, run)
    # sightlines: sample random walkable points, cast 32 rays, record max visible distance
    import random
    rnd = random.Random(7)
    pts = [(x, z) for z in range(n) for x in range(n) if walk[z][x]]
    sight = []
    for _ in range(600):
        x, z = rnd.choice(pts)
        best = 0.0
        for k in range(32):
            ang = k * math.pi / 16
            dx, dz = math.cos(ang), math.sin(ang)
            t = 0.0
            while True:
                t += 0.25
                px, pz = x + 0.5 + dx * t, z + 0.5 + dz * t
                ix, iz = int(math.floor(px)), int(math.floor(pz))
                if not (0 <= ix < n and 0 <= iz < n) or not walk[iz][ix]:
                    break
            best = max(best, t)
        sight.append(best)
    sight.sort()
    runs = []
    for z in range(n):
        x = 0
        while x < n:
            if walk[z][x]:
                x0 = x
                while x < n and walk[z][x]:
                    x += 1
                runs.append((x - x0, f"row z={z - HALF}..{z - HALF + 1} x={x0 - HALF}..{x - HALF}"))
            x += 1
    for x in range(n):
        z = 0
        while z < n:
            if walk[z][x]:
                z0 = z
                while z < n and walk[z][x]:
                    z += 1
                runs.append((z - z0, f"col x={x - HALF}..{x - HALF + 1} z={z0 - HALF}..{z - HALF}"))
            z += 1
    runs.sort(reverse=True)
    thin = []
    inside = lambda x, z: -33 <= x - HALF and x - HALF < 33 and -33 <= z - HALF and z - HALF < 33
    for z in range(n):
        for x in range(n):
            if walk[z][x] or not inside(x, z):
                continue
            def run(dx, dz):
                k = 0
                cx, cz = x, z
                while 0 <= cx < n and 0 <= cz < n and not walk[cz][cx] and inside(cx, cz):
                    k += 1; cx += dx; cz += dz
                # touching the boundary means a perimeter building that extends outward
                edge = not (0 <= cx < n and 0 <= cz < n) or not inside(cx, cz)
                return k, edge
            (a1, e1), (a2, e2) = run(1, 0), run(-1, 0)
            (b1, f1), (b2, f2) = run(0, 1), run(0, -1)
            hx = a1 + a2 - 1 if not (e1 or e2) else 99
            hz = b1 + b2 - 1 if not (f1 or f2) else 99
            if min(hx, hz) < 4:
                thin.append((x - HALF, z - HALF, min(hx, hz)))
    comps = []
    rest = {(x, z) for z in range(n) for x in range(n) if walk[z][x]} - seen
    while rest:
        p = rest.pop(); comp = [p]; st = [p]
        while st:
            cx, cz = st.pop()
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (cx + dx, cz + dz)
                if q in rest:
                    rest.remove(q); comp.append(q); st.append(q)
        comps.append((len(comp), comp[0][0] - HALF, comp[0][1] - HALF))
    return {
        "islands": comps,
        "thin_cells(<4m)": len(thin),
        "thin_sample": thin[:: max(1, len(thin) // 12)][:12],
        "top_runs": [r[1] + f" ({r[0]}m)" for r in runs[:6]],
        "walkable_m2": total,
        "connected": len(seen) == total,
        "reachable_m2": len(seen),
        "corner_vertices": corners,
        "longest_axis_run_m": longest,
        "median_max_sightline_m": round(sight[len(sight) // 2], 1),
        "p90_max_sightline_m": round(sight[int(len(sight) * 0.9)], 1),
    }


def render(areas, grid, kinds, buildings=None, path=OUT_PNG, scale=12):
    n = len(grid)
    pad = (OUTER - HALF) * scale
    img = Image.new("RGB", (n * scale + 2 * pad, n * scale + 2 * pad), (28, 30, 36))
    base = img
    img = Image.new("RGB", (n * scale, n * scale), (40, 44, 52))
    d = ImageDraw.Draw(img)
    colors = {
        "street": (205, 198, 182),
        "yard": (214, 205, 180),
        "court": (190, 210, 170),
        "plaza": (230, 214, 170),
        "spawn": None,
        "passage": (160, 140, 120),
        "room": (150, 120, 150),
        "terrace": (225, 185, 140),
    }
    for z in range(n):
        for x in range(n):
            a = kinds[z][x]
            if a is None:
                continue
            c = colors.get(a.kind)
            if a.kind == "spawn":
                c = (120, 160, 230) if a.team == "blue" else (230, 120, 120)
            d.rectangle([x * scale, z * scale, (x + 1) * scale - 1, (z + 1) * scale - 1], fill=c)
    # grid lines every 5 m
    for i in range(0, n + 1, 5):
        d.line([(i * scale, 0), (i * scale, n * scale)], fill=(70, 74, 82))
        d.line([(0, i * scale), (n * scale, i * scale)], fill=(70, 74, 82))
    for (x0, z0, x1, z1) in OBSTACLES:
        d.ellipse([(x0 + HALF) * scale, (z0 + HALF) * scale, (x1 + HALF) * scale, (z1 + HALF) * scale],
                  fill=(90, 120, 160))
    base.paste(img, (pad, pad))
    d = ImageDraw.Draw(base)
    if buildings:
        for b in buildings:
            x0 = (b["x"] - b["w"] / 2 + OUTER) * scale
            z0 = (b["z"] - b["d"] / 2 + OUTER) * scale
            x1 = (b["x"] + b["w"] / 2 + OUTER) * scale
            z1 = (b["z"] + b["d"] / 2 + OUTER) * scale
            d.rectangle([x0, z0, x1 - 1, z1 - 1], outline=(250, 250, 250), width=1)
            d.text((x0 + 3, z0 + 2), b["id"], fill=(255, 255, 160))
    path.parent.mkdir(parents=True, exist_ok=True)
    base.save(path)
    return path


# ----------------------------------------------------------------------------------------------
# Building lots: decompose the solid mass (everything that is not open walkable ground, plus a
# backdrop band outside the playable edge) into rectangles, then split long rectangles into
# townhouse-sized lots.
# ----------------------------------------------------------------------------------------------
PLAY = 33       # playable edge (street faces of perimeter buildings)
OUTER = 40      # backdrop buildings extend to here
MAX_SIDE = 99
LOT_MAX = 11      # split rectangles whose side exceeds this into townhouse lots


def mass_grid(areas):
    n = OUTER * 2
    open_ = [[False] * n for _ in range(n)]
    for a in areas:
        if a.kind in ("passage", "room"):
            continue  # covered ground belongs to the building above it
        for zi in range(n):
            zc = zi - OUTER + 0.5
            if a.z0 < zc < a.z1:
                for xi in range(n):
                    xc = xi - OUTER + 0.5
                    if a.x0 < xc < a.x1:
                        open_[zi][xi] = True
    # plaza well is a prop, not a building
    return [[not open_[z][x] for x in range(n)] for z in range(n)]


def largest_rect(mass):
    n = len(mass)
    best = (0, None)
    heights = [0] * n
    for z in range(n):
        for x in range(n):
            heights[x] = heights[x] + 1 if mass[z][x] else 0
        stack = []
        for x in range(n + 1):
            h = heights[x] if x < n else 0
            start = x
            while stack and stack[-1][1] >= h:
                sx, sh = stack.pop()
                w = x - sx
                hh = min(sh, MAX_SIDE)
                ww = min(w, MAX_SIDE)
                area = hh * ww
                if area > best[0]:
                    best = (area, (sx, z - hh + 1, ww, hh))
                start = sx
            stack.append((start, h))
    return best[1]


def greedy_rects(mass):
    n = len(mass)
    rects = []
    while True:
        r = largest_rect(mass)
        if r is None:
            break
        x, z, w, h = r
        for zz in range(z, z + h):
            for xx in range(x, x + w):
                mass[zz][xx] = False
        rects.append((x - OUTER, z - OUTER, x - OUTER + w, z - OUTER + h))
    return rects


def decompose(areas):
    """Interior blocks first, then extend edge blocks outward, then fill the backdrop band."""
    full = mass_grid(areas)
    n = len(full)
    inside = lambda xi, zi: -PLAY <= xi - OUTER < PLAY and -PLAY <= zi - OUTER < PLAY
    interior = [[full[z][x] and inside(x, z) for x in range(n)] for z in range(n)]
    rects = absorb_slivers(greedy_rects(interior))
    # extend blocks that touch the playable edge out to the backdrop limit
    ext = []
    for (x0, z0, x1, z1) in rects:
        if x0 == -PLAY: x0 = -OUTER
        if x1 == PLAY: x1 = OUTER
        if z0 == -PLAY: z0 = -OUTER
        if z1 == PLAY: z1 = OUTER
        ext.append((x0, z0, x1, z1))
    # fill whatever band remains (corners, behind street ends)
    band = [[full[z][x] and not inside(x, z) for x in range(n)] for z in range(n)]
    for (x0, z0, x1, z1) in ext:
        for zi in range(max(0, z0 + OUTER), min(n, z1 + OUTER)):
            for xi in range(max(0, x0 + OUTER), min(n, x1 + OUTER)):
                band[zi][xi] = False
    rest = absorb_slivers(greedy_rects(band))
    return ext + rest


def absorb_slivers(rects):
    """Merge rectangles thinner than 2 m into a neighbour sharing their full long edge."""
    changed = True
    while changed:
        changed = False
        for i, r in enumerate(rects):
            w, d = r[2] - r[0], r[3] - r[1]
            if min(w, d) >= 2:
                continue
            for j, o in enumerate(rects):
                if i == j:
                    continue
                merged = None
                if r[0] == o[0] and r[2] == o[2] and (r[1] == o[3] or r[3] == o[1]):
                    merged = (r[0], min(r[1], o[1]), r[2], max(r[3], o[3]))
                elif r[1] == o[1] and r[3] == o[3] and (r[0] == o[2] or r[2] == o[0]):
                    merged = (min(r[0], o[0]), r[1], max(r[2], o[2]), r[3])
                if merged:
                    rects[j] = merged
                    rects.pop(i)
                    changed = True
                    break
            if changed:
                break
    return rects


def split_lots(rects, areas):
    """Split long rectangles into lots, never cutting through a passage or room."""
    import random
    covered = [a for a in areas if a.kind in ("passage", "room")]
    out = []
    for r in rects:
        work = [r]
        while work:
            q = work.pop()
            w, d = q[2] - q[0], q[3] - q[1]
            axis = 0 if w >= d else 1
            # buildings reaching the backdrop limit are split along the edge they front
            if q[0] == -OUTER or q[2] == OUTER:
                axis = 1 if not (q[1] == -OUTER or q[3] == OUTER) else axis
            elif q[1] == -OUTER or q[3] == OUTER:
                axis = 0
            length = w if axis == 0 else d
            if length <= LOT_MAX or (min(w, d) <= 2):
                out.append(q)
                continue
            rnd = random.Random(int((q[0] * 73 + q[1] * 31 + w * 7 + d) * 1000) & 0xFFFF)
            k = max(2, round(length / 8))
            base = (q[0] if axis == 0 else q[1])
            cut = base + round(length / k) + rnd.choice((-1, 0, 0, 1))
            # move the cut out of covered passages
            for a in covered:
                lo, hi = (a.x0, a.x1) if axis == 0 else (a.z0, a.z1)
                olo, ohi = (a.z0, a.z1) if axis == 0 else (a.x0, a.x1)
                qlo, qhi = (q[1], q[3]) if axis == 0 else (q[0], q[2])
                if olo < qhi and qlo < ohi and lo < cut < hi:
                    cut = math.floor(lo) if cut - lo < hi - cut else math.ceil(hi)
            if not (base + 3 <= cut <= base + length - 3):
                out.append(q)
                continue
            if axis == 0:
                work += [(q[0], q[1], cut, q[3]), (cut, q[1], q[2], q[3])]
            else:
                work += [(q[0], q[1], q[2], cut), (q[0], cut, q[2], q[3])]
    return out


def overlaps(r, a):
    return r[0] < a.x1 and a.x0 < r[2] and r[1] < a.z1 and a.z0 < r[3]


def is_backdrop(r):
    """Entirely outside the playable square: never seen up close."""
    return r[2] <= -PLAY or r[0] >= PLAY or r[3] <= -PLAY or r[1] >= PLAY


# ----------------------------------------------------------------------------------------------
# layout.json emission
# ----------------------------------------------------------------------------------------------
sys.path.insert(0, str(ROOT / "blender" / "scripts" / "lib"))
from catalog import PALETTES  # noqa: E402,F401

STEP_RISE = 0.18
STEP_RUN = 0.32
SIDES = ("n", "e", "s", "w")


class World:
    """Grid lookups (1 m cells over [-OUTER, OUTER]) used while emitting the layout."""

    def __init__(self, areas, rects):
        self.n = OUTER * 2
        self.cell_area = [[None] * self.n for _ in range(self.n)]
        for a in areas:
            for zi in range(self.n):
                zc = zi - OUTER + 0.5
                if a.z0 < zc < a.z1:
                    for xi in range(self.n):
                        xc = xi - OUTER + 0.5
                        if a.x0 < xc < a.x1:
                            self.cell_area[zi][xi] = a
        self.cell_lot = [[None] * self.n for _ in range(self.n)]
        for i, r in enumerate(rects):
            for zi in range(r[1] + OUTER, r[3] + OUTER):
                for xi in range(r[0] + OUTER, r[2] + OUTER):
                    if 0 <= xi < self.n and 0 <= zi < self.n:
                        self.cell_lot[zi][xi] = i

    def classify(self, x, z):
        """Classify the 1 m cell whose min corner is (x, z): open | covered | building | outside."""
        xi, zi = int(math.floor(x)) + OUTER, int(math.floor(z)) + OUTER
        if not (0 <= xi < self.n and 0 <= zi < self.n):
            return "outside", None
        a = self.cell_area[zi][xi]
        if a is not None:
            return ("covered" if a.kind in ("passage", "room") else "open"), a
        if not (-PLAY <= x < PLAY and -PLAY <= z < PLAY):
            return "outside", None
        return "building", self.cell_lot[zi][xi]

    @staticmethod
    def side_samples(r, side):
        x0, z0, x1, z1 = r
        if side == "n":
            return [(x, z0 - 1) for x in range(x0, x1)]
        if side == "s":
            return [(x, z1) for x in range(x0, x1)]
        if side == "w":
            return [(x0 - 1, z) for z in range(z0, z1)]
        return [(x1, z) for z in range(z0, z1)]


def longest_run(flags):
    best, cur, best_end = 0, 0, -1
    for i, f in enumerate(flags):
        cur = cur + 1 if f else 0
        if cur > best:
            best, best_end = cur, i
    return best, best_end - best + 1


def external_corners(world, r):
    """Building corners whose three outside neighbour cells are all open ground."""
    x0, z0, x1, z1 = r
    probes = {"nw": ((x0 - 1, z0 - 1), (x0 - 1, z0), (x0, z0 - 1)),
              "ne": ((x1, z0 - 1), (x1, z0), (x1 - 1, z0 - 1)),
              "se": ((x1, z1), (x1, z1 - 1), (x1 - 1, z1)),
              "sw": ((x0 - 1, z1), (x0 - 1, z1 - 1), (x0, z1))}
    res = {}
    for k, cells in probes.items():
        cls = [world.classify(*c) for c in cells]
        if all(c[0] == "open" for c in cls):
            res[k] = cls[0][1].kind
    return res


def stable_hash(text):
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def choose_type(world, r, inside, exp, open_len, corners, h):
    rooms = [a for a in inside if a.kind == "room"]
    passages = [a for a in inside if a.kind == "passage"]
    w, d = r[2] - r[0], r[3] - r[1]
    if sum(open_len.values()) == 0:
        return "backdrop"
    if rooms:
        return "room"
    if passages:
        # a lot that is nothing but the passage is a bridge building spanning the lane
        bridge = any((a.x1 - a.x0) * (a.z1 - a.z0) >= w * d - 0.01 for a in passages)
        return "archway" if bridge or min(w, d) > 5 else "narrow_passage"
    if "plaza" in corners.values():
        return "corner"
    faces_square = any(k == "open" and world.classify(x, z)[1].kind in ("plaza", "yard")
                       for s in SIDES for (x, z), k in zip(World.side_samples(r, s), exp[s]))
    if faces_square and h % 3 != 0:
        return "shop"
    if corners and h % 9 == 0:
        return "corner"
    pool = ["stone2", "plaster3", "plaster3", "stone2", "balcony", "shop"]
    btype = pool[h % len(pool)]
    if btype in ("balcony", "shop") and max(open_len.values()) < 5:
        btype = "stone2" if btype == "shop" else "plaster3"
    return btype


def emit_layout(areas, rects):
    world = World(areas, rects)
    covered = [a for a in areas if a.kind in ("passage", "room")]
    buildings, walls, problems = [], [], []
    type_counts: dict[str, int] = {}
    # number lots north-west first so ids read naturally on the plan
    order = sorted(range(len(rects)), key=lambda i: ((rects[i][1] + rects[i][3]) // 8, rects[i][0]))
    for i in order:
        r = rects[i]
        x0, z0, x1, z1 = r
        w, d = x1 - x0, z1 - z0
        inside = [a for a in covered if overlaps(r, a)]
        for a in inside:
            if not (x0 <= a.x0 and a.x1 <= x1 and z0 <= a.z0 and a.z1 <= z1):
                problems.append(f"passage {a.id} split by lot {r}")
        if min(w, d) <= 2 or w * d <= 6:
            walls.append({"id": f"W{len(walls) + 1:02d}", "rect": [x0, z0, x1, z1],
                          "height": 3.6 if max(w, d) > 2 else 4.4,
                          "style": "stone" if max(w, d) > 2 else "pillar",
                          "gates": [{"rect": [a.x0, a.z0, a.x1, a.z1]} for a in inside]})
            continue
        exp = {s: [world.classify(x, z)[0] for (x, z) in World.side_samples(r, s)] for s in SIDES}
        open_len = {s: exp[s].count("open") for s in SIDES}
        h = stable_hash(f"{x0},{z0},{x1},{z1}")
        corners = external_corners(world, r)
        perimeter = x0 <= -PLAY or x1 >= PLAY or z0 <= -PLAY or z1 >= PLAY
        btype = choose_type(world, r, inside, exp, open_len, corners, h)
        floors = {"stone2": 2, "plaster3": 3, "shop": 2 + (h >> 3) % 2, "corner": 3, "narrow_passage": 4,
                  "archway": 3, "balcony": 3, "room": 2, "backdrop": 3 + (h >> 5) % 2}[btype]
        if perimeter and btype != "backdrop":
            floors = max(floors, 3)
        if btype == "stone2":
            palette = ("stone_warm", "stone_grey", "stone_blocks")[(h >> 4) % 3]
        elif btype == "room":
            palette = "brick_old"
        elif btype in ("narrow_passage", "archway"):
            palette = ("stone_warm", "stone_grey", "plaster_worn")[(h >> 4) % 3]
        else:
            palette = ("plaster_white", "plaster_beige", "plaster_ochre", "plaster_rose", "plaster_red",
                       "plaster_worn", "plaster_beige", "stone_warm")[(h >> 4) % 8]
        runs = {s: longest_run([k == "open" for k in exp[s]]) for s in SIDES}
        front = max(SIDES, key=lambda s: (runs[s][0], s))
        doors = []
        if btype != "backdrop":
            for side in sorted(SIDES, key=lambda s: -runs[s][0]):
                run, start = runs[side]
                if run < 3:
                    continue
                length = w if side in ("n", "s") else d
                along = min(max(start + run / 2, 1.2), length - 1.2)
                doors.append({"side": side, "at": round(along * 2) / 2,
                              "width": 1.6 if btype in ("shop", "corner") and side == front else 1.1})
                if len(doors) >= (2 if w * d > 50 else 1):
                    break
        bld = {"id": f"B{len(buildings) + 1:02d}", "type": btype, "rect": [x0, z0, x1, z1], "floors": floors,
               "palette": palette, "seed": h % 9973,
               "roof": {"type": "hip" if btype == "corner" or (abs(w - d) <= 1 and h % 2) else "gable",
                        "ridge": "x" if w >= d else "z"},
               "front": front, "doors": doors}
        passages = [a for a in inside if a.kind == "passage"]
        rooms = [a for a in inside if a.kind == "room"]
        if passages:
            bld["passages"] = [{"rect": [a.x0, a.z0, a.x1, a.z1],
                                "style": "lintel" if btype == "narrow_passage" else "arch", "clear": 3.2}
                               for a in passages]
        if rooms:
            bld["rooms"] = [{"rect": [a.x0, a.z0, a.x1, a.z1], "clear": 3.0} for a in rooms]
        if btype == "corner":
            pick = [k for k, v in corners.items() if v == "plaza"] or list(corners) or ["se"]
            bld["chamfer"] = {"corner": pick[0], "size": 2.0}
        if btype == "balcony":
            bld["balcony"] = {"side": front, "floor": 1}
        if btype == "shop":
            bld["shopfront"] = {"side": front}
        buildings.append(bld)
        type_counts[btype] = type_counts.get(btype, 0) + 1

    terraces = []
    for a in areas:
        if not (a.kind == "terrace" or (a.kind == "court" and a.height > 0)):
            continue
        r = (int(a.x0), int(a.z0), int(a.x1), int(a.z1))
        stairs = []
        for side in SIDES:
            flags = []
            for (x, z) in World.side_samples(r, side):
                k, other = world.classify(x, z)
                flags.append(k in ("open", "covered") and other is not None and other.height < a.height - 0.05)
            i = 0
            while i < len(flags):
                if not flags[i]:
                    i += 1
                    continue
                j = i
                while j < len(flags) and flags[j]:
                    j += 1
                base = r[0] if side in ("n", "s") else r[1]
                steps = max(1, round(a.height / STEP_RISE))
                stairs.append({"side": side, "from": base + i, "to": base + j, "steps": steps,
                               "rise": round(a.height / steps, 4), "run": STEP_RUN})
                i = j
        terraces.append({"id": a.id, "rect": [a.x0, a.z0, a.x1, a.z1], "height": a.height, "stairs": stairs})

    material = {"street": "cobble", "yard": "cobble", "court": "slabs", "plaza": "slabs", "spawn": "slabs",
                "terrace": "cobble"}
    # free-for-all: the old spawn yards are ordinary (paved) yards
    zones = [{"id": a.id, "kind": "yard" if a.kind == "spawn" else a.kind, "rect": [a.x0, a.z0, a.x1, a.z1],
              "height": a.height, "material": material[a.kind]}
             for a in areas if a.kind not in ("passage", "room")]
    covered_floor = [{"id": a.id, "kind": a.kind, "rect": [a.x0, a.z0, a.x1, a.z1]} for a in covered]

    dressing = dress(world, areas, buildings, terraces)
    if problems:
        print("LAYOUT PROBLEMS:\n  " + "\n  ".join(problems))
    print("building types:", dict(sorted(type_counts.items())))
    layout = {
        "id": "european-town",
        "name": "European Town",
        "version": 1,
        "units": "metres; +x east, +z south, +y up (glTF / Babylon right-handed). Rects are [x0, z0, x1, z1].",
        "playArea": [-PLAY, -PLAY, PLAY, PLAY],
        "outerLimit": OUTER,
        "ground": {"baseHeight": 0.0, "zones": zones, "covered": covered_floor},
        "terraces": terraces,
        "buildings": buildings,
        "walls": walls,
        **dressing,
    }
    # free-for-all spawn points over the whole map (they keep clear of the props and targets placed above)
    layout["spawns"] = ffa_spawns(layout, PROPS)
    return layout


# ----------------------------------------------------------------------------------------------
# Set dressing: flying arches, props, lanterns, lights and practice targets.
# Hand-placed items are authored for one half and rotated like the street network.
# Headings are compass degrees: 0 = facing north (-z), 90 = east (+x).
# ----------------------------------------------------------------------------------------------
from catalog import PROPS  # noqa: E402
from spawn_points import ffa_spawns  # noqa: E402

SIDE_HEADING = {"n": 0, "e": 90, "s": 180, "w": 270}

# (x0, z0, x1, z1) span across a lane, plus springing height; rotated copies are added.
ARCHES = [
    ("arch_nw_b", (-29, -21.4, -25, -20.6)),
    ("arch_cn_a", (-4, -20.4, 0, -19.6)),
    ("arch_e_edge", (29, -16.4, 33, -15.6)),
    ("arch_nw_e", (-12.4, -15, -11.6, -11)),
]

MANUAL_PROPS = [
    # plaza: market stall against the north frontage, benches facing the well
    ("market_stall", (-2.6, 0, -4.15), 180),
    # clear of the door in B42's east face (z 2.45..3.55)
    ("bench", (-4.3, 0, 1.2), 90),
    # gate yards: a hand cart for cover
    ("cart", (-16.4, 0, 1.9), 0),
    ("crate_stack", (-20.2, 0, -4.2), 90),
    # raised court: stall, bench, fenced herb garden
    ("market_stall", (25.0, 0.54, -31.15), 180),
    # against the garden wall north of its gate (the gate and its stairs are at z -30..-28)
    ("bench", (22.45, 0.54, -31.1), 90),
    ("fence", (29.0, 0.54, -30.0), 0),
    ("fence_gate", (28.0, 0.54, -31.0), 270),
    ("flower_pot_large", (29.1, 0.54, -31.2), 0),
    ("flower_pot", (29.4, 0.54, -30.5), 0),
    # (free-for-all: no safe zones, so no zone signage or barriers)
]

STREET_LANTERNS = [(-4.3, 0, -4.3), (4.3, 0, -4.3), (-20.4, 0, 3.4), (22.6, 0.54, -26.6)]

TARGETS = [
    ((-31.2, 0, -29.0), 90), ((-27.0, 0, -25.0), 180), ((-16.0, 0, -16.2), 0), ((-8.0, 0, -9.8), 180),
    ((-9.0, 0.72, -25.0), 90), ((28.6, 0.54, -28.6), 270), ((31.0, 0, -22.6), 180), ((10.0, 0, -19.0), 180),
    ((18.0, 0, -25.6), 180), ((-18.0, 0, -2.0), 270), ((-31.6, 0, 5.4), 90), ((-3.6, 0, -3.6), 135),
]


def rot_pos(p):
    return (-p[0], p[1], -p[2])


def rot_heading(hd):
    return (hd + 180) % 360


def dress(world, areas, buildings, terraces):
    import random
    rnd = random.Random(1337)
    occupied: list[tuple[float, float, float]] = []  # (x, z, radius)

    def free(x, z, r):
        return all((x - ox) ** 2 + (z - oz) ** 2 >= (r + orr) ** 2 for ox, oz, orr in occupied)

    def near_stairs(x, z, margin=1.6):
        for t in terraces:
            x0, z0, x1, z1 = t["rect"]
            for st in t["stairs"]:
                depth = st["steps"] * st["run"]
                if st["side"] == "n":
                    r = (st["from"], z0, st["to"], z0 + depth)
                elif st["side"] == "s":
                    r = (st["from"], z1 - depth, st["to"], z1)
                elif st["side"] == "w":
                    r = (x0, st["from"], x0 + depth, st["to"])
                else:
                    r = (x1 - depth, st["from"], x1, st["to"])
                if r[0] - margin < x < r[2] + margin and r[1] - margin < z < r[3] + margin:
                    return True
        return False

    def ground(x, z):
        k, a = world.classify(x, z)
        return a.height if (k == "open" and a is not None) else 0.0

    props, lights = [], []

    def add(ptype, pos, heading, mirror=True):
        props.append({"type": ptype, "pos": [round(pos[0], 3), round(pos[1], 3), round(pos[2], 3)],
                      "heading": heading % 360})
        sx, _, sz = PROPS[ptype]["size"]
        occupied.append((pos[0], pos[2], max(sx, sz) * 0.55))
        if mirror:
            mtype = {"sign_blue": "sign_red"}.get(ptype, ptype)
            rp = rot_pos(pos)
            props.append({"type": mtype, "pos": [round(rp[0], 3), round(rp[1], 3), round(rp[2], 3)],
                          "heading": rot_heading(heading)})
            occupied.append((rp[0], rp[2], max(sx, sz) * 0.55))

    # reserve the well and keep spawn exits / arches clear
    occupied.append((0.0, 0.0, 1.6))
    for ptype, pos, hd in MANUAL_PROPS:
        add(ptype, pos, hd)
    for pos in STREET_LANTERNS:
        add("street_lantern", pos, 0)

    # doors: keep clear, sometimes flank with flower pots
    door_spots = []
    for b in buildings:
        x0, z0, x1, z1 = b["rect"]
        for door in b["doors"]:
            side, at = door["side"], door["at"]
            if side in ("n", "s"):
                px, pz = x0 + at, (z0 - 0.4 if side == "n" else z1 + 0.4)
                tx, tz = 1, 0
            else:
                px, pz = (x0 - 0.4 if side == "w" else x1 + 0.4), z0 + at
                tx, tz = 0, 1
            door_spots.append((px, pz, side, tx, tz, door["width"], b))
    for (px, pz, side, tx, tz, width, b) in door_spots:
        kind = world.classify(px, pz)
        if kind[0] != "open" or kind[1].kind == "spawn":
            occupied.append((px, pz, 1.2))
            continue
        if rnd.random() < 0.45:
            off = width / 2 + 0.42
            ny = ground(px, pz)
            for sgn in (-1, 1):
                qx, qz = px + tx * off * sgn, pz + tz * off * sgn
                qx += (-0.0 if side in ("n", "s") else 0)
                if world.classify(qx, qz)[0] == "open" and free(qx, qz, 0.25) and not near_stairs(qx, qz, 0.6):
                    add("flower_pot", (qx, ny, qz), SIDE_HEADING[side], mirror=False)
        occupied.append((px, pz, 1.05))

    # clutter clusters along open facades
    clusters = [["barrel_group"], ["crate", "crate_small"], ["crate_stack"], ["barrel", "crate"],
                ["flower_pot_large"], ["barrel"], ["crate"]]
    for b in buildings:
        if b["type"] == "backdrop":
            continue
        x0, z0, x1, z1 = b["rect"]
        for side in SIDES:
            samples = World.side_samples((x0, z0, x1, z1), side)
            t = 1.5
            length = len(samples)
            while t < length - 1.5:
                sx, sz = samples[int(t)]
                k, a = world.classify(sx, sz)
                if k != "open" or a.kind in ("spawn", "plaza", "terrace") or rnd.random() > 0.38:
                    t += 2.5
                    continue
                kind = rnd.choice(clusters)
                # street clearance: keep at least 3 m of open ground in front of the cluster
                ox, oz = {"n": (0, -1), "s": (0, 1), "w": (-1, 0), "e": (1, 0)}[side]
                clear = 0
                while clear < 6 and world.classify(sx + ox * clear, sz + oz * clear)[0] == "open":
                    clear += 1
                if clear < 4:
                    t += 2.0
                    continue
                along_x, along_z = (1, 0) if side in ("n", "s") else (0, 1)
                base_x = (x0 + t) if side in ("n", "s") else (x0 - 0.0 if side == "w" else x1)
                base_z = (z0 if side == "n" else z1) if side in ("n", "s") else z0 + t
                cursor = 0.0
                placed = False
                for ptype in kind:
                    sxz = PROPS[ptype]["size"]
                    depth = sxz[2]
                    cx = base_x + along_x * cursor + ox * (depth / 2 + 0.04)
                    cz = base_z + along_z * cursor + oz * (depth / 2 + 0.04)
                    if not free(cx, cz, max(sxz[0], depth) * 0.55) or near_stairs(cx, cz):
                        break
                    if world.classify(cx, cz)[0] != "open":
                        break
                    heading = SIDE_HEADING[side] + rnd.choice((0, 0, 7, -9, 15))
                    add(ptype, (cx, ground(cx, cz), cz), heading, mirror=False)
                    cursor += sxz[0] * 0.5 + 0.45
                    placed = True
                t += 7.0 if placed else 2.5

    # furnish the walk-through halls: table + stools against one long wall, crates/barrel in corners
    import building_spec as bspec
    for b in buildings:
        for room in b.get("rooms", []):
            (cx0, cz0, cx1, cz1), _ = bspec.room_layout(b, room)
            along_x = (cx1 - cx0) >= (cz1 - cz0)
            if along_x:
                mid = (cx0 + cx1) / 2
                add("table", (mid, 0.02, cz0 + 0.45), 0, mirror=False)
                for dx in (-0.5, 0.5):
                    add("stool", (mid + dx, 0.02, cz0 + 1.15), 0, mirror=False)
                add("crate_small", (cx0 + 0.6, 0.02, cz1 - 0.38), 0, mirror=False)
                add("barrel", (cx1 - 0.6, 0.02, cz0 + 0.38), 0, mirror=False)
                add("crate", (cx1 - 0.65, 0.02, cz1 - 0.45), 10, mirror=False)
            else:
                mid = (cz0 + cz1) / 2
                add("table", (cx0 + 0.45, 0.02, mid), 90, mirror=False)
                for dz in (-0.5, 0.5):
                    add("stool", (cx0 + 1.15, 0.02, mid + dz), 90, mirror=False)
                add("crate_small", (cx1 - 0.38, 0.02, cz0 + 0.6), 0, mirror=False)
                add("barrel", (cx0 + 0.38, 0.02, cz1 - 0.6), 0, mirror=False)

    # wall lanterns at external street corners
    lantern_count = 0
    for b in buildings:
        if b["type"] == "backdrop" or lantern_count >= 34:
            continue
        r = tuple(b["rect"])
        for corner in external_corners(world, r):
            if (stable_hash(b["id"] + corner) % 3) != 0:
                continue
            x0, z0, x1, z1 = r
            cx = x0 if "w" in corner else x1
            cz = z0 if "n" in corner else z1
            # mount on the longer adjacent face, 0.8 m in from the corner
            if (x1 - x0) >= (z1 - z0):
                side = "n" if "n" in corner else "s"
                px = cx + (0.8 if "w" in corner else -0.8)
                pz = cz + (-0.02 if side == "n" else 0.02)
            else:
                side = "w" if "w" in corner else "e"
                pz = cz + (0.8 if "n" in corner else -0.8)
                px = cx + (-0.02 if side == "w" else 0.02)
            if b.get("chamfer") and b["chamfer"]["corner"] == corner:
                continue
            gy = ground(px + (0.5 if side == "e" else -0.5 if side == "w" else 0),
                        pz + (0.5 if side == "s" else -0.5 if side == "n" else 0))
            props.append({"type": "wall_lantern", "pos": [round(px, 3), round(gy + 3.0, 3), round(pz, 3)],
                          "heading": SIDE_HEADING[side]})
            lantern_count += 1

    # drain grates along long street centrelines
    for a in areas:
        if a.kind not in ("street",):
            continue
        w, d = a.x1 - a.x0, a.z1 - a.z0
        if max(w, d) < 7:
            continue
        n = int(max(w, d) // 7)
        for i in range(n):
            f = (i + 0.5) / n
            gx = a.x0 + w * f if w >= d else (a.x0 + a.x1) / 2
            gz = (a.z0 + a.z1) / 2 if w >= d else a.z0 + d * f
            if free(gx, gz, 0.6) and not near_stairs(gx, gz, 0.8):
                props.append({"type": "drain_grate", "pos": [round(gx, 2), a.height + 0.004, round(gz, 2)],
                              "heading": 0 if w >= d else 90})


    targets = []
    for i, (pos, hd) in enumerate(TARGETS):
        targets.append({"id": f"T{len(targets) + 1:02d}", "pos": list(pos), "heading": hd})
        targets.append({"id": f"T{len(targets) + 1:02d}", "pos": list(rot_pos(pos)), "heading": rot_heading(hd)})

    arches = []
    for aid, (x0, z0, x1, z1) in ARCHES:
        for suffix, rr in (("", (x0, z0, x1, z1)), ("r", (-x1, -z1, -x0, -z0))):
            arches.append({"id": aid + suffix, "rect": list(rr), "spring": 3.4,
                           "axis": "x" if (rr[2] - rr[0]) > (rr[3] - rr[1]) else "z"})

    print(f"dressing: {len(props)} props, {len(targets)} targets, {len(arches)} arches, {len(lights)} lights")
    return {"arches": arches, "props": props, "lights": lights, "targets": targets,
            "obstacles": [{"type": "well", "pos": [0.0, 0.0, 0.0], "heading": 0}]}


if __name__ == "__main__":
    areas = all_areas()
    grid, kinds = rasterize(areas)
    m = metrics(grid)
    print(json.dumps({k: v for k, v in m.items() if k != "thin_sample"}, indent=1))
    rects = split_lots(decompose(areas), areas)
    layout = emit_layout(areas, rects)
    blds = [{"id": b["id"], "x": (b["rect"][0] + b["rect"][2]) / 2, "z": (b["rect"][1] + b["rect"][3]) / 2,
             "w": b["rect"][2] - b["rect"][0], "d": b["rect"][3] - b["rect"][1]} for b in layout["buildings"]]
    print(len(layout["buildings"]), "buildings,", len(layout["walls"]), "walls,", len(layout["terraces"]), "terraces")
    print("plan:", render(areas, grid, kinds, blds))
    if "--write" in sys.argv:
        LAYOUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        LAYOUT_JSON.write_text(json.dumps(layout, indent=1), encoding="utf-8")
        print("wrote", LAYOUT_JSON)
