"""Crossfire multiplayer character: skeleton layout and skinned mesh, in pure Python (no bpy).

Coordinates are Blender's (metres): +x is the character's right, +y is forward (the face looks +y), +z is up and the
origin sits on the ground between the feet. The glTF exporter converts this to game space (+y up, character looking
down -z), which is the direction every Crossfire prop and the remote-player root face at yaw 0.

The body is one closed shell per part (torso, limbs, head, gear) built from lofted superellipse rings. Parts meet at
ball joints that stay inside the neighbouring part (shoulders, hips), while elbows and knees are continuous tubes with
blended weights, so no gap can open in any pose. Every vertex gets its bone weights from analytic functions of its rest
position, which keeps skinning deterministic and lets rigid gear (pouches, pads, buckle) follow a single transform.

Each face is assigned an atlas cell (see CELLS); texture coordinates are a per-part planar projection fitted inside
that cell, so the whole character renders with one material and one texture pair.
"""
from __future__ import annotations

import math
from typing import Callable, Iterable, Sequence

Vec = tuple[float, float, float]
Weights = dict[str, float]

# ----------------------------------------------------------------------------------------------- atlas cells
# 4 x 4 grid; index = row_from_bottom * 4 + column. char_textures.py paints the same table.
CELLS = ["skin", "shirt", "pants", "vest", "pouch", "strap", "glove", "boot",
         "sole", "cap", "hair", "eye", "metal", "belt", "lip", "pad"]
CELL = {name: i for i, name in enumerate(CELLS)}
ATLAS_GRID = 4
CELL_PAD = 0.11  # fraction of a cell left as margin so mip levels do not bleed neighbouring colours

# ----------------------------------------------------------------------------------------------- skeleton
ARM_ANGLE = math.radians(40.0)          # rest A-pose: arms 40 deg out from vertical
SHOULDER = (0.19, 0.0, 1.425)
UPPER_ARM, FOREARM, HAND = 0.285, 0.255, 0.11
HIP = (0.095, 0.0, 0.93)
KNEE = (0.095, 0.012, 0.50)             # slight forward knee gives IK and engines a bend direction
ANKLE = (0.095, 0.0, 0.085)
TOE = (0.095, 0.15, 0.025)


def arm_axes(side: int) -> tuple[Vec, Vec, Vec]:
    """(along, back, forward) unit axes of an arm at rest. side = +1 right, -1 left.
    `back` is the back-of-hand direction (up and out); the palm faces the body."""
    s, c = math.sin(ARM_ANGLE), math.cos(ARM_ANGLE)
    return (side * s, 0.0, -c), (side * c, 0.0, s), (0.0, 1.0, 0.0)


def arm_point(side: int, t: float, back: float = 0.0, fwd: float = 0.0) -> Vec:
    d, b, f = arm_axes(side)
    sx = side * SHOULDER[0]
    return (sx + d[0] * t + b[0] * back + f[0] * fwd,
            SHOULDER[1] + d[1] * t + b[1] * back + f[1] * fwd,
            SHOULDER[2] + d[2] * t + b[2] * back + f[2] * fwd)


def bones() -> list[tuple[str, Vec, Vec, str | None]]:
    """(name, head, tail, parent), parents listed before children."""
    out: list[tuple[str, Vec, Vec, str | None]] = [
        ("root", (0.0, 0.0, 0.0), (0.0, 0.2, 0.0), None),
        ("pelvis", (0.0, 0.0, 0.95), (0.0, 0.0, 1.05), "root"),
        ("spine", (0.0, 0.0, 1.05), (0.0, 0.0, 1.25), "pelvis"),
        ("chest", (0.0, 0.0, 1.25), (0.0, -0.008, 1.47), "spine"),
        ("neck", (0.0, -0.008, 1.47), (0.0, 0.0, 1.575), "chest"),
        ("head", (0.0, 0.0, 1.575), (0.0, 0.0, 1.79), "neck"),
    ]
    for side, sfx in ((-1, "l"), (1, "r")):
        out += [
            (f"upper_arm_{sfx}", arm_point(side, 0.0), arm_point(side, UPPER_ARM), "chest"),
            (f"forearm_{sfx}", arm_point(side, UPPER_ARM), arm_point(side, UPPER_ARM + FOREARM), f"upper_arm_{sfx}"),
            (f"hand_{sfx}", arm_point(side, UPPER_ARM + FOREARM), arm_point(side, UPPER_ARM + FOREARM + HAND),
             f"forearm_{sfx}"),
        ]
    for side, sfx in ((-1, "l"), (1, "r")):
        m = lambda p: (side * p[0], p[1], p[2])  # noqa: E731
        out += [
            (f"thigh_{sfx}", m(HIP), m(KNEE), "pelvis"),
            (f"shin_{sfx}", m(KNEE), m(ANKLE), f"thigh_{sfx}"),
            (f"foot_{sfx}", m(ANKLE), m(TOE), f"shin_{sfx}"),
        ]
    return out


# ----------------------------------------------------------------------------------------------- vector helpers
def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a: Vec) -> Vec:
    n = math.sqrt(dot(a, a))
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 1.0)


