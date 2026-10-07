import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import { changedProjectKeys, projectPatch } from "./project-patch";

describe("changedProjectKeys", () => {
  it("is empty for the same project and for a deep copy", () => {
    expect(changedProjectKeys(DEFAULT_PROJECT, DEFAULT_PROJECT)).toEqual([]);
    expect(changedProjectKeys(DEFAULT_PROJECT, structuredClone(DEFAULT_PROJECT))).toEqual([]);
  });

  it("lists scalar and nested changes by their top-level key", () => {
    const next: ProjectConfigV1 = { ...DEFAULT_PROJECT, widthMm: 250, location: { ...DEFAULT_PROJECT.location, zoom: 12 }, lineStyle: { ...DEFAULT_PROJECT.lineStyle } };
    expect(changedProjectKeys(DEFAULT_PROJECT, next).sort()).toEqual(["location", "widthMm"]);
  });

  it("counts keys added or removed on either side", () => {
    const withPlaque: ProjectConfigV1 = { ...DEFAULT_PROJECT, plaque: { enabled: true, text: "Peak", font: "jost", sizeMm: 6, placement: { anchor: "center", offset: { x: 0, y: 0 } } } };
    expect(changedProjectKeys(DEFAULT_PROJECT, withPlaque)).toEqual(["plaque"]);
    expect(changedProjectKeys(withPlaque, DEFAULT_PROJECT)).toEqual(["plaque"]);
  });

  it("treats an explicitly undefined key like a missing one", () => {
    const explicit = { ...DEFAULT_PROJECT, plaque: undefined };
    expect(changedProjectKeys(DEFAULT_PROJECT, explicit)).toEqual([]);
  });

  it("notices reordered arrays", () => {
    const markers = [{ id: "a", label: "A", lat: 1, lon: 1 }, { id: "b", label: "B", lat: 2, lon: 2 }] as unknown as ProjectConfigV1["markers"];
    const from = { ...DEFAULT_PROJECT, markers };
    const to = { ...DEFAULT_PROJECT, markers: [...markers].reverse() };
    expect(changedProjectKeys(from, to)).toEqual(["markers"]);
  });
});

describe("projectPatch", () => {
  it("holds only changed keys, with the new values", () => {
    const next: ProjectConfigV1 = { ...DEFAULT_PROJECT, widthMm: 250, showRoads: false };
    expect(projectPatch(DEFAULT_PROJECT, next)).toEqual({ widthMm: 250, showRoads: false });
    expect(projectPatch(DEFAULT_PROJECT, DEFAULT_PROJECT)).toEqual({});
  });

  it("applied to the old project reproduces the new one", () => {
    const next: ProjectConfigV1 = { ...DEFAULT_PROJECT, name: "Rainier", location: { lat: 46.85, lon: -121.76, zoom: 10, label: "Mount Rainier" }, verticalExaggeration: 3 };
    expect({ ...DEFAULT_PROJECT, ...projectPatch(DEFAULT_PROJECT, next) }).toEqual(next);
  });

  it("records a removed key as undefined so spreading it clears the field", () => {
    const withPlaque: ProjectConfigV1 = { ...DEFAULT_PROJECT, plaque: { enabled: true, text: "Peak", font: "jost", sizeMm: 6, placement: { anchor: "center", offset: { x: 0, y: 0 } } } };
    const patch = projectPatch(withPlaque, DEFAULT_PROJECT);
    expect(Object.keys(patch)).toEqual(["plaque"]);
    expect({ ...withPlaque, ...patch }.plaque).toBeUndefined();
  });
});
