"""Create Blender materials from the shared MATERIALS table (materials.py).

Materials use only glTF-compatible nodes (Principled BSDF, Image Texture, Normal Map, Separate
Color, Mapping, Color Attribute, Mix). The game does not read material data from the GLB files --
it binds the shared runtime textures by material *name* -- but the .blend files stay fully textured
for editing and preview.
"""
from __future__ import annotations

from pathlib import Path

import bpy

from materials import MATERIALS, texture_files

PUBLIC_DIR: Path | None = None
_cache: dict[str, bpy.types.Material] = {}


def set_public_dir(path: Path) -> None:
    global PUBLIC_DIR
    PUBLIC_DIR = path


def _image(rel: str, non_color: bool):
    assert PUBLIC_DIR is not None
    path = PUBLIC_DIR / rel
    img = bpy.data.images.get(path.name)
    if img is None:
        if not path.exists():
            return None
        img = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def get_material(name: str) -> bpy.types.Material:
    if name in _cache:
        return _cache[name]
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    _cache[name] = mat
    spec = MATERIALS.get(name)
    if spec is None:
        # unknown names still export (the runtime will warn); make them obvious magenta
        spec = {"tint": [1.0, 0.0, 1.0]}
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    tint = list(spec.get("tint", [1.0, 1.0, 1.0])) + [1.0]
    files = texture_files(name) if name in MATERIALS else {}

    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    vcol.location = (-600, 300)

    if files:
        uv = nt.nodes.new("ShaderNodeTexCoord")
        uv.location = (-1100, 0)
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.location = (-900, 0)
        s = 1.0 / spec.get("tile", 1.0)
        mapping.inputs["Scale"].default_value = (s, s, s)
        nt.links.new(uv.outputs["UV"], mapping.inputs["Vector"])

        def tex(rel, non_color, y):
            img = _image(rel, non_color)
            if img is None:
                return None
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = img
            node.location = (-650, y)
            nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
            return node

        alb = tex(files["albedo"], False, 0)
        if alb is not None:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.location = (-300, 150)
            nt.links.new(alb.outputs["Color"], mix.inputs["A"])
            mix.inputs["B"].default_value = tint
            mix2 = nt.nodes.new("ShaderNodeMix")
            mix2.data_type = "RGBA"
            mix2.blend_type = "MULTIPLY"
            mix2.inputs["Factor"].default_value = 1.0
            mix2.location = (-100, 150)
            nt.links.new(mix.outputs["Result"], mix2.inputs["A"])
            nt.links.new(vcol.outputs["Color"], mix2.inputs["B"])
            nt.links.new(mix2.outputs["Result"], bsdf.inputs["Base Color"])
            if spec.get("alpha_cutoff"):
                nt.links.new(alb.outputs["Alpha"], bsdf.inputs["Alpha"])
        if "normal" in files:
            nrm = tex(files["normal"], True, -300)
            if nrm is not None:
                nm = nt.nodes.new("ShaderNodeNormalMap")
                nm.location = (-300, -300)
                nm.inputs["Strength"].default_value = spec.get("normal", 1.0)
                nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
                nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        if "orm" in files:
            orm = tex(files["orm"], True, -600)
            if orm is not None:
                sep = nt.nodes.new("ShaderNodeSeparateColor")
                sep.location = (-300, -600)
                nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
                rough = nt.nodes.new("ShaderNodeMath")
                rough.operation = "MULTIPLY"
                rough.inputs[1].default_value = spec.get("roughness", 1.0)
                rough.location = (-100, -550)
                nt.links.new(sep.outputs["Green"], rough.inputs[0])
                nt.links.new(rough.outputs["Value"], bsdf.inputs["Roughness"])
                metal = nt.nodes.new("ShaderNodeMath")
                metal.operation = "MULTIPLY"
                metal.inputs[1].default_value = spec.get("metallic", 1.0)
                metal.location = (-100, -700)
                nt.links.new(sep.outputs["Blue"], metal.inputs[0])
                nt.links.new(metal.outputs["Value"], bsdf.inputs["Metallic"])
    else:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["A"].default_value = tint
        nt.links.new(vcol.outputs["Color"], mix.inputs["B"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.8)
        bsdf.inputs["Metallic"].default_value = spec.get("metallic", 0.0)

    if "emissive" in spec:
        e = spec["emissive"]
        strength = max(e)
        bsdf.inputs["Emission Color"].default_value = (e[0] / strength, e[1] / strength, e[2] / strength, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if spec.get("double_sided"):
        mat.use_backface_culling = False
    else:
        mat.use_backface_culling = True
    mat.diffuse_color = tint
    return mat


def reset_cache() -> None:
    _cache.clear()
