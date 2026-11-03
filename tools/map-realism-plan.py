"""North-up diagnostics from the exported collision, not a schematic route graph."""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/map-realism';OUT.mkdir(exist_ok=True)
for mid in ('european-town','industrial-complex','modern-city'):
    layout=json.loads((ROOT/f'src/maps/{mid}/layout.json').read_text())
    boxes=json.loads((ROOT/f'public/assets/models/{mid}/collision.json').read_text())['boxes']
    catalog=json.loads((ROOT/'public/assets/models/shared/props/props.json').read_text())['props']
    for p in layout['props']+layout['obstacles']:
        size=catalog[p['type']].get('collider')
        if size:boxes.append({'c':[p['pos'][0],p['pos'][1]+size[1]/2,p['pos'][2]],'h':[v/2 for v in size],'yaw':-p['heading']*math.pi/180,'tag':'prop:'+p['type']})
    image=Image.new('RGB',(1500,820),'#101721');draw=ImageDraw.Draw(image)
    b=next(b for b in layout['buildings'] if b.get('circulation'))
    x0,z0,x1,z1=b['rect'];detail=[x0-7,z0-3,x1+7,z1+3]
    panels=[]
    for panel,(bounds,height,title) in enumerate([(layout['playArea'],1.,'Ground: solids at 1 m'),(detail,4.3,'Interior detail: solids at 4.3 m')]):
        bx,bz,ex,ez=bounds;scale=min(700/(ex-bx),690/(ez-bz));ox=panel*750+25;oy=75
        def pt(x,z):return (ox+(x-bx)*scale,oy+(z-bz)*scale)
        def rect(r,**kw):draw.rectangle([pt(r[0],r[1]),pt(r[2],r[3])],**kw)
        draw.text((ox,40),title,fill='white');rect(bounds,fill='#283640',outline='#708090')
        for zone in layout['ground']['zones']+layout['ground']['covered']:
            r=zone['rect']
            if r[0]>=bx and r[2]<=ex and r[1]>=bz and r[3]<=ez:rect(r,fill='#344851')
        for box in boxes:
            c,h=box['c'],box['h']
            if not c[1]-h[1]<height<c[1]+h[1]:continue
            if c[0]+h[0]<bx or c[0]-h[0]>ex or c[2]+h[2]<bz or c[2]-h[2]>ez:continue
            a=box.get('yaw',0);co,si=math.cos(a),math.sin(a)
            poly=[pt(c[0]+u*co+v*si,c[2]-u*si+v*co) for u,v in [(-h[0],-h[2]),(h[0],-h[2]),(h[0],h[2]),(-h[0],h[2])]]
            # Clip to each panel after rendering, so nearby backdrop geometry
            # cannot obscure the neighboring diagnostic.
            draw.polygon(poly,fill='#bfa77b' if box['tag'].startswith('circulation:') else '#697882')
        for route in layout.get('circulationRoutes',[]):
            for i,(a,c) in enumerate(zip(route['waypoints'],route['waypoints'][1:])):
                draw.line([pt(a[0],a[2]),pt(c[0],c[2])],fill='#65dcff' if max(a[1],c[1])<.1 else '#ffb86b',width=3)
                draw.text(pt(a[0],a[2]),str(i+1),fill='white')
        if not panel:
            for s in layout['spawns']:
                x,z=pt(s['pos'][0],s['pos'][2]);draw.ellipse((x-3,z-3,x+3,z+3),fill='white')
        rect(b['rect'],outline='#fff4c0',width=2)
        panels.append((image.crop((ox,oy,int(ox+(ex-bx)*scale)+1,int(oy+(ez-bz)*scale)+1)),(ox,oy),title))
    image=Image.new('RGB',(1500,820),'#101721');draw=ImageDraw.Draw(image)
    for crop,position,title in panels:
        image.paste(crop,position);draw.text((position[0],40),title,fill='white')
    draw.text((25,12),mid+' | north up | exported collision slices',fill='white')
    draw.text((25,790),'Tan: new architecture | cyan: ground route | orange: stair/upper loop | white dots: spawns',fill='white')
    image.save(OUT/f'{mid}.png')
    print(OUT/f'{mid}.png')
