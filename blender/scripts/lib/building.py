"""Procedural townhouse generator.

`BuildingGenerator.generate(b)` turns one layout building entry into
  * a shell MeshData (walls with real openings and reveals, trims, roof, chimneys, passages, rooms)
  * a list of kit placements (windows, doors, shutters, balconies...) that the exporter turns into
    linked duplicates, i.e. shared meshes that the runtime GPU-instances.

Coordinates are game space (x east, y up, z south). Facade sides are walked along the footprint
polygon (counter-clockwise on a north-up plan); `s` is the distance along an edge and `d` the depth
into the wall (outward normal n, so a point is a + t*s - n*d).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import building_spec as bs
import kit
from catalog import FLOOR_HEIGHT_GROUND, FLOOR_HEIGHT_UPPER, PALETTES
from materials import wall_material
from meshkit import MeshData, Transform, ccw, grime_fn
from roof import Roof

PLASTER_WALLS = ("plaster", "plaster_red", "plaster_worn")


@dataclass
class Opening:
    s0: float
    s1: float
    y0: float
    y1: float
    kind: str  # window | door | shop | passage | roomdoor | balcony
    depth: float = kit.REVEAL
    style: str = ""
    spring: float = 0.0
    data: dict = field(default_factory=dict)


@dataclass
class KitPlacement:
    name: str
    factory: object  # callable returning MeshData
    xf: Transform


@dataclass
class Edge:
    a: tuple
    b: tuple
    t: tuple
    n: tuple
    length: float
    side: str  # n e s w or 'chamfer'


def edge_side(a, b, rect) -> str:
    x0, z0, x1, z1 = rect
    if abs(a[1] - b[1]) < 1e-6:
        return "n" if abs(a[1] - z0) < 1e-6 else "s"
    if abs(a[0] - b[0]) < 1e-6:
        return "w" if abs(a[0] - x0) < 1e-6 else "e"
    return "chamfer"


class BuildingGenerator:
    def __init__(self, index, detail: str = "full"):
        self.index = index
        self.detail = detail
        self.kits: dict[str, object] = {}

    # ------------------------------------------------------------------------------------------
    def generate(self, b: dict):
        self.b = b
        self.rnd = random.Random(b["seed"] * 7919 + 17)
        rnd = self.rnd
        pal = PALETTES[b["palette"]]
        self.pal = pal
        self.H = bs.eave_height(b)
        self.wall = wall_material(b["palette"])
        self.trim = "stone_trim"
        self.roof_mat = pal["roof"]
        self.shutter = f"shutter_{b['palette']}"
        self.door_mat = f"door_{b['palette']}"
        self.plaster = pal["wall"] in PLASTER_WALLS
        self.frame = "frame_white" if self.plaster and rnd.random() < 0.75 else "frame_dark"
        k = 1.0 + rnd.uniform(-0.07, 0.04)
        tint = (k * (1 + rnd.uniform(-0.03, 0.03)), k, k * (1 + rnd.uniform(-0.04, 0.02)), 1.0)
        self.base_tint = tint
        self.md = MeshData(grime_fn(tint, 0.0, self.H))
        self.md.uv_offset = (rnd.uniform(0, 5), rnd.uniform(0, 5))
        self.placements: list[KitPlacement] = []
        self.backdrop = b["type"] == "backdrop" or self.detail == "backdrop"
        self.win_w = rnd.choice((0.95, 1.0, 1.05, 1.1))
        self.win_h = rnd.choice((1.45, 1.5, 1.6))
        self.louvres = rnd.random() < 0.6
        self.has_string = self.plaster and rnd.random() < 0.7
        self.has_quoins = self.plaster and rnd.random() < 0.55 or (not self.plaster and rnd.random() < 0.25)
        self.plinth_h = rnd.choice((0.6, 0.75, 0.9))

        poly = ccw(bs.footprint_polygon(b))
        self.poly = poly
        edges = []
        for i in range(len(poly)):
            a, c = poly[i], poly[(i + 1) % len(poly)]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            t = ((c[0] - a[0]) / L, (c[1] - a[1]) / L)
            n = (-t[1], t[0])
            edges.append(Edge(a, c, t, n, L, edge_side(a, c, b["rect"])))
        self.edges = edges

        exposure = [self.edge_exposure(e) for e in edges]
        for e, exp in zip(edges, exposure):
            self.build_edge(e, exp)
        self.corner_details(edges, exposure)
        self.build_roof(edges, exposure)
        for p in b.get("passages", []):
            self.build_passage(p)
        for room in b.get("rooms", []):
            self.build_room(room)
        return self.md, self.placements

    # --- helpers --------------------------------------------------------------------------------
    def P(self, e: Edge, s: float, y: float, d: float = 0.0):
        return (e.a[0] + e.t[0] * s - e.n[0] * d, y, e.a[1] + e.t[1] * s - e.n[1] * d)

    def yaw_for(self, e: Edge) -> float:
        # local -z must map to the outward normal n: (-sin yaw, -cos yaw) = n
        return math.atan2(-e.n[0], -e.n[1])

    def place(self, name: str, factory, e: Edge, s: float, y: float, d: float = 0.0, yaw: float | None = None):
        p = self.P(e, s, y, d)
        self.placements.append(KitPlacement(name, factory, Transform(p[0], p[1], p[2], self.yaw_for(e) if yaw is None else yaw)))

    def edge_exposure(self, e: Edge):
        """Per 0.5 m sample along the edge: (kind, cover height)."""
        out = []
        n = max(1, int(round(e.length / 0.5)))
        for i in range(n):
            s = (i + 0.5) * e.length / n
            if e.side == "chamfer":
                # the cut corner lies inside our own rect but is always open ground
                out.append(("open", 0.0, s))
                continue
            x = e.a[0] + e.t[0] * s + e.n[0] * 0.35
            z = e.a[1] + e.t[1] * s + e.n[1] * 0.35
            kind, obj = self.index.classify(x, z)
            if kind == "covered":
                # A passage/room inside another building already has its own side wall facing us. A second facade on
                # the same plane would be coplanar with it (and z-fight), so treat it like any party wall.
                other = self.index.building_at(x, z)
                if other is not None and other["id"] != self.b["id"]:
                    out.append(("party", bs.eave_height(other), s))
                    continue
            if kind in ("open", "covered"):
                out.append(("open", 0.0, s))
            elif kind in ("building", "wall"):
                out.append(("party", self.index.neighbour_height(x, z), s))
            elif kind == "outside":
                out.append(("outside", 0.0, s))
            else:
                out.append(("party", self.H + 10, s))
        return out

    @staticmethod
    def runs(exp, kind):
        """Contiguous [s0, s1] ranges of samples with the given kind."""
        res = []
        step = exp[1][2] - exp[0][2] if len(exp) > 1 else (exp[0][2] * 2 if exp else 0)
        cur = None
        for k, _, s in exp:
            if k == kind:
                if cur is None:
                    cur = [s - step / 2, s + step / 2]
                else:
                    cur[1] = s + step / 2
            elif cur is not None:
                res.append(tuple(cur))
                cur = None
        if cur is not None:
            res.append(tuple(cur))
        return res

    def ground(self, e: Edge, s: float) -> float:
        x = e.a[0] + e.t[0] * s + e.n[0] * 0.4
        z = e.a[1] + e.t[1] * s + e.n[1] * 0.4
        return self.index.ground_at(x, z)

    # --- facades --------------------------------------------------------------------------------
    def build_edge(self, e: Edge, exp):
        md = self.md
        H = self.H
        open_runs = [r for r in self.runs(exp, "open") if r[1] - r[0] > 0.2]
        # blank wall wherever the side is not open: above the neighbour, or full height facing out
        for k, cov, s in exp:
            step = e.length / len(exp)
            s0, s1 = s - step / 2, s + step / 2
            if k == "open":
                continue
            y0 = -0.3 if k == "outside" else min(max(cov, -0.3), H)
            if y0 >= H - 1e-3:
                continue
            self.wall_rect(e, s0, s1, y0, H)
        if not open_runs:
            return
        openings = [] if self.backdrop else self.plan_openings(e, open_runs)
        for (r0, r1) in open_runs:
            ops = [o for o in openings if o.s0 >= r0 - 1e-6 and o.s1 <= r1 + 1e-6]
            self.facade_wall(e, r0, r1, ops)
            if not self.backdrop:
                self.trims(e, r0, r1, ops)
        for o in openings:
            self.dress_opening(e, o, openings)

    def wall_rect(self, e: Edge, s0, s1, y0, y1, bands=(0.6, 1.4)):
        ys = sorted({y0, y1, *[y for y in bands if y0 < y < y1], *([y1 - 0.6] if y1 - 0.6 > y0 else [])})
        for j in range(len(ys) - 1):
            self.md.quad(self.P(e, s0, ys[j]), self.P(e, s1, ys[j]), self.P(e, s1, ys[j + 1]), self.P(e, s0, ys[j + 1]),
                         self.wall)

    def plan_openings(self, e: Edge, open_runs):
        b = self.b
        rnd = self.rnd
        ops: list[Opening] = []
        side = e.side

        def free(s0, s1, y0, y1, pad=0.35):
            for o in ops:
                if s0 < o.s1 + pad and o.s0 - pad < s1 and y0 < o.y1 + 0.2 and o.y0 - 0.2 < y1:
                    return False
            return any(r0 + 0.3 <= s0 and s1 <= r1 - 0.3 for (r0, r1) in open_runs)

        def to_s(at):
            # layout 'at' is measured from the side's min coordinate (x0 for n/s, z0 for e/w)
            x0, z0, x1, z1 = b["rect"]
            if side in ("n", "s"):
                px = x0 + at
                return (px - e.a[0]) * e.t[0] + 0
            pz = z0 + at
            return (pz - e.a[1]) * e.t[1]

        # passages piercing this side
        for p in b.get("passages", []):
            px0, pz0, px1, pz1 = p["rect"]
            axis = bs.passage_axis(b, p)
            touches = (axis == "x" and side in ("w", "e")) or (axis == "z" and side in ("n", "s"))
            if not touches:
                continue
            if side in ("w", "e"):
                sa, sb = sorted(((pz0 - e.a[1]) * e.t[1], (pz1 - e.a[1]) * e.t[1]))
            else:
                sa, sb = sorted(((px0 - e.a[0]) * e.t[0], (px1 - e.a[0]) * e.t[0]))
            spring, apex, _ = bs.passage_profile(p)
            style = p.get("style", "arch")
            ops.append(Opening(sa, sb, -0.3, apex, "passage", depth=0.0, style=style, spring=spring))
        # walk-through room doorways
        for room in b.get("rooms", []):
            _, doors = bs.room_layout(b, room)
            for dside, (dx0, dz0, dx1, dz1) in doors:
                if dside != side:
                    continue
                if side in ("w", "e"):
                    sa, sb = sorted(((dz0 - e.a[1]) * e.t[1], (dz1 - e.a[1]) * e.t[1]))
                else:
                    sa, sb = sorted(((dx0 - e.a[0]) * e.t[0], (dx1 - e.a[0]) * e.t[0]))
                g = self.ground(e, (sa + sb) / 2)
                ops.append(Opening(sa, sb, -0.3, g + bs.ROOM_DOOR_H, "roomdoor", depth=bs.WALL_T))
        # shopfront
        sf = bs.shopfront_spec(b)
        if sf and sf["side"] == side:
            c = to_s(sf["at"])
            w = sf["width"]
            g = self.ground(e, c)
            if free(c - w / 2, c + w / 2, g, g + 2.4, pad=0.0):
                ops.append(Opening(c - w / 2, c + w / 2, -0.3, g + 2.4, "shop", data={"ground": g}))
        # doors from the layout
        for door in b.get("doors", []):
            if door["side"] != side:
                continue
            c = to_s(door["at"])
            w = door["width"]
            g = self.ground(e, c)
            h = 2.6 if w > 1.3 else 2.3
            if free(c - w / 2, c + w / 2, g, g + h, pad=0.25):
                ops.append(Opening(c - w / 2, c + w / 2, -0.3, g + h, "door", data={"ground": g, "double": w > 1.3}))
        # chamfered corner entrance
        if side == "chamfer" and e.length > 1.8:
            c = e.length / 2
            g = self.ground(e, c)
            if free(c - 0.6, c + 0.6, g, g + 2.6, pad=0.0):
                ops.append(Opening(c - 0.65, c + 0.65, -0.3, g + 2.6, "door", data={"ground": g, "double": True}))
        # window bays
        bay = rnd.uniform(2.5, 3.1)
        centers = []
        for (r0, r1) in open_runs:
            usable = (r1 - 0.75) - (r0 + 0.75)
            if usable < self.win_w:
                continue
            n = max(1, int(usable // bay) + 1)
            n = max(1, min(n, int((usable + 0.6) // 1.7) + 1))
            for i in range(n):
                centers.append(r0 + 0.75 + usable * (i + 0.5) / n)
        bal = bs.balcony_spec(b)
        floors = b["floors"]
        for f in range(floors):
            base = bs.floor_base(b, f)
            for c in centers:
                if f == 0:
                    g = self.ground(e, c)
                    y0 = g + 1.0
                    y1 = y0 + min(1.35, self.win_h)
                    w = self.win_w * 0.92
                    if free(c - w / 2, c + w / 2, -0.3, g + 2.8, pad=0.45):
                        ops.append(Opening(c - w / 2, c + w / 2, y0, y1, "window", data={"floor": 0}))
                    continue
                y0 = base + 0.85
                y1 = y0 + self.win_h
                w = self.win_w
                if f == floors - 1 and floors >= 3 and rnd.random() < 0.3:
                    y1 = y0 + self.win_h * 0.8
                if bal and bal["side"] == side and f == bal.get("floor", 1) and abs(to_s(bal["at"]) - c) < bal["width"] / 2:
                    continue
                if free(c - w / 2, c + w / 2, y0, y1, pad=0.3):
                    ops.append(Opening(c - w / 2, c + w / 2, y0, y1, "window", data={"floor": f}))
        if bal and bal["side"] == side:
            c = to_s(bal["at"])
            base = bal["y"]
            nwin = 2 if bal["width"] > 2.6 else 1
            for k in range(nwin):
                cx = c if nwin == 1 else c + (k - 0.5) * bal["width"] * 0.5
                w = 1.05
                ops.append(Opening(cx - w / 2, cx + w / 2, base + 0.02, base + 2.25, "balcony", data={"floor": bal["floor"]}))
            ops.append(Opening(c, c, base, base, "balcony_slab", data={"width": bal["width"], "depth": bal["depth"]}))
        return ops

    def facade_wall(self, e: Edge, r0: float, r1: float, ops):
        """Wall surface over [r0, r1] with rectangular holes, reveals and arch spandrels."""
        md = self.md
        H = self.H
        holes = [o for o in ops if o.s1 > o.s0 + 1e-6 and o.kind != "balcony_slab"]
        xs = sorted({r0, r1, *[o.s0 for o in holes], *[o.s1 for o in holes]})
        ys = sorted({-0.3, H, 0.6, 1.4, H - 0.6, *[o.y0 for o in holes], *[o.y1 for o in holes]})
        ys = [y for y in ys if -0.3 <= y <= H]
        streaks = [(o.s0, o.s1, o.y0) for o in holes if o.kind == "window"]

        def color(p, s, y):
            c = md.color_fn(p)
            for (a, bnd, sill) in streaks:
                if a + 0.05 < s < bnd - 0.05 and sill - 1.3 < y < sill - 0.01:
                    k = 0.84 + 0.16 * (sill - y) / 1.3
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
                md.face(P, self.wall, col=[color(p, s, y) for p, (s, y) in zip(P, pts)])
        for o in holes:
            if o.kind == "passage":
                if o.style == "arch":
                    self.arch_spandrel(e, o)
                continue
            d = o.depth
            mat = self.wall
            # jambs, head and (for windows) the sill bottom
            md.quad(self.P(e, o.s0, o.y0), self.P(e, o.s0, o.y0, d), self.P(e, o.s0, o.y1, d), self.P(e, o.s0, o.y1), mat)
            md.quad(self.P(e, o.s1, o.y0, d), self.P(e, o.s1, o.y0), self.P(e, o.s1, o.y1), self.P(e, o.s1, o.y1, d), mat)
            md.quad(self.P(e, o.s0, o.y1), self.P(e, o.s0, o.y1, d), self.P(e, o.s1, o.y1, d), self.P(e, o.s1, o.y1), mat)
            if o.kind in ("window", "balcony"):
                # windows get a stone sill piece whose top is the first part of this floor: start behind it
                d0 = min(kit.SILL_BACK, d) if o.kind == "window" else 0.0
                md.quad(self.P(e, o.s1, o.y0, d0), self.P(e, o.s1, o.y0, d), self.P(e, o.s0, o.y0, d), self.P(e, o.s0, o.y0, d0), mat)

    def arch_spandrel(self, e: Edge, o: Opening):
        """Fill between a segmental arch and its rectangular hole; add a voussoir ring."""
        md = self.md
        pts = self.arc_points(o.s0, o.s1, o.spring, o.y1, 12)
        mid = len(pts) // 2
        tl = (o.s0, o.y1)
        tr = (o.s1, o.y1)
        for k in range(len(pts) - 1):
            p, q = pts[k], pts[k + 1]
            corner = tl if k < mid else tr
            P = [self.P(e, s, y) for s, y in (p, corner, q)]
            # wind so the face points outward (same orientation as wall cells)
            nrm = _tri_normal(P)
            if nrm[0] * e.n[0] + nrm[2] * e.n[1] < 0:
                P = P[::-1]
            md.face(P, self.wall)
        if not self.backdrop:
            self.voussoirs(e, o, pts)

    @staticmethod
    def arc_points(s0, s1, spring, apex, n):
        span = s1 - s0
        rise = apex - spring
        if rise <= 1e-3:
            return [(s0 + span * i / n, spring) for i in range(n + 1)]
        R = (span * span / 4 + rise * rise) / (2 * rise)
        cy = apex - R
        cx = (s0 + s1) / 2
        a0 = math.atan2(spring - cy, s0 - cx)
        a1 = math.atan2(spring - cy, s1 - cx)
        return [(cx + R * math.cos(a0 + (a1 - a0) * i / n), cy + R * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]

    def voussoirs(self, e: Edge, o: Opening, pts):
        """Ring of stone blocks proud of the wall around an arch."""
        md = self.md
        band = 0.32
        span = o.s1 - o.s0
        rise = o.y1 - o.spring
        R = (span * span / 4 + rise * rise) / (2 * rise)
        cx, cy = (o.s0 + o.s1) / 2, o.y1 - R
        for k in range(len(pts) - 1):
            p, q = pts[k], pts[k + 1]
            # radial outward offsets
            def out(pt, extra):
                dx, dy = pt[0] - cx, pt[1] - cy
                L = math.hypot(dx, dy)
                return (pt[0] + dx / L * extra, pt[1] + dy / L * extra)
            pi, qi = out(p, 0), out(q, 0)
            po, qo = out(p, band + (0.06 if k % 2 else 0)), out(q, band + (0.06 if k % 2 else 0))
            dz = 0.05
            F = [self.P(e, s, y, -dz) for s, y in (qi, pi, po, qo)]
            nrm = _tri_normal(F[:3])
            if nrm[0] * e.n[0] + nrm[2] * e.n[1] < 0:
                F = F[::-1]
            md.face(F, self.trim)
            # outer edge
            md.face([self.P(e, po[0], po[1], -dz), self.P(e, po[0], po[1], 0.0), self.P(e, qo[0], qo[1], 0.0),
                     self.P(e, qo[0], qo[1], -dz)], self.trim)
        # impost blocks where the arch springs
        for s_, sgn in ((o.s0, -1), (o.s1, 1)):
            lo, hi = (s_ - 0.2, s_) if sgn < 0 else (s_, s_ + 0.2)
            self._edge_box(e, lo, hi, o.spring - 0.2, o.spring, -0.07, 0.0)

    def _edge_box(self, e: Edge, s0, s1, y0, y1, d0, d1, mat=None, skip_back=True, skip_ends=(False, False)):
        """Box aligned with the edge frame: s in [s0,s1], y in [y0,y1], depth in [d0,d1] (d<0 = outward)."""
        mat = mat or self.trim
        md = self.md
        A = lambda s, y, d: self.P(e, s, y, d)
        # front (outermost, d0)
        md.quad(A(s0, y0, d0), A(s1, y0, d0), A(s1, y1, d0), A(s0, y1, d0), mat)
        md.quad(A(s0, y1, d0), A(s1, y1, d0), A(s1, y1, d1), A(s0, y1, d1), mat)  # top
        md.quad(A(s0, y0, d1), A(s1, y0, d1), A(s1, y0, d0), A(s0, y0, d0), mat)  # bottom
        if not skip_ends[0]:
            md.quad(A(s0, y0, d1), A(s0, y0, d0), A(s0, y1, d0), A(s0, y1, d1), mat)  # start end
        if not skip_ends[1]:
            md.quad(A(s1, y0, d0), A(s1, y0, d1), A(s1, y1, d1), A(s1, y1, d0), mat)  # finish end
        if not skip_back:
            md.quad(A(s1, y0, d1), A(s0, y0, d1), A(s0, y1, d1), A(s1, y1, d1), mat)

    def run_end_cuts(self, e: Edge, r0: float, r1: float):
        """Which ends of an open run meet a neighbouring building's wall at a concave corner.

        There the neighbour's facade trim (running along its own wall) already fills the corner square, so our boxes
        would overlap it on the same planes. Exactly one of the two buildings stops short: the one with the lower id.
        """
        info = []
        for s, ahead in ((r0, -0.1), (r1, 0.1)):
            # one step past the run end, just outside the wall plane (past our own corner too: the neighbour's wall
            # may continue right there)
            sm = s + ahead
            kind, obj = self.index.classify(e.a[0] + e.t[0] * sm + e.n[0] * 0.35, e.a[1] + e.t[1] * sm + e.n[1] * 0.35)
            # or a building continuing the same facade line (its mass is just behind the wall plane there)
            along, _ = self.index.classify(e.a[0] + e.t[0] * sm - e.n[0] * 0.3, e.a[1] + e.t[1] * sm - e.n[1] * 0.3)
            perpendicular = kind == "building"
            info.append((perpendicular and obj["id"] > self.b["id"], perpendicular or along == "building"))
        return info

    def trims(self, e: Edge, r0: float, r1: float, ops):
        H = self.H
        (c0, p0), (c1, p1) = self.run_end_cuts(e, r0, r1)

        def run_box(a, c, y0, y1, d0, d1, mat=None):
            dep = abs(d0)
            at0, at1 = a <= r0 + 1e-6, c >= r1 - 1e-6
            if c0 and at0:
                a += dep
            if c1 and at1:
                c -= dep
            # an uncut end on a party plane is covered by the neighbour's own mass and trim: leave the end face out
            skip_ends = (p0 and not c0 and at0, p1 and not c1 and at1)
            if c > a + 1e-4:
                self._edge_box(e, a, c, y0, y1, d0, d1, mat, skip_ends=skip_ends)
        # plinth, interrupted by openings that reach the ground
        ground_ops = sorted([o for o in ops if o.y0 < 0.5 and o.s1 > o.s0], key=lambda o: o.s0)
        segs = []
        cur = r0
        for o in ground_ops:
            # doors have a stone surround proud of the wall: the plinth stops where it begins instead of
            # running into it (their side faces shared one plane)
            m0 = kit.SURROUND_B if o.kind == "door" else 0.0
            if o.s0 - m0 > cur + 0.05:
                segs.append((cur, o.s0 - m0))
            cur = max(cur, o.s1 + m0)
        if r1 > cur + 0.05:
            segs.append((cur, r1))
        pmat = "stone_blocks" if self.plaster else self.trim
        for (a, c) in segs:
            g = min(self.ground(e, a + 0.1), self.ground(e, c - 0.1))
            run_box(a, c, -0.3, g + self.plinth_h, -0.05, 0.0, pmat)
        # cornice: two stepped bands along the top
        run_box(r0, r1, H - 0.34, H - 0.16, -0.08, 0.0)
        run_box(r0, r1, H - 0.16, H + 0.02, -0.16, 0.0)
        # string courses between floors
        if self.has_string:
            for f in range(1, self.b["floors"]):
                y = bs.floor_base(self.b, f)
                run_box(r0, r1, y - 0.07, y + 0.07, -0.045, 0.0)

    @staticmethod
    def shutter_room(o: Opening, openings) -> bool:
        """True when both open shutter leaves fit beside window `o` without overlapping a neighbour.

        An open leaf folds flat against the wall, extending w/2 + 0.05 beyond each side of the window. Two neighbouring
        windows used to place their leaves on top of each other (same plane, different texture phase: z-fighting).
        """
        reach = (o.s1 - o.s0) / 2 + 0.05
        for p in openings:
            if p is o or p.s1 <= p.s0 or p.y1 < o.y0 - 0.1 or p.y0 > o.y1 + 0.1:
                continue
            other_reach = (p.s1 - p.s0) / 2 + 0.05 if p.kind == "window" else 0.2
            gap = o.s0 - p.s1 if p.s1 <= o.s0 + 1e-6 else p.s0 - o.s1 if p.s0 >= o.s1 - 1e-6 else -1.0
            if 0 <= gap < reach + other_reach - 1e-6:
                return False
            if gap < 0:  # overlapping openings: never fold out
                return False
        return True

    def dress_opening(self, e: Edge, o: Opening, openings=()):
        rnd = self.rnd
        w = o.s1 - o.s0
        c = (o.s0 + o.s1) / 2
        h = o.y1 - o.y0
        wk = round(w, 2)
        hk = round(h, 2)
        if o.kind == "window":
            fr = self.frame
            self.place(f"win_{wk}x{hk}_{fr}", lambda: kit.window(w, h, fr), e, c, o.y0)
            self.place(f"sill_{wk}", lambda: kit.sill(w), e, c, o.y0)
            if self.plaster and rnd.random() < 0.7:
                self.place(f"surround_{wk}x{hk}", lambda: kit.surround(w, h), e, c, o.y0)
            floor = o.data.get("floor", 1)
            if floor == 0 and rnd.random() < 0.55:
                self.place(f"grille_{wk}x{hk}", lambda: kit.grille(w, h), e, c, o.y0)
            else:
                r = rnd.random()
                sh, lv = self.shutter, self.louvres
                if r < 0.62 and not self.shutter_room(o, openings):
                    r = 0.7  # no room for open leaves: close them (random stream unchanged)
                if r < 0.62:
                    self.place(f"shut_open_{wk}x{hk}_{sh}_{int(lv)}", lambda: kit.shutters_open(w, h, sh, lv), e, c, o.y0)
                elif r < 0.8:
                    self.place(f"shut_closed_{wk}x{hk}_{sh}_{int(lv)}", lambda: kit.shutters_closed(w, h, sh, lv), e, c,
                               o.y0)
                if floor > 0 and rnd.random() < 0.3:
                    self.place(f"flowerbox_{wk}", lambda: kit.flower_box(w), e, c, o.y0)
        elif o.kind == "balcony":
            fr = self.frame
            self.place(f"win_{wk}x{hk}_{fr}_t", lambda: kit.window(w, h, fr, transom=True), e, c, o.y0)
            sh, lv = self.shutter, self.louvres
            if rnd.random() < 0.7 and self.shutter_room(o, openings):
                self.place(f"shut_open_{wk}x{hk}_{sh}_{int(lv)}", lambda: kit.shutters_open(w, h, sh, lv), e, c, o.y0)
        elif o.kind == "balcony_slab":
            bw, bd = o.data["width"], o.data["depth"]
            self.place(f"balcony_{round(bw, 2)}x{round(bd, 2)}", lambda: kit.balcony(bw, bd), e, c, o.y0)
        elif o.kind == "door":
            g = o.data["ground"]
            dbl = o.data.get("double", False)
            dh = o.y1 - g
            dm = self.door_mat
            self.place(f"door_{wk}x{round(dh, 2)}_{dm}_{int(dbl)}", lambda: kit.door(w, dh, dm, dbl), e, c, g)
            self.place(f"threshold_{wk}", lambda: kit.threshold(w), e, c, g)
            self.place(f"surround_{wk}x{round(dh, 2)}_d", lambda: kit.surround(w, dh, keystone=self.plaster), e, c, g)
        elif o.kind == "shop":
            g = o.data["ground"]
            idx = self.b["seed"] % 8
            aw = ("canvas_red", "canvas_green", None)[self.b["seed"] % 3]
            sh = o.y1 - g
            self.place(f"shop_{wk}x{round(sh, 2)}_{idx}_{aw}", lambda: kit.shopfront(w, sh, idx, aw), e, c, g)
            # hanging sign near the shop at first-floor height
            if e.length > w + 1.2:
                sc = o.s1 + 0.45 if o.s1 + 0.6 < e.length else o.s0 - 0.45
                self.place(f"hsign_{idx}", lambda: kit.hanging_sign(idx), e, sc, g + 3.0)

    def corner_details(self, edges, exposure):
        """Quoins and downspouts at corners where both adjoining faces are open."""
        if self.backdrop:
            return
        n = len(edges)
        H = self.H
        for i in range(n):
            e1 = edges[i]
            e2 = edges[(i + 1) % n]
            ex1, ex2 = exposure[i], exposure[(i + 1) % n]
            if not ex1 or not ex2 or ex1[-1][0] != "open" or ex2[0][0] != "open":
                continue
            if e1.side == "chamfer" or e2.side == "chamfer":
                continue
            if self.has_quoins:
                y = self.plinth_h + 0.02
                k = 0
                while y + 0.3 < H - 0.4:
                    long = k % 2 == 0
                    a, c = (0.55, 0.3) if long else (0.3, 0.55)
                    self._edge_box(e1, e1.length - a, e1.length, y, y + 0.3, -0.03, 0.0)
                    self._edge_box(e2, 0.0, c, y, y + 0.3, -0.03, 0.0)
                    y += 0.33
                    k += 1
            if self.rnd.random() < 0.45:
                # downspout down the corner on e1
                s = e1.length - 0.12
                top = H - 0.25
                g = self.ground(e1, s)
                pa = self.P(e1, s, top, -0.12)
                pb = self.P(e1, s, g + 0.35, -0.12)
                self.md.tube(pa, pb, 0.05, "copper", segments=6)
                pc = self.P(e1, s, g + 0.08, -0.32)
                self.md.tube(pb, pc, 0.05, "copper", segments=6)
                for y in (top - 0.6, (top + g) / 2, g + 0.8):
                    p1 = self.P(e1, s, y, -0.12)
                    p0 = self.P(e1, s, y, 0.0)
                    self.md.tube(p0, p1, 0.012, "iron", segments=4, caps=False)

    def build_roof(self, edges, exposure):
        b = self.b
        ridge = b["roof"]["ridge"]
        kinds = []
        no_over = []
        for e, exp in zip(edges, exposure):
            if b["roof"]["type"] == "hip" or e.side == "chamfer":
                kinds.append("eave")
            elif ridge == "x":
                kinds.append("eave" if e.side in ("n", "s") else "gable")
            else:
                kinds.append("eave" if e.side in ("e", "w") else "gable")
            no_over.append(any(k == "party" for k, _, _ in exp))
        pitch = bs.roof_pitch(b)
        roof = Roof(self.poly, kinds, self.H, pitch, no_overhang=no_over)
        wall_fn = grime_fn(self.base_tint, 0.0, self.H + 20)
        roof.build(self.md, self.roof_mat, "wood_beam", self.wall, wall_color_fn=wall_fn,
                   gutter_mat=None if self.backdrop else "copper")
        self.roof = roof
        if not self.backdrop or self.rnd.random() < 0.5:
            self.chimneys(roof)
        # rafter tails under eaves on open sides
        if not self.backdrop:
            for e, exp, k in zip(edges, exposure, kinds):
                if k != "eave" or any(kk == "party" for kk, _, _ in exp) or e.length < 2:
                    continue
                n = int(e.length / 0.6)
                for i in range(1, n):
                    s = i * e.length / n
                    y = self.H - 0.02
                    self._edge_box(e, s - 0.045, s + 0.045, y - 0.12, y, -0.34, 0.0, "wood_beam")

    def chimneys(self, roof: Roof):
        rnd = self.rnd
        x0, z0, x1, z1 = self.b["rect"]
        count = 1 if (x1 - x0) * (z1 - z0) < 60 else 2
        mat = {"plaster": "stone_blocks", "plaster_red": "brick", "plaster_worn": "brick"}.get(self.pal["wall"], self.wall)
        if mat.startswith("plaster"):
            mat = "stone_blocks"
        for k in range(count):
            fx = rnd.uniform(0.2, 0.8)
            fz = rnd.uniform(0.3, 0.7)
            cx = x0 + (x1 - x0) * fx
            cz = z0 + (z1 - z0) * fz
            w, d = rnd.uniform(0.5, 0.7), rnd.uniform(0.5, 0.8)
            top = roof.height(cx, cz) + rnd.uniform(0.6, 1.0)
            base = self.H - 0.2
            self.md.box(cx - w / 2, base, cz - d / 2, cx + w / 2, top, cz + d / 2, mat, skip=("ny",))
            self.md.box(cx - w / 2 - 0.06, top, cz - d / 2 - 0.06, cx + w / 2 + 0.06, top + 0.1, cz + d / 2 + 0.06,
                        "stone_trim")
            for j in range(rnd.choice((1, 2))):
                px = cx + (j - 0.5) * w * 0.4 if j else cx
                self.md.cylinder((px, top + 0.1, cz), 0.09, 0.32, "terracotta", segments=8, radius_top=0.075,
                                 caps=(False, True))

    # --- passages & rooms -----------------------------------------------------------------------
    def build_passage(self, p):
        b = self.b
        md = self.md
        px0, pz0, px1, pz1 = p["rect"]
        axis = bs.passage_axis(b, p)
        spring, apex, _ = bs.passage_profile(p)
        style = p.get("style", "arch")
        mat = self.wall if self.plaster is False else ("stone_blocks" if style == "arch" else self.wall)
        if axis == "x":
            a0, a1 = px0, px1  # along travel
            w0, w1 = pz0, pz1  # across
            def W(along, y, across):
                return (along, y, across)
        else:
            a0, a1 = pz0, pz1
            w0, w1 = px0, px1
            def W(along, y, across):
                return (across, y, along)
        top = spring if style == "arch" else apex
        # side walls facing into the passage
        for across, sgn in ((w0, 1), (w1, -1)):
            ys = [-0.3, 0.6, 1.4, top]
            for j in range(len(ys) - 1):
                q = [W(a0, ys[j], across), W(a1, ys[j], across), W(a1, ys[j + 1], across), W(a0, ys[j + 1], across)]
                n = _tri_normal(q[:3])
                want = (0, 0, sgn) if axis == "x" else (sgn, 0, 0)
                if n[0] * want[0] + n[2] * want[2] < 0:
                    q = q[::-1]
                md.face(q, mat)
        if style == "arch":
            pts = self.arc_points(w0, w1, spring, apex, 12)
            for k in range(len(pts) - 1):
                (sa, ya), (sb, yb) = pts[k], pts[k + 1]
                q = [W(a0, ya, sa), W(a0, yb, sb), W(a1, yb, sb), W(a1, ya, sa)]
                n = _tri_normal(q[:3])
                if n[1] > 0:
                    q = q[::-1]
                md.face(q, mat)
        else:
            q = [W(a0, apex, w0), W(a1, apex, w0), W(a1, apex, w1), W(a0, apex, w1)]
            if _tri_normal(q[:3])[1] > 0:
                q = q[::-1]
            md.face(q, "wood_dark")
            # ceiling beams across the passage
            n = int((a1 - a0) / 0.7)
            for i in range(n + 1):
                a = a0 + 0.2 + i * (a1 - a0 - 0.4) / max(1, n)
                if axis == "x":
                    md.box(a - 0.07, apex - 0.18, w0, a + 0.07, apex, w1, "wood_beam", skip=("py",))
                else:
                    md.box(w0, apex - 0.18, a - 0.07, w1, apex, a + 0.07, "wood_beam", skip=("py",))
            # heavy lintels at both ends
            for a in (a0 + 0.12, a1 - 0.12):
                if axis == "x":
                    md.box(a - 0.14, apex - 0.32, w0 - 0.15, a + 0.14, apex + 0.02, w1 + 0.15, "wood_beam")
                else:
                    md.box(w0 - 0.15, apex - 0.32, a - 0.14, w1 + 0.15, apex + 0.02, a + 0.14, "wood_beam")
        # bridge buildings: the whole footprint is the passage, so close the faces above the opening
        # on the open ends are handled by the facade; nothing else needed here.

    def build_room(self, room):
        b = self.b
        md = self.md
        (cx0, cz0, cx1, cz1), doors = bs.room_layout(b, room)
        clear = room.get("clear", 3.0)
        imat = "interior_plaster"
        # floor and ceiling
        md.face([(cx0, 0.02, cz0), (cx0, 0.02, cz1), (cx1, 0.02, cz1), (cx1, 0.02, cz0)], "interior_floor",
                col=(0.85, 0.85, 0.85, 1.0))
        md.face([(cx0, clear, cz0), (cx1, clear, cz0), (cx1, clear, cz1), (cx0, clear, cz1)], imat,
                col=(0.7, 0.7, 0.7, 1.0))
        n = int((cx1 - cx0) / 0.8) if (cx1 - cx0) >= (cz1 - cz0) else int((cz1 - cz0) / 0.8)
        for i in range(n + 1):
            if (cx1 - cx0) >= (cz1 - cz0):
                a = cx0 + 0.15 + i * (cx1 - cx0 - 0.3) / max(1, n)
                md.box(a - 0.08, clear - 0.2, cz0, a + 0.08, clear, cz1, "wood_beam", skip=("py",))
            else:
                a = cz0 + 0.15 + i * (cz1 - cz0 - 0.3) / max(1, n)
                md.box(cx0, clear - 0.2, a - 0.08, cx1, clear, a + 0.08, "wood_beam", skip=("py",))
        # inward-facing walls with doorway holes
        sides = {
            "n": ((cx1, cz0), (cx0, cz0)),
            "s": ((cx0, cz1), (cx1, cz1)),
            "w": ((cx0, cz0), (cx0, cz1)),
            "e": ((cx1, cz1), (cx1, cz0)),
        }
        door_by_side = {s: r for s, r in doors}
        for side, (a, c) in sides.items():
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            t = ((c[0] - a[0]) / L, (c[1] - a[1]) / L)
            # interior faces look inward: use the edge frame reversed (normal = -outward)
            e = Edge(a, c, t, (-t[1], t[0]), L, side)
            hole = None
            if side in door_by_side:
                dx0, dz0, dx1, dz1 = door_by_side[side]
                if side in ("n", "s"):
                    s_a = (dx0 - a[0]) * t[0]
                    s_b = (dx1 - a[0]) * t[0]
                else:
                    s_a = (dz0 - a[1]) * t[1]
                    s_b = (dz1 - a[1]) * t[1]
                hole = (min(s_a, s_b), max(s_a, s_b))
            xs = sorted({0.0, L, *(hole or ())})
            ys = [0.0, 0.5, bs.ROOM_DOOR_H, clear]
            for i in range(len(xs) - 1):
                for j in range(len(ys) - 1):
                    sm, ym = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                    if hole and hole[0] < sm < hole[1] and ym < bs.ROOM_DOOR_H:
                        continue
                    q = [self.P(e, xs[i], ys[j]), self.P(e, xs[i + 1], ys[j]), self.P(e, xs[i + 1], ys[j + 1]),
                         self.P(e, xs[i], ys[j + 1])]
                    q = q[::-1]  # face into the room
                    md.face(q, imat, col=(0.82, 0.8, 0.78, 1.0) if ys[j] > 0.4 else (0.6, 0.58, 0.55, 1.0))
            # wainscot shelf + a hanging lantern for some warmth
        mx, mz = (cx0 + cx1) / 2, (cz0 + cz1) / 2
        md.tube((mx, clear - 0.2, mz), (mx, clear - 0.7, mz), 0.01, "iron", segments=4)
        md.cylinder((mx, clear - 1.0, mz), 0.12, 0.3, "lantern_glass", segments=6)
        md.cylinder((mx, clear - 0.72, mz), 0.15, 0.06, "iron", segments=6, radius_top=0.05)


def _tri_normal(P):
    a, b, c = P[0], P[1], P[2]
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    L = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
    return (n[0] / L, n[1] / L, n[2] / L)


# exported for the floor-height constants used in docs/tests
__all__ = ["BuildingGenerator", "KitPlacement", "FLOOR_HEIGHT_GROUND", "FLOOR_HEIGHT_UPPER"]
