"""Pitched roofs over any convex footprint.

Each footprint edge is either an "eave" edge (a roof plane rises inward from it at the pitch) or a
"gable" edge (vertical end wall). The roof surface is the lower envelope of the eave planes, so the
same code produces gable roofs, hip roofs and hips over chamfered corners. Overhangs are made by
evaluating the envelope over the footprint offset outward per edge.

Plan polygons are (x, z) wound counter-clockwise on a north-up plan (see meshkit.ccw), giving
outward edge normals n = normalize(-dz, dx).
"""
from __future__ import annotations

import math

from meshkit import MeshData


def _edge_normal(a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz)
    return (-dz / L, dx / L)


def _line_intersect(p, d, q, e):
    """Intersection of p + t d and q + s e (2D)."""
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-9:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + d[0] * t, p[1] + d[1] * t)


def offset_polygon(poly, offsets):
    """Offset each edge i (poly[i] -> poly[i+1]) outward by offsets[i]; returns the new vertices."""
    n = len(poly)
    lines = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        nx, nz = _edge_normal(a, b)
        o = offsets[i]
        lines.append(((a[0] + nx * o, a[1] + nz * o), (b[0] - a[0], b[1] - a[1])))
    out = []
    for i in range(n):
        p, d = lines[i - 1]
        q, e = lines[i]
        pt = _line_intersect(p, d, q, e)
        out.append(pt if pt else q)
    return out


