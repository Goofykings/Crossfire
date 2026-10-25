"""Development helper: build a few map buildings and render a preview PNG.

blender -b --factory-startup -P blender/scripts/preview_buildings.py -- B21 B23 B32 out.png
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))

import bpy  # noqa: E402

import bmat  # noqa: E402
import exporter  # noqa: E402
from building import BuildingGenerator  # noqa: E402
from layout_util import LayoutIndex  # noqa: E402

ROOT = HERE.parent.parent
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = Path(args[-1]) if args and args[-1].endswith(".png") else ROOT / "docs" / "preview.png"
ids = [a for a in args if not a.endswith(".png") and "=" not in a]

exporter.reset_scene()
bmat.set_public_dir(ROOT / "public")
layout = json.loads((ROOT / "src/maps/european-town/layout.json").read_text(encoding="utf-8"))
index = LayoutIndex(layout)
gen = BuildingGenerator(index)
col = exporter.collection("Buildings")
blds = [b for b in layout["buildings"] if not ids or b["id"] in ids]
cx = cz = 0.0
for b in blds:
    md, placements = gen.generate(b)
    root = exporter.empty(b["id"], col)
    shell = md.to_object(f"{b['id']}_shell", col)
    shell.parent = root
    for pl in placements:
        exporter.place_kit(pl.name, pl.factory, pl.xf, col, root)
    r = b["rect"]
    cx += (r[0] + r[2]) / 2
    cz += (r[1] + r[3]) / 2
cx /= len(blds)
cz /= len(blds)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.55, 0.65, 0.8, 1)
bg.inputs[1].default_value = 0.8
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 4.0
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(45), 0, math.radians(200))
scene.collection.objects.link(so)
cam = bpy.data.cameras.new("cam")
cam.lens = 28
co = bpy.data.objects.new("cam", cam)
scene.collection.objects.link(co)
scene.camera = co
def arg(name, default):
    return next((a.split("=", 1)[1] for a in args if a.startswith(name + "=")), default)


ids = [a for a in ids if "=" not in a]
cam_arg = arg("cam", None)
tgt_arg = arg("target", None)
if cam_arg:
    gx, gy, gz = (float(v) for v in cam_arg.split(","))
    tx, ty, tz = (float(v) for v in tgt_arg.split(",")) if tgt_arg else (cx, 4.0, cz)
else:
    dist = float(arg("dist", 22))
    az = math.radians(float(arg("az", 210)))
    el = math.radians(float(arg("el", 18)))
    gx = cx + math.sin(az) * math.cos(el) * dist
    gz = cz - math.cos(az) * math.cos(el) * dist
    gy = math.sin(el) * dist + 2
    tx, ty, tz = cx, 4.0, cz
cam.lens = float(arg("lens", 24))
co.location = (gx, -gz, gy)
direction = (tx - gx, -(tz - gz), ty - gy)
from mathutils import Vector  # noqa: E402

co.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()
# ground
bpy.ops.mesh.primitive_plane_add(size=200, location=(cx, -cz, 0))
scene.render.filepath = str(out)
bpy.ops.render.render(write_still=True)
print("rendered", out, len(blds), "buildings")
