"""Farmstead layout (2026-11): writes src/maps/farmstead/layout.json.

    python -B -I tools/layout_farm.py --write

Source plan: references_images/Newoutdoormap.png (0.125 m per pixel). The farm buildings are authored
in tools/farm_structures.py (everything is above ground: the storm shelter was removed); this file adds the ground, dirt
paths, trees, crates, props, spawns, targets and lights, then validates that every prop stands on open
ground and clear of every solid. Run without --write to validate only.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'blender' / 'scripts' / 'lib'))
sys.path.insert(0, str(ROOT / 'tools'))

import farm_structures as fs  # noqa: E402
import farmstead  # noqa: E402
import perimeter  # noqa: E402
from catalog import PROPS  # noqa: E402

OUT = ROOT / 'src' / 'maps' / 'farmstead' / 'layout.json'
PLAY = [-37.0, -47.0, 37.0, 45.0]
OUTER = 50


def P(kind, x, z, heading=0.0, y=0.0):
    return {'type': kind, 'pos': [round(x, 3), y, round(z, 3)], 'heading': heading}


# --- ground ------------------------------------------------------------------------------------------
def zones():
    # Walkable meadow: the whole play area up to the perimeter wall (the terrain draws grass everywhere regardless).
    z = [{'id': 'meadow', 'kind': 'yard', 'rect': list(PLAY), 'height': 0.0, 'material': 'grass'}]
    # Dirt paths (plan: tan strips). Orthogonal rects; the terrain roughens their edges.
    paths = [
        ('south_gate_path', [-4.75, 8.0, -0.6, 44.0]),
        ('garage_path', [-26.9, 28.1, -4.75, 32.75]),
        ('barn_path', [-28.1, -23.5, -24.1, -2.5]),
        ('barn_link', [-28.1, -5.6, -13.6, -2.5]),
        ('cabin_link', [11.9, -6.0, 23.25, -2.9]),
        ('house_apron', [-3.4, 8.0, 1.6, 14.0]),
        ('cabin_path', [20.25, -26.0, 23.25, -2.5]),
    ]
    for pid, r in paths:
        z.append({'id': pid, 'kind': 'street', 'rect': r, 'height': 0.0, 'material': 'dirt'})
    # Interior floors (exactly inside the walls; terrain draws them instead of grass).
    floors = [
        ('house_floor', [-13.65, -8.15, 11.65, 7.65], 'interior_floor'),
        ('kitchen_floor', [-1.0, -8.15, 11.65, -0.85], 'slabs'),
        ('pantry_floor', [-13.65, -0.65, -6.6, 7.65], 'concrete_floor'),
        ('dining_porch', [1.0, 8.0, 12.5, 14.0], 'slabs'),
        ('barn_floor', [-29.7, -37.7, -11.8, -23.8], 'dirt_floor'),
        ('stall_floor', [-19.28, -37.7, -11.8, -23.8], 'hay'),
        ('cabin_floor', [15.8, -35.7, 28.2, -26.3], 'interior_floor'),
        ('garage_floor', [-28.7, 18.55, -19.3, 27.95], 'concrete_floor'),
        ('workshop_floor', [-19.1, 18.55, -15.3, 27.95], 'interior_floor'),
    ]
    for fid, r, m in floors:
        z.append({'id': fid, 'kind': 'court', 'rect': r, 'height': 0.0, 'material': m})
    return z


def covered():
    """Roofed floors for the tactical map and the walk-through test: each centre stands in clear floor."""
    rooms = [('house_living', [-13.65, -8.15, -1.2, -0.85]), ('house_kitchen', [-1.0, -8.15, 11.65, -0.85]),
             ('house_hall', [-6.4, -0.65, 2.9, 7.65]), ('house_pantry', [-13.65, -0.65, -6.6, 7.65]),
             ('house_dining', [3.1, 4.6, 11.65, 7.65]), ('barn_bay', [-29.7, -37.7, -22.6, -23.8]),
             ('barn_stalls', [-19.28, -30.98, -11.8, -23.8]), ('cabin_west', [15.8, -35.7, 22.1, -26.3]),
             ('cabin_east', [22.3, -35.7, 28.2, -26.3]), ('garage_bay', [-28.7, 18.55, -19.3, 27.95]),
             ('garage_shop', [-19.1, 18.55, -15.3, 27.95])]
    return [{'id': i, 'kind': 'interior', 'rect': r} for i, r in rooms]


def solids(structures):
    """Street-level footprints that block a walking player (what the tactical map draws): wall, post and
    guard pieces between 0.47 m and 1.7 m, and each staircase's steps taller than 0.47 m as one rect."""
    out = []
    for s in structures:
        stair_boxes = {}
        for el in s['elements']:
            if el['t'] == 'stairs':
                tall = [r for _, r, top in farmstead.stair_steps(el) if top > 0.47]
                if tall:
                    out.append({'id': s['id'], 'kind': 'stairs', 'rect': [round(min(r[0] for r in tall), 4), round(min(r[1] for r in tall), 4),
                                                                       round(max(r[2] for r in tall), 4), round(max(r[3] for r in tall), 4)]})
        for p in farmstead.structure_parts(s):
            if not p.solid or p.kind in ('stair', 'guard'):
                continue
            b = p.box
            if b[4] > 0.47 and b[1] < 1.7:
                out.append({'id': s['id'], 'kind': p.kind, 'rect': [round(b[0], 4), round(b[2], 4), round(b[3], 4), round(b[5], 4)]})
    return out


