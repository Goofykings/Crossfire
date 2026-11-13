"""Rebuild Farmstead collision debug GLB; --terrain also updates authored terrain.

Does not regenerate weapons, props, other maps or their Blender sources.
"""
import sys,json
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'blender/scripts/lib'))
import exporter
exporter.reset_scene()
terrain_path=ROOT/'public/assets/models/farmstead/terrain.glb'
terrain_object=None
if '--terrain' in sys.argv:
    import bmat,underground,collision_gen
    from terrain_farm import FarmTerrain
    bmat.set_public_dir(ROOT/'public')
    layout=json.loads((ROOT/'src/maps/farmstead/layout.json').read_text())
    (ROOT/'public/assets/models/farmstead/collision.json').write_text(json.dumps(collision_gen.map_collision(layout),separators=(',',':')))
    terrain=FarmTerrain(layout).build()
    for passage in layout.get('underground',[]):terrain.merge(underground.generate(passage))
    terrain_object=terrain.to_object('terrain',exporter.collection('Terrain'))
    exporter.export_glb([terrain_object],terrain_path)
data=json.loads((ROOT/'public/assets/models/farmstead/collision.json').read_text())
collection=exporter.collection('Collision')
objects=[exporter.box_object(f"COL_{i:04d}_{b['tag'].replace(':','_')}",b['c'],b['h'],b.get('yaw',0),collection) for i,b in enumerate(data['boxes'])]
target=ROOT/'public/assets/models/farmstead/collision_debug.glb'
exporter.export_glb(objects,target)
manifest_path=ROOT/'public/assets/asset-manifest.json'
manifest=json.loads(manifest_path.read_text())
for entry in manifest['assets']:
    if entry['path']=='assets/models/farmstead/collision.json':
        entry['bytes']=(ROOT/'public'/entry['path']).stat().st_size
        entry['description']=f"{len(objects)} movement boxes plus {len(data['roofSurfaces'])} exact roof bullet surfaces"
    if entry['path']=='assets/models/farmstead/collision_debug.glb':
        entry['bytes']=target.stat().st_size
        entry['triangles']=len(objects)*12
    if terrain_object is not None and entry['path']=='assets/models/farmstead/terrain.glb':
        entry['bytes']=terrain_path.stat().st_size
        entry['triangles']=sum(len(face.vertices)-2 for face in terrain_object.data.polygons)
manifest_path.write_text(json.dumps(manifest,indent=1)+'\n')
