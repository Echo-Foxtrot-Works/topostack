import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, type ProjectConfigV1 } from "../index.js";
import { engravingToSvg } from "../export/engraving-svg.js";
import { coordinateGridInterval } from "./coordinate-grid.js";
import { realSource } from "../test-support/sources.js";

describe("coordinate grid", () => {
  it("generates an area-sensitive latitude and longitude grid as local dotted linework", () => {
    const coloradoBounds = { west: -109.06, south: 36.99, east: -102.04, north: 41.01 };
    const project: ProjectConfigV1 = {
      ...DEFAULT_PROJECT,
      outputMode: "engraving",
      showRoads: false,
      showTrails: false,
      showWater: false,
      showBoundaries: false,
      showCoordinateGrid: true,
      showElevationLabels: false,
      showNorthArrow: false,
      showScaleBar: false,
      lineStyle: { ...DEFAULT_PROJECT.lineStyle, coordinateGridMm: 0.13 },
    };
    const source = { ...realSource(project), bounds: coloradoBounds, vectorStatus: "not-requested" as const };
    const result = generateGeometry(project, source);
    const grid = result.layers.flatMap((layer) => layer.markings).filter((marking) => marking.kind === "grid");
    const svg = engravingToSvg(result, project);

    expect(coordinateGridInterval(coloradoBounds)).toBe(1);
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.some((marking) => marking.id.startsWith("coordinate-longitude-"))).toBe(true);
    expect(grid.some((marking) => marking.id.startsWith("coordinate-latitude-"))).toBe(true);
    expect(result.warnings.some((warning) => warning.code === "VECTOR_DATA_UNAVAILABLE")).toBe(false);
    expect(svg).toMatch(/id="ENGRAVE-coordinate-grid" stroke-width="0\.13" stroke-dasharray="0\.01 [^"]+"/);
    expect(generateGeometry({ ...project, showCoordinateGrid: false }, source).layers.flatMap((layer) => layer.markings).some((marking) => marking.kind === "grid")).toBe(false);
  });
});
