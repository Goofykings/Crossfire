"""Authored farmstead buildings (2026-11): main house, barn, cabin, garage, four open shacks, the fence.

Pure data. `tools/layout_farm.py` calls `structures()` and writes the elements into layout.json
(`farm.structures`); blender/scripts/lib/farmstead.py turns them into the mesh and the collision.
Plan source: references_images/Newoutdoormap.png at 0.125 m per pixel, origin at pixel (290, 370),
+x east, +z south (north is up in the plan). Every gap in the plan is an open entry: nothing here
has a door leaf.

Conventions: wall openings use world coordinates along the wall's long axis; `top` and `sill` are
heights above the wall element's own bottom.
"""
from __future__ import annotations

# --- element helpers ------------------------------------------------------------------------------
def door(lo, hi, top=2.5, **kw):
    return {'a': [lo, hi], 'top': top, 'kind': 'door', **kw}


def win(lo, hi, sill=1.0, top=2.3, shutters=None, **kw):
    o = {'a': [lo, hi], 'sill': sill, 'top': top, 'kind': 'window', **kw}
    if shutters:
        o['shutters'] = shutters
    return o


def wall(rect, y, opens=(), inn='wall_cream', out=None, outside=None, **kw):
    return {'t': 'wall', 'rect': list(rect), 'y': list(y), 'open': [dict(o) for o in opens], 'in': inn,
            'out': out or inn, 'outside': outside, **kw}


def slab(rect, y, mat, under, holes=(), kind='slab'):
    return {'t': 'slab', 'rect': list(rect), 'y': list(y), 'mat': mat, 'under': under, 'holes': [list(h) for h in holes], 'kind': kind}


def rail(a, b, y, h=1.05, gaps=(), mat='wood_weathered'):
    return {'t': 'rail', 'a': list(a), 'b': list(b), 'y': y, 'h': h, 'gaps': [list(g) for g in gaps], 'mat': mat}


def post(x, z, y0, y1, size=.2, mat='wood_dark'):
    return {'t': 'post', 'at': [x, z], 'y': [y0, y1], 'size': size, 'mat': mat}


def box(b, mat, kind='box', solid=True, **kw):
    return {'t': 'box', 'box': list(b), 'mat': mat, 'kind': kind, 'solid': solid, **kw}


def stairs(rect, direction, y0, y1, n, mat, guard=(), **kw):
    return {'t': 'stairs', 'rect': list(rect), 'dir': direction, 'y0': y0, 'y1': y1, 'n': n, 'mat': mat, 'guard': list(guard), **kw}


def roof(kind, rect, eave, axis, pitch, mat, over=.5, **kw):
    return {'t': 'roof', 'kind': kind, 'rect': list(rect), 'eave': eave, 'axis': axis, 'pitch': pitch, 'mat': mat, 'over': over, **kw}


def structure(sid, name, rect, elements, **kw):
    return {'id': sid, 'name': name, 'rect': list(rect), 'elements': elements, **kw}


