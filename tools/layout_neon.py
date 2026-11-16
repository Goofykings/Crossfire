"""Neon Backstreets layout (2026-11): writes src/maps/neon-backstreets/layout.json.

    python -B -I tools/layout_neon.py [--write] [--plan docs/neon-plan.png]

The buildings are authored in tools/neon_structures.py (wall/slab/stair elements shared with the Farmstead pipeline);
the neon dressing in tools/neon_dressing.py. This file adds the ground zones, props, spawns, practice targets and the
real point lights, then validates that every prop stands on open ground clear of every solid and of every other prop.
Run without --write to validate only; --plan draws a top-down review image.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'blender' / 'scripts' / 'lib'))
sys.path.insert(0, str(ROOT / 'tools'))

import farmstead  # noqa: E402
import neon_dressing  # noqa: E402
import neon_structures as ns  # noqa: E402
from catalog import PROPS  # noqa: E402

OUT = ROOT / 'src' / 'maps' / 'neon-backstreets' / 'layout.json'
PLAY = list(ns.PLAY)
OUTER = 40
F = ns.F
UP = ns.G1


def P(kind, x, z, heading=0.0, y=0.0):
    return {'type': kind, 'pos': [round(x, 3), y, round(z, 3)], 'heading': heading}


CLOSED_UNITS = [(3.0, 4.5, 6.5, 15.0), (9.5, 4.5, 12.5, 8.8)]


# --- ground ---------------------------------------------------------------------------------------------------
def zones():
    # The whole block first (doorways and wall gaps between the named areas are walkable ground too), then the parts.
    # The closed units of the SE block (tattoo shop behind glass, utility room) are not ground anyone can reach.
    from terrain_farm import subtract_rects
    z = [{'id': f'block_{i}', 'kind': 'yard', 'rect': [round(v, 3) for v in r], 'height': 0.0, 'material': 'neon_concrete'}
         for i, r in enumerate(subtract_rects(tuple(PLAY), CLOSED_UNITS))]
    streets = [('neon_street', [-20.0, -18.5, 20.0, -14.0], 'neon_asphalt'),
               ('east_lane', [13.7, -14.0, 18.6, 15.0], 'neon_asphalt')]
    for zid, r, m in streets:
        z.append({'id': zid, 'kind': 'street', 'rect': r, 'height': 0.0, 'material': m})
    for zid, r in ns.SIDEWALKS:
        z.append({'id': zid, 'kind': 'sidewalk', 'rect': r, 'height': F, 'material': 'pavers'})
    alleys = [('west_lane', [-20.0, -12.5, -15.0, -3.5]), ('west_lane_south', [-20.0, 4.5, -14.0, 15.0]),
              ('noodle_alley', [-5.5, -12.5, 0.0, -3.5]), ('back_alley', [-20.0, 15.0, 20.0, 20.0])]
    for zid, r in alleys:
        z.append({'id': zid, 'kind': 'alley', 'rect': r, 'height': 0.0, 'material': 'neon_concrete'})
    z.append({'id': 'crossing', 'kind': 'plaza', 'rect': [-20.0, -3.5, 12.5, 4.5], 'height': 0.0, 'material': 'neon_concrete'})
    z.append({'id': 'under_balcony', 'kind': 'plaza', 'rect': [0.0, -4.5, 12.5, -3.5], 'height': 0.0, 'material': 'neon_concrete'})
    z.append({'id': 'market_court', 'kind': 'court', 'rect': [-5.0, 4.5, 3.0, 15.0], 'height': 0.0, 'material': 'neon_concrete'})
    z.append({'id': 'underpass', 'kind': 'alley', 'rect': [6.5, 4.5, 9.5, 15.0], 'height': 0.0, 'material': 'neon_concrete'})
    # shop floors (the floor boxes are part of the structures; the terrain leaves these rects to them)
    floors = [('mart_floor', [-14.7, -12.2, -5.8, -3.8]), ('ramen_floor', [0.3, -12.2, 12.2, -4.8]),
              ('laundry_floor', [-13.7, 4.8, -5.3, 14.7])]
    for zid, r in floors:
        z.append({'id': zid, 'kind': 'court', 'rect': r, 'height': F, 'material': 'interior'})
    return z


def covered():
    """Roofed floors (tactical map, walk-through test): each centre stands on clear floor."""
    rooms = [('mart_front', [-11.0, -12.2, -5.8, -10.8]), ('mart_back', [-14.7, -6.4, -5.8, -3.8]),
             ('ramen_dining', [0.3, -8.2, 7.4, -4.8]), ('ramen_kitchen', [8.0, -11.0, 10.6, -6.6]),
             ('laundry_front', [-13.7, 4.8, -5.3, 8.8]), ('laundry_back', [-13.7, 10.4, -5.3, 13.4]),
             ('underpass', [6.5, 4.8, 9.5, 14.7]), ('under_balcony', [0.3, -4.5, 10.4, -2.9]),
             ('se_stairwell', [9.8, 13.2, 12.2, 14.7])]
    return [{'id': i, 'kind': 'interior', 'rect': r} for i, r in rooms]


def solids(structures):
    """Street-level footprints that block a walking player (tactical map): wall, post, kiosk, counter and fence
    pieces between 0.47 m and 1.7 m, and each staircase's steps taller than 0.47 m as one rect."""
    out = []
    for s in structures:
        for el in s['elements']:
            if el['t'] == 'stairs':
                tall = [r for _, r, top in farmstead.stair_steps(el) if top > 0.47 and el['y0'] < .2]
                if tall:
                    out.append({'id': s['id'], 'kind': 'stairs', 'rect': [round(min(r[0] for r in tall), 4), round(min(r[1] for r in tall), 4),
                                                                       round(max(r[2] for r in tall), 4), round(max(r[3] for r in tall), 4)]})
        for p in farmstead.structure_parts(s):
            if not p.solid or p.kind in ('stair', 'sidewalk', 'floor'):
                continue
            if p.kind == 'guard' and p.box[1] > 0.47:
                continue   # guards on the taller steps lie inside the staircase rect
            b = p.box
            if b[4] > 0.47 and b[1] < 1.7:
                out.append({'id': s['id'], 'kind': p.kind, 'rect': [round(b[0], 4), round(b[2], 4), round(b[3], 4), round(b[5], 4)]})
    return out


