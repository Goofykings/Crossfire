"""Procedural industrial buildings for the Industrial Complex.

Built on the townhouse generator's facade framework (edge exposure, party walls, walls with real openings, kit
placements), with industrial architecture: banded walls (concrete base, brick or cladding above), pilasters, roller and
dock doors, steel doors, ribbon and multi-pane windows, louvres, downpipes, signage, pipe runs and lights; low-pitch
gable, mono-pitch (shed) or flat parapet roofs with skylights, ridge vents and rooftop plant; walk-in interiors with
beams, lights and floor markings.

Layout fields read here (besides the common rect/type/seed/palette/doors/passages):
  height             wall top (m)                     roof: {type: gable|shed|flat, ridge: x|z, pitch?, low?}
  floors             window rows for offices          interiors: [{rect, clear, doors: [{side, rect, height, kind}]}]
  doors[].kind       roller | dock | door | double    sign: index into the sign_industrial atlas (optional)
"""
from __future__ import annotations

import math
import random

import building_spec as bs
import kit
import kit_industrial as ki
from building import BACKED_OPENINGS, BuildingGenerator, Edge, KitPlacement, Opening, back_opening, edge_side
from kit import REVEAL
from meshkit import MeshData, Transform, ccw, grime_fn
from roof import Roof, offset_polygon

# Facade palettes. `base` is a dado band up to `base_h`; `upper` (optional) replaces `wall` above `upper_h`.
IND_PALETTES = {
    "brick_red": {"base": "concrete_trim", "base_h": 0.9, "wall": "brick_factory", "roof": "roof_corrugated",
                  "roller": "roller_grey", "door": "steel_blue", "inner": "brick_factory", "pilasters": True},
    "brick_soot": {"base": "concrete_wall_stained", "base_h": 1.1, "wall": "brick_factory_soot", "roof": "roof_rusty",
                   "roller": "roller_red", "door": "steel_green", "inner": "brick_factory_soot", "pilasters": True},
    "brick_clad": {"base": "brick_factory", "base_h": 3.2, "wall": "cladding_grey", "roof": "roof_corrugated",
                   "roller": "roller_blue", "door": "steel_grey", "inner": "concrete_panel"},
    "concrete": {"base": "concrete_wall_stained", "base_h": 1.2, "wall": "concrete_wall", "roof": "roof_corrugated",
                 "roller": "roller_yellow", "door": "steel_red", "inner": "concrete_panel"},
    "panel": {"base": "concrete_trim", "base_h": 0.6, "wall": "concrete_panel", "roof": "roof_corrugated",
              "roller": "roller_blue", "door": "steel_grey", "inner": "concrete_panel"},
    "clad_blue": {"base": "concrete_wall", "base_h": 1.8, "wall": "cladding_blue", "roof": "roof_corrugated",
                  "roller": "roller_white", "door": "steel_white", "inner": "concrete_panel"},
    "clad_green": {"base": "concrete_wall_stained", "base_h": 1.5, "wall": "cladding_green", "roof": "roof_corrugated",
                   "roller": "roller_grey", "door": "steel_dark", "inner": "concrete_panel"},
    "clad_cream": {"base": "brick_factory", "base_h": 1.4, "wall": "cladding_cream", "roof": "roof_rusty",
                   "roller": "roller_green", "door": "steel_green", "inner": "concrete_panel"},
    "clad_red": {"base": "concrete_wall", "base_h": 1.2, "wall": "cladding_red", "roof": "roof_corrugated",
                 "roller": "roller_grey", "door": "steel_dark", "inner": "concrete_panel"},
    "rusty": {"base": "concrete_wall_stained", "base_h": 1.0, "wall": "cladding_rusty", "roof": "roof_rusty",
              "roller": "roller_red", "door": "steel_dark", "inner": "concrete_wall_stained"},
}

SIGN_CELLS = {"warehouse_a": 0, "warehouse_b": 1, "dock_1": 2, "dock_2": 3, "loading": 4, "no_smoking": 5,
              "authorised": 6, "forklift": 7, "block_c": 8, "stores": 9, "pump": 10, "fire_exit": 11,
              "northgate": 12, "kestrel": 13, "halvern": 14, "unit7": 15}

DOOR_HEIGHT = {"roller": 4.2, "dock": 3.2, "double": 2.4, "door": 2.2}


