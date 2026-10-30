"""Small, low-poly additions using the existing tiled PBR material library."""
from meshkit import MeshData


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


COMPACT_BUILDERS={'flower_box':flower_box,'market_crate':market_crate,
                  'stone_bollard':stone_bollard,'pump_skid':pump_skid,'utility_box':utility_box}
