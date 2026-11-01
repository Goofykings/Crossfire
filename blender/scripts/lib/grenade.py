"""Original Crossfire service grenade, 13 cm tall, with restrained industrial PBR finishes."""
import math
from meshkit import MeshData


def build():
    m=MeshData()
    # Faceted core with independent raised shell segments; no copied asset or texture.
    m.cylinder((0,-.047,0),.041,.085,'gun_black',segments=12,radius_top=.038)
    for row in range(4):
        y=-.046+row*.021
        r=(.041,.048,.048,.042)[row]
        for k in range(12):
            angle=2*math.pi*k/12
            m.obox((math.cos(angle)*(r-.005),y+.009,math.sin(angle)*(r-.005)),(.009,.0085,.006),
                   -angle-math.pi/2,'steel_green')
    m.cylinder((0,.038,0),.023,.021,'gun_steel',segments=12,radius_top=.017)
    m.box(-.012,.059,-.022,.012,.066,.035,'gun_steel')
    m.box(-.012,.005,.029,.012,.06,.036,'gun_steel')
    # Properly closed pull-ring, in a plane through the fuse neck.
    for k in range(12):
        a,b=2*math.pi*k/12,2*math.pi*(k+1)/12
        m.tube((.024+.016*math.cos(a),.047+.016*math.sin(a),-.004),
               (.024+.016*math.cos(b),.047+.016*math.sin(b),-.004),.0022,'galvanized',segments=5)
    m.box(-.013,-.006,-.049,.013,.002,-.047,'steel_yellow')
    return m
