import { flushSync, mount, unmount } from "svelte";
import { expect, it } from "vitest";
import { DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, generateGeometry, type AirspaceLevelIR, type AirspaceTint } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";
import ShareArtwork from "$lib/studio/ShareArtwork.svelte";

it("paints airspace faces at their physical heights in the saved artwork", async () => {
  const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
  geometry.layers = geometry.layers.slice(0, 2).map(layer => ({ ...layer, materialThicknessMm: 3 }));
  const ring = (r: number) => [{ x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }, { x: -r, y: r }, { x: -r, y: -r }];
  const plate = (index: number, zMm: number, tint: AirspaceTint): AirspaceLevelIR => ({
    index, zMm, altitudeFt: 1000 * (index + 1), mergedFt: [],
    pieces: [{ id: `plate-${index}`, tint, polygons: [{ outer: ring(20), holes: [ring(1)] }], sectorIds: [], locators: [ring(2)] }],
  });
  geometry.airspaceStack = {
    form: "tiers", thicknessMm: 2, kerfMm: 0.15, ceilingCapFt: 10000, mmPerMeter: 0.01, topMm: 11,
    rod: DEFAULT_AIRSPACE_STACK.rod, columns: [], cutList: [], backingSheet: false,
    levels: [plate(0, 2, "clear"), plate(1, 9, "blue")],
  };
  const target = document.createElement("div");
  const component = mount(ShareArtwork, { target, props: { geometry, project: DEFAULT_PROJECT } });
  try {
    flushSync();
    const faces = [...target.querySelectorAll("[data-terrain-layer], [data-airspace-piece]")];
    expect(faces.map(face => face.getAttribute("data-terrain-layer") ?? face.getAttribute("data-airspace-piece")))
      .toEqual([geometry.layers[0]!.id, "plate-0", geometry.layers[1]!.id, "plate-1"]);
    const [clear, blue] = [faces[1]!, faces[3]!].map(piece => piece.querySelector("path")!);
    expect(clear!.getAttribute("fill")).not.toBe(blue!.getAttribute("fill"));
    expect(Number(blue!.getAttribute("fill-opacity"))).toBeLessThan(1);
    expect(blue!.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(blue!.getAttribute("fill-rule")).toBe("evenodd");
    expect(faces[3]!.querySelector("[data-marking-id] path")).toBeTruthy();
  } finally {
    await unmount(component);
  }
});

it("draws a fitted water insert and its engraving on its own top face", async () => {
  const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
  const lake = { outer: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }, { x: -10, y: -10 }], holes: [] };
  geometry.waterInsertMaterial = { fitClearanceMm: 0.2, thicknessMm: 2, kerfMm: 0.1, ledgeMm: 2 };
  geometry.waterInserts = [{
    id: "W1", lakeKey: "test", surfaceId: "test", layerIndex: 0, polygons: [lake],
    markings: [{ id: "causeway", operation: "engrave", kind: "road", points: [{ x: -10, y: 0 }, { x: 10, y: 0 }] }],
  }];
  const target = document.createElement("div");
  const component = mount(ShareArtwork, { target, props: { geometry, project: DEFAULT_PROJECT } });
  try {
    flushSync();
    const paths = target.querySelectorAll('[data-water-insert="W1"] path');
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute("d")).toContain("9.8");
    expect(paths[1]!.getAttribute("d")).toMatch(/-9\.8 0.*9\.8 0/);
  } finally {
    await unmount(component);
  }
});
