"""Tileable textures for the skin collections, the Rich kill effect and the default shotgun walnut.

Runs in Blender's bundled Python (numpy is available there, not in system Python):
blender -b --factory-startup --python-expr "import sys; sys.dont_write_bytecode=True" -P blender/cosmetics/skin_textures.py

Weapon UVs are authored in metres, so every map repeats seamlessly; shared/cosmetics.ts
sets metres per repeat (`tile`). Albedo is sRGB JPEG. ORM is linear PNG: occlusion R,
roughness G, metallic B (the catalog's metallic/roughness factors stay 1).
"""
from __future__ import annotations
from pathlib import Path
import colorsys
import numpy as np
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/cosmetics/skins'


def save(name: str, rgb: np.ndarray, quality: int = 90, root: Path | None = None) -> None:
    """rgb: HxWx3 floats in 0..1, stored as-is (no colour transform)."""
    path = (root or OUT) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(path.stem, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px[::-1].ravel())  # Blender rows run bottom-up.
    img.filepath_raw = str(path)
    img.file_format = 'JPEG' if path.suffix == '.jpg' else 'PNG'
    if img.file_format == 'JPEG':
        img.save(filepath=str(path), quality=quality)
    else:
        img.save(filepath=str(path))
    bpy.data.images.remove(img)
    print('wrote', path.relative_to(ROOT), w, 'x', h, flush=True)


def noise(n: int, scale: float, seed: int, aspect: float = 1.0) -> np.ndarray:
    """Periodic band-limited noise in 0..1. `scale` ~ feature size in repeats^-1."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((n, n)))
    ky = np.fft.fftfreq(n)[:, None] * n
    kx = np.fft.fftfreq(n)[None, :] * n
    k = np.sqrt((kx / aspect) ** 2 + (ky * aspect) ** 2)
    g = np.real(np.fft.ifft2(f * np.exp(-(k / scale) ** 2)))
    g -= g.min()
    return g / g.max()


def rgb(*c: int) -> np.ndarray:
    return np.array(c, np.float32) / 255


def orm(rough: np.ndarray, metal: np.ndarray | float = 0.0, ao: np.ndarray | float = 1.0) -> np.ndarray:
    shape = rough.shape
    return np.stack([np.broadcast_to(ao, shape), rough, np.broadcast_to(metal, shape)], -1)


def layers(base: np.ndarray, masks: list[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
    out = np.broadcast_to(base, masks[0][0].shape + (3,)).copy()
    for mask, colour in masks:
        out[mask] = colour
    return out


def grain(n: int, seed: int, amount: float) -> np.ndarray:
    return (noise(n, 90, seed) - .5)[..., None] * amount


# --- Camo -------------------------------------------------------------------
def camo() -> None:
    n = 512
    # Green: classic woodland blobs (olive base, brown, forest green, black branches).
    a, b, c = noise(n, 5, 1), noise(n, 6, 2), noise(n, 9, 3, aspect=1.8)
    green = layers(rgb(104, 114, 66), [(a > .56, rgb(96, 72, 44)), (b > .58, rgb(46, 68, 36)), (c > .66, rgb(26, 28, 22))])
    green += grain(n, 4, .05)
    save('green-camo/albedo.jpg', green)
    save('green-camo/orm.png', orm(.72 + (a > .56) * .04 - (c > .66) * .06))
    # Blue: digital/urban pixels quantized to 16 px cells (32 blocks per repeat).
    q = lambda m: np.repeat(np.repeat(m[::16, ::16], 16, 0), 16, 1)
    a, b, c = q(noise(n, 5, 11)), q(noise(n, 7, 12)), q(noise(n, 10, 13))
    blue = layers(rgb(70, 98, 138), [(a > .55, rgb(32, 46, 82)), (b > .6, rgb(150, 174, 204)), (c > .64, rgb(42, 50, 64))])
    blue += grain(n, 14, .035)
    save('blue-camo/albedo.jpg', blue)
    save('blue-camo/orm.png', orm(.66 + (b > .6) * .06 + np.zeros((n, n))))
    # Red: tiger stripes - strongly anisotropic noise gives long horizontal strokes.
    a, b, c = noise(n, 6, 21, aspect=2.4), noise(n, 8, 22, aspect=2.8), noise(n, 4, 23)
    red = layers(rgb(168, 38, 40), [(c > .58, rgb(212, 96, 80)), (a > .58, rgb(86, 16, 22)), (b > .63, rgb(24, 18, 18))])
    red += grain(n, 24, .04)
    save('red-camo/albedo.jpg', red)
    save('red-camo/orm.png', orm(.68 + (b > .63) * .08 + np.zeros((n, n))))


# --- Marble -----------------------------------------------------------------
def vein(field: np.ndarray, width: float) -> np.ndarray:
    """Ridged noise: thin, branching lines along the field's median crossing."""
    c = field - np.median(field)
    return np.exp(-np.abs(c) / (width * c.std()))