def clip_halfplane(poly, a, b, c):
    """Keep the part of the polygon where a*x + b*z + c <= 0."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp = a * p[0] + b * p[1] + c
        fq = a * q[0] + b * q[1] + c
        if fp <= 1e-9:
            out.append(p)
        if (fp < -1e-9 and fq > 1e-9) or (fp > 1e-9 and fq < -1e-9):
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    # drop duplicates
    clean = []
    for p in out:
        if not clean or abs(p[0] - clean[-1][0]) > 1e-7 or abs(p[1] - clean[-1][1]) > 1e-7:
            clean.append(p)
    if len(clean) > 1 and abs(clean[0][0] - clean[-1][0]) < 1e-7 and abs(clean[0][1] - clean[-1][1]) < 1e-7:
        clean.pop()
    return clean if len(clean) >= 3 else []


class Roof:
    def __init__(self, poly, kinds, eave_y, pitch, overhang=0.38, verge=0.22, thickness=0.17,
                 no_overhang=None):
        """kinds[i] in {"eave", "gable"}; no_overhang[i] True suppresses the overhang (party walls)."""
        self.poly = poly
        self.kinds = kinds
        self.eave_y = eave_y
        self.tanp = math.tan(pitch)
        self.T = thickness
        n = len(poly)
        self.planes = {}
        for i in range(n):
            if kinds[i] != "eave":
                continue
            a = poly[i]
            nx, nz = _edge_normal(a, poly[(i + 1) % n])
            # h(p) = eave + tanp * dot(a - p, n)
            self.planes[i] = (-self.tanp * nx, -self.tanp * nz, eave_y + self.tanp * (a[0] * nx + a[1] * nz))
        no_overhang = no_overhang or [False] * n
        offs = [0.0 if no_overhang[i] else (overhang if kinds[i] == "eave" else verge) for i in range(n)]
        self.offs = offs
        self.expanded = offset_polygon(poly, offs)

    def height(self, x, z):
        if not self.planes:
            return self.eave_y
        return min(a * x + b * z + c for (a, b, c) in self.planes.values())

    def faces(self):
        """[(plane_index, polygon over the expanded footprint)] for every visible roof plane."""
        out = []
        if not self.planes:
            return [(None, list(self.expanded))]
        for i, (a, b, c) in self.planes.items():
            region = list(self.expanded)
            for j, (a2, b2, c2) in self.planes.items():
                if j == i:
                    continue
                region = clip_halfplane(region, a - a2, b - b2, c - c2)
                if not region:
                    break
            if region:
                out.append((i, region))
        return out

    def ridge_height(self):
        best = self.eave_y
        for _, poly in self.faces():
            for (x, z) in poly:
                best = max(best, self.height(x, z))
        return best

    def build(self, md: MeshData, roof_mat: str, fascia_mat: str, wall_mat: str | None,
              wall_color_fn=None, gutter_mat: str | None = "copper", cap: bool = True):
        T = self.T
        faces = self.faces()
        h = self.height
        for i, poly in faces:
            top = [(x, h(x, z), z) for (x, z) in poly]
            md.face(top, roof_mat)
            md.face([(x, y - T, z) for (x, y, z) in reversed(top)], fascia_mat)
        # fascia / verge boards around the expanded outline
        ex = self.expanded
        n = len(ex)
        for k in range(n):
            a, b = ex[k], ex[(k + 1) % n]
            pts = self._edge_profile(a, b)
            # Edges without overhang (party walls) lie exactly on the wall plane. The wall / gable wall already runs up
            # to the roof surface there, so a fascia board over the same span would be coplanar with it (z-fighting).
            wa, wb = self.poly[k], self.poly[(k + 1) % n]
            wall_len = math.hypot(wb[0] - wa[0], wb[1] - wa[1])
            wdx, wdz = (wb[0] - wa[0]) / wall_len, (wb[1] - wa[1]) / wall_len
            flush = self.offs[k] == 0.0 and wall_mat is not None
            for j in range(len(pts) - 1):
                p, q = pts[j], pts[j + 1]
                if flush:
                    mid = ((p[0] + q[0]) / 2 - wa[0]) * wdx + ((p[1] + q[1]) / 2 - wa[1]) * wdz
                    if 1e-4 < mid < wall_len - 1e-4:
                        continue
                hp, hq = h(*p), h(*q)
                md.face([(p[0], hp - T, p[1]), (q[0], hq - T, q[1]), (q[0], hq, q[1]), (p[0], hp, p[1])], fascia_mat)
        # gable walls over the original outline
        if wall_mat:
            pn = len(self.poly)
            for k in range(pn):
                if self.kinds[k] != "gable":
                    continue
                a, b = self.poly[k], self.poly[(k + 1) % pn]
                prof = self._edge_profile(a, b)
                pts = [(a[0], self.eave_y, a[1]), (b[0], self.eave_y, b[1])]
                for p in reversed(prof):
                    y = h(*p)
                    if y > self.eave_y + 1e-4:
                        pts.append((p[0], y, p[1]))
                if len(pts) >= 3:
                    md.face(pts, wall_mat, col=None if wall_color_fn is None else [wall_color_fn(p) for p in pts])
        if cap:
            self._caps(md, roof_mat, faces)
        if gutter_mat:
            for k in range(len(self.poly)):
                if self.kinds[k] != "eave":
                    continue
                a, b = ex[k], ex[(k + 1) % n]
                if math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5:
                    continue
                nx, nz = _edge_normal(a, b)
                ya = h(*a) - T - 0.06
                yb = h(*b) - T - 0.06
                o = 0.06
                md.tube((a[0] + nx * o, ya, a[1] + nz * o), (b[0] + nx * o, yb, b[1] + nz * o), 0.065, gutter_mat,
                        segments=6)

    def _edge_profile(self, a, b):
        """Points along segment a-b including every crease of the roof envelope."""
        ts = {0.0, 1.0}
        planes = list(self.planes.values())
        for i in range(len(planes)):
            for j in range(i + 1, len(planes)):
                (a1, b1, c1), (a2, b2, c2) = planes[i], planes[j]
                fa = (a1 - a2) * a[0] + (b1 - b2) * a[1] + (c1 - c2)
                fb = (a1 - a2) * b[0] + (b1 - b2) * b[1] + (c1 - c2)
                if (fa < 0 < fb) or (fb < 0 < fa):
                    ts.add(fa / (fa - fb))
        return [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in sorted(ts)]

    def _caps(self, md: MeshData, mat: str, faces):
        """Ridge/hip capping along edges shared by two roof planes."""
        seen = set()
        h = self.height
        edges = []
        for _, poly in faces:
            for k in range(len(poly)):
                a, b = poly[k], poly[(k + 1) % len(poly)]
                key = tuple(sorted(((round(a[0], 3), round(a[1], 3)), (round(b[0], 3), round(b[1], 3)))))
                if key in seen:
                    edges.append((a, b))
                else:
                    seen.add(key)
        for a, b in edges:
            pa = (a[0], h(*a), a[1])
            pb = (b[0], h(*b), b[1])
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz)
            if L < 0.2:
                continue
            nx, nz = -dz / L * 0.16, dx / L * 0.16
            up = 0.1
            for s in (1, -1):
                md.face([(pa[0] + nx * s, pa[1] - 0.04, pa[2] + nz * s), (pb[0] + nx * s, pb[1] - 0.04, pb[2] + nz * s),
                         (pb[0], pb[1] + up, pb[2]), (pa[0], pa[1] + up, pa[2])][:: s], mat)
