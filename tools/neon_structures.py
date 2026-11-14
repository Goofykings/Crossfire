"""Neon Backstreets structures (2026-11): the authored buildings of the night-time city block.

Pure data, like tools/farm_structures.py (whose element helpers are reused): `tools/layout_neon.py` writes these
elements into layout.json (`farm.structures`, the shared element container) and blender/scripts/lib/farmstead.py
turns them into the mesh and the authoritative collision, so walls, openings, stairs, rails and decks cannot disagree.
The neon dressing (signs, tubes, glow cards, windows, cables) is authored separately in `dressing()` and built by
blender/scripts/lib/neon.py; it is visual only.

Plan (metres, +x east, +z south; play area [-20, -20, 20, 20]):

    z -20  ======================= north facades (arcade, hotel, pharmacy) ======================
           N sidewalk                      NEON STREET (one-way road)                 fence | vista
    z -12.5  -------+----------------+---------+-------------------------+-------------------
           WEST     |   24/7 MART     | NOODLE  |  RAMEN (2 floors) + upper | EAST
           LANE     |   (3 doors)     | ALLEY   |  room, balcony over the   | LANE
    z -3.5 (vending)+-----------------+---------+--balcony------stair-----+ (street, two
           ......... west arm ......  CROSSING (kiosk)  .......  east arm  .  sidewalks)
    z  4.5          +-----------------+ MARKET  +-------------------------+
                    |  LAUNDROMAT     | COURT   | SE BLOCK: underpass,      |
                    |  (2 doors)      | (stalls)| roof terrace, stairwell   |
    z 15   ---------+-----------------+--stair--+-------------------------+-------------------
           BACK ALLEY (dumpsters, service doors, puddles)
    z  20  ======================= south back facades ==========================================

Two elevated positions face each other over the crossing: the ramen balcony (deck 3.55 m, reached by the
exterior stair in the east arm and through the upper room's interior stair) and the SE roof terrace (deck 3.55 m,
reached by the court stair and the SE stairwell from the underpass). Both have drop-down gaps in their railings.
"""
from __future__ import annotations

from farm_structures import box, door, post, rail, slab, stairs, structure, wall, win

PLAY = (-20.0, -20.0, 20.0, 20.0)
T = 0.3          # inner building walls
PT = 0.45        # perimeter facade walls
F = 0.15         # shop floors and sidewalks
G1 = 3.55        # upper floor / deck level
CEIL = 3.25      # ground-floor ceiling (slab underside)
GLASS = 'glass_store'


def glass(rect_axis, a0, a1, y0, y1, line, depth=0.03):
    """A solid glass pane filling a window opening (bullets and players stop at it; the eye does not)."""
    if rect_axis == 'x':
        return box([a0, y0, line - depth / 2, a1, y1, line + depth / 2], GLASS, 'glass')
    return box([line - depth / 2, y0, a0, line + depth / 2, y1, a1], GLASS, 'glass')


def guarded_stairs(rect, direction, y0, y1, n, mat, sides, min_top=1.2, guard_mat='steel_dark'):
    """A staircase whose side guards start where the drop beside it gets real (step top above `min_top`): the low steps stay
    open, so the foot can be approached at an angle (a guard there catches a long gun and stops players and bots)."""
    import farmstead
    st = stairs(list(rect), direction, y0, y1, n, mat, guard=[], guard_mat=guard_mat)
    out = [st]
    across = {('n', 'l'): 'w', ('n', 'r'): 'e', ('s', 'l'): 'e', ('s', 'r'): 'w', ('e', 'l'): 'n', ('e', 'r'): 's', ('w', 'l'): 's', ('w', 'r'): 'n'}
    for _, r, top in farmstead.stair_steps(st):
        if top <= min_top:
            continue
        for side in sides:
            a = across[(direction, side)]
            g = {'w': [r[0], top, r[1], r[0] + .07, top + 1.0, r[3]], 'e': [r[2] - .07, top, r[1], r[2], top + 1.0, r[3]],
                 'n': [r[0], top, r[1], r[2], top + 1.0, r[1] + .07], 's': [r[0], top, r[3] - .07, r[2], top + 1.0, r[3]]}[a]
            out.append(box(g, guard_mat, 'guard'))
    return out


