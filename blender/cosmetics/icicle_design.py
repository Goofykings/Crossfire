"""Decorative icicles of the Frosted skin, derived from each gun's own geometry.

Plain Python (no bpy, no numpy):  python -B -I blender/cosmetics/icicle_design.py

The Frosted shader paints snow above a per-weapon height (FROST_LINE in shared/cosmetics.ts, read from there so
the two cannot disagree). Icicles hang from that snow edge down the gun's side faces, toward the middle of the face,
leaning slightly outward so they read in profile. Only the static `body` part gets them: nothing rides on the
magazine, pump or bolt, so reload animations are untouched. They stay below the snow line, which is below every
sight line, and keep clear of the ejection port and the hands.

Output: public/assets/cosmetics/skins/frosted/icicles-<weapon>.json, built into one small mesh per weapon at runtime
by src/rendering/Icicles.ts (visual only: no collision, no gameplay).
  {"version": 1, "weapon": id, "line": metres, "icicles": [[x, y, z, dx, dy, dz, length, radius], ...]}
Positions are in gun space (metres, +y up, barrel toward -z); (dx, dy, dz) is the unit direction from root to tip.
"""
from __future__ import annotations

import json
import math
import random
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'blender/scripts/lib'))
import weapon as weapon_lib  # noqa: E402
from meshkit import face_normal  # noqa: E402

OUT = ROOT / 'public/assets/cosmetics/skins/frosted'
# Materials that take the ice finish (shared/cosmetics.ts: body finish plus its default-colour aliases).
ICE = {'gun_black', 'gun_fde', 'gun_wood', 'gun_gold', 'gun_white', 'gun_green'}
MAX_ICICLES = 34


def frost_lines() -> dict[str, float]:
    text = (ROOT / 'shared/cosmetics.ts').read_text(encoding='utf8')
    body = re.search(r'FROST_LINE:Record<WeaponId,number>\s*=\s*\{([^}]*)\}', text).group(1)
    return {k.replace('-', '_'): float(v) for k, v in re.findall(r"'?([\w-]+)'?\s*:\s*([\d.]+)", body)}


def spans(md, line: float):
    """Side faces (normal along +-x) of the ice materials that the snow line crosses: (x, side, z0, z1, floor)."""
    out = []
    for face, mat in zip(md.faces, md.face_mat):
        if mat not in ICE:
            continue
        pts = [md.verts[i] for i in face]
        n = face_normal(pts)
        if abs(n[0]) < 0.9:
            continue
        cross = []
        for a, b in zip(pts, pts[1:] + pts[:1]):
            if (a[1] - line) * (b[1] - line) < 0:
                t = (line - a[1]) / (b[1] - a[1])
                cross.append(a[2] + (b[2] - a[2]) * t)
        if len(cross) != 2:
            continue
        z0, z1 = sorted(cross)
        floor = min(p[1] for p in pts)
        if z1 - z0 < 0.03 or line - floor < 0.012:
            continue
        out.append((sum(p[0] for p in pts) / len(pts), 1 if n[0] > 0 else -1, z0, z1, floor))
    return out


def design(wid: str, line: float) -> list[list[float]]:
    parts, anchors = weapon_lib.WEAPONS[wid]()
    rng = random.Random(f'frosted:{wid}')
    keep_out = [(anchors[k], r) for k, r in (('eject', 0.045), ('grip_r', 0.05), ('grip_l', 0.06), ('port', 0.05)) if k in anchors]
    icicles: list[list[float]] = []
    for x, side, z0, z1, floor in sorted(spans(parts['body'], line)):
        z = z0 + rng.uniform(0.004, 0.02)
        while z < z1 - 0.004:
            room = line - floor
            # Irregular: clusters and gaps, long and short neighbours.
            length = min(rng.choice([0.008, 0.011, 0.014, 0.018, 0.023]) * rng.uniform(0.85, 1.15), room * 1.25)
            root = (x + side * 0.0004, line + 0.005, z)
            clear = all(math.dist(root, c) > r for c, r in keep_out)
            if clear and rng.random() < 0.8:
                # Mostly straight down the face (toward its middle); a few lean along the barrel.
                lean_z = rng.gauss(0, 0.12) if rng.random() < 0.8 else rng.choice([-1, 1]) * rng.uniform(0.25, 0.45)
                d = (side * rng.uniform(0.1, 0.24), -1.0, lean_z)
                k = math.sqrt(sum(c * c for c in d))
                radius = min(0.0036, 0.0019 + length * 0.055) * rng.uniform(0.9, 1.15)
                icicles.append([*root, *(c / k for c in d), length + 0.005, radius])
            z += rng.uniform(0.012, 0.03) if rng.random() < 0.75 else rng.uniform(0.04, 0.075)
    if len(icicles) > MAX_ICICLES:   # keep an even, deterministic subset
        step = len(icicles) / MAX_ICICLES
        icicles = [icicles[int(i * step)] for i in range(MAX_ICICLES)]
    return [[round(v, 4) for v in i] for i in icicles]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for wid, line in frost_lines().items():
        icicles = design(wid, line)
        path = OUT / f'icicles-{wid}.json'
        path.write_text(json.dumps({'version': 1, 'weapon': wid.replace('_', '-'), 'line': line, 'icicles': icicles},
                                   separators=(',', ':')) + '\n', encoding='utf8')
        print(f'{path.relative_to(ROOT)}: {len(icicles)} icicles, lengths '
              f'{min(i[6] for i in icicles) * 1000:.0f}-{max(i[6] for i in icicles) * 1000:.0f} mm')


if __name__ == '__main__':
    main()