# --- props -------------------------------------------------------------------------------------------------------
STREET = [
    # Neon Street: a delivery van at the north curb, a car at the south curb, a food cart, barriers at the fenced end
    P('van_white', 4.5, -17.4, 90), P('car_black', -11.5, -15.0, 270),
    P('food_cart', -15.6, -19.36, 180, F),
    P('jersey_barrier', -19.35, -17.3, 90), P('jersey_barrier', -19.35, -15.2, 90),
    P('traffic_cone', -18.2, -18.0, 0),
    P('fire_hydrant', 0.55, -13.6, 0, F), P('bike_rack', 10.6, -13.45, 0, F),
    P('bicycle', 10.0, -13.2, 92, F), P('scooter', -13.0, -13.25, 90, F),
    P('trash_bags', 12.4, -19.45, 180, F), P('trash_bin', 11.5, -19.55, 180, F),
    P('streetlight', 10.6, -19.75, 180, F), P('bollard_steel', -5.2, -13.3, 0, F), P('bollard_steel', -0.3, -13.3, 0, F),
    # East lane: a parked car, scooters, a newspaper box, a streetlight
    P('car_red', 17.6, 1.0, 0), P('scooter', 19.3, -8.0, 0, F),
    P('streetlight', 19.75, -2.6, 270, F), P('trash_bags', 19.4, 12.4, 270, F),
    P('bike_rack', 19.3, 8.0, 90, F),
]
LANES = [
    # west lane: vending machines on the mart wall, a dumpster, bags, pallets, a cabinet, an AC condenser
    P('vend_red', -15.43, -10.7, 270), P('vend_blue', -15.43, -9.6, 270),
    P('dumpster', -19.33, -1.5, 90), P('trash_bags', -19.4, 0.55, 90), P('pallet_stack', -19.43, 6.6, 90),
    P('electrical_cabinet', -19.7, 9.0, 90), P('ac_condenser', -14.22, 13.6, 270), P('crate', -18.6, 12.6, 15),
    # noodle alley: a blue vending machine, crates by the hatch, a bin
    P('vend_blue', -5.07, -8.75, 90), P('crate', -0.5, -7.0, 0), P('crate_small', -0.42, -7.05, 25, 0.8),
    P('trash_bin', -5.1, -4.3, 90),
    # back alley: dumpsters, a skip, bags, pallets, AC condensers, a scooter
    P('dumpster', -13.2, 19.3, 0), P('dumpster_blue', 8.5, 19.3, 0), P('dumpster', 17.3, 19.3, 0),
    P('trash_bags', -15.0, 19.4, 0), P('trash_bags', 10.4, 19.45, 0), P('pallet_stack', 1.0, 19.5, 0),
    P('ac_condenser', 4.8, 15.22, 180), P('ac_condenser', 11.2, 15.22, 180), P('scooter', -7.0, 15.6, 90),
    P('crate_stack', -18.9, 16.0, 90),
]
CROSSING = [
    P('jersey_barrier', 5.0, 2.3, 0), P('planter_long', -16.5, 3.9, 0), P('bench_modern', 1.45, -4.04, 180),
    P('trash_bags', -5.1, -3.05, 0), P('bollard_steel', -8.0, -0.6, 0), P('bollard_steel', -8.0, 1.4, 0),
    # market court: two stalls against the laundromat, a table of goods, crates, stools
    P('market_stall', -4.2, 6.0, 90), P('market_stall', -4.2, 11.8, 90), P('market_table', -0.6, 9.0, 90),
    P('market_crate', -1.45, 8.3, 20), P('market_crate', 0.3, 9.9, 70), P('stool', -1.6, 10.0, 0), P('stool', 0.5, 7.9, 0),
    P('crate', -4.4, 14.3, 10),
]
TERRACE = [
    P('ac_condenser', 11.95, 6.0, 270, UP), P('ac_condenser', 11.95, 7.3, 270, UP),
    P('crate', 6.0, 7.9, 10, UP), P('crate_small', 6.9, 7.85, 40, UP), P('flower_pot', 3.8, 5.3, 0, UP),
]
INTERIORS = [
    # 24/7 Mart: checkout counter by the door, two aisles of shelves, drink fridges along the back wall
    P('kitchen_counter', -7.2, -10.4, 90, F), P('store_shelf', -12.8, -9.5, 90, F), P('store_shelf', -12.8, -7.5, 90, F),
    P('store_shelf', -10.4, -9.5, 90, F), P('store_shelf', -10.4, -7.5, 90, F),
    P('drink_fridge', -13.6, -4.2, 180, F), P('drink_fridge', -11.9, -4.2, 180, F), P('drink_fridge', -14.3, -8.6, 270, F),
    P('wet_floor_sign', -9.0, -11.3, 30, F),
    # Ramen shop: booths along the west wall, stools at the counter, the kitchen behind it
    P('table', 1.6, -6.0, 90, F), P('bench', 0.75, -6.0, 90, F), P('bench', 2.45, -6.0, 270, F),
    P('table', 1.6, -9.4, 90, F), P('bench', 0.75, -9.4, 90, F), P('bench', 2.45, -9.4, 270, F),
    P('stool', 6.9, -10.2, 0, F), P('stool', 6.9, -9.2, 0, F), P('stool', 6.9, -8.2, 0, F), P('stool', 6.9, -7.2, 0, F),
    P('kitchen_counter', 8.34, -9.2, 270, F),
    # upper room over the ramen shop (a staff lounge): sofa, table, shelves, crates as cover
    P('sofa', 0.78, -8.0, 90, UP), P('table', 2.4, -8.0, 90, UP), P('bookshelf', 4.0, -11.99, 180, UP),
    P('crate_stack', 7.6, -9.0, 90, UP), P('stool', 2.4, -6.9, 0, UP), P('crate', 4.6, -5.4, 20, UP),
    # Laundromat: a washer island, dryers along the back wall, benches under the court windows, a folding table
    P('washer_row', -11.0, 9.25, 180, F), P('washer_row', -8.6, 9.25, 180, F), P('washer_row', -11.0, 9.97, 0, F),
    P('washer_row', -8.6, 9.97, 0, F), P('dryer_stack', -12.4, 13.84, 0, F), P('dryer_stack', -10.0, 13.84, 0, F),
    P('dryer_stack', -7.6, 13.84, 0, F), P('bench_modern', -5.75, 7.3, 270, F), P('table', -6.4, 11.7, 90, F),
    P('vend_blue', -13.27, 5.6, 90, F), P('wet_floor_sign', -6.35, 5.65, 20, F), P('stool', -6.4, 12.8, 0, F),
]


