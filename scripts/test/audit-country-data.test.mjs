import assert from "node:assert/strict";
import test from "node:test";
import { PbfWriter } from "pbf";
import { countVectors, cropTiles, elevationPercentiles, polygonIntersectsBox, segmentIntersectsBox, siteCrop, summarizeTiles, terrainTileSamples } from "../verify/audit-country-data.mjs";

const point = (x, y) => ({ x, y });
const box = { minX: 0.4, maxX: 0.6, minY: 0.4, maxY: 0.6 };
const square = (min, max) => [point(min, min), point(max, min), point(max, max), point(min, max), point(min, min)];

test("only linework in the audit crop contributes, including crossings with outside endpoints", () => {
  assert.equal(segmentIntersectsBox(point(0, 0.5), point(1, 0.5), box), true);
  assert.equal(segmentIntersectsBox(point(0.1, 0.3), point(0.9, 0.3), box), false);
  assert.equal(segmentIntersectsBox(point(0, 0), point(0.4, 0.4), box), false);
});

test("polygon evidence handles a contained feature and a crop inside a hole", () => {
  assert.equal(polygonIntersectsBox([square(0.45, 0.55)], box), true);
  assert.equal(polygonIntersectsBox([square(0.2, 0.8)], box), true);
  assert.equal(polygonIntersectsBox([square(0.2, 0.8), square(0.3, 0.7)], box), false);
  assert.equal(polygonIntersectsBox([square(0.05, 0.2)], box), false);
});

test("MVT evidence uses the production transportation classifier and excludes off-crop features", () => {
  const lines = [
    { kind: "major_road", y: 50 },
    { kind: "minor_road", y: 10 },
    { kind: "path", y: 55 },
    { kind: "ferry", y: 45 },
  ];
  const pbf = new PbfWriter();
  pbf.writeMessage(3, (items, layer) => {
    layer.writeVarintField(15, 2);
    layer.writeStringField(1, "roads");
    layer.writeVarintField(5, 100);
    layer.writeStringField(3, "kind");
    for (const [index, item] of items.entries()) {
      layer.writeMessage(4, (name, value) => value.writeStringField(1, name), item.kind);
      layer.writeMessage(2, ([tagIndex, y], feature) => {
        feature.writeVarintField(3, 2);
        feature.writePackedVarint(2, [0, tagIndex]);
        feature.writePackedVarint(4, [9, 0, y * 2, 10, 200, 0]);
      }, [index, item.y]);
    }
  }, lines);
  const counts = countVectors(pbf.finish(), { box });
  assert.equal(counts.majorRoad, 1);
  assert.equal(counts.localRoad, 0);
  assert.equal(counts.trail, 1);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 2);
});

test("antimeridian crops read both tile columns and finite elevation includes below-sea-level pixels", () => {
  const tiles = cropTiles(siteCrop({ lat: 10, lon: 180, radiusM: 500 }), 12);
  assert.deepEqual([...new Set(tiles.map(({ x }) => x))], [4095, 0]);
  const heights = new Float32Array(256 ** 2).fill(7000);
  heights.set([-5, 4]);
  heights.set([12, NaN], 256);
  assert.deepEqual(terrainTileSamples(heights, { minX: 0, minY: 0, maxX: 2 / 256, maxY: 2 / 256 }),
    { samplePixels: 4, validPixels: 3, positivePixels: 2, minM: -5, maxM: 12 });
});

test("an empty crop, a missing tile and a failed read are distinguishable", () => {
  assert.equal(summarizeTiles([{ status: "available" }], "no-features"), "no-features");
  assert.equal(summarizeTiles([{ status: "missing" }]), "missing");
  assert.equal(summarizeTiles([{ status: "no-data" }]), "no-valid-data");
  assert.equal(summarizeTiles([{ status: "unavailable" }]), "unavailable");
  assert.equal(summarizeTiles([{ status: "unavailable" }, { status: "available" }]), "partial");
});

test("a severe isolated pit does not set the typical relief of a settlement", () => {
  const heights = Array.from({ length: 100 }, (_, i) => 200 + i);
  heights[0] = -9696;
  assert.deepEqual(elevationPercentiles(heights.reverse()), { p05M: 204, p50M: 249, p95M: 294 });
  assert.deepEqual(elevationPercentiles([]), { p05M: null, p50M: null, p95M: null });
});
