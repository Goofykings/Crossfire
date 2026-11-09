"""Selected low service roofs, shared visible solids, and authored ladder regions (no bpy)."""
from meshkit import MeshData, Transform
import kit_industrial as kit


# Rooftop workshop cluster (2026-11 overhaul): every lot inside this block becomes a 4.5 m
# workshop with an accessible gravel deck. Three ladders give it three approaches (dock lane,
# workshop yard, service lane); HVAC plant breaks up the roof as cover.
ROOF_BLOCK = [17, -14, 35, -2]
LADDERS = [
    {'id': 'dock_lane', 'wall': [17, -8.5], 'out': [-1, 0], 'bottom': 0., 'top': 4.5},
    {'id': 'workshop_yard', 'wall': [25, -2], 'out': [0, 1], 'bottom': 0., 'top': 4.5},
    {'id': 'service_lane', 'wall': [23, -14], 'out': [0, -1], 'bottom': 0., 'top': 4.5},
]
EQUIPMENT = [
    {'kind': 'hvac', 'pos': [24.2, 4.5, -8.6], 'size': [1.8, .9, 1.1]},
    {'kind': 'fan', 'pos': [19.6, 4.5, -11.6], 'size': [.84, .9, .84]},
    {'kind': 'box', 'pos': [20.0, 4.5, -5.0], 'size': [.8, .75, .55]},
    {'kind': 'vent', 'pos': [25.4, 4.5, -4.6], 'size': [.44, 1., .44]},
]


def author(layout):
    # Two short maintenance-plinth shortcuts, not a map-wide crawl network.
    layout['slidePassages'] = [
        {'id': 'loading_service', 'center': [2, 2], 'width': 1.8, 'depth': .8, 'clearance': .96},
        {'id': 'storage_service', 'center': [-18, 15], 'width': 1.8, 'depth': .8, 'clearance': .96},
    ]
    x0, z0, x1, z1 = ROOF_BLOCK
    roofs = [b for b in layout['buildings'] if x0 <= b['rect'][0] and b['rect'][2] <= x1 and z0 <= b['rect'][1] and b['rect'][3] <= z1]
    assert roofs, 'rooftop workshop block has no lots'
    play_x1 = layout['playArea'][2]
    for b in list(roofs):
        b['height'] = 4.5
        b['floors'] = 1
        b['roof'] = {'type': 'flat'}
        b['serviceRoof'] = True
        rx0, rz0, rx1, rz1 = b['rect']
        if rx1 > play_x1:
            # The workshop roof stops at the play boundary; a taller backdrop block beyond it
            # closes the view (a perimeter lot used to extend the deck over the world's edge).
            b['rect'] = [rx0, rz0, play_x1, rz1]
            b['doors'] = [d for d in b.get('doors', []) if d['side'] != 'e' and
                          (d['side'] not in ('n', 's') or d['at'] + d['width'] / 2 < play_x1 - rx0 - .3)]
            layout['buildings'].append({'id': b['id'] + 'B', 'type': 'backdrop', 'rect': [play_x1, rz0, rx1, rz1],
                                        'height': 10.0, 'floors': 1, 'palette': 'concrete', 'seed': b.get('seed', 0) + 7,
                                        'roof': {'type': 'flat'}, 'front': 'w', 'doors': [], 'sign': 0})
    for l in LADDERS:
        x, z = l['wall']
        assert any(b['rect'][0] - 1e-6 <= x <= b['rect'][2] + 1e-6 and b['rect'][1] - 1e-6 <= z <= b['rect'][3] + 1e-6 for b in roofs),             f"ladder {l['id']} is not on a rooftop workshop wall"
    layout['ladders'] = [dict(l) for l in LADDERS]
    layout['roofEquipment'] = [dict(e) for e in EQUIPMENT]