# polish pass (2026-11-14): the reference alleys are lined with vending machines, bins, boards, pallets and plants. Each piece
# stands against a wall or breaks a long lane; none blocks a doorway, a stair foot or a spawn.
DETAIL = [
    # Neon Street: the ramen door gets a menu board and two bamboo pots, the pharmacy a bin and a planter-height cone cluster
    P('sandwich_board', 4.35, -13.25, 0, F), P('flower_pot', 1.05, -13.15, 0, F), P('flower_pot', 5.05, -13.15, 0, F),
    P('traffic_cone', 8.6, -17.0, 0),
    # west lane south: a vending bank and a gacha bank against the wall, pallets and bags, a phone booth in the crossing
    P('vend_yellow', -19.45, 2.2, 90),
    P('pallet', -18.6, -6.9, 8), P('trash_bags', -19.35, -7.9, 80), P('traffic_cone', -18.0, -6.4, 0),
    # east lane: another bank of vending machines by the service gap, a bin, scooters
    P('vend_red', 19.45, 10.3, 270, F), P('vend_yellow', 19.45, 11.4, 270, F),
    # east lane cover (it was a 35 m run with a single parked car): a dumpster on the west edge, another further south, a barrier
    P('dumpster', 14.45, -10.8, 90), P('dumpster_blue', 15.0, 5.6, 90), P('jersey_barrier', 16.4, -16.5, 90),
    # back alley: pallets and a wrapped load in the loading bay break the 40 m lane, cones, a chair of crates, plants
    P('crate_stack', -1.6, 17.5, 0), P('pallet', 2.2, 18.8, 15), P('traffic_cone', 3.9, 16.6, 0),
    P('trash_bags', 15.2, 19.4, 0), P('crate_small', 12.4, 19.5, 30),
    # market court and crossing: a planter row, crates by the stalls
    P('planter_long', -13.8, -1.3, 0), P('flower_pot', -4.7, 14.0, 0), P('market_crate', -3.7, 8.9, 40),
    # overhaul (2026-11-15): pots at the stair feet, a barrel by the shoji screen, tyres and drums in the working back alley
    P('flower_pot', 10.25, 1.5, 0), P('flower_pot', 1.25, 13.0, 0), P('barrel', -0.47, -5.86, 0),
    P('tire_stack', 3.75, 15.52, 0),
]


