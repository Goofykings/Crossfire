"""Farmstead props (2026-11): trees, hay, farm tools, rural furniture and shelter storage.

Every prop is a low-poly MeshData with its origin at the centre of its footprint on the floor and its
front toward -z, like the rest of the catalogue. Sizes and colliders live in catalog.PROPS.
"""
import math
from meshkit import MeshData


def _trunk(m, h, r0, r1, seg=9):
    m.cylinder((0, 0, 0), r0, h, 'bark', segments=seg, radius_top=r1, caps=(False, False))


def tree_oak(scale=1.0, seed=0):
    """Broad oak: a flared trunk, three limbs and a canopy of overlapping leaf blobs (about 4.4 m wide, 7 m tall)."""
    m = MeshData()
    s = scale
    _trunk(m, 3.1 * s, .34 * s, .2 * s)
    m.cylinder((0, -.02, 0), .46 * s, .22 * s, 'bark', segments=9, radius_top=.34 * s, caps=(False, False))
    limbs = ((.9, 3.0, .2), (-.8, 3.3, -.5), (.1, 3.5, -.9))
    for i, (x, y, z) in enumerate(limbs):
        m.tube((0, 2.5 * s, 0), (x * s, y * s + .7 * s, z * s), .09 * s, 'bark', segments=6)
    blobs = [(0, 5.0, 0, 1.9), (1.25, 4.3, .4, 1.4), (-1.2, 4.5, -.3, 1.45), (.3, 4.4, -1.3, 1.3),
             (-.2, 4.2, 1.25, 1.25), (.2, 6.1, .1, 1.2), (1.0, 5.6, -.8, 1.05), (-1.0, 5.7, .8, 1.0)]
    for i, (x, y, z, r) in enumerate(blobs):
        mat = 'leaves_oak' if (i + seed) % 2 == 0 else 'leaves_oak_b'
        m.sphere((x * s, y * s, z * s), r * s, mat, rings=4, segments=8, squash=.82)
    return m


def tree_pine():
    """Pine: slim trunk with five stacked foliage cones (2.8 m wide, 8 m tall)."""
    m = MeshData()
    _trunk(m, 2.6, .24, .14, 8)
    # Foliage starts above head height, and each cone has a floor, so nothing can be walked into or seen through.
    tiers = ((2.25, 1.35, 1.55), (3.3, 1.2, 1.4), (4.35, 1.05, 1.3), (5.35, .85, 1.2), (6.3, .65, 1.1))
    for i, (y, r, h) in enumerate(tiers):
        m.cylinder((0, y, 0), r * 1.35, h * 1.5, 'leaves_pine', segments=9, radius_top=.04, caps=(True, True))
    m.cylinder((0, 6.9, 0), .07, 1.1, 'leaves_pine', segments=6, radius_top=.0, caps=(False, False))
    return m


def bush():
    m = MeshData()
    for i, (x, z, r) in enumerate(((0, 0, .5), (.42, .15, .38), (-.4, -.1, .4), (.1, -.35, .34))):
        m.sphere((x, r * .75, z), r, 'leaves_oak' if i % 2 == 0 else 'leaves_oak_b', rings=3, segments=7, squash=.85)
    return m


def hay_bale(rotated=False):
    """Rectangular hay bale (1.1 x 0.5 x 0.55 m) bound by two twine strands."""
    m = MeshData()
    m.box(-.55, 0, -.275, .55, .5, .275, 'hay')
    for x in (-.28, .28):
        m.box(x - .012, 0, -.28, x + .012, .5, .28, 'rope', skip=('ny',))
        m.box(x - .013, .5, -.285, x + .013, .504, .285, 'rope')
    return m


def hay_stack():
    """Three bales stacked as a pyramid (2.2 x 1.0 x 0.55 m)."""
    m = MeshData()
    for x in (-.56, .56):
        m.box(x - .55, 0, -.275, x + .55, .5, .275, 'hay')
    m.box(-.55, .5, -.275, .55, 1.0, .275, 'hay')
    for x in (-.84, -.28, .28, .84):
        m.box(x - .012, 0, -.28, x + .012, .5, .28, 'rope', skip=('ny',))
    for x in (-.28, .28):
        m.box(x - .012, .5, -.28, x + .012, 1.0, .28, 'rope')
    return m


def water_trough():
    """Galvanised stock trough on wooden legs (2.2 x 0.65 x 0.7 m) with a water surface."""
    m = MeshData()
    m.box(-1.1, .25, -.35, 1.1, .65, .35, 'galvanized', skip=('py',))
    m.box(-1.04, .6, -.29, 1.04, .62, .29, 'water')
    for x in (-.9, .9):
        m.box(x - .07, 0, -.3, x + .07, .27, .3, 'wood_weathered')
    m.box(-1.12, .62, -.37, 1.12, .66, .37, 'iron', skip=('py', 'ny'))
    return m


