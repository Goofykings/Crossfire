"""Layout toolkit shared by the Industrial Complex and Modern City layout tools.

A map is authored as walkable rectangles (`Area`: streets, alleys, yards, sidewalks, docks, platforms, plazas, spawn
yards, covered passages and walk-in interiors). Everything else inside the outer limit is building mass. The kit:

  * rasterises the walkable network on a 1 m grid and reports gameplay metrics (connectivity, sightlines, corners)
  * decomposes the mass into rectangular lots (greedy largest rectangle), extends perimeter lots into a backdrop band
    and splits long lots, never through a covered area
  * describes each lot to a style callback (frontage per side, corners, covered areas inside, perimeter flag), which
    returns the building entry (type, height, palette, doors, interiors...) or a wall
  * derives terraces (raised areas) with stairs where they meet lower walkable ground and railings along the rest,
    and the covered-floor list (free-for-all spawn points come from blender/scripts/lib/spawn_points.py)
  * renders a plan PNG

It is a parameterised copy of the European Town algorithms in tools/layout_design.py (left untouched so that map
regenerates identically). Coordinates: metres, +x east, +z south; rects are (x0, z0, x1, z1) on whole metres.
"""
from __future__ import annotations

import math
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "blender" / "scripts" / "lib"))

import building_spec  # noqa: E402

SIDES = ("n", "e", "s", "w")
SIDE_HEADING = {"n": 0, "e": 90, "s": 180, "w": 270}
SIDE_OUT = {"n": (0, -1), "s": (0, 1), "w": (-1, 0), "e": (1, 0)}
COVERED_KINDS = ("passage", "room", "interior", "doorway")
RAISED_KINDS = ("terrace", "dock", "platform", "sidewalk", "court")


@dataclass
class Area:
    id: str
    kind: str  # street | alley | yard | court | plaza | spawn | sidewalk | dock | platform | terrace | passage | interior
    x0: float
    z0: float
    x1: float
    z1: float
    height: float = 0.0
    team: str | None = None
    center: bool = False  # self-symmetric: not rotated
    material: str | None = None
    extra: dict = field(default_factory=dict)

    @property
    def rect(self):
        return (self.x0, self.z0, self.x1, self.z1)

    def rotated(self, suffix: str = "r") -> "Area":
        team = {"blue": "red", "red": "blue"}.get(self.team or "", self.team)
        extra = dict(self.extra)
        if "stairs" in extra:
            # a stair spec names a side and a span along it: both turn with the area (n <-> s, e <-> w, span negated)
            flip = {"n": "s", "s": "n", "e": "w", "w": "e"}
            extra["stairs"] = [(flip[sd], None if span is None else (-span[1], -span[0])) for sd, span in extra["stairs"]]
        if "sidewalks" in extra:
            flip = {"n": "s", "s": "n", "e": "w", "w": "e"}
            extra["sidewalks"] = "".join(flip[c] for c in extra["sidewalks"])
        return Area(self.id + suffix, self.kind, -self.x1, -self.z1, -self.x0, -self.z0, self.height, team, False,
                    self.material, extra)


def mirror_all(areas: list[Area]) -> list[Area]:
    """Areas authored for one half plus their 180-degree rotation about the origin (fair, equivalent routes)."""
    out = []
    for a in areas:
        out.append(a)
        if not a.center:
            out.append(a.rotated())
    return out


def stable_hash(text: str) -> int:
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def overlaps(r, a: Area) -> bool:
    return r[0] < a.x1 and a.x0 < r[2] and r[1] < a.z1 and a.z0 < r[3]


def inside(a: Area, r) -> bool:
    return r[0] <= a.x0 and a.x1 <= r[2] and r[1] <= a.z0 and a.z1 <= r[3]


