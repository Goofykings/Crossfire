"""Per-solid face audit of the firearm generators (plain Python):  python -B -I tools/weapon_face_classes.py [weapon ...] [-v]

The generators build every weapon from primitives (solid(), box(), tubes, spheres...). This tool records which primitive made each
face, then checks every face of every CLOSED primitive by ray parity against that primitive alone (so overlapping solids cannot confuse
the test):

  flipped   the face's outside point is inside its own solid: the face points into the solid. Under back-face culling it is invisible
            from outside, the solid renders hollow, and parts 'disappear' when the weapon is rotated. A defect.
  hidden    (informational) faces of a closed primitive lying completely inside another part's solid: internals (overlapping
            parts). Harmless unless a shader or transparency shows them; a whole PART inside another is listed as exposed internals.
  open      primitives that are not closed (panels, uncapped tubes, funnels): single-sided by design.

Exit code 1 when any face is flipped.
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'blender' / 'scripts' / 'lib'))
import meshkit  # noqa: E402
import weapon as W  # noqa: E402
from meshkit import MeshData, face_normal  # noqa: E402

EPS = 0.0003
GROUP: dict[tuple[int, int], int] = {}
state = {'depth': 0, 'next': 0}


def wrap(fn, tracks_md=True):
    def inner(*args, **kw):
        md = args[0]
        before = len(md.faces)
        top = state['depth'] == 0
        state['depth'] += 1
        try:
            return fn(*args, **kw)
        finally:
            state['depth'] -= 1
            if top:
                g = state['next']
                state['next'] += 1
                for fi in range(before, len(md.faces)):
                    GROUP[(id(md), fi)] = g
    return inner


for name in ('face', 'face_toward', 'box', 'sphere', 'cylinder', 'tube', 'prism'):
    setattr(MeshData, name, wrap(getattr(MeshData, name)))
for name in ('solid', 'box', 'ztube', 'xtube', 'ytube'):
    setattr(W, name, wrap(getattr(W, name)))


def tri_list(md, faces):
    out = []
    for fi in faces:
        pts = [md.verts[i] for i in md.faces[fi]]
        for i in range(1, len(pts) - 1):
            out.append((pts[0], pts[i], pts[i + 1]))
    return out


def boxes_of(tris):
    return [tuple((min(p[k] for p in t), max(p[k] for p in t)) for k in range(3)) for t in tris]


def crossings(p, axis, tris, boxes, jitter):
    u, v = [k for k in range(3) if k != axis]
    pu, pv = p[u] + jitter[0], p[v] + jitter[1]
    n = 0
    for t, b in zip(tris, boxes):
        if pu < b[u][0] or pu > b[u][1] or pv < b[v][0] or pv > b[v][1] or b[axis][1] < p[axis]:
            continue
        a, bb, c = t
        d = (bb[u] - a[u]) * (c[v] - a[v]) - (c[u] - a[u]) * (bb[v] - a[v])
        if abs(d) < 1e-12:
            continue
        s = ((pu - a[u]) * (c[v] - a[v]) - (c[u] - a[u]) * (pv - a[v])) / d
        r = ((bb[u] - a[u]) * (pv - a[v]) - (pu - a[u]) * (bb[v] - a[v])) / d
        if s < 0 or r < 0 or s + r > 1:
            continue
        if a[axis] + s * (bb[axis] - a[axis]) + r * (c[axis] - a[axis]) > p[axis]:
            n += 1
    return n


def inside(p, tris, boxes):
    votes = 0
    for axis, jit in ((0, (1.3e-4, 0.7e-4)), (1, (-0.9e-4, 1.1e-4)), (2, (0.5e-4, -1.2e-4))):
        votes += crossings(p, axis, tris, boxes, jit) % 2
    return votes >= 2


def key(p):
    return (round(p[0] * 1e5), round(p[1] * 1e5), round(p[2] * 1e5))


def is_closed(md, faces):
    uses = Counter()
    for fi in faces:
        f = md.faces[fi]
        for i in range(len(f)):
            a, b = key(md.verts[f[i]]), key(md.verts[f[(i + 1) % len(f)]])
            if a != b:
                uses[(min(a, b), max(a, b))] += 1
    return bool(uses) and all(c == 2 for c in uses.values())


def audit(name, verbose):
    GROUP.clear()
    state.update(depth=0, next=0)
    parts, _ = W.WEAPONS[name]()
    flipped, summary = [], Counter()
    solids = []   # (part, group, faces, tris, boxes)
    for pname, md in parts.items():
        groups = defaultdict(list)
        for fi in range(len(md.faces)):
            groups[GROUP.get((id(md), fi), -1)].append(fi)
        for g, faces in groups.items():
            closed = g >= 0 and len(faces) >= 4 and is_closed(md, faces)
            summary['closed' if closed else 'open'] += len(faces)
            if not closed:
                continue
            tris = tri_list(md, faces)
            solids.append((pname, g, md, faces, tris, boxes_of(tris)))
            bxs = solids[-1][5]
            for fi in faces:
                pts = [md.verts[i] for i in md.faces[fi]]
                n = face_normal(pts)
                c = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
                if inside((c[0] + n[0] * EPS, c[1] + n[1] * EPS, c[2] + n[2] * EPS), tris, bxs) and not inside((c[0] - n[0] * EPS, c[1] - n[1] * EPS, c[2] - n[2] * EPS), tris, bxs):
                    flipped.append((pname, fi, md.face_mat[fi], [round(x, 3) for x in c], [round(x, 2) for x in n]))
    # part-level hidden internals: share of a part's closed-solid faces inside solids of OTHER parts
    for pname, g, md, faces, tris, bxs in solids:
        others = [s for s in solids if s[0] != pname]
        hid = 0
        for fi in faces:
            pts = [md.verts[i] for i in md.faces[fi]]
            c = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
            if any(inside(tuple(c), s[4], s[5]) for s in others):
                hid += 1
        if hid == len(faces) and len(faces) >= 4:
            summary['fully hidden solids'] += 1
            print(f'   HIDDEN {name}.{pname} group {g}: {len(faces)} faces entirely inside another part ({md.face_mat[faces[0]]})')
    print(f'{name}: {dict(summary)} flipped {len(flipped)}')
    for item in flipped:
        print('   FLIPPED', item)
    return len(flipped)


if __name__ == '__main__':
    names = [a for a in sys.argv[1:] if not a.startswith('-')] or list(W.WEAPONS)
    bad = sum(audit(n, '-v' in sys.argv) for n in names)
    print('FLIPPED FACES', bad)
    sys.exit(1 if bad else 0)