def wheelbarrow():
    m = MeshData()
    m.box(-.35, .28, -.28, .45, .5, .28, 'iron_rusty')
    m.face_toward([(.45, .5, -.28), (.45, .5, .28), (.45, .28, .28), (.45, .28, -.28)], 'iron_rusty', (1, 0, 0))
    m.box(-.3, .5, -.25, .4, .53, .25, 'soil')
    m.tube((.55, .5, 0), (.62, .2, 0), .02, 'iron', segments=4)
    m.tube((-.32, .4, -.18), (-.95, .72, -.28), .025, 'wood_dark', segments=6)
    m.tube((-.32, .4, .18), (-.95, .72, .28), .025, 'wood_dark', segments=6)
    m.tube((.6, .33, 0), (.6, .33, 0), .001, 'iron', segments=3)
    m.cylinder((.62, .2, -.04), .2, .08, 'rubber', segments=12, caps=(True, True))
    m.box(-.35, 0, -.22, -.3, .3, -.18, 'wood_dark')
    m.box(-.35, 0, .18, -.3, .3, .22, 'wood_dark')
    return m


def firewood_stack():
    """Stacked split logs between two posts (1.8 x 1.2 x 0.7 m)."""
    m = MeshData()
    for x in (-.88, .88):
        m.box(x - .05, 0, -.3, x + .05, 1.2, .3, 'wood_dark')
    for row in range(8):
        y = .05 + row * .14
        for k in range(9):
            off = .09 if row % 2 else 0
            x = -.78 + k * .19 + off
            if x > .8:
                continue
            m.cylinder((x, y, -.28), .075, .56, 'wood_crate', segments=6, caps=(False, False))
            m.cylinder((x, y, -.28), .075, .56, 'wood_crate', segments=6, caps=(False, False))
    return m


def sofa():
    """Three-seat fabric sofa (2.0 x 0.85 x 0.9 m), front toward -z."""
    m = MeshData()
    m.box(-1, .12, -.45, 1, .45, .45, 'cloth_blue')
    m.box(-1, .45, .22, 1, .85, .45, 'cloth_blue')
    for x0, x1 in ((-1, -.86), (.86, 1)):
        m.box(x0, .45, -.45, x1, .66, .45, 'cloth_blue')
    for x in (-.5, .5):
        m.box(x - .42, .45, -.42, x + .42, .56, .22, 'cloth_blue_light')
    for x in (-1, .86):
        m.box(x, 0, -.42, x + .14, .12, -.28, 'wood_dark')
        m.box(x, 0, .28, x + .14, .12, .42, 'wood_dark')
    return m


def bed():
    """Double bed (2.0 x 0.95 x 1.5 m): timber frame, mattress, pillows, quilt; headboard on +z."""
    m = MeshData()
    m.box(-1, .18, -.75, 1, .38, .75, 'wood_dark')
    m.box(-.96, .38, -.71, .96, .62, .71, 'cloth_tan')
    m.box(-.96, .62, -.71, .5, .66, .71, 'cloth_red')
    m.box(.55, .62, -.6, .9, .74, -.1, 'canvas_cream')
    m.box(.55, .62, .1, .9, .74, .6, 'canvas_cream')
    m.box(.96, .18, -.78, 1.04, .95, .78, 'wood_dark')
    for x in (-1, .96):
        for z in (-.75, .71):
            m.box(x, 0, z, x + .04, .18, z + .04, 'wood_dark')
    return m


def wardrobe():
    m = MeshData()
    m.box(-.6, 0, -.3, .6, 2.0, .3, 'wood_dark')
    m.box(-.57, .06, -.315, -.02, 1.94, -.3, 'wood_weathered')
    m.box(.02, .06, -.315, .57, 1.94, -.3, 'wood_weathered')
    for x in (-.08, .08):
        m.box(x - .01, .95, -.33, x + .01, 1.1, -.315, 'brass')
    m.box(-.63, 2.0, -.33, .63, 2.06, .33, 'wood_dark')
    return m


def bookshelf():
    m = MeshData()
    m.box(-.8, 0, -.18, -.76, 1.9, .18, 'wood_dark')
    m.box(.76, 0, -.18, .8, 1.9, .18, 'wood_dark')
    m.box(-.8, 1.86, -.18, .8, 1.9, .18, 'wood_dark')
    m.box(-.8, 0, .14, .8, 1.9, .18, 'wood_weathered')
    cols = ('plastic_blue', 'plastic_orange', 'plastic_green', 'cloth_red', 'cardboard')
    for r in range(5):
        y = .05 + r * .36
        m.box(-.8, y, -.18, .8, y + .03, .18, 'wood_dark')
        x = -.72
        k = 0
        while x < .68:
            w = .05 + .02 * ((k * 3 + r) % 3)
            hgt = .22 + .05 * ((k + r) % 3)
            m.box(x, y + .03, -.12, x + w, y + .03 + hgt, .12, cols[(k + r) % len(cols)])
            x += w + .004
            k += 1
    return m


