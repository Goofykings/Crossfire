"""Tileable old stone-wall textures for the Farmstead perimeter wall (material `stone_wall_old`).

Runs in Blender's bundled Python (numpy is available there, not in system Python):
  blender -b --factory-startup --python-expr "import sys; sys.dont_write_bytecode=True" -P blender/scripts/make_stone_textures.py

Writes public/assets/textures/farmstead/stone_wall_{albedo,normal,orm}.jpg (1024 px, one repeat = 2.4 m, so a
course is 8 to 14 cm tall in the image's 427 px per metre and stones are 25 to 75 cm long). Everything wraps:
the courses sum exactly to the tile, each course's stone lengths sum exactly to the tile width, and every noise
field is periodic. Layout: irregular courses of irregular blocks with wobbling joints, chipped corners, dark
recessed mortar, a few cracks, lichen blotches, moss gathering in the joints, and vertical rain streaks.
ORM: occlusion in red (deep joints), roughness in green, metallic 0 in blue.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/textures/farmstead'
N = 1024
M_PER_TILE = 2.4
PX = N / M_PER_TILE


def save(name: str, rgb: np.ndarray, quality: int = 92) -> None:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    img = bpy.data.images.new(path.stem, N, N, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((N, N, 4), np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px[::-1].ravel())     # Blender rows run bottom-up
    img.filepath_raw = str(path)
    img.file_format = 'JPEG'
    img.save(filepath=str(path), quality=quality)
    bpy.data.images.remove(img)
    print('wrote', path.relative_to(ROOT), flush=True)


def noise(scale: float, seed: int, ax: float = 1.0, ay: float = 1.0) -> np.ndarray:
    """Periodic band-limited noise in 0..1; `scale` is the feature size in cycles per tile, ax/ay stretch it."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((N, N)))
    ky = np.fft.fftfreq(N)[:, None] * N
    kx = np.fft.fftfreq(N)[None, :] * N
    k = np.sqrt((kx / ax) ** 2 + (ky / ay) ** 2)
    g = np.real(np.fft.ifft2(f * np.exp(-(k / scale) ** 2)))
    g -= g.min()
    return g / g.max()


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def layout(rng: np.random.Generator):
    """Courses (y bounds) and, per course, the stone x bounds and a row offset, all summing exactly to the tile."""
    h = rng.uniform(.16, .4, 40)
    cum = np.cumsum(h)
    k = int(np.searchsorted(cum, M_PER_TILE) + 1)
    h = h[:k] * M_PER_TILE / h[:k].sum() * PX
    y_edges = np.concatenate([[0], np.cumsum(h)])
    courses = []
    for c in range(k):
        lens = rng.uniform(.2, .95, 40)
        n = int(np.searchsorted(np.cumsum(lens), M_PER_TILE) + 1)
        lens = lens[:n] * M_PER_TILE / lens[:n].sum() * PX
        courses.append((np.concatenate([[0], np.cumsum(lens)]), rng.uniform(0, N)))
    return y_edges, courses


