"""Neon Backstreets dressing (2026-11): the visual-only layer written to layout.json `neon` and built by
blender/scripts/lib/neon.py. Nothing here has collision.

Conventions: `c` is the centre of a sign on its wall plane (x, y, z); `n` the wall's outward normal (nx, nz);
w/h in metres. Art names are cells of the atlases in blender/scripts/lib/neon_art.py. Colours are linear RGB in 0..1.
From every sign neon.py derives a halo card, a wash of light on the wall below it and, near the ground, a wet
reflection streak on the pavement; `bake` lights tint the vertex colours of the surfaces around them.
"""
from __future__ import annotations

from farm_structures import box, door, structure, wall, win

PINK = [1.0, 0.25, 0.68]
CYAN = [0.2, 0.88, 1.0]
BLUE = [0.3, 0.45, 1.0]
PURPLE = [0.66, 0.3, 1.0]
RED = [1.0, 0.2, 0.22]
YELLOW = [1.0, 0.8, 0.25]
GREEN = [0.25, 1.0, 0.55]
ORANGE = [1.0, 0.5, 0.18]
WARM = [1.0, 0.78, 0.5]
WHITE = [0.9, 0.95, 1.0]
AMBER = [1.0, 0.62, 0.22]      # sodium service lamps (back alley)
TEAL = [0.2, 0.8, 0.9]


def S(sid, art, c, n, w, h, glow, depth=0.1, wash=True, halo=1.0, pool=True):
    return {'id': sid, 'art': art, 'c': list(c), 'n': list(n), 'w': w, 'h': h, 'glow': glow, 'depth': depth,
            'wash': wash, 'halo': halo, 'pool': pool}


def B(sid, art, c, n, w, h, glow):
    """Blade sign: a double-sided board standing out from the wall along its normal."""
    return {'id': sid, 'art': art, 'c': list(c), 'n': list(n), 'w': w, 'h': h, 'glow': glow}


def signs():
    return [
        # 24/7 Mart: fascia sign over the street door, OPEN in the window, 24H over the ATM
        S('mart', 'mart', (-10.25, 3.12, -12.64), (0, -1), 3.6, .9, CYAN, .12),
        S('mart_open', 'open', (-6.8, 1.95, -12.27), (0, -1), .8, .4, RED, .02, wash=False, pool=False),
        S('mart_side', 'h24', (-5.36, 3.1, -7.1), (1, 0), 1.2, .6, YELLOW, .06),
        S('mart_atm', 'h24', (-7.1, 2.3, -3.5), (0, 1), .7, .35, YELLOW, .04, halo=.7),
        S('mart_ad_e', 'ad_sale', (-5.5, 1.6, -4.9), (1, 0), .8, 1.2, PINK, .05, halo=.6),
        S('mart_ad_s', 'ad_fizz', (-13.7, 1.6, -3.5), (0, 1), .8, 1.2, RED, .05, halo=.6),
        # Ramen shop: street fascia, menu by the door, hatch menu, under-balcony sign (the crossing's pink light)
        S('ramen', 'ramen', (6.5, 3.05, -12.66), (0, -1), 4.4, 1.1, RED, .1),
        S('ramen_menu', 'menu', (0.8, 1.5, -12.5), (0, -1), 1.0, .5, ORANGE, .04, halo=.6, pool=False),
        S('ramen_hatch', 'menu', (0.0, 2.42, -9.4), (-1, 0), 1.6, .5, ORANGE, .05, halo=.8),
        S('ramen_south', 'ramen', (7.3, 2.82, -4.5), (0, 1), 2.2, .55, PINK, .1),
        S('ramen_open', 'open', (3.5, 2.85, -4.5), (0, 1), 1.0, .5, RED, .06),
        S('ramen_heart', 'heart', (7.0, 5.4, -4.5), (0, 1), .9, .9, PINK, .06),
        S('ramen_yoru', 'yoru', (0.0, 5.3, -8.0), (-1, 0), 1.2, 1.2, PURPLE, .06),
        S('ramen_exit', 'exit', (12.5, 2.58, -5.45), (1, 0), .5, .25, GREEN, .05, halo=.5, pool=False),
        S('ramen_ad', 'ad_noodle', (12.5, 6.2, -8.5), (1, 0), 2.2, 3.3, ORANGE, .05),
        # Laundromat and the SE block
        S('laundry', 'laundry', (-9.5, 3.08, 4.36), (0, -1), 4.4, 1.1, CYAN, .1),
        S('laundry_cat', 'cat', (-12.0, 5.5, 4.5), (0, -1), 1.0, 1.0, YELLOW, .06),
        S('laundry_ad', 'ad_pulse', (-14.0, 1.8, 13.0), (-1, 0), .8, 1.2, CYAN, .05, halo=.6),
        S('tattoo', 'tattoo', (4.7, 2.95, 4.5), (0, -1), 2.1, .7, RED, .08),
        S('tattoo_room', 'disp_tattoo', (4.75, 1.5, 8.5), (0, -1), 2.8, 1.25, RED, .01, wash=False, halo=0, pool=False),
        S('se_ad', 'ad_sale', (11.0, 1.6, 4.5), (0, -1), .9, 1.3, PINK, .05, halo=.6),
        S('hostel_board', 'billboard2', (6.5, 7.4, 8.5), (0, -1), 5.0, 1.9, CYAN, .12, pool=False),
        S('terrace_exit', 'exit', (11.0, 6.1, 8.5), (0, -1), .5, .25, GREEN, .05, halo=.5, pool=False),
        # kiosk
        S('kiosk_ad', 'ad_noodle', (-2.1, 1.3, 1.6), (0, 1), .9, 1.35, ORANGE, .05, halo=.6),
        S('kiosk_sign', 'h24', (-2.1, 2.2, -0.2), (0, -1), .9, .45, YELLOW, .04, halo=.7),
        # north row
        S('arcade', 'arcade', (-14.5, 3.45, -20.0), (0, 1), 5.0, 1.25, PURPLE, .12),
        S('hotel_jp', 'hotel', (-4.3, 3.35, -20.0), (0, 1), .9, .9, PINK, .1),
        S('corner_tea', 'tea', (16.5, 3.25, -20.0), (0, 1), 2.0, 1.0, GREEN, .08),
        S('street_sign', 'street', (12.95, 3.1, -20.0), (0, 1), .9, .23, BLUE, .05, wash=False, halo=0, pool=False),
        # east row
        S('karaoke', 'karaoke', (20.0, 3.45, -7.8), (-1, 0), 4.4, 1.1, PINK, .12),
        S('bar88', 'bar88', (20.0, 3.2, 2.7), (-1, 0), 2.2, 1.1, BLUE, .1),
        S('bar_heart', 'heart', (20.0, 3.2, -0.9), (-1, 0), .8, .8, PINK, .06),
        # south and west rows
        S('alley_sign', 'alley', (-1.6, 3.0, 20.0), (0, -1), 1.2, .3, BLUE, .05, wash=False, halo=0, pool=False),
        S('back_exit_w', 'exit', (-10.2, 2.55, 20.0), (0, -1), .5, .25, GREEN, .05, halo=.5, pool=False),
        S('back_exit_e', 'exit', (13.4, 2.65, 20.0), (0, -1), .5, .25, GREEN, .05, halo=.5, pool=False),
        S('back_ad', 'ad_pulse', (2.6, 1.7, 20.0), (0, -1), .9, 1.3, CYAN, .05, halo=.6),
        S('back_bar', 'bar88', (-16.4, 3.25, 20.0), (0, -1), 1.6, .8, BLUE, .1),
        S('back_open', 'open', (16.4, 2.9, 20.0), (0, -1), 1.2, .6, RED, .08),
        S('back_cat', 'cat', (9.0, 4.4, 20.0), (0, -1), .9, .9, YELLOW, .06),
        S('se_back_heart', 'heart', (11.0, 3.0, 15.0), (0, 1), .8, .8, PINK, .06),
        S('laundry_back', 'h24', (-9.5, 2.9, 15.0), (0, 1), .9, .45, YELLOW, .05),
        S('west_yoru', 'yoru', (-20.0, 3.2, -4.6), (1, 0), 1.0, 1.0, PURPLE, .06),
        S('west_arrow', 'arrow', (-20.0, 2.95, 1.8), (1, 0), .8, .8, CYAN, .05),
        S('west_ad', 'ad_fizz', (-20.0, 1.65, 4.6), (1, 0), .8, 1.2, RED, .05, halo=.6),
        S('west_cat', 'cat', (-20.0, 5.6, 9.0), (1, 0), 1.1, 1.1, YELLOW, .06),
        # advertising column in the crossing: the same lit poster on all four faces
        S('pillar_n', 'pillar', (7.6, 1.65, -0.3), (0, -1), .86, 2.5, PURPLE, .01, wash=False, halo=.5, pool=False),
        S('pillar_s', 'pillar', (7.6, 1.65, 0.7), (0, 1), .86, 2.5, PINK, .01, wash=False, halo=.5, pool=False),
        S('pillar_w', 'pillar', (7.1, 1.65, 0.2), (-1, 0), .86, 2.5, CYAN, .01, wash=False, halo=.5, pool=False),
        S('pillar_e', 'pillar', (8.1, 1.65, 0.2), (1, 0), .86, 2.5, YELLOW, .01, wash=False, halo=.5, pool=False),
        # upper-room karaoke screen (inside, lit) and rooftop billboard over the mart (faces the crossing)
        S('lounge_screen', 'screen', (0.3, 5.0, -8.0), (1, 0), 1.6, .9, PURPLE, .05, wash=False, halo=.8, pool=False),
        # polish pass (2026-11-14): an izakaya over the mart's side door, an udon bar on the west row, a motel over the back alley
        S('mart_west', 'mart', (-15.0, 3.15, -5.7), (-1, 0), 2.6, .65, CYAN, .1),
        S('izakaya', 'izakaya', (12.5, 3.2, 9.6), (1, 0), 2.6, .65, PINK, .1),
        S('udon', 'udon', (-20.0, 3.3, -9.2), (1, 0), 1.8, .9, ORANGE, .08),
        S('motel', 'motel', (20.0, 3.35, 10.9), (-1, 0), 2.4, 1.2, PINK, .08),
        # overhaul (2026-11-15): shoji screens on the ramen shop's alley wall and under the balcony (the cosy, warm fronts)
        S('shoji_alley', 'shoji', (0.0, 1.62, -6.75), (-1, 0), 2.4, 1.2, WARM, .05, halo=.9),
        S('shoji_alley_n', 'shoji_tall', (0.0, 1.62, -11.45), (-1, 0), 1.2, 1.2, WARM, .05, halo=.8),
        S('shoji_balcony', 'shoji_tall', (10.0, 1.6, -4.5), (0, 1), 1.0, 1.25, WARM, .05, halo=.8, pool=False),
    ]