def kitchen_counter():
    """Kitchen run (2.4 x 0.92 x 0.65 m): cabinets, worktop, sink and hob; front toward -z."""
    m = MeshData()
    m.box(-1.2, 0, -.3, 1.2, .1, .325, 'wood_dark')
    m.box(-1.2, .1, -.3, 1.2, .86, .325, 'wood_weathered')
    for x in (-.6, 0, .6):
        m.box(x - .28, .16, -.315, x + .28, .8, -.3, 'wood_dark')
        m.box(x - .05, .62, -.33, x + .05, .65, -.315, 'iron')
    m.box(-1.22, .86, -.34, 1.22, .92, .34, 'granite')
    m.box(-.9, .87, -.2, -.3, .875, .2, 'galvanized')
    m.tube((-.6, .92, .22), (-.6, 1.12, .22), .015, 'galvanized', segments=5)
    m.tube((-.6, 1.12, .22), (-.6, 1.12, .1), .015, 'galvanized', segments=5)
    for x in (.45, .85):
        for z in (-.08, .12):
            m.cylinder((x, .92, z), .09, .012, 'iron', segments=10)
    return m


def fridge():
    m = MeshData()
    m.box(-.4, 0, -.36, .4, 1.8, .36, 'plastic_white')
    m.box(-.4, 1.12, -.37, .4, 1.14, -.36, 'plastic_grey')
    m.box(.3, 1.2, -.395, .34, 1.7, -.36, 'aluminium')
    m.box(.3, .5, -.395, .34, 1.0, -.36, 'aluminium')
    return m


def dining_table():
    """Farmhouse table with six chairs (2.6 x 0.9 x 1.7 m); the collider covers the table only."""
    m = MeshData()
    m.box(-1.2, .72, -.5, 1.2, .78, .5, 'wood_weathered')
    for x in (-1.1, 1.1):
        for z in (-.4, .4):
            m.box(x - .05, 0, z - .05, x + .05, .72, z + .05, 'wood_dark')
    for x in (-.7, 0, .7):
        for z, f in ((-.78, 1), (.78, -1)):
            m.box(x - .2, .42, z - .2, x + .2, .46, z + .2, 'wood_dark')
            for dx in (-.18, .18):
                for dz in (-.18, .18):
                    m.box(x + dx - .02, 0, z + dz - .02, x + dx + .02, .42, z + dz + .02, 'wood_dark')
            zb = z + .2 * f
            m.box(x - .2, .46, zb - .02 if f > 0 else zb - .02, x + .2, .9, zb + .02, 'wood_dark')
    m.box(-.3, .78, -.12, .3, .8, .12, 'canvas_cream')
    return m


def feed_sacks():
    """Stack of burlap feed sacks (0.9 x 0.65 x 0.7 m)."""
    m = MeshData()
    for i, (x, y, z) in enumerate(((-.2, 0, 0), (.25, 0, .05), (0, .24, 0))):
        m.box(x - .22, y, z - .3, x + .22, y + .24, z + .3, 'burlap')
        m.sphere((x, y + .24, z - .28), .06, 'burlap', rings=3, segments=5)
    return m


def storage_shelf():
    """Heavy timber shelving for the shelter (2.0 x 1.9 x 0.5 m) loaded with jars, tins and boxes."""
    m = MeshData()
    for x in (-1, .96):
        m.box(x, 0, -.25, x + .04, 1.9, .25, 'wood_dark')
    m.box(-1, 0, .21, 1, 1.9, .25, 'wood_weathered')
    cols = ('plastic_orange', 'plastic_green', 'copper', 'cardboard', 'plastic_blue', 'paint_yellow')
    for r in range(5):
        y = .08 + r * .42
        m.box(-.98, y, -.25, .98, y + .035, .21, 'wood_weathered')
        x = -.92
        k = 0
        while x < .84:
            w = .14 + .05 * ((k + r) % 3)
            hgt = .18 + .06 * ((k * 2 + r) % 3)
            if (k + r) % 3:
                m.cylinder((x + w / 2, y + .035, -.02), w / 2, hgt, cols[(k + r) % len(cols)], segments=7)
            else:
                m.box(x, y + .035, -.2, x + w, y + .035 + hgt, .16, cols[(k + r) % len(cols)])
            x += w + .05
            k += 1
    return m