# --- main house ---------------------------------------------------------------------------------
# Ground floor 0..3.1 (slab to 3.4), east wing storey 3.4..5.7 (slab to 6.0). The west wing is one storey.
def house():
    X0, Z0, X1, Z1 = -14.0, -8.5, 12.0, 8.0
    T = .35          # exterior wall
    I = .2           # partition
    out, inn, base = 'clapboard_cream', 'wall_cream', 'stone_stacked'
    trim = 'trim_white'
    shut = 'trim_green'
    ext = dict(inn=inn, out=out, base=.55, base_mat=base, frame=trim)
    g1, g2 = 3.4, 6.0      # exterior wall tops, ground and upper
    els = []
    # --- exterior, ground floor
    els += [
        wall([X0, Z0, 0.0, Z0 + T], [0, g1], [door(-9.55, -6.55), win(-13.0, -11.4, shutters=shut)], outside='n', **ext),
        wall([0.0, Z0, X1, Z0 + T], [0, g1], [door(3.9, 6.6), win(8.6, 10.2, shutters=shut), win(1.0, 2.5, shutters=shut)], outside='n', **ext),
        wall([X0, Z0 + T, X0 + T, Z1 - T], [0, g1], [win(-7.4, -6.2, shutters=shut), door(-5.15, -2.6), door(2.35, 4.85)], outside='w', **ext),
        wall([X1 - T, Z0 + T, X1, Z1 - T], [0, g1], [win(-7.4, -6.2), door(-5.7, -3.1), door(2.3, 4.85), win(5.8, 7.0, shutters=shut)], outside='e', **ext),
        wall([X0, Z1 - T, X1, Z1], [0, g1], [door(-11.6, -8.6), door(-1.9, 1.1), door(5.4, 8.4), win(9.6, 11.0, shutters=shut)], outside='s', **ext),
    ]
    # --- exterior, upper floor of the east wing (x 0..12)
    ext2 = dict(ext, base=0.0)
    els += [
        wall([0.0, Z0, X1, Z0 + T], [g1, g2], [win(1.2, 2.8, sill=.9, top=2.1, shutters=shut), win(3.8, 5.2, sill=.9, top=2.1, shutters=shut),
                                              win(7.2, 8.6, sill=.9, top=2.1, shutters=shut), win(9.6, 11.0, sill=.9, top=2.1, shutters=shut)], outside='n', **ext2),
        wall([X1 - T, Z0 + T, X1, Z1 - T], [g1, g2], [win(-6.8, -5.4, sill=.9, top=2.1, shutters=shut), win(-3.6, -2.2, sill=.9, top=2.1, shutters=shut),
                                                      win(3.4, 4.8, sill=.9, top=2.1, shutters=shut)], outside='e', **ext2),
        wall([0.0, Z0 + T, T, Z1 - T], [g1, g2], [win(-5.2, -3.8, sill=.9, top=2.1), win(3.0, 4.4, sill=.9, top=2.1)], outside='w', **ext2),
        wall([0.0, Z1 - T, X1, Z1], [g1, g2], [door(1.6, 3.6, top=2.15), door(7.2, 9.4, top=2.15), win(10.3, 11.5, sill=.9, top=2.1, shutters=shut)], outside='s', **ext2),
    ]
    # belt course hiding the storey seam on the east wing
    els += [box([0.0 - .04, g1 - .08, Z0 - .04, X1 + .04, g1 + .08, Z0], trim, 'trim', False),
            box([X1, g1 - .08, Z0 - .04, X1 + .04, g1 + .08, Z1 + .04], trim, 'trim', False)]
    # --- partitions, ground floor (up to the slab underside)
    p = dict(inn=inn)
    els += [
        wall([X0 + T, -.85, X1 - T, -.65], [0, 3.1], [door(-11.5, -8.75), door(-5.6, -2.2), door(6.0, 8.75)], **p),      # living/hall | pantry | kitchen line
        wall([-1.2, Z0 + T, -1.0, -.85], [0, 3.1], [door(-5.75, -3.0)], **p),                                              # living | kitchen
        wall([-6.6, -.65, -6.4, Z1 - T], [0, 3.1], [door(3.25, 6.0)], **p),                                                # pantry | hall
        wall([2.9, -.65, 3.1, Z1 - T], [0, 3.1], [door(4.9, 7.0)], **p),                                                   # hall | dining
    ]
    # --- slabs: ground ceiling = upper floor of the east wing; upper ceiling
    els.append(slab([X0 + T, Z0 + T, X1 - T, Z1 - T], [3.1, 3.4], 'interior_floor', 'wall_cream',
                    holes=[[1.4, .65, 2.9, 5.7]], kind='floor'))
    els.append(slab([T, Z0 + T, X1 - T, Z1 - T], [5.7, 6.0], 'plaster', 'wall_cream', kind='ceiling'))
    # --- main stair (east wall of the hall) and the guard around its void
    els.append(stairs([1.5, .65, 2.9, 4.7], 'n', 0.0, 3.4, 16, 'wood_dark', guard=['l'], guard_mat='trim_brown'))
    # the void runs 1 m past the stair foot, so a long gun swung down the flight never meets the upper slab
    els.append(rail([1.4, .75], [1.4, 5.7], 3.4, 1.0, mat='trim_brown'))
    els.append(rail([2.92, .75], [2.92, 5.7], 3.4, 1.0, mat='trim_brown'))
    els.append(rail([1.4, 5.72], [2.9, 5.72], 3.4, 1.0, mat='trim_brown'))
    # --- upper partitions
    els += [
        wall([T, -1.1, X1 - T, -.9], [3.4, 5.7], [door(1.4, 2.9, top=2.3), door(8.0, 9.6, top=2.3)], **p),
        wall([5.9, Z0 + T, 6.1, -1.1], [3.4, 5.7], [door(-5.5, -3.5, top=2.3)], **p),
        wall([4.9, 2.5, 5.1, Z1 - T], [3.4, 5.7], [door(4.0, 5.6, top=2.3)], **p),
        wall([5.0, 2.4, X1 - T, 2.6], [3.4, 5.7], [door(8.5, 10.0, top=2.3)], **p),
    ]
    # --- balcony over the dining porch: deck, posts, beams, railing with a drop-down gap
    bx0, bz0, bx1, bz1 = 1.0, Z1, 12.5, 14.0
    els.append(slab([bx0, bz0, bx1, bz1], [3.15, 3.4], 'wood_weathered', 'wood_dark', kind='deck'))
    for x in (1.15, 4.6, 8.05, 11.5, 12.35):
        els.append(post(x, 13.8, 0, 3.15, .22, 'trim_white'))
    for x in (1.15, 6.75, 12.35):
        els.append(post(x, 10.9, 0, 3.15, .22, 'trim_white'))
    els += [box([bx0, 2.85, 13.68, bx1, 3.15, 13.92], 'trim_white', 'beam'), box([bx0, 2.85, 10.78, bx1, 3.15, 11.02], 'trim_white', 'beam')]
    els += [rail([bx0, bz1 - .04], [bx1, bz1 - .04], 3.4, 1.05, gaps=[[2.2, 3.6]], mat='trim_white'),
            rail([bx0 + .04, bz0], [bx0 + .04, bz1], 3.4, 1.05, mat='trim_white'),
            rail([bx1 - .04, bz0], [bx1 - .04, bz1], 3.4, 1.05, mat='trim_white')]
    # --- roofs and chimney (visual)
    els += [roof('gable', [0.0, Z0, X1, Z1], g2, 'z', 28, 'roof_shingle', over=.55, gable=out, under='trim_brown'),
            roof('gable', [X0, Z0, 0.0, Z1], 3.4, 'x', 16, 'roof_shingle', over=.55, gable=out, under='trim_brown', ends={'lo': True, 'hi': False}),
            box([-8.6, 5.0, -.8, -7.7, 7.3, .1], 'brick', 'chimney', False),
            box([-8.7, 7.3, -.9, -7.6, 7.42, .2], 'stone_trim', 'chimney', False),
            # ceiling plate of the swinging kitchen lamp (the lamp itself is an interactive prop)
            box([5.9, 3.04, -4.6, 6.1, 3.1, -4.4], 'iron', 'fixture', False)]
    return structure('house', 'Main House', [X0, Z0, X1 + 2.5, 14.0], els)


