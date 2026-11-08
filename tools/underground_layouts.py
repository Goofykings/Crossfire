"""Authored underground spaces (2026-11): the Civic Central metro station and the old cistern cellar.

Pure data plus small helpers, consumed by tools/layout_city.py and tools/layout_design.py through
tools/compact_layouts.py, which call `underground.prepare(p)` and then `underground_props()`.
Everything here is in game coordinates (metres, +x east, +z south); passage rects are
[x0, z0, x1, z1] clear floor areas at the style's floor level (underground.STYLES).

Design notes
  * Rooms sit a short distance from the hall and join it through a door connector rect: the
    boundary code builds one 0.3 m wall per room edge, so a doorway is a 1 m deep tunnel.
  * Piers keep the original positions in the metro (2.2, 0) and (6.4, 0), now 0.8 m square.
  * Every decor item is validated when the layout is built (underground._surface): art sits on
    real wall, pier or block faces and never crosses a doorway.
"""
from __future__ import annotations

# Atlas cells (tools/make_underground_art.py).
SIGN = {'name': 0, 'platform1': 2, 'platform2': 3, 'exit': 4, 'tickets': 5, 'waiting': 6, 'staff': 7, 'vending': 8,
        'restrooms': 9, 'map': 10, 'nosmoking': 12, 'lost': 13, 'exit_north': 16, 'exit_south': 17, 'wet': 20,
        'step': 21, 'keepleft': 22, 'lasttrain': 23,
        'weinkeller': 24, 'ausgang': 25, 'zisterne': 26, 'keinfeuer': 27, 'anno': 28, 'fasslager': 29, 'markt': 30, 'vorsicht': 31}
SIGN_SIZE = {'name': (2.9, .54, (2, 1)), 'map': (2.0, 1.125, (2, 3))}   # world w, h and atlas span
POSTER = {'flowers': 0, 'cat': 1, 'concert': 2, 'trattoria': 3, 'water': 4, 'travel': 5, 'tonic': 6, 'sock': 7,
          'race': 8, 'robot': 9, 'pigeon': 10, 'boba': 11}


def sign(side, pos, key, y=2.6, w=1.5, **kw):
    """A signage-atlas plate on a wall (the name banner and the route map have their own size)."""
    sw, sh, span = SIGN_SIZE.get(key, (w, w * 192 / 512, (1, 1)))
    return {'host': 'wall', 'side': side, 'pos': pos, 'art': 'signs', 'cell': SIGN[key], 'w': kw.pop('w', sw), 'h': sh, 'y': y,
            'span': span, 'frame': True, 'off': .035, **kw}


def poster(side, pos, key, y=1.75, w=.62, **kw):
    return {'host': 'wall', 'side': side, 'pos': pos, 'art': 'poster', 'cell': POSTER[key], 'w': w, 'h': w * 1.5, 'y': y, 'off': .035, **kw}


def door(side, pos, y=1.08, w=1.0, h=2.1, **kw):
    return {'host': 'wall', 'side': side, 'pos': pos, 'kind': 'door', 'w': w, 'h': h, 'y': y, 'off': .012, **kw}


def on_pier(index, face, key, art='poster', y=1.65, w=.5):
    if art == 'poster':
        return {'host': 'pier', 'index': index, 'face': face, 'art': 'poster', 'cell': POSTER[key], 'w': w, 'h': w * 1.5, 'y': y, 'off': .03}
    return {'host': 'pier', 'index': index, 'face': face, 'art': 'signs', 'cell': SIGN[key], 'w': w, 'h': w * 192 / 512, 'y': y, 'off': .03}


def _on_lines(items, lines):
    """Pin wall items to the main hall's own walls (rooms share x/z ranges with them)."""
    return [{**i, 'line': lines[i['side']]} if i.get('host') == 'wall' and 'line' not in i else i for i in items]


