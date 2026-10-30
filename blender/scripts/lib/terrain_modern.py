"""Streets, sidewalks, curbs, crossings, walls and overhead wires for the Modern City.

Extends the industrial terrain (ground cells, docks, stairs, fences, canopies, decals). Sidewalks are terraces with
style "sidewalk" (0.15 m, no stairs: within step height everywhere); their edges get a curb face and a curb stone
1.5 cm proud of the paving. Layout extras: walls[].style "brick" | "railing" (plus the industrial ones) and
`wires`: [{"a": [x, y, z], "b": [x, y, z]}] spans between utility poles.
"""
from __future__ import annotations

import math

from collision_gen import stair_rects
from meshkit import MeshData
from terrain_industrial import IndustrialTerrain

ROAD_MATS = ("asphalt_fine", "asphalt")


class ModernTerrain(IndustrialTerrain):
    gap_mat = "concrete_floor"
    base_mat = "asphalt_fine"
    spawn_mats = {"blue": "pavers_spawn_blue", "red": "pavers_spawn_red"}
    RAIL_MAT = "steel_dark"

    def build(self) -> MeshData:
        md = super().build()
        self.wires(md)
        return md

    # --- sidewalks and curbs ------------------------------------------------------------------------------
    def terraces(self, md: MeshData):
        lim = self.lim
        for t in self.L["terraces"]:
            if t.get("style") != "sidewalk":
                continue
            x0, z0, x1, z1 = (int(v) for v in t["rect"])
            h = t["height"]
            for xi in range(x0 + lim, x1 + lim):
                for zi in range(z0 + lim, z1 + lim):
                    c = self.cell.get((xi, zi))
                    if not c or c[0] != "zone" or c[1]["id"] != t["id"]:
                        continue  # overlapped by a higher-priority zone
                    for dx, dz, side in ((-1, 0, "w"), (1, 0, "e"), (0, -1, "n"), (0, 1, "s")):
                        nh = self._height_of_cell(xi + dx, zi + dz)
                        if nh is None or nh >= h - 1e-3:
                            continue
                        X0, Z0 = xi - lim, zi - lim
                        a, b = {"w": ((X0, Z0 + 1), (X0, Z0)), "e": ((X0 + 1, Z0), (X0 + 1, Z0 + 1)),
                                "n": ((X0, Z0), (X0 + 1, Z0)), "s": ((X0 + 1, Z0 + 1), (X0, Z0 + 1))}[side]
                        md.face_toward([(a[0], nh - 0.05, a[1]), (b[0], nh - 0.05, b[1]), (b[0], h, b[1]), (a[0], h, a[1])], "curb",
                                       (dx, 0, dz))
                        self._edge_box(md, a, b, dx, dz, h, h + 0.015, -0.28, 0.0, "curb")
        super().terraces(md)  # docks / platforms, if any

    def stairs(self, md: MeshData):
        """Stone steps (granite) with dark steel handrails."""
        for t in self.L["terraces"]:
            for st, k, r, top in stair_rects(t):
                x0, z0, x1, z1 = r
                md.box(x0, -0.05, z0, x1, top, z1, "granite", skip=("ny",), col=(0.92, 0.92, 0.9, 1.0))
            x0, z0, x1, z1 = t["rect"]
            for st in t["stairs"]:
                depth = st["steps"] * st["run"]
                h = t["height"]
                if h < 0.4:
                    continue
                for lat in (st["from"] + 0.08, st["to"] - 0.08):
                    a, b = {"w": ((x0 - 0.3, 0.9, lat), (x0 + depth + 0.25, h + 0.9, lat)),
                            "e": ((x1 + 0.3, 0.9, lat), (x1 - depth - 0.25, h + 0.9, lat)),
                            "n": ((lat, 0.9, z0 - 0.3), (lat, h + 0.9, z0 + depth + 0.25)),
                            "s": ((lat, 0.9, z1 + 0.3), (lat, h + 0.9, z1 - depth - 0.25))}[st["side"]]
                    md.tube(a, b, 0.022, "steel_dark", segments=6)
                    for p, base in ((a, 0.0), (b, h)):
                        md.tube((p[0], base, p[2]), p, 0.022, "steel_dark", segments=6)

    # --- walls --------------------------------------------------------------------------------------------
    def walls(self, md: MeshData):
        for w in self.L["walls"]:
            style = w.get("style", "concrete")
            if style not in ("brick", "railing"):
                continue
            x0, z0, x1, z1 = w["rect"]
            # Leave a masonry joint at adjoining lot / curb planes.
            x0,z0,x1,z1=x0+.015,z0+.015,x1-.015,z1-.015
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

            for (sa, sb) in spans:
                if sb - sa < 0.05:
                    continue
                if style == "brick":
                    t = max(0.12, (c1 - c0) / 2)
                    box(sa, -0.05, sb, H, cm - t, cm + t, "brick_city_brown", skip=("ny",))
                    box(sa - 0.03, H, sb + 0.03, H + 0.08, cm - t - 0.04, cm + t + 0.04, "concrete_trim")
                    n = max(1, int(round((sb - sa) / 2.8)))
                    for i in range(n + 1):
                        a = sa + 0.2 + i * (sb - sa - 0.4) / n
                        # piers stop under the coping (a pier top at the coping's top would share its plane)
                        box(a - 0.2, -0.05, a + 0.2, H, cm - t - 0.06, cm - t, "brick_city_brown",
                            skip=(("pz",) if along_x else ("px",)))
                        box(a - 0.2, -0.05, a + 0.2, H, cm + t, cm + t + 0.06, "brick_city_brown",
                            skip=(("nz",) if along_x else ("nx",)))
                        box(a - 0.24, H + 0.08, a + 0.24, H + 0.18, cm - t - 0.1, cm + t + 0.1, "concrete_trim")
                else:
                    # steel railing: posts, top and bottom rails, close vertical bars
                    n = max(1, int(round((sb - sa) / 2.0)))
                    for i in range(n + 1):
                        a = sa + (sb - sa) * i / n
                        box(a - 0.035, -0.05, a + 0.035, H + 0.05, cm - 0.035, cm + 0.035, "steel_dark")
                    for y in (0.12, H - 0.05):
                        md.tube(W(sa, y, cm), W(sb, y, cm), 0.022, "steel_dark", segments=5)
                    k = max(2, int((sb - sa) / 0.13))
                    for i in range(1, k):
                        a = sa + (sb - sa) * i / k
                        md.tube(W(a, 0.12, cm), W(a, H - 0.05, cm), 0.009, "steel_dark", segments=3, caps=False)
            for ga, gb in gates:
                for a, sgn in ((ga, -1), (gb, 1)):
                    box(a + (0.0 if sgn > 0 else -0.3), -0.05, a + (0.3 if sgn > 0 else 0.0), H + 0.25, cm - 0.18, cm + 0.18,
                        "brick_city_brown" if style == "brick" else "steel_dark")
        super().walls(md)  # fences, concrete walls, pillars

    # --- road markings ------------------------------------------------------------------------------------
    def _road(self, xi, zi):
        c = self.cell.get((xi + self.lim, zi + self.lim))
        return c is not None and c[0] == "zone" and c[1]["kind"] == "street" and c[1].get("material") in ROAD_MATS

    def markings(self, md: MeshData):
        y = 0.006  # between asphalt patches (3 mm) and stains (9 mm)
        for zn in self.L["ground"]["zones"]:
            if zn["kind"] != "street" or zn.get("material") not in ROAD_MATS:
                continue
            x0, z0, x1, z1 = zn["rect"]
            w, d = x1 - x0, z1 - z0
            along_x = w >= d
            length, width = (w, d) if along_x else (d, w)
            a0, a1 = (x0, x1) if along_x else (z0, z1)
            c0, c1 = (z0, z1) if along_x else (x0, x1)
            cm = (c0 + c1) / 2
            if length < 5:
                continue
            ends = []
            for end, sgn in ((a0, -1), (a1, 1)):
                probe = (end + sgn * 0.5, cm) if along_x else (cm, end + sgn * 0.5)
                ends.append(self._road(int(math.floor(probe[0])), int(math.floor(probe[1]))))
            # keep paint out of the junction squares
            m0 = a0 + (5.0 if ends[0] else 0.5)
            m1 = a1 - (5.0 if ends[1] else 0.5)
            if width >= 6 and m1 - m0 > 1:
                for off in (-0.1, 0.1):
                    self._paint(md, along_x, m0, m1, cm + off - 0.05, cm + off + 0.05, y, "paint_yellow")
            elif width >= 4.5 and m1 - m0 > 1:
                s = m0
                while s + 1.5 <= m1:
                    self._paint(md, along_x, s, s + 1.5, cm - 0.05, cm + 0.05, y, "paint_white")
                    s += 3.5
            if width >= 5 and m1 - m0 > 1:
                for e in (c0 + 0.3, c1 - 0.3):
                    self._paint(md, along_x, m0, m1, e - 0.05, e + 0.05, y, "paint_white")
            # zebra crossing and stop line where the road meets a junction
            for has, end, sgn in ((ends[0], a0, 1), (ends[1], a1, -1)):
                if not has or length < 9:
                    continue
                za, zb = sorted((end + sgn * 1.0, end + sgn * 4.0))
                k = c0 + 0.5
                while k + 0.5 <= c1 - 0.5:
                    # zebra bars run along the road, spaced across it
                    self._paint(md, along_x, za, zb, k, k + 0.5, y, "paint_white")
                    k += 1.0
                sa, sb = sorted((end + sgn * 4.6, end + sgn * 4.9))
                self._paint(md, along_x, sa, sb, c0 + 0.4, cm - 0.2 if width >= 6 else c1 - 0.4, y, "paint_white")

    def details(self, md: MeshData):
        super().details(md)
        # storm drains in the gutter where sidewalks meet roads: a grate 2 cm proud of the asphalt
        rnd = self.rnd
        for t in self.L["terraces"]:
            if t.get("style") != "sidewalk":
                continue
            x0, z0, x1, z1 = t["rect"]
            long_x = (x1 - x0) >= (z1 - z0)
            L = (x1 - x0) if long_x else (z1 - z0)
            for k in range(int(L // 14)):
                s = (x0 if long_x else z0) + 7 + k * 14 + rnd.uniform(-1, 1)
                for edge, sgn in (((z0, -1), (z1, 1)) if long_x else ((x0, -1), (x1, 1))):
                    px, pz = (s, edge + sgn * 0.35) if long_x else (edge + sgn * 0.35, s)
                    if not self._road(int(math.floor(px)), int(math.floor(pz))):
                        continue
                    if long_x:
                        md.box(px - 0.45, 0.0, pz - 0.2, px + 0.45, 0.02, pz + 0.2, "steel_dark", skip=("ny",))
                    else:
                        md.box(px - 0.2, 0.0, pz - 0.45, px + 0.2, 0.02, pz + 0.45, "steel_dark", skip=("ny",))
                    break

    # --- overhead wires -------------------------------------------------------------------------------------
    def wires(self, md: MeshData):
        for w in self.L.get("wires", []):
            a, b = w["a"], w["b"]
            sag = w.get("sag", 0.6)
            n = 8
            pts = []
            for i in range(n + 1):
                t = i / n
                pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t))
            for p, q in zip(pts, pts[1:]):
                md.tube(p, q, 0.012, "steel_dark", segments=3, caps=False)