# --- barn ---------------------------------------------------------------------------------------
def barn():
    X0, Z0, X1, Z1 = -30.0, -38.0, -11.5, -23.5
    T = .3
    out, inn, base = 'siding_red', 'siding_weathered', 'stone_rubble'
    ext = dict(inn=inn, out=out, base=.45, base_mat=base, frame='trim_white')
    LO, HI, EAVE = 3.0, 3.0, 5.2
    els = []
    # lower walls (to the loft floor)
    els += [
        wall([X0, Z0, X1, Z0 + T], [0, LO], [door(-25.8, -22.8, top=3.0), win(-18.9, -17.7, sill=1.3, top=2.4), win(-14.4, -13.2, sill=1.3, top=2.4)], outside='n', **ext),
        wall([X0, Z0 + T, X0 + T, Z1 - T], [0, LO], [win(-36.6, -35.2, sill=1.3, top=2.4), door(-32.0, -28.8, top=3.0)], outside='w', **ext),
        wall([X1 - T, Z0 + T, X1, Z1 - T], [0, LO], [door(-35.5, -33.25, top=2.6), door(-28.6, -26.4, top=2.6)], outside='e', **ext),
        wall([X0, Z1 - T, X1, Z1], [0, LO], [door(-28.5, -24.0, top=2.6), door(-16.8, -14.4, top=2.6)], outside='s', **ext),
    ]
    # upper walls (loft level): hay doors and windows to the north/east/south; blank bay wall to the west
    ext2 = dict(ext, base=0.0)
    els += [
        wall([X0, Z0, X1, Z0 + T], [LO, EAVE], [win(-17.8, -16.2, sill=.8, top=1.8), win(-14.6, -13.0, sill=.8, top=1.8), win(-27.8, -26.2, sill=1.2, top=1.8)], outside='n', **ext2),
        wall([X0, Z0 + T, X0 + T, Z1 - T], [LO, EAVE], [win(-35.6, -34.2, sill=1.2, top=1.8), win(-27.6, -26.2, sill=1.2, top=1.8)], outside='w', **ext2),
        wall([X1 - T, Z0 + T, X1, Z1 - T], [LO, EAVE], [win(-35.2, -33.6, sill=.8, top=1.8), win(-29.2, -27.6, sill=.8, top=1.8), win(-25.8, -24.8, sill=.8, top=1.8)], outside='e', **ext2),
        wall([X0, Z1 - T, X1, Z1], [LO, EAVE], [door(-18.0, -14.8, top=1.85), win(-27.8, -26.2, sill=1.2, top=1.8)], outside='s', **ext2),
    ]
    # bay | stalls divider and the stall partition (to the loft slab underside)
    p = dict(inn='siding_weathered')
    els += [
        wall([-19.52, Z0 + T, -19.28, Z1 - T], [0, 2.75], [door(-35.5, -33.25, top=2.6), door(-28.6, -26.4, top=2.6)], **p),
        wall([-19.28, -31.22, X1 - T, -30.98], [0, 2.75], [door(-17.4, -15.1, top=2.4)], **p),
    ]
    # loft over the stalls and the east part of the bay; void over the loft stair; forebay deck over the yard
    loft = [-22.6, Z0 + T, X1 - T, Z1 - T]
    els.append(slab(loft, [2.75, 3.0], 'wood_weathered', 'wood_dark', holes=[[-21.05, -32.6, -19.5, -27.8]], kind='loft'))
    els.append(stairs([-21.0, -32.6, -19.52, -28.8], 'n', 0.0, 3.0, 14, 'wood_weathered', guard=['l'], guard_mat='wood_dark'))
    els.append(rail([-21.05, -32.5], [-21.05, -27.8], 3.0, 1.0, mat='wood_dark'))
    els.append(rail([-19.5, -32.5], [-19.5, -27.8], 3.0, 1.0, mat='wood_dark'))
    els.append(rail([-21.05, -27.78], [-19.5, -27.78], 3.0, 1.0, mat='wood_dark'))
    els.append(rail([-22.6, Z0 + T], [-22.6, Z1 - T], 3.0, 1.05, mat='wood_dark'))
    # ceiling at the eave closes the barn: bullets and players stay out of the roof space
    els.append(slab([X0 + T, Z0 + T, X1 - T, Z1 - T], [EAVE - .2, EAVE], 'wood_dark', 'wood_dark', kind='ceiling'))
    # tie beams across the bay (visual)
    for x in (-28.4, -25.6, -23.4):
        els.append(box([x - .13, 4.45, Z0 + T, x + .13, 4.8, Z1 - T], 'wood_beam', 'beam', False))
    # forebay: the loft floor continues over the south yard on posts
    fz1 = -18.5
    els.append(slab([X0 + T, Z1, X1 - T, fz1], [2.75, 3.0], 'wood_weathered', 'wood_dark', kind='deck'))
    for x in (-29.5, -22.4, -16.6, -12.0):
        els.append(post(x, fz1 - .2, 0, 2.75, .3, 'wood_beam'))
    els.append(box([X0 + T, 2.35, fz1 - .35, X1 - T, 2.75, fz1 - .05], 'wood_beam', 'beam'))
    els += [rail([X0 + T, fz1 - .04], [X1 - T, fz1 - .04], 3.0, 1.05, gaps=[[-21.4, -19.8]], mat='trim_white'),
            rail([X0 + T + .04, Z1], [X0 + T + .04, fz1], 3.0, 1.05, mat='trim_white'),
            rail([X1 - T - .04, Z1], [X1 - T - .04, fz1], 3.0, 1.05, mat='trim_white')]
    # the bay's hanging lantern (the layout's barn light sits at its glass)
    els += [box([-25.66, 4.1, -30.56, -25.54, 4.45, -30.44], 'iron', 'fixture', False),
            box([-25.76, 3.55, -30.66, -25.44, 4.1, -30.34], 'lantern_glass', 'fixture', False),
            box([-25.8, 4.1, -30.7, -25.4, 4.16, -30.3], 'iron', 'fixture', False)]
    els.append(roof('gable', [X0, Z0, X1, Z1], EAVE, 'x', 27, 'roof_barn', over=.6, gable=out, under='siding_weathered', cap='trim_white'))
    return structure('barn', 'Barn', [X0 - .5, Z0 - .5, X1 + .5, fz1], els)