# --------------------------------------------------------------------------------------------
# Metro: Civic Central
# --------------------------------------------------------------------------------------------
def city_underground():
    """Civic Central: a 34 x 8 m concourse and platform hall beneath the avenue (floor -3.8 m, 3.5 m
    clear), two stair lobbies to the civic and south plazas, a ticket hall with a ticket machine
    island and a gate line, two pillar-row platform zones, and four side rooms.

    The civic stair may not start further north than z = -12.2 (a long gun needs 1.6 m beyond the
    portal before the plaza edge), which fixes the hall's north edge; the south stair ends in the
    lane at z = 14.4."""
    hall = [-12.0, -3.2, 22.0, 4.8]
    segments = [
        hall,
        [2.6, -4.24, 6.0, -3.2],           # civic stair lobby
        [2.6, 4.8, 6.0, 6.44],             # south stair lobby
        [-10.6, -8.0, -4.6, -4.2], [-8.4, -4.2, -6.8, -3.2],    # waiting room + door
        [11.4, -8.0, 17.4, -4.2], [13.6, -4.2, 15.2, -3.2],     # ticket office + door
        [-10.0, 5.8, -5.0, 9.6], [-8.0, 4.8, -6.4, 5.8],        # vending alcove + door
        [9.0, 5.8, 15.0, 9.6], [10.2, 4.8, 11.8, 5.8],          # utility room + door
    ]
    west_x, east_x, rows = (-10.0, -6.0, -2.0), (13.0, 17.0, 21.0), (-0.7, 2.3)
    piers = [[2.2, 0.0], [6.4, 0.0]] + [[x, z] for x in west_x for z in rows] + [[x, z] for x in east_x for z in rows]
    # Pier indices: 0, 1 the original pair; then west (x-major, row order), then east.
    wp = lambda x, z: 2 + west_x.index(x) * 2 + rows.index(z)
    ep = lambda x, z: 8 + east_x.index(x) * 2 + rows.index(z)
    blocks = [
        {'rect': [3.9, -1.0, 4.7, 1.0], 'h': 1.9, 'kind': 'kiosk'},                                 # 0 ticket machines
        {'rect': [9.0, -3.2, 9.4, -2.1], 'h': 1.1, 'kind': 'gate'}, {'rect': [9.0, -0.6, 9.4, 0.0], 'h': 1.1, 'kind': 'gate'},
        {'rect': [9.0, 1.5, 9.4, 2.1], 'h': 1.1, 'kind': 'gate'}, {'rect': [9.0, 3.8, 9.4, 4.8], 'h': 1.1, 'kind': 'gate'},
        {'rect': [12.4, -7.7, 16.4, -6.9], 'h': 1.05, 'kind': 'kiosk'},                             # 5 office counter
    ]
    hall_decor = [
        # North wall (z = -3.2)
        poster('n', -11.4, 'trattoria'), poster('n', -10.6, 'cat'), poster('n', -9.8, 'concert'), poster('n', -9.0, 'sock'),
        sign('n', -4.9, 'map', y=1.75), sign('n', -0.9, 'name', y=2.9), sign('n', 1.55, 'nosmoking', y=2.0, w=.9),
        door('n', -0.3), sign('n', -0.3, 'staff', y=2.5, w=1.0),
        sign('n', 7.4, 'platform2', y=2.7, w=1.6), sign('n', 10.8, 'name', y=2.9),
        poster('n', 16.1, 'water'), poster('n', 16.9, 'travel'), poster('n', 17.7, 'tonic'), poster('n', 18.5, 'pigeon'),
        sign('n', 20.8, 'step', y=2.0, w=.9),
        # South wall (z = 4.8)
        sign('s', -10.0, 'vending', y=2.55, w=1.6),
        poster('s', -5.4, 'race'), poster('s', -4.6, 'robot'), poster('s', -3.8, 'boba'), sign('s', -1.4, 'name', y=2.9),
        door('s', 0.6), sign('s', 0.6, 'staff', y=2.5, w=1.0),
        sign('s', 7.2, 'exit_south', y=2.55, w=1.5), poster('s', 8.9, 'flowers'), poster('s', 12.5, 'concert'),
        sign('s', 14.0, 'platform1', y=2.7, w=1.6), poster('s', 15.6, 'cat'), poster('s', 16.4, 'trattoria'),
        sign('s', 18.4, 'lasttrain', y=2.0, w=1.2),
        # End walls
        sign('w', 0.8, 'name', y=2.9), poster('w', -1.2, 'pigeon'), poster('w', 3.3, 'boba'), sign('w', -2.35, 'keepleft', y=2.0, w=1.0),
        sign('e', 0.8, 'map', y=1.75), sign('e', 3.4, 'platform2', y=2.5, w=1.1), poster('e', -1.8, 'tonic'), poster('e', 2.3, 'water'),
    ]
    room_decor = [
        sign('n', -7.6, 'waiting', y=2.7, w=1.7, line=-8.0), poster('w', -6.1, 'flowers', line=-10.6), poster('e', -6.1, 'race', line=-4.6),
        sign('n', 14.4, 'tickets', y=2.6, w=1.7, line=-8.0), poster('w', -6.1, 'travel', line=11.4), poster('e', -6.1, 'robot', line=17.4),
        sign('s', -7.5, 'restrooms', y=2.6, w=1.6, line=9.6), poster('w', 7.6, 'sock', line=-10.0), poster('e', 7.6, 'pigeon', line=-5.0),
        door('s', 11.0, line=9.6), sign('s', 11.0, 'staff', y=2.55, w=1.2, line=9.6), poster('w', 7.7, 'water', line=9.0), sign('e', 7.7, 'lost', y=2.0, w=1.0, line=15.0),
    ]
    pier_decor = [
        on_pier(wp(-10.0, -0.7), 's', 'concert'), on_pier(wp(-6.0, -0.7), 's', 'tonic'), on_pier(wp(-2.0, -0.7), 's', 'travel'),
        on_pier(wp(-10.0, 2.3), 'n', 'flowers'), on_pier(wp(-6.0, 2.3), 'n', 'race'), on_pier(wp(-2.0, 2.3), 'n', 'cat'),
        on_pier(ep(13.0, -0.7), 's', 'boba'), on_pier(ep(17.0, -0.7), 's', 'robot'), on_pier(ep(21.0, -0.7), 's', 'sock'),
        on_pier(ep(13.0, 2.3), 'n', 'pigeon'), on_pier(ep(17.0, 2.3), 'n', 'trattoria'), on_pier(ep(21.0, 2.3), 'n', 'water'),
        on_pier(0, 'w', 'platform1', art='signs', y=2.2, w=.7), on_pier(1, 'e', 'platform2', art='signs', y=2.2, w=.7),
        {'host': 'block', 'index': 5, 'face': 's', 'art': 'signs', 'cell': SIGN['tickets'], 'w': 1.5, 'h': .56, 'y': .55, 'off': .03},
    ]
    decor = _on_lines(hall_decor, {'n': -3.2, 's': 4.8, 'w': -12.0, 'e': 22.0}) + room_decor + pier_decor
    route = [[4.3, -2.2], [3.25, -1.4], [3.25, 1.4], [4.3, 3.6]]
    walks = [
        route,
        [[3.25, -1.8], [-1.0, -1.75], [-10.4, -1.75]],
        [[3.25, 3.7], [-1.0, 3.3], [-10.4, 3.3]],
        [[7.0, -1.35], [10.4, -1.35], [11.4, -1.75], [19.8, -1.75]],
        [[7.0, 3.3], [8.0, 2.95], [10.4, 2.95], [11.4, 3.3], [19.8, 3.3]],
        [[8.0, 0.75], [10.4, 0.75], [19.8, 0.75]],
        [[-7.6, -1.75], [-7.6, -4.8], [-7.6, -6.4]],
        [[14.4, -1.75], [14.4, -4.8], [14.4, -6.0]],
        [[-7.2, 3.3], [-7.2, 6.7], [-7.2, 7.0]],
        [[11.0, 4.1], [11.0, 6.7], [11.0, 7.3]],
    ]
    return [{
        'id': 'metro_underpass', 'style': 'metro', 'name': 'Civic Central',
        'purpose': 'Civic Central metro station beneath the avenue: ticket hall, gate line, two platform zones and side rooms',
        'segments': segments, 'piers': piers, 'blocks': blocks, 'decor': decor, 'walks': walks,
        'entrances': [
            {'id': 'civic', 'type': 'straight', 'rect': [3, -12.2, 5.6, -4.24], 'side': 'n'},
            {'id': 'south', 'type': 'straight', 'rect': [3, 6.44, 5.6, 14.4], 'side': 's'},
        ],
        'route': route,
    }]


