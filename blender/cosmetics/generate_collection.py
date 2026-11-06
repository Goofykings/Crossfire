"""Create editable Foundry Collection assets without touching live game/catalog state.

python -I tools/make_cosmetic_textures.py
blender -b --factory-startup --python-exit-code 1 -P blender/cosmetics/generate_collection.py
Optional -- --only verdant-relay --samples 24 --no-renders
"""
from pathlib import Path
import sys, math, json, hashlib
import bpy
import bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.dont_write_bytecode=True
sys.path.insert(0,str(HERE));sys.path.insert(0,str(ROOT/'blender/scripts/lib'))
from collection_design import ITEMS,build,directory
from meshkit import MeshData
import exporter,bmat,weapon

ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
def option(name,default):return ARGS[ARGS.index(name)+1] if name in ARGS else default
SAMPLES=int(option('--samples',32))
REVIEW=ROOT/'test-results/cosmetic-collection/blender'
SOURCE=ROOT/'blender/source/cosmetics'


def linear(rgb):return [c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in [v/255 for v in rgb]]
def material(name,rgb,metal=0,rough=.5,alpha=1):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*linear(rgb),1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Alpha'].default_value=alpha
    if alpha<1:m.surface_render_method='DITHERED'
    m.diffuse_color=(*linear(rgb),alpha)
    return m


def textures(m,path):
    nt=m.node_tree;p=nt.nodes.get('Principled BSDF');p.location=(350,0)
    def image(file,space,loc):
        tex=nt.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(path/file),check_existing=True);tex.image.colorspace_settings.name=space;tex.location=loc;tex.image.pack();return tex
    a=image('finish-albedo.jpg','sRGB',(-600,180));nt.links.new(a.outputs['Color'],p.inputs['Base Color'])
    orm=image('finish-orm.png','Non-Color',(-600,-80));split=nt.nodes.new('ShaderNodeSeparateColor');split.location=(-300,-80);nt.links.new(orm.outputs['Color'],split.inputs[0]);nt.links.new(split.outputs['Green'],p.inputs['Roughness']);nt.links.new(split.outputs['Blue'],p.inputs['Metallic'])
    normal=image('finish-normal.png','Non-Color',(-600,-400));n=nt.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.28;n.location=(-50,-270);nt.links.new(normal.outputs['Color'],n.inputs['Color']);nt.links.new(n.outputs[0],p.inputs['Normal'])


def weapon_materials(item):
    name=item['id'];prefix=name+':'
    finish=material(prefix+'cerakote',item['color']);textures(finish,directory(item))
    graphite=material(prefix+'graphite',(37,42,49),.12,.67)
    steel=material(prefix+'machined-steel',(98,108,119),.83,.32)
    accent=material(prefix+'inlay',item['accent'],.74 if item['weapon']=='sniper' else .52,.29 if item['weapon']=='sniper' else .36)
    rubber=material(prefix+'rubber',(23,26,29),0,.88)
    brass=material(prefix+'brass',(166,126,60),.78,.36)
    glass=material(prefix+'glass',(55,98,110),.25,.12,.18)
    lens=material(prefix+'lens',(32,69,81),.48,.16)
    holo=material('reticle_holo',(240,105,53),0,.7)
    node=holo.node_tree.nodes.get('Principled BSDF');node.inputs['Emission Color'].default_value=(1,.13,.015,1);node.inputs['Emission Strength'].default_value=.6
    tex=holo.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'public/assets/textures/weapons/reticle_holo.png'),check_existing=True);tex.image.pack();holo.node_tree.links.new(tex.outputs['Alpha'],node.inputs['Alpha']);holo.surface_render_method='DITHERED';holo.use_backface_culling=False
    return {'collection_finish':finish,'collection_graphite':graphite,'collection_steel':steel,'collection_accent':accent,
            'gun_rubber':rubber,'brass':brass,'gun_black':graphite,'gun_glass':glass,'gun_lens':lens,'reticle_holo':holo,
            'sight_dot':material(prefix+'sight',(175,206,182),0,.6),'shell_red':material(prefix+'shell',(133,28,30),0,.58)}