def rotate(v: Vec, axis: Vec, ang: float) -> Vec:
    """Rodrigues rotation (right-handed)."""
    k = norm(axis)
    c, s = math.cos(ang), math.sin(ang)
    kv = cross(k, v)
    kd = dot(k, v)
    return (v[0] * c + kv[0] * s + k[0] * kd * (1 - c),
            v[1] * c + kv[1] * s + k[1] * kd * (1 - c),
            v[2] * c + kv[2] * s + k[2] * kd * (1 - c))


def spow(x: float, p: float) -> float:
    return math.copysign(abs(x) ** p, x)


def smoothstep(e0: float, e1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def superellipse(a: float, ru_pos: float, ru_neg: float, rv_pos: float, rv_neg: float, e: float) -> tuple[float, float]:
    c, s = math.cos(a), math.sin(a)
    return spow(c, 2 / e) * (ru_pos if c >= 0 else ru_neg), spow(s, 2 / e) * (rv_pos if s >= 0 else rv_neg)


# ----------------------------------------------------------------------------------------------- weights
def chain(x: float, names: Sequence[str], bounds: Sequence[float], halves: Sequence[float]) -> Weights:
    """Weights along a bone chain: names[i] owns x between bounds[i-1] and bounds[i], blended over +-halves[i]."""
    steps = [1.0] + [smoothstep(b - h, b + h, x) for b, h in zip(bounds, halves)] + [0.0]
    out = {n: steps[i] - steps[i + 1] for i, n in enumerate(names)}
    return {k: v for k, v in out.items() if v > 1e-4}


def torso_weights(p: Vec) -> Weights:
    return chain(p[2], ("pelvis", "spine", "chest", "neck", "head"), (1.05, 1.25, 1.47, 1.575), (0.05, 0.06, 0.025, 0.03))


def leg_weights(side: int) -> Callable[[Vec], Weights]:
    sfx = "r" if side > 0 else "l"
    names = (f"thigh_{sfx}", f"shin_{sfx}", f"foot_{sfx}")
    return lambda p: chain(-p[2], names, (-0.50, -0.118), (0.055, 0.032))


def arm_weights(side: int) -> Callable[[Vec], Weights]:
    sfx = "r" if side > 0 else "l"
    d, _, _ = arm_axes(side)
    sh = (side * SHOULDER[0], SHOULDER[1], SHOULDER[2])
    names = (f"upper_arm_{sfx}", f"forearm_{sfx}", f"hand_{sfx}")
    return lambda p: chain(dot(sub(p, sh), d), names, (UPPER_ARM, UPPER_ARM + FOREARM), (0.045, 0.02))


def bone(name: str) -> Callable[[Vec], Weights]:
    return lambda p: {name: 1.0}


class Rigid:
    """Evaluate a weight function once at the part's centre: gear moves as one piece."""

    def __init__(self, fn: Callable[[Vec], Weights], at: Vec | None = None):
        self.fn, self.at = fn, at


# ----------------------------------------------------------------------------------------------- profiles
class Profile:
    """Horizontal superellipse cross-sections interpolated over height: rows (z, half_width, front, back, y_centre, exp).
    `mod(theta, z)` adds a radial offset (face details, beard volume)."""

    def __init__(self, rows: Sequence[Sequence[float]], mod: Callable[[float, float], float] | None = None):
        self.rows = [tuple(r) for r in rows]
        self.mod = mod

    def at(self, z: float) -> tuple[float, ...]:
        rows = self.rows
        if z <= rows[0][0]:
            return rows[0][1:]
        for a, b in zip(rows, rows[1:]):
            if z <= b[0]:
                t = (z - a[0]) / (b[0] - a[0])
                return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, 6))
        return rows[-1][1:]

    def point(self, theta: float, z: float, off: float = 0.0) -> Vec:
        """theta: 0 = right (+x), 90 deg = front (+y). The offset follows the curve's outward normal."""
        hw, f, b, yc, e = self.at(z)
        if self.mod is not None:
            off += self.mod(theta, z)
        px, py = superellipse(theta, hw, hw, f, b, e)
        d = f if py >= 0 else b
        nx = spow(px / hw, e - 1) / hw
        ny = spow(py / d, e - 1) / d
        n = math.hypot(nx, ny) or 1.0
        return (px + nx / n * off, yc + py + ny / n * off, z)


def front_angle(p: Vec) -> float:
    """Unsigned horizontal angle (degrees) between +y and the point, seen from above the body axis."""
    return abs(math.degrees(math.atan2(p[0], p[1])))