def derived_light(layout, catalog):
    """Glows, shafts and bake sources that follow from the props and the blade signs (so moving a prop moves its light)."""
    neon = layout['neon']
    glows, beams, bake = [], [], []
    tint = {'vend_red': [1.0, .62, .55], 'vend_blue': [.55, .8, 1.0], 'vend_yellow': [1.0, .9, .5]}
    for p in layout['props']:
        t = p['type']
        x, y, z = p['pos']
        r = math.radians(p['heading'])
        fx, fz = math.sin(r), -math.cos(r)
        n = [round(fx), round(fz)]
        if t in tint and abs(fx - n[0]) < 1e-6 and abs(fz - n[1]) < 1e-6 and y < 1:
            glows.append({'pos': [x, z], 'n': n, 'col': tint[t], 'k': .6, 'y': 1.1, 'w': 1.3, 'h': 1.8})
            bake.append({'pos': [x + n[0] * .9, y + 1.2, z + n[1] * .9], 'col': tint[t], 'r': 3.2, 'i': .5})
        if t == 'streetlight':
            lx, lz = x + fx * 1.5, z + fz * 1.5
            warm = [1.0, .7, .36]
            beams.append({'p': [round(lx, 3), 6.35, round(lz, 3)], 'col': warm, 'k': .55, 'w0': .35, 'w1': 3.6, 'y0': y + .1, 'pool': 2.4})
            bake.append({'pos': [round(lx, 3), 5.8, round(lz, 3)], 'col': warm, 'r': 8.0, 'i': .85})
    # a faint shaft under each hanging blade sign (light haze in the rain)
    for b in neon['blades']:
        if b['h'] >= 3.0:
            nx, nz = b['n']
            bx, bz = b['c'][0] + nx * (.12 + b['w'] / 2), b['c'][2] + nz * (.12 + b['w'] / 2)
            beams.append({'p': [round(bx, 3), round(b['c'][1] - b['h'] / 2, 3), round(bz, 3)], 'col': b['glow'], 'k': .22, 'w0': b['w'] * .9,
                          'w1': 2.2, 'y0': .3, 'pool': 0})
    neon['prop_glows'] = glows
    neon['beams'] = beams
    neon['bake'] = neon['bake'] + bake


