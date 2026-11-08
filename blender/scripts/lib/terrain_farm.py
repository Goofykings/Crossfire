"""Farmstead ground (2026-11): meadow, ragged dirt paths, interior floors, the base plane and the fence.

The meadow is one flat surface at y = 0. Dirt paths are the layout's 'street' zones; their edges are
roughened by smooth noise at 0.5 m resolution so they read as worn tracks, not painted rectangles.
Interior floors are the layout's 'court' zones and are drawn as exact rectangles (the grass is cut out
under them, so nothing is coplanar). Underground stairwell openings stay empty, as in TerrainBuilder.
"""
from __future__ import annotations

import math

import farmstead
from meshkit import MeshData


def _hash(ix: int, iz: int, seed: int = 7) -> float:
    n = (ix * 374761393 + iz * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x: float, z: float, seed: int = 7) -> float:
    """Smooth value noise in [-1, 1]."""
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    fx, fz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a, b = _hash(ix, iz, seed), _hash(ix + 1, iz, seed)
    c, d = _hash(ix, iz + 1, seed), _hash(ix + 1, iz + 1, seed)
    return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * 2 - 1


def rect_sdf(x: float, z: float, r) -> float:
    """Signed distance to an axis-aligned rect (negative inside)."""
    cx, cz = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
    hx, hz = (r[2] - r[0]) / 2, (r[3] - r[1]) / 2
    dx, dz = abs(x - cx) - hx, abs(z - cz) - hz
    return math.hypot(max(dx, 0), max(dz, 0)) + min(max(dx, dz), 0)


def subtract_rects(cell, cutters):
    """cell minus the union of cutters, as non-overlapping rects."""
    pieces = [tuple(cell)]
    for c in cutters:
        nxt = []
        for r in pieces:
            if c[0] >= r[2] or c[2] <= r[0] or c[1] >= r[3] or c[3] <= r[1]:
                nxt.append(r)
                continue
            if c[0] > r[0]:
                nxt.append((r[0], r[1], c[0], r[3]))
            if c[2] < r[2]:
                nxt.append((c[2], r[1], r[2], r[3]))
            x0, x1 = max(r[0], c[0]), min(r[2], c[2])
            if c[1] > r[1]:
                nxt.append((x0, r[1], x1, c[1]))
            if c[3] < r[3]:
                nxt.append((x0, c[3], x1, r[3]))
        pieces = nxt
    return [p for p in pieces if p[2] - p[0] > 1e-6 and p[3] - p[1] > 1e-6]