def shell(rect, *, g_out, g_in, u_out, top, opens, upper_opens=None, base='facade_tiles_dark', frame='steel_dark',
          floor_mat='concrete_floor', floor=True, ceiling=True, ceil_mat='plaster', parapet=0.9, roof_mat='roof_gravel',
          glazing=()):
    """Exterior walls of an inner block: a ground storey (0..G1) and the upper storeys (G1..top + parapet).

    `opens` / `upper_opens` map a side ('n', 's', 'w', 'e') to openings; `glazing` lists (side, a0, a1, sill, top)
    windows that get a solid glass pane. The shop floor (top at F) and the ground ceiling slab are added unless disabled."""
    x0, z0, x1, z1 = rect
    upper_opens = upper_opens or {}
    rects = {'n': [x0, z0, x1, z0 + T], 's': [x0, z1 - T, x1, z1], 'w': [x0, z0 + T, x0 + T, z1 - T], 'e': [x1 - T, z0 + T, x1, z1 - T]}
    els = []
    for side, r in rects.items():
        els.append(wall(r, [0, G1], opens.get(side, []), inn=g_in, out=g_out, outside=side, base=0.55, base_mat=base, frame=frame,
                        frame_floor=F))
        els.append(wall(r, [G1, top + parapet], upper_opens.get(side, []), inn=g_in, out=u_out, outside=side, frame=frame))
    # storey band and cornice (visual, proud of the faces)
    for side, r in rects.items():
        els += band(r, side, G1 - .12, G1 + .1, 'concrete_trim', .06)
        els += band(r, side, top - .1, top + .12, 'concrete_trim', .1)
    for side, a0, a1, sill, wtop in glazing:
        r = rects[side]
        ax = 'x' if side in 'ns' else 'z'
        line = (r[1] + r[3]) / 2 if ax == 'x' else (r[0] + r[2]) / 2
        els.append(glass(ax, a0, a1, sill, wtop, line))
    if floor:
        els.append(box([x0 + T, 0.0, z0 + T, x1 - T, F, z1 - T], floor_mat, 'floor', True, mats={'py': floor_mat}))
    if ceiling:
        els.append(slab([x0 + T, z0 + T, x1 - T, z1 - T], [CEIL, G1], 'concrete_floor', ceil_mat, kind='ceiling'))
    # roof slab inside the parapet
    els.append(slab([x0 + T, z0 + T, x1 - T, z1 - T], [top - .3, top], roof_mat, 'plaster', kind='roof'))
    return els


def band(r, side, y0, y1, mat, proud):
    """A horizontal moulding on the exterior face of wall rect r (visual)."""
    x0, z0, x1, z1 = r
    # (the face against the wall is never seen: skipped, so it cannot share a plane with frames or signs)
    if side == 'n':
        return [box([x0 - proud, y0, z0 - proud, x1 + proud, y1, z0], mat, 'trim', False, skip=['pz'])]
    if side == 's':
        return [box([x0 - proud, y0, z1, x1 + proud, y1, z1 + proud], mat, 'trim', False, skip=['nz'])]
    if side == 'w':
        return [box([x0 - proud, y0, z0, x0, y1, z1], mat, 'trim', False, skip=['px'])]
    return [box([x1, y0, z0, x1 + proud, y1, z1], mat, 'trim', False, skip=['nx'])]


# --- 24/7 Mart -------------------------------------------------------------------------------------------
MART = (-15.0, -12.5, -5.5, -3.5)


def mart():
    x0, z0, x1, z1 = MART
    opens = {
        'n': [door(-10.6, -8.4, top=2.6), win(-14.3, -11.3, sill=.5, top=2.7), win(-7.6, -6.0, sill=.5, top=2.7)],
        'e': [win(-11.6, -9.4, sill=.6, top=2.7), door(-8.1, -6.1, top=2.6)],
        'w': [door(-6.6, -4.8, top=2.4)],
        's': [win(-12.4, -8.6, sill=.9, top=2.5)],
    }
    glazing = [('n', -14.3, -11.3, .5, 2.7), ('n', -7.6, -6.0, .5, 2.7), ('e', -11.6, -9.4, .6, 2.7), ('s', -12.4, -8.6, .9, 2.5)]
    els = shell(MART, g_out='facade_tiles_light', g_in='plaster', u_out='concrete_smooth_cool', top=10.6, opens=opens,
                glazing=glazing, floor_mat='slabs', base='facade_tiles_dark')
    # shop fascia above the street door and the side door: the lightbox signs hang on it (neon.py)
    els.append(box([x0 + .4, 2.85, z0 - .14, x1 - .4, 3.4, z0], 'steel_dark', 'fascia', False))
    els.append(box([x1, 2.85, -8.6, x1 + .14, 3.35, -5.6], 'steel_dark', 'fascia', False))
    # ATM recess on the south wall (crossing side): a steel cabinet set into the plinth
    els.append(box([-7.6, 0.0, z1, -6.6, 1.75, z1 + .22], 'steel_grey', 'atm'))
    return structure('mart', '24/7 Mart', list(MART), els)


# --- Ramen shop: dining room, kitchen, interior stair, upper room and balcony --------------------------------
RAMEN = (0.0, -12.5, 12.5, -4.5)
BALCONY = (0.3, -4.5, 12.2, -2.6)
RAMEN_STAIR = (10.8, -10.4, 12.2, -6.2)          # ascends south, 0.15 -> G1: 1.8 m clear at the foot, 1.4 m landing at the top
BALCONY_STAIR = (10.6, -2.6, 12.0, 2.2)          # ascends north, 0 -> G1