def all_props(catalog_names):
    out = [dict(p) for group in (STREET, LANES, CROSSING, TERRACE, INTERIORS, DETAIL) for p in group]
    for p in out:
        assert p['type'] in catalog_names, p
    return out


# --- spawns, targets, lights -----------------------------------------------------------------------------------------
# Screened spots (picked with a line-of-sight search: no two spawns see each other within 13 m, all 6 m apart, clear of the
# Zone Control squares); each faces the nearest open line.
SPAWN_SEEDS = [(-13.0, -17.4, 90), (-2.7, -8.0, 180), (10.5, -15.2, 270), (16.4, -6.0, 180), (17.0, 11.5, 0), (8.0, 17.4, 270),
               (-1.5, 11.0, 0), (-16.0, 17.4, 90), (-17.2, -4.5, 160), (5.0, -8.0, 180), (-12.5, 7.5, 45), (-10.5, -1.5, 90),
               (7.5, 2.5, 315)]
TARGET_SEEDS = [(-16.5, -15.5, 90), (3.4, -15.4, 180), (16.0, -14.0, 200), (16.2, 4.0, 270), (8.0, 11.0, 0),
                (3.6, 17.0, 0), (-17.5, 13.0, 90), (-17.5, -9.5, 90), (-1.2, -11.5, 180), (3.0, 3.2, 0)]
LIGHTS = [
    # the two strongest neon sources light the characters too (with the sun and the ramen pendant: Babylon's four lights)
    {'type': 'point', 'pos': [7.3, 2.72, -4.18], 'color': [1.0, 0.32, 0.72], 'intensity': 2.4, 'range': 10.0},
    {'type': 'point', 'pos': [-9.5, 3.12, -12.9], 'color': [0.32, 0.86, 1.0], 'intensity': 2.0, 'range': 11.0},
]


def obstruction_boxes(layout, catalog):
    """Axis-aligned (x0, z0, x1, z1, tag) of what blocks a standing player near street level."""
    boxes = []
    for b, tag in farmstead.collision_boxes(layout):
        if b[4] > 0.47 and b[1] < 1.9 and not any(k in tag for k in ('deck', 'ceiling', 'roof', ':floor', 'sidewalk', 'landing')):
            boxes.append((b[0], b[2], b[3], b[5], tag))
    for p, bb in prop_boxes(layout['props'], catalog):
        if p['pos'][1] < 0.5:
            boxes.append((*bb, p['type']))
    return boxes


def prop_boxes(props, catalog):
    out = []
    for p in props:
        col = catalog.get(p['type'], {}).get('collider')
        if not col:
            continue
        hx, hz = col[0] / 2, col[2] / 2
        r = math.radians(p['heading'])
        ex = abs(math.cos(r)) * hx + abs(math.sin(r)) * hz
        ez = abs(math.sin(r)) * hx + abs(math.cos(r)) * hz
        out.append((p, [p['pos'][0] - ex, p['pos'][2] - ez, p['pos'][0] + ex, p['pos'][2] + ez]))
    return out


def dist_to_box(x, z, b):
    return math.hypot(max(b[0] - x, 0, x - b[2]), max(b[1] - z, 0, z - b[3]))


def clear_point(x, z, boxes, radius):
    if not (PLAY[0] + 1 < x < PLAY[2] - 1 and PLAY[1] + 1 < z < PLAY[3] - 1):
        return False
    return all(dist_to_box(x, z, b) > radius for b in boxes)


def snap(x, z, boxes, radius):
    if clear_point(x, z, boxes, radius):
        return x, z
    best = None
    for r in range(1, 12):
        for i in range(-r, r + 1):
            for j in range(-r, r + 1):
                if max(abs(i), abs(j)) != r:
                    continue
                cx, cz = x + i * .25, z + j * .25
                if clear_point(cx, cz, boxes, radius):
                    d = math.hypot(i, j)
                    if best is None or d < best[0]:
                        best = (d, cx, cz)
        if best:
            return best[1], best[2]
    raise ValueError(f'no clear spot near {x}, {z}')