def blades():
    return [
        B('ramen_blade', 'ramen_v', (0.6, 5.8, -12.5), (0, -1), .9, 3.6, RED),
        B('hotel_blade', 'hotel_v', (-8.6, 6.6, -20.0), (0, 1), 1.0, 4.0, PINK),
        B('pharmacy_blade', 'pharmacy', (12.4, 3.7, -20.0), (0, 1), .9, .9, GREEN),
        B('karaoke_blade', 'karaoke_v', (20.0, 7.2, -13.0), (-1, 0), 1.0, 4.0, PURPLE),
        B('hostel_blade', 'hostel_v', (12.5, 6.8, 12.0), (1, 0), .9, 3.6, CYAN),
        B('laundry_blade', 'yoru', (-14.0, 4.6, 5.4), (-1, 0), .9, .9, PURPLE),
        B('back_blade', 'gyoza_v', (-2.8, 6.0, 20.0), (0, -1), .9, 3.6, YELLOW),
        # polish pass: yokocho-style vertical signs stacked up the alley walls (colour contrast: pink/cyan/yellow/green/orange)
        B('izakaya_blade', 'ramen2_v', (-15.0, 5.6, -11.6), (-1, 0), .9, 3.6, CYAN),
        B('ramen2_blade', 'yakitori_v', (-5.5, 5.9, -10.4), (1, 0), .9, 3.6, ORANGE),
        B('sake_blade', 'sake_v', (0.0, 4.9, -5.9), (-1, 0), .8, 3.0, YELLOW),
        B('mahjong_blade', 'mahjong_v', (20.0, 5.8, 5.6), (-1, 0), .9, 3.6, RED),
        B('club_blade', 'club_v', (20.0, 6.6, -1.6), (-1, 0), .9, 3.6, PURPLE),
        B('bar_blade', 'bar_v', (13.2, 5.0, 20.0), (0, -1), .9, 3.0, GREEN),
        B('udon_blade', 'udon_v', (-8.0, 5.4, 20.0), (0, -1), .8, 3.0, ORANGE),
        B('cafe_blade', 'cafe_v', (3.4, 5.8, -20.0), (0, 1), .9, 3.0, CYAN),
        B('pachinko_blade', 'pachinko_v', (-17.6, 6.2, -20.0), (0, 1), .8, 3.0, YELLOW),
        B('motel_blade', 'sento_v', (-14.0, 6.0, 10.6), (-1, 0), .9, 3.6, CYAN),
        B('izakaya2_blade', 'izakaya_v', (12.5, 5.8, 7.2), (1, 0), .9, 3.6, PINK),
        B('motel2_blade', 'motel_v', (20.0, 6.4, 13.4), (-1, 0), .9, 3.6, PINK),
        B('oden_blade', 'oden_v', (0.0, 5.7, -9.1), (-1, 0), .8, 3.0, RED),
        B('denki_blade', 'denki_v', (-20.0, 5.9, -0.7), (1, 0), .9, 3.6, BLUE),
    ]


def billboards():
    """Rooftop billboards on steel frames (art, centre, facing normal, w, h)."""
    return [
        {'id': 'mart_roof', 'art': 'billboard', 'c': [-10.25, 13.0, -6.2], 'n': [0, 1], 'w': 7.6, 'h': 2.85, 'base': 10.6, 'glow': PINK},
        {'id': 'pharmacy_roof', 'art': 'billboard2', 'c': [7.0, 14.6, -20.8], 'n': [0, 1], 'w': 7.0, 'h': 2.6, 'base': 12.2, 'glow': CYAN},
    ]


