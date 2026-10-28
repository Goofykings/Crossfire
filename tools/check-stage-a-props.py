"""Check the editable prop sources, before Blender's weld/export can hide defects."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "blender/scripts/lib"))
from meshkit import face_normal
from props import well, market_stall
from materials import MATERIALS

md = well()
tops, bottoms = 0, 0
for face, material in zip(md.faces, md.face_mat):
    pts = [md.verts[i] for i in face]
    assert not (material == 'wood_dark' and all(abs(p[1] - .85) < 1e-8 for p in pts)), \
        'embedded well posts must not overlap the coping underside'
    if material != "stone_trim":
        continue
    if all(abs(p[1] - .95) < 1e-8 for p in pts):
        assert face_normal(pts)[1] > .99, "well rim must face up"
        tops += 1
    if all(abs(p[1] - .85) < 1e-8 for p in pts):
        assert face_normal(pts)[1] < -.99, "coping underside must face down"
        bottoms += 1
assert tops == bottoms == 18, "complete coping around the well"
for seed in (0, 1):
    md = market_stall(seed)
    sheets = [tuple(sorted(md.verts[i] for i in f)) for f, m in zip(md.faces, md.face_mat) if m.startswith("canvas_")]
    assert len(sheets) == len(set(sheets)) == 10, "no coincident reversed canvas faces"
    assert MATERIALS[("canvas_red", "canvas_green")[seed]]["double_sided"]
print("Prop source normals, closed rim and both double-sided canopy variants pass")
