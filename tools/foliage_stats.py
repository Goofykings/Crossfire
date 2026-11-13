"""Development helper: extents and triangle counts of the foliage props (plain Python, no Blender)."""
import sys
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'blender' / 'scripts' / 'lib'))
import props_farm as pf

for n, b in pf.FARM_BUILDERS.items():
    if n.startswith('hedge') or n.startswith('tree') or n == 'bush':
        md = b()
        xs = [v[0] for v in md.verts]
        ys = [v[1] for v in md.verts]
        zs = [v[2] for v in md.verts]
        mats = {}
        for m, f in zip(md.face_mat, md.faces):
            mats[m] = mats.get(m, 0) + len(f) - 2
        print(f"{n:14s} x {min(xs):.2f}..{max(xs):.2f}  y {min(ys):.2f}..{max(ys):.2f}  z {min(zs):.2f}..{max(zs):.2f}  tris", mats)
