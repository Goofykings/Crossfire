"""Generate only the semi-automatic sniper; every other weapon, map and texture output is left alone.
blender -b --factory-startup -P blender/scripts/generate_semi_sniper.py
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_all as pipeline

pipeline.bmat.set_public_dir(pipeline.PUBLIC)
pipeline.exporter.reset_scene()
collection = pipeline.exporter.collection('Semi_sniper')
parts, anchors = pipeline.weapon_lib.semi_sniper()
body = parts['body'].to_object('semi_sniper', collection, smooth_angle=32)
objects = [body]
for name, mesh in parts.items():
    if name == 'body':
        continue
    obj = mesh.to_object(name, collection, smooth_angle=32)
    obj.parent = body
    objects.append(obj)
for name, position in anchors.items():
    objects.append(pipeline.exporter.empty(name, collection, position, parent=body))
path = pipeline.SHARED / 'weapons' / 'semi_sniper.glb'
pipeline.exporter.export_glb(objects, path)
pipeline.record(path, 'weapon',
                'semi_sniper first-person model: moving parts (mag) and anchors (' + ', '.join(anchors) + ')',
                [obj for obj in objects if obj.type == 'MESH'])
pipeline.setup_world()
source = pipeline.SOURCE / 'semi_sniper.blend'
pipeline.exporter.save_blend(source)
pipeline.record(source, 'blend', 'Editable source: semi-automatic sniper')
pipeline.write_manifest()