def bunk_bed():
    """Steel bunk bed (2.0 x 1.9 x 0.95 m) with thin mattresses."""
    m = MeshData()
    for x in (-1, .96):
        for z in (-.47, .43):
            m.box(x, 0, z, x + .04, 1.9, z + .04, 'steel_dark')
    for y in (.32, 1.15):
        m.box(-1, y, -.47, 1, y + .04, .47, 'steel_dark')
        m.box(-.96, y + .04, -.45, .96, y + .15, .45, 'cloth_green')
        m.box(.6, y + .15, -.3, .92, y + .22, .3, 'canvas_cream')
        for z in (-.47, .43):
            m.box(-1, y + .04, z, 1, y + .3, z + .04, 'steel_dark', skip=('px', 'nx', 'ny'))
    m.tube((-.98, 1.19, -.5), (-.98, 1.19, .5), .015, 'steel_dark', segments=4)
    m.box(.97, .32, .43, 1.0, 1.15, .47, 'steel_dark')
    return m


def tractor():
    """Small red farm tractor (2.0 x 2.4 x 3.6 m): engine hood, open cab with roll frame, big rear wheels."""
    m = MeshData()
    m.box(-.45, .6, -1.7, .45, 1.35, -.1, 'tractor_red')
    m.box(-.42, 1.35, -1.6, .42, 1.42, -.2, 'steel_dark')
    m.box(-.3, 1.42, -.85, -.22, 2.0, -.75, 'iron')
    m.box(-.45, .3, -1.75, .45, .62, 1.0, 'steel_dark')
    m.box(-.55, .85, -.05, .55, 1.0, 1.05, 'tractor_red')
    m.box(-.3, 1.0, .35, .3, 1.08, .85, 'iron_rusty')
    m.tube((.2, 1.05, .6), (.15, 1.55, .3), .02, 'iron', segments=5)
    m.cylinder((.15, 1.55, .3), .17, .04, 'rubber', segments=10)
    for sx in (-1, 1):
        for z, r, w in ((.7, .85, .5), (-1.15, .52, .3)):
            x = sx * (.9 if r > .6 else .8)
            # Wheels lie on their side: a tube along x, with a smaller hub tube proud of the tyre.
            m.tube((x - w / 2, r, z), (x + w / 2, r, z), r, 'rubber', segments=14)
            m.tube((x - w / 2 - .012, r, z), (x + w / 2 + .012, r, z), r * .52, 'tractor_hub', segments=12)
    m.tube((-.9, .85, .7), (.9, .85, .7), .06, 'iron', segments=6)
    m.tube((-.8, .52, -1.15), (.8, .52, -1.15), .05, 'iron', segments=6)
    # open roll frame over the seat
    for x in (-.55, .55):
        for z in (.2, .95):
            m.box(x - .03, 1.0, z - .03, x + .03, 2.35, z + .03, 'steel_dark')
    m.box(-.6, 2.35, .15, .6, 2.41, 1.0, 'steel_dark')
    m.box(-.35, .95, -.12, .35, 1.05, .12, 'tractor_red')
    m.tube((0, 1.42, -1.55), (0, 2.0, -1.55), .035, 'iron', segments=6)  # exhaust stack
    return m


def hedge_long():
    """A hedgerow (3.8 m long, 2.9 m tall): overlapping leaf blobs on a few trunks, so it blocks sight and movement."""
    m = MeshData()
    for i in range(8):
        x = -1.65 + i * .471
        m.cylinder((x, 0, 0), .07, .8, 'bark', segments=5, caps=(False, False))
    for i in range(8):
        x = -1.65 + i * .471
        for j, (y, r) in enumerate(((.85, .5), (1.55, .5), (2.25, .46))):
            off = .12 if (i + j) % 2 else -.12
            m.sphere((x, y, off * .6), r, 'leaves_oak' if (i + j) % 2 == 0 else 'leaves_oak_b', rings=3, segments=6, squash=1.05)
    return m


FARM_BUILDERS = {
    'hedge_long': hedge_long,
    'tree_oak': lambda: tree_oak(1.0, 0),
    'tree_oak_small': lambda: tree_oak(.74, 1),
    'tree_pine': tree_pine,
    'bush': bush,
    'hay_bale': hay_bale,
    'hay_stack': hay_stack,
    'water_trough': water_trough,
    'wheelbarrow': wheelbarrow,
    'firewood_stack': firewood_stack,
    'sofa': sofa,
    'bed': bed,
    'wardrobe': wardrobe,
    'bookshelf': bookshelf,
    'kitchen_counter': kitchen_counter,
    'fridge': fridge,
    'dining_table': dining_table,
    'feed_sacks': feed_sacks,
    'storage_shelf': storage_shelf,
    'bunk_bed': bunk_bed,
    'tractor': tractor,
}
