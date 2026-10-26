"""Procedural Modern City buildings: brick apartments, concrete and clad commercial blocks, storefront buildings,
garages, chamfered corner shops and tall backdrop blocks.

Reuses the industrial generator's machinery (height-banded walls, openings with reveals, parapet roofs, walk-in
interiors, passages) with city architecture: recessed aluminium windows with sills and lintels, ribbon glazing,
storefronts (fascia sign, awning, roll-down shutter), apartment entrances, sectional garage doors, fire escapes, window
air-conditioners, blade signs and posters; rooftop water tanks, stair huts, AC plant and dishes.

Storeys follow building_spec.CITY_GROUND / CITY_UPPER; layout heights come from building_spec.city_height(floors).
Layout door kinds: store | entrance | garage | door | double (plus interior doorway / roller_open).
"""
from __future__ import annotations

import building_spec as bs
import kit
import kit_industrial as ki
import kit_modern as km
from building import Edge, Opening
from building_industrial import IndustrialBuildingGenerator

CITY_PALETTES = {
    "brick_red": {"base": "granite", "base_h": 0.5, "wall": "brick_city_red", "header": "concrete_trim", "awning": "canvas_red"},
    "brick_brown": {"base": "granite", "base_h": 0.5, "wall": "brick_city_brown", "header": "concrete_trim", "awning": "canvas_green"},
    "brick_pale": {"base": "concrete_smooth_dark", "base_h": 0.6, "wall": "brick_city_pale", "header": "concrete_smooth_light",
                   "awning": "canvas_blue"},
    "brick_orange": {"base": "granite", "base_h": 0.5, "wall": "brick_city_b_orange", "header": "concrete_trim", "awning": "canvas_black"},
    "brick_dark": {"base": "concrete_smooth_dark", "base_h": 0.6, "wall": "brick_city_b_dark", "header": "concrete_smooth_light",
                   "awning": "canvas_olive"},
    "concrete": {"base": "concrete_smooth_dark", "base_h": 0.6, "wall": "concrete_smooth_light", "header": None, "awning": "canvas_black"},
    "concrete_warm": {"base": "granite", "base_h": 0.6, "wall": "concrete_smooth_warm", "header": None, "awning": "canvas_red"},
    "clad_white": {"base": "facade_tiles_dark", "base_h": 0.9, "wall": "cladding_panel_white", "header": None, "awning": "canvas_blue"},
    "clad_slate": {"base": "concrete_smooth_dark", "base_h": 0.6, "wall": "cladding_panel_slate", "header": None, "awning": "canvas_black"},
    "clad_sage": {"base": "granite", "base_h": 0.6, "wall": "cladding_panel_sage", "header": None, "awning": "canvas_olive"},
    "stucco_cream": {"base": "granite", "base_h": 0.6, "wall": "stucco_cream", "header": "concrete_trim", "awning": "canvas_green"},
    "stucco_peach": {"base": "facade_tiles_dark", "base_h": 0.7, "wall": "stucco_peach", "header": "concrete_trim", "awning": "canvas_red"},
    "stucco_sky": {"base": "granite", "base_h": 0.6, "wall": "stucco_sky", "header": "concrete_smooth_light", "awning": "canvas_cream"},
    "stucco_grey": {"base": "concrete_smooth_dark", "base_h": 0.6, "wall": "stucco_grey", "header": None, "awning": "canvas_red"},
    "stucco_olive": {"base": "granite", "base_h": 0.6, "wall": "stucco_olive", "header": "concrete_trim", "awning": "canvas_cream"},
    "tiles": {"base": "granite", "base_h": 0.6, "wall": "facade_tiles_light", "header": None, "awning": "canvas_black"},
}
for _p in CITY_PALETTES.values():
    _p.setdefault("roof", "roof_gravel")
    _p.setdefault("door", "steel_dark")
    _p.setdefault("roller", "roller_grey")
    _p.setdefault("inner", "stucco_white")
    _p.setdefault("shop_base", "facade_tiles_dark")

CITY_DOOR_HEIGHT = {"store": 2.9, "entrance": 2.7, "garage": 2.5, "door": 2.2, "double": 2.4, "roller": 3.4, "dock": 3.0}