# --------------------------------------------------------------------------------------------
# Cellar: the old cistern and wine cellar
# --------------------------------------------------------------------------------------------
def town_underground():
    """Old cistern and wine cellar beneath the square's west wing (floor -3.5 m, 3.2 m clear): a stone
    cistern hall with pier rows around a raised tank, a long vault of wine racks and casks, and two
    stores. Two dogleg portals link the market court and the cistern court."""
    segments = [
        [-11.4, -10.58, -8.6, -4.0],                                  # market stair passage
        [-12.6, -4.0, -1.0, 4.0],                                     # cistern hall
        [-19.4, -2.4, -13.4, 2.4], [-13.4, -1.0, -12.6, 1.0],         # wine vault + door
        [-6.6, -8.8, -1.6, -5.0], [-4.8, -5.0, -3.4, -4.0],           # north store + door
        [-11.9, 5.1, -6.9, 8.6], [-10.2, 4.0, -8.8, 5.1],             # south-west store + door
    ]
    piers = [[x, z] for x in (-10.8, -6.8, -2.8) for z in (-1.9, 1.9)]
    blocks = [{'rect': [-8.2, -0.8, -5.4, 0.8], 'h': 1.0, 'kind': 'tank'}]
    hall_decor = [
        sign('n', -7.6, 'markt', y=2.3, w=1.4), poster('n', -6.1, 'tonic', y=2.2, w=.55), poster('n', -5.4, 'trattoria', y=2.2, w=.55),
        sign('n', -2.3, 'fasslager', y=2.3, w=1.2), sign('s', -5.9, 'zisterne', y=2.3, w=1.4),
        poster('s', -11.4, 'travel', y=2.0, w=.6), poster('s', -7.9, 'flowers', y=2.0, w=.6),
        door('e', -1.4, y=1.08), sign('e', -1.4, 'keinfeuer', y=2.5, w=1.1),
        poster('w', -2.6, 'concert', y=2.0, w=.6), poster('w', 2.6, 'race', y=2.0, w=.6),
    ]
    room_decor = [
        # Vault
        sign('w', 0.0, 'weinkeller', y=2.5, w=1.5, line=-19.4), poster('n', -14.4, 'tonic', y=2.45, w=.55, line=-2.4),
        sign('n', -17.2, 'anno', y=2.45, w=1.1, line=-2.4), poster('s', -15.0, 'pigeon', y=2.45, w=.55, line=2.4),
        sign('s', -17.8, 'vorsicht', y=2.45, w=1.1, line=2.4),
        # Stores
        sign('n', -2.7, 'fasslager', y=2.3, w=1.2, line=-8.8), poster('w', -6.9, 'sock', y=1.8, w=.55, line=-6.6),
        door('e', -6.9, line=-1.6, y=1.08), poster('s', -9.5, 'robot', y=1.8, w=.55, line=8.6),
        door('w', 6.8, line=-11.9, y=1.08), poster('e', 6.8, 'boba', y=1.8, w=.55, line=-6.9),
    ]
    decor = _on_lines(hall_decor, {'n': -4.0, 's': 4.0, 'w': -12.6, 'e': -1.0}) + room_decor
    walks = [
        [[-9.7, 0.0], [-14.0, 0.0], [-16.0, 0.0]],
        [[-9.7, -2.8], [-4.1, -3.0], [-4.1, -6.5]],
        [[-9.7, 3.0], [-9.5, 5.5], [-9.5, 6.4]],
    ]
    return [{
        'id': 'cistern_passage', 'style': 'cellar', 'name': 'Cistern and wine cellar',
        'purpose': 'Old cistern and wine cellar beneath the square, between the market and the cistern court',
        'segments': segments, 'piers': piers, 'blocks': blocks, 'decor': decor, 'walks': walks,
        'entrances': [
            {'id': 'market', 'type': 'dogleg', 'rect': [-13, -15.98, -9.02, -10.58], 'side': 's', 'hand': 'left'},
            {'id': 'cistern', 'type': 'dogleg', 'rect': [-4.98, 4, -1, 9.4], 'side': 'n', 'hand': 'left'},
        ],
        'route': [[-10.1, -7.0], [-9.7, -2.8], [-9.7, 3.0], [-3.9, 3.0]],
    }]


