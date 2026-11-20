import os
import fitz, math, json, re, warnings
import numpy as np
warnings.filterwarnings('ignore')
from common import xcat, BOARD
D=fitz.open(os.environ.get('EC_PDF','event-companion.pdf'))
GREY=(0.82,0.83,0.83)
def col(g,k='fill'):
    f=g.get(k); return tuple(round(c,2) for c in f) if f else None
NOM={'large':(11.5,7),'tri':(11.5,8),'medium':(6,4),'long':(10,2.5),'short':(6,2)}
def classify(w,h):
    best=None
    for k,(a,b) in NOM.items():
        e=abs(w-a)+abs(h-b)
        if best is None or e<best[0]: best=(e,k)
    return best
def pts_of(g):
    pts=[]
    for it in g['items']:
        if it[0]=='l': pts+= [it[1],it[2]]
        elif it[0]=='c': pts+= [it[1],it[4]]
        elif it[0]=='re': r=it[1]; pts+=[r.tl,r.tr,r.br,r.bl]
    return pts
def snap(v,q=0.25): return round(v/q)*q
def pip(p,poly):
    x,y=p; ins=False; n=len(poly)
    for i in range(n):
        x1,y1=poly[i]; x2,y2=poly[(i+1)%n]
        if (y1>y)!=(y2>y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: ins=not ins
    return ins
def page_layout(pi):
    p=D[pi]
    info=p.get_image_info(xrefs=True)
    bb=[i for i in info if i['xref']==BOARD][0]['bbox']
    x0,y0=bb[0],bb[1]; sc=(bb[2]-bb[0])/44.0
    B=lambda pt: ((pt.x-x0)/sc, (pt.y-y0)/sc)
    dr=p.get_drawings()
    terrain=[]
    for g in dr:
        if g['type']=='fs' and col(g)==GREY:
            r=g['rect']
            if r.width<15: continue
            segs=[]
            for it in g['items']:
                if it[0]=='l':
                    a,b=B(it[1]),B(it[2]); L=math.hypot(b[0]-a[0],b[1]-a[1])
                    if L>0.6: segs.append((L,a,b))
            if not segs: continue
            bins={}
            for L,a,b in segs:
                ang=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))%90
                k=round(ang*2)/2 % 90
                bins[k]=bins.get(k,0)+L
                bins[(k+0.5)%90]=bins.get((k+0.5)%90,0)+L*0.5
                bins[(k-0.5)%90]=bins.get((k-0.5)%90,0)+L*0.5
            kbest=max(bins,key=bins.get)
            near=[(math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))%90,L) for L,a,b in segs]
            near=[(an if abs(an-kbest)<45 else (an-90 if an>kbest else an+90),L) for an,L in near]
            near=[(an,L) for an,L in near if abs(an-kbest)<1.5]
            th=sum(an*L for an,L in near)/sum(L for an,L in near) % 90
            if th>89.5: th-=90
            t=math.radians(th); c,s=math.cos(t),math.sin(t)
            rot=lambda q,c=c,s=s:(q[0]*c+q[1]*s, -q[0]*s+q[1]*c)
            unrot=lambda q,c=c,s=s:(q[0]*c-q[1]*s, q[0]*s+q[1]*c)
            outline=[rot(B(q)) for q in pts_of(g)]
            oxs=[q[0] for q in outline]; oys=[q[1] for q in outline]
            ox0,ox1,oy0,oy1=min(oxs),max(oxs),min(oys),max(oys)
            ow,oh=ox1-ox0,oy1-oy0
            swapped = oh>ow
            err,typ=classify(max(ow,oh)-0.25,min(ow,oh)-0.25)
            W,H=NOM[typ]; ww,hh=(H,W) if swapped else (W,H)
            vx=[]; hy=[]
            for L,a,b in segs:
                ra,rb=rot(a),rot(b)
                if abs(ra[0]-rb[0])<0.05: vx.append((ra[0],L))
                elif abs(ra[1]-rb[1])<0.05: hy.append((ra[1],L))
            def edge(vals,lo,hi,size):
                nlo=[v for v,L in vals if abs(v-lo)<0.7]; nhi=[v for v,L in vals if abs(v-hi)<0.7]
                if nlo and nhi:
                    a,b=min(nlo),max(nhi)
                    if abs((b-a)-size)<0.4: return a,b
                if nlo: a=min(nlo); return a,a+size
                if nhi: b=max(nhi); return b-size,b
                c=(lo+hi)/2; return c-size/2,c+size/2
            bx0,bx1=edge(vx,ox0,ox1,ww); by0,by1=edge(hy,oy0,oy1,hh)
            terrain.append(dict(typ=typ,err=err,th=th,box=(bx0,bx1,by0,by1),swapped=swapped,outline=outline,unrot=unrot,rot=rot,raw=[B(q) for q in pts_of(g)]))
    # build final terrain entries
    out=[]
    for T in terrain:
        bx0,bx1,by0,by1=T['box']; th=T['th']; typ=T['typ']
        W,H=NOM[typ]
        axis = abs(th)<0.6
        cx,cy=(bx0+bx1)/2,(by0+by1)/2
        if axis:
            # snap edges to quarter inches
            ww,hh=(W,H) if not T['swapped'] else (H,W)
            ex0=snap(bx0); ey0=snap(by0)
            # choose snapping of the edge with smaller error on each axis
            if abs(snap(bx1)-bx1)<abs(ex0-bx0): ex0=snap(bx1)-ww
            if abs(snap(by1)-by1)<abs(ey0-by0): ey0=snap(by1)-hh
            cx,cy=ex0+ww/2,ey0+hh/2
        base_rot = th + (90 if T['swapped'] else 0)  # local x (long side) direction
        mirror=False
        if typ=='tri':
            # body frame where long side along x: find empty corner
            poly=T['outline']
            if T['swapped']:
                poly=[(q[1],-q[0]) for q in poly]  # rotate so long side horizontal (rotate -90)
                cxl,cyl=cy,-cx
            else: cxl,cyl=cx,cy
            Wl,Hl=W/2-1.2,H/2-1.2
            corners={'TL':(cxl-Wl,cyl-Hl),'TR':(cxl+Wl,cyl-Hl),'BL':(cxl-Wl,cyl+Hl),'BR':(cxl+Wl,cyl+Hl)}
            empty=[k for k,q in corners.items() if not pip(q,poly)]
            e=empty[0] if len(empty)==1 else ('?' + ''.join(empty))
            extra={'TL':(0,False),'BR':(180,False),'TR':(0,True),'BL':(180,True)}.get(e)
            if extra is None: print('  !! tri corner ambiguous',pi+1,empty); extra=(0,False)
            base_rot+=extra[0]; mirror=extra[1]
            T['empty']=e
        wc=T['unrot']((cx,cy))
        rot=round(base_rot%360,2)
        out.append(dict(type=typ,x=round(wc[0],3),y=round(wc[1],3),rot=rot,mirror=mirror,_err=round(T['err'],2),_raw=T['raw']))
    # zones
    zones=[]
    for g in dr:
        cl=col(g)
        if g['type'] in('f','fs') and cl in((0.62,0.04,0.06),(0.0,0.24,0.41)) and g['rect'].width*g['rect'].height>3000:
            pts=[]
            for it in g['items']:
                if it[0]=='l':
                    for q in (it[1],it[2]):
                        b=B(q); b=(snap(min(max(b[0],0),44)),snap(min(max(b[1],0),60)))
                        if not pts or pts[-1]!=b: pts.append(b)
                elif it[0]=='re':
                    r=it[1]
                    for q in (r.tl,r.tr,r.br,r.bl):
                        b=B(q); pts.append((snap(min(max(b[0],0),44)),snap(min(max(b[1],0),60))))
                elif it[0]=='c':
                    p0,p1,p2,p3=[B(q) for q in it[1:5]]
                    for k in range(1,9):
                        t=k/8; mt=1-t
                        x=mt**3*p0[0]+3*mt*mt*t*p1[0]+3*mt*t*t*p2[0]+t**3*p3[0]
                        y=mt**3*p0[1]+3*mt*mt*t*p1[1]+3*mt*t*t*p2[1]+t**3*p3[1]
                        pts.append((round(x,2),round(y,2)))
            if len(pts)>2 and pts[0]==pts[-1]: pts=pts[:-1]
            zones.append(dict(player='A' if cl==(0.62,0.04,0.06) else 'B', points=pts))
    # objectives
    objs=[]
    for g in dr:
        cl=col(g); r=g['rect']
        cpt=fitz.Point((r.x0+r.x1)/2,(r.y0+r.y1)/2); b=B(cpt)
        if not(0<b[0]<44 and 0<b[1]<60): continue
        kind=None
        if cl==(0.0,0.45,0.38) and 22<r.width<30 and g['type']=='f': kind='central'
        elif cl==(0.13,0.57,0.52) and 24<r.width<34: kind='expansion'
        elif cl==(0.62,0.04,0.06) and 22<r.width<30 and g['type']=='f': kind='homeA'
        elif cl==(0.0,0.24,0.41) and 22<r.width<30 and g['type']=='f': kind='homeB'
        if kind: objs.append(dict(kind=kind,x=round(b[0],2),y=round(b[1],2)))
    # area link icons
    links=[]
    for g in dr:
        if col(g)==(0.5,0.51,0.52) and g['type']=='f' and len(g['items'])==4 and 13<g['rect'].width<18:
            r=g['rect']
            inner=[h for h in dr if h['type']=='s' and col(h,'color')==(0.5,0.51,0.52) and h['rect'].x0>=r.x0-1 and h['rect'].x1<=r.x1+1 and h['rect'].y0>=r.y0-1 and h['rect'].y1<=r.y1+1]
            b=B(fitz.Point((r.x0+r.x1)/2,(r.y0+r.y1)/2))
            links.append(dict(single=bool(inner),x=b[0],y=b[1]))
    # features
    feats=[]
    for i in info:
        cat=xcat(i['xref'])
        if cat in ('dense','light'):
            A_,B_,C_,D_,E_,F_=i['transform']
            corners=[(E_,F_),(A_+E_,B_+F_),(A_+C_+E_,B_+D_+F_),(C_+E_,D_+F_)]
            pts=[(round((x-x0)/sc,2),round((y-y0)/sc,2)) for x,y in corners]
            feats.append(dict(kind=cat,points=pts))
    return dict(terrain=out,zones=zones,objectives=objs,links=links,features=feats,scale=sc)
