"""Geometry accumulation in GAME coordinates (x east, y up, z south) -> Blender objects.

All generators build `MeshData` with plain Python lists, then `to_object()` converts once:
Blender (bx, by, bz) = (x, -z, y). That mapping is a proper rotation, so face winding is kept and
the glTF exporter's +Y-up conversion brings everything back to game coordinates exactly.

Faces are given counter-clockwise when viewed from outside. UVs default to a world-space
projection in metres (u along the face's horizontal tangent, v up the face), so textures keep a
constant density everywhere and the runtime controls repeat size per material.
"""
from __future__ import annotations

import math
from typing import Callable, Iterable, Sequence

Vec = tuple[float, float, float]
Color = tuple[float, float, float, float]

WHITE: Color = (1.0, 1.0, 1.0, 1.0)


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a: Vec) -> Vec:
    L = math.sqrt(dot(a, a))
    return (a[0] / L, a[1] / L, a[2] / L) if L > 1e-12 else (0.0, 1.0, 0.0)


def lerp(a: Vec, b: Vec, t: float) -> Vec:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def face_normal(pts: Sequence[Vec]) -> Vec:
    # Newell's method: robust for any planar polygon
    nx = ny = nz = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    return norm((nx, ny, nz))


def signed_area(poly: Sequence[tuple[float, float]]) -> float:
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
               for i in range(len(poly))) / 2


