import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import { sameMapArea } from "./project-diff";

describe("sameMapArea", () => {
  it("ignores edits that leave the mapped window alone", () => {
    const relabeled: ProjectConfigV1 = { ...DEFAULT_PROJECT, name: "Other", location: { ...DEFAULT_PROJECT.location, label: "Renamed" }, verticalExaggeration: 4 };
    expect(sameMapArea(DEFAULT_PROJECT, relabeled)).toBe(true);
    expect(sameMapArea(DEFAULT_PROJECT, structuredClone(DEFAULT_PROJECT))).toBe(true);
  });

  it("changes with the center or zoom", () => {
    expect(sameMapArea(DEFAULT_PROJECT, { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, lat: 43 } })).toBe(false);
    expect(sameMapArea(DEFAULT_PROJECT, { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, lon: -122 } })).toBe(false);
    expect(sameMapArea(DEFAULT_PROJECT, { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, zoom: 12 } })).toBe(false);
  });

  it("changes when the cut's aspect ratio refits the bounds", () => {
    expect(sameMapArea(DEFAULT_PROJECT, { ...DEFAULT_PROJECT, widthMm: 200, heightMm: 200 })).toBe(false);
  });

  it("compares explicit bounds even with an identical center and zoom", () => {
    const bounds = { west: -122.2, east: -122.0, north: 43.0, south: 42.9 };
    const framed: ProjectConfigV1 = { ...DEFAULT_PROJECT, location: { ...DEFAULT_PROJECT.location, bounds } };
    expect(sameMapArea(framed, structuredClone(framed))).toBe(true);
    expect(sameMapArea(framed, { ...framed, location: { ...framed.location, bounds: { ...bounds, east: -121.9 } } })).toBe(false);
  });
});