def floor_at(layout, x, z):
    """Height of the walking surface at (x, z): sidewalks and shop floors are 0.15 m."""
    for zn in layout['ground']['zones']:
        r = zn['rect']
        if r[0] <= x <= r[2] and r[1] <= z <= r[3] and zn['height'] > 0:
            return zn['height']
    return 0.0


def build():
    catalog = dict(PROPS)
    layout = {
        'id': 'neon-backstreets', 'name': 'Neon Backstreets', 'version': 1,
        'units': 'metres; +x east, +z south, +y up (glTF / Babylon right-handed). Rects are [x0, z0, x1, z1].',
        'style': 'neon',
        'playArea': PLAY, 'outerLimit': OUTER,
        'ground': {'baseHeight': 0.0, 'zones': zones(), 'covered': covered()},
        'terraces': [], 'buildings': [], 'walls': [], 'arches': [], 'upperRoutes': [], 'circulationRoutes': [],
        # element-authored structures share the Farmstead's container (collision_gen, tactical map, farmstead.generate)
        'farm': {'structures': ns.structures(), 'solids': [], 'posters': neon_dressing.posters()},
        'props': [], 'obstacles': [], 'lights': LIGHTS, 'targets': [], 'spawns': [],
        'underground': [],
    }
    layout['props'] = all_props(set(catalog))
    layout['farm']['solids'] = solids(layout['farm']['structures'])
    layout['navigation'] = {'version': 1, 'groundRoutes': [{k: z[k] for k in ('id', 'kind', 'rect')} for z in layout['ground']['zones']],
                            'coveredRoutes': layout['ground']['covered'], 'upperRoutes': [],
                            'groundObstacles': [{'id': f"{s['id']}:{s['kind']}", 'rect': s['rect']} for s in layout['farm']['solids']]}
    layout['neon'] = neon_dressing.dressing()
    derived_light(layout, catalog)
    boxes = obstruction_boxes(layout, catalog)
    spawns, targets = [], []
    for i, (x, z, h) in enumerate(SPAWN_SEEDS, 1):
        sx, sz = snap(x, z, boxes, 1.0)
        spawns.append({'id': f'S{i:02d}', 'pos': [sx, floor_at(layout, sx, sz), sz], 'heading': h})
    for i, (x, z, h) in enumerate(TARGET_SEEDS, 1):
        tx, tz = snap(x, z, boxes, .9)
        targets.append({'id': f'T{i:02d}', 'pos': [tx, floor_at(layout, tx, tz), tz], 'heading': h})
    layout['spawns'], layout['targets'] = spawns, targets
    return layout


# --- validation ---------------------------------------------------------------------------------------------------------
def validate(layout):
    catalog = PROPS
    problems = []
    solid = [(b, tag) for b, tag in farmstead.collision_boxes(layout) if b[4] - b[1] > 0.02]
    pb = prop_boxes(layout['props'], catalog)
    for p, bb in pb:
        y = p['pos'][1]
        lo, hi = y, y + catalog[p['type']]['collider'][1]
        for b, tag in solid:
            if b[4] <= lo + 0.05 or b[1] >= hi - 0.05:
                continue
            if b[0] < bb[2] - .01 and b[3] > bb[0] + .01 and b[2] < bb[3] - .01 and b[5] > bb[1] + .01:
                problems.append(f"{p['type']} at {p['pos']} overlaps {tag} {b}")
        if not (PLAY[0] < p['pos'][0] < PLAY[2] and PLAY[1] < p['pos'][2] < PLAY[3]):
            problems.append(f"{p['type']} at {p['pos']} outside the play area")
        # standing height must match the surface under it (sidewalk / shop floor 0.15, street 0, decks 3.55)
        if y < 1:
            want = floor_at(layout, p['pos'][0], p['pos'][2])
            stacked = any(q is not p and abs(q['pos'][1] + catalog[q['type']]['collider'][1] - y) < .01
                          and qb[0] - .05 <= p['pos'][0] <= qb[2] + .05 and qb[1] - .05 <= p['pos'][2] <= qb[3] + .05 for q, qb in pb)
            if abs(want - y) > .01 and not stacked:
                problems.append(f"{p['type']} at {p['pos']} stands at {y}, floor is {want}")
    for i, (p, a) in enumerate(pb):
        for q, b in pb[i + 1:]:
            if abs(p['pos'][1] - q['pos'][1]) > 0.5:
                continue
            if a[0] < b[2] - .03 and a[2] > b[0] + .03 and a[1] < b[3] - .03 and a[3] > b[1] + .03:
                problems.append(f"{p['type']} at {p['pos']} overlaps {q['type']} at {q['pos']}")
    return problems