def tubes():
    """Neon strips: polyline points, colour, the direction they face (for their glow ribbons)."""
    return [
        {'pts': [[-14.6, 2.82, -12.66], [-5.9, 2.82, -12.66]], 'col': CYAN, 'n': [0, -1]},
        {'pts': [[-13.6, 2.78, 4.34], [-5.4, 2.78, 4.34]], 'col': BLUE, 'n': [0, -1]},
        {'pts': [[0.4, 3.18, -2.57], [12.1, 3.18, -2.57]], 'col': PINK, 'n': [0, 1]},
        {'pts': [[0.4, 2.72, -12.68], [12.1, 2.72, -12.68]], 'col': RED, 'n': [0, -1]},
        # passage mouth outline under the terrace
        {'pts': [[6.52, 0.4, 4.47], [6.52, 3.18, 4.47], [9.48, 3.18, 4.47], [9.48, 0.4, 4.47]], 'col': CYAN, 'n': [0, -1]},
        # kiosk roof edge
        {'pts': [[-3.66, 2.66, -0.46], [-0.54, 2.66, -0.46], [-0.54, 2.66, 1.86], [-3.66, 2.66, 1.86], [-3.66, 2.66, -0.46]], 'col': PINK, 'n': [0, 1]},
        # arcade window outline, hotel door, karaoke window, bar window
        {'pts': [[-19.0, .45, -19.97], [-19.0, 2.95, -19.97], [-13.4, 2.95, -19.97], [-13.4, .45, -19.97]], 'col': PURPLE, 'n': [0, 1]},
        {'pts': [[-5.65, 0.2, -19.97], [-5.65, 2.85, -19.97], [-2.95, 2.85, -19.97], [-2.95, 0.2, -19.97]], 'col': PINK, 'n': [0, 1]},
        {'pts': [[19.97, .6, -9.65], [19.97, 2.85, -9.65], [19.97, 2.85, -5.95], [19.97, .6, -5.95]], 'col': PINK, 'n': [-1, 0]},
        {'pts': [[19.97, .9, 0.75], [19.97, 2.65, 0.75], [19.97, 2.65, 4.65], [19.97, .9, 4.65]], 'col': BLUE, 'n': [-1, 0]},
        # laundromat window band and back-alley door strip
        {'pts': [[-13.25, 2.66, 4.47], [-10.35, 2.66, 4.47]], 'col': CYAN, 'n': [0, -1]},
        {'pts': [[3.9, 2.5, 19.97], [5.7, 2.5, 19.97]], 'col': RED, 'n': [0, -1]},
        {'pts': [[-12.0, 3.25, 19.95], [-6.6, 3.25, 19.95]], 'col': PURPLE, 'n': [0, -1]},
        {'pts': [[13.0, 3.38, 19.9], [19.8, 3.38, 19.9]], 'col': CYAN, 'n': [0, -1]},
        {'pts': [[-13.6, 3.08, 15.04], [-5.4, 3.08, 15.04]], 'col': BLUE, 'n': [0, 1]},
        # vertical accent on the SE corner facing the east lane
        {'pts': [[12.62, 3.8, 4.6], [12.62, 11.8, 4.6]], 'col': PURPLE, 'n': [1, 0]},
        {'pts': [[-5.38, 3.8, -3.6], [-5.38, 10.0, -3.6]], 'col': CYAN, 'n': [1, 0]},
        # polish pass: laundromat west door, pharmacy door, mart side door
        {'pts': [[-14.04, .2, 9.55], [-14.04, 2.55, 9.55], [-14.04, 2.55, 11.25], [-14.04, .2, 11.25]], 'col': BLUE, 'n': [-1, 0]},
        {'pts': [[7.55, .2, -19.97], [7.55, 2.65, -19.97], [9.45, 2.65, -19.97], [9.45, .2, -19.97]], 'col': GREEN, 'n': [0, 1]},
        {'pts': [[-5.46, .2, -8.2], [-5.46, 2.7, -8.2], [-5.46, 2.7, -6.0], [-5.46, .2, -6.0]], 'col': ORANGE, 'n': [1, 0]},
        # interiors: strip lights along the walls (mart: pink west wall and cyan back wall; laundromat: blue and cyan; underpass: both sides)
        {'pts': [[-14.66, 2.95, -12.0], [-14.66, 2.95, -4.2]], 'col': PINK, 'n': [1, 0]},
        {'pts': [[-14.4, 2.95, -3.84], [-6.2, 2.95, -3.84]], 'col': CYAN, 'n': [0, -1]},
        {'pts': [[-13.66, 2.95, 5.2], [-13.66, 2.95, 14.2]], 'col': BLUE, 'n': [1, 0]},
        {'pts': [[-13.4, 2.95, 14.66], [-5.6, 2.95, 14.66]], 'col': CYAN, 'n': [0, -1]},
        {'pts': [[6.54, 3.0, 5.2], [6.54, 3.0, 14.4]], 'col': CYAN, 'n': [1, 0]},
        {'pts': [[9.46, 3.0, 5.2], [9.46, 3.0, 14.4]], 'col': BLUE, 'n': [-1, 0]},
        # overhaul: a warm light strip up the flank of each stair (balcony stair both flanks, court stair, the two stairwells)
        {'pts': [[10.565, .13, 1.75], [10.565, 3.31, -2.55]], 'col': ORANGE, 'n': [-1, 0]},
        {'pts': [[12.035, .13, 1.75], [12.035, 3.31, -2.55]], 'col': ORANGE, 'n': [1, 0]},
        {'pts': [[1.57, .13, 12.95], [1.57, 3.31, 8.65]], 'col': YELLOW, 'n': [-1, 0]},
        {'pts': [[12.17, .95, 12.8], [12.17, 4.4, 9.5]], 'col': CYAN, 'n': [-1, 0]},
        {'pts': [[12.17, 1.15, -10.3], [12.17, 4.45, -6.3]], 'col': ORANGE, 'n': [-1, 0]},
    ]


def lanterns():
    """Strings of red paper lanterns (noodle alley) and warm bulbs (market court): cable ends, count, colour, sag."""
    return [
        {'a': [-5.5, 4.05, -11.0], 'b': [0.0, 4.05, -11.2], 'n': 5, 'col': RED, 'sag': .28, 'kind': 'lantern'},
        {'a': [-5.5, 4.05, -6.2], 'b': [0.0, 4.05, -6.0], 'n': 5, 'col': RED, 'sag': .28, 'kind': 'lantern'},
        {'a': [-5.0, 3.7, 6.0], 'b': [3.0, 3.7, 6.2], 'n': 11, 'col': WARM, 'sag': .25, 'kind': 'bulb'},
        {'a': [-5.0, 3.7, 9.6], 'b': [3.0, 3.7, 9.6], 'n': 11, 'col': WARM, 'sag': .25, 'kind': 'bulb'},
        {'a': [-5.0, 3.7, 13.0], 'b': [3.0, 3.7, 12.8], 'n': 11, 'col': WARM, 'sag': .25, 'kind': 'bulb'},
        {'a': [-20.0, 4.4, 17.0], 'b': [20.0, 4.6, 18.4], 'n': 22, 'col': WARM, 'sag': .5, 'kind': 'bulb'},
        # polish pass: paper lanterns in the ramen dining room (seen through the street windows) and over the east lane
        {'a': [0.7, 3.0, -11.5], 'b': [7.0, 3.0, -11.5], 'n': 6, 'col': RED, 'sag': .25, 'kind': 'lantern'},
        {'a': [0.7, 3.0, -5.3], 'b': [7.0, 3.0, -5.3], 'n': 6, 'col': ORANGE, 'sag': .25, 'kind': 'lantern'},
        {'a': [13.7, 5.2, -9.0], 'b': [18.6, 5.2, -9.4], 'n': 5, 'col': PINK, 'sag': .35, 'kind': 'lantern'},
        {'a': [-19.9, 4.8, 5.0], 'b': [-14.1, 4.8, 5.6], 'n': 7, 'col': CYAN, 'sag': .4, 'kind': 'bulb'},
        # overhaul: festoon bulbs across the plaza between the balcony and the terrace, a second lantern row in the food alley
        {'a': [3.6, 6.8, -4.5], 'b': [3.6, 6.3, 8.5], 'n': 13, 'col': WHITE, 'sag': .8, 'kind': 'bulb'},
        {'a': [-5.5, 4.0, -8.6], 'b': [0.0, 4.0, -8.5], 'n': 5, 'col': ORANGE, 'sag': .28, 'kind': 'lantern'},
    ]


