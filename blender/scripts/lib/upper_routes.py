"""Shared visible/physical parts of the compact maps' two-ended upper routes.

Pure Python: the terrain exporter and server collision exporter consume exactly
the same boxes. Stairs occupy the ends of rect; the middle is a suspended floor.
"""
from __future__ import annotations


def deck_rect(route):
    r = list(route["rect"])
    for st in route["stairs"]:
        depth = st["steps"] * st["run"]
        edge = {"w": 0, "n": 1, "e": 2, "s": 3}[st["side"]]
        r[edge] += depth if edge < 2 else -depth
    assert r[2] > r[0] and r[3] > r[1], "stairs consume upper floor"
    return r


def route_parts(route):
    """Yield (box [xmin,ymin,zmin,xmax,ymax,zmax], material, part)."""
    # Local import avoids a dependency cycle with the collision exporter.
    from collision_gen import stair_rects
    h = route["height"]
    x0, z0, x1, z1 = deck_rect(route)
    metal = route["style"] == "catwalk"
    city = route['style'] == 'sky_passage'
    floor = "metal_plate" if metal else "concrete_floor" if city else "slabs"
    trim = "steel_yellow" if metal else "aluminium" if city else "stone_trim"
    for st, k, r, top in stair_rects(route):
        yield [r[0], -0.05, r[1], r[2], top, r[3]], floor, "step"
    yield [x0, h - .22, z0, x1, h, z1], floor, "deck"
    # Side rails / windowed gallery walls. The ends stay completely open.
    along_z = z1 - z0 >= x1 - x0
    length = z1 - z0 if along_z else x1 - x0
    for edge in (x0 + .025, x1 - .145) if along_z else (z0 + .025, z1 - .145):
        def strip(lo, hi, bottom, top, post=False):
            a,b=(edge-.03,edge+.15) if post else (edge,edge+.12)
            return [a, bottom, lo, b, top, hi] if along_z else [lo, bottom, a, hi, top, b]
        start = z0 if along_z else x0
        # Keep the underpass open; posts are at the deck's perimeter.
        for k in range(int(length / 2) + 1):
            t = start + .015 + (length - .15) * k / max(1, int(length / 2))
            yield strip(t, t + .12, 0, h + (1.12 if metal else 2.58), True), trim, "post"
        if metal:
            for dy in (.45, 1):
                yield strip(start, start + length, h + dy, h + dy + .06), trim, "rail"
        else:
            yield strip(start, start + length, h, h + .9), "concrete_smooth_light" if city else "plaster_worn", "wall"
            yield strip(start, start + length, h + 2.25, h + 2.5), trim if city else "wood_dark", "lintel"
    if not metal:
        # A shallow roof, 2.5 m above the floor, with no coplanar layers.
        yield [x0 - .2, h + 2.5, z0 - .2, x1 + .2, h + 2.72, z1 + .2], "roof_tiles" if route["style"] == "gallery" else "concrete_floor", "roof"


def make_route(name, rect, style, height=2.8):
    x0, z0, x1, z1 = rect
    vertical = z1 - z0 > x1 - x0
    a, b = (x0, x1) if vertical else (z0, z1)
    return {"id": name, "rect": rect, "height": height, "style": style,
            "stairs": [{"side": side, "from": a, "to": b, "steps": 16,
                        "rise": height / 16, "run": .32}
                       for side in (("n", "s") if vertical else ("w", "e"))]}