# --- cabin ----------------------------------------------------------------------------------------
def cabin():
    X0, Z0, X1, Z1 = 15.5, -36.0, 28.5, -26.0
    T = .3
    ext = dict(inn='wood_weathered', out='logs', base=.4, base_mat='stone_rubble', frame='trim_brown')
    ext2 = dict(ext, base=0.0)
    shut = 'trim_green'
    els = []
    els += [
        wall([X0, Z0, X1, Z0 + T], [0, 3.4], [door(17.7, 20.3), door(23.0, 25.0)], outside='n', **ext),
        wall([X0, Z0 + T, X0 + T, Z1 - T], [0, 3.4], [win(-35.0, -33.6, shutters=shut), door(-32.4, -29.8), win(-28.4, -27.0, shutters=shut)], outside='w', **ext),
        wall([X1 - T, Z0 + T, X1, Z1 - T], [0, 3.4], [door(-29.9, -27.5)], outside='e', **ext),
        wall([X0, Z1 - T, X1, Z1], [0, 3.4], [door(17.3, 19.9), win(20.3, 21.8), door(24.0, 26.6)], outside='s', **ext),
        # upper floor
        wall([X0, Z0, X1, Z0 + T], [3.4, 6.0], [win(17.4, 19.0, sill=.9, top=2.1, shutters=shut), win(20.2, 21.7, sill=.9, top=2.1, shutters=shut), win(24.0, 25.6, sill=.9, top=2.1, shutters=shut)], outside='n', **ext2),
        wall([X0, Z0 + T, X0 + T, Z1 - T], [3.4, 6.0], [win(-35.0, -33.6, sill=.9, top=2.1), door(-32.4, -29.8, top=2.15), win(-28.4, -27.0, sill=.9, top=2.1)], outside='w', **ext2),
        wall([X1 - T, Z0 + T, X1, Z1 - T], [3.4, 6.0], [win(-35.0, -33.6, sill=.9, top=2.1), door(-29.9, -27.5, top=2.15)], outside='e', **ext2),
        wall([X0, Z1 - T, X1, Z1], [3.4, 6.0], [door(17.3, 19.9, top=2.15), win(20.3, 21.8, sill=.9, top=2.1), door(24.0, 26.6, top=2.15)], outside='s', **ext2),
    ]
    p = dict(inn='wood_weathered')
    els += [wall([22.1, Z0 + T, 22.3, Z1 - T], [0, 3.1], [door(-32.2, -29.6)], **p),
            wall([22.1, Z0 + T, 22.3, Z1 - T], [3.4, 5.7], [door(-32.2, -29.6, top=2.3)], **p)]
    els.append(slab([X0 + T, Z0 + T, X1 - T, Z1 - T], [3.1, 3.4], 'interior_floor', 'wood_dark', holes=[[26.8, -34.7, 28.2, -29.5]], kind='floor'))
    els.append(slab([X0 + T, Z0 + T, X1 - T, Z1 - T], [5.7, 6.0], 'wood_dark', 'wood_dark', kind='ceiling'))
    # The stair climbs north along the east wall from the east door; its landing is the strip by the north wall.
    els.append(stairs([26.8, -34.7, 28.2, -30.9], 'n', 0.0, 3.4, 14, 'wood_dark', guard=['l'], guard_mat='trim_brown'))
    els.append(rail([26.78, -34.4], [26.78, -29.5], 3.4, 1.0, mat='trim_brown'))
    els.append(rail([26.8, -29.48], [28.2, -29.48], 3.4, 1.0, mat='trim_brown'))
    # wraparound balcony: west, south and east strips, supported by posts, with a gap in the south railing
    W0, W1, S1, E1 = 13.8, 15.5, -22.0, 30.4
    els += [slab([W0, Z0, X0, S1], [3.15, 3.4], 'wood_weathered', 'wood_dark', kind='deck'),
            slab([X0, Z1, X1, S1], [3.15, 3.4], 'wood_weathered', 'wood_dark', kind='deck'),
            slab([X1, Z0, E1, S1], [3.15, 3.4], 'wood_weathered', 'wood_dark', kind='deck')]
    for x in (W0 + .15, 17.4, 20.8, 24.2, 27.6, E1 - .15):
        els.append(post(x, S1 - .15, 0, 3.15, .22, 'trim_brown'))
    for z in (Z0 + .15, -31.5, -27.2):
        els.append(post(W0 + .15, z, 0, 3.15, .22, 'trim_brown'))
        els.append(post(E1 - .15, z, 0, 3.15, .22, 'trim_brown'))
    els += [box([W0, 2.85, S1 - .3, E1, 3.15, S1], 'trim_brown', 'beam'),
            box([W0, 2.85, Z0, W0 + .3, 3.15, S1 - .3], 'trim_brown', 'beam'),
            box([E1 - .3, 2.85, Z0, E1, 3.15, S1 - .3], 'trim_brown', 'beam')]
    els += [rail([W0, S1 - .04], [E1, S1 - .04], 3.4, 1.05, gaps=[[21.2, 22.8]], mat='trim_brown'),
            rail([W0 + .04, Z0], [W0 + .04, S1], 3.4, 1.05, mat='trim_brown'),
            rail([E1 - .04, Z0], [E1 - .04, S1], 3.4, 1.05, mat='trim_brown'),
            rail([W0, Z0 + .04], [X0, Z0 + .04], 3.4, 1.05, mat='trim_brown'),
            rail([X1, Z0 + .04], [E1, Z0 + .04], 3.4, 1.05, mat='trim_brown')]
    els.append(roof('gable', [X0, Z0, X1, Z1], 6.0, 'x', 26, 'roof_shingle', over=.7, gable='logs', under='trim_brown'))
    els.append(box([24.0, 6.0, -33.4, 24.9, 8.9, -32.5], 'stone_stacked', 'chimney', False))
    return structure('cabin', 'Cabin', [W0, Z0, E1, S1], els)