def cables():
    """Overhead power and phone cables between facades (sagging tubes)."""
    out = []
    for x, y0, y1 in ((-16.5, 7.2, 6.8), (-6.0, 7.8, 7.0), (3.0, 7.4, 8.0), (11.0, 8.4, 7.2), (17.0, 6.9, 7.6)):
        out.append({'a': [x, y0, -20.0], 'b': [x + .6, y1, -12.5], 'sag': .45})
    for z, y in ((-9.0, 6.4), (-1.0, 7.2), (8.0, 6.6), (13.0, 7.0)):
        out.append({'a': [-20.0, y, z], 'b': [-14.0 if z > 4 else -15.0, y - .4, z + .5], 'sag': .3})
    for z, y in ((-11.0, 7.6), (-2.0, 8.2), (6.0, 7.0), (12.5, 7.8)):
        out.append({'a': [20.0, y, z], 'b': [12.5, y + .3, z - .4], 'sag': .4})
    for x, y in ((-12.0, 6.8), (-2.0, 7.4), (6.0, 7.0), (15.0, 6.6)):
        out.append({'a': [x, y, 20.0], 'b': [x + .8, y + .5, 15.0], 'sag': .35})
    out.append({'a': [-5.5, 6.0, -9.0], 'b': [0.0, 6.3, -8.5], 'sag': .3})
    # polish pass: more wires criss-crossing the lanes and the crossing (the reference alleys are full of them)
    out.append({'a': [-5.5, 8.4, -10.5], 'b': [0.0, 8.0, -7.2], 'sag': .5})
    out.append({'a': [-14.0, 6.8, 6.0], 'b': [-5.0, 7.4, 6.2], 'sag': .6})
    out.append({'a': [-15.0, 7.4, -9.0], 'b': [-20.0, 7.0, -6.0], 'sag': .35})
    out.append({'a': [20.0, 9.0, 1.0], 'b': [12.5, 8.6, 6.0], 'sag': .5})
    out.append({'a': [-20.0, 7.8, 12.0], 'b': [-14.0, 8.2, 9.0], 'sag': .4})
    return out


def graffiti():
    return [
        {'c': [-15.0, 1.6, -7.6], 'n': [-1, 0], 'w': 3.0, 'h': 1.5, 'cell': 0},
        {'c': [-14.0, 1.5, 7.2], 'n': [-1, 0], 'w': 3.0, 'h': 1.5, 'cell': 1},
        {'c': [3.0, 1.45, 5.8], 'n': [-1, 0], 'w': 2.2, 'h': 1.1, 'cell': 2},
        {'c': [4.3, 1.55, -20.255], 'n': [0, 1], 'w': 3.2, 'h': 1.6, 'cell': 3},
        {'c': [-20.255, 1.55, -8.5], 'n': [1, 0], 'w': 3.0, 'h': 1.5, 'cell': 4},
        {'c': [4.7, 1.75, 15.0], 'n': [0, 1], 'w': 2.6, 'h': 1.3, 'cell': 5},
        {'c': [20.255, 1.6, 14.2], 'n': [-1, 0], 'w': 3.4, 'h': 1.7, 'cell': 6},
        {'c': [-13.2, 1.65, 20.0], 'n': [0, -1], 'w': 3.2, 'h': 1.6, 'cell': 7},
        {'c': [9.5, 1.75, 20.0], 'n': [0, -1], 'w': 3.0, 'h': 1.5, 'cell': 0},
        {'c': [12.5, 1.5, 13.4], 'n': [1, 0], 'w': 1.5, 'h': .75, 'cell': 5},
        {'c': [-0.8, 1.2, 1.6], 'n': [0, 1], 'w': .9, 'h': .45, 'cell': 1},
    ]


def pipes():
    """Vertical drain pipes on facades: (x, z, top, wall normal)."""
    return [
        {'x': -14.85, 'z': -3.42, 'top': 10.8, 'n': [0, 1]}, {'x': -5.62, 'z': -12.58, 'top': 10.8, 'n': [0, -1]},
        {'x': 12.42, 'z': -12.58, 'top': 13.8, 'n': [0, -1]}, {'x': 0.08, 'z': -4.42, 'top': 3.3, 'n': [0, 1]},
        {'x': -13.92, 'z': 14.92, 'top': 9.8, 'n': [-1, 0]}, {'x': 12.58, 'z': 14.85, 'top': 12.6, 'n': [1, 0]},
        {'x': -19.92, 'z': 14.6, 'top': 12.2, 'n': [1, 0]}, {'x': 7.3, 'z': 19.92, 'top': 11.8, 'n': [0, -1]},
        {'x': -7.0, 'z': 19.92, 'top': 9.8, 'n': [0, -1]}, {'x': 19.92, 'z': -4.6, 'top': 10.6, 'n': [-1, 0]},
    ]


def puddles():
    """Wet patches on the street, alleys and crossing: centre, radii, rotation (degrees)."""
    return [
        [-12.0, -16.6, 1.6, .7, 10], [-1.5, -15.4, 1.1, .6, -20], [9.0, -14.9, 1.4, .55, 5], [16.2, -16.0, 1.0, .8, 40],
        [-17.8, -8.0, .9, .6, 0], [-17.0, 2.0, 1.3, .8, 30], [-3.0, -5.8, .8, .5, 15], [-6.5, 0.4, 1.2, .7, -10],
        [3.0, 2.8, 1.5, .8, 20], [9.6, -0.6, .9, .5, 0], [15.5, -6.0, 1.2, .6, 80], [16.0, 7.0, 1.0, .6, 95],
        [-1.0, 13.5, 1.0, .6, 0], [8.0, 11.5, .8, .5, 90], [-9.0, 17.4, 1.6, .7, 5], [5.0, 17.8, 1.2, .6, -15],
        [14.0, 16.4, 1.1, .7, 30], [-17.0, 11.0, .9, .6, 70], [-17.6, 18.4, 1.0, .5, 0],
    ]