# ----------------------------------------------------------------------------------------------- mesh builder
class Builder:
    def __init__(self) -> None:
        self.verts: list[Vec] = []
        self.weights: list[Weights] = []
        self.faces: list[tuple[tuple[int, ...], int]] = []
        self.parts: list[dict] = []
        self._part: dict | None = None

    # parts ---------------------------------------------------------------------------------
    def begin(self, name: str, cell: str, weights, proj: tuple[Vec, Vec] | None = None,
              cell_fn: Callable[[Vec], str] | None = None) -> None:
        self._part = dict(name=name, cell=CELL[cell], weights=weights, proj=proj, cell_fn=cell_fn,
                          v0=len(self.verts), f0=len(self.faces))

    def end(self) -> None:
        part = self._part
        assert part is not None
        v0, v1, f0, f1 = part["v0"], len(self.verts), part["f0"], len(self.faces)
        part.update(v1=v1, f1=f1)
        pts = self.verts[v0:v1]
        centre = mul(tuple(map(sum, zip(*pts))), 1.0 / len(pts))  # type: ignore[arg-type]
        # orient: outward faces give a positive volume about the part's centre
        vol = 0.0
        for idx, _ in self.faces[f0:f1]:
            a = sub(self.verts[idx[0]], centre)
            for i in range(1, len(idx) - 1):
                vol += dot(a, cross(sub(self.verts[idx[i]], centre), sub(self.verts[idx[i + 1]], centre)))
        if vol < 0:
            for i in range(f0, f1):
                idx, c = self.faces[i]
                self.faces[i] = (tuple(reversed(idx)), c)
        w = part["weights"]
        if isinstance(w, Rigid):
            fixed = w.fn(w.at or centre)
            fn: Callable[[Vec], Weights] = lambda p: fixed  # noqa: E731
        elif isinstance(w, dict):
            fn = lambda p: w  # noqa: E731
        else:
            fn = w
        for p in pts:
            ws = fn(p)
            total = sum(ws.values())
            self.weights.append({k: v / total for k, v in ws.items()})
        # per-face cells
        if part["cell_fn"] is not None:
            for i in range(f0, f1):
                idx, _ = self.faces[i]
                c = mul(tuple(map(sum, zip(*(self.verts[j] for j in idx)))), 1.0 / len(idx))  # type: ignore[arg-type]
                self.faces[i] = (idx, CELL[part["cell_fn"](c)])
        # projection axes: the two largest extents unless given
        if part["proj"] is None:
            lo = [min(p[i] for p in pts) for i in range(3)]
            hi = [max(p[i] for p in pts) for i in range(3)]
            ext = sorted(range(3), key=lambda i: hi[i] - lo[i], reverse=True)
            axes = [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
            part["proj"] = (axes[ext[0]], axes[ext[1]])
        self.parts.append(part)
        self._part = None

    # primitives ------------------------------------------------------------------------------
    def v(self, p: Vec) -> int:
        self.verts.append(p)
        return len(self.verts) - 1

    def f(self, idx: Sequence[int]) -> None:
        assert self._part is not None
        self.faces.append((tuple(idx), self._part["cell"]))

    def loft(self, rings: Sequence[Sequence[Vec]], start: Vec | str | None = None, end: Vec | str | None = None,
             closed: bool = True) -> list[list[int]]:
        """Connect rings of equal size. start/end: a pole point, 'fan' (flat cap at the ring centre) or None (open)."""
        ids = [[self.v(p) for p in ring] for ring in rings]
        n = len(rings[0])
        span = n if closed else n - 1
        for a, b in zip(ids, ids[1:]):
            for i in range(span):
                j = (i + 1) % n
                self.f((a[i], a[j], b[j], b[i]))
        for which, cap in ((0, start), (-1, end)):
            if cap is None:
                continue
            ring = ids[which]
            if cap == "fan":
                pts = [self.verts[k] for k in ring]
                cap = mul(tuple(map(sum, zip(*pts))), 1.0 / len(pts))  # type: ignore[arg-type]
            c = self.v(cap)  # type: ignore[arg-type]
            for i in range(span):
                j = (i + 1) % n
                self.f((c, ring[j], ring[i]) if which == 0 else (c, ring[i], ring[j]))
        return ids

    def ring(self, centre: Vec, u: Vec, v: Vec, ru: float, rv: float, n: int, e: float = 2.0,
             ru_neg: float | None = None, rv_neg: float | None = None, phase: float = 0.0) -> list[Vec]:
        pts = []
        for i in range(n):
            a = phase + 2 * math.pi * i / n
            x, y = superellipse(a, ru, ru if ru_neg is None else ru_neg, rv, rv if rv_neg is None else rv_neg, e)
            pts.append(add(centre, add(mul(u, x), mul(v, y))))
        return pts

    def ellipsoid(self, centre: Vec, axes: tuple[Vec, Vec, Vec], radii: Vec, n: int = 10, m: int = 6,
                  e: float = 2.0) -> None:
        u, v, w = axes
        rings = []
        for k in range(1, m):
            phi = -math.pi / 2 + math.pi * k / m
            r, h = math.cos(phi), math.sin(phi)
            c = add(centre, mul(w, h * radii[2]))
            rings.append(self.ring(c, u, v, max(r, 1e-3) * radii[0], max(r, 1e-3) * radii[1], n, e))
        self.loft(rings, start=add(centre, mul(w, -radii[2])), end=add(centre, mul(w, radii[2])))

    def rounded_box(self, centre: Vec, axes: tuple[Vec, Vec, Vec], half: Vec, n: int = 12, e: float = 5.0,
                    bevel: float = 0.25) -> None:
        """Box with rounded vertical edges and chamfered ends; axes = (width, depth, length) unit vectors."""
        u, v, w = axes
        b = min(half[0], half[1], half[2]) * bevel
        rings = []
        for t, s in ((-half[2], 1 - bevel * 0.9), (-half[2] + b, 1.0), (half[2] - b, 1.0), (half[2], 1 - bevel * 0.9)):
            rings.append(self.ring(add(centre, mul(w, t)), u, v, half[0] * s, half[1] * s, n, e, phase=math.pi / n))
        self.loft(rings, start="fan", end="fan")

    def tube(self, path: Sequence[Vec], radii: Sequence[tuple[float, float]], n: int, ref: Vec, e: float = 2.0,
             start: str | None = "pole", end: str | None = "pole", pole_len: float = 0.6) -> None:
        """Rings perpendicular to a polyline. radii[i] = (r along the ref-derived axis, r along the other)."""
        rings = []
        for i, p in enumerate(path):
            if i == 0:
                t = norm(sub(path[1], path[0]))
            elif i == len(path) - 1:
                t = norm(sub(path[-1], path[-2]))
            else:
                t = norm(add(norm(sub(path[i], path[i - 1])), norm(sub(path[i + 1], path[i]))))
            u = norm(sub(ref, mul(t, dot(ref, t))))
            v = cross(t, u)
            rings.append(self.ring(p, u, v, radii[i][0], radii[i][1], n, e))
        t0 = norm(sub(path[1], path[0]))
        t1 = norm(sub(path[-1], path[-2]))
        s = (add(path[0], mul(t0, -min(radii[0]) * pole_len)) if start == "pole" else start)
        f = (add(path[-1], mul(t1, min(radii[-1]) * pole_len)) if end == "pole" else end)
        self.loft(rings, start=s, end=f)

    # output ----------------------------------------------------------------------------------
    def loop_uvs(self) -> list[list[tuple[float, float]]]:
        """Per-face corner UVs: the part's planar projection normalised to its bounds, fitted inside the face's cell."""
        out: list[list[tuple[float, float]]] = [[] for _ in self.faces]
        size = 1.0 / ATLAS_GRID
        for part in self.parts:
            pu, pv = part["proj"]
            pts = self.verts[part["v0"]:part["v1"]]
            us = [dot(p, pu) for p in pts]
            vs = [dot(p, pv) for p in pts]
            u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
            du, dv = (u1 - u0) or 1.0, (v1 - v0) or 1.0
            for fi in range(part["f0"], part["f1"]):
                idx, cell = self.faces[fi]
                cx, cy = (cell % ATLAS_GRID) * size, (cell // ATLAS_GRID) * size
                lo, span = CELL_PAD * size, (1 - 2 * CELL_PAD) * size
                out[fi] = [(cx + lo + span * (dot(self.verts[j], pu) - u0) / du,
                            cy + lo + span * (dot(self.verts[j], pv) - v0) / dv) for j in idx]
        return out

    def triangles(self) -> int:
        return sum(len(idx) - 2 for idx, _ in self.faces)


# ----------------------------------------------------------------------------------------------- body profiles
TORSO = Profile([
    # z      hw     front  back   yc      exp
    (0.80, 0.105, 0.060, 0.070, 0.000, 2.2),
    (0.84, 0.150, 0.088, 0.100, 0.000, 2.4),
    (0.88, 0.172, 0.100, 0.112, -0.004, 2.5),
    (0.93, 0.180, 0.102, 0.115, -0.006, 2.5),
    (0.98, 0.174, 0.098, 0.108, -0.004, 2.5),
    (1.02, 0.166, 0.094, 0.100, 0.000, 2.5),
    (1.08, 0.160, 0.092, 0.094, 0.002, 2.5),
    (1.15, 0.166, 0.098, 0.094, 0.004, 2.5),
    (1.22, 0.176, 0.106, 0.098, 0.006, 2.5),
    (1.30, 0.186, 0.112, 0.102, 0.006, 2.6),
    (1.37, 0.192, 0.112, 0.104, 0.004, 2.6),
    (1.42, 0.186, 0.102, 0.098, 0.000, 2.6),
    (1.455, 0.150, 0.085, 0.085, -0.004, 2.4),
    (1.48, 0.100, 0.068, 0.070, -0.006, 2.2),
    (1.50, 0.062, 0.052, 0.056, -0.008, 2.0),
])

EYE_Z, EYE_X = 1.655, 0.031


def _head_mod(theta: float, z: float) -> float:
    fa = abs(math.degrees(theta) - 90.0)
    fa = min(fa, 360.0 - fa)
    g = lambda x, c, w: math.exp(-((x - c) / w) ** 2)  # noqa: E731
    off = 0.0
    off -= 0.006 * g(fa, 22, 9) * g(z, EYE_Z, 0.012)            # eye sockets
    off += 0.004 * g(fa, 18, 22) * g(z, 1.677, 0.008)           # brow ridge
    off += 0.003 * g(fa, 0, 7) * g(z, 1.655, 0.02)              # nose bridge
    off += 0.003 * g(fa, 48, 14) * g(z, 1.628, 0.014)           # cheekbones
    off += 0.004 * smoothstep(110, 90, fa) * smoothstep(1.612, 1.596, z)    # beard volume
    off += 0.003 * smoothstep(65, 85, fa) * smoothstep(1.585, 1.6, z) * smoothstep(1.715, 1.70, z)  # cropped hair
    return off


HEAD = Profile([
    (1.530, 0.030, 0.020, 0.020, 0.052, 2.0),
    (1.540, 0.050, 0.032, 0.035, 0.046, 2.2),
    (1.555, 0.063, 0.042, 0.055, 0.034, 2.3),
    (1.575, 0.071, 0.055, 0.075, 0.020, 2.3),
    (1.600, 0.075, 0.068, 0.090, 0.008, 2.3),
    (1.620, 0.077, 0.077, 0.096, 0.004, 2.3),
    (1.640, 0.079, 0.083, 0.100, 0.000, 2.3),
    (1.660, 0.080, 0.086, 0.102, 0.000, 2.3),
    (1.680, 0.080, 0.087, 0.103, 0.000, 2.3),
    (1.700, 0.079, 0.083, 0.102, 0.000, 2.2),
    (1.720, 0.076, 0.077, 0.098, 0.000, 2.2),
    (1.740, 0.069, 0.067, 0.088, 0.000, 2.1),
    (1.758, 0.058, 0.054, 0.073, -0.003, 2.0),
    (1.772, 0.042, 0.038, 0.053, -0.005, 2.0),
    (1.782, 0.022, 0.020, 0.028, -0.006, 2.0),
], mod=_head_mod)
HEAD_CENTRE = (0.0, 0.0, 1.66)


def head_cell(c: Vec) -> str:
    fa, z = front_angle(c), c[2]
    if z < 1.604 and fa < 104:
        return "hair"       # short boxed beard and moustache
    if 1.592 < z < 1.712 and fa > 72:
        return "hair"       # cropped sides and back below the cap
    return "skin"


# ----------------------------------------------------------------------------------------------- parts
def _torso(b: Builder) -> None:
    n = 24
    zs = [0.80, 0.84, 0.88, 0.93, 0.98, 1.0, 1.02, 1.08, 1.15, 1.22, 1.30, 1.37, 1.42, 1.455, 1.48, 1.50]
    b.begin("torso", "shirt", torso_weights, proj=((1, 0, 0), (0, 0, 1)),
            cell_fn=lambda c: "pants" if c[2] < 0.995 else "shirt")
    rings = [[TORSO.point(2 * math.pi * i / n, z) for i in range(n)] for z in zs]
    b.loft(rings, start=(0.0, 0.0, 0.79), end="fan")
    b.end()

    # belt with a visible thickness band at both edges
    b.begin("belt", "belt", torso_weights, proj=((1, 0, 0), (0, 0, 1)))
    rings = [[TORSO.point(2 * math.pi * i / n, z, off) for i in range(n)]
             for z, off in ((0.983, 0.0), (0.985, 0.008), (1.035, 0.008), (1.037, 0.0))]
    b.loft(rings)
    b.end()
    b.begin("buckle", "metal", Rigid(torso_weights))
    c = TORSO.point(math.pi / 2, 1.01, 0.012)
    b.rounded_box(c, ((1, 0, 0), (0, 0, 1), (0, 1, 0)), (0.026, 0.019, 0.005), n=8, e=4)
    b.end()

    # mock-neck collar
    b.begin("collar", "shirt", torso_weights)
    rings = [b.ring((0.0, -0.006, z), (1, 0, 0), (0, 1, 0), r, r * 0.97, 16) for z, r in
             ((1.468, 0.069), (1.5, 0.063), (1.516, 0.059), (1.514, 0.052))]
    b.loft(rings)
    b.end()


def _vest_offset(theta: float) -> float:
    fa = abs(math.degrees(theta) - 90.0)
    fa = min(fa, 360 - fa)
    plate = smoothstep(62, 38, fa) + smoothstep(62, 38, 180 - fa)
    return 0.018 + 0.011 * plate


def _vest_top(theta: float) -> float:
    fa = abs(math.degrees(theta) - 90.0)
    fa = min(fa, 360 - fa)
    return 1.25 + 0.15 * smoothstep(58, 32, fa) + 0.17 * smoothstep(58, 32, 180 - fa)


def _vest(b: Builder) -> None:
    n, rows = 32, 7
    b.begin("vest", "vest", torso_weights, proj=((1, 0, 0), (0, 0, 1)))
    cols = []
    for i in range(n):
        th = 2 * math.pi * i / n
        off, z0, z1 = _vest_offset(th), 1.025, _vest_top(th)
        col = [TORSO.point(th, z0 + 0.002, off - 0.013)]
        col += [TORSO.point(th, z0 + (z1 - z0) * k / (rows - 1), off) for k in range(rows)]
        col.append(TORSO.point(th, z1 - 0.002, off - 0.013))
        cols.append(col)
    rings = [[cols[i][k] for i in range(n)] for k in range(len(cols[0]))]
    b.loft(rings)
    b.end()

    # shoulder straps over the trapezius, joining front and back plates
    for side in (-1, 1):
        fa = math.radians(90 - side * 33)
        ba = math.radians(270 + side * 33)
        path = [TORSO.point(fa, 1.37, _vest_offset(fa) + 0.004), TORSO.point(fa, 1.43, 0.016),
                (side * 0.118, 0.026, 1.474), (side * 0.12, -0.02, 1.476),
                TORSO.point(ba, 1.43, 0.016), TORSO.point(ba, 1.39, _vest_offset(ba) + 0.004)]
        b.begin(f"strap_{side}", "strap", torso_weights)
        b.tube(path, [(0.024, 0.0065)] * len(path), 8, (1, 0, 0), e=5, start="fan", end="fan")
        b.end()

    def pouch(name, theta, z, half, lift=0.0, cell="pouch", flap=True):
        nrm = norm(sub(TORSO.point(theta, z, 0.01), TORSO.point(theta, z, 0.0)))
        tang = norm(cross((0, 0, 1), nrm))
        base = TORSO.point(theta, z, _vest_offset(theta) + half[1] + lift)
        b.begin(name, cell, Rigid(torso_weights, base))
        b.rounded_box(base, (tang, nrm, (0, 0, 1)), half)
        b.end()
        if flap:
            top = add(base, (0.0, 0.0, half[2] - 0.004))
            top = add(top, mul(nrm, 0.003))
            b.begin(name + "_flap", "strap", Rigid(torso_weights, base))
            b.rounded_box(top, (tang, nrm, (0, 0, 1)), (half[0] + 0.003, half[1] + 0.003, 0.012), n=12, e=5)
            b.end()

    for k, a in enumerate((90 - 27, 90, 90 + 27)):
        pouch(f"mag_pouch_{k}", math.radians(a), 1.165, (0.03, 0.019, 0.058))
    pouch("admin_pouch", math.pi / 2, 1.325, (0.058, 0.012, 0.036), flap=False)
    pouch("radio_pouch", math.radians(200), 1.155, (0.03, 0.022, 0.06))
    pouch("back_pouch", math.radians(270), 1.215, (0.085, 0.022, 0.105))
    pouch("dump_pouch", math.radians(-28), 0.955, (0.034, 0.022, 0.05), lift=-0.004)

    # radio antenna: thin, slightly flexible-looking whip
    base = TORSO.point(math.radians(200), 1.22, _vest_offset(math.radians(200)) + 0.03)
    path = [base, add(base, (0.0, -0.004, 0.06)), add(base, (0.004, -0.012, 0.13))]
    b.begin("antenna", "sole", Rigid(torso_weights, base))
    b.tube(path, [(0.0045, 0.0045), (0.0035, 0.0035), (0.0028, 0.0028)], 6, (1, 0, 0))
    b.end()


def _neck_head(b: Builder) -> None:
    b.begin("neck", "skin", torso_weights)
    rings = [b.ring((0.0, -0.008, z), (1, 0, 0), (0, 1, 0), 0.052, 0.05, 14, rv_neg=0.056) for z in
             (1.47, 1.53, 1.575, 1.60)]
    b.loft(rings)
    b.end()

    n = 28
    zs = [1.530, 1.540, 1.555, 1.575, 1.590, 1.604, 1.620, 1.634, 1.648, 1.662, 1.676, 1.690, 1.706, 1.722,
          1.740, 1.758, 1.772, 1.782]
    b.begin("head", "skin", bone("head"), proj=((1, 0, 0), (0, 0, 1)), cell_fn=head_cell)
    rings = [[HEAD.point(2 * math.pi * i / n, z) for i in range(n)] for z in zs]
    b.loft(rings, start=(0.0, 0.052, 1.526), end=(0.0, -0.006, 1.786))
    b.end()

    def surf_y(x: float, z: float) -> float:
        # head surface depth in front of a given x (search the ring)
        best = None
        for i in range(181):
            th = math.radians(i)
            p = HEAD.point(th, z)
            if best is None or abs(p[0] - x) < abs(best[0] - x):
                best = p
        return best[1]  # type: ignore[index]

    X, Y, Z = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)
    for side in (-1, 1):
        x = side * EYE_X
        b.begin(f"eye_{side}", "eye", bone("head"))
        b.ellipsoid((x, surf_y(x, EYE_Z) - 0.0025, EYE_Z), (X, Z, Y), (0.0115, 0.0078, 0.0058), n=10, m=5)
        b.end()
        bx = side * 0.033
        tilt = norm((side * 0.25, 0.0, -1.0 if False else 0.0)) if False else X
        b.begin(f"brow_{side}", "hair", bone("head"))
        b.rounded_box((bx, surf_y(bx, 1.679) + 0.001, 1.679), (tilt, Y, Z), (0.0145, 0.004, 0.0036), n=8, e=3,
                      bevel=0.3)
        b.end()
        ex = side * (HEAD.at(1.645)[0] + 0.002)
        b.begin(f"ear_{side}", "skin", bone("head"))
        b.ellipsoid((ex, -0.008, 1.643), (Y, X, norm((0, -0.25, 1))), (0.019, 0.008, 0.029), n=10, m=5)
        b.end()

    b.begin("nose", "skin", bone("head"))
    b.ellipsoid((0.0, surf_y(0.0, 1.627) - 0.001, 1.627), (X, norm((0, 1, 0.35)), norm((0, -0.35, 1))),
                (0.0125, 0.017, 0.027), n=10, m=6)
    b.end()
    b.begin("mouth", "lip", bone("head"))
    b.ellipsoid((0.0, surf_y(0.0, 1.586) + 0.001, 1.586), (X, Y, Z), (0.019, 0.0055, 0.0045), n=10, m=4)
    b.end()

    # fitted cap: crown shell around the skull, lower at the back, with a short curved visor
    b.begin("cap", "cap", bone("head"), proj=((1, 0, 0), (0, 1, 0)))
    c = HEAD_CENTRE

    def cap_pt(th: float, z: float, off: float) -> Vec:
        p = HEAD.point(th, z)
        d = sub(p, c)
        return add(c, mul(d, 1 + off / math.sqrt(dot(d, d))))

    band = lambda th: 1.701 + 0.013 * math.sin(th)  # noqa: E731
    rings = []
    for k, t in enumerate((0.0, 0.035, 0.22, 0.42, 0.6, 0.76, 0.88, 0.96)):
        off = 0.0075 if k else 0.006
        rings.append([cap_pt(2 * math.pi * i / n, band(2 * math.pi * i / n) + (1.782 - band(2 * math.pi * i / n)) * t,
                             off) for i in range(n)])
    rings.insert(0, [cap_pt(2 * math.pi * i / n, band(2 * math.pi * i / n) + 0.004, -0.002) for i in range(n)])
    b.loft(rings, end=(0.0, -0.006, 1.7945))
    b.end()

    b.begin("visor", "cap", bone("head"), proj=((1, 0, 0), (0, 1, 0)))
    cols, depth = 11, 3
    top: list[list[int]] = []
    bot: list[list[int]] = []
    for i in range(cols):
        th = math.radians(90 - 56 + 112 * i / (cols - 1))
        reach = 0.064 * math.cos(math.radians(90) - th) ** 0.0 * (0.25 + 0.75 * math.sin(th) ** 3)
        inner = cap_pt(th, band(th) + 0.002, 0.004)
        out = norm((inner[0], inner[1] - c[1] * 0, 0.0))
        rt, rb = [], []
        for j in range(depth + 1):
            f = j / depth
            p = add(inner, mul(out, reach * f))
            p = (p[0], p[1], p[2] - 0.013 * f * f + 0.002 * f)
            rt.append(b.v(p))
            rb.append(b.v((p[0], p[1], p[2] - 0.0055)))
        top.append(rt)
        bot.append(rb)
    for i in range(cols - 1):
        for j in range(depth):
            b.f((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]))
            b.f((bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1]))
        b.f((top[i][depth], bot[i][depth], bot[i + 1][depth], top[i + 1][depth]))
        b.f((top[i][0], top[i + 1][0], bot[i + 1][0], bot[i][0]))
    for i, sgn in ((0, 1), (cols - 1, -1)):
        for j in range(depth):
            q = (top[i][j], bot[i][j], bot[i][j + 1], top[i][j + 1])
            b.f(q if sgn > 0 else tuple(reversed(q)))
    b.end()
    b.begin("cap_button", "cap", bone("head"))
    b.ellipsoid((0.0, -0.006, 1.794), (X, Y, Z), (0.009, 0.009, 0.004), n=8, m=4)
    b.end()


