"""Shared market-bin dimensions and a supported four-fruit cluster."""
import math
from meshkit import MeshData

BOTTOM, RIM, FLOOR = .85, 1.10, .88
HALF_X, HALF_Z, FLARE = .30, .24, .06

def pile(index):
    # Three separated bottom fruits support a fourth. The circumcentre gives
    # exact sphere contact, avoiding either initial overlaps or floating fruit.
    angle=.37+index*.81; spread=.091+index*.002
    xoff=(-.018,.022,-.012)[index];zoff=(.012,-.018,.008)[index]
    base=[(xoff+spread*math.cos(angle+k*math.tau/3),FLOOR+.075,
           zoff+spread*math.sin(angle+k*math.tau/3)) for k in range(3)]
    return [(xoff,FLOOR+.075+math.sqrt(.15**2-spread**2),zoff)]+base

def bin_mesh(cx):
    m=MeshData();m.box(cx-HALF_X-.025,BOTTOM,-.4-HALF_Z-.025,cx+HALF_X+.025,FLOOR,-.4+HALF_Z+.025,'wood_crate')
    # Closed tapered wooden boards, with distinct inside/outside surfaces.
    for side in (-1,1):
        for axis in (0,2):
            h=HALF_X if axis==0 else HALF_Z;along=HALF_Z if axis==0 else HALF_X
            verts=[]
            for y,extra in ((BOTTOM,0),(RIM,FLARE)):
                for thick in (0,.025):
                    for t in (-along-extra,along+extra):
                        p=[cx,y,-.4];p[axis]+=side*(h+extra+thick);p[2 if axis==0 else 0]+=t;verts.append(p)
            # Normalize outward winding from the solid centre.
            centre=[sum(p[i] for p in verts)/8 for i in range(3)]
            from meshkit import face_normal,dot,sub
            for ids in ((0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)):
                pts=[verts[i] for i in ids]
                fc=[sum(p[i] for p in pts)/4 for i in range(3)]
                if dot(face_normal(pts),sub(fc,centre))<0:pts.reverse()
                m.face(pts,'wood_crate')
    return m