# --------------------------------------------------------------------------------------------
# Floor props
# --------------------------------------------------------------------------------------------
def underground_props(layout, catalog) -> list[dict]:
    """Props standing on the underground floors (benches, bins, vending machines, casks...). Each
    must be a catalog prop and sit inside its passage's clear floor area."""
    out: list[dict] = []
    for p in layout.get('underground', []):
        table = {'metro': _METRO_PROPS, 'cellar': _CELLAR_PROPS, 'farm': _FARM_PROPS}[p['style']]
        for kind, x, z, heading in table:
            assert kind in catalog, f"unknown prop {kind}"
            assert any(r[0] < x < r[2] and r[1] < z < r[3] for r in p['segments']), f"{kind} at {x},{z} is outside {p['id']}"
            out.append({'type': kind, 'pos': [x, p['floor'], z], 'heading': heading})
    return out


# Headings: 0 faces north (-z), 90 east, 180 south, 270 west. Benches and machines face away from their wall.
_METRO_PROPS = [
    # West waiting zone: benches under the poster wall and the route map, bins, vending machines.
    ('bench_modern', -10.2, -2.9, 180), ('bench_modern', -4.9, -2.9, 180), ('trash_bin', -6.5, -2.85, 180),
    ('bench_modern', -3.6, 4.5, 0), ('trash_bin', -1.0, 4.45, 0),
    ('vending_machine', -11.1, 4.33, 0), ('vending_machine_blue', -9.85, 4.33, 0),
    # Ticket hall
    ('trash_bin_grey', 7.4, -2.85, 180), ('trash_bin_grey', 7.4, 4.45, 0), ('wet_floor_sign', 5.7, 5.6, 200),
    # East platform zone
    ('bench_modern', 17.6, -2.9, 180), ('bench_modern', 14.7, 4.5, 0), ('bench_modern', 18.8, 4.5, 0),
    ('trash_bin', 20.6, -2.85, 180), ('vending_machine_blue', 20.2, 4.33, 0), ('vending_machine', 21.4, 4.33, 0),
    # Waiting room
    ('bench_modern', -9.2, -7.7, 180), ('bench_modern', -5.9, -7.7, 180), ('bench_modern', -9.9, -5.1, 90), ('trash_bin', -5.2, -4.7, 270),
    # Ticket office
    ('planter', 12.4, -4.75, 0),
    # Vending alcove
    ('vending_machine', -9.0, 9.1, 0), ('vending_machine_blue', -7.75, 9.1, 0), ('vending_machine', -6.5, 9.1, 0), ('trash_bin_grey', -5.5, 6.15, 90),
    # Utility room
    ('electrical_cabinet', 10.1, 9.25, 0), ('electrical_cabinet', 11.55, 9.25, 0), ('trash_bags', 14.2, 8.9, 40), ('wet_floor_sign', 13.9, 6.9, 160),
]