# --- props -----------------------------------------------------------------------------------------------
# Trees from the plan (pixel centres converted at 0.125 m/px); big canopies are oaks, the boundary trees pines.
OAKS = [(9.4, -39.9), (-8.6, -39.9), (-4.3, -34.6), (10.5, -31.4), (-0.1, -30.4), (-8.6, -29.3), (-4.3, -25.1), (6.2, -21.9),
        (4.1, -18.7), (-1.1, -14.5), (26.4, -14.4), (13.8, -9.1), (-31.0, -6.5), (-25.6, 4.4), (-19.2, 11.0), (-29.8, 13.1),
        (-15.0, 13.1), (-12.3, 17.3), (29.1, 18.4), (14.8, 21.6), (-8.6, 22.7), (4.1, 22.6), (13.7, 30.1), (26.4, 34.3),
        (-29.8, 36.4), (4.1, 36.4), (11.6, 37.5), (-17.1, 37.5), (-30.9, -19.8), (29.0, 9.9), (31.2, 6.5)]
PINES = [(-20.3, -45.0), (11.6, -45.0), (23.3, -45.0), (-34.7, -35.7), (34.6, -30.4), (-34.7, -14.4), (34.6, -3.9),
         (-34.7, 17.3), (34.6, 27.9)]
CRATES = [
    # between buildings and by the house, as in the plan
    ('crate', -8.1, -20.0, 10), ('crate', -8.9, -18.5, 80), ('crate', -7.2, -18.5, 35),
    ('crate', -3.6, -10.6, 15), ('crate', -1.9, -10.6, 60),
    ('crate', 26.1, -10.0, 20), ('crate', 27.8, -10.0, 70),
    ('crate', -15.4, -0.4, 5), ('crate', -16.3, 1.1, 40), ('crate_small', -14.8, 1.2, 70),
    ('crate', 27.1, 18.1, 25), ('crate', 12.3, 20.2, 50), ('crate', 6.6, 22.9, 15), ('crate', -13.2, 24.4, 80),
    ('crate', 4.9, 30.8, 20), ('crate_small', 6.6, 30.8, 60),
    # under the house balcony (plan) and the cabin and barn balconies
    ('crate', 7.0, 13.2, 10), ('crate', 8.7, 13.2, 75), ('crate_small', 3.0, 11.5, 30),
    ('crate', 16.6, -24.4, 15), ('crate_small', 14.7, -27.4, 70), ('crate', 27.5, -24.3, 40), ('crate', 28.6, -23.9, 5),
    ('crate', -13.4, -21.0, 20), ('crate_large', -17.6, -21.3, 0), ('crate', -26.6, -20.8, 55), ('crate_small', -12.4, -19.9, 75),
]
# Hedgerows and windbreaks (props 'hedge_long', 3.8 m x 3 m): they cut the long north-south and east-west lanes, so no
# straight eye-level line crosses the whole map (tests/mapOverhaul.test.ts allows 76 m on this open map), and they
# add cover. Strip hedges close the 4 m margin outside the fence; the others stand in the yard clear of paths.
# The hedgerows are eight shapes (props_farm.HEDGE_VARIANTS: different lengths, heights and thicknesses, each with its own uneven top,
# ends and gaps in the leaf cover). Strip hedges close the yard's margin between the fence and the perimeter wall, so they must be
# 4.2 m or longer (4.7 m in the 5 m south strip); the others are free, and a few are turned a few degrees off the grid.
HEDGES = [
    # west and east strips (the margin is 4.5 m wide: fence line to the wall's inner face)
    P('hedge_wide', -35.22, -30.0, 0), P('hedge_block', 35.22, -24.0, 0), P('hedge_block', -35.22, -5.0, 0), P('hedge_wide', 35.22, -5.0, 0),
    P('hedge_wide', -35.22, 30.0, 0), P('hedge_block', 35.22, 30.0, 0),
    # north and south strips
    P('hedge_block', -18.0, -45.2, 90), P('hedge_run', -18.0, 42.95, 90), P('hedge_wide', 16.0, -45.2, 90), P('hedge_run', 16.0, 42.95, 90),
    # in the yard
    P('hedge_tall', -31.0, -12.0, 3), P('hedge_long', -26.0, -0.5, 356), P('hedge_wide', -9.5, -12.0, 0), P('hedge_low', 12.5, -10.5, 4),
    P('hedge_run', 29.0, -0.5, 0), P('hedge_thin', 31.0, -9.0, 5), P('hedge_block', 20.0, 5.0, 0), P('hedge_wide', 23.0, 8.0, 355),
    P('hedge_short', 13.5, 16.5, 4), P('hedge_tall', 26.5, 14.0, 0),
]
# Large round bales on their side (hay_bale_round: R 0.56, axis along the prop's x). A pyramid has its rows across the stack (local z):
# three on the ground, two in the notches above, one on top (or two and one). Centres are 2 cm closer than a bale's diameter, so
# neighbours touch (the slabs overlap by 2 cm) instead of floating or sinking in.
BALE_R = 0.56
BALE_S = 2 * BALE_R - 0.02            # centre distance of touching bales
BALE_DY = BALE_S * math.sqrt(3) / 2   # row height of a hexagonal packing