def build() -> None:
    rng = np.random.default_rng(2611)
    y_edges, courses = layout(rng)
    iy, ix = np.mgrid[0:N, 0:N].astype(np.float32)
    # Wobbling joints: warp the sampling coordinates with two periodic noise fields.
    wx = (noise(7, 11) - .5) * 26 + (noise(24, 12) - .5) * 7
    wy = (noise(7, 13) - .5) * 20 + (noise(24, 14) - .5) * 6
    X, Y = (ix + wx) % N, (iy + wy) % N
    course = np.clip(np.searchsorted(y_edges, Y, 'right') - 1, 0, len(courses) - 1)
    edge = np.zeros((N, N), np.float32)           # distance to the stone's border (px), rounded corners
    stone_id = np.zeros((N, N), np.int32)
    lu = np.zeros((N, N), np.float32)             # position inside the stone, 0..1
    lv = np.zeros((N, N), np.float32)
    sid = 0
    stone_w, stone_h = [], []
    for c, (xe, off) in enumerate(courses):
        rows = course == c
        v = Y[rows] - y_edges[c]
        hh = y_edges[c + 1] - y_edges[c]
        xs = (X[rows] - off) % N
        s = np.clip(np.searchsorted(xe, xs, 'right') - 1, 0, len(xe) - 2)
        u = xs - xe[s]
        ln = (xe[1:] - xe[:-1])[s]
        dx = np.minimum(u, ln - u)
        dy = np.minimum(v, hh - v)
        r = 20.0                                   # corner radius (px)
        cx, cy = np.maximum(r - dx, 0), np.maximum(r - dy, 0)
        d = np.where((dx < r) & (dy < r), r - np.hypot(cx, cy), np.minimum(dx, dy))
        edge[rows] = d
        stone_id[rows] = sid + s
        lu[rows] = u / ln
        lv[rows] = v / hh
        stone_w += list(xe[1:] - xe[:-1])
        stone_h += [hh] * (len(xe) - 1)
        sid += len(xe) - 1
    stone_w, stone_h = np.array(stone_w), np.array(stone_h)
    # Per-stone random values (colour family, brightness, height offset, chip phase).
    per = np.random.default_rng(77).random((sid, 8)).astype(np.float32)
    P = lambda k: per[stone_id, k]
    # --- heights ---------------------------------------------------------------------------------------
    chip = (noise(60, 21) - .5) * 14 + (noise(150, 22) - .5) * 5      # ragged edges
    big_chip = np.maximum(noise(36, 23) - .74, 0) * 90                # a few large bites out of corners
    width = 5.0 + 4.0 * P(0) + chip * .8 - big_chip * (edge < 34)
    mortar = edge < width
    face = smooth(width, width + 20, edge)                            # bevel from mortar to stone face
    pit = (noise(180, 24) - .5) * .16 + (noise(48, 25) - .5) * .3     # weathering pits and swells
    height = (.62 + .3 * face) * (1 + .0 * face) + (P(1) - .5) * .08 * face + pit * face
    height[mortar] = .2 + (noise(300, 26)[mortar] - .5) * .1
    # --- cracks: thin dark meandering lines starting at stone corners ---------------------------------------
    cracks = np.zeros((N, N), np.float32)
    crng = np.random.default_rng(404)
    for _ in range(12):
        s = int(crng.integers(0, sid))
        # start somewhere on that stone: sample a random pixel of it
        ys_, xs_ = np.nonzero(stone_id == s)
        if not len(ys_):
            continue
        k = int(crng.integers(0, len(ys_)))
        y, x = float(ys_[k]), float(xs_[k])
        ang = crng.uniform(0, 2 * np.pi)
        for step in range(int(crng.uniform(70, 190))):
            ang += crng.normal(0, .14)
            x, y = x + np.cos(ang) * 1.6, y + np.sin(ang) * 1.6
            xi, yi = int(x) % N, int(y) % N
            w = 1 if step % 7 else 2
            cracks[(np.arange(yi - w, yi + w + 1)[:, None] % N), (np.arange(xi - w, xi + w + 1)[None, :] % N)] = 1.0
    cracks = np.clip(cracks * (~mortar), 0, 1)
    height -= cracks * .22
    # --- colour ---------------------------------------------------------------------------------------------
    fam = np.array([(146, 141, 132), (132, 132, 130), (152, 142, 124), (122, 118, 112), (140, 128, 112), (120, 124, 121)], np.float32) / 255
    base = fam[(P(2) * len(fam)).astype(int) % len(fam)]
    mottle = (noise(14, 31) - .5) * .3 + (noise(52, 32) - .5) * .2 + (noise(220, 33) - .5) * .14 + (noise(420, 47) - .5) * .12
    stone = base * (.82 + (P(3) - .5) * .34 + mottle)[..., None]
    stone *= (.88 + .12 * face)[..., None]                            # edges a little darker (grime, shade)
    # rust and tan staining along streaks
    streak = noise(60, 34, ax=.12, ay=1.0)
    stone *= (1 - .3 * smooth(.56, .9, streak))[..., None]
    stone = stone * (1 - .12 * smooth(.66, .88, noise(9, 35)))[..., None] + np.array([.08, .05, .02]) * smooth(.62, .85, noise(11, 36))[..., None] * .5
    # lichen: pale grey-green rosettes on some stones
    lichen = smooth(.7, .8, noise(120, 37) + (P(4) > .7) * .1) * face
    stone = stone * (1 - lichen[..., None] * .4) + np.array([.66, .68, .56]) * lichen[..., None] * .4
    mortar_col = np.array([.2, .185, .165]) * (.8 + .4 * noise(200, 38))[..., None]
    albedo = np.where(mortar[..., None], mortar_col, stone)
    # moss: gathers in the joints and on the rough lower-left shoulders, with a soft fringe on the stone faces
    near_joint = smooth(width + 30, width, edge)
    moss_field = smooth(.56, .7, noise(10, 41) * .75 + noise(46, 42) * .25)
    moss = np.clip(near_joint * moss_field * 1.1 + moss_field * .16 * face, 0, 1) * (.4 + .6 * noise(120, 43))
    moss_col = np.array([.17, .26, .09])[None, None] * (.7 + .6 * noise(160, 44))[..., None] + np.array([.04, .05, .0]) * smooth(.7, .9, noise(30, 45))[..., None]
    albedo = albedo * (1 - moss[..., None] * .75) + moss_col * moss[..., None] * .75
    albedo *= (1 - cracks[..., None] * .85)
    albedo = albedo * (.93 + .07 * noise(500, 46))[..., None]
    # --- normal ---------------------------------------------------------------------------------------------
    h = height + moss * .05
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5
    nrm = np.stack([-gx * 14, gy * 14, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    # --- occlusion, roughness ------------------------------------------------------------------------------
    ao = np.clip(.45 + .55 * smooth(0, width + 26, edge), 0, 1) * (1 - cracks * .4)
    rough = np.clip(.88 + (noise(90, 51) - .5) * .12 + moss * .1 - face * .04, 0, 1)
    save('stone_wall_albedo.jpg', np.clip(albedo, 0, 1))
    save('stone_wall_normal.jpg', nrm * .5 + .5)
    save('stone_wall_orm.jpg', np.stack([ao, rough, np.zeros_like(ao)], -1))
    print(f'{len(courses)} courses, {sid} stones, mean stone {stone_w.mean() / PX * 100:.0f} x {stone_h.mean() / PX * 100:.0f} cm', flush=True)


if __name__ == '__main__':
    build()
