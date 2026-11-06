"""Diagnostic contact sheets from actual Blender and Babylon renders; no synthetic imagery."""
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]/'test-results/cosmetic-collection'
ids=['verdant-relay','blue-current','crimson-forge','aurum-meridian']
views=['locker','side','front','low','fp','ads','reload','recoil','walk','third','third-side','third-ads']
def sheet(files,out,columns=4):
    w,h=440,330;image=Image.new('RGB',(w*columns,h*((len(files)+columns-1)//columns)),(25,33,45));draw=ImageDraw.Draw(image)
    for i,(file,label) in enumerate(files):
        im=Image.open(file).convert('RGBA');im.thumbnail((w,h-24));x=(i%columns)*w;y=(i//columns)*h
        image.paste(im,(x+(w-im.width)//2,y+24+(h-24-im.height)//2),im);draw.text((x+8,y+7),label,fill=(235,238,244))
    image.save(out)
for id in ids:
    sheet([(ROOT/'browser'/f'{id}-{v}.png',f'{id}: {v}') for v in views],ROOT/f'{id}-review.jpg')
sheet([(ROOT/'blender'/id/f'{v}.png',f'{id}: Blender {v}') for id in [*ids,'foundry-crate'] for v in ['side','front','quarter'] if (ROOT/'blender'/id/f'{v}.png').exists()],ROOT/'blender-review.jpg')
print('Created five contact sheets from recorded renders.')