def ccw(poly: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    """Wind a plan polygon counter-clockwise on a north-up plan (negative signed area in (x, z))."""
    return list(poly) if signed_area(poly) < 0 else list(reversed(poly))


def world_uv(p: Vec, n: Vec) -> tuple[float, float]:
    if abs(n[1]) > 0.999:
        return (p[0], -p[2]) if n[1] > 0 else (p[0], p[2])
    t = norm(cross((0.0, 1.0, 0.0), n))
    b = cross(n, t)
    return (dot(p, t), dot(p, b))


class Transform:
    """Yaw (about +y, right-handed) then translation; enough for every placement in this project."""

    def __init__(self, tx=0.0, ty=0.0, tz=0.0, yaw=0.0, scale=1.0):
        self.t = (tx, ty, tz)
        self.c = math.cos(yaw)
        self.s = math.sin(yaw)
        self.k = scale

    def point(self, p: Vec) -> Vec:
        x, y, z = p[0] * self.k, p[1] * self.k, p[2] * self.k
        return (x * self.c + z * self.s + self.t[0], y + self.t[1], -x * self.s + z * self.c + self.t[2])


class MeshData:
    def __init__(self, color_fn: Callable[[Vec], Color] | None = None):
        self.verts: list[Vec] = []
        self.faces: list[list[int]] = []
        self.face_mat: list[str] = []
        self.face_uv: list[list[tuple[float, float]]] = []
        self.face_col: list[list[Color]] = []
        self.color_fn = color_fn
        self.uv_offset = (0.0, 0.0)

    def __len__(self) -> int:
        return len(self.faces)

    # --- primitives ---------------------------------------------------------------------------
    def face(self, pts: Sequence[Vec], mat: str, uv: Sequence[tuple[float, float]] | None = None,
             col: Sequence[Color] | Color | None = None, uv_scale: float = 1.0) -> None:
        if len(pts) < 3:
            return
        n = face_normal(pts)
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(list(range(base, base + len(pts))))
        self.face_mat.append(mat)
        if uv is None:
            ou, ov = self.uv_offset
            uv = [((u + ou) * uv_scale, (v + ov) * uv_scale) for (u, v) in (world_uv(p, n) for p in pts)]
        self.face_uv.append(list(uv))
        if col is None:
            cols = [self.color_fn(p) if self.color_fn else WHITE for p in pts]
        elif isinstance(col[0], (int, float)):
            cols = [col] * len(pts)  # type: ignore[list-item]
        else:
            cols = list(col)  # type: ignore[arg-type]
        self.face_col.append(cols)

    def face_toward(self, pts: Sequence[Vec], mat: str, toward: Vec, **kw) -> None:
        """Add a face, flipping its winding if needed so the normal points along `toward`."""
        n = face_normal(pts)
        if dot(n, toward) < 0:
            pts = list(reversed(pts))
            if kw.get("uv") is not None:
                kw["uv"] = list(reversed(kw["uv"]))
        self.face(pts, mat, **kw)

    def quad(self, a: Vec, b: Vec, c: Vec, d: Vec, mat: str, **kw) -> None:
        self.face([a, b, c, d], mat, **kw)

    def box(self, x0, y0, z0, x1, y1, z1, mat: str, skip: Iterable[str] = (), mats: dict | None = None,
            **kw) -> None:
        """Axis-aligned box. `skip` omits faces: 'px','nx','py','ny','pz','nz'."""
        skip = set(skip)
        m = mats or {}
        P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        faces = {
            "nz": (1, 0, 3, 2), "pz": (4, 5, 6, 7), "nx": (0, 4, 7, 3),
            "px": (5, 1, 2, 6), "py": (3, 7, 6, 2), "ny": (0, 1, 5, 4),
        }
        for k, idx in faces.items():
            if k in skip:
                continue
            self.face([P[i] for i in idx], m.get(k, mat), **kw)

    def obox(self, center: Vec, half: Vec, yaw: float, mat: str, skip: Iterable[str] = (), **kw) -> None:
        """Box rotated about +y."""
        tmp = MeshData()
        tmp.box(-half[0], -half[1], -half[2], half[0], half[1], half[2], mat, skip)
        self.merge(tmp, Transform(center[0], center[1], center[2], yaw), **kw)

    def prism(self, poly: Sequence[tuple[float, float]], y0: float, y1: float, mat: str,
              top: str | None = None, bottom: str | None = "", sides: bool = True, **kw) -> None:
        """Vertical prism from a plan polygon (x, z) wound counter-clockwise on a north-up plan
        (x right, z down) -- use `ccw()` to normalise. Side faces then point outward.
        """
        n = len(poly)
        if sides:
            for i in range(n):
                ax, az = poly[i]
                bx, bz = poly[(i + 1) % n]
                self.face([(ax, y0, az), (bx, y0, bz), (bx, y1, bz), (ax, y1, az)], mat, **kw)
        if top is not None:
            self.face([(x, y1, z) for (x, z) in poly], top or mat, **kw)
        if bottom is not None and bottom != "":
            self.face([(x, y0, z) for (x, z) in reversed(poly)], bottom, **kw)

    def cylinder(self, base: Vec, radius: float, height: float, mat: str, segments: int = 12,
                 caps: tuple[bool, bool] = (True, True), radius_top: float | None = None,
                 cap_mat: str | None = None, **kw) -> None:
        """Vertical cylinder (or cone frustum) standing on `base`."""
        rt = radius if radius_top is None else radius_top
        bx, by, bz = base
        ring0, ring1 = [], []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring0.append((bx + math.cos(a) * radius, by, bz - math.sin(a) * radius))
            ring1.append((bx + math.cos(a) * rt, by + height, bz - math.sin(a) * rt))
        circ = 2 * math.pi * max(radius, rt)
        for i in range(segments):
            j = (i + 1) % segments
            u0, u1 = circ * i / segments, circ * (i + 1) / segments
            self.face([ring0[i], ring0[j], ring1[j], ring1[i]], mat,
                      uv=[(u0, 0), (u1, 0), (u1, height), (u0, height)], **kw)
        if caps[1]:
            self.face(list(reversed(ring1))[::-1][::-1] if False else ring1[::-1][::-1], cap_mat or mat, **kw) \
                if False else self.face(list(ring1), cap_mat or mat, **kw)
        if caps[0]:
            self.face(list(reversed(ring0)), cap_mat or mat, **kw)

    def tube(self, a: Vec, b: Vec, radius: float, mat: str, segments: int = 8, caps: bool = True, **kw) -> None:
        """Cylinder between two arbitrary points."""
        d = norm(sub(b, a))
        up = (0.0, 1.0, 0.0) if abs(d[1]) < 0.95 else (1.0, 0.0, 0.0)
        u = norm(cross(d, up))
        v = cross(u, d)
        L = math.sqrt(dot(sub(b, a), sub(b, a)))
        ra, rb = [], []
        for i in range(segments):
            t = 2 * math.pi * i / segments
            off = add(mul(u, math.cos(t) * radius), mul(v, math.sin(t) * radius))
            ra.append(add(a, off))
            rb.append(add(b, off))
        circ = 2 * math.pi * radius
        for i in range(segments):
            j = (i + 1) % segments
            u0, u1 = circ * i / segments, circ * (i + 1) / segments
            self.face([ra[i], rb[i], rb[j], ra[j]], mat, uv=[(u0, 0), (u0, L), (u1, L), (u1, 0)], **kw)
        if caps:
            self.face(list(reversed(ra)), mat, **kw)
            self.face(list(rb), mat, **kw)

    def sphere(self, center: Vec, radius: float, mat: str, rings: int = 6, segments: int = 10,
               squash: float = 1.0, **kw) -> None:
        cx, cy, cz = center
        pts = []
        for r in range(rings + 1):
            phi = math.pi * r / rings
            row = []
            for s in range(segments):
                th = 2 * math.pi * s / segments
                row.append((cx + math.sin(phi) * math.cos(th) * radius, cy + math.cos(phi) * radius * squash,
                            cz - math.sin(phi) * math.sin(th) * radius))
            pts.append(row)
        for r in range(rings):
            for s in range(segments):
                t = (s + 1) % segments
                a, b, c, d = pts[r][s], pts[r + 1][s], pts[r + 1][t], pts[r][t]
                if r == 0:
                    self.face([a, b, c], mat, **kw)
                elif r == rings - 1:
                    self.face([a, b, d], mat, **kw)
                else:
                    self.face([a, b, c, d], mat, **kw)

    def merge(self, other: "MeshData", xf: Transform | None = None, mat_map: dict | None = None,
              recolor: Callable[[Vec, Color], Color] | None = None) -> None:
        base = len(self.verts)
        pts = [xf.point(p) for p in other.verts] if xf else list(other.verts)
        self.verts.extend(pts)
        for f, m, uv, col in zip(other.faces, other.face_mat, other.face_uv, other.face_col):
            self.faces.append([i + base for i in f])
            self.face_mat.append(mat_map.get(m, m) if mat_map else m)
            self.face_uv.append(list(uv))
            if recolor:
                col = [recolor(pts[i], c) for i, c in zip(f, col)]
            self.face_col.append(list(col))

    def bounds(self):
        xs = [v[0] for v in self.verts]
        ys = [v[1] for v in self.verts]
        zs = [v[2] for v in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def split_by_material(self) -> dict[str, "MeshData"]:
        parts: dict[str, MeshData] = {}
        for f, m, uv, col in zip(self.faces, self.face_mat, self.face_uv, self.face_col):
            md = parts.setdefault(m, MeshData())
            base = len(md.verts)
            md.verts.extend(self.verts[i] for i in f)
            md.faces.append(list(range(base, base + len(f))))
            md.face_mat.append(m)
            md.face_uv.append(uv)
            md.face_col.append(col)
        return parts

    # --- conversion -----------------------------------------------------------------------------
    def to_object(self, name: str, collection=None, smooth_angle: float = 35.0, location: Vec = (0, 0, 0)):
        """Create a Blender mesh object. `location` (game coords) becomes the object origin."""
        import bmesh
        import bpy

        from bmat import get_material

        lx, ly, lz = location
        mesh = bpy.data.meshes.new(name)
        verts = [(x - lx, -(z - lz), y - ly) for (x, y, z) in self.verts]
        mesh.from_pydata(verts, [], self.faces)
        mats: list[str] = []
        index: dict[str, int] = {}
        for m in self.face_mat:
            if m not in index:
                index[m] = len(mats)
                mats.append(m)
        for m in mats:
            mesh.materials.append(get_material(m))
        mesh.polygons.foreach_set("material_index", [index[m] for m in self.face_mat])
        uv_layer = mesh.uv_layers.new(name="UVMap")
        uvs = [c for f in self.face_uv for uv in f for c in uv]
        uv_layer.data.foreach_set("uv", uvs)
        col_attr = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
        cols = [c for f in self.face_col for col in f for c in col]
        col_attr.data.foreach_set("color", cols)
        mesh.color_attributes.active_color = col_attr
        mesh.color_attributes.render_color_index = 0
        mesh.update()
        # weld coincident vertices so smooth shading works across faces, then mark hard edges by angle
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(mesh)
        bm.free()
        mesh.shade_smooth()
        if hasattr(mesh, "set_sharp_from_angle"):
            mesh.set_sharp_from_angle(angle=math.radians(smooth_angle))
        obj = bpy.data.objects.new(name, mesh)
        obj.location = (lx, -lz, ly)
        (collection or bpy.context.scene.collection).objects.link(obj)
        return obj


def grime_fn(base_tint: Color = WHITE, ground: float = 0.0, height: float = 10.0,
             strength: float = 0.38) -> Callable[[Vec], Color]:
    """Vertex colour: darker near the ground (splash/dirt) and slightly under the eaves."""

    def fn(p: Vec) -> Color:
        y = p[1] - ground
        k = 1.0
        if y < 1.4:
            t = max(0.0, y) / 1.4
            k *= 1.0 - strength * (1 - t) ** 1.6
        if height - y < 0.8:
            k *= 0.92 + 0.08 * max(0.0, (height - y)) / 0.8
        return (base_tint[0] * k, base_tint[1] * k, base_tint[2] * k, 1.0)

    return fn
