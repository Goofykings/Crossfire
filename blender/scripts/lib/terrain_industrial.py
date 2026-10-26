"""Ground, docks, stairs, fences, walkway canopies, pipe bridges and road paint for the Industrial Complex.

Extends terrain.TerrainBuilder (1 m ground cells with contact darkening, team strips). Layout fields used beyond the
common schema: terraces[].style ("dock" | "platform"), terraces[].railings, walls[].style ("fence" | "concrete" |
"pillar"), arches[].style ("canopy" | "pipes"), ground zone materials (asphalt, concrete_floor, ...).

Z-fighting: paint, stains and patches use decal materials (polygon offset) and sit 4-8 mm above the ground; nosings,
manholes and bumpers stand at least 8 mm proud of the surfaces they touch.
"""
from __future__ import annotations

import math
import random

from collision_gen import stair_rects
from meshkit import MeshData
from terrain import TerrainBuilder, _in

class IndustrialTerrain(TerrainBuilder):
    gap_mat = "concrete_floor"
    base_mat = "asphalt"
    spawn_mats = {"blue": "concrete_spawn_blue", "red": "concrete_spawn_red"}
    # terrace / wall styles this class draws (subclasses add their own and call super for these)
    TERRACE_STYLES = ("dock", "platform")
    WALL_STYLES = ("fence", "concrete", "pillar")
    RAIL_MAT = "steel_yellow"

    def __init__(self, layout: dict):
        super().__init__(layout)
        self.rnd = random.Random(7)
        self.terrace_by_id = {t["id"]: t for t in layout["terraces"]}

    def build(self) -> MeshData:
        md = MeshData()
        self.ground(md)
        self.terraces(md)
        self.stairs(md)
        self.railings(md)
        self.walls(md)
        self.arches(md)
        self.markings(md)
        self.team_strips(md)
        self.details(md)
        L = self.lim + 20
        md.face([(-L, -0.06, -L), (-L, -0.06, L), (L, -0.06, L), (L, -0.06, -L)], self.base_mat, col=(0.5, 0.5, 0.5, 1.0))
        return md

    # --- ground ------------------------------------------------------------------------------------
    def ground(self, md: MeshData):
        lim = self.lim
        for (xi, zi), (kind, obj) in self.cell.items():
            x0, z0 = xi - lim, zi - lim
            if kind == "covered" and obj["kind"] in ("room", "interior", "doorway"):
                continue  # walk-in interiors build their own floor (exactly over cavity + doorways)
            if kind == "zone":
                h = obj["height"]
                mat = obj["material"]
                if obj["kind"] == "spawn":
                    mat = self.spawn_mats.get(obj.get("team"), mat)
            else:
                h = 0.0
                mat = self.gap_mat
            covered = kind == "covered"
            corner = {(i, j): self._vertex_color(x0 + i, z0 + j, covered) for i in (0, 1) for j in (0, 1)}

            def shade(x, z):
                u, v = x - x0, z - z0
                return tuple(corner[0, 0][c] * (1 - u) * (1 - v) + corner[1, 0][c] * u * (1 - v)
                             + corner[0, 1][c] * (1 - u) * v + corner[1, 1][c] * u * v for c in range(4))

            for (ax, az, bx, bz) in self._cell_minus_stairs(x0, z0):
                pts = [(ax, h, az), (ax, h, bz), (bx, h, bz), (bx, h, az)]
                md.face(pts, mat, col=[shade(p[0], p[2]) for p in pts])

    def _terrace_of(self, xi, zi):
        c = self.cell.get((xi, zi))
        if not c or c[0] != "zone":
            return None
        return self.terrace_by_id.get(c[1]["id"])

    # --- raised docks and platforms ---------------------------------------------------------------------
    def terraces(self, md: MeshData):
        lim = self.lim
        for t in self.L["terraces"]:
            style = t.get("style", "dock")
            if style not in self.TERRACE_STYLES:
                continue
            x0, z0, x1, z1 = (int(v) for v in t["rect"])
            h = t["height"]
            face_mat = {"dock": "concrete_wall_stained", "platform": "steel_grey"}.get(style, "concrete_wall_stained")
            for xi in range(x0 + lim, x1 + lim):
                for zi in range(z0 + lim, z1 + lim):
                    xc, zc = xi - lim + 0.5, zi - lim + 0.5
                    if any(_in(xc, zc, r) for r in self.stair_cells):
                        continue
                    for dx, dz, side in ((-1, 0, "w"), (1, 0, "e"), (0, -1, "n"), (0, 1, "s")):
                        nh = self._height_of_cell(xi + dx, zi + dz)
                        if nh is None or nh >= h - 1e-3:
                            continue
                        if any(_in(xc + dx, zc + dz, r) for r in self.stair_cells):
                            continue
                        X0, Z0 = xi - lim, zi - lim
                        a, b = {"w": ((X0, Z0 + 1), (X0, Z0)), "e": ((X0 + 1, Z0), (X0 + 1, Z0 + 1)),
                                "n": ((X0, Z0), (X0 + 1, Z0)), "s": ((X0 + 1, Z0 + 1), (X0, Z0 + 1))}[side]
                        out = (dx, 0, dz)
                        md.face_toward([(a[0], nh - 0.05, a[1]), (b[0], nh - 0.05, b[1]), (b[0], h, b[1]), (a[0], h, a[1])],
                                       face_mat, out)
                        self._edge_strip(md, a, b, dx, dz, h - 0.17, h - 0.03, 0.008, "hazard" if style == "dock" else "steel_yellow")
                        # steel angle along the top edge, 8 mm proud of the face and 8 mm above the deck
                        self._edge_box(md, a, b, dx, dz, h - 0.06, h + 0.008, -0.05, 0.016, "galvanized")
                        if style == "dock" and (xi + zi) % 2 == 0 and h > 0.8:
                            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                            self._bumper(md, mid, dx, dz, h)

    def _edge_strip(self, md, a, b, dx, dz, y0, y1, off, mat):
        """A band on a vertical edge face, `off` metres in front of it."""
        ox, oz = dx * off, dz * off
        md.face_toward([(a[0] + ox, y0, a[1] + oz), (b[0] + ox, y0, b[1] + oz), (b[0] + ox, y1, b[1] + oz), (a[0] + ox, y1, a[1] + oz)],
                       mat, (dx, 0, dz))

    def _edge_box(self, md, a, b, dx, dz, y0, y1, inner, outer, mat):
        """Box along an edge, from `inner` (negative: back over the deck) to `outer` metres past it."""
        xs = sorted((a[0], b[0]))
        zs = sorted((a[1], b[1]))
        if dx:
            lo, hi = sorted((a[0] + dx * inner, a[0] + dx * outer))
            md.box(lo, y0, zs[0], hi, y1, zs[1], mat, skip=("nz", "pz"))
        else:
            lo, hi = sorted((a[1] + dz * inner, a[1] + dz * outer))
            md.box(xs[0], y0, lo, xs[1], y1, hi, mat, skip=("nx", "px"))

    def _bumper(self, md, mid, dx, dz, h):
        """Rubber dock bumper on the dock face."""
        x, z = mid
        y0, y1 = h - 0.55, h - 0.2
        if dx:
            lo, hi = sorted((x + dx * 0.016, x + dx * 0.14))
            md.box(lo, y0, z - 0.14, hi, y1, z + 0.14, "rubber", skip=("nx",) if dx > 0 else ("px",))
        else:
            lo, hi = sorted((z + dz * 0.016, z + dz * 0.14))
            md.box(x - 0.14, y0, lo, x + 0.14, y1, hi, "rubber", skip=("nz",) if dz > 0 else ("pz",))

    def stairs(self, md: MeshData):
        """Concrete steps with painted nosings, and steel handrails along both sides of every run."""
        for t in self.L["terraces"]:
            for st, k, r, top in stair_rects(t):
                x0, z0, x1, z1 = r
                md.box(x0, -0.05, z0, x1, top, z1, "concrete_trim", skip=("ny",), col=(0.9, 0.9, 0.88, 1.0))
                side = st["side"]
                y = top + 0.006
                # yellow nosing paint along the step edge facing down the stairs
                if side == "w":
                    pts = [(x0, y, z0), (x0, y, z1), (x0 + 0.06, y, z1), (x0 + 0.06, y, z0)]
                elif side == "e":
                    pts = [(x1 - 0.06, y, z0), (x1 - 0.06, y, z1), (x1, y, z1), (x1, y, z0)]
                elif side == "n":
                    pts = [(x0, y, z0), (x0, y, z0 + 0.06), (x1, y, z0 + 0.06), (x1, y, z0)]
                else:
                    pts = [(x0, y, z1 - 0.06), (x0, y, z1), (x1, y, z1), (x1, y, z1 - 0.06)]
                md.face_toward(pts, "paint_yellow", (0, 1, 0))
            x0, z0, x1, z1 = t["rect"]
            for st in t["stairs"]:
                depth = st["steps"] * st["run"]
                h = t["height"]
                for lat in (st["from"] + 0.08, st["to"] - 0.08):
                    if st["side"] == "w":
                        a, b = (x0 - 0.3, 0.9, lat), (x0 + depth + 0.25, h + 0.9, lat)
                    elif st["side"] == "e":
                        a, b = (x1 + 0.3, 0.9, lat), (x1 - depth - 0.25, h + 0.9, lat)
                    elif st["side"] == "n":
                        a, b = (lat, 0.9, z0 - 0.3), (lat, h + 0.9, z0 + depth + 0.25)
                    else:
                        a, b = (lat, 0.9, z1 + 0.3), (lat, h + 0.9, z1 - depth - 0.25)
                    md.tube(a, b, 0.025, "steel_yellow", segments=6)
                    for p in (a, b):
                        base = 0.0 if p is a else h
                        md.tube((p[0], base, p[2]), (p[0], p[1], p[2]), 0.025, "steel_yellow", segments=6)

    def railings(self, md: MeshData):
        """Guard rails along terraces[].railings (collision boxes come from collision_gen.railing_boxes)."""
        for t in self.L["terraces"]:
            x0, z0, x1, z1 = t["rect"]
            h = t["height"]
            for r in t.get("railings", []):
                a, b = r["from"], r["to"]
                if r["side"] in ("n", "s"):
                    z = z0 + 0.04 if r["side"] == "n" else z1 - 0.04
                    ends = ((a, z), (b, z))
                else:
                    x = x0 + 0.04 if r["side"] == "w" else x1 - 0.04
                    ends = ((x, a), (x, b))
                (ax, az), (bx, bz) = ends
                L = math.hypot(bx - ax, bz - az)
                n = max(1, int(L / 1.2))
                for i in range(n + 1):
                    px, pz = ax + (bx - ax) * i / n, az + (bz - az) * i / n
                    md.tube((px, h, pz), (px, h + 1.05, pz), 0.025, self.RAIL_MAT, segments=6)
                for y in (h + 1.05, h + 0.55):
                    md.tube((ax, y, az), (bx, y, bz), 0.024, self.RAIL_MAT, segments=6)
                # toe board, just inboard of the edge angle (its faces must not share the angle's inner plane)
                inward = {"n": 1, "s": -1, "w": 1, "e": -1}[r["side"]]
                edge = {"n": z0, "s": z1, "w": x0, "e": x1}[r["side"]]
                lo, hi = sorted((edge + inward * 0.055, edge + inward * 0.075))
                if r["side"] in ("n", "s"):
                    md.box(min(ax, bx), h, lo, max(ax, bx), h + 0.12, hi, self.RAIL_MAT)
                else:
                    md.box(lo, h, min(az, bz), hi, h + 0.12, max(az, bz), self.RAIL_MAT)

    # --- fences and walls ---------------------------------------------------------------------------------
    def walls(self, md: MeshData):
        for w in self.L["walls"]:
            style = w.get("style", "concrete")
            if style not in self.WALL_STYLES:
                continue
            x0, z0, x1, z1 = w["rect"]
            H = w["height"]
            along_x = (x1 - x0) >= (z1 - z0)
            a0, a1 = (x0, x1) if along_x else (z0, z1)
            c0, c1 = (z0, z1) if along_x else (x0, x1)
            cm = (c0 + c1) / 2
            gates = sorted(((g["rect"][0], g["rect"][2]) if along_x else (g["rect"][1], g["rect"][3])) for g in w.get("gates", []))
            spans, cur = [], a0
            for ga, gb in gates:
                spans.append((cur, ga))
                cur = gb
            spans.append((cur, a1))

            def W(a, y, c):
                return (a, y, c) if along_x else (c, y, a)

            def box(alo, y0, ahi, y1, clo, chi, mat, skip=()):
                p, q = W(alo, y0, clo), W(ahi, y1, chi)
                md.box(min(p[0], q[0]), y0, min(p[2], q[2]), max(p[0], q[0]), y1, max(p[2], q[2]), mat, skip=skip)

            if style == "pillar":
                md.box(x0 + 0.05, -0.05, z0 + 0.05, x1 - 0.05, H, z1 - 0.05, "concrete_wall", skip=("ny",))
                md.box(x0, H, z0, x1, H + 0.12, z1, "concrete_trim")
                continue
            for (sa, sb) in spans:
                if sb - sa < 0.05:
                    continue
                if style == "fence":
                    n = max(1, int(round((sb - sa) / 2.5)))
                    for i in range(n + 1):
                        a = sa + (sb - sa) * i / n
                        md.tube(W(a, -0.05, cm), W(a, H + 0.08, cm), 0.035, "galvanized", segments=6)
                    md.tube(W(sa, H, cm), W(sb, H, cm), 0.025, "galvanized", segments=6)
                    md.tube(W(sa, 0.12, cm), W(sb, 0.12, cm), 0.015, "galvanized", segments=4)
                    mesh = [W(sa, 0.06, cm), W(sb, 0.06, cm), W(sb, H - 0.04, cm), W(sa, H - 0.04, cm)]
                    md.face_toward(mesh, "chainlink", (0, 0, 1) if along_x else (1, 0, 0))
                    # barbed wire strands on outrigger arms
                    for k, dy in enumerate((0.12, 0.24, 0.36)):
                        off = 0.08 + 0.06 * k
                        md.tube(W(sa, H + dy, cm + off), W(sb, H + dy, cm + off), 0.006, "steel_dark", segments=3, caps=False)
                else:
                    t = max(0.1, (c1 - c0) / 2)
                    box(sa, -0.05, sb, H, cm - t, cm + t, "concrete_panel", skip=("ny",))
                    box(sa - 0.0, H, sb, H + 0.1, cm - t - 0.05, cm + t + 0.05, "concrete_trim")
                    n = max(1, int(round((sb - sa) / 3.0)))
                    for i in range(1, n):
                        a = sa + (sb - sa) * i / n
                        for sgn in (-1, 1):
                            box(a - 0.15, -0.05, a + 0.15, H, cm + sgn * t, cm + sgn * (t + 0.06), "concrete_wall",
                                skip=(("nz" if sgn > 0 else "pz"),) if along_x else (("nx" if sgn > 0 else "px"),))
            # gate posts: heavier square posts either side of each opening
            post = max(0.12, (c1 - c0) / 2 + 0.03)  # always proud of the wall faces
            for ga, gb in gates:
                for a, sgn in ((ga, -1), (gb, 1)):
                    box(a + (0.0 if sgn > 0 else -0.24), -0.05, a + (0.24 if sgn > 0 else 0.0), H + 0.3, cm - post, cm + post, "steel_grey")

    # --- overhead structures --------------------------------------------------------------------------------
    def arches(self, md: MeshData):
        for a in self.L.get("arches", []):
            style = a.get("style", "canopy")
            x0, z0, x1, z1 = a["rect"]
            y = a["spring"]
            along_x = a["axis"] == "x"  # spans along this axis (from wall to wall)
            if style == "pipes":
                self._pipe_bridge(md, x0, z0, x1, z1, y, along_x)
            else:
                self._canopy(md, x0, z0, x1, z1, y, along_x)

    def _canopy(self, md, x0, z0, x1, z1, y, along_x):
        """Covered walkway roof between two buildings: steel beams wall to wall, sloped corrugated sheets, lamps."""
        ga, gb = (x0, x1) if along_x else (z0, z1)
        c0, c1 = (z0, z1) if along_x else (x0, x1)

        def W(a, yy, c):
            return (a, yy, c) if along_x else (c, yy, a)

        n = max(1, int((c1 - c0) / 2.2))
        for i in range(n + 1):
            c = c0 + 0.1 + i * (c1 - c0 - 0.2) / n
            p, q = W(ga, y, c - 0.06), W(gb, y + 0.22, c + 0.06)
            md.box(min(p[0], q[0]), y, min(p[2], q[2]), max(p[0], q[0]), y + 0.22, max(p[2], q[2]), "steel_dark", skip=("nx", "px") if along_x else ("nz", "pz"))
        rise = 0.35
        sheet = [W(ga, y + 0.22, c0 - 0.15), W(gb, y + 0.22, c0 - 0.15), W(gb, y + 0.22 + rise, c1 + 0.15), W(ga, y + 0.22 + rise, c1 + 0.15)]
        md.face_toward(sheet, "roof_corrugated", (0, 1, 0))
        under = [W(ga, y + 0.2, c0 - 0.15), W(gb, y + 0.2, c0 - 0.15), W(gb, y + 0.2 + rise, c1 + 0.15), W(ga, y + 0.2 + rise, c1 + 0.15)]
        md.face_toward(under, "cladding_grey", (0, -1, 0))
        mid = (ga + gb) / 2
        for c in (c0 + (c1 - c0) * 0.3, c0 + (c1 - c0) * 0.7):
            p, q = W(mid - 0.35, y - 0.06, c - 0.08), W(mid + 0.35, y, c + 0.08)
            md.box(min(p[0], q[0]), y - 0.06, min(p[2], q[2]), max(p[0], q[0]), y, max(p[2], q[2]), "lamp_led", skip=("py",))

    def _pipe_bridge(self, md, x0, z0, x1, z1, y, along_x):
        """Pipe rack spanning an alley: a steel ladder truss carrying four pipes."""
        ga, gb = (x0, x1) if along_x else (z0, z1)
        c0, c1 = (z0, z1) if along_x else (x0, x1)

        def W(a, yy, c):
            return (a, yy, c) if along_x else (c, yy, a)

        for c in (c0 + 0.05, c1 - 0.05):
            for yy in (y, y + 0.7):
                md.tube(W(ga, yy, c), W(gb, yy, c), 0.05, "steel_dark", segments=6)
        n = max(2, int((gb - ga) / 1.5))
        for i in range(n + 1):
            a = ga + i * (gb - ga) / n
            for c in (c0 + 0.05, c1 - 0.05):
                md.tube(W(a, y, c), W(a, y + 0.7, c), 0.03, "steel_dark", segments=5)
            md.tube(W(a, y + 0.05, c0 + 0.05), W(a, y + 0.05, c1 - 0.05), 0.03, "steel_dark", segments=5)
        span = c1 - c0
        # as many pipes as fit side by side (they must not intersect: their end caps would overlap)
        count = max(1, min(4, int(span / 0.3)))
        mats = ("steel_red", "galvanized", "steel_yellow", "steel_green")[:count]
        for k, m in enumerate(mats):
            c = c0 + span * (k + 0.5) / len(mats)
            r = min(0.08 + 0.03 * (k % 2), span / count * 0.4)
            md.tube(W(ga - 0.1, y + 0.09 + r, c), W(gb + 0.1, y + 0.09 + r, c), r, m, segments=10)

    # --- paint, stains and services ---------------------------------------------------------------------------
    def markings(self, md: MeshData):
        """Road paint: dashed centre lines on wide streets, edge lines, hatched bays in front of docks."""
        y = 0.006
        for zn in self.L["ground"]["zones"]:
            if zn["kind"] != "street" or zn.get("material") != "asphalt":
                continue
            x0, z0, x1, z1 = zn["rect"]
            w, d = x1 - x0, z1 - z0
            along_x = w >= d
            length, width = (w, d) if along_x else (d, w)
            if length < 6:
                continue
            c = (z0 + z1) / 2 if along_x else (x0 + x1) / 2
            if width >= 5.5:
                s = (x0 if along_x else z0) + 1.0
                end = (x1 if along_x else z1) - 1.0
                while s + 2.0 <= end:
                    self._paint(md, along_x, s, s + 2.0, c - 0.06, c + 0.06, y, "paint_white")
                    s += 4.0
            if width >= 4.5:
                for e in (((z0 if along_x else x0) + 0.35), ((z1 if along_x else x1) - 0.35)):
                    self._paint(md, along_x, (x0 if along_x else z0) + 0.4, (x1 if along_x else z1) - 0.4, e - 0.05, e + 0.05, y, "paint_yellow")
        # hatching in front of loading docks
        for t in self.L["terraces"]:
            if t.get("style", "dock") != "dock":
                continue
            x0, z0, x1, z1 = t["rect"]
            for side, (ox, oz) in (("n", (0, -1)), ("s", (0, 1)), ("w", (-1, 0)), ("e", (1, 0))):
                if any(st["side"] == side for st in t["stairs"]):
                    continue
                if side in ("n", "s"):
                    zline = z0 if side == "n" else z1
                    probe = (int(math.floor((x0 + x1) / 2)) + self.lim, int(math.floor(zline + oz * 1.5)) + self.lim)
                    if probe not in self.cell or self.cell[probe][0] != "zone" or self.cell[probe][1]["height"] > 0.05:
                        continue
                    zb, ze = sorted((zline + oz * 0.25, zline + oz * 2.0))
                    self._hatch(md, x0 + 0.3, x1 - 0.3, zb, ze, True, y)
                else:
                    xline = x0 if side == "w" else x1
                    probe = (int(math.floor(xline + ox * 1.5)) + self.lim, int(math.floor((z0 + z1) / 2)) + self.lim)
                    if probe not in self.cell or self.cell[probe][0] != "zone" or self.cell[probe][1]["height"] > 0.05:
                        continue
                    xb, xe = sorted((xline + ox * 0.25, xline + ox * 2.0))
                    self._hatch(md, z0 + 0.3, z1 - 0.3, xb, xe, False, y)

    @staticmethod
    def _paint(md, along_x, a0, a1, c0, c1, y, mat):
        if along_x:
            pts = [(a0, y, c0), (a0, y, c1), (a1, y, c1), (a1, y, c0)]
        else:
            pts = [(c0, y, a0), (c1, y, a0), (c1, y, a1), (c0, y, a1)]
        md.face_toward(pts, mat, (0, 1, 0))

    def _hatch(self, md, a0, a1, c0, c1, along_x, y):
        """Diagonal yellow hatching (45 degree bars) inside a box, plus its outline."""
        for (p, q) in (((a0, c0), (a1, c0 + 0.1)), ((a0, c1 - 0.1), (a1, c1))):
            self._paint(md, along_x, p[0], q[0], p[1], q[1], y, "paint_yellow")
        s = a0 + 0.4
        while s + 0.6 < a1:
            pa, pb = (s, c0 + 0.1), (s + (c1 - c0 - 0.2), c1 - 0.1)
            dx = 0.12
            if pb[0] > a1:
                break
            pts = [(pa[0], pa[1]), (pa[0] + dx, pa[1]), (pb[0] + dx, pb[1]), (pb[0], pb[1])]
            pts3 = [(u, y, v) if along_x else (v, y, u) for (u, v) in pts]
            md.face_toward(pts3, "paint_yellow", (0, 1, 0))
            s += 0.9

    def details(self, md: MeshData):
        """Oil stains and asphalt repairs (decals), manhole covers (raised 12 mm)."""
        rnd = self.rnd
        for zn in self.L["ground"]["zones"]:
            if zn["kind"] in ("spawn",) or zn["height"] > 0.05:
                continue
            x0, z0, x1, z1 = zn["rect"]
            area = (x1 - x0) * (z1 - z0)
            for _ in range(int(area / 40)):
                w, d = rnd.uniform(1.2, 2.6), rnd.uniform(1.0, 2.2)
                cx, cz = rnd.uniform(x0 + w / 2, x1 - w / 2) if x1 - x0 > w else (x0 + x1) / 2, \
                    rnd.uniform(z0 + d / 2, z1 - d / 2) if z1 - z0 > d else (z0 + z1) / 2
                # decal layers stay 3 mm apart: patches 3 mm, road paint 6 mm, stains 9 mm above the ground
                y = zn["height"] + 0.009
                md.face_toward([(cx - w / 2, y, cz - d / 2), (cx + w / 2, y, cz - d / 2), (cx + w / 2, y, cz + d / 2), (cx - w / 2, y, cz + d / 2)],
                               # UVs are metres (the material repeats every 3 m): one whole stain sheet per patch
                               "oil_stain", (0, 1, 0), uv=[(0, 0), (3, 0), (3, 3), (0, 3)])
            if zn.get("material") == "asphalt" and area > 30 and rnd.random() < 0.7:
                w, d = rnd.uniform(1.5, 3.5), rnd.uniform(1.2, 2.5)
                if x1 - x0 > w + 1 and z1 - z0 > d + 1:
                    cx, cz = rnd.uniform(x0 + w / 2 + 0.5, x1 - w / 2 - 0.5), rnd.uniform(z0 + d / 2 + 0.5, z1 - d / 2 - 0.5)
                    y = zn["height"] + 0.003
                    md.uv_offset = (rnd.uniform(0, 4), rnd.uniform(0, 4))
                    md.face_toward([(cx - w / 2, y, cz - d / 2), (cx + w / 2, y, cz - d / 2), (cx + w / 2, y, cz + d / 2),
                                    (cx - w / 2, y, cz + d / 2)], "asphalt_inlay", (0, 1, 0), col=(0.78, 0.78, 0.8, 1.0))
                    md.uv_offset = (0.0, 0.0)
            if area > 60 and rnd.random() < 0.6:
                cx, cz = (x0 + x1) / 2 + rnd.uniform(-1, 1), (z0 + z1) / 2 + rnd.uniform(-1, 1)
                if _in(cx, cz, zn["rect"]):
                    y = zn["height"]
                    md.cylinder((cx, y - 0.02, cz), 0.36, 0.032, "metal_plate", segments=14)