class LayoutKit:
    def __init__(self, areas: list[Area], play: int, outer: int, lot_max: int = 14, min_lot: int = 3):
        self.areas = areas
        self.PLAY = play
        self.OUTER = outer
        self.LOT_MAX = lot_max
        self.MIN_LOT = min_lot
        self.n = outer * 2
        n = self.n
        self.cell_area: list[list[Area | None]] = [[None] * n for _ in range(n)]
        # later areas win (author raised areas after the ground they sit in)
        for a in areas:
            for zi in range(n):
                zc = zi - outer + 0.5
                if not (a.z0 < zc < a.z1):
                    continue
                for xi in range(n):
                    xc = xi - outer + 0.5
                    if a.x0 < xc < a.x1:
                        self.cell_area[zi][xi] = a
        self.cell_lot: list[list[int | None]] = [[None] * n for _ in range(n)]
        self.rects: list[tuple] = []

    # --- grid queries ------------------------------------------------------------------------------
    def area_at(self, x: float, z: float) -> Area | None:
        xi, zi = int(math.floor(x)) + self.OUTER, int(math.floor(z)) + self.OUTER
        if 0 <= xi < self.n and 0 <= zi < self.n:
            return self.cell_area[zi][xi]
        return None

    def classify(self, x: float, z: float):
        """Kind of the 1 m cell whose min corner is (x, z): open | covered | building | outside."""
        xi, zi = int(math.floor(x)) + self.OUTER, int(math.floor(z)) + self.OUTER
        if not (0 <= xi < self.n and 0 <= zi < self.n):
            return "outside", None
        a = self.cell_area[zi][xi]
        if a is not None:
            return ("covered" if a.kind in COVERED_KINDS else "open"), a
        if not (-self.PLAY <= x < self.PLAY and -self.PLAY <= z < self.PLAY):
            return "outside", None
        return "building", self.cell_lot[zi][xi]

    @staticmethod
    def side_samples(r, side):
        x0, z0, x1, z1 = (int(v) for v in r)
        if side == "n":
            return [(x, z0 - 1) for x in range(x0, x1)]
        if side == "s":
            return [(x, z1) for x in range(x0, x1)]
        if side == "w":
            return [(x0 - 1, z) for z in range(z0, z1)]
        return [(x1, z) for z in range(z0, z1)]

    def ground(self, x: float, z: float) -> float:
        k, a = self.classify(x, z)
        return a.height if (k == "open" and a is not None) else 0.0

    # --- metrics ------------------------------------------------------------------------------------
    def metrics(self, seed: int = 7) -> dict:
        n, O = self.n, self.OUTER
        # walk-in interiors are walled (only their doors let sight through): leave them out of the sight metrics
        walk = [[self.cell_area[z][x] is not None and self.cell_area[z][x].kind not in ("interior", "room")
                 and -self.PLAY <= x - O < self.PLAY and -self.PLAY <= z - O < self.PLAY for x in range(n)] for z in range(n)]
        cells = [(x, z) for z in range(n) for x in range(n) if walk[z][x]]
        if not cells:
            return {"walkable_m2": 0}
        start = cells[0]
        seen = {start}
        stack = [start]
        while stack:
            x, z = stack.pop()
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + dx, z + dz)
                if 0 <= q[0] < n and 0 <= q[1] < n and walk[q[1]][q[0]] and q not in seen:
                    seen.add(q)
                    stack.append(q)
        corners = sum(1 for z in range(n - 1) for x in range(n - 1)
                      if walk[z][x] + walk[z][x + 1] + walk[z + 1][x] + walk[z + 1][x + 1] in (1, 3))
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
        rnd = random.Random(seed)
        sight = []
        for _ in range(500):
            x, z = rnd.choice(cells)
            best = 0.0
            for k in range(32):
                ang = k * math.pi / 16
                dx, dz = math.cos(ang), math.sin(ang)
                t = 0.0
                while True:
                    t += 0.25
                    ix, iz = int(math.floor(x + 0.5 + dx * t)), int(math.floor(z + 0.5 + dz * t))
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
                    s0 = x
                    while x < n and walk[z][x]:
                        x += 1
                    runs.append((x - s0, f"z={z - O} x={s0 - O}..{x - O}"))
                x += 1
        for x in range(n):
            z = 0
            while z < n:
                if walk[z][x]:
                    s0 = z
                    while z < n and walk[z][x]:
                        z += 1
                    runs.append((z - s0, f"x={x - O} z={s0 - O}..{z - O}"))
                z += 1
        runs.sort(reverse=True)
        return {"walkable_m2": len(cells), "connected": len(seen) == len(cells), "corner_vertices": corners,
                "top_runs": [f"{r[1]} ({r[0]} m)" for r in runs[:5]],
                "longest_axis_run_m": longest, "median_max_sightline_m": round(sight[len(sight) // 2], 1),
                "p90_max_sightline_m": round(sight[int(len(sight) * 0.9)], 1)}

    # --- lots ---------------------------------------------------------------------------------------
    def mass_grid(self):
        n, O = self.n, self.OUTER
        return [[self.cell_area[z][x] is None or self.cell_area[z][x].kind in COVERED_KINDS for x in range(n)] for z in range(n)]

    @staticmethod
    def _largest_rect(mass, cap=99):
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
                    hh, ww = min(sh, cap), min(w, cap)
                    if hh * ww > best[0]:
                        best = (hh * ww, (sx, z - hh + 1, ww, hh))
                    start = sx
                stack.append((start, h))
        return best[1]

    def _greedy(self, mass):
        rects = []
        while True:
            r = self._largest_rect(mass)
            if r is None:
                break
            x, z, w, h = r
            for zz in range(z, z + h):
                for xx in range(x, x + w):
                    mass[zz][xx] = False
            O = self.OUTER
            rects.append((x - O, z - O, x - O + w, z - O + h))
        return rects

    @staticmethod
    def _absorb_slivers(rects):
        changed = True
        budget = 4 * len(rects) + 50  # partial merges re-split neighbours: never let that cycle
        while changed and budget > 0:
            budget -= 1
            changed = False
            for i, r in enumerate(rects):
                if min(r[2] - r[0], r[3] - r[1]) >= 2:
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
                if not changed:
                    changed = LayoutKit._absorb_partial(rects, i)
                if changed:
                    break
        return rects

    @staticmethod
    def _absorb_partial(rects, i):
        """Merge sliver i into a neighbour whose touching edge covers the sliver's whole long edge, splitting the
        neighbour so every lot stays a rectangle (the remainders become their own lots)."""
        r = rects[i]
        for j, o in enumerate(rects):
            if j == i:
                continue
            if r[2] - r[0] >= r[3] - r[1]:  # long along x: neighbours above / below
                if o[0] <= r[0] and r[2] <= o[2] and (o[3] == r[1] or o[1] == r[3]):
                    mid = (r[0], min(r[1], o[1]), r[2], max(r[3], o[3]))
                    rest = [q for q in ((o[0], o[1], r[0], o[3]), (r[2], o[1], o[2], o[3])) if q[2] - q[0] > 0]
                    if all(q[2] - q[0] >= 3 for q in rest):  # remainders must be lots, not new slivers
                        parts = [mid] + rest
                        break
            else:
                if o[1] <= r[1] and r[3] <= o[3] and (o[2] == r[0] or o[0] == r[2]):
                    mid = (min(r[0], o[0]), r[1], max(r[2], o[2]), r[3])
                    rest = [q for q in ((o[0], o[1], o[2], r[1]), (o[0], r[3], o[2], o[3])) if q[3] - q[1] > 0]
                    if all(q[3] - q[1] >= 3 for q in rest):
                        parts = [mid] + rest
                        break
        else:
            return False
        keep = [q for k, q in enumerate(rects) if k not in (i, j)]
        rects[:] = keep + parts
        return True

    def covered_lots(self, mass, grow: int = 5):
        """A lot around every covered area first, grown into solid mass only (never across walkable ground), so the
        greedy decomposition cannot cut a passage or an interior in two."""
        n, O, P = self.n, self.OUTER, self.PLAY
        lots = []
        for a in sorted((a for a in self.areas if a.kind in ("interior", "passage", "room")), key=lambda a: a.kind != "interior"):
            r = [int(a.x0), int(a.z0), int(a.x1), int(a.z1)]
            if any(not mass[zi + O][xi + O] for zi in range(r[1], r[3]) for xi in range(r[0], r[2])):
                continue  # already claimed by another covered area's lot
            for _ in range(grow):
                grew = False
                for side in SIDES:
                    nr = list(r)
                    if side == "w":
                        nr[0] -= 1
                        strip = [(nr[0], z) for z in range(r[1], r[3])]
                    elif side == "e":
                        nr[2] += 1
                        strip = [(nr[2] - 1, z) for z in range(r[1], r[3])]
                    elif side == "n":
                        nr[1] -= 1
                        strip = [(x, nr[1]) for x in range(r[0], r[2])]
                    else:
                        nr[3] += 1
                        strip = [(x, nr[3] - 1) for x in range(r[0], r[2])]
                    if all(-P <= x < P and -P <= z < P and mass[z + O][x + O] and self.cell_area[z + O][x + O] is None for (x, z) in strip):
                        r = nr
                        grew = True
                if not grew:
                    break
            for zi in range(r[1], r[3]):
                for xi in range(r[0], r[2]):
                    mass[zi + O][xi + O] = False
            lots.append(tuple(r))
        return lots

    def decompose(self):
        full = self.mass_grid()
        n, O, P = self.n, self.OUTER, self.PLAY
        ins = lambda xi, zi: -P <= xi - O < P and -P <= zi - O < P  # noqa: E731
        interior = [[full[z][x] and ins(x, z) for x in range(n)] for z in range(n)]
        anchored = self.covered_lots(interior)
        for (x0, z0, x1, z1) in anchored:
            for zi in range(z0 + O, z1 + O):
                for xi in range(x0 + O, x1 + O):
                    full[zi][xi] = False
        rects = anchored + self._absorb_slivers(self._greedy(interior))
        ext = []
        for (x0, z0, x1, z1) in rects:
            x0 = -O if x0 == -P else x0
            x1 = O if x1 == P else x1
            z0 = -O if z0 == -P else z0
            z1 = O if z1 == P else z1
            ext.append((x0, z0, x1, z1))
        band = [[full[z][x] and not ins(x, z) for x in range(n)] for z in range(n)]
        for (x0, z0, x1, z1) in ext:
            for zi in range(max(0, z0 + O), min(n, z1 + O)):
                for xi in range(max(0, x0 + O), min(n, x1 + O)):
                    band[zi][xi] = False
        return ext + self._absorb_slivers(self._greedy(band))

    def split_lots(self, rects, seed: int = 0):
        covered = [a for a in self.areas if a.kind in COVERED_KINDS]
        out = []
        O = self.OUTER
        for r in rects:
            work = [r]
            while work:
                q = work.pop()
                w, d = q[2] - q[0], q[3] - q[1]
                axis = 0 if w >= d else 1
                if q[0] == -O or q[2] == O:
                    axis = 1 if not (q[1] == -O or q[3] == O) else axis
                elif q[1] == -O or q[3] == O:
                    axis = 0
                length = w if axis == 0 else d
                if length <= self.LOT_MAX or min(w, d) <= 2:
                    out.append(q)
                    continue
                rnd = random.Random(int((q[0] * 73 + q[1] * 31 + w * 7 + d + seed) * 1000) & 0xFFFF)
                k = max(2, round(length / (self.LOT_MAX * 0.7)))
                base = q[0] if axis == 0 else q[1]
                cut = base + round(length / k) + rnd.choice((-1, 0, 0, 1))
                for a in covered:
                    lo, hi = (a.x0, a.x1) if axis == 0 else (a.z0, a.z1)
                    olo, ohi = (a.z0, a.z1) if axis == 0 else (a.x0, a.x1)
                    qlo, qhi = (q[1], q[3]) if axis == 0 else (q[0], q[2])
                    if olo < qhi and qlo < ohi and lo < cut < hi:
                        cut = math.floor(lo) if cut - lo < hi - cut else math.ceil(hi)
                if not (base + self.MIN_LOT <= cut <= base + length - self.MIN_LOT):
                    out.append(q)
                    continue
                if axis == 0:
                    work += [(q[0], q[1], cut, q[3]), (cut, q[1], q[2], q[3])]
                else:
                    work += [(q[0], q[1], q[2], cut), (q[0], cut, q[2], q[3])]
        return out

    def set_lots(self, rects):
        self.rects = rects
        n, O = self.n, self.OUTER
        self.cell_lot = [[None] * n for _ in range(n)]
        for i, r in enumerate(rects):
            for zi in range(int(r[1]) + O, int(r[3]) + O):
                for xi in range(int(r[0]) + O, int(r[2]) + O):
                    if 0 <= xi < n and 0 <= zi < n:
                        self.cell_lot[zi][xi] = i

    def is_backdrop(self, r) -> bool:
        P = self.PLAY
        return r[2] <= -P or r[0] >= P or r[3] <= -P or r[1] >= P

    def lot_info(self, r) -> dict:
        """What a lot faces: per side the sample kinds and the areas, open lengths, longest open run, external corners."""
        exp, faces = {}, {}
        for s in SIDES:
            ks, ar = [], []
            for (x, z) in self.side_samples(r, s):
                k, a = self.classify(x, z)
                ks.append(k)
                ar.append(a if k in ("open", "covered") else None)
            exp[s], faces[s] = ks, ar
        open_len = {s: exp[s].count("open") for s in SIDES}
        runs = {}
        for s in SIDES:
            best, cur, end = 0, 0, -1
            for i, k in enumerate(exp[s]):
                cur = cur + 1 if k == "open" else 0
                if cur > best:
                    best, end = cur, i
            runs[s] = (best, end - best + 1)
        x0, z0, x1, z1 = (int(v) for v in r)
        probes = {"nw": ((x0 - 1, z0 - 1), (x0 - 1, z0), (x0, z0 - 1)), "ne": ((x1, z0 - 1), (x1, z0), (x1 - 1, z0 - 1)),
                  "se": ((x1, z1), (x1, z1 - 1), (x1 - 1, z1)), "sw": ((x0 - 1, z1), (x0 - 1, z1 - 1), (x0, z1))}
        corners = {}
        for k, cells in probes.items():
            cls = [self.classify(*c) for c in cells]
            if all(c[0] == "open" for c in cls):
                corners[k] = cls[0][1]
        covered = [a for a in self.areas if a.kind in COVERED_KINDS and overlaps(r, a)]
        P = self.PLAY
        return {"rect": r, "exp": exp, "faces": faces, "open_len": open_len, "runs": runs, "corners": corners,
                "covered": covered, "perimeter": x0 <= -P or x1 >= P or z0 <= -P or z1 >= P,
                "backdrop": self.is_backdrop(r) or sum(open_len.values()) == 0, "hash": stable_hash(f"{x0},{z0},{x1},{z1}")}

    # --- terraces, stairs and railings ------------------------------------------------------------------
    def terraces(self, rise: float = 0.18, run: float = 0.32, style_of=None):
        """Raised areas: stairs where they meet lower walkable ground (unless lower by less than a step), railings on
        the other open edges of platforms."""
        out = []
        step_h = 0.42
        for a in self.areas:
            if a.kind not in RAISED_KINDS or a.height <= 0:
                continue
            r = (int(a.x0), int(a.z0), int(a.x1), int(a.z1))
            stairs, railings = [], []
            for side in SIDES:
                flags, lower = [], []
                for (x, z) in self.side_samples(r, side):
                    k, other = self.classify(x, z)
                    # walk-in interiors are walled: never put stairs or rails against them
                    walk = k in ("open", "covered") and other is not None and other.kind not in ("interior", "room", "doorway")
                    oh = other.height if walk else None
                    lower.append(walk and oh < a.height - 0.05)
                    flags.append(walk and oh < a.height - step_h)
                want_stairs = a.extra.get("stairs")
                base = r[0] if side in ("n", "s") else r[1]
                i = 0
                while i < len(flags):
                    if not lower[i]:
                        i += 1
                        continue
                    j = i
                    while j < len(flags) and lower[j]:
                        j += 1
                    if any(flags[i:j]):
                        allowed = want_stairs is None or any(side == s and (f is None or (base + i < f[1] and f[0] < base + j))
                                                              for s, f in want_stairs)
                        if allowed:
                            lo, hi = base + i, base + j
                            if want_stairs:
                                for s, f in want_stairs:
                                    if s == side and f is not None:
                                        lo, hi = max(lo, f[0]), min(hi, f[1])
                            steps = max(1, round(a.height / rise))
                            stairs.append({"side": side, "from": lo, "to": hi, "steps": steps, "rise": round(a.height / steps, 4),
                                           "run": run})
                            if lo > base + i:
                                railings.append({"side": side, "from": base + i, "to": lo})
                            if hi < base + j:
                                railings.append({"side": side, "from": hi, "to": base + j})
                        elif a.kind == "platform":
                            railings.append({"side": side, "from": base + i, "to": base + j})
                    i = j
            t = {"id": a.id, "rect": [a.x0, a.z0, a.x1, a.z1], "height": a.height, "stairs": stairs}
            style = style_of(a) if style_of else None
            if style:
                t["style"] = style
            if railings and a.kind == "platform":
                t["railings"] = railings
            out.append(t)
        return out

    # --- plan image -----------------------------------------------------------------------------------
    def render(self, path: Path, buildings, walls=(), props=(), targets=(), terraces=(), scale: int = 12, colors=None):
        n, O = self.n, self.OUTER
        colors = colors or {}
        img = Image.new("RGB", (n * scale, n * scale), (28, 30, 36))
        d = ImageDraw.Draw(img)

        def px(x, z):
            return ((x + O) * scale, (z + O) * scale)

        kind_col = {"street": (190, 190, 186), "alley": (170, 168, 160), "yard": (200, 196, 182), "court": (190, 210, 170),
                    "plaza": (230, 214, 170), "sidewalk": (214, 206, 190), "dock": (226, 196, 150), "platform": (230, 170, 120),
                    "terrace": (225, 185, 140), "passage": (150, 130, 110), "interior": (130, 120, 150), "doorway": (130, 120, 150),
                    "room": (150, 120, 150)}
        kind_col.update(colors)
        for zi in range(n):
            for xi in range(n):
                a = self.cell_area[zi][xi]
                if a is None:
                    continue
                c = kind_col.get(a.kind, (200, 200, 200))
                if a.kind == "spawn":
                    c = (120, 160, 230) if a.team == "blue" else (230, 120, 120)
                d.rectangle([xi * scale, zi * scale, (xi + 1) * scale - 1, (zi + 1) * scale - 1], fill=c)
        for i in range(0, n + 1, 5):
            d.line([(i * scale, 0), (i * scale, n * scale)], fill=(70, 74, 82))
            d.line([(0, i * scale), (n * scale, i * scale)], fill=(70, 74, 82))
        P = self.PLAY
        d.rectangle([px(-P, -P), px(P, P)], outline=(255, 210, 90), width=2)
        for b in buildings:
            x0, z0, x1, z1 = b["rect"]
            d.rectangle([px(x0, z0), (px(x1, z1)[0] - 1, px(x1, z1)[1] - 1)], outline=(250, 250, 250), width=1)
            label = f"{b['id']} {b['type'][:5]} {b.get('height', 0):.0f}m"
            d.text((px(x0, z0)[0] + 3, px(x0, z0)[1] + 2), label, fill=(255, 255, 160))
            for door in b.get("doors", []):
                side, at = door["side"], door["at"]
                if side in ("n", "s"):
                    cx, cz = x0 + at, z0 if side == "n" else z1
                else:
                    cx, cz = x0 if side == "w" else x1, z0 + at
                c = px(cx, cz)
                d.ellipse([c[0] - 3, c[1] - 3, c[0] + 3, c[1] + 3], fill=(255, 220, 60))
        for w in walls:
            x0, z0, x1, z1 = w["rect"]
            d.rectangle([px(x0, z0), px(x1, z1)], fill=(90, 90, 96))
        for t in terraces:
            for st in t.get("stairs", []):
                x0, z0, x1, z1 = t["rect"]
                depth = st["steps"] * st["run"]
                rr = {"n": (st["from"], z0, st["to"], z0 + depth), "s": (st["from"], z1 - depth, st["to"], z1),
                      "w": (x0, st["from"], x0 + depth, st["to"]), "e": (x1 - depth, st["from"], x1, st["to"])}[st["side"]]
                d.rectangle([px(rr[0], rr[1]), px(rr[2], rr[3])], fill=(255, 150, 40))
        for p in props:
            c = px(p["pos"][0], p["pos"][2])
            d.rectangle([c[0] - 2, c[1] - 2, c[0] + 2, c[1] + 2], fill=(150, 90, 40))
        for t in targets:
            c = px(t["pos"][0], t["pos"][2])
            d.ellipse([c[0] - 5, c[1] - 5, c[0] + 5, c[1] + 5], outline=(240, 40, 40), width=2)
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
        return path


def covered_floor(areas):
    return [{"id": a.id, "kind": a.kind, "rect": [a.x0, a.z0, a.x1, a.z1]} for a in areas if a.kind in COVERED_KINDS]


def ground_zones(areas, material_of):
    out = []
    for a in areas:
        if a.kind in COVERED_KINDS:
            continue
        # free-for-all: the old spawn yards are ordinary yards
        kind = {"dock": "terrace", "platform": "terrace", "spawn": "yard"}.get(a.kind, a.kind)
        out.append({"id": a.id, "kind": kind, "rect": [a.x0, a.z0, a.x1, a.z1], "height": a.height,
                    "material": a.material or material_of(a)})
    return out