class IndustrialBuildingGenerator(BuildingGenerator):
    PALETTES = IND_PALETTES
    # walk-in interior finishes (the city generator overrides these)
    INTERIOR = {"floor": "concrete_floor_dark", "ceiling": "cladding_white", "dado": "concrete_wall_stained", "beams": True,
                "lanes": True}

    def generate(self, b: dict):
        self.b = b
        self.rnd = random.Random(b["seed"] * 7919 + 31)
        rnd = self.rnd
        pal = self.palette_for(b)
        self.pal = pal
        self.H = bs.eave_height(b)
        self.wall = pal["wall"]
        self.trim = "concrete_trim"
        self.frame = "steel_dark"
        self.backdrop = b["type"] in ("backdrop", "chimney", "tank") or self.detail == "backdrop"
        k = 1.0 + rnd.uniform(-0.06, 0.03)
        self.base_tint = (k * (1 + rnd.uniform(-0.03, 0.03)), k, k * (1 + rnd.uniform(-0.03, 0.02)), 1.0)
        self.md = MeshData(grime_fn(self.base_tint, 0.0, self.H, 0.42))
        self.md.uv_offset = (rnd.uniform(0, 5), rnd.uniform(0, 5))
        self.placements: list[KitPlacement] = []
        self.plain = []  # s ranges kept clear of facade clutter, per edge (doors, windows)
        if b["type"] == "chimney":
            self.chimney()
            return self.md, self.placements
        if b["type"] == "tank":
            self.tank()
            return self.md, self.placements

        poly = ccw(bs.footprint_polygon(b))
        self.poly = poly
        edges = []
        for i in range(len(poly)):
            a, c = poly[i], poly[(i + 1) % len(poly)]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            t = ((c[0] - a[0]) / L, (c[1] - a[1]) / L)
            edges.append(Edge(a, c, t, (-t[1], t[0]), L, edge_side(a, c, b["rect"])))
        self.edges = edges
        self.roof_type = b["roof"]["type"]
        self.kinds = self.roof_kinds(edges)
        exposure = [self.edge_exposure(e) for e in edges]
        self.front_side = b.get("front", "s")
        self.signed = False
        for i, (e, exp) in enumerate(zip(edges, exposure)):
            self.edge_index = i
            self.build_edge(e, exp)
        self.corner_details(edges, exposure)
        self.build_roof(edges, exposure)
        for p in b.get("passages", []):
            self.build_passage(p)
        for it in b.get("interiors", []):
            self.build_interior(it)
        return self.md, self.placements

    def palette_for(self, b: dict) -> dict:
        return self.PALETTES[b["palette"]]

    # --- wall materials -----------------------------------------------------------------------------
    def mat_at(self, y: float) -> str:
        pal = self.pal
        if y < pal.get("base_h", 0.0):
            return pal["base"]
        if pal.get("upper") and y > pal["upper_h"]:
            return pal["upper"]
        return pal["wall"]

    def splits(self):
        out = [self.pal.get("base_h", 0.0)]
        if self.pal.get("upper"):
            out.append(self.pal["upper_h"])
        return [y for y in out if 0.0 < y < self.H]

    def wall_rect(self, e: Edge, s0, s1, y0, y1, bands=(0.6, 1.4)):
        ys = sorted({y0, y1, *[y for y in (*bands, *self.splits()) if y0 < y < y1], *([y1 - 0.6] if y1 - 0.6 > y0 else [])})
        for j in range(len(ys) - 1):
            mat = self.mat_at((ys[j] + ys[j + 1]) / 2)
            self.md.quad(self.P(e, s0, ys[j]), self.P(e, s1, ys[j]), self.P(e, s1, ys[j + 1]), self.P(e, s0, ys[j + 1]), mat)

    def roof_kinds(self, edges):
        r = self.b["roof"]
        if r["type"] == "flat":
            return ["flat"] * len(edges)
        if r["type"] == "shed":
            low = r.get("low", self.b.get("front", "s"))
            return ["eave" if e.side == low else "gable" for e in edges]
        ridge = r.get("ridge", "x")
        return ["eave" if (e.side in ("n", "s")) == (ridge == "x") or e.side == "chamfer" else "gable" for e in edges]

    # --- openings ------------------------------------------------------------------------------------
    def side_range(self, e: Edge, rect):
        x0, z0, x1, z1 = rect
        if e.side in ("w", "e"):
            return tuple(sorted(((z0 - e.a[1]) * e.t[1], (z1 - e.a[1]) * e.t[1])))
        return tuple(sorted(((x0 - e.a[0]) * e.t[0], (x1 - e.a[0]) * e.t[0])))

    def base_openings(self, e: Edge, open_runs, heights=None):
        """Openings every style shares: passages, interior doorways and the layout's doors.

        Returns (ops, free, to_s): the list, a predicate telling whether a rectangle on the facade is still free, and
        the conversion from a layout `at` (metres from the side's min corner) to the edge parameter.
        """
        b = self.b
        ops: list[Opening] = []
        side = e.side
        H = self.H
        heights = heights or DOOR_HEIGHT

        def free(s0, s1, y0, y1, pad=0.35):
            for o in ops:
                if s0 < o.s1 + pad and o.s0 - pad < s1 and y0 < o.y1 + 0.2 and o.y0 - 0.2 < y1:
                    return False
            return any(r0 + 0.35 <= s0 and s1 <= r1 - 0.35 for (r0, r1) in open_runs)

        def to_s(at):
            x0, z0, x1, z1 = b["rect"]
            if side in ("n", "s"):
                return (x0 + at - e.a[0]) * e.t[0]
            return (z0 + at - e.a[1]) * e.t[1]

        for p in b.get("passages", []):
            axis = bs.passage_axis(b, p)
            if not ((axis == "x" and side in ("w", "e")) or (axis == "z" and side in ("n", "s"))):
                continue
            sa, sb = self.side_range(e, p["rect"])
            spring, apex, _ = bs.passage_profile(p)
            ops.append(Opening(sa, sb, -0.3, apex, "passage", depth=0.0, style=p.get("style", "portal"), spring=spring))
        for it in b.get("interiors", []):
            for d in it.get("doors", []):
                if d["side"] != side:
                    continue
                sa, sb = self.side_range(e, d["rect"])
                x0, z0, x1, z1 = d["rect"]
                depth = (z1 - z0) if side in ("n", "s") else (x1 - x0)
                g = self.ground(e, (sa + sb) / 2)
                ops.append(Opening(sa, sb, -0.3, d.get("height", 2.4), d.get("kind", "doorway"), depth=depth,
                                   data={"ground": g}))
        for door in b.get("doors", []):
            if door["side"] != side:
                continue
            c = to_s(door["at"])
            w = door["width"]
            kind = door.get("kind", "door")
            g = self.ground(e, c)
            h = min(door.get("height", heights[kind]), H - 1.0 - g)
            y0 = -0.3 if g < 0.05 else g
            if h > 1.9 and free(c - w / 2, c + w / 2, y0, g + h, pad=0.3):
                ops.append(Opening(c - w / 2, c + w / 2, y0, g + h, kind, data={"ground": g}))
        return ops, free, to_s

    def plan_openings(self, e: Edge, open_runs):
        b = self.b
        rnd = self.rnd
        H = self.H
        ops, free, to_s = self.base_openings(e, open_runs)
        if self.backdrop:
            return ops
        t = b["type"]
        door_top = max([o.y1 for o in ops if o.kind in ("roller", "dock", "doorway", "roller_open", "passage")] + [2.6])
        if t in ("warehouse", "hangar"):
            y0 = max(door_top + 0.8, 3.6)
            h = min(1.3, H - y0 - 0.8)
            if h >= 0.6:
                for (r0, r1) in open_runs:
                    usable = r1 - r0 - 1.2
                    if usable < 2.0:
                        continue
                    n = max(1, round(usable / 6.0))
                    bay = usable / n
                    for i in range(n):
                        c = r0 + 0.6 + bay * (i + 0.5)
                        w = min(4.2, bay - 1.0)
                        if w >= 1.6 and free(c - w / 2, c + w / 2, y0, y0 + h, pad=0.3):
                            ops.append(Opening(c - w / 2, c + w / 2, y0, y0 + h, "strip"))
            # louvres high up near the ends of the gable walls
            if self.kinds[self.edge_index] == "gable" and H > 6:
                for (r0, r1) in open_runs:
                    if r1 - r0 > 4 and rnd.random() < 0.7:
                        c = (r0 + r1) / 2
                        if free(c - 0.6, c + 0.6, H - 1.9, H - 0.9):
                            ops.append(Opening(c - 0.6, c + 0.6, H - 1.9, H - 0.9, "louvre"))
        elif t in ("workshop", "shed"):
            wy = 1.15
            wh = min(2.4 if t == "workshop" else 1.2, H - wy - 1.2)
            bay = 3.4 if t == "workshop" else 4.5
            for (r0, r1) in open_runs:
                usable = r1 - r0 - 1.2
                if usable < 1.6 or wh < 0.8:
                    continue
                n = max(1, round(usable / bay))
                for i in range(n):
                    c = r0 + 0.6 + usable * (i + 0.5) / n
                    w = min(2.4, usable / n - 0.9) if t == "workshop" else 1.4
                    if w >= 1.0 and free(c - w / 2, c + w / 2, wy, wy + wh):
                        ops.append(Opening(c - w / 2, c + w / 2, wy, wy + wh, "factory"))
        elif t == "office":
            floors = b.get("floors", 2)
            for f in range(floors):
                base = bs.floor_base(b, f)
                wy = base + (1.0 if f == 0 else 0.9)
                wh = 1.45
                if wy + wh > H - 0.5:
                    break
                for (r0, r1) in open_runs:
                    usable = r1 - r0 - 1.0
                    if usable < 1.4:
                        continue
                    n = max(1, round(usable / 3.0))
                    for i in range(n):
                        c = r0 + 0.5 + usable * (i + 0.5) / n
                        w = 1.6
                        if free(c - w / 2, c + w / 2, wy, wy + wh, pad=0.4):
                            ops.append(Opening(c - w / 2, c + w / 2, wy, wy + wh, "office", data={"floor": f}))
        return ops

    def facade_wall(self, e: Edge, r0: float, r1: float, ops):
        """Wall over [r0, r1] with rectangular holes and reveals; material changes by height band."""
        md = self.md
        H = self.H
        holes = [o for o in ops if o.s1 > o.s0 + 1e-6]
        xs = sorted({r0, r1, *[o.s0 for o in holes], *[o.s1 for o in holes]})
        ys = sorted({-0.3, H, 0.6, 1.4, H - 0.6, *self.splits(), *[o.y0 for o in holes], *[o.y1 for o in holes]})
        ys = [y for y in ys if -0.3 <= y <= H]
        streaks = [(o.s0, o.s1, o.y0) for o in holes if o.kind in ("strip", "factory", "office", "louvre")]

        def color(p, s, y):
            c = md.color_fn(p)
            for (a, bnd, sill) in streaks:
                if a + 0.05 < s < bnd - 0.05 and sill - 1.6 < y < sill - 0.01:
                    k = 0.8 + 0.2 * (sill - y) / 1.6
                    return (c[0] * k, c[1] * k, c[2] * k, 1.0)
            return c

        for i in range(len(xs) - 1):
            sa, sb = xs[i], xs[i + 1]
            if sb - sa < 1e-5:
                continue
            sm = (sa + sb) / 2
            for j in range(len(ys) - 1):
                ya, yb = ys[j], ys[j + 1]
                if yb - ya < 1e-5:
                    continue
                ym = (ya + yb) / 2
                if any(o.s0 < sm < o.s1 and o.y0 < ym < o.y1 for o in holes):
                    continue
                pts = [(sa, ya), (sb, ya), (sb, yb), (sa, yb)]
                P = [self.P(e, s, y) for s, y in pts]
                md.face(P, self.mat_at(ym), col=[color(p, s, y) for p, (s, y) in zip(P, pts)])
        for o in holes:
            if o.kind == "passage":
                continue
            d = o.depth
            jamb = self.frame if o.kind in ("roller", "dock", "doorway", "roller_open", "door", "double") else self.mat_at((o.y0 + o.y1) / 2)
            y0 = max(o.y0, -0.3)
            md.quad(self.P(e, o.s0, y0), self.P(e, o.s0, y0, d), self.P(e, o.s0, o.y1, d), self.P(e, o.s0, o.y1), jamb)
            md.quad(self.P(e, o.s1, y0, d), self.P(e, o.s1, y0), self.P(e, o.s1, o.y1), self.P(e, o.s1, o.y1, d), jamb)
            md.quad(self.P(e, o.s0, o.y1), self.P(e, o.s0, o.y1, d), self.P(e, o.s1, o.y1, d), self.P(e, o.s1, o.y1), jamb)
            if o.kind in ("strip", "factory", "office", "louvre", "dock"):
                # opening floor: it starts behind the sill piece, whose top is the first part of the opening's floor
                # (sharing that strip made them z-fight, as kit.SILL_BACK explains)
                d0 = {"factory": 0.1, "office": kit.SILL_BACK, "strip": REVEAL - 0.12}.get(o.kind, 0.0)
                mat = self.frame if o.kind == "dock" else self.mat_at(o.y0)
                md.quad(self.P(e, o.s1, o.y0, d0), self.P(e, o.s1, o.y0, d), self.P(e, o.s0, o.y0, d), self.P(e, o.s0, o.y0, d0), mat)
            if o.kind in BACKED_OPENINGS:
                back_opening(md, self.P, e, o, y0)

    def trims(self, e: Edge, r0: float, r1: float, ops):
        """Coping on flat roofs, brick pilasters, downpipes, lights, signs, wall boxes and pipe runs."""
        H = self.H
        rnd = self.rnd
        (c0, p0), (c1, p1) = self.run_end_cuts(e, r0, r1)

        def run_box(a, c, y0, y1, d0, d1, mat):
            dep = abs(d0)
            at0, at1 = a <= r0 + 1e-6, c >= r1 - 1e-6
            if c0 and at0:
                a += dep
            if c1 and at1:
                c -= dep
            skip_ends = (p0 and not c0 and at0, p1 and not c1 and at1)
            if c > a + 1e-4:
                self._edge_box(e, a, c, y0, y1, d0, d1, mat, skip_ends=skip_ends)

        busy = [(o.s0 - 0.25, o.s1 + 0.25, o.y0, o.y1) for o in ops]

        def clear(s0, s1, y0, y1):
            return all(not (s0 < b1 and b0 < s1 and y0 < q1 and q0 < y1) for (b0, b1, q0, q1) in busy)

        if self.roof_type == "flat":
            run_box(r0, r1, H - 0.12, H + 0.06, -0.06, 0.0, "concrete_trim")
        # brick pilasters on a ~6 m grid
        if self.pal.get("pilasters") and r1 - r0 > 5.0:
            n = max(1, round((r1 - r0) / 6.0))
            for i in range(n + 1):
                s = r0 + 0.25 + i * (r1 - r0 - 0.5) / n
                if s - 0.25 < r0 + 0.2 or s + 0.25 > r1 - 0.2:
                    continue
                top = H - (0.2 if self.roof_type == "flat" else 0.05)
                if clear(s - 0.25, s + 0.25, -0.3, top):
                    self._edge_box(e, s - 0.25, s + 0.25, -0.3, top, -0.1, 0.0, self.pal["wall"])
                    busy.append((s - 0.3, s + 0.3, -0.3, top))
        # downpipes under the gutter of eave edges
        if self.kinds[self.edge_index] == "eave" and r1 - r0 > 3.0:
            spots = [r0 + 0.4, r1 - 0.4] + ([(r0 + r1) / 2] if r1 - r0 > 16 else [])
            for s in spots:
                if not clear(s - 0.12, s + 0.12, 0.0, H):
                    continue
                g = self.ground(e, s)
                pa = self.P(e, s, H - 0.1, -0.14)
                pb = self.P(e, s, g + 0.35, -0.14)
                self.md.tube(pa, pb, 0.055, "galvanized", segments=6)
                self.md.tube(pb, self.P(e, s, g + 0.06, -0.36), 0.055, "galvanized", segments=6)
                for y in (H - 0.8, (H + g) / 2, g + 1.0):
                    self.md.tube(self.P(e, s, y, 0.0), self.P(e, s, y, -0.14), 0.012, "steel_dark", segments=4, caps=False)
                busy.append((s - 0.2, s + 0.2, -0.3, H))
        if self.backdrop:
            return
        # a company or site board on the front, high up
        if not self.signed and e.side == self.front_side and r1 - r0 > 5.5:
            w, h = min(5.0, r1 - r0 - 2.0), 1.0
            y = H - 1.5 if self.roof_type != "flat" else H - 1.4
            c = (r0 + r1) / 2
            if clear(c - w / 2, c + w / 2, y - 0.1, y + h + 0.1) and y > 3.2:
                cell = self.b.get("sign", self.b["seed"] % 16)
                self.place(f"isign_{cell}_{round(w, 2)}", lambda: ki.sign_board(cell, w, h), e, c, y)
                busy.append((c - w / 2, c + w / 2, y, y + h))
                self.signed = True
        # corner floodlights
        if rnd.random() < 0.5 and r1 - r0 > 3:
            for s in (r0 + 0.6, r1 - 0.6):
                if clear(s - 0.3, s + 0.3, H - 1.4, H - 0.6) and H > 4.5:
                    self.place("ifloodwall", ki.floodlight_wall, e, s, H - 0.9)
                    busy.append((s - 0.35, s + 0.35, H - 1.4, H - 0.4))
                    break
        # electrical box with conduit
        if rnd.random() < 0.55 and r1 - r0 > 3:
            for _ in range(6):
                s = rnd.uniform(r0 + 0.8, r1 - 0.8)
                if clear(s - 0.4, s + 0.4, 0.9, 3.1):
                    g = self.ground(e, s)
                    self.place("iwallbox", ki.wall_box, e, s, g + 1.1)
                    busy.append((s - 0.45, s + 0.45, 0.9, 3.1))
                    break
        # a cat ladder up to the roof on some blank stretches
        if rnd.random() < 0.3 and r1 - r0 > 4 and H > 5:
            for _ in range(5):
                s = rnd.uniform(r0 + 0.8, r1 - 0.8)
                if clear(s - 0.5, s + 0.5, 2.4, H):
                    self.place(f"iladder_{round(H, 2)}", lambda: ki.roof_ladder(H), e, s, self.ground(e, s))
                    busy.append((s - 0.6, s + 0.6, 2.4, H))
                    break
        # a horizontal service pipe with brackets
        if rnd.random() < 0.5 and r1 - r0 > 6 and H > 5:
            y = rnd.choice((3.4, 3.8))
            a, c = r0 + 0.5, r1 - 0.5
            if all(not (a < b1 and b0 < c and y - 0.2 < q1 and q0 < y + 0.2) for (b0, b1, q0, q1) in busy):
                mat = rnd.choice(("steel_red", "galvanized", "steel_yellow", "steel_green"))
                self.md.tube(self.P(e, a, y, -0.2), self.P(e, c, y, -0.2), 0.07, mat, segments=8)
                n = max(2, int((c - a) / 2.2))
                for i in range(n + 1):
                    s = a + i * (c - a) / n
                    self._edge_box(e, s - 0.03, s + 0.03, y - 0.12, y - 0.07, -0.3, 0.0, "steel_dark")
                if clear(c - 0.2, c + 0.2, 0.0, y):
                    self.md.tube(self.P(e, c, y, -0.2), self.P(e, c, self.ground(e, c) + 0.05, -0.2), 0.07, mat, segments=8)

    def dress_opening(self, e: Edge, o: Opening, openings=()):
        w = o.s1 - o.s0
        c = (o.s0 + o.s1) / 2
        h = o.y1 - o.y0
        wk, hk = round(w, 2), round(h, 2)
        pal = self.pal
        if o.kind == "strip":
            self.place(f"istrip_{wk}x{hk}", lambda: ki.strip_window(w, h), e, c, o.y0)
        elif o.kind == "factory":
            self.place(f"ifactory_{wk}x{hk}", lambda: ki.factory_window(w, h), e, c, o.y0)
            self.place(f"isill_{wk}x{hk}", lambda: ki.sill_lintel(w, h), e, c, o.y0)
        elif o.kind == "office":
            self.place(f"iwin_{wk}x{hk}", lambda: kit.window(w, h, "steel_dark", mullion=True, transom=False), e, c, o.y0)
            self.place(f"isill_{wk}", lambda: kit.sill(w, "concrete_trim"), e, c, o.y0)
        elif o.kind == "louvre":
            self.place(f"ilouvre_{wk}x{hk}", lambda: ki.louvre(w, h), e, c, o.y0)
        elif o.kind in ("roller", "dock"):
            g = o.data["ground"]
            dh = o.y1 - g
            rm = pal["roller"]
            self.place(f"iroller_{wk}x{round(dh, 2)}_{rm}", lambda: ki.roller_door(w, dh, rm), e, c, g)
            # lamp beside the opening (above it sit the coil housing and often a ribbon window)
            s = o.s1 + 0.55
            if s < e.length - 0.4 and all(not (p.s0 - 0.4 < s < p.s1 + 0.4 and p.y0 < g + dh and p.y1 > g + dh - 0.6)
                                          for p in openings if p is not o):
                self.place("ibulk", ki.bulkhead_light, e, s, g + dh - 0.25)
        elif o.kind == "roller_open":
            g = o.data["ground"]
            dh = o.y1 - g
            rm = pal["roller"]
            self.place(f"irollopen_{wk}x{round(dh, 2)}_{rm}", lambda: ki.roller_door(w, dh, rm, open_=True), e, c, g)
        elif o.kind == "doorway":
            g = o.data["ground"]
            dh = o.y1 - g
            self.place(f"iframe_{wk}x{round(dh, 2)}", lambda: ki.door_frame(w, dh), e, c, g)
        elif o.kind in ("door", "double"):
            g = o.data["ground"]
            dh = o.y1 - g
            dm = pal["door"]
            dbl = o.kind == "double"
            self.place(f"idoor_{wk}x{round(dh, 2)}_{dm}_{int(dbl)}", lambda: ki.steel_door(w, dh, dm, dbl), e, c, g)
            self.place(f"ithresh_{wk}", lambda: kit.threshold(w, "concrete_trim"), e, c, g)
            cw = w + 0.6
            # canopies keep clear of the facade ends (at a concave corner a neighbour's canopy may stick out there)
            if g + 3.05 + 0.4 < self.H and self.rnd.random() < 0.45 and c - cw / 2 > 1.2 and c + cw / 2 < e.length - 1.2:
                self.place(f"icanopy_{round(cw, 2)}", lambda: ki.canopy(cw), e, c, g + 3.05)

    def corner_details(self, edges, exposure):
        """Steel corner flashings on clad buildings (where both faces are open)."""
        if self.backdrop or not self.pal["wall"].startswith("cladding"):
            return
        n = len(edges)
        for i in range(n):
            e1, e2 = edges[i], edges[(i + 1) % n]
            ex1, ex2 = exposure[i], exposure[(i + 1) % n]
            if not ex1 or not ex2 or ex1[-1][0] != "open" or ex2[0][0] != "open":
                continue
            y0 = self.pal.get("base_h", 0.0)
            self._edge_box(e1, e1.length - 0.12, e1.length, y0, self.H - 0.02, -0.025, 0.0, "galvanized", skip_ends=(False, True))
            self._edge_box(e2, 0.0, 0.12, y0, self.H - 0.02, -0.025, 0.0, "galvanized", skip_ends=(True, False))

    # --- roofs ---------------------------------------------------------------------------------------
    def build_roof(self, edges, exposure):
        b = self.b
        md = self.md
        rnd = self.rnd
        if self.roof_type == "flat":
            self.flat_roof(edges)
            return
        no_over = [any(k == "party" for k, _, _ in exp) for exp in exposure]
        pitch = math.radians(b["roof"].get("pitch", 9 if self.roof_type == "gable" else 6))
        roof = Roof(self.poly, self.kinds, self.H, pitch, overhang=0.3, verge=0.18, thickness=0.12, no_overhang=no_over)
        wall_fn = grime_fn(self.base_tint, 0.0, self.H + 20, 0.42)
        gable_mat = self.pal.get("upper") or self.pal["wall"]
        roof.build(md, self.pal["roof"], "galvanized", gable_mat, wall_color_fn=wall_fn,
                   gutter_mat=None if self.backdrop else "galvanized", cap=self.roof_type == "gable")
        self.roof = roof
        if self.backdrop:
            return
        x0, z0, x1, z1 = b["rect"]
        ridge = b["roof"].get("ridge", "x")
        along = (x1 - x0) if ridge == "x" else (z1 - z0)
        if self.roof_type == "gable" and along > 8:
            # ridge vent and extractor fans
            ry = roof.ridge_height()
            if ridge == "x":
                zc = (z0 + z1) / 2
                md.box(x0 + along * 0.2, ry - 0.06, zc - 0.32, x1 - along * 0.2, ry + 0.32, zc + 0.32, "galvanized", skip=("ny",))
                md.box(x0 + along * 0.2 - 0.05, ry + 0.32, zc - 0.42, x1 - along * 0.2 + 0.05, ry + 0.38, zc + 0.42, "galvanized")
            else:
                xc = (x0 + x1) / 2
                md.box(xc - 0.32, ry - 0.06, z0 + along * 0.2, xc + 0.32, ry + 0.32, z1 - along * 0.2, "galvanized", skip=("ny",))
                md.box(xc - 0.42, ry + 0.32, z0 + along * 0.2 - 0.05, xc + 0.42, ry + 0.38, z1 - along * 0.2 + 0.05, "galvanized")
        # skylight strips laid on the roof planes
        if along > 9:
            n = max(2, int(along / 6))
            span = (z1 - z0) if ridge == "x" else (x1 - x0)
            for i in range(n):
                t = (i + 0.5) / n
                for side in (0.3, 0.7) if self.roof_type == "gable" else (0.5,):
                    if ridge == "x":
                        cx, cz = x0 + along * t, z0 + span * side
                        rect = (cx - 0.7, cz - span * 0.1, cx + 0.7, cz + span * 0.1)
                    else:
                        cx, cz = x0 + span * side, z0 + along * t
                        rect = (cx - span * 0.1, cz - 0.7, cx + span * 0.1, cz + 0.7)
                    self.roof_light(roof, rect)

    def roof_light(self, roof: Roof, rect):
        """A glazed panel lying 6 cm above a pitched roof plane, with a galvanised upstand."""
        x0, z0, x1, z1 = rect
        lift = 0.06
        pts = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        top = [(x, roof.height(x, z) + lift, z) for (x, z) in pts]
        self.md.face_toward(top, "glass_skylight", (0, 1, 0))
        for k in range(4):
            a, b = pts[k], pts[(k + 1) % 4]
            mid = ((a[0] + b[0]) / 2 - (x0 + x1) / 2, (a[1] + b[1]) / 2 - (z0 + z1) / 2)
            quad = [(a[0], roof.height(*a) - 0.02, a[1]), (b[0], roof.height(*b) - 0.02, b[1]),
                    (b[0], roof.height(*b) + lift, b[1]), (a[0], roof.height(*a) + lift, a[1])]
            self.md.face_toward(quad, "galvanized", (mid[0], 0, mid[1]))

    def flat_roof(self, edges):
        """Parapet roof: the walls already run up to H; gravel deck 0.7 m below, inner parapet faces, coping ring."""
        md = self.md
        H = self.H
        yr = H - 0.7
        inset = offset_polygon(self.poly, [-0.25] * len(self.poly))
        md.face_toward([(x, yr, z) for (x, z) in inset], "roof_gravel", (0, 1, 0))
        n = len(inset)
        for i in range(n):
            a, c = inset[i], inset[(i + 1) % n]
            oa, oc = self.poly[i], self.poly[(i + 1) % n]
            # inner face looks into the roof (toward the polygon centre)
            nx, nz = edges[i].n
            md.face_toward([(a[0], yr, a[1]), (c[0], yr, c[1]), (c[0], H, c[1]), (a[0], H, a[1])], "concrete_trim", (-nx, 0, -nz))
            md.face_toward([(oa[0], H, oa[1]), (oc[0], H, oc[1]), (c[0], H, c[1]), (a[0], H, a[1])], "concrete_trim", (0, 1, 0))
        if self.backdrop:
            return
        rnd = self.rnd
        x0, z0, x1, z1 = self.b["rect"]
        spots = []
        kit_table = self.roof_kit()
        for _ in range(14):
            if len(spots) >= max(1, int((x1 - x0) * (z1 - z0) / 45)):
                break
            name, w, d, fac = rnd.choice(kit_table)
            if x1 - x0 < w + 2.8 or z1 - z0 < d + 2.8:
                continue
            cx, cz = rnd.uniform(x0 + 1.3 + w / 2, x1 - 1.3 - w / 2), rnd.uniform(z0 + 1.3 + d / 2, z1 - 1.3 - d / 2)
            if any(abs(cx - sx) < (w + sw) / 2 + 0.5 and abs(cz - sz) < (d + sd) / 2 + 0.5 for (sx, sz, sw, sd) in spots):
                continue
            spots.append((cx, cz, w, d))
            self.placements.append(KitPlacement(name, fac, Transform(cx, yr, cz, 0.0)))

    def roof_kit(self):
        """(kit name, footprint w, d, factory) choices for flat-roof plant; repeated entries are likelier."""
        return [("iroof_hvac", 2.4, 1.6, ki.hvac_unit), ("iroof_hvac", 2.4, 1.6, ki.hvac_unit),
                ("iroof_fan", 1.2, 1.2, ki.extractor_fan), ("iroof_vent", 0.5, 0.5, ki.roof_vent_stack),
                ("iroof_skylight", 2.2, 1.4, lambda: ki.skylight(2.2, 1.4))]

    # --- passages and interiors -----------------------------------------------------------------------
    def build_passage(self, p):
        """Vehicle passage through the building: lined walls, steel beams under a deck, lights."""
        b = self.b
        md = self.md
        px0, pz0, px1, pz1 = p["rect"]
        axis = bs.passage_axis(b, p)
        _, top, _ = bs.passage_profile(p)
        if axis == "x":
            a0, a1, w0, w1 = px0, px1, pz0, pz1

            def W(al, y, ac):
                return (al, y, ac)
        else:
            a0, a1, w0, w1 = pz0, pz1, px0, px1

            def W(al, y, ac):
                return (ac, y, al)
        for across, sgn in ((w0, 1), (w1, -1)):
            for (ya, yb, mat) in ((-0.3, 1.0, "concrete_wall_stained"), (1.0, top, self.pal["inner"])):
                q = [W(a0, ya, across), W(a1, ya, across), W(a1, yb, across), W(a0, yb, across)]
                want = (0, 0, sgn) if axis == "x" else (sgn, 0, 0)
                md.face_toward(q, mat, want)
        md.face_toward([W(a0, top, w0), W(a1, top, w0), W(a1, top, w1), W(a0, top, w1)], "cladding_grey", (0, -1, 0))
        n = max(1, int((a1 - a0) / 2.0))
        for i in range(n + 1):
            al = a0 + 0.15 + i * (a1 - a0 - 0.3) / n
            lo, hi = W(al - 0.08, top - 0.3, w0), W(al + 0.08, top, w1)
            md.box(min(lo[0], hi[0]), lo[1], min(lo[2], hi[2]), max(lo[0], hi[0]), hi[1], max(lo[2], hi[2]), "steel_blue", skip=("py",))
            if i % 2 == 1:
                mid = (w0 + w1) / 2
                l0, l1 = W(al - 0.6, top - 0.36, mid - 0.08), W(al + 0.6, top - 0.3, mid + 0.08)
                md.box(min(l0[0], l1[0]), l0[1], min(l0[2], l1[2]), max(l0[0], l1[0]), l1[1], max(l0[2], l1[2]), "lamp_led", skip=("py",))
        # steel portal beams on both faces; not where another building abuts the mouth (the beam would run into it and
        # share its wall plane)
        for al, sgn in ((a0, -1), (a1, 1)):
            probes = [W(al + sgn * 0.12, top, c) for c in (w0 - 0.15, (w0 + w1) / 2, w1 + 0.15)]
            if any(self.index.classify(q[0], q[2])[0] in ("building", "solid") for q in probes):
                continue
            lo = W(al - 0.0 if sgn > 0 else al - 0.25, top, w0 - 0.25)
            hi = W(al + 0.25 if sgn > 0 else al + 0.0, top + 0.45, w1 + 0.25)
            md.box(min(lo[0], hi[0]), lo[1], min(lo[2], hi[2]), max(lo[0], hi[0]), hi[1], max(lo[2], hi[2]), "steel_yellow")

    def build_interior(self, it):
        """Walk-in hall: floor, inward walls with doorways, beamed ceiling, hanging lights, painted lanes."""
        md = self.md
        cx0, cz0, cx1, cz1 = it["rect"]
        ch = it.get("clear", 4.5)
        inner = self.pal["inner"]
        # floor over the cavity and every doorway (the terrain leaves interiors to the building)
        floor_col = (0.8, 0.8, 0.8, 1.0)
        style = self.INTERIOR
        for (rx0, rz0, rx1, rz1), _ in bs.interior_openings(it):
            md.face_toward([(rx0, 0.0, rz0), (rx1, 0.0, rz0), (rx1, 0.0, rz1), (rx0, 0.0, rz1)], style["floor"], (0, 1, 0),
                           col=floor_col)
        md.face_toward([(cx0, ch, cz0), (cx1, ch, cz0), (cx1, ch, cz1), (cx0, ch, cz1)], style["ceiling"], (0, -1, 0),
                       col=(0.72, 0.72, 0.72, 1.0))
        # walls facing into the hall, with holes where doorways reach the cavity
        sides = {"n": ((cx1, cz0), (cx0, cz0)), "s": ((cx0, cz1), (cx1, cz1)), "w": ((cx0, cz0), (cx0, cz1)),
                 "e": ((cx1, cz1), (cx1, cz0))}
        for side, (a, c) in sides.items():
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            t = ((c[0] - a[0]) / L, (c[1] - a[1]) / L)
            e = Edge(a, c, t, (-t[1], t[0]), L, side)
            holes = []
            for d in it.get("doors", []):
                if d["side"] != side:
                    continue
                x0, z0, x1, z1 = d["rect"]
                if side in ("n", "s"):
                    s0, s1 = sorted(((x0 - a[0]) * t[0], (x1 - a[0]) * t[0]))
                else:
                    s0, s1 = sorted(((z0 - a[1]) * t[1], (z1 - a[1]) * t[1]))
                holes.append((s0, s1, d.get("height", 2.4)))
            xs = sorted({0.0, L, *[v for h in holes for v in h[:2]]})
            ys = sorted({0.0, 1.2, ch, *[h[2] for h in holes if h[2] < ch]})
            for i in range(len(xs) - 1):
                for j in range(len(ys) - 1):
                    sm, ym = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                    if any(h0 < sm < h1 and ym < hh for (h0, h1, hh) in holes):
                        continue
                    q = [self.P(e, xs[i], ys[j]), self.P(e, xs[i + 1], ys[j]), self.P(e, xs[i + 1], ys[j + 1]), self.P(e, xs[i], ys[j + 1])]
                    mat = style["dado"] if ym < 1.2 else inner
                    md.face(q[::-1], mat, col=(0.7, 0.7, 0.7, 1.0) if ym < 1.2 else (0.85, 0.85, 0.85, 1.0))
        along_x = (cx1 - cx0) >= (cz1 - cz0)
        if not style["beams"]:
            self.interior_lights(it)
            return
        # beams across the short span, lights under every other one
        span0, span1 = (cx0, cx1) if along_x else (cz0, cz1)
        n = max(1, int((span1 - span0) / 4.0))
        for i in range(n + 1):
            a = span0 + 0.2 + i * (span1 - span0 - 0.4) / n
            if along_x:
                md.box(a - 0.09, ch - 0.34, cz0, a + 0.09, ch, cz1, "steel_blue", skip=("py", "nz", "pz"))
            else:
                md.box(cx0, ch - 0.34, a - 0.09, cx1, ch, a + 0.09, "steel_blue", skip=("py", "nx", "px"))
            if i % 2 == 1:
                for f in (0.33, 0.67):
                    if along_x:
                        cz = cz0 + (cz1 - cz0) * f
                        md.box(a - 0.1, ch - 0.6, cz - 0.6, a + 0.1, ch - 0.52, cz + 0.6, "lamp_led")
                        md.tube((a, ch - 0.52, cz), (a, ch - 0.34, cz), 0.008, "steel_dark", segments=4, caps=False)
                    else:
                        cx = cx0 + (cx1 - cx0) * f
                        md.box(cx - 0.6, ch - 0.6, a - 0.1, cx + 0.6, ch - 0.52, a + 0.1, "lamp_led")
                        md.tube((cx, ch - 0.52, a), (cx, ch - 0.34, a), 0.008, "steel_dark", segments=4, caps=False)
        if not style["lanes"]:
            return
        # painted aisle lines 1.4 m in from the long walls
        y = 0.006
        if along_x:
            for z in (cz0 + 1.4, cz1 - 1.4):
                if cz1 - cz0 > 4:
                    md.face_toward([(cx0 + 0.6, y, z - 0.05), (cx1 - 0.6, y, z - 0.05), (cx1 - 0.6, y, z + 0.05), (cx0 + 0.6, y, z + 0.05)],
                                   "paint_yellow", (0, 1, 0))
        else:
            for x in (cx0 + 1.4, cx1 - 1.4):
                if cx1 - cx0 > 4:
                    md.face_toward([(x - 0.05, y, cz0 + 0.6), (x + 0.05, y, cz0 + 0.6), (x + 0.05, y, cz1 - 0.6), (x - 0.05, y, cz1 - 0.6)],
                                   "paint_yellow", (0, 1, 0))

    def interior_lights(self, it):
        """Recessed light panels on a 2.4 m grid (interiors without exposed beams)."""
        cx0, cz0, cx1, cz1 = it["rect"]
        ch = it.get("clear", 3.2)
        nx, nz = max(1, int((cx1 - cx0) / 2.4)), max(1, int((cz1 - cz0) / 2.4))
        for i in range(nx):
            for j in range(nz):
                x = cx0 + (i + 0.5) * (cx1 - cx0) / nx
                z = cz0 + (j + 0.5) * (cz1 - cz0) / nz
                self.md.box(x - 0.3, ch - 0.03, z - 0.3, x + 0.3, ch, z + 0.3, "lamp_led", skip=("py",))

    # --- skyline pieces -----------------------------------------------------------------------------------
    def chimney(self):
        """Round brick chimney stack on a square plinth (backdrop)."""
        md = self.md
        x0, z0, x1, z1 = self.b["rect"]
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        r = min(x1 - x0, z1 - z0) / 2
        H = self.H
        md.box(x0, -0.2, z0, x1, 3.0, z1, "brick_factory_soot", skip=("ny",))
        md.box(x0 - 0.1, 3.0, z0 - 0.1, x1 + 0.1, 3.3, z1 + 0.1, "concrete_trim")
        md.cylinder((cx, 3.3, cz), r * 0.82, H - 3.3, "brick_factory_soot", segments=20, radius_top=r * 0.55, caps=(False, False))
        md.cylinder((cx, H, cz), r * 0.62, 0.6, "concrete_trim", segments=20, radius_top=r * 0.6, caps=(False, False))
        md.face_toward([(cx + math.cos(2 * math.pi * k / 20) * r * 0.6, H + 0.6, cz - math.sin(2 * math.pi * k / 20) * r * 0.6)
                        for k in range(20)], "steel_dark", (0, 1, 0))
        for y in (H * 0.35, H * 0.6, H * 0.85):
            rr = r * 0.82 + (r * 0.55 - r * 0.82) * (y - 3.3) / (H - 3.3)
            md.cylinder((cx, y, cz), rr + 0.05, 0.25, "steel_dark", segments=20, caps=(False, False))

    def tank(self):
        """Vertical storage tank with a cone roof and a ring walkway (backdrop)."""
        md = self.md
        x0, z0, x1, z1 = self.b["rect"]
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        r = min(x1 - x0, z1 - z0) / 2 - 0.2
        H = self.H
        md.cylinder((cx, -0.1, cz), r + 0.2, 0.4, "concrete_trim", segments=24, caps=(False, True))
        md.cylinder((cx, 0.3, cz), r, H - 0.3, "steel_white", segments=24, caps=(False, False))
        md.cylinder((cx, H, cz), r + 0.05, 1.6, "galvanized", segments=24, radius_top=0.6)
        md.cylinder((cx, H - 0.1, cz), r + 0.8, 0.08, "metal_plate", segments=24, caps=(True, True))
        for k in range(24):
            a = 2 * math.pi * k / 24
            px, pz = cx + math.cos(a) * (r + 0.75), cz - math.sin(a) * (r + 0.75)
            md.tube((px, H - 0.02, pz), (px, H + 1.0, pz), 0.02, "steel_yellow", segments=4)
        for y in (H * 0.33, H * 0.66):
            md.cylinder((cx, y, cz), r + 0.03, 0.12, "steel_grey", segments=24, caps=(False, False))
