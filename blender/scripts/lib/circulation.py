"""Enclosed two-storey circulation, authored once for GLB solids and server OBBs.

Local x is east, v is south (optionally reflected for the warehouse). All
architectural parts are closed boxes with metre-scale thickness, not wall planes.
"""
from __future__ import annotations

BASE, LEVEL, MID, TOP, T = .02, 3.22, 1.62, 5.82, .3


def point(b, u, y, v):
    x0, z0, _, z1 = b['rect']
    return [x0+u, y, z1-v if b['circulation'].get('flipZ') else z0+v]


def box(b, r):
    a, c = point(b,*r[:3]), point(b,*r[3:])
    return [min(a[i],c[i]) for i in range(3)]+[max(a[i],c[i]) for i in range(3)]


def dimensions(b):
    x0,z0,x1,z1=b['rect'];return x1-x0,z1-z0


def local_parts(b):
    from collision_gen import subtract_all
    w,d=dimensions(b);c=b['circulation'];style=c['style'];door=c['doorV'];sw=c.get('stairWidth',w)
    wall={'town':'brick','industrial':'concrete_panel','city':'concrete_smooth_light'}[style]
    floor={'town':'interior_floor','industrial':'concrete_floor','city':'pavers'}[style]
    trim='wood_dark' if style=='town' else 'steel_grey' if style=='industrial' else 'aluminium'
    # The upper slab deliberately leaves a full-height open stairwell.
    yield [T,-.12,T,w-T,BASE,d-T],floor,'floor'
    yield [T,LEVEL-.22,5.4,w-T,LEVEL,d-T],floor,'upper-floor'
    if sw<w:yield [sw-T,LEVEL-.22,T,w-T,LEVEL,5.4],floor,'upper-side-floor'
    yield [0,TOP,0,w,TOP+.23,d],'roof_tiles' if style=='town' else 'concrete_floor','ceiling'
    yield [w-1.04,2.98,d-2.09,w-.86,3.,d-1.91],'iron','light-mount'
    holes=[]
    for side in ('w','e'):
        x=-.1 if side=='w' else w-T-.1
        holes.append([x,-.1,door-1.05,x+T+.2,2.5,door+1.05])
        yield [max(0,x),-.12,door-1.05,min(w,x+T+.2),BASE,door+1.05],floor,'threshold'
    # Third ground opening reconnects the shop/warehouse to its original route.
    for side,at in c.get('extraDoors',[]):
        z=-.1 if side=='n' else d-T-.1
        holes.append([at-1.05,-.1,z,at+1.05,2.5,z+T+.2])
        yield [at-1.05,-.12,max(0,z),at+1.05,BASE,min(d,z+T+.2)],floor,'threshold'
    x=-.1 if c['exit']=='w' else w-T-.1
    holes.append([x,LEVEL,door-1.,x+T+.2,LEVEL+2.45,door+1.])
    # Glazing is a closed six-centimetre solid, not a hole or a one-sided wall.
    for y in (3.9,):
        holes.append([w/2-1,y,-.1,w/2+1,y+1.25,T+.1])
        yield [w/2-1,y,.12,w/2+1,y+1.25,.18],'glass_wired' if style=='industrial' else 'glass_window','window'
    walls=[[0,BASE,0,w,TOP,T],[0,BASE,d-T,w,TOP,d],
           [0,BASE,T,T,TOP,d-T],[w-T,BASE,T,w,TOP,d-T]]
    for r in subtract_all(walls,holes):yield r,wall,'wall'
    # Eight risers per flight: 180 degree turn on a 2.7 m deep landing.
    yield [T,BASE,T,sw-T,MID,3.],floor,'turn-landing'
    for k in range(1,9):
        v=5.4-k*.3
        yield [sw-2.6,BASE,v,sw-T,BASE+k*.2,v+.3],floor,'stair-a'
        v=3.+(k-1)*.3
        yield [T,BASE,v,2.6,MID+k*.2,v+.3],floor,'stair-b'
    # Guard the upper opening without blocking either flight's landing.
    yield [2.65,LEVEL,5.36,sw-2.65,LEVEL+.95,5.43],trim,'stair-guard'
    if sw<w:yield [sw-T,LEVEL,T,sw-T+.06,LEVEL+.95,5.4],trim,'stair-side-guard'
    # Wall-mounted furniture and fixtures, off the ground and upper through routes.
    for y in (BASE,LEVEL):
        yield [w/2+1.1,y,d-.78,w/2+2.3,y+.82,d-T],trim,'cabinet'
        yield [w/2+1.06,y+.82,d-.8,w/2+2.34,y+.9,d-.28],'wood_dark' if style=='town' else 'metal_plate','counter'
    # Mount storage on solid masonry above the upper work area, never across
    # the north window or above the open stairwell.
    for y in (4.35,4.92):
        yield [w/2-.8,y,d-T-.35,w/2+.8,y+.07,d-T],trim,'shelf'
        for u in (w/2-.55,w/2+.12):
            yield [u,y+.07,d-T-.28,u+.32,y+.35,d-T-.04],'wood_crate' if style=='town' else 'plastic_grey','storage'
    for y,v in ((2.4,d-.32),(5.5,d-.32)):
        yield [w/2-.4,y,v-.08,w/2+.4,y+.13,v],'lantern_glass' if style=='town' else 'lamp_led','light'
    # Independent, usable upper exit with a supported landing and straight egress stair.
    sign=-1 if c['exit']=='w' else 1;edge=0 if sign<0 else w
    lo,hi=sorted((edge,edge+sign*1.6))
    yield [lo,LEVEL-.2,door-1.1,hi,LEVEL,door+1.1],floor,'exit-landing'
    for k in range(16):
        a,bb=sorted((edge+sign*(1.6+k*.28),edge+sign*(1.6+(k+1)*.28)))
        h=LEVEL*(16-k)/16
        yield [a,-.08,door-1.1,bb,h,door+1.1],floor,'exit-stair'
        for z in (door-1.1,door+1.04):
            yield [a,h+.84-LEVEL/16,z,bb,h+.92,z+.06],trim,'exit-slope-envelope'
            if k%4==0 or k==15:
                u=edge+sign*(1.6+(k+.5)*.28)
                rail_h=LEVEL*(1-(k+.5)/16)+.88
                yield [u-.03,h,z,u+.03,rail_h+.04,z+.06],trim,'exit-post'
    for z in (door-1.1,door+1.04):
        yield [lo,LEVEL+.84,z,hi,LEVEL+.92,z+.06],trim,'exit-rail'
        for u in (lo,hi-.06):yield [u,LEVEL,z,u+.06,LEVEL+.92,z+.06],trim,'exit-post'
    # A visible support under the outside landing, at the edges of the doorway.
    for z in (door-1.1,door+.98):
        u=edge+sign*1.45
        yield [u-.06,0,z,u+.06,LEVEL-.2,z+.12],trim,'exit-support'