def bale_stack(kind, x, z, heading):
    yaw = -math.radians(heading)
    c, s_ = math.cos(yaw), math.sin(yaw)

    def at(v, row):
        return P('hay_bale_round', x + v * s_, z + v * c, heading, round(row * BALE_DY, 4))
    rows = {'pyr3': [[-BALE_S, 0, BALE_S], [-BALE_S / 2, BALE_S / 2], [0]], 'pyr2': [[-BALE_S / 2, BALE_S / 2], [0]]}[kind]
    return [at(v, r) for r, vs in enumerate(rows) for v in vs]


BALES = [('pyr3', -24.0, 12.0, 0), ('pyr3', 22.0, 18.0, 90), ('pyr2', 6.0, -33.0, 0), ('pyr2', -20.0, 0.0, 0), ('pyr2', 10.0, 30.0, 0)]
HAY = [p for kind, x, z, h in BALES for p in bale_stack(kind, x, z, h)]
OUTDOOR = [
    P('tractor', -21.0, -8.4, 90), 
    P('water_trough', -10.2, -22.8, 0), P('well', 2.6, 16.5, 0), P('wheelbarrow', 12.4, -23.6, 40), P('firewood_stack', 11.4, -31.0, 90),
    P('car_red', -13.5, 30.5, 90), P('bench', 3.9, 8.45, 180), P('bench', 10.4, 8.45, 180),
    P('barrel', 11.2, 9.4, 0), P('flower_pot_large', 0.6, 8.7, 0), P('flower_pot_large', -5.4, 8.7, 0),
    P('barrel_group', 13.0, -27.4, 0), P('cart', -29.2, -9.5, 8),
    P('bush', -13.3, -9.4, 0), P('bush', -3.2, -9.5, 0), P('bush', 9.0, -9.5, 0), P('bush', 12.9, 2.0, 0), P('bush', -14.9, 5.9, 0),
    P('bush', 1.0, -42.0, 0), P('bush', 5.0, -42.0, 0), P('bush', -31.2, 20.0, 0),
    P('bush', -10.8, 25.2, 0), P('bush', -29.0, -17.0, 0), P('bush', 25.4, -20.4, 0),
]
FLOOR = 0.22     # the shacks' raised plank floor
SHACK_PROPS = [
    P('market_table', -18.9, -13.1, 0, FLOOR), P('crate', -17.3, -11.9, 20, FLOOR), P('crate_small', -20.3, -14.3, 60, FLOOR),
    P('firewood_stack', 26.75, 3.9, 90, FLOOR), P('crate', 28.1, 5.5, 15, FLOOR), P('crate_small', 25.3, 2.4, 60, FLOOR),
    P('workbench', 22.0, 31.3, 0, FLOOR), P('barrel', 20.4, 28.0, 0, FLOOR), P('barrel', 23.6, 28.0, 0, FLOOR),
    P('hay_stack', -10.1, 35.6, 0, FLOOR), P('hay_bale', -8.4, 38.4, 90, FLOOR), P('feed_sacks', -11.9, 38.4, 20, FLOOR),
]
HOUSE_PROPS = [
    # living room
    P('sofa', -7.2, -1.5, 0), P('table', -7.2, -3.3, 0), P('bookshelf', -12.4, -7.9, 180), P('bookshelf', -4.0, -7.9, 180), P('stool', -5.9, -3.4, 0),
    # kitchen and dining
    P('kitchen_counter', 1.7, -7.8, 180), P('kitchen_counter', 8.3, -7.8, 180), P('fridge', 10.95, -7.75, 180), P('table', 6.4, -3.6, 0),
    P('stool', 5.2, -3.6, 0), P('stool', 7.6, -3.6, 0), P('dining_table', 7.6, 3.25, 0),
    # pantry
    P('crate', -12.6, 6.1, 0), P('crate', -11.1, 6.1, 90), P('storage_shelf', -13.38, 1.2, 90), P('barrel', -7.3, 0.2, 0),
    # upper floor
    P('bed', 4.4, -6.4, 0, 3.4), P('wardrobe', 4.7, -1.45, 0, 3.4), P('bed', 9.9, -6.4, 0, 3.4), P('wardrobe', 7.2, -1.45, 0, 3.4),
    P('bed', 6.6, 3.65, 0, 3.4), P('bookshelf', 10.7, 7.4, 0, 3.4), P('crate', 1.35, 6.9, 30, 3.4), P('bench', 4.3, 6.15, 90, 3.4),
]
BARN_PROPS = [
    P('tractor', -26.8, -33.6, 0), P('hay_stack', -28.2, -36.9, 0), P('hay_bale', -28.6, -35.3, 0), P('hay_bale', -29.0, -26.6, 90),
    P('crate_stack', -29.0, -29.6, 90), P('workbench', -22.2, -35.2, 270),
    P('hay_bale', -12.5, -36.8, 0), P('hay_bale', -12.5, -33.6, 90), P('barrel', -12.4, -29.5, 0), P('feed_sacks', -12.3, -26.8, 90),
    P('hay_bale', -18.3, -24.7, 0), P('crate', -13.0, -24.7, 25),
    # loft
    P('hay_stack', -13.2, -37.0, 0, 3.0), P('hay_bale', -15.4, -36.8, 90, 3.0), P('hay_stack', -13.2, -26.4, 0, 3.0),
    P('crate', -20.6, -35.5, 20, 3.0), P('barrel', -22.0, -24.6, 0, 3.0), P('hay_bale', -17.8, -33.4, 0, 3.0), P('crate_small', -16.2, -29.4, 70, 3.0),
]
CABIN_PROPS = [
    P('table', 19.0, -33.0, 0), P('stool', 18.0, -33.0, 0), P('stool', 20.0, -33.0, 0), P('bench', 16.25, -34.2, 90),
    P('crate', 23.5, -27.8, 10), P('barrel', 27.7, -27.0, 0), P('bookshelf', 24.6, -35.4, 180), P('firewood_stack', 23.6, -29.0, 0),
    P('bed', 18.2, -32.6, 0, 3.4), P('wardrobe', 20.8, -35.0, 180, 3.4), P('bed', 24.6, -33.5, 0, 3.4), P('table', 25.4, -29.9, 0, 3.4),
    P('stool', 24.2, -31.2, 0, 3.4), P('bench', 20.5, -27.0, 0, 3.4),
]
GARAGE_PROPS = [
    P('car_blue', -23.5, 25.3, 90), P('workbench', -27.4, 19.1, 180), P('tire_stack', -28.0, 26.9, 0), P('oil_drum', -20.5, 19.2, 0),
    P('oil_drum_red', -19.7, 19.2, 0), P('utility_box', -23.5, 18.9, 180), P('workbench', -16.6, 27.4, 0), P('storage_shelf', -17.6, 18.85, 180),
    P('barrel', -18.4, 27.4, 0), P('crate', -20.0, 26.9, 10), P('crate_small', -16.0, 19.3, 60),
]


