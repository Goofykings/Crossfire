"""Check the actual mount mesh does not run through the suspended sign face."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'blender/scripts/lib'))
import kit
mount=kit.hanging_sign(0,board=False)
crossings=[p for p in mount.verts if -.9<p[2]<-.16 and abs(p[0])<.026 and p[1]<-.081]
assert not crossings, f'Bracket crosses the hanging board: {crossings[:3]}'
print('sign bracket clearance pass')
