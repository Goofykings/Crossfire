"""Generate only the new SMG; preserve all existing weapon and map outputs.
blender -b --factory-startup -P blender/scripts/generate_smg.py
"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_all as pipeline

pipeline.bmat.set_public_dir(pipeline.PUBLIC)
pipeline.exporter.reset_scene()
collection = pipeline.exporter.collection('SMG')
parts, anchors = pipeline.weapon_lib.smg()
body = parts['body'].to_object('smg', collection, smooth_angle=32)
objects = [body]
for name, mesh in parts.items():
    if name == 'body':
        continue
    obj = mesh.to_object(name, collection, smooth_angle=32)
    obj.parent = body
    objects.append(obj)
for name, position in anchors.items():
    objects.append(pipeline.exporter.empty(name, collection, position, parent=body))
path = pipeline.SHARED / 'weapons' / 'smg.glb'
pipeline.exporter.export_glb(objects, path)
pipeline.record(path, 'weapon', 'Original compact SMG with detachable magazine and first-person anchors',
                [obj for obj in objects if obj.type == 'MESH'])
pipeline.setup_world()
source = pipeline.SOURCE / 'smg.blend'
pipeline.exporter.save_blend(source)
pipeline.record(source, 'blend', 'Editable source: original SMG')
pipeline.write_manifest()