class ModernBuildingGenerator(IndustrialBuildingGenerator):
    PALETTES = CITY_PALETTES
    INTERIOR = {"floor": "granite", "ceiling": "concrete_smooth_light", "dado": "facade_tiles_dark", "beams": False, "lanes": False}

    def generate(self, b: dict):
        self.fire_escape_done = False
        return super().generate(b)

    def palette_for(self, b: dict) -> dict:
        pal = dict(CITY_PALETTES[b["palette"]])
        shop_floor = b["type"] in ("storefront", "commercial", "corner") or any(d.get("kind") == "store" for d in b.get("doors", []))
        if shop_floor and b["type"] != "garage":
            # shop ground floors get a tiled or stone band up to the first floor
            pal["base"], pal["base_h"] = pal["shop_base"], bs.CITY_GROUND - 0.05
        return pal

    def roof_kinds(self, edges):
        return ["flat"] * len(edges)

    # --- openings ------------------------------------------------------------------------------------
    def plan_openings(self, e: Edge, open_runs):
        b = self.b
        H = self.H
        ops, free, _ = self.base_openings(e, open_runs, CITY_DOOR_HEIGHT)
        t = b["type"]
        if e.side == "chamfer" and e.length > 1.8:
            w = e.length - 0.8  # keeps the 0.35 m end margin `free` asks for
            c = e.length / 2
            g = self.ground(e, c)
            if free(c - w / 2, c + w / 2, -0.3, g + 2.9, pad=0.0):
                ops.append(Opening(c - w / 2, c + w / 2, -0.3, g + 2.9, "store", data={"ground": g}))
        floors = b.get("floors", 3)
        if self.backdrop:
            # tall blocks seen from afar: a flat grid of glass panes on the facade, no holes
            return ops
        for f in range(floors):
            base = bs.city_floor_base(f)
            if f == 0:
                if t == "garage":
                    continue
                wy, wh, ww = 1.0, 1.55, 1.3
            elif t == "commercial":
                wy, wh, ww = base + 0.85, 1.75, 0.0
            else:
                wy, wh, ww = base + 0.9, 1.6, 1.25 + (b["seed"] % 3) * 0.1
            if wy + wh > H - bs.CITY_PARAPET - 0.2:
                break
            for (r0, r1) in open_runs:
                usable = r1 - r0 - 1.0
                if usable < 1.4:
                    continue
                if ww == 0.0:
                    # ribbon glazing: one wide window per ~4.5 m bay
                    n = max(1, round(usable / 4.6))
                    for i in range(n):
                        c = r0 + 0.5 + usable * (i + 0.5) / n
                        w = usable / n - 0.5
                        if w >= 1.4 and free(c - w / 2, c + w / 2, wy, wy + wh, pad=0.25):
                            ops.append(Opening(c - w / 2, c + w / 2, wy, wy + wh, "ribbon", data={"floor": f}))
                    continue
                n = max(1, round(usable / 2.6))
                for i in range(n):
                    c = r0 + 0.5 + usable * (i + 0.5) / n
                    if free(c - ww / 2, c + ww / 2, wy, wy + wh, pad=0.4):
                        ops.append(Opening(c - ww / 2, c + ww / 2, wy, wy + wh, "window", data={"floor": f}))
        return ops

    def facade_wall(self, e: Edge, r0: float, r1: float, ops):
        super().facade_wall(e, r0, r1, ops)
        if not self.backdrop:
            return
        # backdrop blocks: glass panes 8 mm proud of the wall in a regular grid (cheap at a distance)
        floors = self.b.get("floors", 6)
        for f in range(floors):
            y0 = bs.city_floor_base(f) + (1.1 if f == 0 else 0.9)
            y1 = y0 + 1.5
            if y1 > self.H - bs.CITY_PARAPET:
                break
            n = int((r1 - r0 - 1.0) / 2.6)
            for i in range(n):
                c = r0 + 0.5 + (r1 - r0 - 1.0) * (i + 0.5) / n
                pts = [self.P(e, c - 0.65, y0, -0.008), self.P(e, c + 0.65, y0, -0.008), self.P(e, c + 0.65, y1, -0.008),
                       self.P(e, c - 0.65, y1, -0.008)]
                self.md.face(pts, "glass_window")

    def dress_opening(self, e: Edge, o: Opening, openings=()):
        w = o.s1 - o.s0
        c = (o.s0 + o.s1) / 2
        h = o.y1 - o.y0
        wk, hk = round(w, 2), round(h, 2)
        pal = self.pal
        rnd = self.rnd
        if o.kind == "window":
            glass = "window_blinds" if rnd.random() < 0.35 else "glass_window"
            self.place(f"mwin_{wk}x{hk}_{glass}", lambda: km.window_modern(w, h, glass), e, c, o.y0)
            self.place(f"msill_{wk}", lambda: kit.sill(w, "concrete_trim"), e, c, o.y0)
            if pal.get("header"):
                hm = pal["header"]
                self.place(f"mhead_{wk}_{hm}", lambda: km.header(w, hm), e, c, o.y1)
            if o.data.get("floor", 0) >= 1 and rnd.random() < 0.14:
                self.place("macwin", km.ac_window, e, c, o.y0 - 0.02)
        elif o.kind == "ribbon":
            glass = "window_blinds" if rnd.random() < 0.25 else "glass_window"
            self.place(f"mrib_{wk}x{hk}_{glass}", lambda: km.window_modern(w, h, glass, frame="steel_dark"), e, c, o.y0)
            self.place(f"msill_{wk}", lambda: kit.sill(w, "concrete_trim"), e, c, o.y0)
        elif o.kind == "store":
            g = o.data["ground"]
            sh = o.y1 - g
            cell = (self.b["seed"] + int(c * 7)) % 16
            awning = pal["awning"] if rnd.random() < 0.55 else None
            shut = rnd.choice((0.0, 0.0, 0.0, 0.25, 1.0))
            rm = pal["roller"]
            self.place(f"mstore_{wk}x{round(sh, 2)}_{cell}_{awning}_{shut}_{rm}",
                       lambda: km.storefront(w, sh, cell, awning, shut, rm), e, c, g)
            # blade sign beside the shop at first-floor level
            s = o.s1 + 0.6
            if s < e.length - 0.5 and rnd.random() < 0.5 and all(not (p.s0 - 0.5 < s < p.s1 + 0.5) for p in openings if p is not o):
                bc = (cell + 5) % 16
                self.place(f"mblade_{bc}", lambda: km.blade_sign(bc), e, s, bs.CITY_GROUND + 0.3)
        elif o.kind == "entrance":
            g = o.data["ground"]
            dh = o.y1 - g
            self.place(f"mentr_{wk}x{round(dh, 2)}", lambda: km.entrance(w, dh), e, c, g)
            self.place(f"ithresh_{wk}", lambda: kit.threshold(w, "concrete_trim"), e, c, g)
            cw = w + 0.8
            if c - cw / 2 > 1.4 and c + cw / 2 < e.length - 1.4:
                self.place(f"icanopy_{round(cw, 2)}", lambda: ki.canopy(cw, 1.3), e, c, g + 3.05)
        elif o.kind == "garage":
            g = o.data["ground"]
            dh = o.y1 - g
            rm = pal["roller"]
            self.place(f"mgarage_{wk}x{round(dh, 2)}_{rm}", lambda: km.garage_door(w, dh, rm), e, c, g)
        elif o.kind == "doorway":
            g = o.data["ground"]
            dh = o.y1 - g
            self.place(f"mframe_{wk}x{round(dh, 2)}", lambda: ki.door_frame(w, dh, "aluminium", hazard=False), e, c, g)
        else:
            super().dress_opening(e, o, openings)

    def trims(self, e: Edge, r0: float, r1: float, ops):
        """Coping, a string course over the ground floor, fire escapes, posters, meters and downpipes."""
        H = self.H
        rnd = self.rnd
        b = self.b
        busy = [(o.s0 - 0.25, o.s1 + 0.25, o.y0, o.y1) for o in ops]

        def clear(s0, s1, y0, y1):
            return all(not (s0 < b1 and b0 < s1 and y0 < q1 and q0 < y1) for (b0, b1, q0, q1) in busy)

        (c0, p0), (c1, p1) = self.run_end_cuts(e, r0, r1)

        def run_box(a, c, y0, y1, d0, d1, mat):
            dep = abs(d0)
            at0, at1 = a <= r0 + 1e-6, c >= r1 - 1e-6
            if c0 and at0:
                a += dep
            if c1 and at1:
                c -= dep
            skip_ends = (p0 and not c0 and at0, p1 and not c1 and at1)
            if c > a + 1e-4:
                self._edge_box(e, a, c, y0, y1, d0, d1, mat, skip_ends=skip_ends)

        run_box(r0, r1, H - 0.12, H + 0.06, -0.06, 0.0, "concrete_trim")
        if self.backdrop:
            return
        if b.get("floors", 1) > 1 and self.pal.get("header"):
            y = bs.CITY_GROUND
            run_box(r0, r1, y - 0.08, y + 0.08, -0.045, 0.0, self.pal["header"])
        # fire escape on the first long run facing an alley or yard (not the front)
        if (b["type"] == "apartment" and not self.fire_escape_done and e.side != b.get("front", "s") and r1 - r0 > 4.5
                and b.get("floors", 3) >= 3):
            w = min(4.2, r1 - r0 - 1.0)
            c = (r0 + r1) / 2
            floors = b.get("floors", 3) - 1
            name = f"mfire_{floors}_{round(w, 2)}"
            self.place(name, lambda: km.fire_escape(floors, w, bs.CITY_GROUND, bs.CITY_UPPER), e, c, 0.0)
            self.fire_escape_done = True
            busy.append((c - w / 2, c + w / 2, 0.0, H))
        # pasted posters on blank stretches at street level
        if r1 - r0 > 3 and rnd.random() < 0.4:
            for _ in range(5):
                s = rnd.uniform(r0 + 0.9, r1 - 0.9)
                if clear(s - 0.7, s + 0.7, 0.4, 2.3):
                    cell = rnd.randint(0, 3)
                    g = self.ground(e, s)
                    self.place(f"mposter_{cell}", lambda: km.poster_board(cell), e, s, g + 0.5)
                    busy.append((s - 0.7, s + 0.7, 0.4, 2.3))
                    break
        # gas / electric meters
        if rnd.random() < 0.45 and r1 - r0 > 2.5:
            for _ in range(6):
                s = rnd.uniform(r0 + 0.6, r1 - 0.6)
                if clear(s - 0.35, s + 0.35, 0.8, 3.0):
                    self.place("iwallbox", ki.wall_box, e, s, self.ground(e, s) + 1.0)
                    busy.append((s - 0.4, s + 0.4, 0.8, 3.0))
                    break
        # rainwater downpipe at one end of the run (flat roofs drain through scuppers)
        if r1 - r0 > 3 and rnd.random() < 0.6:
            s = r1 - 0.35 if rnd.random() < 0.5 else r0 + 0.35
            if clear(s - 0.12, s + 0.12, 0.0, H):
                g = self.ground(e, s)
                self._edge_box(e, s - 0.12, s + 0.12, H - 0.55, H - 0.3, -0.25, 0.0, "galvanized")
                self.md.tube(self.P(e, s, H - 0.55, -0.13), self.P(e, s, g + 0.3, -0.13), 0.05, "galvanized", segments=6)
                self.md.tube(self.P(e, s, g + 0.3, -0.13), self.P(e, s, g + 0.05, -0.32), 0.05, "galvanized", segments=6)

    def corner_details(self, edges, exposure):
        if self.pal["wall"].startswith("cladding"):
            super().corner_details(edges, exposure)

    def roof_kit(self):
        t = self.b["type"]
        table = [("iroof_hvac_s", 1.6, 1.2, lambda: ki.hvac_unit(1.6, 1.1, 0.95)), ("iroof_hvac_s", 1.6, 1.2, lambda: ki.hvac_unit(1.6, 1.1, 0.95)),
                 ("iroof_vent", 0.5, 0.5, ki.roof_vent_stack), ("mroof_dish", 1.0, 1.0, km.satellite_dish)]
        if t == "apartment":
            table += [("mroof_tank", 2.6, 2.6, km.water_tank), ("mroof_hut", 2.8, 2.4, km.roof_hut)]
        elif t in ("commercial", "corner"):
            table += [("iroof_hvac", 2.4, 1.6, ki.hvac_unit), ("mroof_hut", 2.8, 2.4, km.roof_hut)]
        return table
