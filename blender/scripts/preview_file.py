"""Render a preview of an existing .blend (development helper).

blender -b <file.blend> -P blender/scripts/preview_file.py -- out.png [az=210] [el=30] [lens=35] [dist=1.0]
Frames every mesh object in the file.
"""
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = next(a for a in args if a.endswith(".png"))


def arg(name, default):
    return float(next((a.split("=", 1)[1] for a in args if a.startswith(name + "=")), default))


scene = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = int(arg("w", 1600))
scene.render.resolution_y = int(arg("h", 1000))
pts = []
for o in scene.objects:
    if o.type == "MESH" and o.visible_get():
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (lo + hi) / 2
radius = (hi - lo).length / 2
sun = bpy.data.lights.new("s", "SUN")
sun.energy = 3.0
so = bpy.data.objects.new("s", sun)
so.rotation_euler = (math.radians(40), 0, math.radians(30))
scene.collection.objects.link(so)
cam = bpy.data.cameras.new("c")
cam.lens = arg("lens", 35)
co = bpy.data.objects.new("c", cam)
scene.collection.objects.link(co)
scene.camera = co
az, el = math.radians(arg("az", 210)), math.radians(arg("el", 30))
dist = radius / math.tan(math.atan(18 / cam.lens)) * arg("dist", 1.0)
co.location = center + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
co.rotation_euler = (center - co.location).to_track_quat("-Z", "Y").to_euler()
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("rendered", out)