_CELLAR_PROPS = [
    # Wine vault: racks along both long walls, a pair of casks against the west wall, barrels.
    ('wine_rack', -17.9, -2.1, 180), ('wine_rack', -15.8, -2.1, 180), ('wine_rack', -17.9, 2.1, 0), ('wine_rack', -15.8, 2.1, 0),
    ('cask', -18.6, -1.0, 90), ('cask', -18.6, 1.0, 90), ('barrel', -14.2, -1.0, 0), ('barrel', -14.2, 1.0, 0),
    # Cistern hall: crates and barrels against the walls and by the tank.
    ('barrel_group', -11.6, 3.0, 0), ('crate_stack', -1.9, -3.0, 270), ('barrel', -11.8, -3.2, 0), ('market_crate', -1.8, 3.1, 20),
    # North store
    ('crate_stack', -5.5, -8.2, 0), ('barrel_group', -2.5, -8.1, 0), ('market_crate', -2.2, -6.0, 15), ('barrel', -6.1, -5.6, 0),
    # South-west store: a corner tasting table.
    ('table', -10.2, 8.0, 0), ('stool', -10.9, 7.2, 0), ('stool', -9.5, 7.2, 0), ('barrel', -7.6, 8.1, 0), ('barrel', -11.3, 5.8, 0),
    ('crate', -7.7, 5.8, 10),
]


