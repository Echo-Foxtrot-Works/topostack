import json
import struct
import zipfile
import pathlib
import hashlib
import numpy as np
from pyproj import CRS, Transformer
root=pathlib.Path('.topostack/chart-accuracy')
for name in ['viking','king-city','hamilton','willow']:
 zpath=root/f'{name}-qa.zip'; out=root/f'{name}-qa';out.mkdir(exist_ok=True)
 with zipfile.ZipFile(zpath) as z:
  for filename in z.namelist():
   if filename.endswith(('.dbf','.prj')):
    (out/pathlib.Path(filename).name).write_bytes(z.read(filename))
 dbf=next(out.glob('*.dbf'));raw=dbf.open('rb');header=raw.read(32);count=struct.unpack_from('<I',header,4)[0];offset,row=struct.unpack_from('<HH',header,8);fields=[('_deleted','S1')]
 while True:
  field=raw.read(32)
  if field[0]==13:break
  fields.append((field[:11].split(b'\0')[0].decode(),'S'+str(field[16])))
 raw.close(); dtype=np.dtype(fields);assert dtype.itemsize==row
 data=np.memmap(dbf,mode='r',dtype=dtype,offset=offset,shape=(count,))
 selected=np.char.strip(data['QA'])==b'1'
 xyz=np.column_stack([data[f][selected].astype(float) for f in ['X','Y','Z']])
 crs=CRS.from_wkt(next(out.glob('*.prj')).read_text());trans=Transformer.from_crs(crs,4326,always_xy=True);lon,lat=trans.transform(xyz[:,0],xyz[:,1]); points=np.column_stack([lon,lat,xyz[:,2],xyz[:,:2]])
 np.save(root/f'{name}-qa.npy',points)
 meta={'sourceZipSha256':hashlib.file_digest(zpath.open('rb'),'sha256').hexdigest(),'rawPoints':count,'qaPoints':int(selected.sum()),'crs':crs.to_string(),'medianLocation':[float(np.median(lat)),float(np.median(lon))],'bounds':[float(min(lon)),float(min(lat)),float(max(lon)),float(max(lat))],'elevationRangeFt':[float(min(xyz[:,2])),float(max(xyz[:,2]))]};(root/f'{name}-qa-summary.json').write_text(json.dumps(meta,indent=2));print(name,meta,flush=True)
