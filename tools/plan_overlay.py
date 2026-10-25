"""Render docs/european-town-plan-dressed.png from layout.json (props, targets, arches, terraces)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
L = json.loads((ROOT / "src/maps/european-town/layout.json").read_text(encoding="utf-8"))
OUT = L["outerLimit"]
S = 12
img = Image.new("RGB", (OUT * 2 * S, OUT * 2 * S), (28, 30, 36))
d = ImageDraw.Draw(img)
P = lambda x, z: ((x + OUT) * S, (z + OUT) * S)
col = {"street": (205, 198, 182), "yard": (214, 205, 180), "court": (190, 210, 170), "plaza": (230, 214, 170),
       "terrace": (225, 185, 140)}
for zn in L["ground"]["zones"]:
    x0, z0, x1, z1 = zn["rect"]
    c = col.get(zn["kind"], (120, 160, 230) if zn.get("team") == "blue" else (230, 120, 120))
    d.rectangle([*P(x0, z0), *P(x1, z1)], fill=c)
for cv in L["ground"]["covered"]:
    d.rectangle([*P(*cv["rect"][:2]), *P(*cv["rect"][2:])], fill=(150, 125, 140))
tcol = {"backdrop": (60, 62, 70), "stone2": (120, 110, 95), "plaster3": (170, 150, 120), "shop": (90, 130, 150),
        "corner": (150, 90, 90), "balcony": (140, 120, 170), "room": (110, 80, 120), "archway": (90, 140, 90),
        "narrow_passage": (80, 120, 80)}
for b in L["buildings"]:
    x0, z0, x1, z1 = b["rect"]
    d.rectangle([*P(x0, z0), P(x1, z1)[0] - 1, P(x1, z1)[1] - 1], fill=tcol[b["type"]], outline=(20, 20, 20))
    d.text((P(x0, z0)[0] + 3, P(x0, z0)[1] + 2), f'{b["id"]} {b["type"][:5]} {b["floors"]}f', fill=(255, 255, 220))
    for door in b["doors"]:
        s, at = door["side"], door["at"]
        px, pz = {"n": (x0 + at, z0), "s": (x0 + at, z1), "w": (x0, z0 + at), "e": (x1, z0 + at)}[s]
        d.ellipse([P(px, pz)[0] - 4, P(px, pz)[1] - 4, P(px, pz)[0] + 4, P(px, pz)[1] + 4], fill=(250, 220, 60))
for w in L["walls"]:
    d.rectangle([*P(*w["rect"][:2]), *P(*w["rect"][2:])], fill=(100, 100, 100))
for t in L["terraces"]:
    for st in t["stairs"]:
        x0, z0, x1, z1 = t["rect"]
        dep = st["steps"] * st["run"]
        r = {"n": (st["from"], z0, st["to"], z0 + dep), "s": (st["from"], z1 - dep, st["to"], z1),
             "w": (x0, st["from"], x0 + dep, st["to"]), "e": (x1 - dep, st["from"], x1, st["to"])}[st["side"]]
        d.rectangle([*P(r[0], r[1]), *P(r[2], r[3])], fill=(255, 140, 40))
for a in L["arches"]:
    d.rectangle([*P(*a["rect"][:2]), *P(*a["rect"][2:])], outline=(255, 255, 255), width=2)
pc = {"drain_grate": (60, 60, 60), "flower_pot": (60, 170, 60), "flower_pot_large": (40, 140, 40),
      "wall_lantern": (255, 230, 120), "street_lantern": (255, 200, 60)}
for p in L["props"]:
    x, _, z = p["pos"]
    c = pc.get(p["type"], (150, 90, 40))
    r = 3 if p["type"] != "market_stall" else 8
    d.rectangle([P(x, z)[0] - r, P(x, z)[1] - r, P(x, z)[0] + r, P(x, z)[1] + r], fill=c)
for t in L["targets"]:
    x, _, z = t["pos"]
    d.ellipse([P(x, z)[0] - 6, P(x, z)[1] - 6, P(x, z)[0] + 6, P(x, z)[1] + 6], outline=(255, 40, 40), width=3)
for s in L["spawns"]:
    x, _, z = s["pos"]
    d.polygon([(P(x, z)[0], P(x, z)[1] - 5), (P(x, z)[0] - 4, P(x, z)[1] + 4), (P(x, z)[0] + 4, P(x, z)[1] + 4)],
              fill=(255, 255, 255))
img.save(ROOT / "docs/european-town-plan-dressed.png")
print("ok")