# --- plan image -----------------------------------------------------------------------------------------------------------
def draw_plan(layout, path):
    from PIL import Image, ImageDraw
    S, M = 22, 3.0
    W = int((PLAY[2] - PLAY[0] + 2 * M) * S)
    img = Image.new('RGB', (W, W), (24, 24, 30))
    d = ImageDraw.Draw(img)

    def px(x, z):
        return ((x - PLAY[0] + M) * S, (z - PLAY[1] + M) * S)

    def rect(r, fill=None, outline=None, width=1):
        a, b = px(r[0], r[1]), px(r[2], r[3])
        d.rectangle([min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])], fill=fill, outline=outline, width=width)
    colors = {'street': (52, 52, 64), 'sidewalk': (90, 90, 96), 'alley': (64, 62, 70), 'plaza': (70, 66, 78), 'court': (78, 70, 70), 'yard': (60, 60, 60)}
    for zn in layout['ground']['zones']:
        rect(zn['rect'], fill=colors.get(zn['kind'], (60, 60, 60)))
    for c in layout['ground']['covered']:
        rect(c['rect'], outline=(120, 120, 60))
    for b, tag in farmstead.collision_boxes(layout):
        if b[4] < 0.3 or b[1] > 4.8:
            continue
        hi = b[1] > 2.9
        col = (90, 160, 220) if hi else (210, 210, 220)
        if 'stair' in tag:
            col = (230, 160, 60)
        if 'glass' in tag:
            col = (90, 220, 230)
        if 'fence' in tag:
            col = (160, 160, 100)
        rect([b[0], b[2], b[3], b[5]], fill=None if hi else col, outline=col)
    for p, bb in prop_boxes(layout['props'], PROPS):
        col = (230, 90, 170) if p['pos'][1] > 1 else (200, 120, 60)
        rect(bb, outline=col, width=2)
    for s in layout['spawns']:
        x, z = px(s['pos'][0], s['pos'][2])
        d.ellipse([x - 6, z - 6, x + 6, z + 6], fill=(60, 230, 90))
        h = math.radians(s['heading'])
        d.line([x, z, x + math.sin(h) * 16, z - math.cos(h) * 16], fill=(60, 230, 90), width=2)
        d.text((x + 7, z - 7), s['id'], fill=(200, 255, 200))
    for t in layout['targets']:
        x, z = px(t['pos'][0], t['pos'][2])
        d.rectangle([x - 4, z - 4, x + 4, z + 4], fill=(240, 60, 60))
    for l in layout['lights']:
        x, z = px(l['pos'][0], l['pos'][2])
        d.ellipse([x - 5, z - 5, x + 5, z + 5], outline=tuple(int(c * 255) for c in l['color']), width=3)
    for g in range(int(PLAY[0]), int(PLAY[2]) + 1, 5):
        a, b = px(g, PLAY[1] - M), px(g, PLAY[3] + M)
        d.line([a, b], fill=(40, 40, 50))
        d.text(px(g, PLAY[1] - 2.6), str(g), fill=(160, 160, 170))
        a, b = px(PLAY[0] - M, g), px(PLAY[2] + M, g)
        d.line([a, b], fill=(40, 40, 50))
        d.text(px(PLAY[0] - 2.8, g), str(g), fill=(160, 160, 170))
    img.save(path)


def main():
    layout = build()
    problems = validate(layout)
    for p in problems:
        print('PROBLEM', p)
    print(f"{len(layout['props'])} props, {len(layout['spawns'])} spawns, {len(layout['targets'])} targets, "
          f"{sum(len(s['elements']) for s in layout['farm']['structures'])} elements, {len(problems)} problems")
    if '--plan' in sys.argv:
        draw_plan(layout, sys.argv[sys.argv.index('--plan') + 1])
    if '--write' in sys.argv:
        if problems:
            sys.exit(1)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(layout, indent=1), encoding='utf-8')
        print('wrote', OUT)


if __name__ == '__main__':
    main()
