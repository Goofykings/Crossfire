"""Small authored interactive set. Definitions and visual pivots share this source."""
import json
import math
from meshkit import MeshData, Transform
import props
import kit


def apple():
    m = MeshData()
    m.sphere((0, 0, 0), .075, 'fruit_apple', rings=6, segments=10, squash=.96)
    m.tube((0, .063, 0), (.006, .092, 0), .004, 'wood_dark', segments=5)
    m.face([(.005,.081,0),(.032,.089,.009),(.043,.081,.006),(.018,.078,-.003)], 'steel_green')
    return m


def sign_panel(index):
    m=MeshData();m.merge(kit.hanging_sign(index,mount=False),Transform(0,.06,.53));return m


def assets():
    result = {'apple': apple, 'loose_crate': lambda: props.crate(.32,7),
              'loose_barrel': lambda: props.barrel(.40,.19,8)}
    for i in range(8):
        result[f'sign_{i}'] = lambda i=i: sign_panel(i)
    return result


def stall_boxes():
    boxes=[]
    def box(c,h): boxes.append({'c':c,'h':h,'yaw':0,'tag':'interactive-stall'})
    box([0,.425,-.4],[1.2,.425,.35])
    for x in [-1.25,1.25]:
        for z in [-.75,.75]: box([x,1.2,z],[.05,1.2,.05])
    for z in [-.7,-.2,.3,.7]: box([0,2.35+(z+.8)/1.6*.25,z],[1.4,.035,.26])
    for i in range(3):
        x=-.8+i*.8
        box([x,.95,-.4],[.36,.02,.30])
        for side in [-1,1]:
            box([x+side*.3475,.935,-.4],[.0125,.085,.3])
            box([x,.935,-.4+side*.2875],[.36,.085,.0125])
    box([-.7,.275,.45],[.275,.275,.275])
    box([.75,.35,.45],[.24,.35,.24])
    return boxes


def map_data(layout, collision, catalog):
    data={'version':1,'bodies':[],'signs':[],'replaceProps':[]}
    solids=list(collision['boxes'])
    for i,p in enumerate(layout['props']+layout['obstacles']):
        xf=Transform(*p['pos'],yaw=-math.radians(p['heading']))
        if p['type']=='market_stall':
            converted=[]
            for b in stall_boxes():
                converted.append({**b,'c':list(xf.point(b['c'])),'yaw':-math.radians(p['heading'])})
            data['replaceProps'].append({'index':i,'boxes':converted});solids+=converted
            for bin_index in range(2):
                for k in range(3):
                    data['bodies'].append({'id':f'apple-{i}-{bin_index}-{k}','asset':'apple',
                        'position':list(xf.point((-.8+bin_index*.8+(k-1)*.18,1.045,-.4))),
                        'radius':.075,'halfHeight':.075,'mass':.16,'yaw':0})
            continue
        size=catalog['props'].get(p['type'],{}).get('collider')
        if size:
            w,h,d=size
            solids.append({'c':[p['pos'][0],p['pos'][1]+h/2,p['pos'][2]],'h':[w/2,h/2,d/2],
                           'yaw':-math.radians(p['heading'])})
    def clear(x,z,r,h):
        if any(math.hypot(x-s['pos'][0],z-s['pos'][2])<2 for s in layout['spawns']):return False
        for b in solids:
            if b['c'][1]+b['h'][1] <= .002 or b['c'][1]-b['h'][1]>=h*2:continue
            c,s=math.cos(b['yaw']),math.sin(b['yaw']);dx,dz=x-b['c'][0],z-b['c'][2]
            lx,lz=dx*c-dz*s,dx*s+dz*c
            if max(abs(lx)-b['h'][0],0)**2+max(abs(lz)-b['h'][2],0)**2<r*r:return False
        return True
    desired={'european-town':[(14.9,-11.9),(14.9,-12.4)],
             'industrial-complex':[(-5.8,-17.5),(-6.4,-17.5)],
             'modern-city':[(-3,3.7),(-19.3,-7)]}
    for n,(x,z) in enumerate(desired[layout['id']]):
        radius,half,mass,asset=(.23,.16,1.2,'loose_crate') if n==0 else (.20,.20,2.5,'loose_barrel')
        candidate=next(((x+dx,z+dz) for dx,dz in [(0,0),(.6,0),(-.6,0),(0,.6),(0,-.6),(.6,.6),(-.6,-.6)]
                        if clear(x+dx,z+dz,radius,half)),None)
        if not candidate:raise ValueError(f'No clear interactive placement: {layout["id"]} {asset}')
        data['bodies'].append({'id':f'loose-{n}','asset':asset,'position':[candidate[0],half+.001,candidate[1]],
                              'radius':radius,'halfHeight':half,'mass':mass,'yaw':.15*n})
        solids.append({'c':[candidate[0],half,candidate[1]],'h':[radius,half,radius],'yaw':0})
    return data


def separate_signs(placements,data,building_id):
    for p in placements:
        if not p.name.startswith('hsign_') or len(data['signs'])>=2:continue
        index=int(p.name.split('_')[1]);yaw=math.atan2(p.xf.s,p.xf.c)
        data['signs'].append({'id':f'sign-{building_id}-{len(data["signs"])}','asset':f'sign_{index}',
                             'position':list(p.xf.point((0,-.06,-.53))),'yaw':yaw})
        p.name=f'hsign_mount_{index}'
        p.factory=lambda index=index:kit.hanging_sign(index,board=False)