def bake():
    """Light pools baked into vertex colours. `room` lights reach only surfaces inside their rect."""
    out = [
        # signs and tubes (they also get additive washes)
        {'pos': [-10.0, 2.9, -13.6], 'col': CYAN, 'r': 7.0, 'i': .9},
        {'pos': [6.5, 2.9, -13.6], 'col': RED, 'r': 7.5, 'i': .9},
        {'pos': [6.5, 2.6, -3.3], 'col': PINK, 'r': 8.0, 'i': 1.0},
        {'pos': [-9.5, 2.8, 5.4], 'col': CYAN, 'r': 6.5, 'i': .8},
        {'pos': [4.7, 2.6, 3.8], 'col': RED, 'r': 5.0, 'i': .7},
        {'pos': [8.0, 2.4, 4.0], 'col': CYAN, 'r': 5.0, 'i': .7},
        {'pos': [-14.5, 3.2, -19.0], 'col': PURPLE, 'r': 8.0, 'i': .9},
        {'pos': [-4.3, 3.0, -19.2], 'col': PINK, 'r': 6.0, 'i': .7},
        {'pos': [16.5, 3.0, -19.2], 'col': GREEN, 'r': 5.5, 'i': .7},
        {'pos': [19.0, 3.2, -7.8], 'col': PINK, 'r': 8.0, 'i': .9},
        {'pos': [19.0, 3.0, 2.7], 'col': BLUE, 'r': 6.5, 'i': .8},
        {'pos': [-2.1, 2.7, 0.7], 'col': PINK, 'r': 4.5, 'i': .6},
        {'pos': [-2.7, 3.6, -8.6], 'col': RED, 'r': 6.0, 'i': .8},
        {'pos': [-1.0, 3.4, 9.6], 'col': WARM, 'r': 7.5, 'i': .8},
        {'pos': [0.0, 4.2, 17.6], 'col': WARM, 'r': 9.0, 'i': .5},
        {'pos': [-19.0, 3.0, -4.6], 'col': PURPLE, 'r': 5.0, 'i': .6},
        {'pos': [-19.0, 2.9, 2.5], 'col': CYAN, 'r': 5.0, 'i': .6},
        {'pos': [4.8, 2.4, 19.4], 'col': RED, 'r': 4.5, 'i': .6},
        {'pos': [-16.4, 3.0, 19.2], 'col': BLUE, 'r': 6.0, 'i': .5},
        {'pos': [-9.0, 3.4, 19.4], 'col': PURPLE, 'r': 6.0, 'i': .4},
        {'pos': [16.0, 3.4, 19.2], 'col': CYAN, 'r': 6.5, 'i': .5},
        {'pos': [-9.5, 3.2, 15.8], 'col': BLUE, 'r': 6.0, 'i': .7},
        {'pos': [-2.8, 5.0, 19.0], 'col': YELLOW, 'r': 6.0, 'i': .6},
        {'pos': [11.5, 6.0, -8.5], 'col': ORANGE, 'r': 5.0, 'i': .6},
        {'pos': [6.5, 7.0, 7.6], 'col': CYAN, 'r': 6.0, 'i': .7},
        {'pos': [10.6, 5.0, -19.0], 'col': ORANGE, 'r': 7.0, 'i': .5},
        {'pos': [19.0, 5.0, -2.6], 'col': ORANGE, 'r': 7.0, 'i': .5},
        # polish pass: the new vertical signs light their lanes
        {'pos': [-16.5, 3.6, -10.6], 'col': CYAN, 'r': 6.0, 'i': .8},
        {'pos': [-4.3, 3.8, -10.0], 'col': ORANGE, 'r': 5.5, 'i': .8},
        {'pos': [-1.0, 3.4, -5.9], 'col': YELLOW, 'r': 5.0, 'i': .6},
        {'pos': [18.6, 3.8, 5.0], 'col': RED, 'r': 6.0, 'i': .75},
        {'pos': [18.6, 4.2, -1.6], 'col': PURPLE, 'r': 6.0, 'i': .75},
        {'pos': [13.2, 3.2, 18.6], 'col': GREEN, 'r': 5.5, 'i': .7},
        {'pos': [-8.0, 3.4, 18.6], 'col': ORANGE, 'r': 5.5, 'i': .65},
        {'pos': [3.4, 3.8, -18.8], 'col': CYAN, 'r': 6.0, 'i': .7},
        {'pos': [-16.0, 3.8, -18.8], 'col': YELLOW, 'r': 6.0, 'i': .6},
        {'pos': [-16.0, 4.0, 10.6], 'col': CYAN, 'r': 5.5, 'i': .7},
        {'pos': [18.8, 3.3, 10.9], 'col': PINK, 'r': 6.0, 'i': .7},
        # overhaul (2026-11-15): one light character per zone. Soft, wide fills in the zone's colour, on top of the sign pools:
        # cool teal west lane, warm amber food alley and market court, sodium back alley, magenta east lane, a neutral plaza lamp
        {'pos': [-17.5, 3.2, -8.0], 'col': TEAL, 'r': 9.5, 'i': .5}, {'pos': [-17.2, 3.2, 9.6], 'col': [.25, .6, 1.0], 'r': 9.5, 'i': .5},
        {'pos': [-2.75, 3.0, -8.0], 'col': [1.0, .52, .22], 'r': 7.5, 'i': .6},
        {'pos': [-13.0, 3.0, 17.5], 'col': AMBER, 'r': 9.5, 'i': 1.3}, {'pos': [9.5, 3.0, 17.5], 'col': AMBER, 'r': 9.5, 'i': 1.3},
        {'pos': [1.0, 3.0, 17.6], 'col': AMBER, 'r': 8.5, 'i': 1.1}, {'pos': [-1.0, 3.2, 9.8], 'col': WARM, 'r': 9.5, 'i': 1.6}, {'pos': [-1.0, 3.2, 13.2], 'col': WARM, 'r': 7.0, 'i': 1.0},
        {'pos': [16.1, 3.4, -4.5], 'col': [1.0, .22, .62], 'r': 9.0, 'i': .45}, {'pos': [16.1, 3.4, 9.0], 'col': [1.0, .25, .45], 'r': 8.5, 'i': .4},
        {'pos': [2.8, 3.5, 0.4], 'col': [.86, .92, 1.0], 'r': 9.5, 'i': 1.7}, {'pos': [12.9, 3.2, 9.6], 'col': PINK, 'r': 5.0, 'i': .6},
        # the stair strips and the shoji screens
        {'pos': [10.2, 1.8, -0.2], 'col': ORANGE, 'r': 3.6, 'i': .55}, {'pos': [1.2, 1.8, 11.0], 'col': YELLOW, 'r': 3.6, 'i': .5},
        {'pos': [-0.9, 1.6, -6.75], 'col': WARM, 'r': 4.2, 'i': .7}, {'pos': [10.0, 1.6, -3.7], 'col': WARM, 'r': 3.4, 'i': .5},
        # interiors
        {'pos': [-10.25, 3.0, -8.0], 'col': WHITE, 'r': 8.0, 'i': 1.0, 'room': [-14.7, -12.2, -5.8, -3.8]},
        {'pos': [5.0, 2.9, -8.5], 'col': WARM, 'r': 8.0, 'i': .9, 'room': [0.3, -12.2, 12.2, -4.8]},
        {'pos': [5.0, 6.1, -8.5], 'col': PURPLE, 'r': 8.0, 'i': .8, 'room': [0.3, -12.2, 12.2, -4.8]},
        {'pos': [-9.5, 3.0, 9.8], 'col': WHITE, 'r': 8.0, 'i': .9, 'room': [-13.7, 4.8, -5.3, 14.7]},
        {'pos': [8.0, 3.0, 9.8], 'col': CYAN, 'r': 6.5, 'i': .6, 'room': [6.5, 4.5, 9.5, 15.0]},
        {'pos': [11.0, 5.5, 11.5], 'col': WARM, 'r': 6.0, 'i': .6, 'room': [9.8, 8.8, 12.2, 14.7]},
    ]
    return out


def rooms():
    """Interior fill light (additive cards on the floor, inner walls and ceiling of each lit room)."""
    return [
        {'rect': [-14.7, -12.2, -5.8, -3.8], 'y': .15, 'top': 3.25, 'col': [.85, .95, 1.0], 'k': 1.0},
        {'rect': [0.3, -12.2, 7.4, -4.8], 'y': .15, 'top': 3.25, 'col': [1.0, .7, .42], 'k': .9},
        {'rect': [8.0, -12.2, 12.2, -4.8], 'y': .15, 'top': 3.25, 'col': [1.0, .82, .6], 'k': .7},
        {'rect': [0.3, -12.2, 12.2, -4.8], 'y': 3.55, 'top': 6.45, 'col': [.62, .3, 1.0], 'k': .75},
        {'rect': [-13.7, 4.8, -5.3, 14.7], 'y': .15, 'top': 3.25, 'col': [.75, .9, 1.0], 'k': .9},
        {'rect': [6.5, 4.8, 9.5, 14.7], 'y': 0.0, 'top': 3.25, 'col': [.3, .85, 1.0], 'k': .55},
        {'rect': [9.8, 8.8, 12.2, 14.7], 'y': 0.0, 'top': 6.4, 'col': [1.0, .78, .5], 'k': .45},
    ]


