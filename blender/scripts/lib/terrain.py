"""Streets, terraces, stairs, garden walls and flying arches for a map layout.

The ground is built on a 1 m grid so vertex colours can darken the cobbles where they meet walls
(cheap contact shadowing) and under covered passages. Everything is game-space MeshData.
"""
from __future__ import annotations

import math
import random

import building_spec as bs
from collision_gen import stair_rects
from meshkit import MeshData

ZONE_PRIORITY = {"spawn": 6, "plaza": 5, "court": 4, "terrace": 3, "yard": 2, "street": 1}


def _in(x, z, r):
    return r[0] <= x < r[2] and r[1] <= z < r[3]


def _point_in_poly(x, z, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            xi = x1 + (z - z1) * (x2 - x1) / (z2 - z1)
            if x < xi:
                inside = not inside
    return inside


class TerrainBuilder:
    def __init__(self, layout: dict):
        self.L = layout
        self.lim = layout["outerLimit"]
        self.play = layout["playArea"]
        self.rnd = random.Random(42)
        self.polys = [bs.footprint_polygon(b) for b in layout["buildings"]]
        self.stair_cells = []
        for t in layout["terraces"]:
            for st, k, r, top in stair_rects(t):
                self.stair_cells.append(r)
        self._grid()

    # --- classification ---------------------------------------------------------------------------
    def _grid(self):
        lim = self.lim
        n = lim * 2
        self.n = n
        self.cell = {}
        self.solid = [[False] * n for _ in range(n)]
        zones = sorted(self.L["ground"]["zones"], key=lambda z: ZONE_PRIORITY[z["kind"]])
        for zi in range(n):
            for xi in range(n):
                x, z = xi - lim + 0.5, zi - lim + 0.5
                zone = None
                for zn in zones:
                    if _in(x, z, zn["rect"]):
                        zone = zn  # later (higher priority) wins
                if zone is not None:
                    self.cell[(xi, zi)] = ("zone", zone)
                    continue
                cov = next((c for c in self.L["ground"]["covered"] if _in(x, z, c["rect"])), None)
                if cov is not None:
                    self.cell[(xi, zi)] = ("covered", cov)
                    continue
                if any(_in(x, z, w["rect"]) for w in self.L["walls"]):
                    self.solid[zi][xi] = True
                    continue
                if any(_point_in_poly(x, z, p) for p in self.polys):
                    self.solid[zi][xi] = True
                    continue
                if self.play[0] <= x <= self.play[2] and self.play[1] <= z <= self.play[3]:
                    self.cell[(xi, zi)] = ("gap", None)
                else:
                    self.solid[zi][xi] = True

    def _solid_at(self, xi, zi):
        if not (0 <= xi < self.n and 0 <= zi < self.n):
            return True
        return self.solid[zi][xi]

    def _vertex_color(self, x, z, covered=False):
        """Contact darkening from nearby solid cells + low-frequency dirt variation."""
        lim = self.lim
        xi, zi = int(round(x)) + lim, int(round(z)) + lim
        near = sum(self._solid_at(xi + dx, zi + dz) for dx in (-1, 0) for dz in (-1, 0))
        ring = sum(self._solid_at(xi + dx, zi + dz) for dx in (-2, -1, 0, 1) for dz in (-2, -1, 0, 1))
        k = 1.0 - 0.16 * near - 0.022 * ring
        k *= 0.93 + 0.07 * math.sin(x * 0.37 + math.cos(z * 0.21) * 2.0) * math.cos(z * 0.29 - x * 0.11)
        if covered:
            k *= 0.62
        k = max(0.42, min(1.0, k))
        return (k, k * 0.99, k * 0.97, 1.0)

    # --- builders -------------------------------------------------------------------------------
    def build(self) -> MeshData:
        md = MeshData()
        self.ground(md)
        self.terraces(md)
        self.stairs(md)
        self.walls(md)
        self.arches(md)
        self.gutters(md)
        self.team_strips(md)
        self.plaza_ring(md)
        # base plane far below so no gap can ever show the void
        L = self.lim + 20
        md.face([(-L, -0.06, -L), (-L, -0.06, L), (L, -0.06, L), (L, -0.06, -L)], "cobble", col=(0.5, 0.5, 0.5, 1.0))
        return md

    def ground(self, md: MeshData):
        lim = self.lim
        for (xi, zi), (kind, obj) in self.cell.items():
            x0, z0 = xi - lim, zi - lim
            if kind == "covered" and obj["kind"] == "room":
                continue
            if kind == "zone":
                h = obj["height"]
                mat = obj["material"]
                if obj["kind"] == "spawn":
                    mat = "slabs_blue" if obj.get("team") == "blue" else "slabs_red"
            else:
                h = 0.0
                mat = "cobble"
            covered = kind == "covered"
            corner = {(i, j): self._vertex_color(x0 + i, z0 + j, covered) for i in (0, 1) for j in (0, 1)}

            def shade(x, z):
                u, v = x - x0, z - z0
                return tuple(
                    corner[0, 0][c] * (1 - u) * (1 - v) + corner[1, 0][c] * u * (1 - v)
                    + corner[0, 1][c] * (1 - u) * v + corner[1, 1][c] * u * v
                    for c in range(4)
                )

            # Stairs stand on this ground: leave exactly their footprint out. (Skipping whole cells by their centre
            # left the top step overlapping neighbouring cells, and a hole where a step run is not a whole metre.)
            for (ax, az, bx, bz) in self._cell_minus_stairs(x0, z0):
                pts = [(ax, h, az), (ax, h, bz), (bx, h, bz), (bx, h, az)]
                md.face(pts, mat, col=[shade(p[0], p[2]) for p in pts])

    def _cell_minus_stairs(self, x0, z0):
        """The unit cell at (x0, z0) as rectangles that do not overlap any stair rectangle."""
        rects = [r for r in self.stair_cells if r[0] < x0 + 1 and r[2] > x0 and r[1] < z0 + 1 and r[3] > z0]
        if not rects:
            return [(x0, z0, x0 + 1, z0 + 1)]
        xs = sorted({x0, x0 + 1, *[min(max(v, x0), x0 + 1) for r in rects for v in (r[0], r[2])]})
        zs = sorted({z0, z0 + 1, *[min(max(v, z0), z0 + 1) for r in rects for v in (r[1], r[3])]})
        out = []
        for i in range(len(xs) - 1):
            for j in range(len(zs) - 1):
                if xs[i + 1] - xs[i] < 1e-6 or zs[j + 1] - zs[j] < 1e-6:
                    continue
                cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
                if not any(_in(cx, cz, r) for r in rects):
                    out.append((xs[i], zs[j], xs[i + 1], zs[j + 1]))
        return out

    def _height_of_cell(self, xi, zi):
        c = self.cell.get((xi, zi))
        if c is None:
            return None
        kind, obj = c
        return obj["height"] if kind == "zone" else 0.0

    def terraces(self, md: MeshData):
        """Retaining walls + coping where a raised zone meets lower open ground (not stairs)."""
        lim = self.lim
        for t in self.L["terraces"]:
            x0, z0, x1, z1 = (int(v) for v in t["rect"])
            h = t["height"]
            for xi in range(x0 + lim, x1 + lim):
                for zi in range(z0 + lim, z1 + lim):
                    xc, zc = xi - lim + 0.5, zi - lim + 0.5
                    if any(_in(xc, zc, r) for r in self.stair_cells):
                        continue
                    for dx, dz, side in ((-1, 0, "w"), (1, 0, "e"), (0, -1, "n"), (0, 1, "s")):
                        nh = self._height_of_cell(xi + dx, zi + dz)
                        if nh is None or nh >= h - 1e-3:
                            continue
                        nxc, nzc = xc + dx, zc + dz
                        if any(_in(nxc, nzc, r) for r in self.stair_cells):
                            continue
                        X0, Z0 = xi - lim, zi - lim
                        if side == "w":
                            a, b = (X0, Z0 + 1), (X0, Z0)
                        elif side == "e":
                            a, b = (X0 + 1, Z0), (X0 + 1, Z0 + 1)
                        elif side == "n":
                            a, b = (X0, Z0), (X0 + 1, Z0)
                        else:
                            a, b = (X0 + 1, Z0 + 1), (X0, Z0 + 1)
                        md.face([(a[0], nh - 0.05, a[1]), (b[0], nh - 0.05, b[1]), (b[0], h, b[1]), (a[0], h, a[1])],
                                "stone_blocks")
                        # coping stone along the edge
                        ox, oz = dx * 0.06, dz * 0.06
                        ix, iz = -dx * 0.3, -dz * 0.3
                        xa, xb = sorted((a[0], b[0]))
                        za, zb = sorted((a[1], b[1]))
                        if side in ("w", "e"):
                            md.box(min(a[0] + ox, a[0] + ix), h, za, max(a[0] + ox, a[0] + ix), h + 0.07, zb,
                                   "stone_trim", skip=("ny",))
                        else:
                            md.box(xa, h, min(a[1] + oz, a[1] + iz), xb, h + 0.07, max(a[1] + oz, a[1] + iz),
                                   "stone_trim", skip=("ny",))

    def stairs(self, md: MeshData):
        for t in self.L["terraces"]:
            for st, k, r, top in stair_rects(t):
                x0, z0, x1, z1 = r
                md.box(x0, -0.05, z0, x1, top, z1, "stone_blocks", skip=("ny",),
                       col=(0.92, 0.92, 0.9, 1.0))
                # worn nosing: a thin trim lip on the step edge facing down the stairs. It is 8 mm wider than the step
                # and 10 mm proud of the tread, so it shares no plane with the step's top or sides.
                side = st["side"]
                lip, w8, up = 0.04, 0.008, 0.01
                if side == "w":
                    md.box(x0 - lip, top - 0.05, z0 - w8, x0 + 0.05, top + up, z1 + w8, "stone_trim", skip=("ny",))
                elif side == "e":
                    md.box(x1 - 0.05, top - 0.05, z0 - w8, x1 + lip, top + up, z1 + w8, "stone_trim", skip=("ny",))
                elif side == "n":
                    md.box(x0 - w8, top - 0.05, z0 - lip, x1 + w8, top + up, z0 + 0.05, "stone_trim", skip=("ny",))
                else:
                    md.box(x0 - w8, top - 0.05, z1 - 0.05, x1 + w8, top + up, z1 + lip, "stone_trim", skip=("ny",))

    def walls(self, md: MeshData):
        for w in self.L["walls"]:
            x0, z0, x1, z1 = w["rect"]
            H = w["height"]
            if w["style"] == "pillar":
                md.box(x0 + 0.1, -0.05, z0 + 0.1, x1 - 0.1, H, z1 - 0.1, "stone_blocks", skip=("ny",))
                md.box(x0, H, z0, x1, H + 0.25, z1, "stone_trim", skip=())
                md.box(x0 + 0.25, H + 0.25, z0 + 0.25, x1 - 0.25, H + 0.6, z1 - 0.25, "stone_trim")
                md.box(x0 + 0.05, -0.05, z0 + 0.05, x1 - 0.05, 0.7, z1 - 0.05, "stone_trim", skip=("ny",))
                continue
            along_x = (x1 - x0) >= (z1 - z0)
            gates = sorted((g["rect"] for g in w["gates"]), key=lambda r: r[0] if along_x else r[1])
            a0, a1 = (x0, x1) if along_x else (z0, z1)
            c0, c1 = (z0, z1) if along_x else (x0, x1)

            def B(a_lo, y_lo, a_hi, y_hi, mat, skip=()):
                if along_x:
                    md.box(a_lo, y_lo, c0, a_hi, y_hi, c1, mat, skip=skip)
                else:
                    md.box(c0, y_lo, a_lo, c1, y_hi, a_hi, mat, skip=skip)

            cur = a0
            spans = []
            for g in gates:
                ga, gb = (g[0], g[2]) if along_x else (g[1], g[3])
                spans.append((cur, ga))
                spans.append(("gate", ga, gb))
                cur = gb
            spans.append((cur, a1))
            for si, sp in enumerate(spans):
                if sp[0] == "gate":
                    _, ga, gb = sp
                    self._gate(md, along_x, ga, gb, c0, c1, H)
                elif sp[1] - sp[0] > 1e-3:
                    # the end that meets a gateway is covered by the gate's own jamb face (same plane, other material)
                    skip = ["ny"]
                    if si + 1 < len(spans) and spans[si + 1][0] == "gate":
                        skip.append("px" if along_x else "pz")
                    if si > 0 and spans[si - 1][0] == "gate":
                        skip.append("nx" if along_x else "nz")
                    B(sp[0], -0.05, sp[1], H, "stone_rubble", skip=tuple(skip))
            # cap stones along the top
            if along_x:
                md.box(x0 - 0.06, H, z0 - 0.08, x1 + 0.06, H + 0.16, z1 + 0.08, "stone_trim")
            else:
                md.box(x0 - 0.08, H, z0 - 0.06, x1 + 0.08, H + 0.16, z1 + 0.06, "stone_trim")

    def _gate(self, md: MeshData, along_x, ga, gb, c0, c1, H):
        """Arched gateway through a wall: lintel mass, spandrels, vault soffit and voussoirs."""
        apex = bs.GATE_CLEAR
        rise = 0.6
        spring = apex - rise
        span = gb - ga
        R = (span * span / 4 + rise * rise) / (2 * rise)
        cy = apex - R
        cm = (ga + gb) / 2
        a0 = math.atan2(spring - cy, ga - cm)
        a1 = math.atan2(spring - cy, gb - cm)
        N = 10
        arc = [(cm + R * math.cos(a0 + (a1 - a0) * i / N), cy + R * math.sin(a0 + (a1 - a0) * i / N)) for i in range(N + 1)]

        def W(a, y, c):
            return (a, y, c) if along_x else (c, y, a)

        # mass above the apex
        if along_x:
            md.box(ga, apex, c0, gb, H, c1, "stone_rubble", skip=("ny",))
        else:
            md.box(c0, apex, ga, c1, H, gb, "stone_rubble", skip=("ny",))
        for c, sgn in ((c0, -1), (c1, 1)):
            for i in range(N):
                (pa, ya), (pb, yb) = arc[i], arc[i + 1]
                corner = (ga, apex) if i < N // 2 else (gb, apex)
                tri = [W(pa, ya, c), W(corner[0], corner[1], c), W(pb, yb, c)]
                self._orient(tri, (0, 0, sgn) if along_x else (sgn, 0, 0))
                md.face(tri, "stone_rubble")
                # voussoir ring proud of the face
                def off(p, e):
                    dx, dy = p[0] - cm, p[1] - cy
                    L = math.hypot(dx, dy)
                    return (p[0] + dx / L * e, p[1] + dy / L * e)
                po, qo = off(arc[i], 0.3), off(arc[i + 1], 0.3)
                cc = c + sgn * 0.04
                ring = [W(pa, ya, cc), W(pb, yb, cc), W(qo[0], qo[1], cc), W(po[0], po[1], cc)]
                self._orient(ring, (0, 0, sgn) if along_x else (sgn, 0, 0))
                md.face(ring, "stone_trim")
        # soffit (intrados) through the wall thickness
        for i in range(N):
            (pa, ya), (pb, yb) = arc[i], arc[i + 1]
            q = [W(pa, ya, c0), W(pb, yb, c0), W(pb, yb, c1), W(pa, ya, c1)]
            self._orient(q, (0, -1, 0))
            md.face(q, "stone_blocks")
        # jamb faces
        for a, sgn in ((ga, 1), (gb, -1)):
            q = [W(a, -0.05, c0), W(a, -0.05, c1), W(a, spring, c1), W(a, spring, c0)]
            self._orient(q, (sgn, 0, 0) if along_x else (0, 0, sgn))
            md.face(q, "stone_blocks")

    @staticmethod
    def _orient(pts, want):
        a, b, c = pts[0], pts[1], pts[2]
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        if n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0:
            pts.reverse()

    def arches(self, md: MeshData):
        """Plastered arches spanning lanes between buildings, capped with a small tiled roof."""
        for a in self.L.get("arches", []):
            x0, z0, x1, z1 = a["rect"]
            along_x = a["axis"] == "x"  # the arch spans along this axis
            ga, gb = (x0, x1) if along_x else (z0, z1)
            c0, c1 = (z0, z1) if along_x else (x0, x1)
            spring = a["spring"]
            span = gb - ga
            rise = min(1.0, span * 0.28)
            apex = spring + rise
            top = apex + 0.75
            R = (span * span / 4 + rise * rise) / (2 * rise)
            cy = apex - R
            cm = (ga + gb) / 2
            a0 = math.atan2(spring - cy, ga - cm)
            a1 = math.atan2(spring - cy, gb - cm)
            N = 12
            arc = [(cm + R * math.cos(a0 + (a1 - a0) * i / N), cy + R * math.sin(a0 + (a1 - a0) * i / N))
                   for i in range(N + 1)]

            def W(aa, y, c):
                return (aa, y, c) if along_x else (c, y, aa)

            mat = "plaster_white"
            for c, sgn in ((c0, -1), (c1, 1)):
                for i in range(N):
                    (pa, ya), (pb, yb) = arc[i], arc[i + 1]
                    tri = [W(pa, ya, c), W(ga if i < N // 2 else gb, top, c), W(pb, yb, c)]
                    self._orient(tri, (0, 0, sgn) if along_x else (sgn, 0, 0))
                    md.face(tri, mat)
                # the triangle above the crown between the two corner fans
                crown = [W(ga, top, c), W(cm, apex, c), W(gb, top, c)]
                self._orient(crown, (0, 0, sgn) if along_x else (sgn, 0, 0))
                md.face(crown, mat)
            for i in range(N):
                (pa, ya), (pb, yb) = arc[i], arc[i + 1]
                q = [W(pa, ya, c0), W(pb, yb, c0), W(pb, yb, c1), W(pa, ya, c1)]
                self._orient(q, (0, -1, 0))
                md.face(q, "stone_trim")
            # top and roof cap (gable along the arch)
            pitch_h = 0.35
            mid_c = (c0 + c1) / 2
            ov = 0.18
            for sgn, cc in ((-1, c0 - ov), (1, c1 + ov)):
                q = [W(ga - 0.05, top, cc), W(gb + 0.05, top, cc), W(gb + 0.05, top + pitch_h, mid_c),
                     W(ga - 0.05, top + pitch_h, mid_c)]
                self._orient(q, (0, 1, sgn * 0.2) if along_x else (sgn * 0.2, 1, 0))
                md.face(q, "roof_tiles")
                under = [W(ga - 0.05, top - 0.06, cc), W(gb + 0.05, top - 0.06, cc), W(gb + 0.05, top, c0 if sgn < 0 else c1),
                         W(ga - 0.05, top, c0 if sgn < 0 else c1)]
                self._orient(under, (0, -1, 0))
                md.face(under, "wood_beam")
            for aa in (ga - 0.05, gb + 0.05):
                tri = [W(aa, top, c0 - ov), W(aa, top, c1 + ov), W(aa, top + pitch_h, mid_c)]
                self._orient(tri, (1 if aa > cm else -1, 0, 0) if along_x else (0, 0, 1 if aa > cm else -1))
                md.face(tri, mat)
            # lantern hanging under the crown
            lx = cm
            p0 = W(lx, apex, mid_c)
            p1 = W(lx, apex - 0.5, mid_c)
            md.tube(p0, p1, 0.01, "iron", segments=4, caps=False)
            md.cylinder((p1[0], p1[1] - 0.32, p1[2]), 0.1, 0.3, "lantern_glass", segments=6)
            md.cylinder((p1[0], p1[1] - 0.04, p1[2]), 0.14, 0.05, "iron", segments=6, radius_top=0.04)

    def gutters(self, md: MeshData):
        """Flat slab drainage channels along the middle of longer streets."""
        for zn in self.L["ground"]["zones"]:
            if zn["kind"] != "street":
                continue
            x0, z0, x1, z1 = zn["rect"]
            w, d = x1 - x0, z1 - z0
            if max(w, d) < 6:
                continue
            y = zn["height"] + 0.006
            if w >= d:
                zc = (z0 + z1) / 2
                pts = [(x0, y, zc - 0.25), (x0, y, zc + 0.25), (x1, y, zc + 0.25), (x1, y, zc - 0.25)]
            else:
                xc = (x0 + x1) / 2
                pts = [(xc - 0.25, y, z0), (xc - 0.25, y, z1), (xc + 0.25, y, z1), (xc + 0.25, y, z0)]
            md.face(pts, "slabs_inlay", col=(0.8, 0.8, 0.78, 1.0))

    def team_strips(self, md: MeshData):
        """Thin glowing inlays on the ground along each safe zone boundary that faces open ground."""
        lim = self.lim
        for sz in self.L["safeZones"]:
            x0, z0, x1, z1 = sz["rect"]
            mat = "team_blue_glow" if sz["team"] == "blue" else "team_red_glow"
            y = 0.008
            # sample each boundary cell; inlay where the outside neighbour is walkable
            for side in ("n", "s", "w", "e"):
                if side in ("n", "s"):
                    zline = z0 if side == "n" else z1
                    for xi in range(int(x0), int(x1)):
                        out = (xi + 0.5, zline - 0.5 if side == "n" else zline + 0.5)
                        if (int(math.floor(out[0])) + lim, int(math.floor(out[1])) + lim) in self.cell:
                            zz = zline + (0.06 if side == "n" else -0.06)
                            md.face([(xi, y, zz - 0.05), (xi, y, zz + 0.05), (xi + 1, y, zz + 0.05), (xi + 1, y, zz - 0.05)], mat)
                else:
                    xline = x0 if side == "w" else x1
                    for zi in range(int(z0), int(z1)):
                        out = (xline - 0.5 if side == "w" else xline + 0.5, zi + 0.5)
                        if (int(math.floor(out[0])) + lim, int(math.floor(out[1])) + lim) in self.cell:
                            xx = xline + (0.06 if side == "w" else -0.06)
                            md.face([(xx - 0.05, y, zi), (xx - 0.05, y, zi + 1), (xx + 0.05, y, zi + 1), (xx + 0.05, y, zi)], mat)

    def plaza_ring(self, md: MeshData):
        """Decorative ring of darker paving around the well in the plaza."""
        for zn in self.L["ground"]["zones"]:
            if zn["kind"] != "plaza":
                continue
            cx = (zn["rect"][0] + zn["rect"][2]) / 2
            cz = (zn["rect"][1] + zn["rect"][3]) / 2
            r0, r1 = 1.6, 2.1
            N = 28
            for i in range(N):
                a, b = 2 * math.pi * i / N, 2 * math.pi * (i + 1) / N
                p = [(cx + math.cos(a) * r0, 0.007, cz - math.sin(a) * r0), (cx + math.cos(a) * r1, 0.007, cz - math.sin(a) * r1),
                     (cx + math.cos(b) * r1, 0.007, cz - math.sin(b) * r1), (cx + math.cos(b) * r0, 0.007, cz - math.sin(b) * r0)]
                self._orient(p, (0, 1, 0))
                md.face(p, "stone_inlay", col=(0.85, 0.85, 0.85, 1.0))
