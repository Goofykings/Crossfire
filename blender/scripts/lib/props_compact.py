"""Small, low-poly additions using the existing tiled PBR material library."""
import math
from meshkit import MeshData


def market_table():
    """Compact produce display; a single material-batched prop, origin at floor."""
    m=MeshData()
    for x in (-.78,.78):
        for z in (-.28,.28): m.box(x-.045,0,z-.045,x+.045,.78,z+.045,'wood_dark')
    m.box(-.9,.74,-.4,.9,.82,.4,'wood_weathered')
    for x in (-.55,0,.55):
        m.box(x-.24,.82,-.32,x+.24,.87,.32,'wood_crate')
        for z in (-.15,.12):
            for dx in (-.12,.12): m.sphere((x+dx,.90,z),.075,'produce',rings=3,segments=6)
    return m


def valve_manifold():
    """Freestanding utility-yard pipe rack, sharing the industrial materials."""
    m=MeshData()
    m.box(-.95,0,-.35,.95,.12,.35,'concrete_floor')
    for x in (-.8,.8):
        m.box(x-.05,.12,-.24,x+.05,1.5,-.14,'steel_dark')
    m.tube((-.85,.5,0),(.85,.5,0),.10,'steel_grey',segments=10)
    m.tube((-.85,1.25,0),(.85,1.25,0),.10,'steel_yellow',segments=10)
    for x in (-.5,.5):
        m.tube((x,.5,0),(x,1.25,0),.075,'steel_grey',segments=10)
        m.tube((x,.9,0),(x,.9,-.23),.04,'steel_dark',segments=8)
        # Low-poly wheel: rim and spokes, rather than a solid floating disc.
        for k in range(10):
            a,b=k*math.tau/10,(k+1)*math.tau/10
            m.tube((x+.16*math.cos(a),.9+.16*math.sin(a),-.25),
                   (x+.16*math.cos(b),.9+.16*math.sin(b),-.25),.018,'steel_yellow',segments=4)
        for dx,dy in ((.16,0),(-.16,0),(0,.16),(0,-.16)):
            m.tube((x,.9,-.25),(x+dx,.9+dy,-.25),.015,'steel_dark',segments=4)
    return m


def cafe_board():
    """Small A-frame storefront board, no extra textures or alpha draw calls."""
    m=MeshData()
    for side in (-1,1):
        z=side*.21
        m.box(-.29,.24,z-.025,.29,.98,z+.025,'wood_dark')
        m.box(-.25,.30,z-.03,.25,.92,z+.03,'steel_dark')
        for x in (-.30,.30):
            m.tube((x,0,side*.29),(x,1.04,side*.16),.025,'wood_weathered',segments=4)
        # Simple light menu strokes, staying decorative rather than readable UI.
        for y,w in ((.8,.18),(.67,.16),(.56,.20),(.45,.13)):
            m.box(-w,y,z+side*.035-.003,w,y+.012,z+side*.035+.003,'concrete_smooth_light')
    m.tube((-.32,1.04,0),(.32,1.04,0),.025,'steel_grey',segments=6)
    return m


def flower_box():
    m=MeshData()
    m.box(-.7,0,-.22,.7,.12,.22,'wood_dark')
    for z in (-.24,.20): m.box(-.72,.10,z,.72,.42,z+.04,'wood_weathered')
    for x in (-.72,.68): m.box(x,.10,-.20,x+.04,.42,.20,'wood_weathered')
    m.box(-.68,.34,-.19,.68,.36,.19,'soil')
    for x in (-.5,-.25,0,.25,.5):
        m.sphere((x,.47,0),.16,'foliage',rings=3,segments=6)
        m.sphere((x,.60,-.02),.075,'flowers',rings=3,segments=6)
    return m


def market_crate():
    m=MeshData()
    m.box(-.38,0,-.28,.38,.06,.28,'wood_crate')
    for y in (.06,.17,.28):
        for z in (-.28,.24): m.box(-.38,y,z,.38,y+.085,z+.04,'wood_crate')
        for x in (-.38,.34): m.box(x,y,-.24,x+.04,y+.085,.24,'wood_crate')
    for x in (-.22,0,.22):
        for z in (-.12,.12): m.sphere((x,.34,z),.10,'produce',rings=3,segments=6)
    return m


