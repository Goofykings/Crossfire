"""Crossfire asset pipeline: regenerate every Blender-made asset.

Run headless (from the repository root):
    blender -b --factory-startup -P blender/scripts/generate_all.py -- [--only stage,stage] [--previews]

Stages (default: all except previews)
    materials  public/assets/materials.json
    town       European Town buildings (per-block GLBs), terrain.glb, collision.json, collision_debug.glb,
               blender/source/european-town.blend
    industrial the same outputs for the Industrial Complex (models/industrial-complex/, industrial-complex.blend)
    city       the same outputs for the Modern City (models/modern-city/, modern-city.blend)
    props      models/shared/props/*.glb, blender/source/props.blend
    weapon     models/shared/weapons/{rifle,shotgun,sniper,hands,casings}.glb, blender/source/weapon.blend
    library    models/shared/buildings/*.glb (8 building types x 2 variants), building_library.blend
    kit        models/shared/kit/*.glb, blender/source/modular_kit.blend
    previews   docs/previews/*.png (EEVEE renders; with a map stage, that map's views)

Writes public/assets/asset-manifest.json and docs/ASSET_MANIFEST.md describing every output.
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "lib"))

import bpy  # noqa: E402

import bmat  # noqa: E402
import collision_gen  # noqa: E402
import exporter  # noqa: E402
import materials  # noqa: E402
import modular  # noqa: E402
import props as prop_lib  # noqa: E402
import weapon as weapon_lib  # noqa: E402
import hands as hands_lib  # noqa: E402
from building import BuildingGenerator  # noqa: E402
from building_industrial import IndustrialBuildingGenerator  # noqa: E402
from building_modern import ModernBuildingGenerator  # noqa: E402
from catalog import BUILDING_TYPES, PROPS  # noqa: E402
from layout_util import LayoutIndex  # noqa: E402
from meshkit import Transform  # noqa: E402
from terrain import TerrainBuilder  # noqa: E402
from terrain_industrial import IndustrialTerrain  # noqa: E402
from terrain_modern import ModernTerrain  # noqa: E402

ROOT = HERE.parent.parent
PUBLIC = ROOT / "public"
MODELS = PUBLIC / "assets" / "models"
SHARED = MODELS / "shared"
SOURCE = ROOT / "blender" / "source"
MANIFEST: list[dict] = []

# One entry per map stage. `style` picks the generators (layout.json carries the same value in "style").
MAP_STAGES = {
    "town": {"id": "european-town", "title": "European Town", "style": "european", "sky": "sky_1k.hdr",
             "terrain_desc": "Streets, plaza, courts, terraces, stairs, garden walls, gates and flying arches",
             "sun": (200, 48), "views": {
                 "aerial": ((-48, 52, 46), (0, 0, 0), 28),
                 "plaza": ((-12.5, 1.7, -3.0), (2, 2.4, 2), 18),
                 "north_lane": ((-16.5, 2.4, -25), (6, 2.2, -25), 20),
                 "blue_spawn": ((-31.5, 1.7, 5.5), (-20, 2.5, -1), 18),
                 "court": ((22.8, 2.2, -27), (29, 2.0, -31), 16),
                 "alley": ((-27, 1.7, -14.5), (-27, 3.0, -30), 18)}},
    "industrial": {"id": "industrial-complex", "title": "Industrial Complex", "style": "industrial", "sky": "sky_industrial_1k.hdr",
                   "terrain_desc": "Asphalt and concrete yards, loading docks, stairs, railings, fences, canopies, pipe bridges, road paint",
                   "sun": (205, 59), "views": {
                       "aerial": ((-46, 50, 48), (0, 0, 0), 28),
                       "dock_lane": ((-27, 1.7, -28.5), (-6, 2.6, -27.5), 20),
                       "north_hall": ((-4.7, 1.7, -26.5), (3.5, 2.8, -23.5), 15),
                       "container_yard": ((5, 1.7, -30.3), (13.5, 1.6, -20.5), 17),
                       "loading_square": ((-5.5, 1.7, 5.5), (5, 2.2, -3), 18),
                       "blue_gate": ((-30.5, 1.7, -1.5), (-17, 2.4, -1.5), 18)}},
    "city": {"id": "modern-city", "title": "Modern City", "style": "modern", "sky": "sky_city_1k.hdr",
             "terrain_desc": "Roads, sidewalks and curbs, crossings, alleys, plazas, garden walls, railings, overhead wires",
             "sun": (195, 50), "views": {
                 "aerial": ((-46, 52, 48), (0, 0, 0), 28),
                 "north_street": ((-25, 1.85, -24), (-6, 3.2, -24.5), 20),
                 "plaza": ((-6.3, 1.7, -6.3), (5, 2.6, 5), 18),
                 "back_alley": ((-32, 1.7, -14), (-16, 3.2, -14), 18),
                 "ne_road": ((1.5, 1.85, -16), (17, 3.0, -16.5), 18),
                 "courtyard": ((-20.5, 1.7, -5.5), (-14.5, 2.6, 3.5), 16)}},
}


def make_generators(style: str, index):
    if style == "industrial":
        return IndustrialBuildingGenerator(index), IndustrialTerrain
    if style == "modern":
        return ModernBuildingGenerator(index), ModernTerrain
    return BuildingGenerator(index), TerrainBuilder


def log(*a):
    print("[crossfire]", *a, flush=True)


def record(path: Path, kind: str, desc: str, objects=None, script: str = "generate_all.py"):
    entry = {
        "path": path.relative_to(PUBLIC).as_posix() if PUBLIC in path.parents else path.relative_to(ROOT).as_posix(),
        "kind": kind,
        "bytes": path.stat().st_size,
        "description": desc,
        "script": f"blender/scripts/{script}",
    }
    if objects is not None:
        entry["triangles"] = exporter.triangle_count(objects)
    MANIFEST.append(entry)


def realize(md, placements, name: str, col, origin):
    """Shell + kit placements under a root empty located at `origin` (game coords)."""
    root = exporter.empty(name, col, origin)
    shell = md.to_object(f"{name}_shell", col, location=origin)
    shell.parent = root
    shell.location = (0.0, 0.0, 0.0)
    objs = [root, shell]
    for pl in placements:
        local = Transform(pl.xf.t[0] - origin[0], pl.xf.t[1] - origin[1], pl.xf.t[2] - origin[2])
        local.c, local.s = pl.xf.c, pl.xf.s
        for o in exporter.place_kit(pl.name, pl.factory, local, col):
            o.parent = root
            objs.append(o)
    return objs


# --- grouping ----------------------------------------------------------------------------------
def building_groups(layout):
    """Group touching buildings into blocks of at most 8 so each GLB is a logical street block."""
    blds = layout["buildings"]
    n = len(blds)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def touch(a, b):
        ax0, az0, ax1, az1 = a["rect"]
        bx0, bz0, bx1, bz1 = b["rect"]
        share_x = min(ax1, bx1) - max(ax0, bx0)
        share_z = min(az1, bz1) - max(az0, bz0)
        return (share_x > 0.5 and (abs(az1 - bz0) < 1e-6 or abs(bz1 - az0) < 1e-6)) or \
               (share_z > 0.5 and (abs(ax1 - bx0) < 1e-6 or abs(bx1 - ax0) < 1e-6))

    for i in range(n):
        for j in range(i + 1, n):
            if touch(blds[i], blds[j]):
                parent[find(i)] = find(j)
    comps: dict[int, list] = {}
    for i in range(n):
        comps.setdefault(find(i), []).append(blds[i])
    groups = []
    for comp in comps.values():
        if len(comp) <= 8:
            groups.append(comp)
            continue
        # split big rings by angle around the map centre
        comp.sort(key=lambda b: math.atan2((b["rect"][1] + b["rect"][3]) / 2, (b["rect"][0] + b["rect"][2]) / 2))
        k = math.ceil(len(comp) / 8)
        size = math.ceil(len(comp) / k)
        for i in range(0, len(comp), size):
            groups.append(comp[i:i + size])
    groups.sort(key=lambda g: (round(sum((b["rect"][1] + b["rect"][3]) / 2 for b in g) / len(g) / 12),
                               sum((b["rect"][0] + b["rect"][2]) / 2 for b in g) / len(g)))
    return groups


# --- stages ------------------------------------------------------------------------------------
def stage_materials():
    path = materials.write_manifest(PUBLIC)
    record(path, "materials", "Material table (names, texture sets, tiling, tint, PBR factors)", script="lib/materials.py")
    log("materials ->", path)


def stage_map(key: str, previews: bool):
    cfg = MAP_STAGES[key]
    out_dir = MODELS / cfg["id"]
    layout_path = ROOT / "src" / "maps" / cfg["id"] / "layout.json"
    if not layout_path.exists():
        log(f"skip {key}: {layout_path} does not exist yet")
        return []
    exporter.reset_scene()
    layout = json.loads(layout_path.read_text(encoding="utf-8"))
    index = LayoutIndex(layout)
    gen, terrain_cls = make_generators(layout.get("style", cfg["style"]), index)
    groups = building_groups(layout)
    town_col = exporter.collection(cfg["title"])
    bcol = exporter.collection("Buildings", town_col)
    block_files = []
    for gi, group in enumerate(groups, 1):
        name = f"block_{gi:02d}"
        col = exporter.collection(name, bcol)
        objs = []
        for b in group:
            md, placements = gen.generate(b)
            x0, z0, x1, z1 = b["rect"]
            objs += realize(md, placements, b["id"], col, ((x0 + x1) / 2, 0.0, (z0 + z1) / 2))
        path = out_dir / "buildings" / f"{name}.glb"
        exporter.export_glb(objs, path)
        record(path, "map-buildings", f"{len(group)} buildings: " + ", ".join(f"{b['id']} ({b['type']})" for b in group),
               [o for o in objs if o.type == "MESH"])
        block_files.append(f"buildings/{name}.glb")
        log(f"{name}: {len(group)} buildings, {path.stat().st_size // 1024} KB")

    tcol = exporter.collection("Terrain", town_col)
    terrain = terrain_cls(layout).build()
    tobj = terrain.to_object("terrain", tcol)
    path = out_dir / "terrain.glb"
    exporter.export_glb([tobj], path)
    record(path, "map-terrain", cfg["terrain_desc"], [tobj])
    log("terrain", path.stat().st_size // 1024, "KB")

    coll = collision_gen.map_collision(layout)
    cpath = out_dir / "collision.json"
    cpath.write_text(json.dumps(coll, separators=(",", ":")), encoding="utf-8")
    record(cpath, "collision", f"{len(coll['boxes'])} oriented collision boxes (runtime physics)", script="lib/collision_gen.py")
    ccol = exporter.collection("Collision", town_col)
    cobjs = [exporter.box_object(f"COL_{i:04d}_{b['tag'].replace(':', '_')}", b["c"], b["h"], b["yaw"], ccol)
             for i, b in enumerate(coll["boxes"])]
    path = out_dir / "collision_debug.glb"
    exporter.export_glb(cobjs, path)
    record(path, "collision-debug", "Collision boxes as meshes for in-game debug view (F2)", cobjs)
    ccol.hide_render = True
    for o in cobjs:
        o.hide_set(True)

    # gameplay markers for designers (not exported)
    gcol = exporter.collection("Gameplay (markers)", town_col)
    for s in layout["spawns"]:
        e = exporter.empty(f"spawn_{s['id']}", gcol, tuple(s["pos"]))
        e.empty_display_type = "SINGLE_ARROW"
        e.rotation_euler = (math.radians(90), 0, -math.radians(s["heading"]) + math.pi)
    for t in layout["targets"]:
        e = exporter.empty(f"target_{t['id']}", gcol, tuple(t["pos"]))
        e.empty_display_type = "CIRCLE"
    gcol.hide_render = True

    # props preview (linked duplicates of the prop meshes at their layout placements)
    pcol = exporter.collection("Props (preview, instanced at runtime)", town_col)
    prop_meshes = {}
    for p in layout["props"] + layout["obstacles"]:
        t = p["type"]
        if t not in prop_lib.PROP_BUILDERS:
            continue
        if t not in prop_meshes:
            tmp = prop_lib.PROP_BUILDERS[t]().to_object(f"prop_{t}", None)
            prop_meshes[t] = tmp.data
            bpy.data.objects.remove(tmp)
        o = bpy.data.objects.new(f"prop_{t}", prop_meshes[t])
        o.location = (p["pos"][0], -p["pos"][2], p["pos"][1])
        o.rotation_euler = (0, 0, -math.radians(p["heading"]))
        pcol.objects.link(o)
    tparts = prop_lib.target_parts()
    tmeshes = {k: v.to_object(f"target_{k}", None) for k, v in tparts.items()}
    for t in layout["targets"]:
        for k, src in tmeshes.items():
            o = bpy.data.objects.new(f"target_{k}", src.data)
            o.location = (t["pos"][0], -t["pos"][2], t["pos"][1] + (0.92 if k == "plate" else 0))
            o.rotation_euler = (0, 0, -math.radians(t["heading"]))
            pcol.objects.link(o)
    for src in tmeshes.values():
        bpy.data.objects.remove(src)

    index_path = out_dir / "map-assets.json"
    index_path.write_text(json.dumps({
        "map": layout["id"],
        "models": block_files + ["terrain.glb"],
        "collision": "collision.json",
        "collisionDebug": "collision_debug.glb",
    }, indent=1), encoding="utf-8")
    record(index_path, "map-index", "List of model files the runtime loads for this map")

    setup_world(cfg["sky"])
    blend = SOURCE / f"{cfg['id']}.blend"
    exporter.save_blend(blend)
    record(blend, "blend", "Editable source: buildings, terrain, collision, markers, prop preview")
    if previews:
        render_previews(layout, cfg)
    return block_files


def stage_town(previews: bool):
    return stage_map("town", previews)


def stage_props():
    exporter.reset_scene()
    col = exporter.collection("Props")
    out = []
    names = list(prop_lib.PROP_BUILDERS) + ["target"]
    for i, name in enumerate(names):
        if name == "target":
            parts = prop_lib.target_parts()
            base = parts["base"].to_object("target_base", col)
            plate = parts["plate"].to_object("plate", col)
            plate.parent = base
            plate.location = (0.0, 0.0, 0.92)
            objs = [base, plate]
        else:
            objs = [prop_lib.PROP_BUILDERS[name]().to_object(name, col)]
        path = SHARED / "props" / f"{name}.glb"
        exporter.export_glb(objs, path)
        size = PROPS[name]["size"] if name in PROPS else None
        record(path, "prop", f"{name} ({' x '.join(f'{v:g}' for v in size)} m)" if size else name, objs)
        out.append(name)
        # lay out in a grid for the .blend
        objs[0].location = ((i % 6) * 3.5, -(i // 6) * 3.5, 0.0)
    catalog_path = SHARED / "props" / "props.json"
    catalog_path.write_text(json.dumps({"version": 1, "props": {
        n: {"file": f"{n}.glb", "size": PROPS[n]["size"], "collider": PROPS[n]["collider"]} for n in out if n in PROPS
    }}, indent=1), encoding="utf-8")
    record(catalog_path, "prop-catalog", "Prop sizes and collision boxes used by the runtime", script="lib/catalog.py")
    setup_world()
    exporter.save_blend(SOURCE / "props.blend")
    record(SOURCE / "props.blend", "blend", "Editable source: all street props")
    log("props:", len(out))


def stage_weapon():
    """First-person weapons (rifle, shotgun, sniper), hands and ejected cases."""
    exporter.reset_scene()
    col = exporter.collection("Weapons")
    for wid, build in weapon_lib.WEAPONS.items():
        wcol = exporter.collection(wid.capitalize(), col)
        parts, anchors = build()
        body = parts["body"].to_object(wid, wcol, smooth_angle=32)
        objs = [body]
        for name, md in parts.items():
            if name == "body":
                continue
            o = md.to_object(name, wcol, smooth_angle=32)
            o.parent = body
            objs.append(o)
        for name, pos in anchors.items():
            objs.append(exporter.empty(name, wcol, pos, parent=body))
        path = SHARED / "weapons" / f"{wid}.glb"
        exporter.export_glb(objs, path)
        moving = ", ".join(k for k in parts if k != "body")
        record(path, "weapon", f"{wid} first-person model: moving parts ({moving}) and anchors ({', '.join(anchors)})",
               [o for o in objs if o.type == "MESH"])
        # free the part and anchor names for the next weapon (Blender would export them as 'muzzle.001')
        for o in objs[1:]:
            o.name = f"{wid}_{o.name}"
    # hands and forearm sleeve
    hcol = exporter.collection("Hands", col)
    objs = []
    for name, md, wrist in (("hand_r", hands_lib.hand_right(), hands_lib.WRIST),
                            ("hand_l", hands_lib.hand_left(), (-hands_lib.WRIST[0], hands_lib.WRIST[1], hands_lib.WRIST[2]))):
        h = md.to_object(name, hcol, smooth_angle=60)
        objs += [h, exporter.empty(f"{name}_wrist", hcol, wrist, parent=h)]
    objs.append(hands_lib.forearm().to_object("forearm", hcol, smooth_angle=60))
    path = SHARED / "weapons" / "hands.glb"
    exporter.export_glb(objs, path)
    record(path, "weapon", "First-person gloved hands (hand_r, hand_l with wrist points) and a unit-length forearm sleeve",
           [o for o in objs if o.type == "MESH"])
    ccol = exporter.collection("Casings", col)
    objs = [md.to_object(name, ccol, smooth_angle=40) for name, md in weapon_lib.casings().items()]
    path = SHARED / "weapons" / "casings.glb"
    exporter.export_glb(objs, path)
    record(path, "weapon", "Ejected cases: casing_rifle, casing_sniper, casing_shell", objs)
    setup_world()
    exporter.save_blend(SOURCE / "weapon.blend")
    record(SOURCE / "weapon.blend", "blend", "Editable source: rifle, shotgun, sniper, hands, casings")
    log("weapons ok")


class _OpenIndex:
    """Fake layout index for catalogue buildings: every side faces an open street at ground level."""

    def classify(self, x, z):
        return "open", {"kind": "street", "height": 0.0}

    def ground_at(self, x, z):
        return 0.0

    def neighbour_height(self, x, z):
        return 0.0


LIBRARY_SPECS = [
    ("stone2", {"rect": [0, 0, 8, 7], "floors": 2, "palette": "stone_warm"}, {"rect": [0, 0, 7, 9], "floors": 2, "palette": "stone_grey"}),
    ("plaster3", {"rect": [0, 0, 8, 8], "floors": 3, "palette": "plaster_ochre"}, {"rect": [0, 0, 6, 9], "floors": 3, "palette": "plaster_rose"}),
    ("shop", {"rect": [0, 0, 7, 7], "floors": 2, "palette": "plaster_beige", "shopfront": {"side": "s"}},
     {"rect": [0, 0, 8, 6], "floors": 3, "palette": "plaster_white", "shopfront": {"side": "s"}}),
    ("corner", {"rect": [0, 0, 8, 8], "floors": 3, "palette": "plaster_worn", "chamfer": {"corner": "se", "size": 2.0}},
     {"rect": [0, 0, 9, 7], "floors": 3, "palette": "plaster_red", "chamfer": {"corner": "sw", "size": 2.0}}),
    ("narrow_passage", {"rect": [0, 0, 4, 10], "floors": 4, "palette": "stone_warm",
                        "passages": [{"rect": [0, 3.5, 4, 6.5], "style": "lintel", "clear": 3.2}]},
     {"rect": [0, 0, 4, 9], "floors": 4, "palette": "plaster_worn", "passages": [{"rect": [0, 3, 4, 6], "style": "lintel", "clear": 3.2}]}),
    ("archway", {"rect": [0, 0, 8, 7], "floors": 3, "palette": "stone_grey",
                 "passages": [{"rect": [2.5, 0, 5.5, 7], "style": "arch", "clear": 3.3}]},
     {"rect": [0, 0, 7, 8], "floors": 3, "palette": "plaster_beige", "passages": [{"rect": [2, 0, 5, 8], "style": "arch", "clear": 3.3}]}),
    ("balcony", {"rect": [0, 0, 8, 7], "floors": 3, "palette": "plaster_rose", "balcony": {"side": "s", "floor": 1}},
     {"rect": [0, 0, 7, 8], "floors": 4, "palette": "plaster_white", "balcony": {"side": "s", "floor": 1}}),
    ("room", {"rect": [0, 0, 10, 8], "floors": 2, "palette": "brick_old", "rooms": [{"rect": [0, 2.5, 10, 5.5], "clear": 3.0}]},
     {"rect": [0, 0, 9, 7], "floors": 2, "palette": "stone_blocks", "rooms": [{"rect": [0, 2, 9, 5], "clear": 3.0}]}),
]


def stage_library():
    exporter.reset_scene()
    gen = BuildingGenerator(_OpenIndex())
    col = exporter.collection("Building Library")
    count = 0
    for ti, (btype, *variants) in enumerate(LIBRARY_SPECS):
        for vi, spec in enumerate(variants, 1):
            b = {"id": f"{btype}_v{vi}", "type": btype, "seed": 101 * (ti + 1) + vi, "front": "s",
                 "roof": {"type": "hip" if btype == "corner" else "gable",
                          "ridge": "x" if spec["rect"][2] >= spec["rect"][3] else "z"},
                 "doors": [] if btype in ("archway",) else [{"side": "s", "at": spec["rect"][2] / 2 + (1.8 if btype == "shop" else 0),
                                                              "width": 1.1}], **spec}
            if btype == "room" or btype == "narrow_passage":
                b["doors"] = []
            md, placements = gen.generate(b)
            x0, z0, x1, z1 = b["rect"]
            objs = realize(md, placements, b["id"], col, ((x0 + x1) / 2, 0.0, (z0 + z1) / 2))
            path = SHARED / "buildings" / f"{b['id']}.glb"
            exporter.export_glb(objs, path)
            record(path, "building-library", f"{BUILDING_TYPES[btype]} - variant {vi} ({x1 - x0:g} x {z1 - z0:g} m, {b['floors']} floors)",
                   [o for o in objs if o.type == "MESH"])
            # spread out in the .blend
            objs[0].location = (ti * 14.0, -vi * 14.0, 0.0)
            count += 1
    setup_world()
    exporter.save_blend(SOURCE / "building_library.blend")
    record(SOURCE / "building_library.blend", "blend", "Editable source: catalogue of the 8 building types x 2 variants")
    log("library:", count, "buildings")


def stage_kit():
    exporter.reset_scene()
    col = exporter.collection("Modular Kit")
    for i, (name, fn) in enumerate(modular.KIT_BUILDERS.items()):
        obj = fn().to_object(name, col)
        path = SHARED / "kit" / f"{name}.glb"
        exporter.export_glb([obj], path)
        record(path, "kit", f"Modular piece: {name}", [obj])
        obj.location = ((i % 6) * 5.0, -(i // 6) * 5.0, 0.0)
    setup_world()
    exporter.save_blend(SOURCE / "modular_kit.blend")
    record(SOURCE / "modular_kit.blend", "blend", "Editable source: modular kit pieces")
    log("kit ok")


def setup_world(sky: str = "sky_1k.hdr"):
    scene = bpy.context.scene
    world = bpy.data.worlds.get("CrossfireSky") or bpy.data.worlds.new("CrossfireSky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    hdr = PUBLIC / "assets" / "env" / sky
    if hdr.exists():
        env.image = bpy.data.images.load(str(hdr), check_existing=True)
        mapping = nt.nodes.new("ShaderNodeMapping")
        coord = nt.nodes.new("ShaderNodeTexCoord")
        # match the in-game sun direction (see Environment.ts / map definition)
        mapping.inputs["Rotation"].default_value = (0, 0, math.radians(SKY_ROTATION_DEG))
        nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    scene.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"


SKY_ROTATION_DEG = 0.0


def render_previews(layout, cfg=None):
    cfg = cfg or MAP_STAGES["town"]
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    sun = bpy.data.lights.new("preview_sun", "SUN")
    sun.energy = 3.5
    sun.angle = math.radians(1.5)
    so = bpy.data.objects.new("preview_sun", sun)
    # sunlight from the map's sun heading and elevation (European Town: heading 200, elevation 48 degrees)
    heading, elevation = cfg["sun"]
    so.rotation_euler = (math.radians(90 - elevation), 0, math.radians(180 - heading))
    scene.collection.objects.link(so)
    cam = bpy.data.cameras.new("preview_cam")
    co = bpy.data.objects.new("preview_cam", cam)
    scene.collection.objects.link(co)
    scene.camera = co
    from mathutils import Vector
    views = cfg["views"]
    outdir = ROOT / "docs" / "previews" if cfg["id"] == "european-town" else ROOT / "docs" / "previews" / cfg["id"]
    outdir.mkdir(parents=True, exist_ok=True)
    for name, (pos, tgt, lens) in views.items():
        cam.lens = lens
        co.location = (pos[0], -pos[2], pos[1])
        d = Vector((tgt[0] - pos[0], -(tgt[2] - pos[2]), tgt[1] - pos[1]))
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(outdir / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        log("preview", name)


def write_manifest():
    data = {"generator": "blender/scripts/generate_all.py", "blender": bpy.app.version_string,
            "generated": time.strftime("%Y-%m-%d %H:%M:%S"), "assets": MANIFEST}
    path = PUBLIC / "assets" / "asset-manifest.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"assets": []}
    fresh = {a["path"] for a in MANIFEST}
    # entries from stages that did not run this time are kept, unless their file is gone (a removed output)
    kept = [a for a in old.get("assets", []) if a["path"] not in fresh and ((PUBLIC / a["path"]).exists() or (ROOT / a["path"]).exists())]
    data["assets"] = kept + MANIFEST
    data["assets"].sort(key=lambda a: a["path"])
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")
    lines = ["# Asset manifest", "", f"Generated by `{data['generator']}` with Blender {data['blender']} on {data['generated']}.",
             "Regenerate with `npm run assets` (see docs/ASSET_PIPELINE.md).", "",
             "| File | Kind | Size | Triangles | Description |", "|---|---|---:|---:|---|"]
    for a in data["assets"]:
        lines.append(f"| `{a['path']}` | {a['kind']} | {a['bytes'] / 1024:.0f} KB | {a.get('triangles', '')} | {a['description']} |")
    (ROOT / "docs" / "ASSET_MANIFEST.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    log("manifest:", len(data["assets"]), "entries")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    previews = "--previews" in argv or (only is not None and "previews" in only)
    bmat.set_public_dir(PUBLIC)
    t0 = time.time()
    stages = [("materials", stage_materials), ("props", stage_props), ("weapon", stage_weapon),
              ("library", stage_library), ("kit", stage_kit)]
    for name, fn in stages:
        if only is None or name in only:
            log("== stage", name)
            fn()
    for key in MAP_STAGES:
        # "--only previews" alone keeps its old meaning: the European Town previews
        if only is None or key in only or (key == "town" and only == {"previews"}):
            log(f"== stage {key}")
            stage_map(key, previews)
    write_manifest()
    log(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
