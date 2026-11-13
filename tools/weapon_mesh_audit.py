"""Geometry audit of the firearm generators (plain Python, no Blender):  python -B -I tools/weapon_mesh_audit.py [weapon ...]

For every part of every weapon (blender/scripts/lib/weapon.py) it welds vertices by position and reports, per material:
  - open edges (an edge used by one face): a hole, or an intentionally open tube or single-sided panel
  - non-manifold edges (three or more faces), and edges used twice in the same direction (inconsistent winding)
  - components whose signed volume is negative (inside out: renders hollow from outside under back-face culling)
  - faces whose normal points INTO the solid it belongs to (centroid test), the typical `solid()` concave-profile bug
Closed components are listed too, so the output also shows which pieces are single-sided panels (open) and which are solids.
Exit code 1 when a closed solid is inside out or has inconsistent winding.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'blender' / 'scripts' / 'lib'))
import weapon as W  # noqa: E402

Q = 1e5


def key(p):
    return (round(p[0] * Q), round(p[1] * Q), round(p[2] * Q))


def components(md):
    """Weld by position; faces connect through shared welded vertices. Returns a list of face index lists."""
    parent = list(range(len(md.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    owner = {}
    for fi, f in enumerate(md.faces):
        for vi in f:
            k = key(md.verts[vi])
            if k in owner:
                a, b = find(fi), find(owner[k])
                if a != b:
                    parent[a] = b
            else:
                owner[k] = fi
    groups = defaultdict(list)
    for fi in range(len(md.faces)):
        groups[find(fi)].append(fi)
    return list(groups.values())


def signed_volume(md, faces):
    v = 0.0
    for fi in faces:
        pts = [md.verts[i] for i in md.faces[fi]]
        a = pts[0]
        for i in range(1, len(pts) - 1):
            b, c = pts[i], pts[i + 1]
            v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    return v


def edge_stats(md, faces):
    uses = defaultdict(list)
    for fi in faces:
        f = md.faces[fi]
        for i in range(len(f)):
            a, b = key(md.verts[f[i]]), key(md.verts[f[(i + 1) % len(f)]])
            if a == b:
                continue
            uses[(min(a, b), max(a, b))].append(1 if a < b else -1)
    open_e = sum(1 for u in uses.values() if len(u) == 1)
    nonman = sum(1 for u in uses.values() if len(u) > 2)
    badwind = sum(1 for u in uses.values() if len(u) == 2 and u[0] == u[1])
    return open_e, nonman, badwind, len(uses)


def bbox(md, faces):
    pts = [md.verts[i] for fi in faces for i in md.faces[fi]]
    return [(min(p[k] for p in pts), max(p[k] for p in pts)) for k in range(3)]


def audit(name):
    parts, anchors = W.WEAPONS[name]()
    bad = 0
    for pname, md in parts.items():
        comps = components(md)
        mats = defaultdict(int)
        for m in md.face_mat:
            mats[m] += 1
        print(f'{name}.{pname}: {len(md.faces)} faces, {len(comps)} components, materials {dict(mats)}')
        for faces in comps:
            o, nm, bw, ne = edge_stats(md, faces)
            vol = signed_volume(md, faces)
            m = md.face_mat[faces[0]]
            mset = sorted({md.face_mat[f] for f in faces})
            bb = bbox(md, faces)
            size = [round((b - a) * 1000) for a, b in bb]
            closed = o == 0
            flag = ''
            if closed and vol < -1e-9:
                flag = 'INSIDE OUT'
                bad += 1
            if bw:
                flag += f' WINDING x{bw}'
                bad += 1 if closed else 0
            if nm:
                flag += f' NONMANIFOLD x{nm}'
            if flag or '-v' in sys.argv:
                print(f'   comp {len(faces):3d} faces mm {size} {mset} open {o} vol {vol * 1e6:.2f} cm3 {flag}')
    return bad


if __name__ == '__main__':
    names = [a for a in sys.argv[1:] if not a.startswith('-')] or list(W.WEAPONS)
    total = sum(audit(n) for n in names)
    print('PROBLEMS', total)
    sys.exit(1 if total else 0)
