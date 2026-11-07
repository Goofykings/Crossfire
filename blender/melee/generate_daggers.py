"""Generate Crossfire's original dual daggers, first-person arms and melee animation clips.

Run (factory settings, no bytecode):
  blender -b --factory-startup --python-expr "import sys; sys.dont_write_bytecode=True" \
      -P blender/melee/generate_daggers.py [-- --no-render]

Outputs (public/assets/models/shared/melee/):
  dagger_r.glb, dagger_l.glb  matched pair, embedded PBR materials, anchors
  melee_arms.glb              the player's own arms/gloves on the unchanged 26-joint rig
  dagger_clips.glb            six clips on animated empties (hand sockets, spins, elbows, torso)
  daggers.json                attachment, timing metadata and checkpoints for the runtime
  daggers-thumbnail.png       transparent pair render
blender/source/daggers.blend (editable models, rig and actions) and docs/melee/*.png renders.
All design numbers live in dagger_design.py.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import struct
import sys
import tempfile

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "blender/characters"))
import dagger_design as D  # noqa: E402

OUT = ROOT / "public/assets/models/shared/melee"
DOCS = ROOT / "docs/melee"
BLEND = ROOT / "blender/source/daggers.blend"
TMP = Path(tempfile.mkdtemp(prefix="crossfire-daggers-"))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

# Game (x, y, z) -> Blender (x, -z, y), and its rotation-matrix form.
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def to_b(v) -> Vector:
    return Vector((v[0], -v[2], v[1]))


def rot_b(x, y, z) -> Quaternion:
    """Blender quaternion of a game rotation given by its column axes."""
    m = Matrix(((x[0], y[0], z[0]), (x[1], y[1], z[1]), (x[2], y[2], z[2])))
    return (C @ m @ C.transposed()).to_quaternion()


def smooth(a: float, b: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------------------------
# Textures and materials
# --------------------------------------------------------------------------------------------
def noise(n: int, freq: float, seed: int, aspect: float = 1.0) -> np.ndarray:
    """Periodic band-limited noise (FFT), normalised to zero mean and unit deviation."""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f * aspect, f / aspect)
    r = np.sqrt(fx * fx + fy * fy) * n
    spectrum = np.exp(-((r - freq) ** 2) / (2 * (freq * 0.6) ** 2)) * (r > 0)
    field = np.real(np.fft.ifft2(spectrum * np.exp(2j * np.pi * rng.random((n, n)))))
    return (field - field.mean()) / (field.std() + 1e-9)


def save_image(name: str, rgb: np.ndarray, non_color: bool) -> bpy.types.Image:
    """Writes an RGB float array (rows from the top) as PNG and loads it packed."""
    n = rgb.shape[0]
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((n, n, 1))], axis=2)[::-1]
    image = bpy.data.images.new(name, n, n, alpha=False)
    image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    image.filepath_raw = str(TMP / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    image = bpy.data.images.load(str(TMP / f"{name}.png"), check_existing=False)
    image.name = name
    image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    image.pack()
    return image


def textures() -> dict[str, bpy.types.Image]:
    n = 256
    # Polished bevels: fine grinding streaks along the blade (image x = blade length).
    streak = noise(n, 40, 11, aspect=0.06) * 0.6 + noise(n, 90, 12, aspect=0.04) * 0.4
    rough = np.clip(0.13 + 0.035 * streak, 0.06, 0.25)
    steel_orm = np.stack([np.ones((n, n)), rough, np.ones((n, n))], axis=2)
    # Coated flats: soft stonewash mottling (roughness only) so reflections break up.
    mottle = noise(n, 9, 21) * 0.6 + noise(n, 30, 22) * 0.4
    coat_orm = np.stack([np.ones((n, n)), np.clip(0.34 + 0.03 * mottle, 0.2, 0.5), np.ones((n, n))], axis=2)
    # Grip: fine rounded diamond knurl height field -> tangent-space normal map.
    y, x = np.mgrid[0:n, 0:n] / n
    cells = 28
    height = (np.cos(2 * np.pi * (x + y) * cells) * np.cos(2 * np.pi * (x - y) * cells)) * 0.5 + 0.5
    gy, gx = np.gradient(height * 0.35)
    nx, ny = -gx * n / cells, gy * n / cells
    length = np.sqrt(nx * nx + ny * ny + 1)
    grip_normal = np.stack([nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, 1 / length * 0.5 + 0.5], axis=2)
    return {"steel": save_image("dagger_steel_orm", steel_orm, True),
            "coat": save_image("dagger_coat_orm", coat_orm, True),
            "grip": save_image("dagger_grip_normal", grip_normal, True)}


def material(name: str, color, metallic: float, roughness: float, orm=None, normal=None, normal_strength=1.0,
             emission=None) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if orm is not None:
        tex = nodes.new("ShaderNodeTexImage"); tex.image = orm
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(tex.outputs["Color"], sep.inputs["Color"])
        links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    if normal is not None:
        tex = nodes.new("ShaderNodeTexImage"); tex.image = normal
        nm = nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = normal_strength
        links.new(tex.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    return mat


def materials() -> dict[str, bpy.types.Material]:
    tex = textures()
    return {
        # Two-tone blade: dark coated flats/spine, bright polished grind and edge bevels.
        "coat": material("dagger_coat", (0.055, 0.058, 0.064), 1.0, 0.34, orm=tex["coat"]),
        "steel": material("dagger_steel", (0.86, 0.87, 0.89), 1.0, 0.13, orm=tex["steel"]),
        "metal": material("dagger_metal", (0.16, 0.17, 0.18), 1.0, 0.3),
        "grip": material("dagger_grip", (0.022, 0.024, 0.027), 0.0, 0.58, normal=tex["grip"], normal_strength=0.5),
        # Anodized teal accent shared by the pair (bolsters, guard tips, pommel); a faint glow
        # keeps it readable in dark interiors without becoming a light source.
        "accent": material("dagger_accent", (0.02, 0.36, 0.42), 1.0, 0.24, emission=((0.0, 0.55, 0.62), 0.25)),
    }


# --------------------------------------------------------------------------------------------
# Dagger geometry (game coordinates; built with the guard face at z = 0, blade toward -z)
# --------------------------------------------------------------------------------------------
class Geo:
    def __init__(self) -> None:
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[list[int], str, bool, list[tuple[float, float]]]] = []

    def v(self, p) -> int:
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.verts) - 1

    def f(self, idx, mat: str, smooth_: bool, uv=None) -> None:
        self.faces.append((list(idx), mat, smooth_, uv or [(0.0, 0.0)] * len(idx)))


def superellipse(rx: float, ry: float, k: int, e: float):
    out = []
    for i in range(k):
        a = 2 * math.pi * i / k
        c, s = math.cos(a), math.sin(a)
        out.append((math.copysign(abs(c) ** (2 / e), c) * rx, math.copysign(abs(s) ** (2 / e), s) * ry))
    return out


def loft(g: Geo, sections, mat_of, smooth_: bool, cap0: str | None, cap1: str | None, uv_scale=(1.0, 1.0)) -> None:
    """Sections: list of (points [(x, y, z)], ...) with equal counts; quads between them.
    `mat_of(i)` names the material of the band from section i to i + 1."""
    rings = [[g.v(p) for p in pts] for pts in sections]
    k = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        za, zb = sections[i][0][2], sections[i + 1][0][2]
        for j in range(k):
            j2 = (j + 1) % k
            u0, u1 = j / k * uv_scale[0], (j + 1) / k * uv_scale[0]
            g.f([a[j], a[j2], b[j2], b[j]], mat_of(i), smooth_,
                [(u0, za * uv_scale[1]), (u1, za * uv_scale[1]), (u1, zb * uv_scale[1]), (u0, zb * uv_scale[1])])
    for ring, mat, flip in ((rings[0], cap0, True), (rings[-1], cap1, False)):
        if not mat:
            continue
        pts = [g.verts[i] for i in ring]
        centre = g.v(tuple(sum(c) / len(pts) for c in zip(*pts)))
        for j in range(k):
            tri = [ring[j], ring[(j + 1) % k], centre]
            g.f(tri[::-1] if flip else tri, mat, False)


def blade(g: Geo, d: dict) -> list[float]:
    """Saber-ground blade: coated flats, polished grind and edge, swedge and distal taper.
    Returns the edge midpoint (y, z) for the trail anchor."""
    L, W = d["blade"], d["width"]
    y_tip = -0.06 * W
    spine0, edge0 = 0.4 * W, -0.6 * W
    u_s = L * (1 - d["swedge"])
    stations = [0.0, 0.002] + [L * (0.02 + 0.93 * (i / 23) ** 0.85) for i in range(24)]
    if d["jimping"]:
        stations += [0.012 + 0.004 * i for i in range(6)]
    stations = sorted(set(round(s, 6) for s in stations if s < L * 0.985))
    rings = []
    for u in stations:
        f = u / L
        top = spine0 if u < u_s else spine0 + (y_tip - spine0) * ((u - u_s) / (L - u_s)) ** 1.25
        belly = max(0.0, (u - 0.42 * L) / (0.58 * L))
        bot = edge0 + (y_tip - edge0) * belly ** 2.1
        if d["recurve"] and u < 0.55 * L:
            bot -= d["recurve"] * math.sin(math.pi * u / (0.55 * L))
        if d["jimping"] and 0.011 < u < 0.034 and round((u - 0.012) / 0.004) % 2 == 1:
            top -= 0.0007
        ts = d["spine"] * (1 - 0.55 * f ** 1.5)
        sw = 0.0 if u < u_s else (u - u_s) / (L - u_s)
        tt = ts * (1 - 0.75 * sw)  # the swedge sharpens the spine toward the tip
        grind = top - 0.5 * (top - bot)
        y_e = bot + min(0.003, 0.25 * (top - bot))
        z = -u
        rings.append([(tt / 2, top, z), (ts / 2, grind, z), (0.0006, y_e, z), (0.00018, bot, z),
                      (-0.00018, bot, z), (-0.0006, y_e, z), (-ts / 2, grind, z), (-tt / 2, top, z)])
    band = ["coat", "steel", "steel", "steel", "steel", "steel", "coat", "coat"]
    ids = [[g.v(p) for p in ring] for ring in rings]
    for i in range(len(ids) - 1):
        a, b = ids[i], ids[i + 1]
        for j in range(8):
            j2 = (j + 1) % 8
            pa, pb = g.verts[a[j]], g.verts[a[j2]]
            g.f([a[j], b[j], b[j2], a[j2]], band[j], False,
                [(-pa[2] * 6, pa[1] * 6), (-g.verts[b[j]][2] * 6, g.verts[b[j]][1] * 6),
                 (-g.verts[b[j2]][2] * 6, g.verts[b[j2]][1] * 6), (-pb[2] * 6, pb[1] * 6)])
    tip = g.v((0.0, y_tip, -L))
    last = ids[-1]
    for j in range(8):
        g.f([last[j], tip, last[(j + 1) % 8]], band[j], False)
    first = ids[0]
    centre = g.v((0.0, 0.0, 0.0))
    for j in range(8):
        g.f([first[(j + 1) % 8], centre, first[j]], "metal", False)
    mid = 0.5 * L
    return [edge0 + (y_tip - edge0) * max(0.0, (mid - 0.42 * L) / (0.58 * L)) ** 2.1, -mid]


def guard(g: Geo, d: dict) -> None:
    """Compact cross-guard: a longer lower quillon (finger guard) sweeping slightly forward,
    tapering toward accented tips. Lofted along y with rounded-rectangle sections."""
    h = d["guard"]
    lo, hi = -0.62 * h, 0.38 * h
    ys = [lo + (hi - lo) * i / 14 for i in range(15)]
    sections = []
    for y in ys:
        taper = 1 - 0.38 * (abs(y) / max(-lo, hi)) ** 1.6
        wx, wz = 0.0085 * taper, 0.0048 * taper
        zc = 0.0048 - (0.004 * ((-y / -lo) ** 2) if y < 0 else 0.0)
        pts = [(px, y, zc + pz) for px, pz in superellipse(wx, wz, 12, 3.2)]
        sections.append(pts)
    rings = [[g.v(p) for p in pts] for pts in sections]
    k = len(rings[0])
    for i in range(len(rings) - 1):
        mat = "accent" if i in (0, len(rings) - 2) else "metal"
        for j in range(k):
            j2 = (j + 1) % k
            g.f([rings[i][j], rings[i + 1][j], rings[i + 1][j2], rings[i][j2]], mat, True)
    for ring, flip in ((rings[0], False), (rings[-1], True)):
        pts = [g.verts[i] for i in ring]
        centre = g.v(tuple(sum(c) / len(pts) for c in zip(*pts)))
        for j in range(k):
            tri = [ring[j], ring[(j + 1) % k], centre]
            g.f(tri[::-1] if flip else tri, "accent", False)


def handle(g: Geo, d: dict) -> float:
    """Oval grip with cord-wrap ridges between an accented front bolster and a metal rear
    bolster; returns the z of its rear face."""
    z0, length = 0.0096, d["handle"]
    zs = [z0 + length * i / 64 for i in range(65)]
    sections = []
    for z in zs:
        t = (z - z0) / length
        bulge = 1 + 0.07 * math.sin(math.pi * min(1.0, max(0.0, (t - 0.05) / 0.85)))
        in_grip = 0.09 < t < 0.92
        ridge = 1 + (0.035 * (0.5 + 0.5 * math.cos(2 * math.pi * (z - z0) / 0.0068)) if in_grip else 0.0)
        flare = 1 + 0.12 * smooth(0.9, 1.0, t)
        rx, ry = 0.0124 * bulge * ridge * flare, 0.0153 * bulge * ridge * flare
        sections.append([(px, py - 0.0006, z) for px, py in superellipse(rx, ry, 18, 2.5)])

    def band(i: int) -> str:
        t = (zs[i] - z0) / length
        return "accent" if t < 0.08 else "metal" if t > 0.93 else "grip"
    loft(g, sections, band, True, None, "metal", uv_scale=(1.0, 8.0))
    return zs[-1]


def pommel(g: Geo, d: dict, z: float) -> list[float]:
    """Ring (right) or faceted spike (left); returns the pommel anchor (x, y, z)."""
    cap = [(z + 0.0105 * i / 6, 1.12 - 0.35 * smooth(0, 1, i / 6) ** 1.6) for i in range(7)]
    sections = [[(px, py - 0.0006, zz) for px, py in superellipse(0.0124 * s, 0.0153 * s, 18, 2.5)] for zz, s in cap]
    loft(g, sections, lambda i: "accent" if i == 0 else "metal", True, None, "metal")
    end = cap[-1][0]
    if d["pommel"] == "ring":
        # Lanyard ring in the blade plane (hole axis along x).
        R, r, cz = 0.0105, 0.0027, end + 0.0085
        rings = []
        for i in range(24):
            a = 2 * math.pi * i / 24
            centre = (0.0, math.sin(a) * R - 0.0006, cz - math.cos(a) * R)
            out = (0.0, math.sin(a), -math.cos(a))
            rings.append([g.v((math.cos(b) * r, centre[1] + out[1] * math.sin(b) * r, centre[2] + out[2] * math.sin(b) * r))
                          for b in (2 * math.pi * j / 10 for j in range(10))])
        for i in range(24):
            a, b = rings[i], rings[(i + 1) % 24]
            for j in range(10):
                g.f([a[j], b[j], b[(j + 1) % 10], a[(j + 1) % 10]], "metal", True)
        return [0.0, -0.0006, cz + R]
    # Faceted hexagonal spike (glass breaker), crisp facets.
    base = [g.v((math.cos(a) * 0.0078, math.sin(a) * 0.0092 - 0.0006, end)) for a in (math.pi / 6 + math.pi / 3 * i for i in range(6))]
    tip = g.v((0.0, -0.0006, end + 0.016))
    for i in range(6):
        g.f([base[i], base[(i + 1) % 6], tip], "accent" if i % 3 == 0 else "metal", False)
    centre = g.v((0.0, -0.0006, end))
    for i in range(6):
        g.f([base[(i + 1) % 6], base[i], centre], "metal", False)
    return [0.0, -0.0006, end + 0.016]


def make_mesh(name: str, g: Geo, mats: dict[str, bpy.types.Material], shift_z: float) -> bpy.types.Object:
    order = list(mats)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(to_b((x, y, z + shift_z))) for x, y, z in g.verts], [], [f[0] for f in g.faces])
    for key in order:
        mesh.materials.append(mats[key])
    uv = mesh.uv_layers.new(name="UVMap")
    for poly, (_, mat, smooth_, uvs) in zip(mesh.polygons, g.faces):
        poly.material_index = order.index(mat)
        poly.use_smooth = smooth_
        for loop, coord in zip(poly.loop_indices, uvs):
            uv.data[loop].uv = coord
    mesh.validate()
    # Outward winding per closed/open part (glTF back faces are culled).
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def empty(name: str, parent=None, location=(0, 0, 0), size=0.02) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = size
    obj.empty_display_type = "PLAIN_AXES"
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = to_b(location)
    return obj


def make_dagger(side: str, mats) -> tuple[bpy.types.Object, dict]:
    d = D.DAGGERS[side]
    g = Geo()
    edge = blade(g, d)
    guard(g, d)
    rear = handle(g, d)
    pom = pommel(g, d, rear)
    shift = -d["grip_from_guard"]  # handle centre at the origin
    root = empty(f"dagger_{side}", size=0.05)
    body = make_mesh(f"dagger_{side}_mesh", g, mats, shift)
    body.parent = root
    anchors = {"grip": [0.0, 0.0, 0.0], "tip": [0.0, -0.06 * d["width"], -d["blade"] + shift],
               "edge": [0.0, edge[0], edge[1] + shift], "guard": [0.0, 0.0, shift],
               "pommel": [pom[0], pom[1], pom[2] + shift], "spin_pivot": list(D.SPIN_PIVOT)}
    for name, at in anchors.items():
        empty(f"{name}_{side}", root, at, 0.01)
    tris = sum(len(f[0]) - 2 for f in g.faces)
    lo = [min(v[i] for v in g.verts) for i in range(3)]
    hi = [max(v[i] for v in g.verts) for i in range(3)]
    info = {"triangles": tris, "length": round(hi[2] - lo[2], 4), "anchors": {k: [round(c, 5) for c in v] for k, v in anchors.items()},
            "bounds": {"min": [round(lo[0], 4), round(lo[1], 4), round(lo[2] + shift, 4)],
                       "max": [round(hi[0], 4), round(hi[1], 4), round(hi[2] + shift, 4)]}}
    return root, info


# --------------------------------------------------------------------------------------------
# First-person arms: the existing character's arm, cuff, glove and finger parts on its rig
# --------------------------------------------------------------------------------------------
ARM_PARTS = ("arm_", "glove_cuff_", "palm_", "finger_", "thumb_")


def make_arms():
    import generate_player as gp  # noqa: E402  (bpy module; main() is not run)
    gp.OUT = TMP  # its atlas PNGs are written here and packed, not into public/
    obj, rig, data = gp.make_character()
    keep = set()
    for part in data.parts:
        if part["name"].startswith(ARM_PARTS):
            keep.update(range(part["f0"], part["f1"]))
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for i, f in enumerate(bm.faces) if i not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.name, rig.name = "MeleeArms", "MeleeArmsRig"
    obj.data.name = "MeleeArmsGeometry"
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    return obj, rig, tris


# --------------------------------------------------------------------------------------------
# Animation clips on empties
# --------------------------------------------------------------------------------------------
def body_quat(ypr) -> Quaternion:
    yaw, pitch, roll = ypr
    ry = Matrix.Rotation(yaw, 3, "Y")
    rx = Matrix.Rotation(pitch, 3, "X")
    rz = Matrix.Rotation(roll, 3, "Z")
    m = ry @ rx @ rz  # game axes
    return (C @ m @ C.transposed()).to_quaternion()


def make_rig():
    rig = empty("melee_rig", size=0.08)
    nodes = {"rig": rig}
    for side in ("r", "l"):
        socket = empty(f"socket_{side}", rig, size=0.04)
        socket.rotation_mode = "QUATERNION"
        spin = empty(f"spin_{side}", socket, D.SPIN_PIVOT, 0.015)
        spin.rotation_mode = "AXIS_ANGLE"
        back = empty(f"spin_back_{side}", spin, tuple(-c for c in D.SPIN_PIVOT), 0.01)
        twirl = empty(f"twirl_{side}", back, (0, 0, 0), 0.01)
        twirl.rotation_mode = "AXIS_ANGLE"
        dagger = empty(f"carry_{side}", twirl, (0, 0, 0), 0.03)
        pole = empty(f"pole_{side}", rig, (0, 0, 0), 0.02)
        nodes.update({f"socket_{side}": socket, f"spin_{side}": spin, f"twirl_{side}": twirl, f"carry_{side}": dagger,
                      f"pole_{side}": pole, f"spin_back_{side}": back})
    body = empty("body", rig, size=0.05)
    body.rotation_mode = "QUATERNION"
    nodes["body"] = body
    return nodes


def key(obj, path, frame):
    obj.keyframe_insert(data_path=path, frame=frame)


def animate(nodes) -> dict:
    scene = bpy.context.scene
    scene.render.fps = D.FPS
    spin_axis, twirl_axis = to_b(D.SPIN_AXIS), to_b(D.TWIRL_AXIS)
    for obj in nodes.values():
        obj.animation_data_create()
    for clip_name, clip in D.CLIPS.items():
        end = round(clip["duration"] * D.FPS)
        actions = {}
        for name, obj in nodes.items():
            if name == "rig" or name.startswith("spin_back"):
                continue
            action = bpy.data.actions.new(f"{clip_name}:{name}")
            action.use_fake_user = True
            obj.animation_data.action = action
            actions[name] = action
        for side in ("r", "l"):
            socket, pole = nodes[f"socket_{side}"], nodes[f"pole_{side}"]
            prev = None
            for t, pose in D.channel(clip, f"hand_{side}"):
                frame = t * D.FPS
                x, y, z = D.hand_axes(side, pose)
                q = rot_b(x, y, z)
                if prev is not None and q.dot(prev) < 0:
                    q.negate()
                prev = q
                socket.location = to_b(pose["p"])
                socket.rotation_quaternion = q
                key(socket, "location", frame)
                key(socket, "rotation_quaternion", frame)
                pole.location = to_b(D.norm(pose["e"] or (D.ELBOW_R if side == "r" else D.ELBOW_L)))
                key(pole, "location", frame)
            for kind, axis in (("spin", spin_axis), ("twirl", twirl_axis)):
                obj = nodes[f"{kind}_{side}"]
                for t, deg in D.channel(clip, f"{kind}_{side}"):
                    obj.rotation_axis_angle = (math.radians(deg), axis.x, axis.y, axis.z)
                    key(obj, "rotation_axis_angle", t * D.FPS)
            dagger = nodes[f"carry_{side}"]
            for t, s in D.channel(clip, f"scale_{side}"):
                dagger.scale = (max(s, 1e-4),) * 3  # glTF forbids singular scale; the runtime hides < 1%
                key(dagger, "scale", t * D.FPS)
        body = nodes["body"]
        prev = None
        for t, ypr in D.channel(clip, "body"):
            q = body_quat(ypr)
            if prev is not None and q.dot(prev) < 0:
                q.negate()
            prev = q
            body.rotation_quaternion = q
            key(body, "rotation_quaternion", t * D.FPS)
        for name, action in actions.items():
            obj = nodes[name]
            track = obj.animation_data.nla_tracks.new()
            track.name = clip_name
            track.mute = True
            strip = track.strips.new(clip_name, 0, action)
            strip.action_frame_start, strip.action_frame_end = 0, end
            obj.animation_data.action = None
    return checkpoints(nodes)


def evaluate(nodes, clip_name: str, t: float):
    """Pose the rig at a clip time through the Blender fcurves (no NLA) and read world data."""
    for name, obj in nodes.items():
        if name == "rig" or name.startswith("spin_back"):
            continue
        obj.animation_data.action = bpy.data.actions[f"{clip_name}:{name}"]
    bpy.context.scene.frame_set(round(t * D.FPS))
    bpy.context.view_layer.update()
    out = {}
    for side in ("r", "l"):
        tip = Vector((0.0, -0.06 * D.DAGGERS[side]["width"], -D.DAGGERS[side]["blade"] - D.DAGGERS[side]["grip_from_guard"]))
        world = nodes[f"carry_{side}"].matrix_world
        g = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]  # Blender -> game
        out[f"hand_{side}"] = g(nodes[f"socket_{side}"].matrix_world.translation)
        out[f"tip_{side}"] = g(world @ to_b(tip))
        out[f"scale_{side}"] = round(nodes[f"carry_{side}"].scale.x, 4)
    for obj in nodes.values():
        if obj.animation_data:
            obj.animation_data.action = None
    return out


def checkpoints(nodes) -> dict:
    result = {}
    for clip_name, clip in D.CLIPS.items():
        d = clip["duration"]
        # Whole frames, where the exported 60 Hz samples equal Blender's own evaluation.
        times = sorted({round(round(d * f * D.FPS) / D.FPS, 5) for f in (0.0, 0.25, 0.5, 0.75)} | {round(d - 1 / D.FPS, 5)})
        result[clip_name] = [{"t": t, **evaluate(nodes, clip_name, t)} for t in times]
    return result


def set_rest(nodes) -> None:
    """Static node transforms (used where a clip omits nothing, but kept sane): idle at t = 0."""
    for side, pose in (("r", D.IDLE_R), ("l", D.IDLE_L)):
        nodes[f"socket_{side}"].location = to_b(pose["p"])
        nodes[f"socket_{side}"].rotation_quaternion = rot_b(*D.hand_axes(side, pose))
        nodes[f"pole_{side}"].location = to_b(D.norm(pose["e"]))
        nodes[f"carry_{side}"].scale = (1, 1, 1)
        for kind, axis in (("spin", D.SPIN_AXIS), ("twirl", D.TWIRL_AXIS)):
            a = to_b(axis)
            nodes[f"{kind}_{side}"].rotation_axis_angle = (0.0, a.x, a.y, a.z)
    nodes["body"].rotation_quaternion = (1, 0, 0, 0)


# --------------------------------------------------------------------------------------------
# Export, inspection, renders and manifest
# --------------------------------------------------------------------------------------------
def select_tree(roots) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for root in roots:
        for obj in [root, *root.children_recursive]:
            obj.select_set(True)
    bpy.context.view_layer.objects.active = roots[0]


def export(path: Path, roots, animations=False, skins=False) -> dict:
    select_tree(roots)
    kwargs = dict(filepath=str(path), export_format="GLB", use_selection=True, export_yup=True,
                  export_materials="EXPORT", export_image_format="AUTO", export_extras=False,
                  export_animations=animations, export_skins=skins, export_morph=False)
    if animations:
        kwargs.update(export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_frame_range=False,
                      export_optimize_animation_size=False, export_optimize_animation_keep_anim_object=True)
    if skins:
        kwargs.update(export_def_bones=False)
    bpy.ops.export_scene.gltf(**kwargs)
    raw = path.read_bytes()
    assert raw[:4] == b"glTF"
    return json.loads(raw[20:20 + struct.unpack_from("<I", raw, 12)[0]])


def check_dagger(doc: dict, side: str) -> None:
    names = {n["name"] for n in doc["nodes"]}
    assert {f"dagger_{side}"} | {f"{a}_{side}" for a in ("grip", "tip", "edge", "guard", "pommel", "spin_pivot")} <= names, names
    assert {m["name"] for m in doc["materials"]} == {"dagger_coat", "dagger_steel", "dagger_metal", "dagger_grip", "dagger_accent"}
    assert all("bufferView" in image and "uri" not in image for image in doc["images"])


def check_clips(doc: dict) -> None:
    animations = {a["name"]: a for a in doc["animations"]}
    assert set(animations) == set(D.CLIPS), list(animations)
    wanted = {f"{k}_{s}" for k in ("socket", "spin", "twirl", "carry", "pole") for s in "rl"} | {"body"}
    for name, animation in animations.items():
        targets = {doc["nodes"][c["target"]["node"]]["name"] for c in animation["channels"]}
        assert wanted <= targets, (name, wanted - targets)


def check_arms(doc: dict) -> None:
    assert len(doc["skins"]) == 1 and len(doc["skins"][0]["joints"]) == 26
    joints = {doc["nodes"][j]["name"] for j in doc["skins"][0]["joints"]}
    assert {"clavicle_r", "upper_arm_r", "forearm_r", "hand_r", "index_3_l"} <= joints
    assert not doc.get("animations")


def studio(world_strength=1.0) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    env = nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(ROOT / "public/assets/env/sky_city_1k.hdr"))
    links.new(env.outputs["Color"], nodes["Background"].inputs["Color"])
    nodes["Background"].inputs["Strength"].default_value = world_strength
    scene.world = world
    for name, energy, rot in (("key", 3.5, (50, 0, 35)), ("rim", 2.5, (-60, 0, -150))):
        light = bpy.data.lights.new(name, "SUN")
        light.energy = energy
        light.angle = math.radians(8)
        obj = bpy.data.objects.new(name, light)
        obj.rotation_euler = tuple(math.radians(a) for a in rot)
        bpy.context.collection.objects.link(obj)


def render(path: Path, camera_at, target, lens=60, size=(900, 600)) -> None:
    scene = bpy.context.scene
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
        bpy.context.collection.objects.link(cam)
        scene.camera = cam
    cam.data.lens = lens
    cam.location = Vector(camera_at)
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def renders(daggers) -> None:
    """Model sheet renders (Cycles, transparent) in Blender coordinates around the daggers."""
    DOCS.mkdir(parents=True, exist_ok=True)
    studio()
    r, l = daggers["r"], daggers["l"]
    for obj in bpy.data.objects:
        obj.hide_render = obj.type == "ARMATURE" or obj.name.startswith("MeleeArms")
    # Side by side, flats to camera, blades up.
    # Side by side (blades up, edges toward +y), flats to a camera on +x.
    r.location, r.rotation_euler = (0, 0.045, 0), (math.radians(90), 0, 0)
    l.location, l.rotation_euler = (0, -0.045, 0), (math.radians(90), 0, 0)
    bpy.context.view_layer.update()
    render(DOCS / "daggers-side.png", (0.62, 0.0, 0.05), (0.0, 0.0, 0.05), lens=38)
    render(DOCS / "daggers-handles.png", (0.17, -0.2, 0.09), (0.0, 0.0, 0.02), lens=60)
    render(DOCS / "daggers-blades.png", (0.22, 0.16, 0.2), (0.0, 0.0, 0.12), lens=55)
    # Crossed hero pose for the thumbnail and an angled sheet.
    # Crossed in the plane facing a camera on +x, so the flats and bevels read (not edge-on).
    r.location, r.rotation_euler = (-0.012, 0.0, 0.0), (math.radians(90 + 27), 0.0, 0.0)
    l.location, l.rotation_euler = (0.012, 0.0, 0.0), (math.radians(90 - 27), 0.0, 0.0)
    bpy.context.view_layer.update()
    render(DOCS / "daggers-crossed.png", (0.42, -0.3, 0.16), (0.0, 0.0, 0.04), lens=45)
    render(OUT / "daggers-thumbnail.png", (0.6, -0.12, 0.08), (0.0, 0.0, 0.035), lens=46, size=(512, 512))
    for obj in (r, l):
        obj.location, obj.rotation_euler = (0, 0, 0), (0, 0, 0)


def register(info: dict) -> None:
    manifest_file = ROOT / "public/assets/asset-manifest.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf8"))
    script = "blender/melee/generate_daggers.py"
    rel = "assets/models/shared/melee/"
    entries = {
        "blender/source/daggers.blend": ("melee-source", "Editable dagger pair, first-person arms, clip rig and six melee actions", {}),
        rel + "dagger_r.glb": ("melee-weapon", "Right dagger: ring pommel, two-tone saber-ground blade, anchors", {"triangles": info["r"]["triangles"], "embeddedMaterials": True}),
        rel + "dagger_l.glb": ("melee-weapon", "Left dagger: recurved blade, jimping, spike pommel, anchors", {"triangles": info["l"]["triangles"], "embeddedMaterials": True}),
        rel + "melee_arms.glb": ("melee-arms", "First-person arms and gloves from the player character, unchanged 26-joint rig", {"triangles": info["arms"], "embeddedMaterials": True}),
        rel + "dagger_clips.glb": ("melee-clips", "Six melee clips on animated empties (hand sockets, spins, elbows, torso)", {}),
        rel + "daggers.json": ("melee-metadata", "Attachment, clip timing, combo and checkpoint metadata", {}),
        rel + "daggers-thumbnail.png": ("melee-thumbnail", "Transparent 512px render of the dagger pair", {}),
    }
    out = []
    for path, (kind, description, extra) in entries.items():
        file = (ROOT if path.startswith("blender/") else ROOT / "public") / path
        if not file.exists():  # renders skipped with --no-render
            continue
        out.append(dict(path=path, kind=kind, bytes=file.stat().st_size, description=description, script=script, **extra))
    manifest["assets"] = sorted([a for a in manifest["assets"] if a["path"] not in entries] + out, key=lambda a: a["path"])
    manifest_file.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf8")
    # Keep whatever header the other generators wrote; only the table is rebuilt.
    md = ROOT / "docs/ASSET_MANIFEST.md"
    old = md.read_text(encoding="utf8").split("\n")
    header = old[:old.index("| File | Kind | Size | Triangles | Description |")] if "| File | Kind | Size | Triangles | Description |" in old else ["# Asset manifest", ""]
    lines = header + ["| File | Kind | Size | Triangles | Description |", "|---|---|---:|---:|---|"]
    for a in manifest["assets"]:
        lines.append(f"| `{a['path']}` | {a['kind']} | {a['bytes'] / 1024:.0f} KB | {a.get('triangles', '')} | {a['description']} |")
    (ROOT / "docs/ASSET_MANIFEST.md").write_text("\n".join(lines) + "\n", encoding="utf8")


def main() -> None:
    errors = D.validate()
    assert not errors, errors
    OUT.mkdir(parents=True, exist_ok=True)
    if hasattr(bpy.context.preferences.filepaths, "file_preview_type"):
        bpy.context.preferences.filepaths.file_preview_type = "NONE"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    mats = materials()
    daggers, info = {}, {}
    for side in ("r", "l"):
        daggers[side], info[side] = make_dagger(side, mats)
        check_dagger(export(OUT / f"dagger_{side}.glb", [daggers[side]]), side)
    arms, arms_rig, info["arms"] = make_arms()
    check_arms(export(OUT / "melee_arms.glb", [arms_rig], skins=True))
    nodes = make_rig()
    points = animate(nodes)
    set_rest(nodes)
    check_clips(export(OUT / "dagger_clips.glb", [nodes["rig"]], animations=True))
    meta = D.metadata()
    meta["models"] = {side: {"file": f"assets/models/shared/melee/dagger_{side}.glb", **info[side]} for side in ("r", "l")}
    meta["arms"] = {"file": "assets/models/shared/melee/melee_arms.glb", "triangles": info["arms"]}
    meta["clipsFile"] = "assets/models/shared/melee/dagger_clips.glb"
    meta["checkpoints"] = points
    (OUT / "daggers.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf8")
    if "--no-render" not in ARGS:
        renders(daggers)
    # Preview layout in the .blend: daggers side by side, arms hidden, the rig at the origin.
    arms.hide_set(True); arms_rig.hide_set(True)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    register(info)
    print("MELEE_EXPORT", json.dumps({"daggers": {s: {k: info[s][k] for k in ("triangles", "length")} for s in "rl"},
                                      "arms": info["arms"], "clips": {n: c["duration"] for n, c in D.CLIPS.items()}}))


if __name__ == "__main__":
    main()