def stone_bollard():
    m=MeshData()
    m.box(-.23,0,-.23,.23,.14,.23,'stone_blocks')
    m.cylinder((0,.14,0),.16,.64,'stone_trim',segments=8)
    m.sphere((0,.78,0),.18,'stone_trim',rings=4,segments=8)
    return m


def pump_skid():
    m=MeshData()
    m.box(-1,0,-.55,1,.16,.55,'steel_dark')
    for x in (-.7,.7): m.box(x-.1,.16,-.35,x+.1,.4,.35,'steel_yellow')
    m.tube((-.6,.62,0),(.5,.62,0),.3,'steel_dark',segments=12)
    m.box(.35,.25,-.4,.85,.85,.4,'steel_blue')
    m.tube((-.8,.62,0),(-.8,1.15,0),.09,'steel_yellow',segments=8)
    m.tube((-.8,1.15,0),(-.4,1.15,0),.09,'steel_yellow',segments=8)
    for x in (-.55,-.3,-.05,.2): m.box(x,.32,-.32,x+.035,.90,.32,'steel_dark')
    return m


def utility_box():
    m=MeshData()
    m.box(-.48,0,-.25,.48,.12,.25,'concrete_floor')
    m.box(-.42,.12,-.22,.42,1.2,.22,'steel_dark')
    m.box(-.38,.2,-.235,.38,1.14,-.22,'steel_grey')
    for y in (.3,.36,.42,.48): m.box(-.28,y,-.245,.15,y+.025,-.235,'iron')
    m.box(.25,.65,-.26,.29,.77,-.235,'steel_yellow')
    return m


def vending_machine(body='steel_red', accent='steel_blue'):
    """Drinks/snacks machine (1.0 x 1.95 x 0.85 m, front toward -z): lit product window, selector
    panel, coin slot and a dispensing tray. Origin at the floor centre."""
    m=MeshData()
    W,D,H=.5,.425,1.95
    m.box(-W,.06,-D,W,H,D,body)
    m.box(-W+.03,0,-D+.05,W-.03,.07,D-.05,'steel_dark')
    f=-D-.012
    # Lit window with three shelves of products, and a panel beside it.
    m.box(-.43,.62,f,.14,1.78,-D,'plastic_black')
    m.box(-.40,.66,f-.004,.11,1.74,-D-.004,'lamp_led')
    cols=('plastic_orange','plastic_green','plastic_blue','plastic_white','paint_white')
    for row,y in enumerate((.74,1.06,1.38)):
        m.box(-.40,y+.2,f-.006,.11,y+.215,-D-.006,'aluminium')
        for k in range(5):
            m.box(-.37+k*.095,y+.215,f-.03,-.30+k*.095,y+.215+.17,-D-.01,cols[(k+row)%len(cols)])
    m.box(.2,.62,f,.44,1.78,-D,accent)
    for r in range(4):
        for c in range(3): m.box(.235+c*.07,1.5-r*.1,f-.012,.275+c*.07,1.54-r*.1,-D-.004,'aluminium')
    m.box(.23,.95,f-.01,.41,1.05,-D-.004,'lamp_led')
    m.box(.3,.7,f-.012,.34,.78,-D-.004,'steel_dark')
    # Dispensing tray, a top sign box and a fascia stripe.
    m.box(-.38,.18,f,.1,.5,-D,'plastic_black')
    m.box(-.34,.22,f-.01,.06,.46,-D-.004,'steel_dark')
    m.box(-W+.02,1.8,f-.01,W-.02,1.93,-D,'lamp_led')
    m.box(-W,.52,f-.002,W,.58,-D,accent)
    return m


def wet_floor_sign():
    """Yellow A-frame caution board (0.4 x 0.67 x 0.45 m): two sloped panels with a dark warning band
    and a pictogram bar, facing toward -z and +z."""
    m=MeshData()
    for sgn in (-1,1):
        zb,zt=.2*sgn,.04*sgn
        m.face_toward([(-.19,0,zb),(.19,0,zb),(.145,.64,zt),(-.145,.64,zt)],'steel_yellow',(0,.4,sgn*.9))
        # Warning band and a pictogram bar, a hair proud of the panel.
        for y0,y1 in ((.38,.44),(.20,.34)):
            za=zb+(zt-zb)*y0/.64+sgn*.003; zc=zb+(zt-zb)*y1/.64+sgn*.003
            hw0=.19-.045*y0/.64; hw1=.19-.045*y1/.64
            m.face_toward([(-hw0+.02,y0,za),(hw0-.02,y0,za),(hw1-.02,y1,zc),(-hw1+.02,y1,zc)],'steel_dark',(0,.4,sgn*.9))
    for sgn in (-1,1):
        m.face_toward([(.19*sgn,0,.2),(.145*sgn,.64,.04),(.145*sgn,.64,-.04),(.19*sgn,0,-.2)],'steel_yellow',(sgn,0,0))
    m.box(-.145,.64,-.04,.145,.665,.04,'steel_yellow')
    return m


