"""Static checks for the authored underground spaces (no Blender, no browser).

Usage: python -B -I tools/check_underground.py

Checks, per passage: entrances fit their stairs; every decor item sits on a real wall, pier or block
face and none overlap; piers, blocks and props stand inside the clear floor, clear of each other and
of the walls; every authored walk is a clear polyline of at least 0.45 m radius (the body plus the
longest gun's barrel clearance is checked again by the browser-free controller test in
tests/mapOverhaul.test.ts). Exits non-zero with a list of problems.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "blender" / "scripts" / "lib"))
sys.path.insert(0, str(ROOT / "tools"))
import catalog  # noqa: E402
import underground as U  # noqa: E402
import underground_layouts as L  # noqa: E402


def rect_of_prop(p, size, collider):
    w, h, d = collider or size
    yaw = math.radians(p['heading'])
    c, s = abs(math.cos(yaw)), abs(math.sin(yaw))
    hx, hz = (w * c + d * s) / 2, (w * s + d * c) / 2
    return [p['pos'][0] - hx, p['pos'][2] - hz, p['pos'][0] + hx, p['pos'][2] + hz]


def overlaps(a, b, pad=0.0):
    return a[0] < b[2] + pad and b[0] < a[2] + pad and a[1] < b[3] + pad and b[1] < a[3] + pad


def clear_floor(p, x, z, radius):
    """True when a disc of `radius` at (x, z) is inside the segments and clear of solids."""
    inside = any(r[0] + radius <= x <= r[2] - radius and r[1] + radius <= z <= r[3] - radius for r in p['segments'])
    if not inside:
        # Allow standing in the overlap/seam of two touching rects: sample the disc rim.
        pts = [(x + math.cos(a) * radius, z + math.sin(a) * radius) for a in [k * math.pi / 8 for k in range(16)]] + [(x, z)]
        if not all(any(r[0] <= px <= r[2] and r[1] <= pz <= r[3] for r in p['segments'] + [list(e['rect']) for e in p['entrances']]) for px, pz in pts):
            return False
    for x0, z0, x1, z1, *_ in solids(p):
        nx, nz = min(max(x, x0), x1), min(max(z, z0), z1)
        if math.hypot(x - nx, z - nz) < radius:
            return False
    return True


def solids(p):
    out = []
    for x, z, size in U.pier_list(p):
        out.append([x - size / 2, z - size / 2, x + size / 2, z + size / 2, 'pier'])
    for b in U.block_list(p):
        out.append([*b['rect'], b['kind']])
    return out


def main() -> int:
    problems: list[str] = []
    for fn in (L.city_underground, L.town_underground, L.farm_underground):
        for raw in fn():
            p = U.prepare(raw)
            pid = p['id']
            # Entrances: stair geometry asserts its own lengths.
            for e in p['entrances']:
                try:
                    list(U.entrance_parts(e, p['style']))
                except AssertionError as err:
                    problems.append(f"{pid}: {err}")
            # Decor validates against the real wall edges and must not overlap.
            try:
                U.decor_quads(p)
            except (ValueError, AssertionError) as err:
                problems.append(f"{pid}: {err}")
            else:
                for a, b in U.decor_items_overlap(p):
                    problems.append(f"{pid}: decor overlaps: {a} / {b}")
            # Wall lamps (cellar) must not sit in front of wall art.
            for (lx, ly, lz), facing in U.lamp_positions(p):
                if facing == 'd':
                    continue
                nx, nz = {'n': (0, -1), 's': (0, 1), 'w': (-1, 0), 'e': (1, 0)}[facing]
                for pts, normal, item in U.decor_quads(p):
                    if (normal[0], normal[2]) != (nx, nz) or item.get('kind') == 'door':
                        continue
                    along = lx if nx == 0 else lz
                    cx = sum(q[0] if nx == 0 else q[2] for q in pts) / 4
                    plane = abs((lz if nx == 0 else lx) - (pts[0][2] if nx == 0 else pts[0][0]))
                    if plane < .4 and abs(along - cx) < item['w'] / 2 + .2 and min(q[1] for q in pts) < ly + .4 and max(q[1] for q in pts) > ly - .1:
                        problems.append(f"{pid}: lamp at {lx:.1f},{lz:.1f} is in front of decor {item.get('cell')} ({item.get('art')})")
            # Piers and blocks inside the floor and apart from each other.
            sol = solids(p)
            for i, a in enumerate(sol):
                if not any(r[0] - 1e-6 <= a[0] and a[2] <= r[2] + 1e-6 and r[1] - 1e-6 <= a[1] and a[3] <= r[3] + 1e-6 for r in p['segments']):
                    problems.append(f"{pid}: {a[4]} {a[:4]} leaves the clear floor")
                for b in sol[i + 1:]:
                    if overlaps(a, b):
                        problems.append(f"{pid}: {a[4]} and {b[4]} overlap")
            # Props.
            layout = {'underground': [p]}
            props = L.underground_props(layout, catalog.PROPS)
            rects = []
            for q in props:
                meta = catalog.PROPS[q['type']]
                r = rect_of_prop(q, meta['size'], meta['collider'])
                rects.append((q, r, meta['collider'] is not None))
                if not any(s[0] - 1e-6 <= r[0] and r[2] <= s[2] + 1e-6 and s[1] - 1e-6 <= r[1] and r[3] <= s[3] + 1e-6 for s in p['segments']):
                    problems.append(f"{pid}: prop {q['type']} at {q['pos']} leaves the floor ({[round(v, 2) for v in r]})")
                for s in sol:
                    if meta['collider'] and overlaps(r, s[:4]):
                        problems.append(f"{pid}: prop {q['type']} at {q['pos']} overlaps a {s[4]}")
            for i, (qa, ra, ca) in enumerate(rects):
                for qb, rb, cb in rects[i + 1:]:
                    if ca and cb and overlaps(ra, rb):
                        problems.append(f"{pid}: props {qa['type']} {qa['pos']} and {qb['type']} {qb['pos']} overlap")
            # Walks: the main route and each branch need a 0.45 m clear corridor.
            routes = [[pt for pt in p.get('route', [])]] + list(p.get('walks', []))
            for walk in routes:
                for (x0, z0), (x1, z1) in zip(walk, walk[1:]):
                    n = max(2, int(math.hypot(x1 - x0, z1 - z0) / .1))
                    for k in range(n + 1):
                        x, z = x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n
                        if not clear_floor(p, x, z, .42):
                            problems.append(f"{pid}: walk {walk[0]}..{walk[-1]} blocked near {x:.2f},{z:.2f}")
                            break
                    else:
                        continue
                    break
            for q, r, solid in rects:
                if solid:
                    for walk in routes:
                        for (x0, z0), (x1, z1) in zip(walk, walk[1:]):
                            n = max(2, int(math.hypot(x1 - x0, z1 - z0) / .1))
                            for k in range(n + 1):
                                x, z = x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n
                                nx, nz = min(max(x, r[0]), r[2]), min(max(z, r[1]), r[3])
                                if math.hypot(x - nx, z - nz) < .42:
                                    problems.append(f"{pid}: prop {q['type']} at {q['pos']} blocks a walk near {x:.2f},{z:.2f}")
                                    break
            area = sum((r[2] - r[0]) * (r[3] - r[1]) for r in p['segments'])
            print(f"{pid}: {len(p['segments'])} segments {area:.0f} m2, floor {p['floor']} m, clear {U.CEIL - p['floor']:.1f} m, "
                  f"{len(p.get('piers', []))} piers, {len(p.get('blocks', []))} blocks, {len(p.get('decor', []))} decor, {len(props)} props")
    for line in problems:
        print("PROBLEM", line)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
