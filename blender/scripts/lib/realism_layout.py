"""Targeted, idempotent finishing pass over the existing compact layouts."""
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from circulation import BASE, LEVEL, point, path


# One enclosed two-storey circulation building per map. Town and later overhauled maps select
# it by the authored through-room rectangle, so regenerating lots cannot retarget it silently.
CIRCULATION = {
    'european-town': {'room': [-12, 9, -5, 12], 'style': 'town', 'flip': False, 'exit': 'w', 'door': 6.8,
                      'stair': 7, 'extra': [], 'purpose': 'Garden provisions shop and apartment'},
    'industrial-complex': {'interior': 'dispatch_hall', 'style': 'industrial', 'flip': True, 'exit': 'w', 'door': 6.,
                           'stair': 7, 'extra': [['s', 6.], ['n', 9.]], 'purpose': 'Warehouse dispatch and elevated office'},
    'modern-city': {'interior': 'commerce_hall', 'style': 'city', 'flip': False, 'exit': 'e', 'door': 5.8,
                    'stair': 5.7, 'extra': [['n', 6.7], ['s', 4.]], 'purpose': 'Commercial service building and upper office'},
}


def circulation_building(layout):
    spec = CIRCULATION[layout['id']]
    if 'room' in spec:
        found = [b for b in layout['buildings'] if any(r['rect'] == spec['room'] for r in b.get('rooms', []))]
    elif 'interior' in spec:
        found = [b for b in layout['buildings'] if any(i['id'] == spec['interior'] for i in b.get('interiors', []))]
    else:
        found = [b for b in layout['buildings'] if b['id'] == spec['building']]
    assert len(found) == 1, f"{layout['id']}: circulation building not found"
    return found[0], spec


def _blocks_route(p,route,half=1.2,end=1.0):
    from catalog import PROPS
    collider=PROPS.get(p['type'],{}).get('collider')
    if not collider:
        return False  # wall fittings and flush grates have no body to block anyone
    sx,_,sz=collider
    r=math.hypot(sx,sz)*.5;x,z=p['pos'][0],p['pos'][2]
    def seg(a,c):
        dx,dz=c[0]-a[0],c[2]-a[2];L=dx*dx+dz*dz
        t=0 if L==0 else max(0,min(1,((x-a[0])*dx+(z-a[2])*dz)/L))
        return math.hypot(x-a[0]-t*dx,z-a[2]-t*dz)
    hit=seg(route[0],route[0])<r+end or seg(route[-1],route[-1])<r+end or seg(route[-3],route[-1])<r+half
    if hit:print(f"circulation clearance: dropped {p['type']} at {p['pos']}")
    return hit


def author(layout):
    mid=layout['id']
    b, spec = circulation_building(layout)
    bid,style,flip,exit_side,door=b['id'],spec['style'],spec['flip'],spec['exit'],spec['door']
    b['circulation']={'style':style,'flipZ':flip,'exit':exit_side,'doorV':door,'stairWidth':spec['stair'],
                      'extraDoors':[list(e) for e in spec['extra']]}
    # Keep old route cavities as navigation annotations; the new shared solids
    # author the actual enclosed envelope, doors, floors and both staircases.
    layout.setdefault('circulationRoutes',[])
    layout['circulationRoutes']=[r for r in layout['circulationRoutes'] if r['id']!=bid]
    layout['circulationRoutes'].append({'id':bid,'height':LEVEL,'waypoints':path(b)})
    b['purpose']=spec['purpose']
    layout['version']=3
    # Dressing placed before the fit-out (racks, pallets) would stand in the new stairs and
    # aisle; the circulation solids carry their own counters, cabinets and shelves.
    x0,z0,x1,z1=b['rect']
    layout['props']=[p for p in layout['props'] if not (x0<p['pos'][0]<x1 and z0<p['pos'][2]<z1)]
    # The clearance pass ran before these solids existed: keep the street approach to the
    # entry, the exterior exit stair and the landing at its foot clear as well.
    layout['props']=[p for p in layout['props'] if not _blocks_route(p,path(b))]
    # Two short-range practical lights, anchored to solid ceiling/wall fixtures.
    layout['lights']=[l for l in layout['lights'] if l.get('circulation')!=bid]
    w=b['rect'][2]-b['rect'][0];d=b['rect'][3]-b['rect'][1]
    if style!='town':
        from circulation import box
        doors=[]
        for side in ('w','e'):
            u=0 if side=='w' else w-.3;r=box(b,[u,0,door-1.05,u+.3,2.5,door+1.05])
            doors.append({'side':side,'rect':[r[0],r[2],r[3],r[5]],'height':2.5,'kind':'doorway'})
        for side,u in b['circulation']['extraDoors']:
            v=0 if side=='n' else d-.3;r=box(b,[u-1.05,0,v,u+1.05,2.5,v+.3])
            doors.append({'side':({'n':'s','s':'n'}[side] if flip else side),'rect':[r[0],r[2],r[3],r[5]],'height':2.5,'kind':'doorway'})
        old=b['interiors'][0]
        old['doors']=doors;old['clear']=5.82
        layout['ground']['covered']=[r for r in layout['ground']['covered'] if not r['id'].startswith(old['id']+'_door')]
        layout['ground']['covered'] += [{'id':old['id']+'_door'+str(i),'kind':'doorway','rect':a['rect']} for i,a in enumerate(doors)]
    layout['navigation']['coveredRoutes']=layout['ground']['covered']
    # Navigation and the tactical overlay describe the new envelope, not the
    # old empty room. The central through aisle remains clear at ground level.
    from circulation import box, parts
    old_rects=[r['rect'] for r in b.get('rooms',[])+b.get('interiors',[])]
    aisle=box(b,[0,0,door-1.,w,0,door+1.])
    for region in layout['ground']['covered']:
        if region['rect'] in old_rects:region['rect']=[aisle[0],aisle[2],aisle[3],aisle[5]]
    covered=layout['ground']['covered']
    covered[:]=[r for r in covered if not r['id'].startswith(bid+'_circulation_')]
    for i,(side,u) in enumerate(b['circulation']['extraDoors']):
        v=0 if side=='n' else d
        r=box(b,[u-1.05,0,min(v,door),u+1.05,0,max(v,door)])
        covered.append({'id':bid+'_circulation_'+str(i),'kind':'interior','rect':[r[0],r[2],r[3],r[5]]})
    obstacles=layout['navigation']['groundObstacles']
    obstacles[:]=[p for p in obstacles if not p['id'].startswith('circulation:')]
    for r,_,kind in parts(b):
        if r[1]<1.7 and r[4]>.47:
            obstacles.append({'id':f'circulation:{bid}:{kind}','rect':[r[0],r[2],r[3],r[5]]})
    for y in (2.2,5.3):
        layout['lights'].append({'type':'point','pos':point(b,w/2,y,d-.9),'color':[1,.9,.76] if style=='town' else [.85,.93,1],
                                 'intensity':.65,'range':4.5,'circulation':bid})


if __name__=='__main__':
    import json,sys
    from pathlib import Path
    root=Path(__file__).resolve().parents[3]
    for mid in ('european-town','industrial-complex','modern-city'):
        f=root/'src/maps'/mid/'layout.json';layout=json.loads(f.read_text(encoding='utf8'));author(layout)
        f.write_text(json.dumps(layout,indent=1)+'\n',encoding='utf8')