# --- garage -----------------------------------------------------------------------------------------
def garage():
    X0, Z0, X1, Z1 = -29.0, 18.25, -15.0, 28.25
    T = .3
    ext = dict(inn='block_wall', out='block_wall', base=0.0, frame='trim_green')
    els = [
        wall([X0, Z0, X1, Z0 + T], [0, 3.6], [door(-25.6, -22.6, top=2.6), win(-18.0, -16.4, sill=1.1, top=2.2)], outside='n', **ext),
        wall([X0, Z0 + T, X0 + T, Z1 - T], [0, 3.6], [win(19.4, 20.6, sill=1.1, top=2.2), door(21.9, 24.5, top=2.6)], outside='w', **ext),
        wall([X1 - T, Z0 + T, X1, Z1 - T], [0, 3.6], [door(20.25, 22.4, top=2.5), door(24.9, 26.6, top=2.5)], outside='e', **ext),
        wall([X0, Z1 - T, X1, Z1], [0, 3.6], [door(-26.9, -21.0, top=3.15), win(-17.8, -16.4, sill=1.1, top=2.2)], outside='s', **ext),
        wall([-19.3, Z0 + T, -19.1, Z1 - T], [0, 3.4], [door(21.9, 24.5, top=2.6)], inn='block_wall'),
        slab([X0 + T, Z0 + T, X1 - T, Z1 - T], [3.4, 3.6], 'concrete_floor', 'wood_dark', kind='ceiling'),
        roof('gable', [X0, Z0, X1, Z1], 3.6, 'x', 14, 'roof_barn', over=.5, gable='block_wall', under='wood_dark', cap='trim_green'),
        # overhead door track and header (visual)
        box([-27.1, 3.2, Z1 + .01, -20.8, 3.55, Z1 + .08], 'trim_green', 'trim', False),
    ]
    return structure('garage', 'Garage', [X0, Z0, X1, Z1], els)


