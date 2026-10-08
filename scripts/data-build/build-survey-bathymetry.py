#!/usr/bin/env python3
"""Build versioned lake survey PMTiles. See docs/lake-bathymetry.md.

Inputs are checksum-pinned survey downloads and verified ArcGIS snapshots.
Uses an isolated Python environment with scripts/data-build/requirements.txt.
"""
import argparse
from collections import defaultdict
import gzip
import json
import math
from pathlib import Path
import tarfile
import zipfile

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.merge import merge
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import Resampling

from pinned import download as pinned_download

# Shared with build-hrdem-terrain.py; re-exported for existing callers and tests.
from tile_writer import WORLD, TileWriter, digest, encode, write_grid  # noqa: F401

ROOT = Path(__file__).parent.parent
CATALOG = json.loads((ROOT / 'data/lake-bathymetry.json').read_text())['sources']
PINS = json.loads((ROOT / 'data/lake-survey-sources.json').read_text())


def download(item, cache):
    path = cache / item['file']
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() and item.get('arcgis'):
        from importlib import import_module
        snapshot = import_module('snapshot-survey-service').snapshot
        snapshot(item['url'], path, item.get('where', '1=1'))
    if not path.exists():
        pinned_download(item['url'], path, timeout=600, retries=2)
    if digest(path) != item['sha256']:
        raise ValueError(f"Source checksum changed: {item['id']}. Review before updating pins.")
    return path


