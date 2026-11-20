import os
import json, math, fitz, sys, warnings
warnings.filterwarnings('ignore')
from PIL import Image, ImageDraw
from common import BOARD
D=fitz.open(os.environ.get('EC_PDF','event-companion.pdf'))
L=json.load(open('layouts_raw.json'))
NOM={'large':(11.5,7),'tri':(11.5,8),'medium':(6,4),'long':(10,2.5),'short':(6,2)}
def poly(t):
    w,h=NOM[t['type']]; w/=2; h/=2
    pts=[[-w,h-2],[w,-h],[w,h],[-w,h]] if t['type']=='tri' else [[-w,-h],[w,-h],[w,h],[-w,h]]
    a=math.radians(t['rot']); c,s=math.cos(a),math.sin(a); out=[]
    for x,y in pts:
        if t['mirror']: x=-x
        out.append((x*c-y*s+t['x'], x*s+y*c+t['y']))
    return out
dpi=110; k=dpi/72
pages=[int(a) for a in sys.argv[1:]]
ims=[]
for pg in pages:
    lay=[l for l in L if l['page']==pg][0]
    p=D[pg-1]
    bb=[i for i in p.get_image_info(xrefs=True) if i['xref']==BOARD][0]['bbox']
    x0,y0=bb[0],bb[1]; sc=(bb[2]-bb[0])/44
    pm=p.get_pixmap(dpi=dpi, clip=fitz.Rect(bb[0]-5,bb[1]-5,bb[2]+5,bb[3]+5))
    im=Image.frombytes('RGB',(pm.width,pm.height),pm.samples)
    dr=ImageDraw.Draw(im)
    P=lambda q: ((x0+q[0]*sc-(bb[0]-5))*k, (y0+q[1]*sc-(bb[1]-5))*k)
    for t in lay['terrain']:
        dr.polygon([P(q) for q in poly(t)], outline=(255,0,255), width=2)
    for z in lay['zones']:
        dr.line([P(q) for q in z['points']+[z['points'][0]]], fill=(255,255,0) if z['player']=='A' else (0,255,255), width=1)
    for o in lay['objectives']:
        x,y=P((o['x'],o['y'])); dr.ellipse([x-4,y-4,x+4,y+4],fill=(255,0,255))
    ims.append(im)
W=sum(i.width for i in ims)+10*len(ims); H=max(i.height for i in ims)
c=Image.new('RGB',(W,H),'white'); x=0
for i in ims: c.paste(i,(x,0)); x+=i.width+10
c.save('ov.png'); print(c.size)