# --- shacks ---------------------------------------------------------------------------------------
SHACKS = [('shack_1', 'Market Shack', -18.9, -13.1), ('shack_2', 'Wood Shed', 26.75, 3.9),
          ('shack_3', 'Tool Shack', 22.0, 29.5), ('shack_4', 'Hay Shack', -10.1, 37.25)]


def shack(sid, name, cx, cz, high='n'):
    """Open on all four sides: corner posts, a raised plank floor, a ceiling slab and a shed roof."""
    h = 2.3
    x0, z0, x1, z1 = cx - h, cz - h, cx + h, cz + h
    els = [slab([x0 + .05, z0 + .05, x1 - .05, z1 - .05], [0.0, .22], 'wood_weathered', 'wood_dark', kind='floor')]
    for px in (x0 + .22, x1 - .22):
        for pz in (z0 + .22, z1 - .22):
            els.append(post(px, pz, .22, 2.65, .28, 'wood_dark'))
    # top plates between the posts (visual, above head height)
    els += [box([x0 + .08, 2.45, z0 + .1, x1 - .08, 2.65, z0 + .34], 'wood_dark', 'plate', False),
            box([x0 + .08, 2.45, z1 - .34, x1 - .08, 2.65, z1 - .1], 'wood_dark', 'plate', False),
            box([x0 + .1, 2.45, z0 + .34, x0 + .34, 2.65, z1 - .34], 'wood_dark', 'plate', False),
            box([x1 - .34, 2.45, z0 + .34, x1 - .1, 2.65, z1 - .34], 'wood_dark', 'plate', False)]
    els.append(slab([x0 + .05, z0 + .05, x1 - .05, z1 - .05], [2.65, 2.75], 'roof_shed', 'wood_dark', kind='ceiling'))
    els.append(roof('shed', [x0, z0, x1, z1], 2.75, 'x', 9, 'roof_shed', over=.45, under='wood_dark', high=high, thick=.1))
    return structure(sid, name, [x0, z0, x1, z1], els)


