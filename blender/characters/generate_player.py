"""Generate Crossfire's original, in-place, skinned multiplayer character.

Run: blender -b --factory-startup -P blender/characters/generate_player.py
Uses the existing analytic character geometry, not map/weapon generators.
Reference studied: references_images/Player.png (cap, beard, dark tactical clothing).
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import struct
import sys
import zlib

import bpy
from mathutils import Quaternion, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import char_geometry as geo

OUT = ROOT / "public/assets/characters"
FPS = 30
CLIPS = {"IDLE": 2.4, "RUN": 0.8, "JUMP_START": 0.2, "JUMP_LOOP": 0.8, "JUMP_LAND": 0.3, "SLIDE": 1.0}
# Deliberately distinct skin/fabric/gear materials; a single embedded atlas pair is shared.
COLORS = [(.65, .47, .35), (.24, .265, .27), (.20, .23, .22), (.105, .125, .13),
          (.15, .17, .17), (.085, .10, .105), (.11, .12, .12), (.15, .17, .17),
          (.065, .075, .08), (.105, .12, .12), (.13, .095, .075), (.10, .13, .14),
          (.46, .49, .50), (.08, .09, .09), (.46, .29, .25), (.12, .14, .145)]


def png(file, roughness=False):
    """Small deterministic atlas, no external imaging dependency or downloads."""
    size = 256
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            cell = (3 - y // 64) * 4 + x // 64
            if roughness:
                r = .30 if cell == geo.CELL["metal"] else .48 if cell == geo.CELL["eye"] else .82
                rgb = (1, r, .65 if cell == geo.CELL["metal"] else 0)
            else:
                grain = (math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 - .5
                weave = .008 * math.sin(x * math.pi / 2) * math.cos(y * math.pi / 2)
                rgb = [c + grain * .016 + weave for c in COLORS[cell]]
            rows.extend(max(0, min(255, round(c * 255))) for c in rgb)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    file.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', size, size, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b''))


def materials():
    result = []
    textures = []
    for name, orm in (("player-albedo.png", False), ("player-orm.png", True)):
        file = OUT / name
        png(file, orm)
        image = bpy.data.images.load(str(file), check_existing=True)
        image.colorspace_settings.name = 'Non-Color' if orm else 'sRGB'
        image.pack()
        textures.append(image)
    for name in ("player_skin", "player_fabric", "player_gear"):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get('Principled BSDF')
        color = nodes.new('ShaderNodeTexImage'); color.image = textures[0]
        packed = nodes.new('ShaderNodeTexImage'); packed.image = textures[1]
        separate = nodes.new('ShaderNodeSeparateColor')
        links = mat.node_tree.links
        links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(packed.outputs['Color'], separate.inputs['Color'])
        links.new(separate.outputs['Green'], bsdf.inputs['Roughness'])
        links.new(separate.outputs['Blue'], bsdf.inputs['Metallic'])
        result.append(mat)
    return result


def make_character():
    data = geo.build()
    mesh = bpy.data.meshes.new('PlayerGeometry')
    mesh.from_pydata(data.verts, [], [face for face, _ in data.faces])
    mesh.update()
    obj = bpy.data.objects.new('Player', mesh)
    bpy.context.collection.objects.link(obj)
    for mat in materials(): mesh.materials.append(mat)
    uvs = data.loop_uvs()
    layer = mesh.uv_layers.new(name='UVMap')
    skin = {geo.CELL[n] for n in ('skin', 'eye', 'lip')}
    fabric = {geo.CELL[n] for n in ('shirt', 'pants', 'cap')}
    for poly, (_, cell), face_uvs in zip(mesh.polygons, data.faces, uvs):
        poly.material_index = 0 if cell in skin else 1 if cell in fabric else 2
        poly.use_smooth = True
        for loop, uv in zip(poly.loop_indices, face_uvs): layer.data[loop].uv = uv
    armature = bpy.data.armatures.new('PlayerRig')
    rig = bpy.data.objects.new('PlayerRig', armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in geo.bones():
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        if parent: bone.parent = armature.edit_bones[parent]
        bone.use_deform = True
    bpy.ops.object.mode_set(mode='OBJECT')
    for name, *_ in geo.bones(): obj.vertex_groups.new(name=name)
    for i, weights in enumerate(data.weights):
        assert abs(sum(weights.values()) - 1) < 1e-5 and len(weights) <= 4
        for name, weight in weights.items(): obj.vertex_groups[name].add([i], weight, 'REPLACE')
    mod = obj.modifiers.new('PlayerSkin', 'ARMATURE'); mod.object = rig
    obj.parent = rig
    for bone in rig.pose.bones: bone.rotation_mode = 'QUATERNION'
    return obj, rig, data


def set_pose(rig, clip, t):
    """All animation remains local. The root bone never translates or rotates."""
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0); bone.rotation_quaternion = (1, 0, 0, 0); bone.scale = (1, 1, 1)
    def rotate(name, x=0, y=0, z=0):
        bone = rig.pose.bones[name]
        rest = bone.bone.matrix_local.to_quaternion()
        q = Quaternion((0, 0, 1), math.radians(z)) @ Quaternion((0, 1, 0), math.radians(y)) @ Quaternion((1, 0, 0), math.radians(x))
        bone.rotation_quaternion = rest.inverted() @ q @ rest
    phase = t * 2 * math.pi
    breath = math.sin(phase)
    lean, sway, neck = 0, 0, 0
    thighs, knees = [2, 2], [-4, -4]
    arms, elbows = [0, 0], [12, 12]
    if clip == 'IDLE':
        lean, neck = breath * .65, -breath * .45
        arms = [breath * .8, -breath * .8]
    elif clip == 'RUN':
        lean, sway = -7, math.sin(phase) * 2.2
        for i, sign in enumerate((1, -1)):
            swing = math.sin(phase) * sign
            thighs[i] = 30 * swing
            knees[i] = -8 - max(0, -swing) * 63
            arms[i] = -swing * 25
            elbows[i] = 32 + max(0, swing) * 12
    elif clip == 'JUMP_START':
        crouch = math.sin(math.pi * t)
        thighs, knees = [crouch * 24] * 2, [-crouch * 47] * 2
        lean, arms, elbows = -crouch * 9, [-15 + t * 28] * 2, [25] * 2
    elif clip == 'JUMP_LOOP':
        thighs, knees = [24 + breath * 3, 38 - breath * 3], [-48, -65]
        arms, elbows, lean = [18, 12], [42, 36], -4
    elif clip == 'JUMP_LAND':
        crouch = math.sin(math.pi * t) ** .7
        thighs, knees = [crouch * 32] * 2, [-crouch * 64] * 2
        lean, arms, elbows = -crouch * 12, [crouch * 20] * 2, [15 + crouch * 20] * 2
    elif clip == 'SLIDE':
        # A low seated slide: one leg extended, the other folded; hips stay over feet.
        thighs, knees = [94, 94], [-20, -145]
        lean, neck = 17 + math.sin(math.pi * t) * 2, -8
        arms, elbows = [28, 16], [55, 65]
    rotate('spine', x=lean * .45, z=sway * .4)
    rotate('chest', x=lean * .55, z=sway * .6)
    rotate('head', x=neck, z=-sway * .4)
    for i, (side, suffix) in enumerate(((-1, 'l'), (1, 'r'))):
        rotate('upper_arm_' + suffix, x=arms[i], y=side * 35)
        rotate('forearm_' + suffix, x=elbows[i])
        rotate('thigh_' + suffix, x=thighs[i])
        rotate('shin_' + suffix, x=knees[i])
        rotate('foot_' + suffix, x=-thighs[i] - knees[i] + (-12 if clip == 'SLIDE' and i == 0 else 0))
    if clip == 'JUMP_LOOP':
        # Airborne foot tuck is intentional; the authoritative root supplies jump height.
        rig.pose.bones['pelvis'].location = rig.data.bones['pelvis'].matrix_local.to_3x3().inverted() @ Vector((0, 0, -.07))


def animate(obj, rig, data):
    scene = bpy.context.scene
    scene.render.fps = FPS
    rig.animation_data_create()
    sole_ids = [i for p in data.parts if p['name'].startswith('sole_') for i in range(p['v0'], p['v1'])]
    extents = {}
    all_min, all_max = [float('inf')] * 3, [-float('inf')] * 3
    for clip, seconds in CLIPS.items():
        action = bpy.data.actions.new(clip)
        action.use_fake_user = True
        rig.animation_data.action = action
        end = round(seconds * FPS)
        clip_bounds = [float('inf'), -float('inf')]
        for frame in range(end + 1):
            scene.frame_set(frame)
            set_pose(rig, clip, frame / end)
            bpy.context.view_layer.update()
            if clip != 'JUMP_LOOP':
                evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                bottom = min(evaluated.data.vertices[i].co.z for i in sole_ids)
                rig.pose.bones['pelvis'].location = rig.data.bones['pelvis'].matrix_local.to_3x3().inverted() @ Vector((0, 0, -bottom))
                bpy.context.view_layer.update()
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            low = min(v.co.z for v in evaluated.data.vertices)
            high = max(v.co.z for v in evaluated.data.vertices)
            clip_bounds[0] = min(clip_bounds[0], low); clip_bounds[1] = max(clip_bounds[1], high)
            assert all(math.isfinite(v.co.length) for v in evaluated.data.vertices)
            for axis in range(3):
                all_min[axis] = min(all_min[axis], min(v.co[axis] for v in evaluated.data.vertices))
                all_max[axis] = max(all_max[axis], max(v.co[axis] for v in evaluated.data.vertices))
            for bone in rig.pose.bones:
                bone.keyframe_insert(data_path='location', frame=frame, group=bone.name)
                bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
        # Register each actual action on a muted NLA track, so ACTIONS exports all six.
        track = rig.animation_data.nla_tracks.new(); track.name = clip; track.mute = True
        track.strips.new(clip, 0, action)
        extents[clip] = [round(v, 4) for v in clip_bounds]
    rig.animation_data.action = None
    for bone in rig.pose.bones: bone.matrix_basis.identity()
    scene.frame_start, scene.frame_end = 0, round(max(CLIPS.values()) * FPS)
    scene.frame_set(0)
    bpy.context.view_layer.update()
    # glTF's actual Y-up conversion; include small padding for interpolation/outline extrusion.
    bounds = {"min": [all_min[0] - .06, all_min[2] - .06, -all_max[1] - .06],
              "max": [all_max[0] + .06, all_max[2] + .06, -all_min[1] + .06]}
    return extents, bounds


def inspect_glb(file, data, extents, bounds):
    raw = file.read_bytes()
    assert raw[:4] == b'glTF'
    document = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
    animations = {a['name']: a for a in document['animations']}
    assert set(animations) == set(CLIPS), list(animations)
    assert len(document['skins']) == 1 and len(document['skins'][0]['joints']) == len(geo.bones())
    primitives = [p for m in document['meshes'] for p in m['primitives']]
    assert len(primitives) == 3
    assert all('JOINTS_0' in p['attributes'] and 'WEIGHTS_0' in p['attributes'] for p in primitives)
    assert all('bufferView' in image and 'uri' not in image for image in document['images'])
    for name, animation in animations.items():
        assert len(animation['channels']) > 10, name
    meta = {"file": "assets/characters/player.glb", "height": geo.summary(data)['bounds_max'][2],
            "groundY": geo.summary(data)['bounds_min'][2], "yawCorrection": 0,
            "clips": {name: name for name in CLIPS}, "durations": CLIPS,
            "bones": [name for name, *_ in geo.bones()], "triangles": geo.summary(data)['triangles'],
            "materials": [m['name'] for m in document['materials']], "poseBoundsY": extents, "bounds": bounds,
            "forward": [0, 0, -1], "sourceReference": "references_images/Player.png"}
    (OUT / 'player.json').write_text(json.dumps(meta, indent=2) + '\n', encoding='utf8')
    print('CHARACTER_EXPORT', json.dumps({**geo.summary(data), 'bytes': len(raw), 'clips': list(animations), 'poseBoundsY': extents}))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if hasattr(bpy.context.preferences.filepaths, 'file_preview_type'):
        bpy.context.preferences.filepaths.file_preview_type = 'NONE'
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    obj, rig, data = make_character()
    extents, bounds = animate(obj, rig, data)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'player.blend'))
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'player.glb'), export_format='GLB', use_selection=True,
        export_yup=True, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_range=False, export_skins=True, export_def_bones=False, export_morph=False,
        export_materials='EXPORT', export_extras=True)
    inspect_glb(OUT / 'player.glb', data, extents, bounds)
    register_assets(data)


def register_assets(data):
    manifest_file = ROOT / 'public/assets/asset-manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf8'))
    descriptions = {
        'blender/characters/player.blend': ('character-source', 'Editable humanoid mesh, 18-joint rig and six in-place actions'),
        'assets/characters/player.glb': ('player-character', 'Skinned multiplayer humanoid; six clips, embedded shared PBR atlas pair'),
        'assets/characters/player.json': ('character-metadata', 'Measured export scale, pose bounds, clip names/durations and rig'),
        'assets/characters/player-albedo.png': ('character-texture', 'Original 256px skin/fabric/gear atlas, embedded in player.glb'),
        'assets/characters/player-orm.png': ('character-texture', 'Shared 256px roughness/metallic atlas, embedded in player.glb'),
    }
    entries = []
    for name, (kind, description) in descriptions.items():
        file = (ROOT if name.startswith('blender/') else ROOT / 'public') / name
        entry = dict(path=name, kind=kind, bytes=file.stat().st_size, description=description,
                     script='blender/characters/generate_player.py')
        if name.endswith('.glb'): entry.update(triangles=data.triangles(), embeddedMaterials=True)
        entries.append(entry)
    manifest['assets'] = sorted([a for a in manifest['assets'] if a['path'] not in descriptions] + entries, key=lambda a: a['path'])
    manifest_file.write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf8')
    lines = ['# Asset manifest', '',
             f"Map/weapon assets generated by `{manifest['generator']}` with Blender {manifest['blender']} on {manifest['generated']}.",
             'Regenerate maps/props with `npm run assets`; regenerate the independent character with `npm run assets:player`.', '',
             '| File | Kind | Size | Triangles | Description |', '|---|---|---:|---:|---|']
    for a in manifest['assets']:
        lines.append(f"| `{a['path']}` | {a['kind']} | {a['bytes'] / 1024:.0f} KB | {a.get('triangles', '')} | {a['description']} |")
    (ROOT / 'docs/ASSET_MANIFEST.md').write_text('\n'.join(lines) + '\n', encoding='utf8')


if __name__ == '__main__': main()
