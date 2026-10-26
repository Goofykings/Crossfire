"""Spatial queries over layout.json used by the Blender generators (pure Python).

`LayoutIndex.classify(x, z)` tells what occupies a point on the plan; `ground_at` gives the walking
surface height (terraces, courts, stairs) so doors and props sit on the right level.
"""
from __future__ import annotations

import building_spec as bs
from collision_gen import stair_rects


def in_rect(x: float, z: float, r, eps: float = 0.0) -> bool:
    return r[0] - eps <= x <= r[2] + eps and r[1] - eps <= z <= r[3] + eps


class LayoutIndex:
    def __init__(self, layout: dict):
        self.layout = layout
        self.zones = layout["ground"]["zones"]
        self.covered = layout["ground"]["covered"]
        self.buildings = layout["buildings"]
        self.by_id = {b["id"]: b for b in self.buildings}
        self.walls = layout["walls"]
        self.play = layout["playArea"]
        self.steps = []
        for t in layout["terraces"]:
            for st, k, r, top in stair_rects(t):
                self.steps.append((r, top))

    def classify(self, x: float, z: float):
        # covered ground: passages, walk-through rooms, interiors and their doorways (all listed in ground.covered)
        for c in self.covered:
            if in_rect(x, z, c["rect"]):
                return "covered", c
        for zn in self.zones:
            if in_rect(x, z, zn["rect"]):
                return "open", zn
        for b in self.buildings:
            r = b["rect"]
            if r[0] < x < r[2] and r[1] < z < r[3]:
                return "building", b
        for w in self.walls:
            r = w["rect"]
            if r[0] < x < r[2] and r[1] < z < r[3]:
                return "wall", w
        p = self.play
        if not (p[0] <= x <= p[2] and p[1] <= z <= p[3]):
            return "outside", None
        return "solid", None

    def building_at(self, x: float, z: float):
        """The building whose footprint rectangle contains the point, if any."""
        for b in self.buildings:
            r = b["rect"]
            if r[0] < x < r[2] and r[1] < z < r[3]:
                return b
        return None

    def ground_at(self, x: float, z: float) -> float:
        for r, top in self.steps:
            if in_rect(x, z, r):
                return top
        best = 0.0
        hit = False
        for zn in self.zones:
            if in_rect(x, z, zn["rect"]):
                best = max(best, zn["height"]) if hit else zn["height"]
                hit = True
        return best

    # walls that do not fill their lot: chain-link fences and railings are see-through, pillar shafts are inset from the
    # lot edges. A building next to one must build its own wall, or you see into (and through) it.
    OPEN_WALLS = ("fence", "railing", "pillar")

    def neighbour_height(self, x: float, z: float) -> float:
        """Height that hides a wall at this outside point: neighbour eave, wall height, or 0."""
        kind, obj = self.classify(x, z)
        if kind == "building":
            return bs.eave_height(obj)
        if kind == "wall":
            return 0.0 if obj.get("style") in self.OPEN_WALLS else obj["height"]
        return 0.0
