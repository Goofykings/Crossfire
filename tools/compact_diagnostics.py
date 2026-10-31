"""Overhead authoring diagnostics, never loaded by the gameplay HUD."""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'blender/scripts/lib'))
from building_spec import room_layout


def render(map_id):
    l=json.loads((ROOT/f'src/maps/{map_id}/layout.json').read_text())
    catalog=json.loads((ROOT/'public/assets/models/shared/props/props.json').read_text())['props']
    scale,pad=14,52
    extent=l['playArea'][2]; n=int(extent*2*scale)+pad*2
    im=Image.new('RGB',(n,n+48),'#18212b'); d=ImageDraw.Draw(im)
    def xy(x,z): return (pad+(x+extent)*scale,pad+(z+extent)*scale)
    def rect(r,**kw): d.rectangle([xy(r[0],r[1]),xy(r[2],r[3])],**kw)
    for b in l['buildings']: rect(b['rect'],fill='#424b55',outline='#8d96a0')
    colors={'street':'#536a7d','alley':'#516260','court':'#586e5a','plaza':'#798169','yard':'#697365'}
    for z in l['ground']['zones']: rect(z['rect'],fill=colors.get(z['kind'],'#8c8b7a'))
    for w in l['walls']: rect(w['rect'],fill='#74838b')
    for c in l['ground']['covered']: rect(c['rect'],fill='#876747',outline='#e0b77b')
    for b in l['buildings']:
        doors=[r for room in b.get('rooms',[]) for _,r in room_layout(b,room)[1]]
        doors += [door['rect'] for i in b.get('interiors',[]) for door in i['doors']]
        for r in doors: rect(r,fill='#dfcb98',outline='#ffeec7')
    for p in l['props']+l['obstacles']:
        size=catalog[p['type']]['collider']
        if size:
            yaw=-math.radians(p['heading']); c,s=math.cos(yaw),math.sin(yaw)
            pts=[xy(p['pos'][0]+dx*c+dz*s,p['pos'][2]-dx*s+dz*c)
                 for dx,dz in [(-size[0]/2,-size[2]/2),(size[0]/2,-size[2]/2),
                               (size[0]/2,size[2]/2),(-size[0]/2,size[2]/2)]]
            d.polygon(pts,fill='#b7996e',outline='#ebd4ad')
    for r in l.get('upperRoutes',[]):
        rect(r['rect'],outline='#7de9ff',width=3)
        pts=next(n['waypoints'] for n in l['navigation']['upperRoutes'] if n['id']==r['id'])
        d.line([xy(p[0],p[2]) for p in pts],fill='#7de9ff',width=3)
        x,y=xy(r['rect'][0],r['rect'][1]); d.text((x+5,y+5),r['id'],fill='#ffffff')
    flank={'european-town':'market_room','industrial-complex':'goods_office','modern-city':'diner_service'}[map_id]
    for route in l['ground']['covered']:
        if route['id']==flank:
            rect(route['rect'],outline='#ffed8a',width=3)
            x,y=xy(route['rect'][0],route['rect'][1]);d.text((x+3,y+4),flank,fill='white')
    for s in l['spawns']:
        x,y=xy(s['pos'][0],s['pos'][2]);d.ellipse((x-5,y-5,x+5,y+5),fill='#89d3ff');d.text((x+6,y-6),s['id'],fill='white')
    rect(l['playArea'],outline='white',width=2)
    d.text((pad,16),f"{l['name']} | {extent*2:g} x {extent*2:g} metres | asymmetric loops",fill='white')
    d.text((pad,n+8),'Brown: covered   Cyan: upper   Gold: new flank   Tan: colliders/doors   Blue: spawns',fill='white')
    out=ROOT/f'docs/{map_id}-compact-plan.png'; im.save(out);print(out)


if __name__=='__main__':
    for mid in sys.argv[1:] or ['european-town','industrial-complex','modern-city']: render(mid)
