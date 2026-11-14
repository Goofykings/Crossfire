"""Neon Backstreets art atlases (2026-11): cell rectangles shared by tools/make_neon_textures.py (which paints them)
and blender/scripts/lib/neon.py (which maps them onto sign boards). Pure Python, no bpy.

Rects are pixel (x, y, w, h) with y measured from the top of the image. `uv()` converts a cell to the
(u0, v0, u1, v1) rectangle Blender/glTF expects for these `atlas` materials (loaded without the vertical flip).
"""
from __future__ import annotations

SIGNS_SIZE = (2048, 3328)
SIGNS = {
    # horizontal boards (4:1 unless noted)
    'mart': (0, 0, 1024, 256), 'ramen': (1024, 0, 1024, 256),
    'laundry': (0, 256, 1024, 256), 'arcade': (1024, 256, 1024, 256),
    'karaoke': (0, 512, 1024, 256), 'tattoo': (1024, 512, 768, 256), 'exit': (1792, 512, 256, 128), 'h24': (1792, 640, 256, 128),
    'bar88': (0, 768, 512, 256), 'open': (512, 768, 512, 256), 'tea': (1024, 768, 512, 256), 'heart': (1536, 768, 256, 256),
    'cat': (1792, 768, 256, 256),
    'yoru': (0, 1024, 256, 256), 'arrow': (256, 1024, 256, 256), 'pharmacy': (512, 1024, 256, 256),
    'street': (768, 1024, 512, 128), 'alley': (768, 1152, 512, 128), 'menu': (1280, 1024, 512, 256), 'hotel': (1792, 1024, 256, 256),
    # vertical blades (1:4) and the rooftop billboards
    'ramen_v': (0, 1280, 192, 768), 'hotel_v': (192, 1280, 192, 768), 'karaoke_v': (384, 1280, 192, 768), 'hostel_v': (576, 1280, 192, 768),
    'billboard': (768, 1280, 1024, 384), 'billboard2': (768, 1664, 1024, 384), 'pillar': (1792, 1280, 256, 768),
    # polish pass (2026-11-14): ten more vertical yokocho-style blades and three more boards
    'izakaya_v': (0, 2048, 192, 768), 'ramen2_v': (192, 2048, 192, 768), 'sake_v': (384, 2048, 192, 768), 'bar_v': (576, 2048, 192, 768),
    'motel_v': (768, 2048, 192, 768), 'udon_v': (960, 2048, 192, 768), 'club_v': (1152, 2048, 192, 768), 'mahjong_v': (1344, 2048, 192, 768),
    'cafe_v': (1536, 2048, 192, 768), 'pachinko_v': (1728, 2048, 192, 768),
    'izakaya': (0, 2816, 1024, 256), 'udon': (1024, 2816, 512, 256), 'motel': (1536, 2816, 512, 256),
    'arch': (0, 3072, 1024, 256),
}

PANELS_SIZE = (2048, 1280)
PANELS = {
    'ad_fizz': (0, 0, 384, 576), 'ad_noodle': (384, 0, 384, 576), 'ad_sale': (768, 0, 384, 576), 'ad_pulse': (1152, 0, 384, 576),
    'screen': (1536, 0, 512, 288), 'menu_board': (1536, 288, 512, 288),
    'disp_arcade': (0, 576, 512, 224), 'disp_lobby': (512, 576, 512, 224), 'disp_shop': (1024, 576, 512, 224), 'disp_bar': (1536, 576, 512, 224),
    'disp_karaoke': (0, 800, 512, 224), 'disp_tattoo': (512, 800, 512, 224), 'disp_pharmacy': (1024, 800, 512, 224), 'disp_noodle': (1536, 800, 512, 224),
    # polish pass: noodle-shop door curtains, a hand-written specials board, a vending-machine front and a bus-stop ad
    'noren': (0, 1024, 512, 256), 'specials': (512, 1024, 256, 256),
}

WINDOWS_SIZE = (512, 512)      # 4 x 4 cells of lit and dim windows
GRAFFITI_SIZE = (1024, 1536)   # 2 x 6 cells of 512 x 256 (alpha): tags, then rain streaks, rust, cracks, stickers
GRAFFITI_CELLS = 12


def _uv(rect, size, inset=1.5):
    x, y, w, h = rect
    W, H = size
    return ((x + inset) / W, 1 - (y + h - inset) / H, (x + w - inset) / W, 1 - (y + inset) / H)


def sign_uv(name):
    return _uv(SIGNS[name], SIGNS_SIZE)


def panel_uv(name):
    return _uv(PANELS[name], PANELS_SIZE)


def window_uv(cell):
    c, r = cell % 4, (cell // 4) % 4
    return _uv((c * 128, r * 128, 128, 128), WINDOWS_SIZE, 2)


def graffiti_uv(cell):
    c, r = cell % 2, (cell // 2) % 6
    return _uv((c * 512, r * 256, 512, 256), GRAFFITI_SIZE, 2)


def art_uv(name):
    """(material, uv rect) of a named cell in either sign atlas."""
    if name in SIGNS:
        return 'neon_signs', sign_uv(name)
    return 'neon_panels', panel_uv(name)


def aspect(name):
    x, y, w, h = SIGNS.get(name) or PANELS[name]
    return w / h