def all_props(catalog_names) -> list[dict]:
    out = []
    for x, z in OAKS:
        k = 'tree_oak' if (round(x * 7 + z * 3) % 3) else 'tree_oak_small'
        out.append(P(k, x, z, (round(x * 13 + z * 7) % 360)))
    for x, z in PINES:
        out.append(P('tree_pine', x, z, (round(x * 9 + z * 5) % 360)))
    for k, x, z, h in CRATES:
        out.append(P(k, x, z, h))
    for group in (HEDGES, OUTDOOR, HAY, SHACK_PROPS, HOUSE_PROPS, BARN_PROPS, CABIN_PROPS, GARAGE_PROPS):
        out += [dict(p) for p in group]
    for p in out:
        assert p['type'] in catalog_names, p
    return out


# --- spawns, targets, lights ---------------------------------------------------------------------------------------
SPAWN_SEEDS = [(-31, -30, 110), (-8, -33, 170), (8, -26, 200), (31, -24, 250), (30, -4, 270), (30, 14, 260), (28, 36, 330),
               (16, 37, 0), (0.5, 36, 10), (-15, 36.5, 20), (-31, 24, 70), (-31, 8, 80), (-20, -8, 90), (6, -13, 180),
               (-1, 20, 0), (14, 22, 300)]