def game(v):return Vector((v[0],-v[2],v[1]))
def studio():
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=SAMPLES;scene.cycles.use_denoising=True;scene.cycles.device='CPU'
    scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-.25
    world=bpy.data.worlds.new('Foundry neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.25,.29,.35,1);world.node_tree.nodes['Background'].inputs[1].default_value=.55;scene.world=world
    for name,loc,power,size,color in [('Key',(-1.8,-.6,2.6),200,2.0,(.87,.93,1)),('Rim',(1.3,1.8,1.3),200,1.6,(.72,.84,1)),('Softbox',(.4,-2.0,.6),90,1.5,(1,.86,.66))]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Review Camera');camera=bpy.data.objects.new('Review Camera',data);scene.collection.objects.link(camera);scene.camera=camera;data.lens=50


def render(objects,file,direction=(1,-.32,.35),size=(960,460),perspective=False):
    scene=bpy.context.scene;camera=scene.camera
    pts=[o.matrix_world@Vector(p) for o in objects if o.type=='MESH' and not o.hide_render for p in o.bound_box]
    lo=Vector(tuple(min(p[a] for p in pts) for a in range(3)));hi=Vector(tuple(max(p[a] for p in pts) for a in range(3)));center=(lo+hi)/2
    ray=Vector(direction).normalized();camera.location=center+ray*2;camera.rotation_euler=(-ray).to_track_quat('-Z','Y').to_euler()
    scene.render.resolution_x,scene.render.resolution_y=size
    # Fit projected bounds, including long, thin barrels, at a consistent margin.
    inverse=camera.rotation_euler.to_quaternion().inverted();local=[inverse@(p-center) for p in pts]
    width=max(p.x for p in local)-min(p.x for p in local);height=max(p.y for p in local)-min(p.y for p in local);aspect=size[0]/size[1]
    if perspective:
        camera.data.type='PERSP';camera.data.lens=44;dist=max(width,height*aspect)/(.36)*1.14;camera.location=center+ray*dist
    else:
        camera.data.type='ORTHO';camera.data.ortho_scale=max(width,height*aspect)*1.18
    scene.render.filepath=str(file);file.parent.mkdir(parents=True,exist_ok=True);bpy.ops.render.render(write_still=True)


def export(objects,path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_apply=True,
        export_yup=True,export_materials='EXPORT',export_image_format='AUTO',export_normals=True,
        export_texcoords=True,export_tangents=True,export_vertex_color='NONE',export_animations=False,
        export_cameras=False,export_lights=False,export_extras=True)
    bpy.ops.object.select_all(action='DESELECT')


def save(objects,path,title):
    # Pack textures, but keep an intelligible editable rig/mesh hierarchy.
    for image in bpy.data.images:
        if image.source=='FILE' and not image.packed_file:image.pack()
    bpy.context.scene['asset_notes']=title+' | original Crossfire design | metres, -Z muzzle | no visual offsets | embedded PBR | not granted or purchasable'
    for o in bpy.context.scene.objects:
        if o.type=='MESH':o.select_set(o in objects)
    bpy.context.view_layer.objects.active=objects[0]
    prefs=bpy.context.preferences.filepaths
    if hasattr(prefs,'file_preview_type'):prefs.file_preview_type='NONE'
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)


def clean_mesh(obj):
    # UV-preserving cleanup of collinear triangulation/bevel remnants only.
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.triangulate(bm,faces=list(bm.faces))
    zero=[f for f in bm.faces if f.calc_area()<1e-10]
    if zero:bmesh.ops.delete(bm,geom=zero,context='FACES_ONLY')
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bm.normal_update();bm.to_mesh(obj.data);bm.free();obj.data.update()


def create_weapon(item):
    exporter.reset_scene();bmat.set_public_dir(ROOT/'public');path=directory(item);path.mkdir(parents=True,exist_ok=True)
    parts,anchors,bounds=build(item);bmat._cache.update(weapon_materials(item))
    col=exporter.collection(item['name']);body=parts['body'].to_object(item['weapon'],col,smooth_angle=32);objects=[body]
    for name,md in parts.items():
        if name=='body':continue
        o=md.to_object(name,col,smooth_angle=32);o.parent=body;objects.append(o)
        if name=='shell':o.hide_render=True  # Runtime keeps the reload shell hidden until its action.
    objects.extend(exporter.empty(name,col,pos,parent=body) for name,pos in anchors.items())
    for o in objects:
        if o.type=='MESH':
            # Radial bevels on a concave decorative chevron can leave collinear cap
            # triangles. Remove only zero-area faces after UV-preserving triangulation.
            # Keep the actual surface, contacts, silhouette and UV seams unchanged.
            clean_mesh(o)
            o['cosmetic_id']=item['id']
    export(objects,path/'model.glb');studio();SOURCE.mkdir(parents=True,exist_ok=True)
    if '--no-renders' not in ARGS:
        render(objects,path/'thumbnail.png')
        render(objects,REVIEW/item['id']/'side.png',(1,0,.12))
        render(objects,REVIEW/item['id']/'front.png',(.35,1,.25),(700,700))
        render(objects,REVIEW/item['id']/'quarter.png',(1,.7,.52),(1100,650))
    save(objects,SOURCE/(item['id']+'.blend'),item['name'])
    print('CREATED',item['id'],flush=True)