def wine_rack():
    """Timber wine rack (2.0 x 1.9 x 0.5 m): a frame and seven shelves of bottle ends facing -z."""
    m=MeshData()
    for x in (-1,.96): m.box(x,0,-.25,x+.04,1.9,.25,'wood_dark')
    m.box(-1,1.86,-.25,1,1.9,.25,'wood_dark')
    m.box(-1,0,-.25,1,.08,.25,'wood_dark')
    m.box(-.98,.08,.2,.98,1.86,.25,'wood_weathered')
    for r in range(7):
        y=.1+r*.255
        m.box(-.98,y,-.25,.98,y+.025,.2,'wood_weathered')
        for k in range(9):
            x=-.88+k*.22
            m.tube((x,y+.095,.18),(x,y+.095,-.215),.045,'plastic_green' if (k+r)%3 else 'copper',segments=6)
    return m


def cask(length=1.4,radius=.58):
    """Large wine cask lying on a timber cradle (1.5 x 1.25 x 1.25 m), axis along local x."""
    m=MeshData()
    seg,rings=14,6
    cy=.12+radius
    prof=[(length*(-.5+i/rings),radius*(.86+.14*math.sin(math.pi*i/rings))) for i in range(rings+1)]
    for i in range(rings):
        (x0,r0),(x1,r1)=prof[i],prof[i+1]
        for s in range(seg):
            a,b=2*math.pi*s/seg,2*math.pi*(s+1)/seg
            pts=[(x0,cy+math.sin(a)*r0,math.cos(a)*r0),(x0,cy+math.sin(b)*r0,math.cos(b)*r0),
                 (x1,cy+math.sin(b)*r1,math.cos(b)*r1),(x1,cy+math.sin(a)*r1,math.cos(a)*r1)]
            m.face_toward(pts,'wood_weathered',(0,math.sin((a+b)/2),math.cos((a+b)/2)))
    for sgn in (-1,1):
        x=sgn*length/2
        m.face_toward([(x,cy+math.sin(2*math.pi*s/seg)*prof[-1][1]*.99,math.cos(2*math.pi*s/seg)*prof[-1][1]*.99) for s in range(seg)],'wood_dark',(sgn,0,0))
    for t in (.1,.3,.7,.9):
        r=radius*(.86+.14*math.sin(math.pi*t))+.008
        x=length*(t-.5)
        for s in range(seg):
            a,b=2*math.pi*s/seg,2*math.pi*(s+1)/seg
            m.tube((x,cy+math.sin(a)*r,math.cos(a)*r),(x,cy+math.sin(b)*r,math.cos(b)*r),.018,'iron',segments=4,caps=False)
    # Tap and bung, then the cradle.
    m.tube((-length/2-.02,cy-.12,0),(-length/2-.14,cy-.12,0),.03,'iron',segments=6)
    m.box(-.1,cy+radius*.95,-.04,.1,cy+radius*.95+.03,.04,'wood_dark')
    for x in (-.45*length,.45*length):
        m.box(x-.09,0,-.5,x+.09,.14,.5,'wood_dark')
        m.box(x-.09,.14,-.2,x+.09,.5,.2,'wood_dark')
    return m


COMPACT_BUILDERS={'vending_machine':vending_machine,'vending_machine_blue':lambda:vending_machine('steel_blue','steel_red'),
                  'wet_floor_sign':wet_floor_sign,'wine_rack':wine_rack,'cask':cask,
                  'flower_box':flower_box,'market_crate':market_crate,
                  'stone_bollard':stone_bollard,'pump_skid':pump_skid,'utility_box':utility_box,
                  'market_table':market_table,'valve_manifold':valve_manifold,'cafe_board':cafe_board}