TARGET_SEEDS = [(-26, -17, 90), (-8, -26, 180), (6, -30, 180), (18, -17, 270), (31, -18, 270), (30, 8, 270), (20, 24, 270),
                (8, 33, 0), (-5, 30, 0), (-22, 32, 0), (-31, 16, 90), (-6, 12, 0)]
LIGHTS = [
    {'type': 'point', 'pos': [6.0, 2.65, -4.5], 'color': [1.0, 0.88, 0.7], 'intensity': 0.65, 'range': 5.0},
    {'type': 'point', 'pos': [-25.6, 3.75, -30.5], 'color': [1.0, 0.86, 0.66], 'intensity': 0.7, 'range': 6.0},
]


def obstruction_boxes(layout, props_catalog):
    """Axis-aligned boxes (x0, z0, x1, z1) that block a standing player at ground level."""
    boxes = []
    for b, tag in farmstead.collision_boxes(layout):
        if b[4] > 0.25 and b[1] < 1.9 and 'deck' not in tag and 'ceiling' not in tag and 'floor' not in tag:
            boxes.append((b[0], b[2], b[3], b[5], tag))
    for p in layout['props'] + layout['obstacles']:
        col = props_catalog.get(p['type'], {}).get('collider')
        if col and p['pos'][1] > -0.5 and p['pos'][1] < 0.5:
            hx, hz = col[0] / 2, col[2] / 2
            r = math.radians(p['heading'])
            ex = abs(math.cos(r)) * hx + abs(math.sin(r)) * hz
            ez = abs(math.sin(r)) * hx + abs(math.cos(r)) * hz
            boxes.append((p['pos'][0] - ex, p['pos'][2] - ez, p['pos'][0] + ex, p['pos'][2] + ez, p['type']))
    return boxes