# --------------------------------------------------------------------------------------------
# Farmstead: the storm-shelter network (style 'farm', floor -3.2 m, 2.9 m clear)
# --------------------------------------------------------------------------------------------
def farm_underground():
    """A loop of rooms under the farm: the Shelter Hall below the main house, a cold store, a generator
    room, a pump room, a bunk room, a tool cellar, a junction room and the barn's root cellar, joined by
    short tunnels and offset so no corridor is a long straight lane. Five surface entrances: the house
    hall and the barn's first stall (open stairs), and three fieldstone storm-cellar portals.

    Doglegs attach at their mouth edge and continue in the mouth's direction; straight stairs end at
    their far edge. Rooms touch a tunnel rect, never each other (touching rects fuse)."""
    A = [-9.0, 6.25, 6.0, 16.0]          # Shelter Hall (house stair from the north)
    B = [-24.0, 4.8, -14.0, 15.5]        # Cold Store (south-west portal)
    C = [7.0, 8.0, 16.0, 16.0]           # Generator Room (east portal)
    D = [-22.0, -45.0, -12.0, -37.77]    # Barn Root Cellar (barn stall stair)
    E = [-9.0, -22.1, 6.0, -13.0]        # Junction Room (north portal)
    F = [12.0, -24.0, 21.0, -13.0]       # Bunk Room
    G = [13.0, -5.0, 22.0, 2.0]          # Pump Room
    H = [-12.0, -31.0, -4.5, -24.2]      # Tool Cellar
    M = [-1.5, -4.5, 5.5, 1.5]           # Dry Store (below the house)
    tunnels = [
        [3.2, 1.5, 5.6, 6.25],           # dry store -> hall
        [0.4, -13.0, 2.8, -4.5],         # junction -> dry store
        [-14.0, 9.5, -9.0, 12.0],        # hall <-> cold store
        [6.0, 10.5, 7.0, 13.0],          # hall <-> generator room
        [14.0, 2.0, 16.4, 8.0],          # generator room -> pump room
        [17.0, -13.0, 19.4, -5.0],       # pump room -> bunk room
        [6.0, -19.5, 12.0, -17.0],       # junction <-> bunk room
        [-12.0, -41.8, -7.0, -39.4],     # root cellar -> corridor
        [-9.4, -39.4, -7.0, -31.0],      # corridor south
        [-8.6, -24.2, -6.2, -22.1],      # tool cellar -> junction
    ]
    segments = [A, B, C, D, E, F, G, H, M] + tunnels
    piers = [[x, z] for x in (-6.0, -1.5, 3.0) for z in (9.4, 13.6)]            # hall: 6
    piers += [[x, z] for x in (-5.5, -1.5, 4.2) for z in (-20.4, -15.8)]         # junction: 6
    piers += [[-19.0, 8.6], [-19.0, 12.2], [11.0, 9.8], [11.0, 14.0]]            # cold store, generator room
    blocks = [
        {'rect': [13.6, -3.4, 16.6, -1.0], 'h': 1.0, 'kind': 'tank'},               # pump room cistern
        {'rect': [8.0, 13.3, 10.3, 14.1], 'h': 0.95, 'kind': 'counter'},            # generator workbench
        {'rect': [-20.2, -43.6, -17.4, -43.0], 'h': 0.95, 'kind': 'counter'},       # cellar workbench
    ]
    return [{
        'id': 'farm_shelter', 'style': 'farm', 'name': 'Storm shelter',
        'purpose': 'Storm shelter and storage tunnels below the farm: close-quarters rooms joined by short offset tunnels',
        'segments': segments, 'piers': piers, 'blocks': blocks, 'decor': [],
        'entrances': [
            {'id': 'house', 'type': 'straight', 'rect': [-4.2, -0.35, -2.2, 6.25], 'side': 'n'},
            {'id': 'barn', 'type': 'straight', 'rect': [-17.4, -37.77, -15.4, -31.17], 'side': 's'},
            {'id': 'north', 'type': 'dogleg', 'rect': [-1.9, -27.5, 2.1, -22.1], 'side': 's', 'hand': 'left'},
            {'id': 'east', 'type': 'dogleg', 'rect': [16.0, 10.2, 21.4, 14.2], 'side': 'w', 'hand': 'left'},
            {'id': 'southwest', 'type': 'dogleg', 'rect': [-22.0, -0.6, -18.0, 4.8], 'side': 's', 'hand': 'left'},
        ],
        'route': [[-3.2, 7.6], [-3.2, 11.2], [-9.5, 11.2], [-14.5, 11.2], [-16.8, 10.6], [-16.8, 7.4], [-19.1, 6.6]],
        # Lanes through every room and tunnel (tests/mapOverhaul.test.ts walks each with a rifle and a sniper rifle).
        'walks': [
            [[-3.2, 7.6], [-3.2, 11.7], [6.5, 11.7], [13.0, 11.7], [15.0, 13.1]],
            [[15.2, 10.0], [15.2, 3.0], [15.2, -0.2], [18.2, -0.2], [18.2, -4.6], [18.2, -12.0], [18.2, -16.0],
             [14.0, -16.0], [11.5, -18.25], [6.5, -18.25], [3.0, -18.25]],
            [[1.6, -12.0], [1.6, -1.0], [4.4, 0.9], [4.4, 5.5], [4.4, 7.2]],
            [[-7.4, -20.0], [-7.4, -23.0], [-8.3, -25.0], [-8.3, -31.5], [-8.2, -38.5], [-8.2, -40.6], [-12.5, -40.6], [-16.4, -40.0], [-16.4, -38.6]],
        ],
    }]