def ramen():
    x0, z0, x1, z1 = RAMEN
    opens = {
        'n': [door(1.6, 3.4, top=2.5), win(4.4, 8.6, sill=.8, top=2.5), win(9.6, 11.6, sill=.8, top=2.5)],
        's': [door(2.6, 4.4, top=2.5), win(5.4, 9.2, sill=.8, top=2.4)],
        'w': [win(-10.4, -8.4, sill=1.0, top=2.1)],         # open take-away hatch onto the noodle alley
        'e': [door(-6.05, -4.85, top=2.3)],                 # kitchen back door onto the east lane, past the stair's top
    }
    up = {
        'n': [win(1.4, 3.0, sill=1.0, top=2.2), win(5.0, 7.2, sill=1.0, top=2.2), win(8.8, 10.2, sill=1.0, top=2.2)],
        's': [door(1.0, 2.4, top=2.3), win(4.4, 6.4, sill=1.0, top=2.2), win(8.2, 9.6, sill=1.0, top=2.2)],
    }
    glazing = [('n', 4.4, 8.6, .8, 2.5), ('n', 9.6, 11.6, .8, 2.5), ('s', 5.4, 9.2, .8, 2.4)]
    els = shell(RAMEN, g_out='wood_dark', g_in='plaster', u_out='brick_city_b_dark', top=13.6, opens=opens, upper_opens=up,
                glazing=glazing, floor_mat='interior_floor', base='stone_trim', ceiling=False)
    # upper floor (the dining room's ceiling) with the stair void, and the upper room's ceiling
    sx0, sz0, sx1, sz1 = RAMEN_STAIR
    els.append(slab([x0 + T, z0 + T, x1 - T, z1 - T], [CEIL, G1], 'interior_floor', 'plaster', holes=[[sx0 - .2, z0 + T, x1 - T, sz1]], kind='floor'))
    els.append(slab([x0 + T, z0 + T, x1 - T, z1 - T], [6.45, 6.75], 'concrete_floor', 'plaster', kind='ceiling'))
    rstair = stairs(list(RAMEN_STAIR), 's', F, G1, 15, 'wood_dark', guard=[], guard_mat='steel_dark')
    els.append(rstair)
    # guard on the kitchen side of the upper steps only: the low steps stay open to step onto from the kitchen
    import farmstead
    for _, r, top in farmstead.stair_steps(rstair):
        if top > 1.6:
            els.append(box([sx0, top, r[1], sx0 + .07, top + 1.0, r[3]], 'steel_dark', 'guard'))
    # guard along the void on the upper floor (the stair arrives at its south end)
    els.append(rail([sx0 - .2, z0 + T], [sx0 - .2, sz1 - .02], G1, 1.0, mat='steel_dark'))
    # serving counter between the dining room and the kitchen, with a pass at both ends (0.95 m: jumpable)
    els.append(box([7.4, F, -11.0, 8.0, 1.0, -6.6], 'wood_dark', 'counter', mats={'py': 'wood_weathered'}))
    # noren curtains over both street doors and a short lantern fascia (visual, above head height)
    for zz, sgn in ((z0, -1), (z1, 1)):
        for a0, a1 in ((1.6, 3.4),) if sgn < 0 else ((2.6, 4.4),):
            fz = zz + sgn * .06
            els.append(box([a0 + .05, 1.95, min(fz, fz + sgn * .02), a1 - .05, 2.45, max(fz, fz + sgn * .02)], 'canvas_indigo', 'noren', False))
    els.append(box([x0 + .3, 2.75, z0 - .16, x1 - .3, 3.35, z0], 'wood_dark', 'fascia', False))
    # ceiling plate of the swinging dining-room pendant (the lamp itself is an interactive prop)
    els.append(box([4.4, 3.19, -6.5, 4.6, 3.25, -6.3], 'iron', 'fixture', False))
    # balcony over the crossing: deck, posts, edge beam, railings with a drop-down gap and the stair arrival
    bx0, bz0, bx1, bz1 = BALCONY
    els.append(slab([bx0, bz0, bx1, bz1], [3.3, G1], 'concrete_floor', 'concrete_trim', kind='deck'))
    for px in (0.45, 4.4, 8.3, 12.05):
        els.append(post(px, -2.75, 0, 3.3, .24, 'steel_dark'))
    els.append(box([bx0, 3.05, bz1 - .3, bx1, 3.3, bz1], 'steel_dark', 'beam'))
    els += [rail([bx0, bz1 - .05], [bx1, bz1 - .05], G1, 1.05, gaps=[[3.0, 4.1], [10.6, 12.0]], mat='steel_dark'),
            rail([bx0 + .05, bz0], [bx0 + .05, bz1], G1, 1.05, mat='steel_dark'),
            rail([bx1 - .05, bz0], [bx1 - .05, bz1 - .1], G1, 1.05, mat='steel_dark')]
    els += guarded_stairs(BALCONY_STAIR, 'n', 0.0, G1, 17, 'concrete_trim', ['l', 'r'])
    return structure('ramen', 'Ramen Shop', [x0, z0, x1, 2.2], els)