def dist_to_box(x, z, b):
    dx = max(b[0] - x, 0, x - b[2])
    dz = max(b[1] - z, 0, z - b[3])
    return math.hypot(dx, dz)


def clear_point(x, z, boxes, radius, holes):
    if any(h[0] - radius < x < h[2] + radius and h[1] - radius < z < h[3] + radius for h in holes):
        return False
    if not (PLAY[0] + 2 < x < PLAY[2] - 2 and PLAY[1] + 2 < z < PLAY[3] - 2):
        return False
    return all(dist_to_box(x, z, b) > radius for b in boxes)


def snap(x, z, boxes, radius, holes):
    """The clear point nearest to (x, z) on a 0.5 m search grid."""
    if clear_point(x, z, boxes, radius, holes):
        return x, z
    best = None
    for r in range(1, 14):
        for i in range(-r, r + 1):
            for j in range(-r, r + 1):
                if max(abs(i), abs(j)) != r:
                    continue
                cx, cz = x + i * .5, z + j * .5
                if clear_point(cx, cz, boxes, radius, holes):
                    d = math.hypot(i, j)
                    if best is None or d < best[0]:
                        best = (d, cx, cz)
        if best:
            return best[1], best[2]
    raise ValueError(f'no clear spot near {x}, {z}')


def prop_footprints(props, props_catalog):
    """[x0, z0, x1, z1] ground footprints (rotated collider extents) of the street-level props that have a collider."""
    out = []
    for p in props:
        col = props_catalog.get(p['type'], {}).get('collider')
        if col and -0.5 < p['pos'][1] < 0.5:
            hx, hz = col[0] / 2, col[2] / 2
            r = math.radians(p['heading'])
            ex = abs(math.cos(r)) * hx + abs(math.sin(r)) * hz
            ez = abs(math.sin(r)) * hx + abs(math.cos(r)) * hz
            out.append([p['pos'][0] - ex, p['pos'][2] - ez, p['pos'][0] + ex, p['pos'][2] + ez])
    return out


def build():
    catalog = {k: v for k, v in PROPS.items()}
    layout = {
        'id': 'farmstead', 'name': 'Farmstead', 'version': 1,
        'units': 'metres; +x east, +z south, +y up (glTF / Babylon right-handed). Rects are [x0, z0, x1, z1].',
        'style': 'farm',
        'playArea': PLAY, 'outerLimit': OUTER,
        'ground': {'baseHeight': 0.0, 'zones': zones(), 'covered': covered()},
        'terraces': [], 'buildings': [], 'walls': [], 'arches': [], 'upperRoutes': [], 'circulationRoutes': [],
        'farm': {'structures': [], 'solids': [], 'posters': fs.posters()},
        'props': [], 'obstacles': [], 'lights': LIGHTS, 'targets': [], 'spawns': [],
    }
    layout['farm']['structures'] = fs.structures()
    # props first: the perimeter wall's piers keep clear of whatever stands near it (hedges ending at the wall, trees)
    layout['props'] = all_props(set(catalog))
    layout['farm']['perimeter'] = perimeter.build_spec(PLAY, prop_footprints(layout['props'], catalog))
    layout['farm']['solids'] = solids(layout['farm']['structures']) + perimeter.solids(layout['farm']['perimeter'])
    layout['navigation'] = {'version': 1, 'groundRoutes': [{k: z[k] for k in ('id', 'kind', 'rect')} for z in layout['ground']['zones']],
                            'coveredRoutes': layout['ground']['covered'], 'upperRoutes': [],
                            'groundObstacles': [{'id': f"{s['id']}:{s['kind']}", 'rect': s['rect']} for s in layout['farm']['solids']]}
    layout['underground'] = []        # the storm shelter was removed (2026-11-12): everything is above ground
    boxes = obstruction_boxes(layout, catalog)
    holes = []
    # spawns and targets: snapped to clear ground, away from stairwells
    spawns, targets = [], []
    for i, (x, z, h) in enumerate(SPAWN_SEEDS, 1):
        sx, sz = snap(x, z, boxes, 1.2, [list(r) for r in holes])
        spawns.append({'id': f'S{i:02d}', 'pos': [sx, 0.0, sz], 'heading': h})
    for i, (x, z, h) in enumerate(TARGET_SEEDS, 1):
        tx, tz = snap(x, z, boxes, 1.0, [list(r) for r in holes])
        targets.append({'id': f'T{i:02d}', 'pos': [tx, 0.0, tz], 'heading': h})
    layout['spawns'], layout['targets'] = spawns, targets
    return layout


