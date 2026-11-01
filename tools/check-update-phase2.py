"""Check editable mesh winding and exact shared map/collision reproduction without Blender."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'blender/scripts/lib'))
from meshkit import MeshData, face_normal, dot, sub
from props_industrial import pipe_bundle
from collision_gen import map_collision
from building import BuildingGenerator, Edge
from building_industrial import IndustrialBuildingGenerator
from building_modern import ModernBuildingGenerator
from layout_util import LayoutIndex

for a,b in [((0,0,0),(3,0,0)),((0,0,0),(0,3,0)),((1,2,3),(-2,4,5))]:
    m=MeshData();m.tube(a,b,.13,'galvanized')
    assert dot(face_normal([m.verts[i] for i in m.faces[-2]]),sub(a,b))>0
    assert dot(face_normal([m.verts[i] for i in m.faces[-1]]),sub(b,a))>0
m=pipe_bundle()
rims=[]
for f in m.faces:
    pts=[m.verts[i] for i in f]
    if all(abs(p[0]-pts[0][0])<1e-8 for p in pts) and abs(abs(pts[0][0])-1.5)<1e-8:
        assert face_normal(pts)[0]*pts[0][0]>0, 'pipe end normal points inward'
        assert len(pts)==4,'pipe mouths must be annuli, not solid caps'
        rims.append(f)
assert len(rims)==7*2*12
for name,cls in [('european-town',BuildingGenerator),('industrial-complex',IndustrialBuildingGenerator),('modern-city',ModernBuildingGenerator)]:
    l=json.loads((ROOT/f'src/maps/{name}/layout.json').read_text())
    actual=json.loads((ROOT/f'public/assets/models/{name}/collision.json').read_text())
    assert map_collision(l)==actual, f'{name}: stale collision'
    gen=cls(LayoutIndex(l));gen.md=MeshData()
    e=Edge((0,0),(2,0),(1,0),(0,1),2,'s')
    gen.wall_panel(e,0,2,0,3,'concrete_wall')
    assert len(gen.md.faces)==2
    front,back=[face_normal([gen.md.verts[i] for i in f]) for f in gen.md.faces[:2]]
    assert front[2]>.99 and back[2]<-.99
    assert max(v[2] for v in gen.md.verts)-min(v[2] for v in gen.md.verts)>=.12
sys.path.insert(0,str(ROOT/'tools'))
import layout_industrial
industrial=json.loads((ROOT/'src/maps/industrial-complex/layout.json').read_text())
assert layout_industrial.build()[1] == industrial, 'stale authored ladder/roof layout'
from industrial_roofs import parts
import kit_industrial as kit
for e in industrial['roofEquipment']:
    w,h,d=e['size'];x,y,z=e['pos']
    if e['kind']=='hvac': mesh=kit.hvac_unit(w,d,h)
    elif e['kind']=='fan': mesh=kit.extractor_fan(.3)
    elif e['kind']=='vent': mesh=kit.roof_vent_stack(.8)
    else: continue
    boxes=[b for b,_,tag in parts(industrial) if tag=='equipment:'+e['kind'] or (e['kind']=='hvac' and tag=='equipment:hvac_duct')]
    for v in mesh.verts:
        p=[v[0]+x,v[1]+y,v[2]+z]
        assert any(all(b[i]-1e-6<=p[i]<=b[i+3]+1e-6 for i in range(3)) for b in boxes), f"{e['kind']}: rendered equipment escapes its collider at {p}"
print('Map source solids, tube/pipe normals, hollow rims and all three collision exports pass')