# --- Laundromat ----------------------------------------------------------------------------------------------
LAUNDRY = (-14.0, 4.5, -5.0, 15.0)


def laundromat():
    opens = {
        'n': [win(-13.2, -10.4, sill=.7, top=2.6), door(-9.4, -7.4, top=2.6)],
        'w': [door(9.6, 11.2, top=2.4)],
        'e': [win(6.0, 8.6, sill=.8, top=2.5), win(10.4, 13.0, sill=.8, top=2.5)],
    }
    glazing = [('n', -13.2, -10.4, .7, 2.6), ('e', 6.0, 8.6, .8, 2.5), ('e', 10.4, 13.0, .8, 2.5)]
    els = shell(LAUNDRY, g_out='cladding_panel_slate', g_in='facade_tiles_light', u_out='brick_city_brown', top=9.6,
                opens=opens, glazing=glazing, floor_mat='slabs_blue', base='concrete_trim')
    x0, z0, x1, z1 = LAUNDRY
    els.append(box([x0 + .4, 2.8, z0 - .14, x1 - .4, 3.35, z0], 'steel_dark', 'fascia', False))
    return structure('laundromat', 'Laundromat', list(LAUNDRY), els)


# --- SE block: underpass, closed shop units, roof terrace and the stairwell ----------------------------------------
SE = (3.0, 4.5, 12.5, 15.0)
SE_SPLIT = 8.5                               # the tall block starts here; the terrace is the roof of the front part
PASSAGE = (6.5, 9.5)                         # underpass x range
SE_STAIR = (9.8, 9.4, 12.2, 12.9)            # ascends north, 0 -> G1: 0.6 m landing at the terrace door, 1.8 m clear at the foot
COURT_STAIR = (1.6, 8.6, 3.0, 13.4)          # ascends north, 0 -> G1, onto the landing below
COURT_LANDING = (1.6, 7.0, 3.0, 8.6)


