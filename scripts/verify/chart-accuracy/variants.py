import json
import pathlib
import math
import io
from PIL import Image,ImageFilter
root=pathlib.Path('.topostack/chart-accuracy');cases=[]
for c in json.loads((root/'configs.json').read_text()):
 path=root/f"{c['id']}-crop.png"
 original=Image.open(path).convert('RGB');ow,oh=original.size
 for variant in ['original','low-resolution','jpeg-40','blur-1px','rotated-7deg']:
  img=original.copy();marks=[dict(m) for m in c['marks']]
  target=900 if variant=='low-resolution' else 2400
  scale=min(1,target/max(img.size));size=tuple(round(v*scale)for v in img.size);img=img.resize(size,Image.Resampling.BILINEAR)
  for m in marks:m['x']*=size[0]/ow;m['y']*=size[1]/oh;m['reach']=max(2,m['reach']*scale)
  if variant=='jpeg-40':
   temp=io.BytesIO();img.save(temp,format='JPEG',quality=40);temp.seek(0);img=Image.open(temp).convert('RGB')
  if variant=='blur-1px':img=img.filter(ImageFilter.GaussianBlur(1))
  if variant=='rotated-7deg':
   w,h=img.size;img=img.rotate(7,resample=Image.Resampling.BICUBIC,expand=True,fillcolor='white');nw,nh=img.size;a=math.radians(7)
   for m in marks:
    x,y=m['x']-w/2,m['y']-h/2;m['x']=nw/2+math.cos(a)*x+math.sin(a)*y;m['y']=nh/2-math.sin(a)*x+math.cos(a)*y
   scale=min(1,2400/max(img.size));size=tuple(round(v*scale)for v in img.size);img=img.resize(size,Image.Resampling.BILINEAR)
   for m in marks:m['x']*=size[0]/nw;m['y']*=size[1]/nh;m['reach']*=scale
  identifier=f"{c['id']}-{variant}";f=root/f'{identifier}.png';img.save(f);cases.append({**c,'scenario':identifier,'imageFile':str(f),'marks':marks,'imageSize':list(img.size)})
(root/'cases.json').write_text(json.dumps(cases,indent=2))
