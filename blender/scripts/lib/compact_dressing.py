"""Clearance pass for reauthored maps, before spawn sampling (no bpy required)."""
from __future__ import annotations
import math
from collision_gen import map_collision
from layout_util import LayoutIndex, in_rect
from upper_routes import deck_rect, route_parts


def finish_layout(layout, catalog):
    idx = LayoutIndex(layout)
    boxes = map_collision(layout)["boxes"]
    reserved = [r["rect"] for r in layout.get("upperRoutes", [])]
    portals = [c["rect"] for c in layout["ground"]["covered"] if c["kind"] in ('doorway', 'passage')]
    doors = []
    import building_spec as bs
    for b in layout['buildings']:
        for d in b.get('doors', []):
            doors.append((*bs.side_point(b,d['side'],d['at'],.7), d['width']/2+.5))

    def blocked(x,y,z,margin=.06):
        return any(abs(x-b['c'][0]) < b['h'][0]+margin and
                   abs(z-b['c'][2]) < b['h'][2]+margin and
                   b['c'][1]-b['h'][1] < y < b['c'][1]+b['h'][1]
                   for b in boxes)

    def samples(p, size):
        yaw = -math.radians(p['heading'])
        c,s = math.cos(yaw),math.sin(yaw)
        for a in (-.5,0,.5):
            for b in (-.5,0,.5):
                dx,dz = size[0]*a,size[2]*b
                yield p['pos'][0]+dx*c+dz*s,p['pos'][2]-dx*s+dz*c

    accepted=[]
    for p in layout['props']:
        size=catalog[p['type']]['size']
        if size[1]>3 and catalog[p['type']].get('collider'):
            # Lamp arms and pole crossbars overhang the pavement; only their
            # actual base needs ground support and room beside a facade.
            c=catalog[p['type']]['collider']
            size=[c[0],size[1],c[2]]
        x,y,z=p['pos']
        # Wall fittings keep their intentional facade attachment and have no body collider.
        if p['type'] == 'wall_lantern':
            if in_rect(x,z,layout['playArea'],1): accepted.append(p)
            continue
        pts=list(samples(p,size))
        if any(not in_rect(px,pz,layout['playArea']) for px,pz in pts): continue
        if any(in_rect(px,pz,r,.55) for px,pz in pts for r in reserved): continue
        if any(in_rect(px,pz,r,.4) for px,pz in pts for r in portals): continue
        if any(math.hypot(x-dx,z-dz)<radius+max(size[0],size[2])*.5 for dx,dz,radius in doors): continue
        if any(idx.classify(px,pz)[0] not in ('open','covered') for px,pz in pts): continue
        heights=[idx.ground_at(px,pz) for px,pz in pts]
        if max(heights)-min(heights)>.035: continue
        floor=max(heights)
        # Thin grates intentionally sit 4 mm proud of the pavement.
        p['pos'][1]=round(floor+(.004 if p['type']=='drain_grate' else 0),3)
        if any(blocked(px,floor+min(.3,size[1]*.5),pz) for px,pz in pts): continue
        rad=math.hypot(size[0],size[2])*.5
        if any(q['type']!='wall_lantern' and math.hypot(x-q['pos'][0],z-q['pos'][2]) <
               rad+math.hypot(*[catalog[q['type']]['size'][k] for k in (0,2)])*.5+.12 for q in accepted): continue
        accepted.append(p)
    print(f"clearance: {len(layout['props'])} -> {len(accepted)} props")
    layout['props']=accepted
    if 'wires' in layout:
        poles=[p['pos'] for p in accepted if p['type']=='utility_pole']
        layout['wires']=[w for w in layout['wires'] if all(any(math.hypot(end[0]-p[0],end[2]-p[2])<.01 for p in poles) for end in (w['a'],w['b']))]
    # Targets remain practice-only details; never put them in walls/stairs/doorways.
    targets=[]
    for zone in layout['ground']['zones']:
        r=zone['rect']; x,z=(r[0]+r[2])/2,(r[1]+r[3])/2
        if min(r[2]-r[0],r[3]-r[1])<3 or zone['kind']=='sidewalk': continue
        if any(in_rect(x,z,rr,1) for rr in reserved+portals): continue
        if blocked(x,zone['height']+1,z,.5): continue
        if any(math.hypot(x-p['pos'][0],z-p['pos'][2])<2 for p in accepted+layout.get('obstacles',[]) if catalog[p['type']].get('collider')): continue
        if any(math.hypot(x-t['pos'][0],z-t['pos'][2])<5 for t in targets): continue
        targets.append({'id':f'T{len(targets)+1:02d}','pos':[x,zone['height'],z],'heading':90 if r[2]-r[0]>=r[3]-r[1] else 0})
    layout['targets']=targets[:16]
    layout['version']=2
    layout['navigation']={'version':1,'groundRoutes':[
        {k:z[k] for k in ('id','kind','rect')} for z in layout['ground']['zones'] if z['kind']!='sidewalk'],
        'coveredRoutes':layout['ground']['covered'], 'upperRoutes':[], 'groundObstacles':[]}
    for route in layout.get('upperRoutes',[]):
        for box, _, part in route_parts(route):
            if box[1]<1.7 and box[4]>.42:
                layout['navigation']['groundObstacles'].append({'id':f"{route['id']}:{part}", 'rect':[box[0],box[2],box[3],box[5]]})
        x0,z0,x1,z1=route['rect']; d=deck_rect(route); h=route['height']
        if z1-z0>x1-x0:
            x=(x0+x1)/2
            path=[[x,0,z0-.65],[x,h,d[1]+.5],[x,h,d[3]-.5],[x,0,z1+.65]]
        else:
            z=(z0+z1)/2
            path=[[x0-.65,0,z],[d[0]+.5,h,z],[d[2]-.5,h,z],[x1+.65,0,z]]
        layout['navigation']['upperRoutes'].append({'id':route['id'],'waypoints':path})