def structures():
    return [house(), barn(), cabin(), garage()] + [shack(s, n, x, z, h) for (s, n, x, z), h in zip(SHACKS, ('n', 'e', 's', 'w'))]


# --- decorative posters (posters_fun atlas cells; same set as the other maps) -------------------------------------------
# (building, cell, x, bottom y, wall-face z or x, normal): each hangs 12 mm proud of a plain stretch of exterior wall.
POSTER = {'flowers': 0, 'cat': 1, 'concert': 2, 'trattoria': 3, 'water': 4, 'travel': 5, 'tonic': 6, 'sock': 7,
          'race': 8, 'robot': 9, 'pigeon': 10, 'boba': 11}


def posters():
    def p(building, cell, x, z, normal, y=1.15):
        return {'building': building, 'cell': POSTER[cell], 'framed': False, 'w': 0.65, 'h': 0.975, 'x': x, 'y': y, 'z': z, 'normal': list(normal)}
    return [
        p('barn', 'concert', -22.8, -23.488, (0, 1)), p('barn', 'tonic', -21.6, -23.488, (0, 1), 1.0), p('barn', 'water', -20.4, -23.488, (0, 1)),
        p('garage', 'race', -20.9, 18.238, (0, -1)), p('garage', 'robot', -19.8, 18.238, (0, -1), 1.0), p('garage', 'travel', -19.8, 28.262, (0, 1), 1.2),
        p('cabin', 'flowers', 16.55, -25.988, (0, 1), 1.25),
        p('house', 'pigeon', -1.2, -8.512, (0, -1), 1.3), p('house', 'trattoria', 12.012, -0.5, (1, 0), 1.2),
    ]
