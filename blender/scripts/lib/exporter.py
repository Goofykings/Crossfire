"""Scene assembly + GLB export helpers (bpy)."""
from __future__ import annotations

import math
from pathlib import Path

import bpy

from meshkit import MeshData

_kit_mesh_cache: dict[str, bpy.types.Mesh] = {}


def reset_scene() -> None:
    """Empty the current file (factory startup contains a cube, camera and light)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _kit_mesh_cache.clear()
    import bmat

    bmat.reset_cache()


def collection(name: str, parent=None) -> bpy.types.Collection:
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def empty(name: str, col, location=(0.0, 0.0, 0.0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.5
    obj.location = (location[0], -location[2], location[1])
    col.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def kit_meshes(name: str, factory) -> list[tuple[str, bpy.types.Mesh]]:
    """Single-material Blender meshes for a kit piece, created once and shared by every placement."""
    key = f"KIT_{name}"
    found = [(m.name, m) for m in bpy.data.meshes if m.name.startswith(key + "__")]
    if found:
        return found
    md: MeshData = factory()
    out = []
    for mat, part in md.split_by_material().items():
        part_name = f"{key}__{mat}"
        tmp = part.to_object(part_name, None)
        mesh = tmp.data
        mesh.name = part_name
        bpy.data.objects.remove(tmp)
        out.append((part_name, mesh))
    return out


def place_kit(name: str, factory, xf, col, parent=None, counter=[0]):
    objs = []
    for part_name, mesh in kit_meshes(name, factory):
        counter[0] += 1
        obj = bpy.data.objects.new(f"{part_name}#{counter[0]}", mesh)
        tx, ty, tz = xf.t
        obj.location = (tx, -tz, ty)
        obj.rotation_euler = (0.0, 0.0, math.atan2(xf.s, xf.c))
        col.objects.link(obj)
        if parent is not None:
            obj.parent = parent
            obj.matrix_parent_inverse = parent.matrix_world.inverted()
        objs.append(obj)
    return objs


def box_object(name: str, center, half, yaw: float, col, display="WIRE"):
    """Collision box object (game-space centre/half extents)."""
    import bmesh

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    for v in bm.verts:
        v.co.x *= half[0]
        v.co.y *= half[2]
        v.co.z *= half[1]
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (center[0], -center[2], center[1])
    obj.rotation_euler = (0.0, 0.0, yaw)
    obj.display_type = display
    col.objects.link(obj)
    return obj


def all_objects(col) -> list:
    out = list(col.objects)
    for c in col.children:
        out.extend(all_objects(c))
    return out


def export_glb(objects, path: Path, extras: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    view = bpy.context.view_layer
    for o in objects:
        if o.name in view.objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="NONE",
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=extras,
        export_animations=False,
    )
    bpy.ops.object.select_all(action="DESELECT")
    return path


def triangle_count(objects) -> int:
    tris = 0
    for o in objects:
        if o.type == "MESH":
            for p in o.data.polygons:
                tris += len(p.vertices) - 2
    return tris


def save_blend(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.file.make_paths_relative()
    except RuntimeError:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True, relative_remap=True)