def se_block():
    x0, z0, x1, z1 = SE
    px0, px1 = PASSAGE
    top = 12.4
    els = []
    tile = dict(base=.55, base_mat='concrete_trim', frame='steel_dark')
    # --- ground storey. West unit (closed tattoo shop, enclosed) x0..px0-T; passage px0..px1; east units px1+T..x1.
    # north facade (crossing): tattoo window (glass), passage mouth, utility door (closed leaf)
    els.append(wall([x0, z0, px0, z0 + T], [0, G1], [win(3.6, 5.8, sill=.6, top=2.6)], inn='concrete_smooth_dark', out='concrete_smooth_dark', outside='n', **tile))
    els.append(glass('x', 3.6, 5.8, .6, 2.6, z0 + T / 2))
    els.append(wall([px1, z0, x1, z0 + T], [0, G1], [], inn='concrete_smooth_dark', out='concrete_smooth_dark', outside='n', **tile))
    els.append(box([px0, CEIL, z0, px1, G1, z0 + T], 'concrete_smooth_dark', 'lintel'))
    # west wall (market court) and east wall (east lane): full height, upper storeys only above the tall block
    els.append(wall([x0, z0 + T, x0 + T, z1 - T], [0, G1], [], inn='concrete_smooth_dark', out='concrete_smooth_dark', outside='w', **tile))
    els.append(wall([x1 - T, z0 + T, x1, z1 - T], [0, G1], [], inn='concrete_smooth_dark', out='concrete_smooth_dark', outside='e', **tile))
    # south facade (back alley): roller shutter on the west unit (solid wall behind), passage mouth, east unit wall
    els.append(wall([x0, z1 - T, px0, z1], [0, G1], [], inn='concrete_smooth_dark', out='concrete_smooth_dark', outside='s', **tile))
    els.append(wall([px1, z1 - T, x1, z1], [0, G1], [], inn='concrete_smooth_dark', out='concrete_smooth_dark', outside='s', **tile))
    els.append(box([px0, CEIL, z1 - T, px1, G1, z1], 'concrete_smooth_dark', 'lintel'))
    # passage side walls; the stairwell door opens from the passage's east wall near the back alley
    els.append(wall([px0 - T, z0 + T, px0, z1 - T], [0, CEIL], [], inn='concrete_panel', out='concrete_panel'))
    els.append(wall([px1, z0 + T, px1 + T, z1 - T], [0, CEIL], [door(13.3, 14.6, top=2.4)], inn='concrete_panel', out='concrete_panel', frame='steel_dark'))
    # wall between the east front unit (closed utility room) and the stairwell
    els.append(wall([px1 + T, SE_SPLIT, x1 - T, SE_SPLIT + T], [0, CEIL], [], inn='concrete_panel'))
    # floors: the underpass is street level; the west unit is closed and only its glass front is ever seen
    els.append(box([x0 + T, 0.0, z0 + T, px0 - T, F, z1 - T], 'slabs', 'floor', True, mats={'py': 'slabs'}))
    # roof terrace over the front part (also the passage ceiling there) and the first-floor slab over the rest
    # (the outer ground walls rise to G1 and form the terrace's edge; the deck runs under the tall block's north wall)
    els.append(slab([x0 + T, z0 + T, x1 - T, SE_SPLIT + T], [CEIL, G1], 'roof_tiles_flat', 'concrete_panel', kind='deck'))
    sx0, sz0, sx1, sz1 = SE_STAIR
    els.append(slab([x0 + T, SE_SPLIT + T, x1 - T, z1 - T], [CEIL, G1], 'concrete_floor', 'concrete_panel',
                    holes=[[px1 + T, SE_SPLIT + T, x1 - T, z1 - T]], kind='ceiling'))
    # stairwell: landing at the terrace door, flight, shaft ceiling
    els.append(slab([px1 + T, SE_SPLIT + T, x1 - T, sz0], [CEIL, G1], 'concrete_floor', 'concrete_panel', kind='landing'))
    els.append(stairs(list(SE_STAIR), 'n', 0.0, G1, 14, 'concrete_trim', guard=[], guard_mat='steel_dark'))
    # the shaft's west wall above the passage: the tall block's hollow first floor stays closed
    els.append(wall([px1, SE_SPLIT + T, px1 + T, z1 - T], [G1, 6.4], [], inn='concrete_panel'))
    els.append(slab([px1 + T, SE_SPLIT + T, x1 - T, z1 - T], [6.4, 6.7], 'concrete_floor', 'concrete_panel', kind='ceiling'))
    # --- tall block (z SE_SPLIT..z1): upper walls on all four sides; its north wall carries the stairwell's terrace door
    up_rects = {'n': [x0, SE_SPLIT, x1, SE_SPLIT + T], 's': [x0, z1 - T, x1, z1], 'w': [x0, SE_SPLIT + T, x0 + T, z1 - T], 'e': [x1 - T, SE_SPLIT + T, x1, z1 - T]}
    up_open = {'n': [door(10.0, 12.0, top=2.3)]}
    # The tall block's north wall stands on the inner ground-storey walls below the terrace (closed units and the stairwell)
    els.append(wall([x0 + T, SE_SPLIT, px0 - T, SE_SPLIT + T], [F, CEIL], [], inn='concrete_panel'))
    for side, r in up_rects.items():
        els.append(wall(r, [G1, top + .9], up_open.get(side, []), inn='concrete_panel', out='stucco_grey', outside=side, frame='steel_dark'))
        els += band(r, side, top - .1, top + .12, 'concrete_trim', .1)
    for side in ('w', 'e', 's'):
        r = {'w': [x0, z0, x0 + T, z1], 'e': [x1 - T, z0, x1, z1], 's': [x0, z1 - T, x1, z1]}[side]
        els += band(r, side, G1 - .12, G1 + .1, 'concrete_trim', .06)
    els.append(slab([x0 + T, SE_SPLIT + T, x1 - T, z1 - T], [top - .3, top], 'roof_gravel', 'plaster', kind='roof'))
    # --- terrace edges: railing on the crossing side with a drop-down gap, railing with the court landing gap on the
    # west, a solid parapet on the east lane side
    els += [rail([x0, z0 + .06], [x1 - .3, z0 + .06], G1, 1.05, gaps=[[4.2, 5.3]], mat='galvanized'),
            rail([x0 + .06, z0 + .1], [x0 + .06, SE_SPLIT], G1, 1.05, gaps=[[7.0, 8.4]], mat='galvanized'),
            box([x1 - .3, G1, z0, x1, G1 + 1.0, SE_SPLIT], 'concrete_smooth_dark', 'parapet', mats={'py': 'concrete_trim'})]
    # court stair onto the landing platform outside the terrace's west rail
    lx0, lz0, lx1, lz1 = COURT_LANDING
    els.append(slab([lx0, lz0, lx1, lz1], [3.3, G1], 'galvanized', 'steel_dark', kind='deck'))
    els.append(post(lx0 + .12, lz0 + .12, 0, 3.3, .2, 'steel_dark'))
    els += guarded_stairs(COURT_STAIR, 'n', 0.0, G1, 17, 'galvanized', ['l'])
    els += [rail([lx0 + .04, lz0], [lx0 + .04, lz1], G1, 1.05, mat='galvanized'),
            rail([lx0, lz0 + .04], [lx1, lz0 + .04], G1, 1.05, mat='galvanized')]
    return structure('se_block', 'Hostel Block', list(SE), els)


