"""Targeted, idempotent finishing pass over the existing compact layouts."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from circulation import BASE, LEVEL, point, path


def author(layout):
    mid=layout['id']
    bid,style,flip,exit_side,door={
        'european-town':('B25','town',False,'w',6.5),
        'industrial-complex':('I37','industrial',True,'w',6.),
        'modern-city':('C28','city',False,'e',5.8),
    }[mid]
    b=next(b for b in layout['buildings'] if b['id']==bid)
    b['circulation']={'style':style,'flipZ':flip,'exit':exit_side,'doorV':door,'stairWidth':7 if style!='city' else 5.7,
                      'extraDoors':[] if style=='town' else [['s',6.],['n',9.]] if style=='industrial' else [['n',6.7],['s',4.]]}
    # Keep old route cavities as navigation annotations; the new shared solids
    # author the actual enclosed envelope, doors, floors and both staircases.
    layout.setdefault('circulationRoutes',[])
    layout['circulationRoutes']=[r for r in layout['circulationRoutes'] if r['id']!=bid]
    layout['circulationRoutes'].append({'id':bid,'height':LEVEL,'waypoints':path(b)})
    b['purpose']={'town':'Garden provisions shop and apartment','industrial':'Warehouse dispatch and elevated office','city':'Commercial service building and upper office'}[style]
    layout['version']=3
    # Relocate decorations affected by the new circulation; keep each against a facade.
    for p in layout['props']:
        if mid=='european-town' and p['type']=='flower_pot_large' and p['pos'][0]==-13:p['pos']=[-12,0,15.2]
        if mid=='industrial-complex' and p['type']=='pallet_goods' and p['pos'][0]==-4.6:p['pos']=[-4.6,BASE,12.1]
        if mid=='industrial-complex' and p['type']=='crate_large' and p['pos'][0]==4.5:p['pos']=[4.5,BASE,12.2]
        if mid=='industrial-complex' and p['type']=='pallet_goods' and p['pos'][0]==1.5:p['pos']=[4.4,BASE,19.]
        if mid=='modern-city' and p['type']=='utility_box' and p['pos'][0]==17.4:p['pos']=[19.5,0,10.7]
        if mid=='modern-city' and p['type']=='bench_modern' and p['pos'][0]==7.4:p['pos']=[6.85,BASE,16.4]
    if mid=='european-town':
        next(w for w in layout['walls'] if w['id']=='W17')['rect'][2]=-17.5
    if mid=='industrial-complex':
        # Move the existing doorway canopy above the new upstairs exit, rather
        # than leaving its old roof intersecting the raised walking surface.
        next(a for a in layout['arches'] if a['id']=='hall_canopyr')['spring']=5.4
    if mid=='modern-city':
        next(w for w in layout['walls'] if w['id']=='W15')['rect'][0]=13.9
        arcade=next(v for v in layout['buildings'] if v['id']=='C27')['passages'][0]
        arcade['rect']=[1,13.3,6,16.3]
        for region in layout['ground']['covered']+layout['navigation']['coveredRoutes']:
            if region['id']=='shop_west':region['rect']=[1,13.3,6,16.3]
        for region in layout['ground']['zones']+layout['navigation']['groundRoutes']:
            if region['id']=='shop_north':region['rect'][2]=13.9
        # Opposing attached street build-outs create a shallow S bend, with
        # 3+ m passages and long repositionable views on either side.
        for wid,rect in [('north_service_kiosk',[-4,-25,-2,-20]),('north_corner_store',[2,-20.5,4,-17])]:
            if not any(w['id']==wid for w in layout['walls']):
                layout['walls'].append({'id':wid,'rect':rect,'height':2.7,'style':'brick','gates':[], 'purpose':'Attached service enclosure / street sightline offset'})
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