def lamps():
    """Small lit fixtures: ceiling light panels (unlit boxes) and caged wall lamps over service doors."""
    return {
        'ceiling': [
            # (x0, z0, x1, z1, y) light panels on the underside of ceilings
            [-13.6, -10.0, -11.6, -9.6, 3.24], [-13.6, -6.6, -11.6, -6.2, 3.24], [-9.6, -10.0, -7.6, -9.6, 3.24], [-9.6, -6.6, -7.6, -6.2, 3.24],
            [1.5, -9.0, 5.5, -8.7, 3.24], [8.4, -9.0, 10.2, -8.7, 3.24],
            [-12.5, 7.0, -8.5, 7.3, 3.24], [-12.5, 11.6, -8.5, 11.9, 3.24],
            [7.7, 6.4, 8.3, 7.6, 3.24], [7.7, 11.0, 8.3, 12.2, 3.24],
            [2.5, -10.0, 4.5, -9.7, 6.44], [6.5, -7.0, 8.5, -6.7, 6.44],
            [10.6, 13.8, 11.4, 14.2, 6.39],
        ],
        'wall': [
            # (x, y, z, nx, nz) caged bulkhead lamps
            [-16.4, 2.65, 20.0, 0, -1], [-10.2, 2.75, 20.0, 0, -1], [4.8, 2.75, 20.0, 0, -1], [13.4, 2.85, 20.0, 0, -1],
            [-14.0, 2.75, 10.4, -1, 0], [-15.0, 2.75, -5.7, -1, 0], [12.5, 3.0, -5.45, 1, 0], [9.5, 2.75, 13.95, -1, 0],
            [-13.0, 2.9, 15.0, 0, 1], [9.9, 2.9, 15.0, 0, 1], [1.0, 2.9, 20.0, 0, -1], [3.0, 2.8, 6.4, -1, 0], [-20.0, 2.8, -11.4, 1, 0],
        ],
    }


def posters():
    """posters_fun sheets pasted on plain wall stretches (the shared farmstead poster mesh builds them)."""
    def p(building, cell, x, z, normal, y=1.15):
        return {'building': building, 'cell': cell, 'framed': False, 'w': 0.65, 'h': 0.975, 'x': x, 'y': y, 'z': z, 'normal': list(normal)}
    return [
        p('mart', 2, -14.62, -3.488, (0, 1), 1.0), p('mart', 9, -5.488, -11.95, (1, 0), 1.1),
        p('laundromat', 11, -4.988, 14.4, (1, 0), 1.1), p('laundromat', 8, -4.988, 9.3, (1, 0), 1.2),
        p('se_block', 1, 3.6, 15.012, (0, 1), 1.05), p('se_block', 10, 9.8, 4.488, (0, -1), 1.15),
        p('s_back_m', 5, 0.4, 19.988, (0, -1), 1.2), p('s_back_m', 6, 1.2, 19.988, (0, -1), 1.05),
        p('w_shop_s', 0, -19.988, 7.6, (1, 0), 1.25), p('e_shop', 7, 19.988, 19.4, (-1, 0), 1.2),
    ]


def vista():
    """Visual-only buildings beyond the fences (no collision: the fences and the boundary keep players in)."""
    def front(sid, rect, side, top, mat, opens=()):
        return structure(sid, sid, rect, [wall(rect, [0, top], list(opens), inn=mat, out=mat, outside=side, base=.6, base_mat='concrete_trim',
                                               frame='steel_dark', frame_floor=.15 if sid == 'vista_w_north' else 0.0)])
    out = [
        # Neon Street continues west past the construction fence to a corner building at x = -34
        front('vista_w_north', [-34.0, -20.45, -20.0, -20.0], 's', 11.6, 'brick_city_b_dark',
              [win(-31.0, -26.6, sill=.5, top=2.8), door(-25.6, -24.0, top=2.6)]),
        front('vista_w_south', [-34.0, -12.5, -20.45, -12.05], 'n', 10.2, 'stucco_grey', [win(-30.0, -25.5, sill=.6, top=2.7)]),
        front('vista_w_end', [-34.45, -20.0, -34.0, -12.5], 'e', 14.0, 'facade_tiles_dark', [win(-18.4, -14.2, sill=.5, top=2.8)]),
        structure('vista_w_walks', 'walks', [-34.0, -20.0, -20.0, -12.5],
                  [box([-34.0, 0.0, -20.0, -20.0, .15, -18.5], 'curb', 'walk', False, mats={'py': 'pavers'}),
                   box([-34.0, 0.0, -14.0, -20.45, .15, -12.5], 'curb', 'walk', False, mats={'py': 'pavers'})]),
        # east service gap: a short lit alley ending at a back door
        front('vista_e_north', [20.45, 6.75, 28.0, 7.2], 's', 10.4, 'facade_tiles_dark'),
        front('vista_e_south', [20.45, 9.6, 28.0, 10.05], 'n', 12.8, 'stucco_grey'),
        front('vista_e_end', [28.0, 7.2, 28.45, 9.6], 'w', 11.0, 'brick_factory_soot', [door(7.9, 8.9, top=2.3)]),
        # south gap behind the market court
        front('vista_s_west', [-6.85, 20.45, -6.4, 28.0], 'e', 9.8, 'brick_factory_soot'),
        front('vista_s_east', [-2.8, 20.45, -2.35, 28.0], 'w', 11.6, 'brick_city_brown'),
        front('vista_s_end', [-6.4, 28.0, -2.8, 28.45], 'n', 10.0, 'concrete_panel', [door(-5.1, -4.1, top=2.3)]),
    ]
    # closed door leaves and a little life in the gaps
    out[6]['elements'].append(box([28.0, 0.0, 7.9, 28.06, 2.3, 8.9], 'steel_grey', 'door_leaf', False))
    out[9]['elements'].append(box([-5.1, 0.0, 27.94, -4.1, 2.3, 28.0], 'steel_green', 'door_leaf', False))
    out[0]['elements'].append(box([-25.6, 0.0, -20.45, -24.0, 2.6, -20.39], 'steel_red', 'door_leaf', False))
    out[6]['elements'].append(box([26.2, 0.0, 7.4, 27.8, 1.3, 8.6], 'steel_green', 'bin', False))
    return out


def vista_signs():
    return [
        S('vista_w_open', 'open', (-28.8, 3.2, -20.0), (0, 1), 1.6, .8, RED, .08, pool=False),
        S('vista_w_end', 'karaoke', (-34.0, 3.6, -16.3), (1, 0), 3.6, .9, PINK, .1, pool=False),
        S('vista_w_tea', 'heart', (-27.6, 3.1, -12.5), (0, -1), .9, .9, PINK, .06, pool=False),
        S('vista_e_arrow', 'arrow', (28.0, 2.9, 8.4), (-1, 0), .7, .7, CYAN, .05, pool=False),
        S('vista_s_exit', 'exit', (-4.6, 2.55, 28.0), (0, -1), .5, .25, GREEN, .03, pool=False),
        S('vista_s_cat', 'cat', (-6.4, 4.0, 24.0), (1, 0), 1.0, 1.0, YELLOW, .06, pool=False),
    ]


def rain():
    """Where rain may fall (src/rendering/Rain.ts): roofed footprints, decks it lands on, raised floors."""
    from terrain_farm import subtract_rects
    open_beyond = [(-20.0, -20.0, 20.0, 20.0), (-34.0, -20.0, -20.0, -12.5), (20.0, 7.2, 28.0, 9.6), (-6.4, 20.0, -2.8, 28.0)]
    outside = subtract_rects((-40.0, -40.0, 40.0, 40.0), open_beyond)
    roofs = [[-15.0, -12.5, -5.5, -3.5], [0.0, -12.5, 12.5, -4.5], [-14.0, 4.5, -5.0, 15.0], [3.0, 8.5, 12.5, 15.0],
             [-3.65, -0.45, -0.55, 1.85]] + [[round(v, 3) for v in r] for r in outside]
    decks = [[[0.3, -4.5, 12.2, -2.6], 3.55], [[3.0, 4.5, 12.5, 8.5], 3.55], [[1.6, 7.0, 3.0, 8.6], 3.55]]
    raised = [[-20.0, -20.0, 20.0, -18.5], [-20.0, -14.0, 12.5, -12.5], [12.5, -14.0, 13.7, 15.0], [18.6, -18.5, 20.0, 15.0],
              [-34.0, -20.0, -20.0, -18.5], [-34.0, -14.0, -20.45, -12.5]]
    # dripping edges [x0, z0, x1, z1, y]: the balcony's lip over the plaza, the kiosk roof, the court landing, the four awnings
    drips = [[0.5, -2.56, 10.4, -2.56, 3.5], [-3.6, 1.88, -0.6, 1.88, 2.62], [-3.6, -0.48, -0.6, -0.48, 2.62], [1.58, 7.1, 1.58, 8.5, 3.3],
             [-14.83, 9.4, -14.83, 11.4, 2.8], [7.4, -19.27, 9.6, -19.27, 2.8], [4.0, 19.27, 5.6, 19.27, 2.8], [19.27, 17.0, 19.27, 19.0, 2.8]]
    return {'roofs': roofs, 'decks': decks, 'raised': raised, 'puddles': [[x, z, rx, rz] for x, z, rx, rz, _ in puddles()], 'drips': drips}


