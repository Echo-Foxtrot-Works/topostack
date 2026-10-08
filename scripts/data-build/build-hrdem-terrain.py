#!/usr/bin/env python3
"""Build bounded, versioned bare-earth terrain overlays from NRCan HRDEM COGs.

Only the registered region is read through HTTP ranges; never download the
entire multi-GB project. See docs/hrdem-terrain.md for pinning and rollout.
"""
import argparse
from pathlib import Path

from hrdem import build, snapshot
import tile_writer
from terrain_release import load_registry
ROOT = Path(__file__).parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='nrcan-hrdem-alexander-v1')
    parser.add_argument('--out-dir', type=Path, required=True)
    args = parser.parse_args()
    sources, records = load_registry(ROOT / 'data/terrain-sources.json', ROOT / 'data/hrdem-sources.json')
    source = next(s for s in sources if s['id'] == args.source)
    pin = records[args.source]['pin']
    if source['encoding'] != 'elevation-terrarium-v1' or pin['verticalDatum'] != source['verticalDatum']:
        raise ValueError('Terrain encoding/datum mismatch')
    args.out_dir.mkdir(parents=True, exist_ok=True)
    output = args.out_dir / f"{source['id']}.pmtiles"
    target = args.out_dir / f"{source['id']}.tif"
    if output.exists() or target.exists() or output.with_suffix('.mbtiles').exists():
        raise ValueError('Choose a new output directory; existing builds are never overwritten')
    print(f"Reading HRDEM region {source['bounds']} through COG ranges", flush=True)
    samples_hash = snapshot(source, pin, target)
    pin = {**pin, 'snapshotSha256': tile_writer.digest(target), 'samplesSha256': samples_hash}
    build(source, pin, target, output)


if __name__ == '__main__':
    main()