def unzip(path, target):
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            dest = (target / member.filename).resolve()
            if not dest.is_relative_to(target.resolve()) or (member.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe ZIP member')
        archive.extractall(target)


def depth_from_elevation(values, surface, scale=1):
    result = (surface - values) * scale
    return np.where(np.isfinite(values) & (result >= 0) & (result <= 1500), result, np.nan).astype(np.float32)


def read_e00_rows(lines, width, height):
    """Decode E00 GRD cell values. Every grid row starts on a new line of up to
    five 14-character values, so a row whose width is not a multiple of five
    either ends on a short line or is padded to a full line. Reading the values
    as one continuous stream shifts each row by the padding and shears the grid."""
    values = np.empty((height, width), dtype=np.float32)
    for row in range(height):
        col = 0
        while col < width:
            line = next(lines, '').rstrip('\n')
            if not line or line.startswith('EOG'):
                raise ValueError('Truncated Tahoe grid')
            for start in range(0, len(line), 14):
                if col == width:
                    break  # Row padding up to the full line.
                values[row, col] = float(line[start:start+14])
                col += 1
    values[values < -1e30] = np.nan
    return values


def read_e00(path):
    """Read the uncompressed floating-point Arc/Info GRD export used by DDS-55."""
    with gzip.open(path, 'rt') as f:
        if not f.readline().startswith('EXP  0') or f.readline().strip() != 'GRD  2':
            raise ValueError('Expected an uncompressed floating-point E00 GRD')
        header = f.readline()
        width, height = int(header[:10]), int(header[10:20])
        if (width, height) != (1992, 3416):
            raise ValueError('Unexpected Tahoe grid dimensions')
        res = [float(v) for v in f.readline().split()]
        left, bottom = [float(v) for v in f.readline().split()]
        right, top = [float(v) for v in f.readline().split()]
        if res != [10, 10] or not math.isclose(right-left, width*10) or not math.isclose(top-bottom, height*10):
            raise ValueError('Unexpected Tahoe grid georeferencing')
        values = read_e00_rows(f, width, height)
        if not f.readline().startswith('EOG'):
            raise ValueError('Tahoe grid has more rows than its header')
        return values, from_bounds(left, bottom, right, top, width, height)


def usgs(source, pin, cache, writer):
    archive = download(pin, cache)
    prepared = cache / f"{pin['id']}-depths.tif"
    if pin['id'] == 'tahoe':
        values, transform = read_e00(archive)
        write_grid(prepared, depth_from_elevation(values,1899),transform,'EPSG:32610')
    else:
        extracted = cache / pin['id']
        unzip(archive, extracted)
        if pin['id'] == 'crater':
            with tarfile.open(extracted/'bathy.tar') as bundle:
                bundle.extractall(extracted, filter='data')
        path = extracted / pin['grid']
        with rasterio.open(path) as src:
            if src.crs.to_epsg() != pin['epsg'] or not math.isclose(src.res[0], pin['resolutionM']):
                raise ValueError('Unexpected survey projection/resolution')
            raw = src.read(1,masked=True).filled(np.nan)
            write_grid(prepared,depth_from_elevation(raw,pin['surface'],pin['scale']),src.transform,src.crs)
    writer.add(prepared,pin['id'])


def swiss(pins, cache, writer):
    for pin in pins:
        archive = download(pin,cache)
        prepared = cache / f"{pin['id']}-10m.tif"
        if not prepared.exists():
            paths = []
            # Stream one native tile at a time out of the ZIP; preserve gaps on resampling.
            tile_dir = cache / 'swiss-prepared'
            tile_dir.mkdir(exist_ok=True)
            with zipfile.ZipFile(archive) as bundle:
                members = sorted(n for n in bundle.namelist() if n.lower().endswith('.asc'))
                if not members:
                    raise ValueError('No Swiss elevation grids')
                for i, name in enumerate(members):
                    with rasterio.MemoryFile(bundle.read(name)) as mem, mem.open() as src:
                        if src.count != 1 or src.res[0] not in (0.5,1,2,3):
                            raise ValueError('Unexpected Swiss grid resolution')
                        shape=(max(1,math.ceil((src.bounds.top-src.bounds.bottom)/10)),max(1,math.ceil((src.bounds.right-src.bounds.left)/10)))
                        data=src.read(1,out_shape=shape,masked=True,resampling=Resampling.average).filled(np.nan)
                        path=tile_dir/f'{i}.tif'
                        write_grid(path,data,from_bounds(*src.bounds,shape[1],shape[0]),'EPSG:2056')
                        paths.append(path)
            merge(paths,res=10,nodata=np.nan,dtype='float32',dst_path=prepared,mem_limit=64,
                  dst_kwds={'compress':'deflate','tiled':True})
            for p in paths:
                p.unlink()
        writer.add(prepared,pin['id'])
        print(f"Swiss grid: {pin['id']}",flush=True)


def minnesota(pin,cache,writer):
    import fiona
    from scipy.interpolate import LinearNDInterpolator
    from scipy.spatial import QhullError
    archive=download(pin,cache)
    extracted=cache/'minnesota'
    if not (extracted/'water_lake_bathymetry.gdb').exists():
        unzip(archive,extracted)
    gdb=extracted/'water_lake_bathymetry.gdb'
    contours=defaultdict(list)
    excluded_contours=0
    with fiona.open(gdb,layer='lake_bathymetric_contours') as layer:
        crs=layer.crs
        for feature in layer:
            depth=-float(feature['properties']['DEPTH'])*0.3048
            if depth<0:
                excluded_contours+=1
                continue  # Positive source elevations are above the mapped waterline.
            if not math.isfinite(depth) or depth>1500:
                raise ValueError('Invalid Minnesota contour depth')
            for line in feature['geometry']['coordinates']:
                contours[feature['properties']['DOWLKNUM']].extend((p[0],p[1],depth) for p in line)
    print(f'Excluded {excluded_contours} above-water contours',flush=True)
    outlines=defaultdict(list)
    with fiona.open(gdb,layer='lake_bathymetric_outline') as layer:
        for feature in layer:
            if feature['properties']['ISLAND']=='Y':
                continue
            outlines[feature['properties']['DOWLKNUM']].append(dict(feature['geometry']))
    skipped=[]
    for i,(lake,points) in enumerate(sorted(contours.items())):
        prepared=cache/'mn-prepared'/f'{lake}.tif'
        if not outlines[lake]:
            skipped.append({'id':lake,'reason':'No water outline'})
            continue
        if not prepared.exists():
            data=np.asarray(points,dtype=np.float64)
            xy,indices=np.unique(data[:,:2],axis=0,return_index=True)
            if len(xy)<3 or data[:,2].max()==0:
                skipped.append({'id':lake,'reason':'Insufficient depth contours'})
                continue
            # Linear interpolation honors survey contour values without inventing depths outside their hull.
            try:
                interpolate=LinearNDInterpolator(xy,data[indices,2],fill_value=np.nan)
            except QhullError:
                skipped.append({'id':lake,'reason':'Degenerate contour geometry'})
                continue
            left,bottom=xy.min(axis=0);right,top=xy.max(axis=0)
            width,height=math.ceil((right-left)/20),math.ceil((top-bottom)/20)
            transform=from_origin(left,top,20,20)
            x=left+(np.arange(width)+0.5)*20
            values=np.empty((height,width),dtype=np.float32)
            for row in range(height):
                values[row]=interpolate(x,np.full(width,top-(row+0.5)*20))
            mask=geometry_mask(outlines[lake],out_shape=values.shape,transform=transform,invert=True)
            values[~mask]=np.nan
            write_grid(prepared,values,transform,crs)
        writer.add(prepared,lake)
        if i%50==0:
            print(f'Minnesota: {i+1}/{len(contours)} basins',flush=True)
    (cache/'minnesota-skipped.json').write_text(json.dumps(skipped,indent=2)+'\n')
    print(f'Minnesota: {len(writer.grids)} basins processed, {len(skipped)} skipped',flush=True)


FINNISH_DEPTH_FIELD='Syvyyskayr'
# Above this share of unreadable contour depths the schema has likely changed;
# fail instead of publishing an archive built from the few parseable lines.
MAX_DEPTH_PARSE_SKIP_RATIO=0.5


def finnish_contour_depth(properties):
    """Contour depth in metres from a decimal-comma string or a numeric field, else None."""
    value=properties.get(FINNISH_DEPTH_FIELD) if properties is not None else None
    if value is None:return None
    try:depth=float(str(value).strip().replace(',','.'))
    except ValueError:return None
    return depth if math.isfinite(depth) else None


def check_depth_parse_ratio(skipped,total,label):
    if total>0 and skipped/total>MAX_DEPTH_PARSE_SKIP_RATIO:
        raise ValueError(f'{label}: {skipped} of {total} contour depths were missing or unreadable; check the {FINNISH_DEPTH_FIELD} field')


def finland(pins,cache,writer):
    import fiona
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from scipy.interpolate import LinearNDInterpolator
    from scipy.spatial import QhullError
    for pin in pins:
        archive=download(pin,cache)
        target=cache/pin['id']
        if not target.exists():unzip(archive,target)
    regions=defaultdict(list)
    with fiona.open(cache/'finland-areas/Syvyysalue.shp') as src:
        crs=src.crs
        for f in src:
            lake=f['properties']['JarviTunnu']
            if lake and f['geometry']:regions[lake].append(shape(f['geometry']))
    skipped=[]
    depth_total=depth_skipped=0
    with fiona.open(cache/'finland-contours/Syvyyskayra.shp') as contours:
        for i,(lake,geometries) in enumerate(sorted(regions.items())):
            prepared=cache/'fi-prepared'/f'{lake}.tif'
            if not prepared.exists():
                water=unary_union([g if g.is_valid else g.buffer(0) for g in geometries])
                if water.is_empty:
                    skipped.append({'id':lake,'reason':'No valid water mask'});continue
                points=[]
                for feature in contours.filter(bbox=water.bounds):
                    line=shape(feature['geometry'])
                    if not water.intersects(line):continue
                    depth=finnish_contour_depth(feature['properties'])
                    depth_total+=1
                    if depth is None:
                        depth_skipped+=1;continue
                    if not 0<=depth<=1500:continue
                    clipped=line.intersection(water)
                    parts=list(clipped.geoms) if hasattr(clipped,'geoms') else [clipped]
                    for part in parts:
                        if part.geom_type=='LineString':points.extend((x,y,depth) for x,y in part.coords)
                # Check as lakes complete so a schema change fails early, not after hours.
                if depth_total>=1000:check_depth_parse_ratio(depth_skipped,depth_total,'Finland')
                if len(points)<3 or max((p[2] for p in points),default=0)<=0:
                    skipped.append({'id':lake,'reason':'Insufficient depth contours'});continue
                data=np.asarray(points,dtype=np.float64)
                xy,indices=np.unique(data[:,:2],axis=0,return_index=True)
                try:interpolate=LinearNDInterpolator(xy,data[indices,2],fill_value=np.nan)
                except (QhullError,ValueError):
                    skipped.append({'id':lake,'reason':'Degenerate depth contours'});continue
                left,bottom,right,top=water.bounds
                width,height=math.ceil((right-left)/20),math.ceil((top-bottom)/20)
                if width*height>100_000_000:
                    raise ValueError('Unexpectedly large Finnish lake grid')
                transform=from_origin(left,top,20,20)
                x=left+(np.arange(width)+0.5)*20
                values=np.empty((height,width),dtype=np.float32)
                for row in range(height):values[row]=interpolate(x,np.full(width,top-(row+0.5)*20))
                mask=geometry_mask([mapping(water)],out_shape=values.shape,transform=transform,invert=True)
                values[~mask]=np.nan
                if not np.isfinite(values).any():
                    skipped.append({'id':lake,'reason':'No gridded survey coverage'});continue
                write_grid(prepared,values,transform,crs)
            with rasterio.open(prepared) as check:
                values=check.read(1,masked=True)
                if not values.count() or values.max()<=0:
                    skipped.append({'id':lake,'reason':'No underwater depth contours'});continue
            writer.add(prepared,lake)
            if i%50==0:print(f'Finland: {i+1}/{len(regions)} lakes',flush=True)
    check_depth_parse_ratio(depth_skipped,depth_total,'Finland')
    (cache/'finland-skipped.json').write_text(json.dumps(skipped,indent=2)+'\n')
    print(f'Finland: {len(writer.grids)} lakes processed, {len(skipped)} skipped',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,required=True)
    parser.add_argument('--out-dir',type=Path,required=True)
    from chart_records import SOURCE as CHART_SOURCE
    # The chart archive is built from the committed records, so it is buildable
    # before it is registered in the catalog; the catalog copy wins once added.
    sources=CATALOG+([CHART_SOURCE] if not any(x['id']==CHART_SOURCE['id'] for x in CATALOG) else [])
    parser.add_argument('--dataset',default='all',choices=['all']+[x['id'] for x in sources if x['id']!='noaa-great-lakes-v1'])
    args=parser.parse_args()
    args.cache.mkdir(parents=True,exist_ok=True);args.out_dir.mkdir(parents=True,exist_ok=True)
    for source in sources:
        if source['id']=='noaa-great-lakes-v1' or args.dataset not in ('all',source['id']):
            continue
        if source['id']==CHART_SOURCE['id']:
            # Its sources are the committed chart records, not pinned downloads.
            from chart_records import charts
            writer=TileWriter(args.out_dir/f"{source['id']}.pmtiles",source)
            writer.finish(charts(source,args.cache,writer,write_grid))
            continue
        if source['id'].startswith('noaa-enc-'):
            # Pinned in noaa-enc-sources.json, like the NBS lakes.
            from survey_enc import enc
            writer=TileWriter(args.out_dir/f"{source['id']}.pmtiles",source)
            writer.finish(enc(source,args.cache,writer,download,write_grid))
            continue
        if source['id'].startswith('noaa-nbs-'):
            # Pinned in noaa-nbs-sources.json, apart from the pins the lake outline release checksums.
            from survey_nbs import nbs
            writer=TileWriter(args.out_dir/f"{source['id']}.pmtiles",source)
            writer.finish(nbs(source,args.cache,writer,download,write_grid))
            continue
        pins=[p for p in PINS if p['dataset']==source['id']]
        if not pins:
            raise ValueError('Missing source pins')
        writer=TileWriter(args.out_dir/f"{source['id']}.pmtiles",source)
        if source['id'].startswith('usgs-'):
            usgs(source,pins[0],args.cache,writer)
        elif source['id']=='swissbathy3d-v1':
            swiss(pins,args.cache,writer)
        elif source['id']=='mn-dnr-lakes-v1':
            minnesota(pins[0],args.cache,writer)
        elif source['id']=='syke-finland-lakes-v1':
            finland(pins,args.cache,writer)
        elif source['id'] in ('ontario-lakes-v1', 'nve-norway-lakes-v1'):
            from survey_regions import regional
            regional(pins,args.cache,writer,download,write_grid,'norway' if source['id'].startswith('nve-') else 'ontario')
        elif source['id'] in ('twdb-texas-reservoirs-v1', 'usbr-reservoirs-v1'):
            from survey_regions import reservoirs
            reservoirs(pins,args.cache,writer,download,unzip,write_grid)
        else:
            raise ValueError(f"No builder for {source['id']}")
        writer.finish(pins)

if __name__=='__main__':
    main()
