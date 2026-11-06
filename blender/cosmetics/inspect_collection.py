"""Open every delivered .blend in Blender and audit editable, packed sources. Never saves."""
from pathlib import Path
import sys,json,math
import bpy
ROOT=Path(__file__).resolve().parents[2]
manifest=json.loads((ROOT/'public/assets/cosmetics/foundry-collection.json').read_text())
report=[]
for entry in [*manifest['items'],manifest['crate']]:
    file=ROOT/entry['source'];bpy.ops.wm.open_mainfile(filepath=str(file),load_ui=False)
    scene=bpy.context.scene;meshes=[o for o in scene.objects if o.type=='MESH'];assert meshes
    for obj in meshes:
        assert obj.data.uv_layers, obj.name+' has no UVs'
        assert not obj.data.validate(verbose=True,clean_customdata=False),obj.name+' needed mesh repairs'
        assert all(math.isfinite(x) for v in obj.data.vertices for x in v.co)
    images=[img for img in bpy.data.images if img.source=='FILE' and img.users>0]
    assert all(img.packed_file for img in images),'Unpacked source texture'
    report.append(dict(source=entry['source'],meshes=len(meshes),materials=len({m.name for o in meshes for m in o.data.materials}),packedImages=len(images),uvLayers=True,meshValidation=True))
out=ROOT/'test-results/cosmetic-collection';out.mkdir(parents=True,exist_ok=True);(out/'blender-sources.json').write_text(json.dumps(report,indent=2))
print('PASS five editable Blender sources: valid meshes, UVs and packed images',flush=True)