def _arm(b: Builder, side: int) -> None:
    d, bk, fw = arm_axes(side)
    sh = (side * SHOULDER[0], SHOULDER[1], SHOULDER[2])
    w = arm_weights(side)
    n = 12

    def r(t, ru, rv, off_b=0.0, off_f=0.0, k=n, e=2.0):
        return b.ring(arm_point(side, t, off_b, off_f), bk, fw, ru, rv, k, e)

    b.begin(f"arm_{side}", "shirt", w)
    rings = [r(-0.052, 0.03, 0.029), r(-0.035, 0.05, 0.048), r(-0.015, 0.06, 0.058)]
    rings += [r(t, ru, rv) for t, ru, rv in (
        (0.0, 0.062, 0.060), (0.05, 0.058, 0.057), (0.12, 0.050, 0.051), (0.20, 0.046, 0.048),
        (0.255, 0.043, 0.045), (0.285, 0.042, 0.044), (0.315, 0.043, 0.045), (0.37, 0.043, 0.042),
        (0.44, 0.037, 0.035), (0.50, 0.033, 0.030), (0.53, 0.031, 0.028))]
    b.loft(rings, start=arm_point(side, -0.062), end="fan")
    b.end()

    b.begin(f"glove_cuff_{side}", "glove", w)
    rings = [r(t, ru, rv, e=2.2) for t, ru, rv in (
        (0.468, 0.033, 0.031), (0.472, 0.040, 0.038), (0.52, 0.039, 0.036), (0.548, 0.036, 0.033))]
    b.loft(rings, start="fan", end="fan")
    b.end()

    b.begin(f"palm_{side}", "glove", w)
    rings = [r(t, rb, rf, ob, k=12, e=3.0) for t, rb, rf, ob in (
        (0.535, 0.019, 0.034, 0.0), (0.56, 0.021, 0.040, 0.0), (0.60, 0.0195, 0.044, -0.002),
        (0.628, 0.0165, 0.043, -0.004), (0.642, 0.0125, 0.037, -0.005))]
    b.loft(rings, start="fan", end="fan")
    b.end()

    # relaxed fingers: three phalanges curling toward the palm
    palm_dir = mul(bk, -1.0)
    for k, (of, length, rad) in enumerate(((0.029, 0.072, 0.0098), (0.0095, 0.08, 0.0102),
                                            (-0.0095, 0.074, 0.0098), (-0.028, 0.06, 0.0088))):
        p = arm_point(side, 0.628, -0.004, of)
        path = [p]
        direction = d
        for seg, curl in zip((0.42, 0.33, 0.25), (0.22, 0.42, 0.5)):
            direction = norm(rotate(direction, cross(d, palm_dir), curl))
            p = add(p, mul(direction, length * seg))
            path.append(p)
        radii = [(rad, rad * 0.92), (rad * 0.97, rad * 0.9), (rad * 0.92, rad * 0.85), (rad * 0.85, rad * 0.8)]
        b.begin(f"finger_{side}_{k}", "glove", bone(f"hand_{'r' if side > 0 else 'l'}"))
        b.tube(path, radii, 6, fw)
        b.end()

    base = arm_point(side, 0.56, -0.008, 0.032)
    direction = norm(add(add(d, mul(fw, 0.8)), mul(palm_dir, 0.35)))
    path = [base]
    for seg, curl in ((0.038, 0.15), (0.03, 0.35)):
        direction = norm(rotate(direction, cross(direction, palm_dir), curl))
        path.append(add(path[-1], mul(direction, seg)))
    b.begin(f"thumb_{side}", "glove", bone(f"hand_{'r' if side > 0 else 'l'}"))
    b.tube(path, [(0.0125, 0.011), (0.0112, 0.01), (0.0098, 0.0088)], 6, bk)
    b.end()