def parts(layout):
    """All walking decks and blocking equipment use these exact solids in both exports."""
    for p in layout.get('slidePassages', []):
        x,z=p['center']; w=p['width']/2; d=p['depth']/2; h=p['clearance']; name=p['id']
        yield [x-w-.24,0,z-d,x-w,1.65,z+d], 'steel_grey', f'slide:{name}:left'
        yield [x+w,0,z-d,x+w+.24,1.65,z+d], 'steel_grey', f'slide:{name}:right'
        yield [x-w,h,z-d,x+w,1.65,z+d], 'steel_grey', f'slide:{name}:plinth'
        for dz in (-d-.025,d):
            yield [x-w-.24,h,z+dz,x+w+.24,h+.09,z+dz+.025], 'steel_yellow', f'slide:{name}:hazard'
    for b in layout['buildings']:
        if b.get('serviceRoof'):
            x0,z0,x1,z1 = b['rect']; h = b['height']
            yield [x0,h-.18,z0,x1,h,z1], 'roof_gravel', f"deck:{b['id']}"
    for l in layout.get('ladders',[]):
        x,z = l['wall']; nx,nz = l['out']; h = l['top']
        # Stand-off access leaves room for the longest equipped weapon. The
        # climb shaft is outside this landing slab, so it never crosses a ceiling.
        if nx:
            a,b = sorted((x,x+nx*1.2))
            r = [a,h-.14,z-.7,b,h,z+.7]
        else:
            a,b = sorted((z,z+nz*1.2))
            r = [x-.7,h-.14,a,x+.7,h,b]
        yield r,'metal_plate',f"landing:{l['id']}"
        # Rails and posts bound the landing without closing either end.
        def P(u,y,v): return [x+nz*u+nx*v,y,z-nx*u+nz*v]
        for u in (-.67,.67):
            a,b=P(u,h+1,0),P(u,h+1,1.2)
            yield [min(a[0],b[0])-.025,h+.975,min(a[2],b[2])-.025,
                   max(a[0],b[0])+.025,h+1.025,max(a[2],b[2])+.025], 'steel_yellow',f"rail:{l['id']}"
            for v in (0,1.2):
                p=P(u,h,v)
                yield [p[0]-.025,h,p[2]-.025,p[0]+.025,h+1,p[2]+.025], 'steel_yellow',f"post:{l['id']}"
    for e in layout.get('roofEquipment',[]):
        x,y,z=e['pos']; w,h,d=e['size']
        top = y+h+(.065 if e['kind']=='hvac' else 0)  # fan grilles above cabinet
        front = z-d/2-(.01 if e['kind']=='hvac' else 0)  # louvre blades
        yield [x-w/2,y,front,x+w/2,top,z+d/2], 'steel_white', f"equipment:{e['kind']}"
        if e['kind']=='hvac':
            # The existing kit's duct stands 60 cm proud of the cabinet.
            yield [x+w/2-.5,y+.4,z+d/2,x+w/2-.1,y+.8,z+d/2+.6], 'galvanized', 'equipment:hvac_duct'


def build(md, layout):
    for box,mat,part in parts(layout):
        if not part.startswith('equipment:'):
            # Existing facades close deck edges. Repeating them here would
            # put the roof fascia and building skin on precisely the same plane.
            if part.startswith(('rail:','post:')):
                continue  # round visible rails below use these collision envelopes
            md.box(*box,mat,skip=('nx','px','nz','pz') if part.startswith('deck:') else ())
    for l in layout.get('ladders',[]):
        x,z=l['wall']; nx,nz=l['out']; bottom,top=l['bottom'],l['top']
        def P(u,y,v): return (x+nz*u+nx*v,y,z-nx*u+nz*v)
        for u in (-.29,.29):
            md.tube(P(u,bottom+.05,1.25),P(u,top+1,1.25),.028,'galvanized',segments=8)
            for y in (bottom+.2,top-.35):
                md.tube(P(u,y,.03),P(u,y,1.25),.025,'steel_dark',segments=6)
        y=bottom+.2
        while y<top:
            md.tube(P(-.29,y,1.25),P(.29,y,1.25),.022,'galvanized',segments=8)
            y+=.28
        # Side handrails on the top landing; its approach and roof exit stay open.
        for u in (-.67,.67):
            md.tube(P(u,top+1,0),P(u,top+1,1.2),.025,'steel_yellow',segments=6)
            for v in (0,1.2):
                md.tube(P(u,top,v),P(u,top+1,v),.025,'steel_yellow',segments=6)
    for e in layout.get('roofEquipment',[]):
        x,y,z=e['pos']; w,h,d=e['size']
        if e['kind']=='hvac': mesh=kit.hvac_unit(w,d,h)
        elif e['kind']=='fan': mesh=kit.extractor_fan(.3)
        elif e['kind']=='vent': mesh=kit.roof_vent_stack(.8)
        else:
            mesh=MeshData();mesh.box(-w/2,0,-d/2,w/2,h,d/2,'steel_grey')
        md.merge(mesh,Transform(x,y,z))
