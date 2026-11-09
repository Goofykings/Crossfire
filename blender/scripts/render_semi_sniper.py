"""Blender review renders of the semi-automatic sniper (and a lineup with the AR and bolt sniper).
blender -b --factory-startup -P blender/scripts/render_semi_sniper.py -- <absolute output dir> [samples] [view,view]
Writes transparent PNGs: side, three_quarter, rear_quarter, top, thumbnail (960x460), lineup.
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
import generate_all as pipeline

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = Path(argv[0])
samples = int(argv[1]) if len(argv) > 1 else 48
only = set(argv[2].split(',')) if len(argv) > 2 else None   # optional: render just these views
out.mkdir(parents=True, exist_ok=True)
pipeline.bmat.set_public_dir(pipeline.PUBLIC)
pipeline.exporter.reset_scene()


def build(wid, offset=(0.0, 0.0, 0.0)):
    parts, anchors = pipeline.weapon_lib.WEAPONS[wid]()
    col = pipeline.exporter.collection(wid)
    body = parts['body'].to_object(wid, col, smooth_angle=32, location=offset)
    for name, md in parts.items():
        if name != 'body':
            o = md.to_object(wid + '_' + name, col, smooth_angle=32, location=offset)
            o.parent = body
            o.matrix_parent_inverse = body.matrix_world.inverted()
    return body


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def meshes_of(body):
    return [body] + list(body.children)


scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.cycles.device = 'CPU'
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
pipeline.setup_world()
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.9 if 'Background' in scene.world.node_tree.nodes else 1.0
key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
key.data.energy = 3.0
key.rotation_euler = (0.9, 0.3, 0.6)
scene.collection.objects.link(key)
cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def shoot(name, objs, direction, size, lens=60.0, fit=1.12):
    if only and name not in only:
        return
    bpy.context.view_layer.update()
    lo, hi = bounds(objs)
    centre = (lo + hi) / 2
    ray = Vector(direction).normalized()
    cam.rotation_euler = (-ray).to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = lens
    cam.location = centre + ray * 3
    scene.render.resolution_x, scene.render.resolution_y = size
    inv = cam.rotation_euler.to_quaternion().inverted()
    local = [inv @ (o.matrix_world @ Vector(c) - centre) for o in objs for c in o.bound_box]
    w = max(abs(p.x) for p in local) * 2
    h = max(abs(p.y) for p in local) * 2
    aspect = size[0] / size[1]
    dist = max(w, h * aspect) / (2 * 0.5 * (36.0 / lens) / 1.0) * fit
    cam.location = centre + ray * dist
    scene.render.filepath = str(out / f'{name}.png')
    bpy.ops.render.render(write_still=True)


semi = build('semi_sniper')
objs = meshes_of(semi)
# Blender axes: x right, y = game -z (forward), z up. Muzzle points to +y.
shoot('side', objs, (1, 0.0, 0.03), (1500, 640))
shoot('three_quarter', objs, (0.9, 0.9, 0.55), (1500, 760))
shoot('rear_quarter', objs, (-0.8, -0.9, 0.5), (1500, 760))
shoot('top', objs, (0, 0.001, 1), (1500, 520))
shoot('thumbnail', objs, (0.9, 0.9, 0.55), (960, 460), fit=0.86)
for o in objs:
    o.hide_render = True
# lineup: AR, semi-auto sniper, bolt sniper stacked in game y so one side view compares their length and height
lineup = []
for wid, dy in (('rifle', 0.0), ('semi_sniper', 0.5), ('sniper', 1.0)):
    b = build(wid, (0.0, 0.0, 0.0))
    b.location.z = -dy
    lineup += meshes_of(b)
shoot('lineup', lineup, (1, 0.0, 0.0), (1500, 1300), lens=70.0)