# --- kiosk in the crossing ------------------------------------------------------------------------------------
KIOSK = (-3.4, -0.2, -0.8, 1.6)


def kiosk():
    x0, z0, x1, z1 = KIOSK
    t = .12
    els = [box([x0, 0, z0, x1, 2.45, z1], 'steel_green', 'kiosk', mats={'py': 'steel_dark'}),
           box([x0 - .25, 2.45, z0 - .25, x1 + .25, 2.62, z1 + .25], 'steel_dark', 'kiosk_roof'),
           # counter flap and the closed shutter (visual faces on the solid body)
           box([x0 + .3, 1.0, z0 - .05, x1 - .3, 2.1, z0], 'roller_grey', 'shutter', False),
           box([x0 + .2, .95, z0 - .32, x1 - .2, 1.0, z0], 'steel_dark', 'ledge', False),
           box([x1, .9, z0 + .25, x1 + .03, 2.15, z1 - .25], 'glass_store', 'window', False)]
    del t
    return structure('kiosk', 'Kiosk', list(KIOSK), els)


# --- perimeter facades ---------------------------------------------------------------------------------------------
def facade(sid, name, side, a0, a1, top, mat, opens=(), base='concrete_trim', shutters=(), doors=(), displays=()):
    """One perimeter building front on the play boundary (inner face on the boundary line, PT thick).

    `opens` are wall openings (shop windows, recessed doors); `displays` fill a window opening with glass set back
    in the reveal; `shutters` fill one with a closed roller shutter; `doors` with a closed door leaf."""
    x0, z0, x1, z1 = PLAY
    if side == 'n':
        r = [a0, z0 - PT, a1, z0]
    elif side == 's':
        r = [a0, z1, a1, z1 + PT]
    elif side == 'w':
        r = [x0 - PT, a0, x0, a1]
    else:
        r = [x1, a0, x1 + PT, a1]
    inward = {'n': 's', 's': 'n', 'w': 'e', 'e': 'w'}[side]
    # north and east fronts stand on a sidewalk: their door frames start at its height
    els = [wall(r, [0, top], list(opens), inn=mat, out=mat, outside=inward, base=.6, base_mat=base, frame='steel_dark',
                frame_floor=F if side in 'ne' else 0.0)]
    ax = 'x' if side in 'ns' else 'z'
    # depth into the reveal measured from the boundary line toward the outside
    back = {'n': z0 - PT + .08, 's': z1 + PT - .08, 'w': x0 - PT + .08, 'e': x1 + PT - .08}[side]
    for a, b, y0, y1 in displays:
        els.append(glass(ax, a, b, y0, y1, back + {'n': .02, 's': -.02, 'w': .02, 'e': -.02}[side]))
    for a, b, y0, y1, m in shutters:
        line = back + {'n': .06, 's': -.06, 'w': .06, 'e': -.06}[side]
        els.append(glass(ax, a, b, y0, y1, line, depth=.1) | {'mat': m, 'kind': 'shutter'})
    for a, b, y1, m in doors:
        line = back + {'n': .05, 's': -.05, 'w': .05, 'e': -.05}[side]
        els.append(glass(ax, a, b, 0.0, y1, line, depth=.08) | {'mat': m, 'kind': 'door_leaf'})
    els += band(r, inward, top - .15, top + .12, 'concrete_trim', .12)
    els += band(r, inward, 3.45, 3.62, 'concrete_trim', .05)
    return structure(sid, name, [min(r[0], r[2]), min(r[1], r[3]), max(r[0], r[2]), max(r[1], r[3])], els)


