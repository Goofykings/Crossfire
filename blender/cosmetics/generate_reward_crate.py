"""Crossfire reward crate: an original, rounded hero prop for the Shop and crate reveal.

blender -b --factory-startup --python-expr "import sys; sys.dont_write_bytecode=True" --python-exit-code 1 -P blender/cosmetics/generate_reward_crate.py [-- --samples 48 --no-renders]

Game axes (metres, +Y up, front faces -Z). Animated parts keep their own pivots:
  crate_body   origin at the floor centre (squash/stretch about the base)
  lid_nw/ne/sw/se  four white lid quarters, origin at each quarter's centre (burst/spin)
  seam_glow    emissive strips in the lid seams; runtime tints it to the item rarity
  core_glow    emissive disc on the body top, revealed once the lid bursts
"""
from __future__ import annotations
from pathlib import Path
import math
import sys
import bpy
import bmesh

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / 'blender/scripts/lib'))
import generate_collection as gc  # noqa: E402  (helpers only; its __main__ does not run)
import exporter  # noqa: E402

OUT = ROOT / 'public/assets/cosmetics/crate/reward-crate'
SOURCE = ROOT / 'blender/source/cosmetics/reward-crate.blend'
REVIEW = ROOT / 'test-results/reward-crate'
W, D = .96, .70          # footprint (x, z)
BODY, LID = .46, .30     # body and lid heights
GAP = .014               # seam between lid quarters


def material(name, rgb, metal=0.0, rough=.5, emit=None):
    m = gc.material(name, rgb, metal, rough)
    if emit:
        p = m.node_tree.nodes['Principled BSDF']
        p.inputs['Emission Color'].default_value = (*gc.linear(emit), 1)
        p.inputs['Emission Strength'].default_value = 1.0
    return m


