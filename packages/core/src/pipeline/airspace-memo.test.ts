import { describe, expect, it, vi } from "vitest";
import { createGeometryGenerator, DEFAULT_AIRSPACE_STACK, generateGeometry, type GeometryIRV1, type ProjectConfigV1 } from "../index.js";
import { placeAirspaceSupports } from "./airspace-supports.js";
import { core, plain, project, shelf, withAirspace } from "../test-support/airspace.js";

// Supports run once per build of pieces and rods, so their calls count rebuilds.
vi.mock("./airspace-supports.js", async (original) => {
  const actual = await original<typeof import("./airspace-supports.js")>();
  return { ...actual, placeAirspaceSupports: vi.fn(actual.placeAirspaceSupports) };
});

const built = (geometry: GeometryIRV1) => ({ stack: geometry.airspaceStack, sheets: geometry.layers.map((layer) => layer.polygons), warnings: geometry.warnings });

describe("airspace across edits in one session", () => {
  const source = withAirspace([core, shelf]);
  const config: ProjectConfigV1 = { ...project, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form: "plates" } };

  it("reuses pieces, rods and sockets when an edit leaves them alone, and annotates again", () => {
    const generate = createGeometryGenerator();
    const first = generate(config, source);
    expect(first.airspaceStack!.columns.some((column) => column.segments.some((segment) => segment.seat.kind === "terrain"))).toBe(true);
    expect(first.layers.map((layer) => layer.polygons)).not.toEqual(plain.layers.map((layer) => layer.polygons));
    // Whatever a consumer does to one result never reaches the next.
    first.airspaceStack!.levels[0]!.pieces[0]!.polygons = [];
    first.layers[0]!.polygons = [];
    vi.mocked(placeAirspaceSupports).mockClear();
    const edited: ProjectConfigV1 = { ...config, textStyle: { ...config.textStyle, sizeMm: 2 }, lineStyle: { ...config.lineStyle, annotationMm: 0.3 }, showScaleBar: true };
    const again = generate(edited, source);
    expect(placeAirspaceSupports).not.toHaveBeenCalled();
    expect(built(again)).toEqual(built(generateGeometry(edited, source)));
  });

  it("rebuilds when the airspace settings change", () => {
    const generate = createGeometryGenerator();
    generate(config, source);
    vi.mocked(placeAirspaceSupports).mockClear();
    const thicker: ProjectConfigV1 = { ...config, airspaceStack: { ...config.airspaceStack!, rod: { ...config.airspaceStack!.rod, sizeMm: 5 } } };
    const rebuilt = generate(thicker, source);
    expect(placeAirspaceSupports).toHaveBeenCalledOnce();
    expect(built(rebuilt)).toEqual(built(generateGeometry(thicker, source)));
  });

  it("rebuilds when the airspace data changes", () => {
    const generate = createGeometryGenerator();
    generate(config, source);
    vi.mocked(placeAirspaceSupports).mockClear();
    const reloaded = withAirspace([shelf]);
    const rebuilt = generate(config, reloaded);
    expect(placeAirspaceSupports).toHaveBeenCalledOnce();
    expect(built(rebuilt)).toEqual(built(generateGeometry(config, reloaded)));
  });
});
