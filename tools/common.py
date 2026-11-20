import os
import pypdf, re, fitz, numpy as np, io, warnings
warnings.filterwarnings('ignore')
from pypdf.generic import NameObject, DecodedStreamObject
from PIL import Image
PDF=os.environ.get('EC_PDF','event-companion.pdf')
R=pypdf.PdfReader(PDF); D=fitz.open(PDF)
BOARD=5636; BG=13448
_cat={}
def xcat(x):
    if x in _cat: return _cat[x]
    if x==BOARD: c='board'
    elif x==BG: c='bg'
    else:
        pm=fitz.Pixmap(D,x)
        if pm.n-pm.alpha>=4: pm=fitz.Pixmap(fitz.csRGB,pm)
        if pm.n-pm.alpha<3:
            _cat[x]='icon'; return 'icon'
        a=np.frombuffer(pm.samples,dtype=np.uint8).reshape(pm.height,pm.width,pm.n)[:,:,:3].reshape(-1,3).astype(int)
        m=a[(a.sum(1)>80)&(a.sum(1)<700)]
        r,g,b=m.mean(0)
        if g>r+40: c='dense'
        elif r>b+80 and r<150: c='light'
        elif 145<r<185 and 40<r-b<80 and abs((r-g)-30)<12: c='foot'
        else: c='icon'
    _cat[x]=c; return c
def name2xref(res):
    out={}
    xo=res.get('/XObject',{}) if res else {}
    for k,v in xo.items(): out[k]=v.idnum
    return out
def form_has_foot(fobj):
    res=fobj.get('/Resources',{})
    for k,v in res.get('/XObject',{}).items():
        o=v.get_object()
        if o['/Subtype']=='/Image' and xcat(v.idnum)=='foot': return True
        if o['/Subtype']=='/Form' and form_has_foot(o): return True
    return False
def alpha_render(pi, dpi=200):
    def render(bg):
        w=pypdf.PdfWriter(); w.add_page(R.pages[pi]); pg=w.pages[0]
        xo=R.pages[pi]['/Resources']['/XObject']
        c=pg.get_contents().get_data().decode('latin1')
        def repl(m):
            nm=m.group(1); ref=xo.get(nm)
            if ref is None: return ''
            o=ref.get_object()
            if o['/Subtype']=='/Image':
                return m.group(0) if xcat(ref.idnum)=='foot' else ''
            return m.group(0) if form_has_foot(o) else ''
        c=re.sub(r'(/\w+) Do',repl,c)
        c=re.sub(r'\bBT\b.*?\bET\b','',c,flags=re.S)
        c=(bg+' rg 0 0 600 850 re f\n')+c
        s=DecodedStreamObject(); s.set_data(c.encode('latin1')); pg[NameObject('/Contents')]=w._add_object(s)
        b=io.BytesIO(); w.write(b); d=fitz.open(stream=b.getvalue(),filetype='pdf'); pm=d[0].get_pixmap(dpi=dpi)
        return np.array(Image.frombytes('RGB',(pm.width,pm.height),pm.samples)).astype(int)
    a=render('1 1 1'); b=render('0 0 0')
    return np.abs(a-b).sum(2)<30