def rbox(col, name, center, half, mat, bevel, segments=5):
    """Rounded box in game coordinates."""
    bpy.ops.mesh.primitive_cube_add(size=2, location=gc.game(center))
    o = bpy.context.object
    o.name = name
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)
    o.scale = (half[0], half[2], half[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    mod = o.modifiers.new('Rounded', 'BEVEL')
    mod.width = bevel
    mod.segments = segments
    mod.limit_method = 'NONE'
    mod.harden_normals = False
    bpy.ops.object.shade_smooth()
    w = o.modifiers.new('Normals', 'WEIGHTED_NORMAL')
    w.keep_sharp = True
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.data.name = name
    return o


def origin_to(o, game_point):
    """Move an object's origin (pivot) without moving its geometry."""
    bpy.context.scene.cursor.location = gc.game(game_point)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')


def build():
    exporter.reset_scene()
    col = exporter.collection('Reward Crate')
    dark = material('crate_dark', (34, 39, 50), .25, .42)
    trim = material('crate_trim', (56, 64, 80), .55, .34)
    blue = material('crate_blue', (36, 142, 240), .1, .3)
    orange = material('crate_orange', (255, 138, 28), .05, .38)
    white = material('crate_white', (236, 240, 246), 0, .32)
    ice = material('crate_ice', (152, 214, 255), .05, .25)
    # Idle seam glow (cool ice blue) matches the runtime closed state; the reveal tints it.
    glow = material('crate_glow', (120, 196, 255), 0, .5, emit=(120, 196, 255))
    objects = []

    # Body: chunky rounded block with a flared foot and a trim band under the lid.
    body = [
        rbox(col, 'b_core', (0, BODY / 2 + .04, 0), (W / 2, BODY / 2 - .04, D / 2), dark, .085),
        rbox(col, 'b_foot', (0, .045, 0), (W / 2 + .025, .045, D / 2 + .025), trim, .04),
        rbox(col, 'b_band', (0, BODY - .02, 0), (W / 2 + .012, .025, D / 2 + .012), trim, .022),
    ]
    # Blue accent panels: front/back big chevron-ish panels, side panels.
    for z in (-1, 1):
        body.append(rbox(col, f'b_panel_{z}', (0, BODY * .5 + .02, z * (D / 2 + .006)), (W * .3, BODY * .24, .018), blue, .03))
        body.append(rbox(col, f'b_stripe_{z}', (0, BODY * .5 + .02, z * (D / 2 + .016)), (W * .18, .018, .012), ice, .008))
    for x in (-1, 1):
        body.append(rbox(col, f'b_side_{x}', (x * (W / 2 + .006), BODY * .5 + .02, 0), (.018, BODY * .22, D * .26), blue, .03))
        # Side grips (orange) read as handles at thumbnail size.
        body.append(rbox(col, f'b_grip_{x}', (x * (W / 2 + .03), BODY * .5 + .02, 0), (.022, .03, D * .16), orange, .018))
    # Orange latches on the front band and small corner caps on the foot.
    for x in (-1, 1):
        body.append(rbox(col, f'b_latch_{x}', (x * W * .26, BODY - .04, -(D / 2 + .03)), (.05, .055, .022), orange, .02))
        for z in (-1, 1):
            body.append(rbox(col, f'b_cap_{x}{z}', (x * (W / 2 - .02), .06, z * (D / 2 - .02)), (.06, .06, .06), orange, .035))
    body_obj = join(body, 'crate_body')
    origin_to(body_obj, (0, 0, 0))
    objects.append(body_obj)

    # Lid: ONE domed white block cut into quarters, so the closed lid reads as a single
    # hero shape with thin glowing seams; each quarter then flies off on its own pivot.
    full = rbox(col, 'lid_full', (0, BODY + LID / 2, 0), (W / 2 + .012, LID / 2, D / 2 + .012), white, .11, 6)
    bpy.ops.object.select_all(action='DESELECT')
    full.select_set(True)
    bpy.context.view_layer.objects.active = full
    bpy.ops.object.convert(target='MESH')
    names = {(-1, -1): 'lid_nw', (1, -1): 'lid_ne', (-1, 1): 'lid_sw', (1, 1): 'lid_se'}
    for (sx, sz), name in names.items():
        shell = full.copy()
        shell.data = full.data.copy()
        col.objects.link(shell)
        bm = bmesh.new()
        bm.from_mesh(shell.data)
        # Blender y = -game z. Keep the quarter on the (sx, sz) side of both seams.
        for co, no in (((sx * GAP / 2, 0, 0), (-sx, 0, 0)), ((0, -sz * GAP / 2, 0), (0, sz, 0))):
            cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, clear_inner=False, clear_outer=True)
            edges = [e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
            # Split the cut so the flat cap does not share smooth normals with the dome;
            # shared normals rounded every cut edge and the closed lid read as four cushions.
            bmesh.ops.split_edges(bm, edges=[e for e in edges if e.is_valid])
        bm.normal_update()
        bm.to_mesh(shell.data)
        bm.free()
        shell.name = name + '_shell'
        hx, hz = W / 4, D / 4
        cx, cz = sx * (W / 4 + GAP / 4), sz * (D / 4 + GAP / 4)
        cy = BODY + LID / 2
        parts = [shell]
        parts.append(rbox(col, name + '_inlay', (cx + sx * .03, BODY + LID + .004, cz + sz * .02), (hx * .52, .012, hz * .46), ice, .01))
        parts.append(rbox(col, name + '_tab', (cx + sx * hx * .5, BODY + LID * .42, cz + sz * (hz + .022)), (hx * .22, .03, .014), orange, .012))
        lid = join(parts, name)
        origin_to(lid, (cx, cy, cz))
        objects.append(lid)
    bpy.data.objects.remove(full)

    # Seam glow: thin strips hidden inside the gaps and under the lid edge.
    seam = [
        rbox(col, 's_x', (0, BODY + LID * .5, 0), (W / 2 - .02, LID * .485, GAP * .3), glow, .002, 1),
        rbox(col, 's_z', (0, BODY + LID * .5, 0), (GAP * .3, LID * .485, D / 2 - .02), glow, .002, 1),
        rbox(col, 's_rim', (0, BODY + .012, 0), (W / 2 + .004, .008, D / 2 + .004), glow, .006, 2),
    ]
    seam_obj = join(seam, 'seam_glow')
    origin_to(seam_obj, (0, BODY, 0))
    objects.append(seam_obj)
    core = rbox(col, 'core_glow', (0, BODY + .004, 0), (W / 2 - .07, .004, D / 2 - .07), glow, .05, 3)
    origin_to(core, (0, BODY, 0))
    objects.append(core)
    for o in objects:
        gc.clean_mesh(o)
    return objects


def crop(path, margin=.08):
    import numpy as np
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)
    ys, xs = np.nonzero(px[..., 3] > .02)
    m = int(max(np.ptp(xs), np.ptp(ys)) * margin)
    x0, x1, y0, y1 = max(0, xs.min() - m), min(w, xs.max() + m), max(0, ys.min() - m), min(h, ys.max() + m)
    out = bpy.data.images.new('crop', x1 - x0, y1 - y0, alpha=True)
    out.pixels.foreach_set(px[y0:y1, x0:x1].ravel())
    out.filepath_raw = str(path)
    out.file_format = 'PNG'
    out.save()


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    objects = build()
    OUT.mkdir(parents=True, exist_ok=True)
    gc.export(objects, OUT / 'model.glb')
    if '--no-renders' not in args:
        gc.studio()
        bpy.context.scene.view_settings.exposure = 0.0
        gc.render(objects, OUT / 'thumbnail.png', (.75, 1.25, .8), (1800, 1520), perspective=True)
        gc.render(objects, REVIEW / 'front.png', (.05, 1, .3), (900, 760), perspective=True)
        crop(OUT / 'thumbnail.png')
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    gc.save(objects, SOURCE, 'Reward Crate')
    print('CREATED reward-crate', flush=True)
