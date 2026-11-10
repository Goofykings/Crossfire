"""Contact sheet of review shots: python -I tools/contact_sheet.py <out.png> <cols> <width> <img> [<img> ...]"""
import sys
from PIL import Image, ImageDraw
out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
h = int(ims[0].height * w / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * h))
d = ImageDraw.Draw(sheet)
for k, (f, im) in enumerate(zip(files, ims)):
    x, y = (k % cols) * w, (k // cols) * h
    sheet.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    d.rectangle((x, y, x + 8 * len(f.split('/')[-1][:-4]) + 6, y + 14), fill=(0, 0, 0))
    d.text((x + 3, y + 2), f.split('/')[-1][:-4], fill=(255, 255, 0))
sheet.save(out)