def beveled_box(name,center,half,mat,col,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=2,location=game(center));o=bpy.context.object;o.name=name
    for c in list(o.users_collection):c.objects.unlink(o)
    col.objects.link(o);o.scale=(half[0],half[2],half[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(mat);mod=o.modifiers.new('Manufactured edge radii','BEVEL');mod.width=bevel;mod.segments=2
    mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True
    # UVs are kept editable even for these texture-free material blocks.
    return o


def create_crate():
    exporter.reset_scene();col=exporter.collection('Foundry Crate');path=ROOT/'public/assets/cosmetics/crate/foundry-crate';path.mkdir(parents=True,exist_ok=True)
    body=material('crate:graphite',(40,48,59),.5,.45);edge=material('crate:alloy',(115,137,157),.78,.30);blue=material('crate:blue',(29,75,113),.44,.40);black=material('crate:rubber',(23,27,33),0,.8);inlay=material('crate:inlay',(116,185,219),.65,.28)
    objects=[]
    def box(name,c,h,m,bevel=.012):objects.append(beveled_box(name,c,h,m,col,bevel));return objects[-1]
    box('Shell',(0,.32,0),(.42,.26,.29),body,.024)
    box('Lid',(0,.582,0),(.428,.028,.298),edge,.014)
    box('Lid insert',(0,.611,0),(.34,.008,.22),blue,.012)
    for s in (-1,1):
        for z in (-.245,.245):box('Corner boot',(s*.382,.15,z),(.052,.115,.052),black,.016)
        box('Front latch',(s*.28,.40,-.295),(.035,.085,.018),edge,.008)
        box('Latch inset',(s*.28,.41,-.315),(.019,.04,.006),blue,.004)
        box('Rear hinge',(s*.28,.56,.296),(.055,.018,.015),edge,.007)
        box('Handle foot',(s*.10,.638,0),(.025,.024,.025),edge,.008)
        box('Side frame',(s*.423,.34,0),(.012,.13,.18),edge,.009)
        box('Side insert',(s*.437,.34,0),(.005,.10,.145),blue,.006)
        for z in (-.08,0,.08):box('Side vent',(s*.444,.33,z),(.004,.007,.025),black,.003)
    box('Carry handle',(0,.662,0),(.12,.018,.022),black,.009)
    box('Front panel',(0,.34,-.294),(.19,.12,.009),blue,.012)
    # Solid four-sided jewel badge; shallow geometry rests on the front panel.
    md=MeshData();points=[(-.065,.34),(0,.405),(.065,.34),(0,.275)]
    for z,seq,n in [(-.306,points,(0,0,1)),(-.326,list(reversed(points)),(0,0,-1))]:md.face_toward([(x,y,z) for x,y in seq],'badge',n)
    for i,(x,y) in enumerate(points):
        xx,yy=points[(i+1)%4];md.face([(x,y,-.306),(xx,yy,-.306),(xx,yy,-.326),(x,y,-.326)],'badge')
    bmat._cache['badge']=inlay;objects.append(md.to_object('Crossfire diamond',col))
    # Consolidate static pieces by material: five primitives, no dozens of prop draw calls.
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.convert(target='MESH');bpy.ops.object.join();objects=[bpy.context.object];objects[0].name='foundry_crate'
    clean_mesh(objects[0]);export(objects,path/'model.glb');studio()
    if '--no-renders' not in ARGS:
        render(objects,path/'thumbnail.png',(.95,1.3,.85),(960,700))
        render(objects,REVIEW/'foundry-crate/front.png',(.12,1,.25),(800,700))
        render(objects,REVIEW/'foundry-crate/quarter.png',(.95,1.3,.85),(1100,800))
    save(objects,SOURCE/'foundry-crate.blend','Foundry Crate')
    print('CREATED foundry-crate',flush=True)


def manifest():
    entries=[]
    for item in ITEMS:
        rel=f"assets/cosmetics/{item['folder']}/{item['id']}"
        parts,anchors,_=build(item)
        entries.append(dict(catalogEntry=dict(id=item['id'],name=item['name'],weapon=item['weapon'],rarity=item['rarity'],
            ownership='grant',compatibleWith=[item['weapon']],asset=dict(model=rel+'/model.glb',binding='embedded'),preview=rel+'/thumbnail.png'),
            source='blender/source/cosmetics/'+item['id']+'.blend',textures=[rel+'/finish-albedo.jpg',rel+'/finish-orm.png',rel+'/finish-normal.png'],
            attachments='Original category hierarchy/anchors/part transforms; no offsets required',
            compatibility=dict(unit='metre',forwardAxis='-Z',upAxis='+Y',visualOffsetsRequired=False,
                anchors=list(anchors),movingParts=[name for name in parts if name!='body'],
                firstPersonPreset='RIG_CONFIGS.'+item['weapon'],thirdPersonPreset='WEAPON_HOLDS.'+item['weapon']),
            baseModel='assets/models/shared/weapons/'+item['weapon']+'.glb',
            baseSha256=hashlib.sha256((ROOT/'public/assets/models/shared/weapons'/f"{item['weapon']}.glb").read_bytes()).hexdigest()))
    data=dict(version=1,collection='Foundry Collection',status='assets-only; not registered, granted or purchasable',
        items=entries,crate=dict(id='foundry-crate',name='Foundry Crate',model='assets/cosmetics/crate/foundry-crate/model.glb',
            preview='assets/cosmetics/crate/foundry-crate/thumbnail.png',source='blender/source/cosmetics/foundry-crate.blend',functional=False))
    (ROOT/'public/assets/cosmetics/foundry-collection.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    selected=option('--only','all')
    for item in ITEMS:
        if selected in ('all',item['id']):create_weapon(item)
    if selected in ('all','foundry-crate'):create_crate()
    manifest()