def perimeter():
    out = []
    # north row (z = -20), seen across Neon Street; it continues west past the fence as the vista
    out.append(facade('n_arcade', 'Arcade', 'n', -20.0, -9.0, 11.2, 'facade_tiles_dark',
                      opens=[win(-19.0, -13.4, sill=.45, top=2.9), door(-12.6, -10.6, top=2.7)],
                      displays=[(-19.0, -13.4, .45, 2.9), (-12.6, -10.6, 0.0, 2.7)]))
    out.append(facade('n_hotel', 'Hotel Neon', 'n', -9.0, 1.0, 15.4, 'brick_city_red',
                      opens=[door(-5.6, -3.0, top=2.8), win(-8.2, -6.6, sill=.9, top=2.6), win(-1.8, 0.2, sill=.9, top=2.6)],
                      displays=[(-5.6, -3.0, 0.0, 2.8), (-8.2, -6.6, .9, 2.6), (-1.8, 0.2, .9, 2.6)]))
    out.append(facade('n_pharmacy', 'Pharmacy', 'n', 1.0, 13.0, 12.2, 'stucco_sky',
                      opens=[win(1.8, 6.8, sill=.4, top=2.9), door(7.6, 9.4, top=2.6), win(10.0, 12.2, sill=.4, top=2.9)],
                      shutters=[(1.8, 6.8, .4, 2.9, 'roller_grey')], displays=[(7.6, 9.4, 0.0, 2.6), (10.0, 12.2, .4, 2.9)]))
    out.append(facade('n_corner', 'Corner Bar', 'n', 13.0, 20.0, 13.8, 'brick_city_b_orange',
                      opens=[door(14.2, 15.8, top=2.6), win(16.6, 19.2, sill=.9, top=2.6)],
                      doors=[(14.2, 15.8, 2.6, 'steel_red')], displays=[(16.6, 19.2, .9, 2.6)]))
    # east row (x = 20): karaoke, a gated service gap (vista), bar, closed shop
    out.append(facade('e_karaoke', 'Karaoke', 'e', -20.0, -5.0, 14.6, 'concrete_panel',
                      opens=[door(-12.4, -10.4, top=2.7), win(-9.6, -6.0, sill=.6, top=2.8), win(-17.6, -14.0, sill=.6, top=2.8)],
                      displays=[(-12.4, -10.4, 0.0, 2.7), (-9.6, -6.0, .6, 2.8)], shutters=[(-17.6, -14.0, .6, 2.8, 'roller_blue')]))
    out.append(facade('e_bar', 'Bar 88', 'e', -5.0, 7.2, 10.4, 'facade_tiles_dark',
                      opens=[door(-1.8, 0.0, top=2.6), win(0.8, 4.6, sill=.9, top=2.6)],
                      doors=[(-1.8, 0.0, 2.6, 'steel_dark')], displays=[(0.8, 4.6, .9, 2.6)]))
    out.append(facade('e_shop', 'Closed Shop', 'e', 9.6, 20.0, 12.8, 'stucco_grey',
                      opens=[win(12.0, 16.4, sill=.3, top=2.9), door(17.2, 18.8, top=2.5)],
                      shutters=[(12.0, 16.4, .3, 2.9, 'roller_red')], doors=[(17.2, 18.8, 2.5, 'steel_grey')]))
    # south row (z = 20): back facades with service doors and a gated gap facing the market court
    out.append(facade('s_back_w', 'Back of the Noodle Factory', 's', -20.0, -6.4, 9.8, 'brick_factory_soot',
                      opens=[door(-17.0, -15.8, top=2.3), door(-10.8, -9.6, top=2.3)],
                      doors=[(-17.0, -15.8, 2.3, 'steel_grey'), (-10.8, -9.6, 2.3, 'steel_green')]))
    out.append(facade('s_back_m', 'Back of the Hostel Annex', 's', -2.8, 20.0, 11.6, 'brick_city_brown',
                      opens=[door(4.2, 5.4, top=2.3), door(12.6, 14.2, top=2.4)],
                      doors=[(4.2, 5.4, 2.3, 'steel_red'), (12.6, 14.2, 2.4, 'steel_grey')]))
    # west row (x = -20) from the street corner south: closed shops along the west lane
    out.append(facade('w_shop_n', 'Tea Shop', 'w', -12.5, -2.0, 10.8, 'stucco_peach',
                      opens=[win(-10.6, -6.4, sill=.5, top=2.7), door(-5.4, -3.8, top=2.5)],
                      shutters=[(-10.6, -6.4, .5, 2.7, 'roller_green')], doors=[(-5.4, -3.8, 2.5, 'steel_dark')]))
    out.append(facade('w_shop_s', 'Apartments', 'w', -2.0, 20.0, 12.0, 'brick_city_pale',
                      opens=[door(1.0, 2.6, top=2.5), door(12.0, 13.2, top=2.3)],
                      doors=[(1.0, 2.6, 2.5, 'steel_blue'), (12.0, 13.2, 2.3, 'steel_grey')]))
    return out


# --- gates closing the two vista gaps and the street end --------------------------------------------------------
def gates():
    els = []
    # west end of Neon Street: chain-link construction fence on posts, with a closed gate leaf (2.6 m: not climbable)
    x = PLAY[0]
    els.append({'t': 'fence', 'a': [x, -20.0], 'b': [x, -12.5], 'h': 2.6, 'mat': 'chainlink', 'post': 'galvanized'})
    # east row service gap (x = 20, z 7.2..9.6) and the south gap behind the market court (z = 20, x -6.4..-2.8)
    els.append({'t': 'fence', 'a': [PLAY[2], 7.2], 'b': [PLAY[2], 9.6], 'h': 2.6, 'mat': 'chainlink', 'post': 'galvanized'})
    els.append({'t': 'fence', 'a': [-6.4, PLAY[3]], 'b': [-2.8, PLAY[3]], 'h': 2.6, 'mat': 'chainlink', 'post': 'galvanized'})
    out = []
    for e in els:
        out += fence_elements(e)
    return structure('gates', 'Fences and gates', [PLAY[0] - .2, -20.0, PLAY[2] + .2, PLAY[3] + .2], out)


