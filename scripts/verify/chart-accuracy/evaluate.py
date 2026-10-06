import json
import pathlib
import base64
import numpy as np
root=pathlib.Path('.topostack/chart-accuracy')

def sample(record, points):
 g=record['grid'];b=g['bounds'];w,h=g['width'],g['height'];a=np.frombuffer(base64.b64decode(g['depthsDm']),dtype='<u2').astype(float).reshape(h,w);a[a==65535]=np.nan;a/=10
 lon,lat=points[:,:2].T;x=(lon-b['west'])/(b['east']-b['west'])*w-.5;y=(b['north']-lat)/(b['north']-b['south'])*h-.5;inside=(x>=-.5)&(x<=w-.5)&(y>=-.5)&(y<=h-.5)
 x0=np.floor(x).astype(int);y0=np.floor(y).astype(int);fx=x-x0;fy=y-y0;result=np.zeros(len(x));valid=inside.copy()
 for dx,dy in [(0,0),(1,0),(0,1),(1,1)]:
  weight=(fx if dx else 1-fx)*(fy if dy else 1-fy);v=a[np.clip(y0+dy,0,h-1),np.clip(x0+dx,0,w-1)];valid&=np.isfinite(v)|(weight<=1e-10);result+=np.where(weight>1e-10,v*weight,0)
 result[~valid]=np.nan;return result,a

def stats(errors,all_count):
 e=np.asarray(errors);e=e[np.isfinite(e)];a=np.abs(e)
 return {'count':len(e),'coverage':len(e)/all_count,'medianAbsoluteM':float(np.median(a))if len(e)else None,'p95AbsoluteM':float(np.percentile(a,95))if len(e)else None,'meanErrorM':float(np.mean(e))if len(e)else None,'rmseM':float(np.sqrt(np.mean(e*e)))if len(e)else None}

def score(record, points):
 predicted,grid=sample(record,points);truth=record['labels']['surfaceElevationM']-points[:,2]*.3048;errors=predicted-truth
 # Each occupied 20 m UTM cell has equal total weight, including missing data.
 cells=np.floor(points[:,3:5]/20).astype(int);_,groups,counts=np.unique(cells,axis=0,return_inverse=True,return_counts=True);weights=1/counts[groups];good=np.isfinite(errors);e=errors[good];w=weights[good];a=np.abs(e)
 def quantile(v,q):
  order=np.argsort(v);return float(v[order][np.searchsorted(np.cumsum(w[order]),q*w.sum(),side='left')])
 spatial={'cells':len(counts),'validPoints':int(good.sum()),'coverage':float(w.sum()/len(counts)),'medianAbsoluteM':quantile(a,.5),'p95AbsoluteM':quantile(a,.95),'meanErrorM':float(np.average(e,weights=w)),'rmseM':float(np.sqrt(np.average(e*e,weights=w)))}
 interval=record['intervalM'];spatial['medianAbsoluteContourIntervals']=spatial['medianAbsoluteM']/interval;spatial['p95AbsoluteContourIntervals']=spatial['p95AbsoluteM']/interval
 maximum=float(np.nanmax(grid));reference_maximum=float(np.max(truth));step=maximum/11
 if step>0:
  bands=np.abs(np.floor(np.maximum(predicted[good],0)/step)-np.floor(np.maximum(truth[good],0)/step));spatial['previewStepM']=step;spatial['withinOneFixedScaleSheet']=float(np.average(bands<=1,weights=w));spatial['p95FixedScaleSheetDifference']=quantile(bands,.95)
  predicted_normal=np.clip(np.floor(predicted[good]/maximum*11),0,11);reference_normal=np.clip(np.floor(truth[good]/reference_maximum*11),0,11);difference=np.abs(predicted_normal-reference_normal)
  spatial['withinOneNormalizedSheet']=float(np.average(difference<=1,weights=w));spatial['p95NormalizedSheetDifference']=quantile(difference,.95);spatial['normalizationReference']='Maximum depth among publisher-designated QA points; not a claim about the full-lake maximum.'
 return {'pointwise':stats(errors,len(points)),'spatial20m':spatial,'intervalM':interval}, {'predicted':predicted,'truth':truth,'points':points,'grid':grid}

def main():
 results=[]
 existing=[('viking','viking-pdf'),('viking','viking-crop'),('king-city','king-city-pdf'),('king-city','king-city-crop')]
 for lake,scenario in existing:
  state=json.loads(pathlib.Path(f'scripts/verify/chart-accuracy/fixtures/{scenario}-record.json').read_text());metrics,_=score(state['record'],np.load(root/f'{lake}-qa.npy'));results.append({'scenario':scenario,'lake':lake,'kind':'browser-existing',**metrics})
 p=pathlib.Path('scripts/data/depth-charts/usgs-lake-viking-2019.json');metrics,_=score(json.loads(p.read_text()),np.load(root/'viking-qa.npy'));results.append({'scenario':'viking-curated-vector','lake':'viking','kind':'vector-control-points',**metrics})
 if (root/'trace-results.json').exists():
  for r in json.loads((root/'trace-results.json').read_text()):
   if r.get('error'):results.append({'scenario':r['id'],'lake':r['lake'],'error':r['error']});continue
   state=json.loads((root/f"{r['id']}-record.json").read_text());metrics,_=score(state['record'],np.load(root/f"{r['lake']}-qa.npy"));results.append({'scenario':r['id'],'lake':r['lake'],'kind':'engine-precise-labels',**metrics})
 (root/'accuracy-results.json').write_text(json.dumps(results,indent=2))
 for r in results:print(r['scenario'],r.get('spatial20m',r.get('error')))

if __name__ == "__main__":
 main()