def soften(field: np.ndarray, radius: float) -> np.ndarray:
    """Periodic Gaussian blur (radius in pixels)."""
    n = field.shape[0]
    f = np.sqrt(np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2) * n
    return np.real(np.fft.ifft2(np.fft.fft2(field) * np.exp(-(f * radius / n * np.pi) ** 2)))


def marble() -> None:
    # The previous sine bands read as map contour lines. Real marble is a few bold veins
    # running roughly one way, finer branching cracks and soft grey clouding. Stretched
    # (anisotropic) noise keeps the ridged veins long instead of closing into loops.
    n = 512
    iy, ix = np.mgrid[0:n, 0:n]
    shear = lambda f: f[iy, (ix + iy) % n]  # periodic shear: long veins run diagonally
    main = shear(vein(noise(n, 1.8, 31, aspect=1.7) + noise(n, 8, 35) * .22, .085))
    fine = vein(noise(n, 7, 33, aspect=1.3) + noise(n, 20, 37) * .2, .04)
    halo = soften(main, 9)
    v = np.clip(soften(main, 1.2) * .9 + halo * .5 + soften(fine, .8) * .45 * noise(n, 3, 36), 0, 1)[..., None]
    cloud = (noise(n, 4, 34) - .5)[..., None]
    paper = rgb(226, 224, 220) + cloud * .16 - (noise(n, 12, 38) - .5)[..., None] * .04
    white = paper - v * (paper - rgb(78, 80, 90))
    black = rgb(22, 22, 26) + cloud * .06 + v * (rgb(222, 212, 196) - rgb(22, 22, 26))
    save('marble/white-albedo.jpg', white)
    save('marble/black-albedo.jpg', black)
    save('marble/orm.png', orm(.12 + v[..., 0] * .2 + (cloud[..., 0] + .5) * .06))


# --- Rainbow glow -----------------------------------------------------------
def rainbow() -> None:
    n = 512
    y, x = np.mgrid[0:n, 0:n] / n
    h = x + y * 0 + (noise(n, 3, 41) - .5) * .18
    lut = np.linspace(0, 1, 256)
    table = np.stack([colorsys.hsv_to_rgb(t, 1, 1) for t in lut])
    sample = lambda t, s, v: (1 - s + s * table[(np.floor((t % 1) * 255)).astype(int)]) * v
    base = sample(h, .82, .62)
    # Circuit traces: grid lines on a random subset of cells, plus pads at junctions.
    cells = 8
    cx, cy = (x * cells) % 1, (y * cells) % 1
    ix, iy = (x * cells).astype(int), (y * cells).astype(int)
    rng = np.random.default_rng(42)
    horiz, vert = rng.random((cells, cells)) > .45, rng.random((cells, cells)) > .5
    w = .045
    line = ((cy < w) & horiz[iy, ix]) | ((cx < w) & vert[iy, ix])
    pad = ((cx - .02) ** 2 + (cy - .02) ** 2) < .012
    glow = (line | pad).astype(np.float32)
    # Soft halo around traces so the emissive reads as light, not a hard stripe.
    k = np.fft.fft2(glow) * np.exp(-(np.sqrt(np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2) * n / 60) ** 2)
    halo = np.clip(np.real(np.fft.ifft2(k)) * 2.2, 0, 1)
    intensity = np.clip(glow + halo * .35, 0, 1)[..., None]
    emissive = sample(h + .5, .7, 1) * intensity
    albedo = base * (1 - glow[..., None] * .5) + glow[..., None] * .9
    save('rainbow-glow/albedo.jpg', albedo)
    save('rainbow-glow/emissive.jpg', emissive)
    save('rainbow-glow/orm.png', orm(.3 - glow * .1, .15 + glow * .5))