class FarmTerrain:
    FINE = 0.5

    def __init__(self, layout: dict):
        self.L = layout
        self.lim = layout['outerLimit']
        self.play = layout['playArea']
        zones = layout['ground']['zones']
        self.dirt = [z['rect'] for z in zones if z['material'] == 'dirt']
        self.floors = [z for z in zones if z['kind'] == 'court']
        from underground import ground_openings
        self.openings = [tuple(r) for r in ground_openings(layout)]
        self.footprints = [s['rect'] for s in farmstead.farm(layout)['structures']]

    # --- surface classification ---------------------------------------------------------------------------
    def dirt_sdf(self, x: float, z: float) -> float:
        return min((rect_sdf(x, z, r) for r in self.dirt), default=99.0)

    def is_dirt(self, x: float, z: float) -> bool:
        d = self.dirt_sdf(x, z)
        if d > 1.2:
            return False
        if d < -1.4:
            return True
        # ragged, slightly wavering edge: two noise octaves
        n = .6 * vnoise(x * 1.1, z * 1.1) + .4 * vnoise(x * 3.3, z * 3.3, 11)
        return d + n * .55 < 0

    def shade(self, x: float, z: float, dirt: bool) -> tuple:
        broad = vnoise(x * .09, z * .09, 3)
        mid = vnoise(x * .45, z * .45, 5)
        if dirt:
            d = self.dirt_sdf(x, z)
            k = .9 + .08 * broad + .05 * mid
            if d > -.5:
                k *= .93   # dusty, trodden edge
            return (k, k * .97, k * .93, 1.0)
        k = .9 + .14 * broad + .06 * mid
        # patchy light and dark meadow, a little yellower where the grass is thin
        r, g, b = k * (1.0 + .05 * mid), k, k * .94
        d = self.dirt_sdf(x, z)
        if 0 < d < .9:
            r, g, b = r * .9, g * .9, b * .86       # grass flattened beside the track
        for f in self.footprints:
            e = rect_sdf(x, z, f)
            if 0 < e < .9:
                a = .86 + .14 * (e / .9)              # contact shadow by walls
                r, g, b = r * a, g * a, b * a
        return (min(r, 1.1), min(g, 1.1), min(b, 1.1), 1.0)

    # --- builders -----------------------------------------------------------------------------------------------
    def build(self) -> MeshData:
        md = MeshData()
        self.interiors(md)
        self.meadow(md)
        self.base_plane(md)
        md.merge(farmstead.generate(self.L))
        return md

    def interiors(self, md: MeshData):
        """Exact floor rects, later zones on top of earlier ones."""
        zs = self.floors
        for i, z in enumerate(zs):
            cutters = [q['rect'] for q in zs[i + 1:]] + list(self.openings)
            for x0, z0, x1, z1 in subtract_rects(z['rect'], cutters):
                md.face([(x0, 0.0, z0), (x0, 0.0, z1), (x1, 0.0, z1), (x1, 0.0, z0)], z['material'], col=(.95, .95, .95, 1.0))

    def cutters(self):
        return [z['rect'] for z in self.floors] + list(self.openings)

    def meadow(self, md: MeshData):
        lim = self.lim
        px0, pz0, px1, pz1 = self.play
        near = (px0 - 3, pz0 - 3, px1 + 3, pz1 + 3)
        cutters = self.cutters()
        step = 4
        for X in range(-lim, lim, step):
            for Z in range(-lim, lim, step):
                coarse = (X, Z, X + step, Z + step)
                if coarse[2] < near[0] or coarse[0] > near[2] or coarse[3] < near[1] or coarse[1] > near[3]:
                    for piece in subtract_rects(coarse, cutters):
                        self.quad(md, piece, 'grass', outer=True)
                    continue
                for x in range(X, X + step):
                    for z in range(Z, Z + step):
                        self.cell(md, x, z, cutters)

    def cell(self, md, x, z, cutters):
        # one metre cell, split in four when a dirt edge or a structure edge crosses it
        c = (x, z, x + 1, z + 1)
        cx, cz = x + .5, z + .5
        dsd = self.dirt_sdf(cx, cz)
        edgey = abs(dsd) < 1.8 or any(abs(rect_sdf(cx, cz, f)) < 1.8 for f in self.footprints)
        if not edgey:
            # Away from every edge the whole cell is one surface: the path's middle is dirt, not meadow.
            dirt = dsd < 0
            for piece in subtract_rects(c, cutters):
                self.quad(md, piece, 'dirt' if dirt else 'grass', dirt=dirt)
            return
        h = self.FINE
        for i in range(2):
            for j in range(2):
                sub = (x + i * h, z + j * h, x + (i + 1) * h, z + (j + 1) * h)
                dirt = self.is_dirt(sub[0] + h / 2, sub[1] + h / 2)
                for piece in subtract_rects(sub, cutters):
                    self.quad(md, piece, 'dirt' if dirt else 'grass', dirt=dirt)

    def quad(self, md, r, mat, dirt=False, outer=False):
        x0, z0, x1, z1 = r
        pts = [(x0, 0.0, z0), (x0, 0.0, z1), (x1, 0.0, z1), (x1, 0.0, z0)]
        if outer:
            col = [(.8, .85, .78, 1.0)] * 4
        else:
            col = [self.shade(p[0], p[2], dirt) for p in pts]
        md.face(pts, mat, col=col)

    def base_plane(self, md: MeshData):
        # Far meadow: well past the fog distance, so no brown skirt or horizon edge shows beyond the play area.
        L = self.lim + 200
        rects = [(-L, -L, L, L)]
        for o in self.openings:
            rects = [p for r in rects for p in subtract_rects(r, [o])]
        for x0, z0, x1, z1 in rects:
            md.face([(x0, -0.06, z0), (x0, -0.06, z1), (x1, -0.06, z1), (x1, -0.06, z0)], 'grass', col=(0.72, 0.8, 0.64, 1.0))