def grime():
    """Rain streaks (cell 8), rust (9) and stickers (11) on wall stretches that were plain brick and tile."""
    def g(x, y, z, n, w, h, cell):
        return {'c': [x, y, z], 'n': list(n), 'w': w, 'h': h, 'cell': cell}
    return [
        g(-14.0, 3.2, 12.8, (-1, 0), 3.0, 1.6, 8), g(-15.0, 2.9, -11.9, (-1, 0), 1.0, 1.0, 9),
        g(0.0, 2.8, -6.0, (-1, 0), 2.0, 1.0, 9), g(12.5, 2.3, 11.0, (1, 0), 3.0, 1.4, 8), g(-18.2, 3.0, 20.0, (0, -1), 3.2, 1.4, 8),
        g(16.8, 4.9, 20.0, (0, -1), 2.4, 1.2, 9), g(-20.0, 3.0, 17.4, (1, 0), 3.0, 1.4, 8), g(-5.5, 2.6, -8.75, (1, 0), 1.2, .8, 11),
        g(20.0, 3.6, 17.8, (-1, 0), 2.4, 1.0, 8), g(11.2, 1.9, 15.0, (0, 1), 2.0, 1.0, 8), g(-7.0, 1.6, 15.0, (0, 1), 1.6, .8, 11),
    ]


def cracks():
    """Cracked pavement cards (centre x, z, width, depth, rotation): kept clear of paint, puddles and drains."""
    def c(x, z, w, h, rot):
        return {'c': [x, z], 'w': w, 'h': h, 'rot': rot, 'cell': 10}
    return [c(-16.0, -16.4, 3.0, 1.5, 10), c(15.0, -9.0, 2.6, 1.3, 90), c(-14.0, 17.0, 3.0, 1.5, 10), c(11.0, 17.8, 2.4, 1.2, -20),
            c(-12.0, 1.2, 3.0, 1.5, 0), c(1.0, 12.0, 2.6, 1.3, 70), c(-17.0, -2.0, 2.4, 1.2, 80), c(10.5, -17.4, 2.6, 1.2, 0)]


def noren():
    """Red cloth curtains over both ramen street doors (the lit glyph panel sits in front of the indigo cloth)."""
    return [{'c': [2.5, 0, -12.5], 'n': [0, -1], 'w': 1.5, 'y0': 1.78}, {'c': [3.5, 0, -4.5], 'n': [0, 1], 'w': 1.5, 'y0': 1.78}]


def fire_escapes():
    """Visual-only escapes on four facades (p = wall plane point at the landing centre, n = outward normal)."""
    return [{'p': [-12.0, 15.0], 'n': [0, 1], 'y0': 4.6, 'floors': 2, 'rise': 3.1}, {'p': [-15.0, -7.2], 'n': [-1, 0], 'y0': 4.6, 'floors': 2, 'rise': 3.1},
            {'p': [20.0, -9.6], 'n': [-1, 0], 'y0': 4.8, 'floors': 2, 'rise': 3.2}, {'p': [-13.2, 20.0], 'n': [0, -1], 'y0': 4.6, 'floors': 2, 'rise': 3.0}]


def spans():
    """Big signs hung across lanes. The arch over the crossing joins the mart's south wall and the laundromat's north wall."""
    return [{'art': 'arch', 'c': [-10.0, 7.0, 0.5], 'w': 7.4, 'h': 1.85, 'glow': PINK, 'anchors': [-3.5, 4.5]}]


def rooftops():
    """Flat roofs inside the parapets (x0, z0, x1, z1, roof height): mart, ramen shop, laundromat, hostel block."""
    return [[-14.5, -12.0, -6.0, -4.0, 10.6], [.6, -12.0, 11.8, -5.2, 13.6], [-13.4, 5.2, -5.6, 14.4, 9.6], [3.6, 9.2, 12.0, 14.4, 12.4]]


def marks():
    """Painted road markings, bay numbers, stencils, plates, litter and decorated cast covers (blender/scripts/lib/neon.py
    `mark`). Ground entries: art, centre (x, z), size, compass heading of the top of the art; wall entries carry a normal.
    Keep ground entries off the road paint and off each other (they share one height)."""
    def g(a, x, z, w, h, rot=0, **kw):
        return {'art': a, 'c': [x, z], 'w': w, 'h': h, 'rot': rot, **kw}

    def w(a, x, y, z, n, ww, hh):
        return {'art': a, 'c': [x, y, z], 'n': list(n), 'w': ww, 'h': hh}
    return [
        # Neon Street is one-way eastbound: arrows, the stop kanji before the line at the corner, tyre marks
        g('arrow', -15.6, -17.4, .9, 3.0, 90), g('arrow', 3.6, -15.1, .9, 3.0, 90), g('tomare', 10.9, -17.4, 1.3, 3.0, 90),
        g('tyres', -8.0, -15.0, 5.0, 1.3, 0),
        # east lane: slow, an arrow toward the street, tyre marks
        g('jokou', 14.9, 10.6, 1.2, 2.4, 0), g('arrow', 17.4, -9.0, .8, 2.6, 0), g('tyres', 17.4, 11.6, 5.0, 1.3, 90),
        # back alley: the loading bay is hatched and numbered, bays along the south wall, keep-clear at the underpass mouth
        g('hatch', 0.3, 17.85, 2.5, 2.5, 0), g('bay1', -5.0, 18.9, 1.0, 1.0, 180), g('bay2', 6.2, 18.7, 1.0, 1.0, 180),
        g('bay3', 11.6, 18.3, 1.0, 1.0, 180), g('bay4', 15.0, 17.2, 1.0, 1.0, 180), g('keep_clear', 8.0, 15.9, 2.6, .34, 0),
        # lanes: arrows toward the crossing, one up the underpass like the old service routes
        g('arrow', -17.4, -9.4, .7, 2.2, 180), g('arrow', -17.2, 9.4, .7, 2.2, 0), g('arrow', 8.0, 11.6, .8, 2.4, 0),
        # runoff stains at the feet of the downpipes (the top of the art lies at the wall)
        g('stain', -14.85, -2.65, .7, 1.4, 0), g('stain', 0.08, -3.65, .6, 1.3, 0), g('stain', -14.75, 14.92, .7, 1.4, 90),
        g('stain', 7.3, 19.15, .7, 1.4, 180), g('stain', -7.0, 19.15, .6, 1.3, 180), g('stain', 13.35, 14.85, .7, 1.4, 270),
        # litter where the wind leaves it: corners, bin rows, the food alley and the market court
        g('litter_a', -18.7, 12.9, 1.7, 1.7, 30), g('litter_a', -4.0, 16.3, 1.6, 1.6, 200), g('litter_a', 16.6, 17.0, 1.8, 1.8, 110),
        g('litter_b', -19.1, -10.2, 1.5, 1.5, 0), g('litter_b', -12.6, 3.3, 1.5, 1.5, 70), g('litter_b', 19.3, 9.6, 1.3, 1.3, 20),
        g('litter_c', -3.7, 11.0, 2.0, 2.0, 40), g('litter_c', -4.7, -4.9, 1.6, 1.6, 150), g('litter_c', 11.6, 3.6, 1.5, 1.5, 300),
        g('litter_b', 9.1, 16.3, 1.4, 1.4, 250), g('litter_a', -1.2, -11.6, 1.4, 1.4, 80),
        # decorated cast covers (a lucky cat over waves) in the crossing, the west lane and the back alley
        g('manhole', -2.0, 2.6, .84, .84, 0, lift=.012), g('manhole', -17.0, 6.0, .84, .84, 90, lift=.012), g('manhole', 2.0, 17.6, .84, .84, 180, lift=.012),
        # walls: stencilled block numbers, loading and no-parking notices, the way out of the underpass, plates and flyers
        w('wall12', -11.6, 1.95, 15.0, (0, 1), 1.3, 1.3), w('wall07', 3.0, 2.15, 7.55, (-1, 0), 1.2, 1.2),
        w('loading', -1.2, 2.2, 20.0, (0, -1), 2.4, .6), w('no_parking', 18.3, 1.25, 20.0, (0, -1), 2.2, .55),
        w('no_parking', -20.0, 1.3, 16.4, (1, 0), 2.2, .55), w('exit_way', 9.5, 1.55, 8.0, (-1, 0), 2.4, .3), w('exit_way', 6.5, 1.55, 11.6, (1, 0), 2.4, .3),
        w('plate_volt', -15.0, 2.0, -11.42, (-1, 0), .3, .3), w('plate_volt', 12.5, 2.0, 6.78, (1, 0), .3, .3), w('plate_volt', -5.0, 2.38, 5.3, (1, 0), .3, .3),
        w('plate_fire', 6.5, 1.95, 6.2, (1, 0), .34, .34), w('plate_fire', -5.55, 1.85, 15.0, (0, 1), .34, .34),
        w('plate_block', -15.0, 2.45, -4.0, (-1, 0), .64, .16), w('plate_block', 0.0, 2.45, -12.1, (-1, 0), .64, .16),
        w('plate_block', 12.5, 2.45, 14.5, (1, 0), .64, .16), w('plate_block', -14.0, 2.45, 5.0, (-1, 0), .64, .16),
        w('flyers', 12.5, 1.45, 9.6, (1, 0), 2.2, .37), w('flyers', 3.0, 1.35, 14.2, (-1, 0), 1.6, .27),
    ]


