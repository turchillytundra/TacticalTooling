import os
import subprocess, re, json
fac=None; out={}; bad=[]
for pg in range(55,94):
    t=subprocess.run(['pdftotext','-f',str(pg),'-l',str(pg),'-layout',os.environ.get('EC_PDF','event-companion.pdf'),'-'],capture_output=True,text=True).stdout
    lines=[l.rstrip() for l in t.split('\n')]
    for i,l in enumerate(lines):
        s=l.strip()
        if not s or re.fullmatch(r'\d+',s): continue
        if s.startswith('UNIT') and 'BASE SIZE' in s: continue
        if 'BASE SIZE GUIDE' in s or 'LAST UPDATED' in s: continue
        m=re.match(r'^(.*?\S)\s{2,}(\S.*)$',s)
        if not m:
            if s.isupper() and len(s)<40 and not re.search(r'\d',s):
                fac=s.title().replace("’S","’s").replace("'S","'s"); out.setdefault(fac,[]); continue
            if out.get(fac): out[fac][-1][0]+=' '+s
            bad.append((pg,s)); continue
        name,size=m.group(1),m.group(2)
        if name.isupper() and name.startswith('IMPERIAL ARMOUR'): continue
        out.setdefault(fac or '?',[]).append([name,size])
sizes={}
for f,L in out.items():
    for n,s in L: sizes[s]=sizes.get(s,0)+1
print(len(out), sum(len(v) for v in out.values()))
print(sorted(sizes.items(), key=lambda kv:-kv[1])[:80])
print('BAD',bad[:40], len(bad))
json.dump(out,open('bases_raw.json','w'),indent=0,ensure_ascii=False)