# --- Rich -------------------------------------------------------------------
def s_curve(samples: int = 120) -> np.ndarray:
    """Points of an 'S' (two opposite semicircle arcs) in a unit cell, y up."""
    t = np.linspace(0, 1, samples)
    top = np.stack([np.cos(np.pi * (.15 + 1.35 * t)), .5 + .5 * np.sin(np.pi * (.15 + 1.35 * t))], -1) * [1, 1]
    bot = np.stack([-np.cos(np.pi * (.15 + 1.35 * t)), -.5 - .5 * np.sin(np.pi * (.15 + 1.35 * t))], -1)
    return np.concatenate([top * [.55, .5], bot * [.55, .5]])


def distance(px: np.ndarray, py: np.ndarray, pts: np.ndarray) -> np.ndarray:
    d = np.full(px.shape, 1e9, np.float32)
    for p in pts:
        d = np.minimum(d, np.hypot(px - p[0], py - p[1]))
    return d


def rich() -> None:
    # Engraved gold: two coin medallions per repeat with polished rims, and fine guilloche
    # engraving between them. Four large coins per repeat read as wallpaper in first person.
    n = 1024
    y, x = np.mgrid[0:n, 0:n] / n
    height = np.full((n, n), .8, np.float32)
    # Guilloche: two interlaced sets of wavy lines (integer frequencies keep it periodic).
    g1 = np.abs((y * 18 + .22 * np.sin(2 * np.pi * 3 * x)) % 1 - .5) < .045
    g2 = np.abs((y * 18 + .5 - .22 * np.sin(2 * np.pi * 3 * x)) % 1 - .5) < .045
    height[g1 | g2] = .66
    coin = np.zeros((n, n), bool)
    s_pts = s_curve()
    for cx0, cy0 in [(.25, .25), (.75, .75)]:
        dx = (x - cx0 + .5) % 1 - .5
        dy = (y - cy0 + .5) % 1 - .5
        r = np.hypot(dx, dy)
        inside = r < .19
        coin |= inside
        rim = (r > .165) & (r < .19)
        ridge = (r > .145) & (r < .165) & (np.cos(np.arctan2(dy, dx) * 64) > 0)
        ring = np.abs(r - .128) < .005
        local = r < .112
        sign = np.zeros((n, n), bool)
        m = local
        d = distance(dx[m] / .07, -dy[m] / .07, s_pts)
        sx = np.zeros_like(r)
        sx[m] = d
        sign[m] = sx[m] < .12
        bar = (np.abs(dx) < .0065) & (np.abs(dy) < .098)
        height[inside] = .86
        height[rim] = 1.0
        height[ridge | ring] = .4
        height[local & ~(sign | bar)] = .74
        height[(sign | bar) & local] = 1.0
    blur = np.real(np.fft.ifft2(np.fft.fft2(height) * np.exp(-(np.sqrt(np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2) * n / 300) ** 2)))
    recess = np.clip((1 - blur) * 1.6, 0, 1)
    gold = rgb(255, 200, 92)
    deep = rgb(118, 70, 18)
    brushed = (noise(n, 200, 51, aspect=8) - .5)[..., None] * .06
    albedo = gold + brushed - recess[..., None] * .9 * (gold - deep)
    save('rich/gold-albedo.jpg', np.clip(albedo, 0, 1), 92)
    # Polished raised gold with gentle large-scale variation; engraving stays satin.
    polish = (noise(n, 3, 53) - .5) * .08
    save('rich/gold-orm.png', orm(np.clip(.15 + polish + recess * .42, .08, .7), 1.0, 1 - recess * .4))
    gy, gx = np.gradient(blur * 6)
    nz = np.ones_like(gx)
    nrm = np.stack([-gx, gy, nz], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    save('rich/gold-normal.png', nrm * .5 + .5)
    # Black lacquer with fine gold pinstripes for grips and small furniture.
    pin = (np.abs(((x + y) * 6) % 1 - .5) < .018) | (np.abs(((x - y) * 6) % 1 - .5) < .018)
    lacquer = np.where(pin[..., None], gold * .92, rgb(16, 13, 10) + grain(n, 52, .02))
    save('rich/lacquer-albedo.jpg', lacquer, 92)
    save('rich/lacquer-orm.png', orm(np.where(pin, .26, .14), np.where(pin, 1.0, 0.0)))


# --- Kill effect banknote -----------------------------------------------------
def banknote() -> None:
    w, h = 256, 128
    y, x = np.mgrid[0:h, 0:w]
    u, v = x / w, y / h
    paper = rgb(150, 196, 132) + (noise(256, 40, 61)[:h, :w] - .5)[..., None] * .08
    border = (np.minimum(np.minimum(u, 1 - u) * 2, np.minimum(v, 1 - v)) < .07)
    inner = np.abs(np.minimum(np.minimum(u, 1 - u) * 2, np.minimum(v, 1 - v)) - .1) < .012
    dx, dy = (u - .5) * 2, v - .5
    oval = np.abs(np.hypot(dx / .5, dy / .36) - 1) < .07
    s_pts = s_curve()
    d = distance(dx / .17, -dy / .3, s_pts)
    sign = (d < .16) | ((np.abs(dx) < .02) & (np.abs(dy) < .33))
    ink = rgb(30, 74, 40)
    note = np.where((border | inner | oval | sign)[..., None], ink, paper)
    out = np.ones((h, w, 3), np.float32) * note
    path = ROOT / 'public/assets/cosmetics/effects'
    global OUT
    previous, OUT = OUT, path
    save('banknote.jpg', out, 90)
    OUT = previous


# --- Studio reflection panorama -------------------------------------------------
def studio() -> None:
    """Equirectangular studio (softboxes, rim strips, floor bounce) for preview-scene PBR
    reflections. Map scenes keep their HDR skies; this is only for isolated previews."""
    w, h = 1024, 512
    y, x = np.mgrid[0:h, 0:w]
    lon = (x / w - .5) * 360
    lat = 90 - y / h * 180
    def box(lo0, lo1, la0, la1, soft=4.0):
        d = np.maximum(np.maximum(lo0 - lon, lon - lo1), np.maximum(la0 - lat, lat - la1))
        return np.clip(1 - d / soft, 0, 1)
    sky = np.clip((lat + 10) / 100, 0, 1)[..., None]
    out = rgb(52, 58, 72) + sky * (rgb(120, 128, 146) - rgb(52, 58, 72))
    floor = (lat < -8)[..., None]
    # Warm floor bounce: the reveal camera looks UP at the reward, so polished gold
    # reflects mostly the lower hemisphere and turns brown against a dark floor.
    out = np.where(floor, rgb(150, 132, 108) + np.clip(-lat / 90, 0, 1)[..., None] * -.12, out)
    out += box(-60, 60, -40, -14, 10)[..., None] * rgb(255, 238, 205) * .55
    out += box(-180, 180, 50, 90, 14)[..., None] * rgb(255, 255, 255)
    out += box(-95, -10, 0, 48, 8)[..., None] * rgb(255, 248, 236)
    out += box(20, 80, -5, 36, 8)[..., None] * rgb(215, 225, 240) * .9
    for c in (-130, 120):
        out += box(c - 4, c + 4, -15, 60, 2)[..., None] * rgb(235, 240, 255)
    previous = globals()['OUT']
    globals()['OUT'] = ROOT / 'public/assets/cosmetics'
    save('studio.jpg', np.clip(out, 0, 1), 92)
    globals()['OUT'] = previous


# =================================================================================================
# 2026-11-10 skins: Carbon Fiber, Hydro Dip, Blossom, Frosted, and the default shotgun's walnut
# =================================================================================================
def normal_map(height: np.ndarray, strength: float) -> np.ndarray:
    """Periodic tangent-space normal map from a height field (same convention as rich())."""
    h = height * strength
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5
    nrm = np.stack([-gx, gy, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    return nrm * .5 + .5


def window(n: int, cx: float, cy: float, r: float):
    """Index of the pixels within r of (cx, cy), wrapped (tileable), plus their offsets from the centre."""
    x0, y0 = int(np.floor(cx - r)) - 1, int(np.floor(cy - r)) - 1
    size = min(n, int(np.ceil(2 * r)) + 3)
    xs, ys = np.arange(x0, x0 + size), np.arange(y0, y0 + size)
    return np.ix_(ys % n, xs % n), (xs[None, :] - cx).astype(np.float32), (ys[:, None] - cy).astype(np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# --- Carbon fibre ---------------------------------------------------------------------------------
def carbon() -> None:
    # 2x2 twill: every tow floats over two crossings, and each row is shifted by one, which
    # gives the diagonal ribs. 16 crossings per repeat; the catalog tiles it at 0.115 m, so a
    # tow is about 7 mm: coarser than real cloth, but the weave still reads at arm's length.
    n, cells = 512, 16
    c = n // cells
    iy, ix = np.mgrid[0:n, 0:n]
    k = (ix // c + iy // c) % 4
    fa, fb = (ix % c + .5) / c, (iy % c + .5) / c
    warp = k < 2
    along = np.where(warp, (k + fb) / 2, (k - 2 + fa) / 2)   # 0..1 along the visible float
    across = np.where(warp, fa, fb)
    crown = np.sin(np.pi * along) ** .55                      # the tow dives under its neighbours at both ends
    edge = 1 - np.abs(2 * across - 1) ** 3 * .6               # rounded tow, dark gap between tows
    fibre = .9 + .1 * np.cos(2 * np.pi * across * 6)          # filaments
    height = crown * edge
    # The two directions reflect light differently: that contrast is what makes the ribs.
    lum = np.where(warp, .47, .2) * (.3 + .7 * crown) * edge * fibre
    albedo = lum[..., None] * (rgb(226, 234, 255) + grain(n, 81, .04))
    save('carbon-fiber/albedo.jpg', albedo, 93)
    save('carbon-fiber/normal.png', normal_map(height, 3.2))
    save('carbon-fiber/orm.png', orm(np.clip(.26 + (1 - edge) * .5 + (1 - crown) * .12, 0, 1), .55, .55 + .45 * height))


# --- Hydro Dip ------------------------------------------------------------------------------------
def ramp(stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    """Periodic colour ramp (256 x 4): the shader walks along it, so the last stop blends into the first."""
    pos = np.array([p for p, _ in stops] + [stops[0][0] + 1])
    col = np.array([c for _, c in stops] + [stops[0][1]], np.float32) / 255
    t = (np.arange(256) + .5) / 256
    t = np.where(t < pos[0], t + 1, t)
    i = np.clip(np.searchsorted(pos, t) - 1, 0, len(pos) - 2)
    f = smooth(0, 1, (t - pos[i]) / (pos[i + 1] - pos[i]))[:, None]
    row = col[i] * (1 - f) + col[i + 1] * f
    return np.broadcast_to(row[None], (4, 256, 3)).copy()


def hydro() -> None:
    # One shared flow map for every animated skin (src/rendering/SkinFx.ts): R is the marbling
    # field, G and B push the lookup around. Colours live in a per-variant ramp, so the three
    # Hydro Dip variants differ only by a 256 x 4 image.
    n = 512
    field = noise(n, 2.4, 71) * .78 + noise(n, 6.5, 72) * .22
    field = (field - field.min()) / (field.max() - field.min())
    save('fx/flow.png', np.stack([field, noise(n, 3.2, 73), noise(n, 3.2, 74)], -1))
    save('hydro-dip/nebula-ramp.png', ramp([
        (.00, (40, 14, 86)), (.12, (126, 38, 176)), (.24, (238, 74, 170)), (.33, (255, 176, 222)),
        (.40, (240, 92, 186)), (.52, (150, 52, 198)), (.62, (70, 84, 226)), (.69, (120, 60, 205)),
        (.80, (232, 70, 160)), (.86, (255, 150, 208)), (.93, (96, 30, 150))]))
    save('hydro-dip/inferno-ramp.png', ramp([
        (.00, (74, 4, 8)), (.12, (190, 18, 10)), (.24, (255, 84, 8)), (.34, (255, 170, 20)),
        (.41, (255, 232, 96)), (.48, (255, 150, 14)), (.60, (226, 40, 10)), (.70, (120, 8, 8)),
        (.80, (236, 62, 8)), (.87, (255, 196, 44)), (.94, (168, 14, 10))]))
    save('hydro-dip/abyss-ramp.png', ramp([
        (.00, (4, 14, 52)), (.14, (10, 48, 128)), (.27, (8, 112, 110)), (.335, (30, 160, 120)),
        (.36, (236, 250, 248)), (.385, (20, 140, 118)), (.50, (6, 70, 96)), (.62, (8, 30, 96)),
        (.72, (12, 84, 150)), (.80, (16, 136, 104)), (.83, (226, 246, 244)), (.86, (10, 100, 100)), (.95, (4, 26, 70))]))


# --- Blossom --------------------------------------------------------------------------------------
def blossom() -> None:
    # Ivory lacquer, dark branches, big saturated cherry blossoms. Tiled at 0.36 m: a flower is
    # 3 to 5 cm across (the reference's are about 2 cm). Everything wraps, so there is no seam.
    n = 1024
    rng = np.random.default_rng(91)
    paper = rgb(238, 233, 224) + (noise(n, 5, 92) - .5)[..., None] * .05 + grain(n, 93, .02)
    out = paper.copy()
    cover = np.zeros((n, n), np.float32)
    nodes: list[tuple[float, float, float]] = []      # (x, y, direction): where flowers may sit

    def grow(x: float, y: float, ang: float, length: float, r0: float, depth: int) -> None:
        s, bend = 0.0, rng.normal(0, .004)
        while s < length:
            t = s / length
            r = max(1.7, r0 * (1 - .78 * t))
            idx, dx, dy = window(n, x, y, r + 1)
            cover[idx] = np.maximum(cover[idx], np.clip(r - np.hypot(dx, dy) + .8, 0, 1))
            ang += rng.normal(0, .028) + bend
            x, y, s = x + np.cos(ang) * 1.5, y + np.sin(ang) * 1.5, s + 1.5
            if rng.random() < (.016 if depth == 0 else .011) and t > .08 and depth < 3:
                side = rng.choice([-1, 1]) * rng.uniform(.5, 1.05)
                grow(x, y, ang + side, length * rng.uniform(.28, .5) * (1 - t * .4), r * .72, depth + 1)
            if rng.random() < .03:
                nodes.append((x, y, ang))
        nodes.append((x, y, ang))

    for _ in range(7):
        grow(rng.uniform(0, n), rng.uniform(0, n), rng.uniform(0, 2 * np.pi), rng.uniform(700, 1100), rng.uniform(8, 11), 0)
    bark = rgb(44, 32, 34)
    # A soft grey shadow under the branches (the reference's brush halo), then the bark.
    halo = np.clip(soften(cover, 6) * 1.5, 0, 1)[..., None]
    out = out * (1 - halo * .16)
    out = out * (1 - cover[..., None]) + (bark + grain(n, 94, .05)) * cover[..., None]
    rough = np.full((n, n), .46, np.float32) + cover * .22

    def petals(cx: float, cy: float, R: float, phi: float, hue: float, count: int = 5) -> None:
        idx, dx, dy = window(n, cx, cy, R * 1.05)
        rr, th = np.hypot(dx, dy), np.arctan2(dy, dx)
        seg = 2 * np.pi / count
        a = (th - phi) % seg - seg / 2
        rb = R * np.cos(a * count / 2) ** .36 * (1 - .2 * np.exp(-(a / .085) ** 2))   # notched sakura petal
        alpha = np.clip((rb - rr) / 1.6 + .5, 0, 1)[..., None]
        t = (rr / R)[..., None]
        core, mid, rim = rgb(214, 20, 96), rgb(255, 72, 150) * [1, 1 + hue, 1 + hue * .6], rgb(255, 150 + 40 * hue, 196 + 26 * hue)
        col = core + (mid - core) * smooth(.1, .5, t) + (rim - mid) * smooth(.55, 1.0, t)
        # petal creases toward the centre and darker seams between petals
        col = col * (1 - .2 * np.exp(-((seg / 2 - np.abs(a)) / .07) ** 2)[..., None] * (1 - t * .5))
        col = col * (1 + .07 * np.cos(a * 14)[..., None] * (t > .3))
        heart = np.clip((R * .17 - rr) / 1.5 + .5, 0, 1)[..., None]
        col = col * (1 - heart) + rgb(150, 14, 62) * heart
        for j in range(8):                                                             # stamens
            sa, sr = phi + j * 2 * np.pi / 8 + .2, R * (.27 + .06 * (j % 2))
            d = np.hypot(dx - np.cos(sa) * sr, dy - np.sin(sa) * sr)
            dot = np.clip((R * .05 - d) / 1.2 + .5, 0, 1)[..., None]
            col = col * (1 - dot) + rgb(255, 226, 130) * dot
        out[idx] = out[idx] * (1 - alpha) + np.clip(col, 0, 1) * alpha
        rough[idx] = rough[idx] * (1 - alpha[..., 0]) + .36 * alpha[..., 0]

    placed: list[tuple[float, float, float]] = []

    def free(x: float, y: float, R: float, gap: float) -> bool:
        for px, py, pr in placed:
            ddx, ddy = (x - px + n / 2) % n - n / 2, (y - py + n / 2) % n - n / 2
            if np.hypot(ddx, ddy) < (R + pr) * gap:
                return False
        return True

    order = rng.permutation(len(nodes))
    for i in order:                                    # blossoms on the branches, never crowding each other
        x, y, ang = nodes[i]
        R = rng.uniform(40, 68)
        side = ang + rng.choice([-1, 1]) * np.pi / 2
        x, y = x + np.cos(side) * R * .45, y + np.sin(side) * R * .45
        if free(x, y, R, 1.02):
            placed.append((x, y, R))
            petals(x, y, R, rng.uniform(0, 6.3), rng.uniform(-.25, .35))
    for i in order[: len(order) // 2]:                 # buds and a few loose petals
        x, y, ang = nodes[i]
        R = rng.uniform(11, 18)
        if free(x, y, R, 1.0):
            placed.append((x, y, R))
            petals(x, y, R, rng.uniform(0, 6.3), rng.uniform(-.3, 0), count=3)
    for _ in range(14):
        x, y, R = rng.uniform(0, n), rng.uniform(0, n), rng.uniform(13, 20)
        if free(x, y, R, 1.15):
            placed.append((x, y, R))
            petals(x, y, R, rng.uniform(0, 6.3), rng.uniform(0, .4), count=1)
    save('blossom/albedo.jpg', out, 92)
    save('blossom/orm.png', orm(rough))
    print('blossom:', sum(1 for p in placed if p[2] > 30), 'flowers', flush=True)


# --- Frosted --------------------------------------------------------------------------------------
def voronoi(n: int, count: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Periodic nearest (F1) and second nearest (F2) distances, in pixels."""
    rng = np.random.default_rng(seed)
    pts = rng.uniform(0, n, (count, 2))
    iy, ix = np.mgrid[0:n, 0:n].astype(np.float32)
    f1 = np.full((n, n), 1e9, np.float32)
    f2 = f1.copy()
    for px, py in pts:
        d = np.hypot((ix - px + n / 2) % n - n / 2, (iy - py + n / 2) % n - n / 2)
        f2 = np.where(d < f1, f1, np.minimum(f2, d))
        f1 = np.minimum(f1, d)
    return f1, f2


def flakes(n: int, seed: int, count: int, size: tuple[float, float]) -> np.ndarray:
    """Coverage of six-armed dendrite snowflakes with side branches, scattered without overlap."""
    rng = np.random.default_rng(seed)
    cover = np.zeros((n, n), np.float32)
    placed: list[tuple[float, float, float]] = []
    for _ in range(count * 30):
        if len(placed) >= count:
            break
        x, y, R = rng.uniform(0, n), rng.uniform(0, n), rng.uniform(*size)
        if any(np.hypot((x - px + n / 2) % n - n / 2, (y - py + n / 2) % n - n / 2) < (R + pr) * 1.08 for px, py, pr in placed):
            continue
        placed.append((x, y, R))
        idx, dx, dy = window(n, x, y, R * 1.05)
        rr, th = np.hypot(dx, dy), np.arctan2(dy, dx) - rng.uniform(0, 1)
        a = np.abs(th % (np.pi / 3) - np.pi / 6)                      # fold into half an arm
        px_, py_ = rr * np.cos(a), rr * np.sin(a)
        w = max(1.1, R * .045)
        d = np.where(px_ < R, py_, np.hypot(px_ - R, py_))            # the arm
        for s, l in ((.38, .34), (.62, .24), (.82, .13)):             # side branches at 60 degrees
            bx, by = px_ - s * R, py_
            t = np.clip((bx * .5 + by * .866) / (l * R), 0, 1) * l * R
            d = np.minimum(d, np.hypot(bx - t * .5, by - t * .866))
        d = np.minimum(d, np.abs(rr - R * .16) + (rr > R * .2) * 9)   # small ring at the hub
        strength = rng.uniform(.55, 1.0)
        cover[idx] = np.maximum(cover[idx], np.clip((w - d) / 1.3 + .5, 0, 1) * strength)
    return cover


def frosted() -> None:
    # Ice: vivid blue with lighter clouds, frost crystals (Voronoi facets) and faint white
    # snowflakes. Snow (the white parts and the shader's snow cap): white with pale blue flakes.
    n = 512
    f1, f2 = voronoi(n, 150, 101)
    facet = np.clip((f2 - f1) / 9, 0, 1)                         # 0 on crystal boundaries
    cloud = noise(n, 3, 102)[..., None]
    ice = rgb(22, 104, 240) + (rgb(64, 176, 255) - rgb(22, 104, 240)) * smooth(.3, .8, cloud)
    ice = ice * (.94 + .06 * (f1 / f1.max())[..., None]) + (1 - facet)[..., None] * .10
    flake = flakes(n, 103, 15, (26, 54))[..., None]
    ice = ice + (rgb(236, 246, 255) - ice) * flake * .5
    save('frosted/ice-albedo.jpg', np.clip(ice, 0, 1), 93)
    height = facet * .6 + f1 / f1.max() * .4 + flake[..., 0] * .5
    save('frosted/ice-normal.png', normal_map(soften(height, 1.2), 5.0))
    save('frosted/ice-orm.png', orm(np.clip(.2 + (1 - facet) * .3 + flake[..., 0] * .25, 0, 1), .08, .8 + .2 * facet))
    sparkle = noise(n, 110, 104)
    snow = rgb(244, 248, 255) - (1 - noise(n, 4, 105))[..., None] * rgb(26, 20, 8) * .5
    snow = snow + (rgb(150, 198, 255) - snow) * flakes(n, 106, 11, (24, 46))[..., None] * .5
    save('frosted/snow-albedo.jpg', np.clip(snow, 0, 1), 93)
    save('frosted/snow-normal.png', normal_map(soften(sparkle, 1.0) + noise(n, 9, 107) * 2, 2.2))
    save('frosted/snow-orm.png', orm(np.clip(.78 - (sparkle > .72) * .5, 0, 1), 0.0, .9 + .1 * noise(n, 9, 107)))


# --- Walnut (default shotgun furniture, library material gun_wood) ----------------------------------
def aniso(n: int, seed: int, lx: float, ly: float) -> np.ndarray:
    """Periodic noise in 0..1 with separate correlation lengths (pixels) along u (columns) and v (rows)."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((n, n)))
    ky, kx = np.fft.fftfreq(n)[:, None], np.fft.fftfreq(n)[None, :]
    g = np.real(np.fft.ifft2(f * np.exp(-2 * np.pi ** 2 * ((kx * lx) ** 2 + (ky * ly) ** 2))))
    g -= g.min()
    return g / g.max()


def walnut() -> None:
    # Straight walnut grain along u (weapon.py turns the shotgun's wood UVs so u runs along the
    # gun): wide early wood, thin dark late-wood lines that wander slowly, long fine pores and a
    # slow colour drift. No plank seams.
    n = 512
    y, _ = np.mgrid[0:n, 0:n] / n
    wave = aniso(n, 111, 150, 40) - .5
    phase = (y * 13 + wave * 3.4 + (aniso(n, 112, 40, 6) - .5) * .35) % 1
    late = smooth(.55, .88, phase) * (1 - smooth(.9, 1.0, phase))     # dark line at the end of each ring
    pores = aniso(n, 113, 14, .9)
    pores = np.clip((pores - pores.mean()) / pores.std(), -2.5, 2.5) / 5 + .5
    streak = smooth(.62, .9, pores)
    figure = aniso(n, 114, 120, 30)[..., None]
    light, dark = rgb(158, 98, 56), rgb(70, 38, 20)
    wood = light + (dark - light) * (late * .78 + smooth(0, .55, phase) * .12)[..., None]
    wood = wood * (.8 + .36 * figure) * (1 - .38 * streak)[..., None]
    wood += grain(n, 115, .02)
    root = ROOT / 'public/assets/textures/weapons'
    save('walnut_albedo.jpg', np.clip(wood, 0, 1), 92, root)
    save('walnut_normal.jpg', normal_map(soften(1 - streak * .8 - late * .25, .7), 2.2), 92, root)
    # Library ORM: occlusion R, roughness G, metallic B. Oiled wood: satin, pores a little duller.
    save('walnut_orm.jpg', orm(np.clip(.44 + streak * .24 + late * .06, 0, 1), 0.0, 1 - streak * .25), 92, root)


if __name__ == '__main__':
    import sys
    # Optional subset: blender ... -P skin_textures.py -- marble rich
    picked = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for stage in (camo, marble, rainbow, rich, banknote, studio, carbon, hydro, blossom, frosted, walnut):
        if not picked or stage.__name__ in picked:
            stage()
