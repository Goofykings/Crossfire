"""Neon Backstreets ground and assembly (2026-11).

The ground is wet asphalt on the two roads and wet concrete in the alleys, crossing and court, in 1 m cells so the
light bake has vertices to colour. Sidewalks and shop floors are solid boxes of the structures (farmstead.py), so the
terrain leaves their rects out. Paint, crosswalks, puddles, drains and manholes lie a few millimetres above.
`build()` merges the structures, the vistas, the lit windows and the neon dressing (blender/scripts/lib/neon.py),
baking the coloured light pools into everything lit.
"""
from __future__ import annotations

import math

import farmstead
import neon
from meshkit import MeshData
from terrain_farm import subtract_rects, vnoise

VISTA_WALKS = [[-34.0, -20.0, -20.0, -18.5], [-34.0, -14.0, -20.45, -12.5]]


class NeonTerrain:
    def __init__(self, layout: dict):
        self.L = layout
        self.play = layout['playArea']
        self.lim = layout['outerLimit']
        zones = layout['ground']['zones']
        self.raised = [z['rect'] for z in zones if z.get('height', 0) > 0]
        self.streets = [z['rect'] for z in zones if z['kind'] == 'street']
        # closed footprints with their own floor boxes (west unit of the SE block)
        self.cut = list(self.raised) + [[3.3, 4.8, 6.2, 14.7]]

    # --- surfaces ------------------------------------------------------------------------------------------------
    def floor(self, x: float, z: float) -> float:
        for r in self.raised + VISTA_WALKS:
            if r[0] <= x <= r[2] and r[1] <= z <= r[3]:
                return 0.15
        return 0.0

    def material(self, x: float, z: float) -> str:
        if any(r[0] <= x <= r[2] and r[1] <= z <= r[3] for r in self.streets):
            return 'neon_asphalt'
        if self.play[0] <= x <= self.play[2] and self.play[1] <= z <= self.play[3]:
            return 'neon_concrete'
        return 'neon_asphalt'

    def shade(self, x, z):
        k = .86 + .1 * vnoise(x * .35, z * .35, 4) + .05 * vnoise(x * 1.3, z * 1.3, 8)
        return (k, k, k * 1.02, 1.0)

    def ground(self, md: MeshData):
        px0, pz0, px1, pz1 = self.play
        for x in range(int(px0), int(px1)):
            for z in range(int(pz0), int(pz1)):
                for r in subtract_rects((x, z, x + 1, z + 1), self.cut):
                    self.quad(md, r, self.material((r[0] + r[2]) / 2, (r[1] + r[3]) / 2))
        # outside the block (vistas, under the perimeter): coarse asphalt to the outer limit, then a far plane
        L = self.lim
        for X in range(-L, L, 4):
            for Z in range(-L, L, 4):
                cell = (X, Z, X + 4, Z + 4)
                for r in subtract_rects(cell, [tuple(self.play)] + [tuple(w) for w in VISTA_WALKS]):
                    self.quad(md, r, 'neon_asphalt')
        F = L + 220
        for r in subtract_rects((-F, -F, F, F), [(-L, -L, L, L)]):
            md.face([(r[0], -0.02, r[1]), (r[0], -0.02, r[3]), (r[2], -0.02, r[3]), (r[2], -0.02, r[1])], 'neon_asphalt', col=(.5, .5, .55, 1))

    def quad(self, md, r, mat):
        x0, z0, x1, z1 = r
        pts = [(x0, 0.0, z0), (x0, 0.0, z1), (x1, 0.0, z1), (x1, 0.0, z0)]
        md.face(pts, mat, col=[self.shade(p[0], p[2]) for p in pts])

    # --- paint, puddles, street furniture flush with the ground --------------------------------------------------------
    def markings(self, md: MeshData):
        y = 0.005

        def paint(x0, z0, x1, z1, mat='paint_white'):
            md.face_toward([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], mat, (0, 1, 0))
        # Neon Street: dashed centre line, a crosswalk at the noodle alley, no-parking yellow along the south curb
        x = -19.0
        while x < 19.0:
            if not (-5.6 < x < 0.2) and not (1.6 < x < 7.4):
                paint(x, -16.31, min(x + 2.0, 19.0), -16.19)
            x += 4.5
        for i in range(5):
            xs = -5.0 + i * 1.0
            paint(xs, -18.3, xs + .5, -14.2)
        paint(-20.0, -14.22, -14.0, -14.12, 'paint_yellow')
        paint(-8.8, -14.22, -5.6, -14.12, 'paint_yellow')
        # stop line and a painted turn arrow before the corner
        paint(12.9, -18.4, 13.06, -14.1)
        # east lane: dashed centre line and a crosswalk between the crossing and Bar 88
        z = -13.0
        while z < 14.5:
            if not (-3.4 < z < 0.0):
                paint(16.09, z, 16.21, min(z + 2.0, 14.8))
            z += 4.5
        for i in range(4):
            zs = -3.2 + i * .9
            paint(13.8, zs, 18.5, zs + .45)
        # loading-bay box in the back alley
        for a, b, c, d in ((-2.6, 16.0, 3.2, 16.1), (-2.6, 19.6, 3.2, 19.7), (-2.6, 16.0, -2.5, 19.7), (3.1, 16.0, 3.2, 19.7)):
            paint(a, b, c, d, 'paint_yellow')

    def puddles(self, md: MeshData):
        for cx, cz, rx, rz, rot in self.L['neon']['puddles']:
            y = self.floor(cx, cz) + 0.009
            a = math.radians(rot)
            ca, sa = math.cos(a), math.sin(a)
            pts = []
            for i in range(18):
                t = i / 18 * 2 * math.pi
                wob = 1 + .14 * math.sin(3 * t + cx) + .08 * math.sin(5 * t + cz)
                lx, lz = math.cos(t) * rx * wob, math.sin(t) * rz * wob
                pts.append((cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca))
            md.face_toward(pts, 'neon_puddle', (0, 1, 0))
            self.glints(md, cx, cz, rx, rz, y)
        # old oil and grime in the back alley and under the parked cars
        for cx, cz, s in ((-6.0, 17.0, 1.6), (6.0, 18.4, 1.2), (12.0, 16.0, 1.4), (17.6, 1.0, 1.8), (-11.5, -15.0, 1.5), (4.5, -17.4, 1.7)):
            md.face_toward([(cx - s, .002, cz - s * .6), (cx + s, .002, cz - s * .6), (cx + s, .002, cz + s * .6), (cx - s, .002, cz + s * .6)],
                           'oil_stain', (0, 1, 0))

    def glints(self, md: MeshData, cx, cz, rx, rz, y):
        """Neon reflected in a puddle: two additive streaks, each in the colour of one of the nearest lights (the puddle is
        a dark mirror, so it shows the signs around it, not the sky)."""
        near = sorted((s for s in self.L['neon']['bake'] if not s.get('room') and s['pos'][1] < 8),
                      key=lambda s: (s['pos'][0] - cx) ** 2 + (s['pos'][2] - cz) ** 2)[:3]
        if not near:
            return
        for i, src in enumerate(near[:2]):
            col = src['col']
            off = (-.3 if i == 0 else .3) * rx
            L = rz * 1.5 + .35
            x0, x1 = cx + off - .17, cx + off + .17
            z0, z1 = cz - L, cz + L
            yy = y + .0115
            steps = 4
            for k in range(steps):
                za, zb = z0 + (z1 - z0) * k / steps, z0 + (z1 - z0) * (k + 1) / steps
                va, vb = k / steps, (k + 1) / steps
                kk = .85 * (1 - abs((k + .5) / steps * 2 - 1) * .55)
                md.face_toward([(x0, yy, za), (x1, yy, za), (x1, yy, zb), (x0, yy, zb)], 'neon_wet', (0, 1, 0),
                               uv=[(0, va), (1, va), (1, vb), (0, vb)], col=(min(1, col[0] * kk), min(1, col[1] * kk), min(1, col[2] * kk), 1.0))

    def fixtures(self, md: MeshData):
        y = .013
        for x, z, along in ((-14.6, -14.3, 'x'), (-2.8, -14.3, 'x'), (9.5, -14.3, 'x'), (14.0, -6.0, 'z'), (18.3, 6.0, 'z'),
                            (-17.5, 15.4, 'x'), (5.2, 15.4, 'x'), (-2.0, 3.8, 'x'), (-17.5, -12.8, 'x')):
            hx, hz = (.3, .16) if along == 'x' else (.16, .3)
            md.face_toward([(x - hx, y, z - hz), (x + hx, y, z - hz), (x + hx, y, z + hz), (x - hx, y, z + hz)], 'steel_dark', (0, 1, 0))
            for k in range(-2, 3):
                o = k * .1
                bx0, bz0, bx1, bz1 = (x + o - .02, z - hz + .03, x + o + .02, z + hz - .03) if along == 'x' else (x - hx + .03, z + o - .02, x + hx - .03, z + o + .02)
                md.face_toward([(bx0, y + .004, bz0), (bx1, y + .004, bz0), (bx1, y + .004, bz1), (bx0, y + .004, bz1)], 'rubber', (0, 1, 0))
        for cx, cz in ((-8.0, -16.3), (6.5, -16.0), (16.1, 8.0), (-2.0, 1.0 + 1.5), (-17.0, 6.0), (2.0, 17.6)):
            if -3.4 < cx < -0.8 and -0.2 < cz < 1.6:
                continue
            pts = [(cx + math.cos(i / 10 * 2 * math.pi) * .36, y, cz + math.sin(i / 10 * 2 * math.pi) * .36) for i in range(10)]
            md.face_toward(pts, 'steel_dark', (0, 1, 0))

    # --- assembly ------------------------------------------------------------------------------------------------
    def covered(self):
        return [[0.3, -4.5, 12.2, -2.6], [6.5, 4.5, 9.5, 15.0], [1.6, 7.0, 3.0, 8.6]]

    def build(self) -> MeshData:
        lit = MeshData()
        self.ground(lit)
        lit.merge(farmstead.generate(self.L))
        lit.merge(neon.vista_mesh(self.L))
        md = neon.bake(lit, self.L, self.L['neon']['bake'], self.covered())
        md.merge(neon.window_mesh(self.L))
        self.markings(md)
        self.puddles(md)
        self.fixtures(md)
        md.merge(neon.dressing(self.L, self.floor))
        return md
