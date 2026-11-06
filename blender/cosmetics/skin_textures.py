"""Tileable textures for the six crate skin collections and the Rich kill effect.

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


def save(name: str, rgb: np.ndarray, quality: int = 90) -> None:
    """rgb: HxWx3 floats in 0..1, stored as-is (no colour transform)."""
    path = OUT / name
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


if __name__ == '__main__':
    import sys
    # Optional subset: blender ... -P skin_textures.py -- marble rich
    picked = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for stage in (camo, marble, rainbow, rich, banknote, studio):
        if not picked or stage.__name__ in picked:
            stage()