def _leg(b: Builder, side: int) -> None:
    x = side * HIP[0]
    w = leg_weights(side)
    X, Y, Z = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)
    n = 12

    def r(z, rx, f, bk, yc=0.0, e=2.0):
        return b.ring((x, yc, z), X, Y, rx, f, n, e, rv_neg=bk)

    b.begin(f"leg_{side}", "pants", w, proj=(X, Z))
    rings = []
    for phi in (70, 45, 20):
        a = math.radians(phi)
        rings.append(r(HIP[2] + 0.088 * math.sin(a), 0.088 * math.cos(a), 0.09 * math.cos(a), 0.094 * math.cos(a)))
    rings += [r(*row) for row in (
        (0.93, 0.088, 0.090, 0.094), (0.86, 0.088, 0.090, 0.094), (0.76, 0.080, 0.083, 0.086, 0.004),
        (0.65, 0.070, 0.073, 0.074, 0.006), (0.56, 0.062, 0.066, 0.062, 0.008), (0.52, 0.059, 0.064, 0.058, 0.010),
        (0.48, 0.058, 0.062, 0.058, 0.010), (0.44, 0.058, 0.058, 0.064, 0.004), (0.36, 0.057, 0.054, 0.068),
        (0.27, 0.053, 0.052, 0.060), (0.20, 0.050, 0.050, 0.054), (0.17, 0.048, 0.048, 0.050))]
    b.loft(rings, start=(x, 0.0, HIP[2] + 0.088), end="fan")
    b.end()

    b.begin(f"boot_shaft_{side}", "boot", w, proj=(X, Z))
    rings = [r(z, rx, f, bk, e=2.2) for z, rx, f, bk in (
        (0.242, 0.051, 0.052, 0.054), (0.25, 0.059, 0.061, 0.063), (0.20, 0.058, 0.059, 0.061),
        (0.15, 0.057, 0.061, 0.063), (0.11, 0.056, 0.065, 0.068), (0.08, 0.055, 0.06, 0.068))]
    b.loft(rings, start="fan", end="fan")
    b.end()

    b.begin(f"boot_foot_{side}", "boot", w, proj=(Y, Z))
    rings = []
    for y, hw, top in ((-0.075, 0.046, 0.102), (-0.045, 0.050, 0.124), (0.0, 0.052, 0.126), (0.04, 0.054, 0.11),
                       (0.09, 0.056, 0.088), (0.13, 0.054, 0.072), (0.16, 0.048, 0.062), (0.178, 0.038, 0.054)):
        bottom = 0.022
        rings.append(b.ring((x, y, (top + bottom) / 2), X, Z, hw, (top - bottom) / 2, 14, 3.0))
    b.loft(rings, start=(x, -0.088, 0.058), end=(x, 0.19, 0.04))
    b.end()

    b.begin(f"sole_{side}", "sole", w, proj=(Y, X))
    rings = [b.ring((x, y, 0.0135), X, Z, hw, 0.0135, 14, 6.0) for y, hw in (
        (-0.088, 0.042), (-0.08, 0.05), (0.0, 0.055), (0.09, 0.06), (0.15, 0.056), (0.185, 0.044), (0.196, 0.03))]
    b.loft(rings, start="fan", end="fan")
    b.end()

    # knee pad and cargo pocket move rigidly with the joint they sit on
    b.begin(f"knee_pad_{side}", "pad", Rigid(w, (x, 0.0, 0.50)))
    b.rounded_box((x, 0.08, 0.505), (X, Y, Z), (0.042, 0.011, 0.056), n=12, e=3.5, bevel=0.35)
    b.end()
    b.begin(f"cargo_{side}", "pants", Rigid(w, (x, 0.0, 0.72)))
    b.rounded_box((x + side * 0.083, 0.012, 0.70), (Y, X, Z), (0.046, 0.012, 0.062), n=12, e=5, bevel=0.3)
    b.end()


def build() -> Builder:
    b = Builder()
    _torso(b)
    _vest(b)
    _neck_head(b)
    for side in (-1, 1):
        _arm(b, side)
        _leg(b, side)
    return b


def summary(b: Builder) -> dict:
    lo = [min(p[i] for p in b.verts) for i in range(3)]
    hi = [max(p[i] for p in b.verts) for i in range(3)]
    return {"vertices": len(b.verts), "triangles": b.triangles(), "parts": len(b.parts),
            "bounds_min": [round(v, 4) for v in lo], "bounds_max": [round(v, 4) for v in hi]}


if __name__ == "__main__":
    import json

    print(json.dumps(summary(build()), indent=2))
