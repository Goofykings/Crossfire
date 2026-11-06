"""Author deterministic 1K PBR finish atlases with original graphic details (Pillow).
No downloaded artwork, logos or runtime procedural shader cost.
"""
from pathlib import Path
import sys, random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'blender/cosmetics'))
from collection_design import ITEMS, build, directory, uv
from meshkit import face_normal
N=1024
FONT=Path('C:/Windows/Fonts/consola.ttf')


def make(item):
    path=directory(item);path.mkdir(parents=True,exist_ok=True)
    parts,anchors,bounds=build(item);rng=random.Random(item['seed'])
    noise=Image.frombytes('L',(N,N),rng.randbytes(N*N))
    # Fine spray/anodizing grain, not high-contrast dirt covering the design.
    grain=noise.point(lambda x: int(232+x*.09)).convert('RGB')
    albedo=ImageChops.multiply(Image.new('RGB',(N,N),item['color']),grain)
    draw=ImageDraw.Draw(albedo)
    def point(z,y):
        # Author one full-width side, then pack both physical sides below.
        u=(z-bounds[2][0])/(bounds[2][1]-bounds[2][0]);v=.65*(y-bounds[1][0])/(bounds[1][1]-bounds[1][0]);return (round(u*(N-1)),round((1-v)*(N-1)))
    def line(points,color,width=2):draw.line([point(z,y) for z,y in points],fill=color,width=width,joint='curve')
    def polygon(points,color):draw.polygon([point(z,y) for z,y in points],fill=color)
    accent=item['accent'];dark=tuple(int(x*.5) for x in item['color'])
    if item['weapon']=='rifle':
        for z in [-.43,-.34,-.25,.20]:
            polygon([(z,.012),(z+.035,.012),(z+.005,.10),(z-.03,.10)],dark)
        line([(.19,.065),(.29,.067),(.313,.052)],accent,3)
        for k in range(4):line([(-.16+k*.013,.033),(-.155+k*.013,.046)],accent,2)
    elif item['weapon']=='smg':
        polygon([(-.25,.075),(-.20,.085),(.035,.085),(.035,.068),(-.2,.068)],(32,103,159))
        line([(-.25,.071),(-.205,.091),(.035,.091)],accent,3)
        for k in range(5):line([(-.19+k*.023,.036),(-.183+k*.023,.045)],(42,127,171),2)
        line([(-.20,.062),(-.06,.062),(-.048,.047)],(147,192,211),2)
    elif item['weapon']=='shotgun':
        polygon([(.11,.016),(.21,.047),(.35,.037),(.35,.014),(.20,.025)],(68,17,27))
        line([(.14,.027),(.21,.048),(.342,.039)],(217,91,80),3)
        for k in range(13):line([(.14+k*.014,.020),(.125+k*.014,-.015)],(111,24,35),2)
        for k in range(11):line([(-.265-k*.012,.01),(-.28-k*.012,.047)],(104,20,30),2)
    else:
        # Cartographic meridian engraving, not emissive gold paint everywhere.
        line([(.125,.035),(.28,.041),(.365,.027)],accent,3)
        line([(.125,.031),(.28,.037),(.365,.023)],(113,95,62),1)
        for k in range(9):
            z=.16+k*.022;line([(z,.034),(z,.037+(k%3==0)*.004)],accent,1)
        for k in range(3):line([(-.42,.009+k*.006),(-.15,.009+k*.006)],(67,69,72),1)
    # Separate physical side islands: graphics share their positions, glyphs never mirror.
    side_top=round(.35*N);side=albedo.crop((0,side_top,N,N))
    albedo.paste(side.transpose(Image.Transpose.FLIP_LEFT_RIGHT).resize((N//2,N-side_top),Image.Resampling.LANCZOS),(0,side_top))
    albedo.paste(side.resize((N//2,N-side_top),Image.Resampling.LANCZOS),(N//2,side_top))
    # Sparse, deliberately small finish chips on real outer polygon edges, no triangle diagonals.
    chips=Image.new('L',(N,N));edge=ImageDraw.Draw(chips)
    for md in parts.values():
        for f,mat in zip(md.faces,md.face_mat):
            if mat!='collection_finish':continue
            pts=[md.verts[v] for v in f];n=face_normal(pts)
            for a,b in zip(pts,pts[1:]+pts[:1]):
                if rng.random()>.30:continue
                ua,va=uv(a,n,bounds);ub,vb=uv(b,n,bounds)
                t=rng.uniform(.06,.87);length=rng.uniform(.03,.12)
                edge.line([((ua+(ub-ua)*t)*N,(1-va-(vb-va)*t)*N),((ua+(ub-ua)*(t+length))*N,(1-va-(vb-va)*(t+length))*N)],fill=rng.randint(70,160),width=1)
    if item['weapon']=='sniper':chips=chips.point(lambda p:p//3)
    albedo.paste((156,159,148),mask=chips)
    # Original small maker's registration marks; no external branding.
    font=ImageFont.truetype(str(FONT),10) if FONT.exists() else ImageFont.load_default()
    pos={'rifle':(.24,.027),'smg':(-.025,.058),'shotgun':(.27,.003),'sniper':(.27,-.012)}[item['weapon']]
    draw=ImageDraw.Draw(albedo)
    for sign in [-1,1]:
        u,v=uv((0,pos[1],pos[0]),(sign,0,0),bounds)
        draw.text((u*N,(1-v)*N),{'rifle':'VR / 04','smg':'BC - 02','shotgun':'CF / 03','sniper':'AM - I'}[item['weapon']],font=font,fill=accent)
    albedo.save(path/'finish-albedo.jpg',quality=92,subsampling=0,optimize=True)
    rough=noise.filter(ImageFilter.GaussianBlur(.65)).point(lambda p:max(0,min(255,int(item['roughness']*255+(p-128)*.14))))
    rough=ImageChops.subtract(rough,chips.point(lambda p:p//5))
    metal=Image.new('L',(N,N),int(item['metallic']*255));metal=ImageChops.lighter(metal,chips)
    Image.merge('RGB',(Image.new('L',(N,N),255),rough,metal)).resize((512,512),Image.Resampling.LANCZOS).quantize(colors=64,dither=Image.Dither.NONE).save(path/'finish-orm.png',optimize=True)
    # Low-amplitude OpenGL tangent normal, no exaggerated hammered surface.
    smooth=noise.filter(ImageFilter.GaussianBlur(.8));dx=ImageChops.subtract(ImageChops.offset(smooth,1,0),ImageChops.offset(smooth,-1,0),scale=4,offset=128)
    dy=ImageChops.subtract(ImageChops.offset(smooth,0,1),ImageChops.offset(smooth,0,-1),scale=4,offset=128)
    Image.merge('RGB',(dx,dy,Image.new('L',(N,N),255))).resize((512,512),Image.Resampling.LANCZOS).quantize(colors=128,dither=Image.Dither.NONE).save(path/'finish-normal.png',optimize=True)
    print(item['id'],'authored 1K albedo + 512px ORM/normal PBR maps')

if __name__=='__main__':
    for item in ITEMS:make(item)