def parts(b):
    for r,mat,kind in local_parts(b):yield box(b,r),mat,kind


def path(b):
    w,d=dimensions(b);v=b['circulation']['doorV'];sw=b['circulation'].get('stairWidth',w);side=b['circulation']['exit'];edge=0 if side=='w' else w;sign=-1 if side=='w' else 1
    # City enters through the north shop door: this keeps ground circulation
    # separate from its east fire escape rather than funneling players under it.
    approach=[point(b,6.7,0,-1.5),point(b,6.7,BASE,v)] if side=='e' else [point(b,w+1,BASE,v)]
    return approach+[point(b,sw-1.65,BASE,v),
            point(b,sw-1.65,MID,2.5),point(b,2.1,MID,2.5),
            point(b,2.1,LEVEL,v),point(b,edge+sign*.9,LEVEL,v),
            point(b,edge+sign*6.65,0,v)]


def generate(b):
    from meshkit import MeshData
    md=MeshData()
    for r,mat,kind in parts(b):
        if kind!='exit-slope-envelope':md.box(*r,mat)
    # A continuous rail welded to the landing rail and tread-mounted uprights.
    # The authoritative yaw-only OBBs conservatively enclose each short slope
    # section; visible geometry is a closed tube, rather than floating stairlets.
    c=b['circulation'];w,_=dimensions(b);edge=0 if c['exit']=='w' else w;sign=-1 if c['exit']=='w' else 1
    trim='wood_dark' if c['style']=='town' else 'steel_grey' if c['style']=='industrial' else 'aluminium'
    for z in (c['doorV']-1.07,c['doorV']+1.07):
        a=point(b,edge+sign*1.6,LEVEL+.88,z)
        end=point(b,edge+sign*(1.6+16*.28),.88,z)
        md.tube(a,end,.04,trim,segments=8)

    return md,[]
