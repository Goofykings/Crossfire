"""Original Foundry Collection. Pure geometry/data shared by texture authoring and Blender.

All coordinates match lib/weapon.py; no gameplay data or live catalog is changed.
"""
from pathlib import Path
import sys
import math

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'blender/scripts/lib'))
import weapon
from meshkit import face_normal

ITEMS = [
    dict(id='verdant-relay', name='Verdant Relay', weapon='rifle', folder='ar', rarity='uncommon',
         color=(83, 100, 67), accent=(174, 183, 124), roughness=.64, metallic=.16, seed=841),
    dict(id='blue-current', name='Blue Current', weapon='smg', folder='smg', rarity='rare',
         color=(24, 70, 119), accent=(77, 178, 206), roughness=.39, metallic=.64, seed=913),
    dict(id='crimson-forge', name='Crimson Forge', weapon='shotgun', folder='shotgun', rarity='epic',
         color=(139, 28, 39), accent=(219, 104, 87), roughness=.42, metallic=.24, seed=1017),
    dict(id='aurum-meridian', name='Aurum Meridian', weapon='sniper', folder='sniper', rarity='legendary',
         color=(38, 42, 48), accent=(195, 156, 75), roughness=.43, metallic=.36, seed=1193),
]


def directory(item):
    return ROOT / 'public/assets/cosmetics' / item['folder'] / item['id']


def build(item):
    parts, anchors = weapon.WEAPONS[item['weapon']]()
    # Flush the original flat vent decals onto the furniture's actual bevel-inset side.
    if item['weapon'] in ('shotgun', 'smg'):
        target = parts['pump'] if item['weapon'] == 'shotgun' else parts['body']
        old, new = (.0241, .0178) if item['weapon'] == 'shotgun' else (.0316, .0273)
        for i, p in enumerate(target.verts):
            if abs(abs(p[0]) - old) < .00001:
                target.verts[i] = (math.copysign(new, p[0]), p[1], p[2])
    body = parts['body']
    # Embossed solid inserts, intersecting the supporting surface by 0.5 mm.
    # These remain within the existing weapon envelope and never touch grip/sight frames.
    if item['weapon'] == 'smg':
        for s in (-1, 1):
            weapon.solid(body, [(-.062,.045),(-.085,.058),(-.215,.058),(-.225,.051),(-.085,.051)],
                         *sorted((s*.0225,s*.0245)), 'collection_accent', .0004)
    if item['weapon'] == 'shotgun':
        for s in (-1, 1):
            for k in range(3):
                z=.20+k*.035
                weapon.solid(body, [(z,.023),(z+.011,.035),(z+.022,.023)],
                             *sorted((s*.013,s*.0152)), 'collection_accent', .0004)
            weapon.solid(body, [(-.075,.025),(-.065,.062),(.004,.062),(.012,.052),(.012,.025)],
                         *sorted((s*.013,s*.015)), 'collection_finish', .0008)
            # Thin engraved strip at the upper pump, part of pump mesh so it moves with it.
            weapon.solid(parts['pump'], [(-.265,.042),(-.265,.046),(-.405,.046),(-.405,.042)],
                         *sorted((s*.017,s*.0187)), 'collection_accent', .0003)
    if item['weapon'] == 'sniper':
        for s in (-1, 1):
            # Angular meridian inlay on the stock, kept off grip, cheek and butt contacts.
            weapon.solid(body, [(.13,.018),(.26,.028),(.355,.017),(.355,.01),(.26,.021),(.13,.012)],
                         *sorted((s*.0145,s*.0162)), 'collection_accent', .0004)
            for k in range(5):
                z=.27+k*.013
                weapon.solid(body, [(z,-.005),(z+.008,.012),(z+.011,.012),(z+.003,-.005)],
                             *sorted((s*.0145,s*.016)), 'collection_accent', .0003)
            weapon.solid(body, [(-.13,.039),(-.43,.039),(-.43,.042),(-.13,.042)],
                         *sorted((s*.0175,s*.0193)), 'collection_accent', .0003)
        # Open rings follow the optical housing; neither lens nor sight line is capped.
        for a,b,r in [(-.278,-.282,.0267),(-.324,-.329,.0267),(.088,.092,.0193)]:
            weapon.ztube(body,a,b,.122,r,'collection_accent',sides=24,caps=(False,False))
    for part, md in parts.items():
        for i, material in enumerate(md.face_mat):
            if material.startswith('collection_'):
                continue
            if (item['weapon']=='rifle' and material in ('gun_fde','gun_black')
                or item['weapon']=='smg' and material=='gun_black'
                or item['weapon']=='shotgun' and material=='gun_wood'
                or item['weapon']=='sniper' and material=='gun_black'):
                # Sights stay matte charcoal, retaining legibility and the original opening.
                pts=[md.verts[v] for v in md.faces[i]]
                center=tuple(sum(p[a] for p in pts)/len(pts) for a in range(3))
                if item['weapon']=='sniper' and -.336<center[2]<-.275 and center[1]>.09:
                    md.face_mat[i]='collection_accent'  # Satin-gold objective housing, original optical opening.
                else:
                    md.face_mat[i] = 'collection_graphite' if item['weapon']=='smg' and center[1]>.10 else 'collection_finish'
            elif material in ('gun_polymer','gun_fde','gun_wood'):
                md.face_mat[i]='collection_graphite'
            elif material=='gun_steel':
                md.face_mat[i]='collection_steel'
    points=[v for md in parts.values() for v in md.verts]
    bounds=tuple((min(p[a] for p in points),max(p[a] for p in points)) for a in range(3))
    for md in parts.values():
        for i, f in enumerate(md.faces):
            if md.face_mat[i]=='reticle_holo':
                continue  # Original reticle UVs must not be reprojected.
            pts=[md.verts[v] for v in f]
            md.face_uv[i]=[uv(p,face_normal(pts),bounds) for p in pts]
    return parts, anchors, bounds


def uv(p,n,bounds):
    x,y,z=[(p[a]-bounds[a][0])/(bounds[a][1]-bounds[a][0]) for a in range(3)]
    axis=max(range(3),key=lambda a:abs(n[a]))
    return (((1-z)*.5 if n[0]>0 else .5+z*.5),.65*y) if axis==0 else (z,.65+.20*x) if axis==1 else (x,.85+.15*y)
