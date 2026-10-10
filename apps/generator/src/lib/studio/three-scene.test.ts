import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GeometryIRV1 } from "@topostack/core";
import { airspaceBody, type CachedAirspaceBody, addStacked, appendPolyline, applyExploded, batchSegments, boundsOverlap, disposeContent, disposeLayerCache, layerGrainTexture, layerKey, polygonBounds, waterStainBands, waterStainMask, type CachedLayer, type LineBatch } from "$lib/studio/three-scene";

type Layer = GeometryIRV1["layers"][number];
const square = (size: number) => [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
const layer = (size = 10, thickness = 3) => ({ index: 2, materialThicknessMm: thickness, polygons: [{ outer: square(size), holes: [square(2)] }] }) as unknown as Layer;

describe("layerKey", () => {
  it("matches for an equal body in a fresh object graph", () => {
    expect(layerKey(layer())).toBe(layerKey(structuredClone(layer())));
  });

  it("changes when the outline, a hole, or the thickness changes", () => {
    const base = layerKey(layer());
    expect(layerKey(layer(10.01))).not.toBe(base);
    expect(layerKey(layer(10, 6))).not.toBe(base);
    const moved = layer();
    moved.polygons[0]!.holes[0]![1] = { x: 2.5, y: 0 };
    expect(layerKey(moved)).not.toBe(base);
  });
});

describe("airspace body cache", () => {
  it("reuses a cloned body, replaces scene materials, and disposes removed bodies", () => {
    const cache = new Map<string, CachedAirspaceBody>();
    const piece = { id: "A1-1", tint: "clear" as const, sectorIds: ["sector"], polygons: layer().polygons };
    const material = new THREE.MeshStandardMaterial();
    const meshes = airspaceBody(cache, piece, 3, material);
    const geometry = meshes[0]!.geometry;
    const dispose = vi.spyOn(geometry, "dispose");
    const content = new THREE.Group();
    content.add(...meshes);
    disposeContent(content, [material], new Set(meshes));
    expect(dispose).not.toHaveBeenCalled();
    const nextMaterial = new THREE.MeshStandardMaterial();
    expect(airspaceBody(cache, structuredClone(piece), 3, nextMaterial)).toBe(meshes);
    expect(meshes[0]!.material).toBe(nextMaterial);
    content.add(...meshes);
    disposeContent(content, [nextMaterial]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(airspaceBody(cache, piece, 4, new THREE.MeshStandardMaterial())[0]!.geometry).not.toBe(geometry);
  });
});

describe("line batches", () => {
  it("adds segment pairs with dash distances that restart for each polyline", () => {
    const batch: LineBatch = { positions: [], distances: [] };
    appendPolyline(batch, [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]);
    appendPolyline(batch, [{ x: 1, y: 1 }, { x: 1, y: 2 }]);
    expect(batch.positions).toEqual([0, 0, 0, 3, 4, 0, 3, 4, 0, 3, 10, 0, 1, 1, 0, 1, 2, 0]);
    expect(batch.distances).toEqual([0, 5, 5, 11, 0, 1]);
    const segments = batchSegments(batch, new THREE.LineDashedMaterial());
    expect(segments.geometry.getAttribute("position").count).toBe(6);
    expect(segments.geometry.getAttribute("lineDistance").count).toBe(6);
  });

  it("leaves out dash distances for solid lines", () => {
    const batch: LineBatch = { positions: [] };
    appendPolyline(batch, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(batchSegments(batch, new THREE.LineBasicMaterial()).geometry.getAttribute("lineDistance")).toBeUndefined();
  });
});

describe("stacking", () => {
  it("spreads stacked objects by layer and returns them to their base height", () => {
    const content = new THREE.Group();
    const bottom = new THREE.Object3D();
    const third = new THREE.Object3D();
    addStacked(content, bottom, 0, 0);
    addStacked(content, third, 2, 6);
    applyExploded(content, 1);
    expect([bottom.position.z, third.position.z]).toEqual([0, 32]);
    applyExploded(content, 0);
    expect([bottom.position.z, third.position.z]).toEqual([0, 6]);
  });
});

describe("layerGrainTexture", () => {
  it("turns the grain the same way for a layer every time, and differently between layers", () => {
    const base = new THREE.CanvasTexture({ width: 1, height: 1 } as unknown as HTMLCanvasElement);
    const first = layerGrainTexture(base, 3);
    expect(layerGrainTexture(base, 3).rotation).toBe(first.rotation);
    expect(layerGrainTexture(base, 4).rotation).not.toBe(first.rotation);
    expect(first.rotation).toBeGreaterThanOrEqual(0);
    expect(first.rotation).toBeLessThan(Math.PI * 2);
  });
});

describe("disposeContent", () => {
  it("frees geometries and resources but only detaches kept objects", () => {
    const content = new THREE.Group();
    const dropped = new THREE.Mesh(new THREE.BufferGeometry());
    const kept = new THREE.Mesh(new THREE.BufferGeometry());
    content.add(dropped, kept);
    const droppedDispose = vi.spyOn(dropped.geometry, "dispose");
    const keptDispose = vi.spyOn(kept.geometry, "dispose");
    const resource = { dispose: vi.fn() };
    const resources = [resource];
    disposeContent(content, resources, new Set([kept]));
    expect(content.children).toHaveLength(0);
    expect(droppedDispose).toHaveBeenCalledOnce();
    expect(keptDispose).not.toHaveBeenCalled();
    expect(resource.dispose).toHaveBeenCalledOnce();
    expect(resources).toHaveLength(0);
  });
});

describe("disposeLayerCache", () => {
  const cached = (key: string): CachedLayer => ({ key, meshes: [], seams: [], face: new THREE.MeshStandardMaterial(), resources: [{ dispose: vi.fn() }] });

  it("frees and forgets only the layers a rebuild did not reuse", () => {
    const kept = cached("a");
    const dropped = cached("b");
    const cache = new Map([["a", kept], ["b", dropped]]);
    disposeLayerCache(cache, new Set(["a"]));
    expect([...cache.keys()]).toEqual(["a"]);
    expect(kept.resources[0]!.dispose).not.toHaveBeenCalled();
    expect(dropped.resources[0]!.dispose).toHaveBeenCalledOnce();
    disposeLayerCache(cache);
    expect(cache.size).toBe(0);
    expect(kept.resources[0]!.dispose).toHaveBeenCalledOnce();
  });
});

describe("water stain", () => {
  const lake = (size: number) => [{ outer: square(size), holes: [] }];

  it("stains each sheet under every waterline at or above it", () => {
    const shallow = lake(4), deep = lake(8), filled = lake(6);
    const bands = waterStainBands([
      { layerIndex: 3, polygons: deep },
      { layerIndex: 1, polygons: shallow },
      // An acrylic insert covers this lake entirely: nothing left to stain.
      { layerIndex: 5, polygons: filled, openPolygons: [] },
    ]);
    expect(bands).toEqual([
      { fromLayer: 0, toLayer: 1, polygons: [...deep, ...shallow] },
      { fromLayer: 2, toLayer: 3, polygons: deep },
    ]);
  });

  it("stains only the water an insert leaves open", () => {
    const open = lake(2);
    expect(waterStainBands([{ layerIndex: 2, polygons: lake(9), openPolygons: open }])).toEqual([{ fromLayer: 0, toLayer: 2, polygons: open }]);
  });

  it("skips sheet pieces nowhere near the water", () => {
    const reach = polygonBounds(lake(4));
    expect(reach).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 });
    expect(boundsOverlap(reach, polygonBounds([{ outer: square(1).map(({ x, y }) => ({ x: x + 3.5, y })), holes: [] }]))).toBe(true);
    expect(boundsOverlap(reach, polygonBounds([{ outer: square(1).map(({ x, y }) => ({ x: x + 5, y })), holes: [] }]))).toBe(false);
  });

  it("maps model millimetres onto the mask, with model y running up the canvas", () => {
    const moves: Array<[number, number]> = [];
    const context = { fillRect: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(), fill: vi.fn(), moveTo: (x: number, y: number) => moves.push([x, y]), lineTo: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context };
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      const texture = waterStainMask([{ outer: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }], holes: [] }])!;
      // 20 mm of water plus 1 mm either side, at 4 px/mm.
      expect([canvas.width, canvas.height]).toEqual([88, 88]);
      // The lake's lowest corner lands 1 mm in from the left and bottom.
      expect(moves[0]).toEqual([4, 84]);
      expect(context.fill).toHaveBeenCalledWith("evenodd");
      // UVs are model mm on a top face; the transform puts (9, 19) at the mask's corner.
      const uv = new THREE.Vector2(9, 19).applyMatrix3((texture.updateMatrix(), texture.matrix));
      expect(uv.x).toBeCloseTo(0); expect(uv.y).toBeCloseTo(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