# Floor props of the shelter: (type, x, z, heading). Shelves and benches stand against walls, facing into the room.
_FARM_PROPS = [
    # Shelter Hall: bunks and shelves along the south wall, crates by the piers
    ('bunk_bed', -7.9, 15.45, 0), ('bunk_bed', -5.5, 15.45, 0), ('storage_shelf', -2.9, 15.7, 0), ('storage_shelf', -0.7, 15.7, 0),
    ('ibc_tank', 1.6, 15.2, 0), ('crate_stack', 5.0, 15.1, 0), ('barrel', -8.5, 13.4, 0), ('crate', -8.4, 14.35, 20),
    # Dry Store under the house
    ('storage_shelf', -1.2, -2.5, 90), ('storage_shelf', -1.2, -0.2, 90), ('crate_small', 5.0, -3.3, 10), ('barrel_group', 0.1, 0.8, 0), ('crate', 4.9, -2.2, 30),
    # Cold Store: casks, wine racks, barrels
    ('wine_rack', -22.9, 5.3, 180), ('wine_rack', -23.7, 8.0, 90), ('cask', -22.9, 14.6, 90), ('cask', -22.9, 12.9, 90),
    ('barrel', -15.2, 14.9, 0), ('barrel', -15.2, 6.0, 0), ('crate_stack', -16.4, 14.7, 0), ('market_crate', -22.6, 6.6, 90),
    # Generator Room: generator skid, drums, cable reel
    ('transformer', 14.6, 15.0, 0), ('oil_drum', 8.0, 15.4, 0), ('oil_drum_red', 8.7, 15.4, 0), ('drum_group', 14.0, 9.1, 0),
    ('cable_reel', 8.2, 8.9, 0), ('utility_box', 12.2, 8.5, 180),
    # Barn Root Cellar
    ('barrel_group', -21.0, -38.4, 0), ('crate_stack', -13.1, -38.3, 0), ('storage_shelf', -15.6, -44.65, 0), ('storage_shelf', -13.1, -44.65, 0),
    ('crate', -21.1, -44.2, 15), ('barrel', -21.3, -41.5, 0), ('hay_bale', -13.0, -42.0, 90),
    # Junction Room
    ('crate_stack', -8.3, -13.6, 0), ('barrel', -8.4, -14.5, 0), ('storage_shelf', -3.0, -13.45, 0), ('bench', -3.0, -21.65, 180),
    ('crate', 5.2, -13.6, 20), ('feed_sacks', 5.2, -21.4, 180),
    # Bunk Room
    ('bunk_bed', 13.1, -23.5, 0), ('bunk_bed', 15.3, -23.5, 0), ('bunk_bed', 20.0, -23.5, 0), ('bunk_bed', 13.1, -13.5, 180),
    ('storage_shelf', 15.7, -13.55, 0), ('barrel', 20.4, -14.0, 0), ('table', 16.5, -19.0, 0), ('stool', 15.3, -19.0, 0), ('stool', 17.7, -19.0, 0),
    # Pump Room
    ('pump_skid', 18.5, 1.2, 0), ('barrel', 21.4, 1.3, 0), ('crate_stack', 15.4, -4.3, 0), ('utility_box', 13.6, -4.45, 180),
    # Tool Cellar
    ('workbench', -10.2, -30.45, 180), ('workbench', -6.4, -30.45, 180), ('tire_stack', -5.3, -26.0, 0), ('crate', -11.2, -25.2, 25),
    ('barrel', -5.1, -30.4, 0), ('storage_shelf', -11.6, -27.9, 90),
]