def validate(layout):
    """Every street-level prop must stand on open ground, outside every solid and every other prop."""
    catalog = PROPS
    problems = []
    solids = []
    for b, tag in farmstead.collision_boxes(layout):
        if b[4] > 0.25 and b[1] < 3.6:
            solids.append((b, tag))
    holes = []          # no stairwells any more
    props = [p for p in layout['props']]
    boxes_of = []
    for p in props:
        col = catalog[p['type']]['collider']
        if not col:
            continue
        hx, hz = col[0] / 2, col[2] / 2
        r = math.radians(p['heading'])
        ex = abs(math.cos(r)) * hx + abs(math.sin(r)) * hz
        ez = abs(math.sin(r)) * hx + abs(math.cos(r)) * hz
        boxes_of.append((p, [p['pos'][0] - ex, p['pos'][2] - ez, p['pos'][0] + ex, p['pos'][2] + ez]))
    for p, bb in boxes_of:
        y = p['pos'][1]
        for b, tag in solids:
            if y >= 3.3 and 'deck' in tag and False:
                continue
            # same level only: a solid overlaps the prop's height band
            lo, hi = y, y + catalog[p['type']]['collider'][1]
            if b[4] <= lo + 0.05 or b[1] >= hi - 0.05:
                continue
            if b[0] < bb[2] and b[3] > bb[0] and b[2] < bb[3] and b[5] > bb[1]:
                problems.append(f"{p['type']} at {p['pos']} overlaps {tag}")
        if -0.5 < y < 1.0:
            for h in holes:
                if h[0] < bb[2] and h[2] > bb[0] and h[1] < bb[3] and h[3] > bb[1]:
                    problems.append(f"{p['type']} at {p['pos']} stands in a stairwell footprint")
        # inside the play area
        if not (PLAY[0] < p['pos'][0] < PLAY[2] and PLAY[1] < p['pos'][2] < PLAY[3]):
            problems.append(f"{p['type']} at {p['pos']} outside the play area")
    for i, (p, a) in enumerate(boxes_of):
        for q, b in boxes_of[i + 1:]:
            if abs(p['pos'][1] - q['pos'][1]) > 0.5 or p['type'] == q['type'] == 'hay_bale_round':
                continue   # bales of a stack touch by design (their boxes include the belly; the collision slabs do not overlap)
            if a[0] < b[2] - .03 and a[2] > b[0] + .03 and a[1] < b[3] - .03 and a[3] > b[1] + .03:
                problems.append(f"{p['type']} at {p['pos']} overlaps {q['type']} at {q['pos']}")
    return problems


def main():
    layout = build()
    problems = validate(layout)
    for p in problems:
        print('PROBLEM', p)
    print(f"{len(layout['props'])} props, {len(layout['spawns'])} spawns, {len(layout['targets'])} targets, {len(problems)} problems")
    if '--write' in sys.argv:
        if problems:
            sys.exit(1)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(layout, indent=1), encoding='utf-8')
        print('wrote', OUT)


if __name__ == '__main__':
    main()