def titles(pi):
    p=D[pi]; W=p.rect.width
    words=p.get_text('words')
    lines={}
    for w in words:
        if w[1]>200: continue
        side='L' if w[0]<W/2-20 else ('R' if w[0]>W/2+20 else 'M')
        key=(side,round(w[1]/3))
        lines.setdefault(key,[]).append(w)
    out={'L':[],'R':[],'M':[]}
    for (side,yk),ws in sorted(lines.items(), key=lambda kv:kv[0][1]):
        out[side].append(' '.join(x[4] for x in sorted(ws,key=lambda q:q[0])))
    full=p.get_text()
    m=re.search(r'LAYOUT\s+([ABC])',full)
    return out, (m.group(1) if m else '?')
if __name__=='__main__':
    import sys
    res=[]
    for pi in range(8,53):
        L=page_layout(pi); t,letter=titles(pi)
        L['titles']=t; L['letter']=letter; L['page']=pi+1
        res.append(L)
        print(pi+1,letter,t['L'][:4],t['R'][:4],'terrain',len(L['terrain']),[ (q['type'],q['_err']) for q in L['terrain'] if q['_err']>0.25],'zones',len(L['zones']),'objs',len(L['objectives']),'links',sum(1 for l in L['links'] if l['single']),'/',len(L['links']),'feats',len(L['features']))
    for L in res:
        for q in L['terrain']: q.pop('_raw',None)
    json.dump(res,open('layouts_raw.json','w'),indent=0,default=str)
