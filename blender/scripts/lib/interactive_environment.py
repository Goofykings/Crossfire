"""Small authored interactive set. Definitions and visual pivots share this source."""
import json
import math
from meshkit import MeshData, Transform
import props
import kit
import produce


def apple():
    m = MeshData()
    m.sphere((0, 0, 0), .075, 'fruit_apple', rings=6, segments=10, squash=.96)
    m.tube((0, .063, 0), (.006, .092, 0), .004, 'wood_dark', segments=5)
    m.face([(.005,.081,0),(.032,.089,.009),(.043,.081,.006),(.018,.078,-.003)], 'steel_green')
    return m

def pear():
    m=MeshData();m.sphere((0,-.015,0),.060,'paint_yellow',rings=6,segments=10)
    m.sphere((0,.033,0),.036,'paint_yellow',rings=5,segments=10)
    m.tube((0,.064,0),(.008,.09,0),.004,'wood_dark',segments=5)
    return m


def sign_panel(index):
    m=MeshData();m.merge(kit.hanging_sign(index,mount=False),Transform(0,.06,.53));return m

def hanging_light():
    m=MeshData();m.tube((0,0,0),(0,-.28,0),.012,'iron',segments=6)
    m.cylinder((0,-.32,0),.15,.06,'iron',segments=10,radius_top=.065)
    m.cylinder((0,-.47,0),.10,.15,'lantern_glass',segments=10)
    m.cylinder((0,-.49,0),.13,.025,'iron',segments=10)
    for k in range(4):
        a=k*math.pi/2;m.tube((math.cos(a)*.115,-.47,math.sin(a)*.115),(math.cos(a)*.115,-.32,math.sin(a)*.115),.008,'iron',segments=4)
    return m


def assets():
    result = {'apple': apple,'pear':pear,'hanging_light':hanging_light,'loose_crate': lambda: props.crate(.32,7),
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
    # Canvas slats stop bullets but cannot carry a player (no unauthored rooftop perch).
    for z in [-.7,-.2,.3,.7]: boxes.append({'c':[0,2.35+(z+.8)/1.6*.25,z],'h':[1.4,.035,.26],'yaw':0,'tag':'interactive-stall-canopy'})
    for i in range(3):
        x=-.8+i*.8
        # Conservative player/bullet shell; decorative spheres use the exact
        # tapered interior planes authored below instead of these broad slabs.
        boxes.append({'c':[x,.865,-.4],'h':[.325,.015,.265],'yaw':0,'tag':'interactive-bin'})
        for side in [-1,1]:
            boxes.append({'c':[x+side*.3425,.975,-.4],'h':[.0425,.125,.325],'yaw':0,'tag':'interactive-bin'})
            boxes.append({'c':[x,.975,-.4+side*.2825],'h':[.385,.125,.0425],'yaw':0,'tag':'interactive-bin'})
    box([-.7,.275,.45],[.275,.275,.275])
    box([.75,.35,.45],[.24,.35,.24])
    return boxes


def map_data(layout, collision, catalog):
    data={'version':1,'bodies':[],'signs':[],'lights':[],'basins':[],'replaceProps':[]}
    solids=list(collision['boxes'])
    stalls=0
    for i,p in enumerate(layout['props']+layout['obstacles']):
        xf=Transform(*p['pos'],yaw=-math.radians(p['heading']))
        if p['type']=='market_stall':
            stalls+=1
            produce_stall=stalls==1
            converted=[]
            for b in stall_boxes():
                converted.append({**b,'c':list(xf.point(b['c'])),'yaw':-math.radians(p['heading'])})
            data['replaceProps'].append({'index':i,'boxes':converted});solids+=converted
            # The 14-state interactive budget covers one stall's produce; any further stall
            # keeps its precise collision but sells from empty bins (no basins or fruit).
            for bin_index in (range(3) if produce_stall else ()):
                data['basins'].append({'position':list(xf.point((-.8+bin_index*.8,produce.FLOOR,-.4))),
                    'yaw':-math.radians(p['heading']),'halfWidth':produce.HALF_X,'halfDepth':produce.HALF_Z,
                    'height':produce.RIM-produce.FLOOR,'flare':produce.FLARE})
                cluster=produce.pile(bin_index)
                if bin_index:cluster=cluster[1:4 if bin_index==1 else 3]
                asset='pear' if bin_index==1 else 'apple'
                for k,(x,y,z) in enumerate(cluster):
                    data['bodies'].append({'id':f'{asset}-{i}-{bin_index}-{k}','asset':asset,
                        'position':list(xf.point((-.8+bin_index*.8+x,y,-.4+z))),
                        'radius':.075,'halfHeight':.075,'mass':.16,'yaw':.73*k+bin_index,
                        'tilt':[.22+k*.31,-.48+bin_index*.26+k*.17]})
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
    desired={'farmstead':[(-5.5,-13.5),(15.5,-9.5)],
             'european-town':[(-18.3,-9.3),(10.4,12.3)],
             'industrial-complex':[(-4.6,-9.6),(19.0,-0.5)],
             'modern-city':[(-19.0,2.0),(21.5,-12.5)]}
    for n,(x,z) in enumerate(desired[layout['id']]):
        radius,half,mass,asset=(.23,.16,1.2,'loose_crate') if n==0 else (.20,.20,2.5,'loose_barrel')
        candidate=next(((x+dx,z+dz) for dx,dz in [(0,0),(.6,0),(-.6,0),(0,.6),(0,-.6),(.6,.6),(-.6,-.6)]
                        if clear(x+dx,z+dz,radius,half)),None)
        if not candidate:raise ValueError(f'No clear interactive placement: {layout["id"]} {asset}')
        data['bodies'].append({'id':f'loose-{n}','asset':asset,'position':[candidate[0],half+.001,candidate[1]],
                              'radius':radius,'halfHeight':half,'mass':mass,'yaw':.15*n})
        solids.append({'c':[candidate[0],half,candidate[1]],'h':[radius,half,radius],'yaw':0})
    # One selected interior fixture per map; its plate remains in the static
    # ceiling mesh, while the chain/cage rotates about this actual suspension.
    if layout['id']=='farmstead':
        # the kitchen lamp: its plate is a ceiling fixture of the house (tools/farm_structures.py)
        data['lights'].append({'id':'light-house','asset':'hanging_light','position':[6.0,3.1,-4.5],'yaw':0})
        return data
    from circulation import point,dimensions
    b=next(b for b in layout['buildings'] if b.get('circulation'));w,d=dimensions(b)
    data['lights'].append({'id':'light-'+b['id'],'asset':'hanging_light',
        'position':point(b,w-.95,3.,d-2),'yaw':0})
    return data


def separate_signs(placements,data,building_id):
    for p in placements:
        if not p.name.startswith('hsign_') or len(data['signs'])>=2:continue
        index=int(p.name.split('_')[1]);yaw=math.atan2(p.xf.s,p.xf.c)
        data['signs'].append({'id':f'sign-{building_id}-{len(data["signs"])}','asset':f'sign_{index}',
                             'position':list(p.xf.point((0,-.06,-.53))),'yaw':yaw})
        p.name=f'hsign_mount_{index}'
        p.factory=lambda index=index:kit.hanging_sign(index,board=False)
