import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GeometryIRV1 } from "@topostack/core";
import { addStacked, appendPolyline, applyExploded, batchSegments, disposeContent, disposeLayerCache, layerGrainTexture, layerKey, type CachedLayer, type LineBatch } from "$lib/studio/three-scene";

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
