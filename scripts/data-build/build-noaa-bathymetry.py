#!/usr/bin/env python3
"""Build depth-encoded PNG PMTiles from NOAA's native Great Lakes GeoTIFFs.

Requires rasterio, numpy, Pillow and the pmtiles CLI. No runtime NOAA requests.
See docs/noaa-bathymetry.md for datums, coverage and reproducible provisioning.
"""
import argparse
from contextlib import closing
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling, transform_bounds
from pinned import download, file_sha256

CATALOG = json.loads((Path(__file__).parent.parent / "data/noaa-great-lakes.json").read_text())
PINS = json.loads((Path(__file__).parent.parent / "data/noaa-great-lakes-sources.json").read_text())
WORLD = 20037508.342789244
SIZE = 256


def download_grid(lake, cache):
    lake_id = lake["id"]
    url = f"https://www.ngdc.noaa.gov/mgg/greatlakes/{lake_id}/data/geotiff/{lake_id}_lld.geotiff.tar.gz"
    archive = cache / f"{lake_id}.tar.gz"
    if not archive.exists():
        print(f"Downloading {lake_id}", flush=True)
        download(url, archive, user_agent="TopoStack bathymetry builder", timeout=120)
    digest = file_sha256(archive)
    expected = next(item["sha256"] for item in PINS["sources"] if item["id"] == lake_id)
    if digest != expected:
        raise ValueError(f"NOAA {lake_id} source checksum changed. Review the source before updating its pin.")
    # Extract only the expected TIFF; never trust archive member paths.
    target = cache / f"{lake_id}.tif"
    with tarfile.open(archive) as bundle:
        members = [m for m in bundle.getmembers() if m.isfile() and Path(m.name).name == f"{lake_id}_lld.tif"]
        if len(members) != 1:
            raise ValueError(f"Unexpected NOAA archive contents: {archive}")
        with bundle.extractfile(members[0]) as source, target.open("wb") as output:
            shutil.copyfileobj(source, output)
    return target, {"id": lake_id, "url": url, "sha256": digest}


def depth_pixels(elevation, valid):
    """Native grids are elevations relative to local low water (negative below)."""
    water = valid & np.isfinite(elevation) & (elevation <= 0) & (elevation >= -1500)
    depth = np.where(water, -elevation, 0)
    encoded = np.rint((depth + 32768) * 256).astype(np.uint32)
    rgba = np.zeros((*depth.shape, 4), dtype=np.uint8)
    rgba[..., 0] = encoded >> 16
    rgba[..., 1] = (encoded >> 8) & 255
    rgba[..., 2] = encoded & 255
    rgba[..., 3] = water.astype(np.uint8) * 255
    return rgba


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.out.exists():
        parser.error("Output already exists; choose a new path.")
    database = args.out.with_suffix(".mbtiles")
    if database.exists():
        parser.error("Intermediate MBTiles already exists; choose a new path.")
    sources = []
    # closing() releases the handle; the inner context still commits or rolls back.
    with closing(sqlite3.connect(database)) as db, db:
        db.executescript("CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB, PRIMARY KEY (zoom_level,tile_column,tile_row));")
        for lake in CATALOG["lakes"]:
            path, provenance = download_grid(lake, args.cache)
            with rasterio.open(path) as src:
                if src.crs.to_epsg() != 4269 or src.count != 1 or not math.isclose(src.res[0], 1 / 1200, rel_tol=0.01):
                    raise ValueError(f"Unexpected NOAA grid coordinates/resolution: {path}")
                raw = src.read(1, masked=True)
                valid = ~np.ma.getmaskarray(raw)
                # Land must be NoData before resampling, or banks contaminate water depths.
                depths = np.where(valid & (raw.data <= 0) & (raw.data >= -1500), raw.data, np.nan).astype(np.float32)
                provenance.update({"bounds": list(src.bounds), "resolutionDegrees": list(src.res), "verticalDatum": "local lake low water", "minElevationM": float(raw.min())})
                sources.append(provenance)
                left, bottom, right, top = transform_bounds(src.crs, "EPSG:3857", *src.bounds)
                for z in range(CATALOG["maxZoom"] + 1):
                    span = 2 * WORLD / 2 ** z
                    count = 0
                    for x in range(max(0, math.floor((left + WORLD) / span)), min(2 ** z - 1, math.floor((right + WORLD) / span)) + 1):
                        for y in range(max(0, math.floor((WORLD - top) / span)), min(2 ** z - 1, math.floor((WORLD - bottom) / span)) + 1):
                            tile = np.full((SIZE, SIZE), np.nan, dtype=np.float32)
                            transform = from_bounds(x * span - WORLD, WORLD - (y + 1) * span, (x + 1) * span - WORLD, WORLD - y * span, SIZE, SIZE)
                            reproject(depths, tile, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
                                      dst_transform=transform, dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.bilinear)
                            pixels = depth_pixels(tile, np.isfinite(tile))
                            if not pixels[..., 3].any():
                                continue
                            tms_y = 2 ** z - 1 - y
                            previous = db.execute("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?", (z, x, tms_y)).fetchone()
                            if previous:
                                old = np.array(Image.open(io.BytesIO(previous[0])))
                                pixels[pixels[..., 3] == 0] = old[pixels[..., 3] == 0]
                            output = io.BytesIO()
                            Image.fromarray(pixels).save(output, format="PNG", optimize=True)
                            db.execute("INSERT OR REPLACE INTO tiles VALUES (?,?,?,?)", (z, x, tms_y, output.getvalue()))
                            count += 1
                    db.commit()
                    print(f"{lake['id']} z{z}: {count} tiles", flush=True)
                del raw, depths
        metadata = {
            "name": "NOAA NCEI Great Lakes bathymetry", "format": "png", "type": "overlay", "version": "1",
            "minzoom": "0", "maxzoom": str(CATALOG["maxZoom"]), "bounds": "-93,40,-75,50",
            "topostack_dataset": CATALOG["dataset"], "topostack_encoding": "depth-terrarium-v1",
            "description": "Positive depth in meters below local low water; transparent pixels have no coverage. Superior is a draft.",
            "attribution": CATALOG["sourceUrl"],
        }
        db.executemany("INSERT INTO metadata VALUES (?,?)", metadata.items())
        db.commit()
    subprocess.run(["pmtiles", "convert", str(database), str(args.out)], check=True)
    subprocess.run(["pmtiles", "verify", str(args.out)], check=True)
    with args.out.open("rb") as archive:
        digest = hashlib.file_digest(archive, "sha256").hexdigest()
    receipt = args.out.with_suffix(".sources.json")
    partial = receipt.with_name(receipt.name + ".part")
    partial.write_text(json.dumps({"dataset": CATALOG["dataset"], "sha256": digest, "sources": sources}, indent=2) + "\n")
    partial.replace(receipt)
    print(f"Built {args.out}: SHA-256 {digest}", flush=True)


if __name__ == "__main__":
    main()