def fence_elements(e):
    """A chain-link fence: a solid mesh panel (thin box; the mesh material is alpha-cut) between square posts."""
    (ax, az), (bx, bz) = e['a'], e['b']
    along_x = abs(bz - az) < 1e-6
    lo, hi = sorted((ax, bx)) if along_x else sorted((az, bz))
    line = az if along_x else ax
    h = e['h']
    t = .03
    out = []

    def bx_(a0, a1, y0, y1, half, mat, kind, solid=True):
        b = [a0, y0, line - half, a1, y1, line + half] if along_x else [line - half, y0, a0, line + half, y1, a1]
        return box(b, mat, kind, solid)
    out.append(bx_(lo + .05, hi - .05, 0.07, h - .02, t / 2, e['mat'], 'fence'))     # inside the top and bottom rails' height
    n = max(1, round((hi - lo) / 2.4))
    for i in range(n + 1):
        p = lo + (hi - lo) * i / n
        p = min(max(p, lo + .06), hi - .06)
        out.append(bx_(p - .05, p + .05, 0.0, h + .05, .05, e['post'], 'fence_post'))
    out.append(bx_(lo, hi, h - .04, h, .03, e['post'], 'fence_rail', False))
    out.append(bx_(lo, hi, .05, .09, .03, e['post'], 'fence_rail', False))
    return out


# --- sidewalks ----------------------------------------------------------------------------------------------------
SIDEWALKS = [
    ('n_walk', [-20.0, -20.0, 20.0, -18.5]),
    ('s_walk', [-20.0, -14.0, 12.5, -12.5]),
    ('e_walk_w', [12.5, -14.0, 13.7, 15.0]),
    ('e_walk_e', [18.6, -18.5, 20.0, 15.0]),
]


def sidewalks():
    els = []
    for sid, r in SIDEWALKS:
        els.append(box([r[0], 0.0, r[1], r[2], F, r[3]], 'curb', 'sidewalk', mats={'py': 'pavers'}))
    return structure('sidewalks', 'Sidewalks', [-20.0, -20.0, 20.0, 15.0], els)


# --- advertising column in the crossing's east half (cover; its four faces carry lit posters, neon.py) -----------------
PILLAR = (7.1, -0.3, 8.1, 0.7)


def ad_pillar():
    x0, z0, x1, z1 = PILLAR
    els = [box([x0 - .08, 0, z0 - .08, x1 + .08, .3, z1 + .08], 'concrete_trim', 'plinth'),
           box([x0, .3, z0, x1, 3.0, z1], 'steel_dark', 'pillar'),
           box([x0 - .1, 3.0, z0 - .1, x1 + .1, 3.18, z1 + .1], 'steel_dark', 'cap')]
    return structure('ad_pillar', 'Advertising Column', list(PILLAR), els)


# --- shop awnings over street doors (polish pass 2026-11-14) -------------------------------------------------------------------
def awnings():
    """Canvas awnings over five doors: a solid slab 0.1 m thick at 3.05 m (above a jump's head height, so nothing snags) with
    a hanging valance. Bullets stop at them like at any roof; none sits over a deck, a stair or a spawn."""
    els = []

    def awn(rect, mat, side):
        x0, z0, x1, z1 = rect
        els.append(box([x0, 3.05, z0, x1, 3.17, z1], mat, 'awning', True, mats={'ny': 'steel_dark'}))
        t = .05
        v = {'w': [x0, 2.8, z0, x0 + t, 3.05, z1], 'e': [x1 - t, 2.8, z0, x1, 3.05, z1],
             'n': [x0, 2.8, z0, x1, 3.05, z0 + t], 's': [x0, 2.8, z1 - t, x1, 3.05, z1]}[side]
        els.append(box(v, mat, 'valance', False))
    awn([-14.8, 9.3, -14.0, 11.5], 'canvas_green', 'w')       # laundromat west door onto the west lane
    awn([7.3, -20.0, 9.7, -19.3], 'canvas_indigo', 's')       # pharmacy door onto Neon Street
    awn([3.9, 19.3, 5.7, 20.0], 'canvas_indigo', 'n')         # hostel annex service door, back alley
    awn([19.3, 16.9, 20.0, 19.1], 'canvas_red', 'w')          # closed shop door, east lane
    return structure('awnings', 'Awnings', [-14.8, -20.0, 20.0, 20.0], els)


def structures():
    return [mart(), ramen(), laundromat(), se_block(), kiosk(), ad_pillar(), sidewalks(), gates(), awnings()] + perimeter()