def fixtures():
    """Eye-level wall hardware (neon.py `fixture`, visual only): meters, junction boxes with conduit runs, vents, fire-hose
    cabinets and sheet-metal ducts. c = point on the wall plane, n = wall normal."""
    def f(kind, x, y, z, n, **kw):
        return {'kind': kind, 'c': [x, y, z], 'n': list(n), **kw}
    return [
        # west lane: the mart's meters and a junction with a conduit run; a kitchen duct on the west row; dryer vents
        f('meter', -15.0, 1.42, -11.95, (-1, 0), count=2, top=3.4), f('junction', -15.0, 2.2, -9.3, (-1, 0), run=-1.9, drop=-.2),
        f('duct', -20.0, 4.3, -7.0, (1, 0), len=5.0, down=1.0), f('vent', -14.0, 2.1, 8.6, (-1, 0)), f('vent', -14.0, 2.1, 7.4, (-1, 0)),
        f('junction', -20.0, 1.7, 10.4, (1, 0), run=2.4), f('meter', -20.0, 1.42, 3.3, (1, 0), count=2, top=3.2),
        # food alley: meters by the ramen wall's south end, a vent over the hatch, a duct from the kitchen
        f('meter', 0.0, 1.42, -5.15, (-1, 0), count=2, top=3.4), f('vent', 0.0, 3.02, -9.4, (-1, 0), w=.9, h=.34),
        f('duct', -5.5, 3.35, -8.8, (1, 0), len=3.2),
        # crossing and market court
        f('meter', -5.0, 1.42, 5.3, (1, 0), count=3, top=3.3),
        f('vent', -8.2, 2.9, -3.5, (0, 1), w=.9, h=.4),
        # underpass: fire-hose cabinet, vents and a conduit along the tiled wall
        f('reel', 6.5, 1.25, 6.2, (1, 0)), f('vent', 9.5, 2.45, 6.6, (-1, 0)), f('vent', 6.5, 2.45, 13.2, (1, 0)),
        f('junction', 9.5, 2.0, 10.6, (-1, 0), run=2.2, drop=.0),
        # east lane: the hostel block's meters, a junction on the ramen shop's east wall
        f('meter', 12.5, 1.57, 6.0, (1, 0), count=3, top=3.4), f('junction', 12.5, 2.05, -9.8, (1, 0), run=-2.0),
        f('vent', 12.5, 2.3, 12.6, (1, 0)),
        # back alley: service hardware on every wall (the dim, working lane), kitchen ducts on the south row
        f('meter', -8.4, 1.42, 15.0, (0, 1), count=2, top=3.0), f('reel', -5.55, 1.2, 15.0, (0, 1)),
        f('duct', -14.6, 4.15, 20.0, (0, -1), len=4.6, down=1.2), f('duct', 6.6, 3.5, 20.0, (0, -1), len=3.4), f('vent', -8.47, 2.3, 20.0, (0, -1)),
        f('junction', 15.4, 1.8, 20.0, (0, -1), run=-1.6), f('vent', 11.0, 2.95, 20.0, (0, -1), w=.9, h=.4),
    ]


def steam():
    """Steam emitters for src/rendering/Steam.ts (position, tint, particles per second, rise speed)."""
    return [
        {'p': [-0.45, 1.45, -9.4], 'col': WARM, 'rate': 9, 'rise': .5, 'size': .8},       # ramen take-away hatch into the noodle alley
        {'p': [6.5, .12, -16.0], 'col': PINK, 'rate': 12, 'rise': .7, 'size': 1.1},         # manholes
        {'p': [16.1, .12, 8.0], 'col': CYAN, 'rate': 12, 'rise': .7, 'size': 1.1},
        {'p': [-8.0, .12, -16.3], 'col': PURPLE, 'rate': 10, 'rise': .7, 'size': 1.0},
        {'p': [-14.35, 2.1, 8.6], 'col': [.8, .9, 1.0], 'rate': 10, 'rise': .4, 'size': .8},   # laundromat dryer vent onto the west lane
        {'p': [7.0, 2.7, 19.55], 'col': WARM, 'rate': 10, 'rise': .45, 'size': .8},          # kitchen exhaust in the back alley
        {'p': [-19.2, .15, -1.0], 'col': GREEN, 'rate': 8, 'rise': .5, 'size': .9},
    ]


def dressing():
    return {'version': 1, 'signs': signs(), 'blades': blades(), 'billboards': billboards(), 'tubes': tubes(),
            'lanterns': lanterns(), 'cables': cables(), 'graffiti': graffiti(), 'pipes': pipes(), 'puddles': puddles(),
            'bake': bake(), 'lamps': lamps(), 'rooms': rooms(), 'rain': rain(), 'vista': vista(), 'vista_signs': vista_signs(),
            'grime': grime(), 'cracks': cracks(), 'noren': noren(), 'fire_escapes': fire_escapes(), 'steam': steam(),
            'spans': spans(), 'rooftops': rooftops(), 'marks': marks(), 'fixtures': fixtures(),
            'displays': {'n_arcade': 'disp_arcade', 'n_hotel': 'disp_lobby', 'n_pharmacy': 'disp_pharmacy', 'n_corner': 'disp_bar',
                         'e_karaoke': 'disp_karaoke', 'e_bar': 'disp_bar'}}
